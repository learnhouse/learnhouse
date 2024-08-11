from datetime import datetime
from typing import Optional
from fastapi import HTTPException, Request
from pydantic import BaseModel
from sqlmodel import Session, select
from src.db.organizations import Organization
from src.db.user_organizations import UserOrganization
from src.db.users import AnonymousUser, PublicUser, User
from src.security.features_utils.usage import (
    check_limits_with_usage,
    increase_feature_usage,
)
from src.services.orgs.invites import get_invite_code
from src.services.orgs.orgs import get_org_join_mechanism


class JoinOrg(BaseModel):
    org_id: int
    user_id: str
    invite_code: Optional[str]


async def join_org(
    request: Request,
    args: JoinOrg,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    statement = select(Organization).where(Organization.id == args.org_id)
    result = db_session.exec(statement)

    org = result.first()

    if not org or org.id is None:
        raise HTTPException(
            status_code=404,
            detail="Organization not found",
        )

    check_limits_with_usage("members", org.id, db_session)

    join_method = await get_org_join_mechanism(
        request, args.org_id, current_user, db_session
    )

    # Get User
    statement = select(User).where(User.id == args.user_id)
    result = db_session.exec(statement)

    user = result.first()

    # Check if User isn't already part of the org
    statement = select(UserOrganization).where(
        UserOrganization.user_id == args.user_id, UserOrganization.org_id == args.org_id
    )
    result = db_session.exec(statement)

    userorg = result.first()

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

            # Link user and organization
            user_organization = UserOrganization(
                user_id=user.id,
                org_id=org.id,
                role_id=3,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )

            db_session.add(user_organization)
            db_session.commit()

            return "Great, You're part of the Organization"

        else:
            raise HTTPException(
                status_code=403,
                detail="Something wrong, try later.",
            )

    if join_method == "open" and user and org:
        if user.id is not None and org.id is not None:
            # Link user and organization
            user_organization = UserOrganization(
                user_id=user.id,
                org_id=org.id,
                role_id=3,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )

            db_session.add(user_organization)
            db_session.commit()

            increase_feature_usage("members", org.id, db_session)

            return "Great, You're part of the Organization"

        else:
            raise HTTPException(
                status_code=403,
                detail="Something wrong, try later.",
            )

    else:
        raise HTTPException(
            status_code=403,
            detail="Something wrong, try later.",
        )
