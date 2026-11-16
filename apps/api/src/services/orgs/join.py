from datetime import datetime
from typing import Optional, Union
from fastapi import HTTPException, Request
from pydantic import BaseModel, field_validator
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession
from src.db.organizations import Organization
from src.db.user_organizations import UserOrganization
from src.db.users import AnonymousUser, PublicUser, User
from src.services.analytics import events as analytics_events
from src.services.analytics.analytics import track
from src.security.features_utils.usage import (
    check_limits_with_usage,
    increase_feature_usage,
)
from src.services.orgs.invites import get_invite_code
from src.services.orgs.join_notifications import notify_user_joined_org
from src.services.orgs.orgs import get_org_join_mechanism


class JoinOrg(BaseModel):
    org_id: int
    user_id: Union[str, int]
    invite_code: Optional[str] = None

    @field_validator("user_id", mode="before")
    @classmethod
    def coerce_user_id_to_str(cls, v: Union[str, int]) -> str:
        return str(v)


async def join_org(
    request: Request,
    args: JoinOrg,
    current_user: PublicUser | AnonymousUser,
    db_session: AsyncSession,
):
    statement = select(Organization).where(Organization.id == args.org_id)
    org = (await db_session.execute(statement)).scalars().first()

    if not org or org.id is None:
        raise HTTPException(
            status_code=404,
            detail="Organization not found",
        )

    await check_limits_with_usage("members", org.id, db_session)

    join_method = await get_org_join_mechanism(
        request, args.org_id, current_user, db_session
    )

    # Get User by UUID or numeric ID
    user_id_str = str(args.user_id)
    if user_id_str.isdigit():
        statement = select(User).where(
            (User.user_uuid == user_id_str) | (User.id == int(user_id_str))
        )
    else:
        statement = select(User).where(User.user_uuid == user_id_str)
    user = (await db_session.execute(statement)).scalars().first()

    if not user:
        raise HTTPException(
            status_code=404,
            detail="User not found",
        )

    # SECURITY: a user may only join an organization as themselves. Without this
    # check, any authenticated caller could pass an arbitrary user_id in the
    # request body and force-join (or, in inviteOnly orgs, force-attach to a
    # usergroup) any other account: an IDOR / privilege-escalation flaw.
    if isinstance(current_user, AnonymousUser) or str(user.id) != str(current_user.id):
        raise HTTPException(
            status_code=403,
            detail="You can only join an organization as yourself.",
        )

    # Check if user's email is verified
    if not user.email_verified:
        raise HTTPException(
            status_code=403,
            detail="Please verify your email address before joining an organization.",
        )

    # Check if User isn't already part of the org
    statement = select(UserOrganization).where(
        UserOrganization.user_id == user.id, UserOrganization.org_id == args.org_id
    )
    userorg = (await db_session.execute(statement)).scalars().first()

    if userorg:
        raise HTTPException(
            status_code=400, detail="User is already part of that organization"
        )

    if join_method == "inviteOnly" and user and org and args.invite_code:
        if user.id is not None and org.id is not None:

            # Check if invite code exists
            inviteCode = await get_invite_code(
                request, org.id, args.invite_code, current_user, db_session
            )

            if not inviteCode:
                raise HTTPException(
                    status_code=400,
                    detail="Invite code is incorrect",
                )

            from src.services.orgs.invitations.apply import (
                apply_invite_code,
                claim_code_for_join,
                close_pending_invitations,
            )

            # Count the code's use first, in the same commit as the
            # membership: a capped code can't let one more person in.
            claimed = await claim_code_for_join(db_session, inviteCode)

            # Link user and organization
            user_organization = UserOrganization(
                user_id=user.id,
                org_id=org.id,
                role_id=4,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )

            db_session.add(user_organization)
            await db_session.commit()
            await close_pending_invitations(request, db_session, org.id, user.email, actor=user, owner_proven=_inbox_proven(user))

            await increase_feature_usage("members", org.id, db_session)

            from src.routers.users import _invalidate_session_cache
            _invalidate_session_cache(user.id)

            await track(
                event_name=analytics_events.USER_JOINED_ORG,
                org_id=org.id,
                user_id=user.id,
                properties={"join_method": "invite_code"},
            )
            await notify_user_joined_org(request, db_session, user, org.id, org=org)

            # Apply the code's role, user groups and courses (a Redis code:
            # its user group).
            await apply_invite_code(request, db_session, user, org, inviteCode, claimed=claimed)

            return "Great, You're part of the Organization"

        else:  # pragma: no cover - org.id is checked above and a loaded user always has an id
            raise HTTPException(
                status_code=403,
                detail="Something wrong, try later.",
            )

    if join_method == "open" and user and org:
        if user.id is not None and org.id is not None:
            # An invitation waiting for this (proven) address: joining
            # accepts it, so the person arrives with its role, groups and
            # courses.
            if await _join_with_invitation(request, db_session, user, org):
                return "Great, You're part of the Organization"

            # Link user and organization
            user_organization = UserOrganization(
                user_id=user.id,
                org_id=org.id,
                role_id=4,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )

            db_session.add(user_organization)
            await db_session.commit()

            from src.routers.users import _invalidate_session_cache
            _invalidate_session_cache(user.id)

            await increase_feature_usage("members", org.id, db_session)

            await track(
                event_name=analytics_events.USER_JOINED_ORG,
                org_id=org.id,
                user_id=user.id,
                properties={"join_method": "open"},
            )
            await notify_user_joined_org(request, db_session, user, org.id, org=org)
            await _after_open_join(request, db_session, user, org, args.invite_code, current_user)

            return "Great, You're part of the Organization"

        else:  # pragma: no cover - org.id is checked above and a loaded user always has an id
            raise HTTPException(
                status_code=403,
                detail="Something wrong, try later.",
            )

    else:
        raise HTTPException(
            status_code=403,
            detail="Something wrong, try later.",
        )


async def _join_with_invitation(request: Request, db_session: AsyncSession, user: User, org: Organization) -> bool:
    """Join an open org by accepting the invitation for the user's address,
    when the inbox is proven. True when that made them a member."""
    from src.services.orgs.invitations.apply import accept_invitation, find_pending_invitation
    from src.services.users.users import inbox_proven

    if not inbox_proven(user):
        return False
    inv = await find_pending_invitation(db_session, user.email, org.id)
    if inv is None:
        return False
    try:
        await accept_invitation(request, db_session, user, org, inv, via="open_join")
    except HTTPException:
        return False
    return True


async def _after_open_join(request: Request, db_session: AsyncSession, user: User, org: Organization, invite_code: Optional[str], current_user) -> None:
    """After a plain open join: close invitations left for the address (it
    joined another way), then apply an invite code the person came through."""
    from src.services.orgs.invitations.apply import apply_invite_code, close_pending_invitations

    await close_pending_invitations(request, db_session, org.id, user.email, actor=user, owner_proven=_inbox_proven(user))
    if invite_code:
        try:
            code_data = await get_invite_code(request, org.id, invite_code, current_user, db_session)
        except HTTPException:
            return
        await apply_invite_code(request, db_session, user, org, code_data)


def _inbox_proven(user) -> bool:
    from src.services.users.users import inbox_proven

    return inbox_proven(user)
