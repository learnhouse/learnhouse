"""What happens when someone arrives through an invitation or an invite code.

``accept_invitation`` is the single path for every way an invited person can
show up: the personal link (new account or sign in), the hub's pending list
and Google sign-in with the invited address. The claim on the invitation, the
membership with the chosen role, the user groups and the course enrollments
go in one commit; analytics, the audit log, webhooks and the inviter's
notification follow once it is in.

``apply_invite_code`` does the same for a shareable invite code, after the
caller has made the person a member.
"""

import contextlib
import logging
from datetime import datetime
from typing import Iterable, Optional

from fastapi import HTTPException, Request
from sqlalchemy import func, update
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.ee_hooks import audit_event
from src.db.courses.courses import Course
from src.db.org_invitations import InvitationStatus, OrgInvitation, OrgInviteCode
from src.db.organizations import Organization
from src.db.roles import Role
from src.db.trail_runs import TrailRun
from src.db.user_organizations import UserOrganization
from src.db.usergroup_user import UserGroupUser
from src.db.usergroups import UserGroup
from src.db.users import User
from src.security.rbac.constants import ADMIN_ROLE_ID
from src.services.orgs.invitations.policy import (
    INVALID_INVITATION,
    USER_ROLE_ID,
    code_role_allowed,
    hash_token,
    normalize_email,
    role_for_grant,
    utcnow,
)

logger = logging.getLogger(__name__)

USERS_PATH = "/dash/users/settings/users"


async def find_pending_invitation(db_session: AsyncSession, email: Optional[str], org_id: int) -> Optional[OrgInvitation]:
    """The newest usable invitation for this address in this org."""
    email = normalize_email(email or "")
    if not email:
        return None
    return (await db_session.execute(
        select(OrgInvitation)
        .where(
            OrgInvitation.org_id == org_id,
            OrgInvitation.email == email,
            OrgInvitation.status == InvitationStatus.PENDING.value,
            OrgInvitation.expires_at > utcnow(),
        )
        .order_by(OrgInvitation.id.desc())  # type: ignore[union-attr]
    )).scalars().first()


async def invitation_by_token(db_session: AsyncSession, token: str) -> Optional[OrgInvitation]:
    """The invitation a personal link token belongs to, whatever its state:
    the emailed link or the one an admin copied."""
    digest = hash_token(token)
    return (await db_session.execute(
        select(OrgInvitation).where(
            (OrgInvitation.token_hash == digest) | (OrgInvitation.copy_token_hash == digest)  # type: ignore[operator]
        )
    )).scalars().first()


def token_emailed(inv: OrgInvitation, token: str) -> bool:
    """Whether ``token`` is the link mailed to the invited address (proof of
    the inbox), not one an admin copied to share by hand."""
    return inv.token_hash == hash_token(token) and inv.token_delivery == "email"


# ---------------------------------------------------------------------------
# Invitations sent before they moved to the database (Redis, until they
# expire): ``invited_user:{email}:org:{org_uuid}``, joining as a plain member
# plus the user group of the invite code the email carried.
# ---------------------------------------------------------------------------


def legacy_invite_key(email: Optional[str], org_uuid: str) -> str:
    return f"invited_user:{normalize_email(email or '')}:org:{org_uuid}"


def find_legacy_invite(email: Optional[str], org: Organization) -> Optional[tuple[str, dict]]:
    """(key, record) of the pending Redis invitation for this address in this
    org. A record without ``pending`` counts as pending. None without Redis."""
    import json

    from src.core.redis import get_redis_client

    if not normalize_email(email or ""):
        return None
    r = get_redis_client()
    if r is None:
        return None
    key = legacy_invite_key(email, org.org_uuid)
    try:
        raw = r.get(key)
        record = json.loads(raw) if raw else None
    except Exception:
        logger.warning("Could not read the legacy invitation for org %s", org.id, exc_info=True)
        return None
    if not isinstance(record, dict) or not record.get("pending", True):
        return None
    return key, record


def consume_legacy_invite(key: str, record: dict) -> None:
    """Mark a Redis invitation answered, keeping its TTL. Never raises."""
    import json

    from src.core.redis import get_redis_client

    r = get_redis_client()
    if r is None:
        return
    try:
        ttl = r.ttl(key)
        r.set(key, json.dumps({**record, "pending": False}), ex=ttl if ttl and ttl > 0 else None)
    except Exception:
        logger.warning("Could not mark the legacy invitation %s answered", key, exc_info=True)


async def has_pending_invite(db_session: AsyncSession, email: Optional[str], org: Organization) -> bool:
    """A usable invitation for this address in this org, database or Redis."""
    if await find_pending_invitation(db_session, email, org.id) is not None:
        return True
    return find_legacy_invite(email, org) is not None


# The member cap refusal as the invitee reads it: the admin's wording says
# "upgrade", which only the admin can do. Same code; ``invitee`` lets the page
# tell the two apart.
INVITEE_ORG_FULL = {
    "code": "MEMBER_LIMIT_REACHED",
    "invitee": True,
    "message": "This organization is full right now. Ask its admin to make room.",
}


def invitee_limit_refusal(exc: HTTPException) -> HTTPException:
    """``exc`` in the invitee's words when it is the member cap, else as is."""
    if exc.status_code == 403 and str(exc.detail).startswith("Usage Limit has been reached"):
        return HTTPException(status_code=403, detail=INVITEE_ORG_FULL)
    return exc


async def check_room_for_invitee(org_id: int, db_session: AsyncSession) -> None:
    """The plan's member cap, for someone joining through an invitation."""
    from src.security.features_utils.usage import check_limits_with_usage

    try:
        await check_limits_with_usage("members", org_id, db_session)
    except HTTPException as exc:
        refusal = invitee_limit_refusal(exc)
        if refusal is exc:
            raise
        raise refusal from exc


async def stage_membership(db_session: AsyncSession, user_id: int, org_id: int, role_id: int) -> Optional[UserOrganization]:
    """Add the membership in a savepoint, staged for the caller's commit. None
    when one already exists (a concurrent join won the unique (user, org)
    index); the caller's own transaction carries on either way."""
    from sqlalchemy.exc import IntegrityError

    now = str(datetime.now())
    membership = UserOrganization(user_id=user_id, org_id=org_id, role_id=role_id, creation_date=now, update_date=now)
    try:
        async with db_session.begin_nested():
            db_session.add(membership)
    except IntegrityError:
        return None
    return membership


async def _grant_groups(
    db_session: AsyncSession, org_id: int, user_id: int, group_ids: Iterable, source: str, added_by: Optional[int]
) -> list[UserGroup]:
    """Add the member to these groups (still in this org), staged on the session."""
    ids = [int(g) for g in group_ids or [] if str(g).isdigit()]
    if not ids:
        return []
    groups = list((await db_session.execute(
        select(UserGroup).where(UserGroup.id.in_(ids), UserGroup.org_id == org_id)  # type: ignore[attr-defined]
    )).scalars().all())
    existing = set((await db_session.execute(
        select(UserGroupUser.usergroup_id).where(
            UserGroupUser.user_id == user_id,
            UserGroupUser.usergroup_id.in_([g.id for g in groups]),  # type: ignore[attr-defined]
        )
    )).scalars().all())
    now = str(datetime.now())
    added = []
    for group in groups:
        if group.id in existing:
            continue
        db_session.add(UserGroupUser(
            usergroup_id=group.id, user_id=user_id, org_id=org_id,
            creation_date=now, update_date=now, sources=[source], added_by_id=added_by,
        ))
        added.append(group)
    return added


async def _grant_courses(db_session: AsyncSession, org_id: int, user_id: int, course_uuids: Iterable) -> list[Course]:
    """Enroll the member (a trail run per course still in this org), staged."""
    uuids = [str(u) for u in course_uuids or [] if u]
    if not uuids:
        return []
    courses = list((await db_session.execute(
        select(Course).where(Course.course_uuid.in_(uuids), Course.org_id == org_id)  # type: ignore[attr-defined]
    )).scalars().all())
    if not courses:
        return []
    enrolled = set((await db_session.execute(
        select(TrailRun.course_id).where(
            TrailRun.user_id == user_id,
            TrailRun.org_id == org_id,
            TrailRun.course_id.in_([c.id for c in courses]),  # type: ignore[attr-defined]
        )
    )).scalars().all())
    todo = [c for c in courses if c.id not in enrolled]
    if not todo:
        return []
    now = str(datetime.now())
    from src.services.trail.trail import get_or_create_trail

    trail = await get_or_create_trail(db_session, org_id, user_id, commit=False)
    for course in todo:
        db_session.add(TrailRun(
            trail_id=trail.id, course_id=course.id, org_id=org_id, user_id=user_id,
            creation_date=now, update_date=now,
        ))
    return todo


async def _after_grants(
    request: Optional[Request],
    db_session: AsyncSession,
    org: Organization,
    user: User,
    groups: list[UserGroup],
    courses: list[Course],
    source: str,
) -> None:
    """Side effects once the grants are committed: enrollment analytics and
    the group webhooks. Never raises."""
    from src.services.analytics import events as analytics_events
    from src.services.analytics.analytics import track
    from src.services.webhooks.dispatch import dispatch_webhooks

    try:
        for course in courses:
            await track(
                event_name=analytics_events.COURSE_ENROLLED,
                org_id=org.id,
                user_id=user.id,
                properties={"course_uuid": course.course_uuid, "source": source},
            )
        for group in groups:
            await dispatch_webhooks(
                event_name="usergroup_users_added",
                org_id=org.id,
                data={"usergroup_id": group.id, "usergroup_uuid": group.usergroup_uuid, "user_ids": [user.id]},
            )
    except Exception:
        logger.warning("Post-join side effects failed for user %s in org %s", user.id, org.id, exc_info=True)


async def notify_inviter(db_session: AsyncSession, inv: OrgInvitation, user: User) -> None:
    """"Lea accepted your invitation", to whoever sent it, while still a member."""
    from src.services.notifications.emit import emit
    from src.services.notifications.events import _name

    if not inv.invited_by_user_id or inv.invited_by_user_id == user.id:
        return
    still_member = (await db_session.execute(
        select(UserOrganization.id).where(
            UserOrganization.user_id == inv.invited_by_user_id, UserOrganization.org_id == inv.org_id
        )
    )).first()
    if still_member is None:
        return
    actor = _name(user)
    await emit(
        db_session, "invitation_accepted", [inv.invited_by_user_id],
        org_id=inv.org_id,
        title="Invitation accepted",
        body=f"{actor} accepted your invitation",
        params={"actor": actor},
        path=USERS_PATH,
        data={"user_uuid": user.user_uuid, "invitation_uuid": inv.invitation_uuid},
        actor_id=user.id,
    )


async def _role_is_upgrade(db_session: AsyncSession, org_id: int, current_role_id: Optional[int], new_role: Role) -> bool:
    """Moving to ``new_role`` takes no permission away (and an Admin stays
    an Admin). Fails closed: a current role that is missing or belongs to
    another org never makes any role an upgrade (except, for a missing one, a
    role within the built-in User role)."""
    from src.services.orgs.invitations.policy import rights_within

    if current_role_id == ADMIN_ROLE_ID:
        return False
    current = await db_session.get(Role, current_role_id) if current_role_id else None
    if current is None:
        # The member's role is gone: only a role within the built-in User
        # role may fill the gap (an invitation can't hand out more blind).
        user_role = await db_session.get(Role, USER_ROLE_ID)
        return user_role is not None and rights_within(new_role.rights, user_role.rights)
    if current.org_id is not None and current.org_id != org_id:
        return False
    return rights_within(current.rights, new_role.rights)


async def close_pending_invitations(
    request: Optional[Request],
    db_session: AsyncSession,
    org_id: int,
    email: Optional[str],
    actor=None,
    *,
    owner_proven: bool,
) -> int:
    """Someone with this address just became a member another way (an invite
    code, an open join, a signup, an admin adding them): their pending
    invitations to the org are closed, so an old link or a later automatic
    path can't change the role they joined with. Returns how many.

    ``owner_proven`` is False when the new member hasn't proven they own the
    address: anyone can sign up with an invited address, so closing the
    invitation then would let them cancel the real person's invite. It stays
    pending; explicit acceptance only ever upgrades a role. Required, so every
    caller says which case it is."""
    if not owner_proven:
        return 0
    email = normalize_email(email or "")
    if not email:
        return 0
    rows = (await db_session.execute(
        select(OrgInvitation).where(
            OrgInvitation.org_id == org_id,
            OrgInvitation.email == email,
            OrgInvitation.status == InvitationStatus.PENDING.value,
        )
    )).scalars().all()
    if not rows:
        return 0
    now = utcnow()
    for inv in rows:
        inv.status = InvitationStatus.REVOKED.value
        inv.updated_at = now
        db_session.add(inv)
    await db_session.commit()
    for inv in rows:
        audit_event(
            request, action="members.invitation.closed", org_id=org_id, actor=actor,
            target_type="invitation", target_id=inv.invitation_uuid, target_name=inv.email,
            details={"reason": "joined_another_way"},
        )
    return len(rows)


async def accept_invitation(
    request: Optional[Request],
    db_session: AsyncSession,
    user: User,
    org: Organization,
    inv: OrgInvitation,
    *,
    via: str,
    ownership_proven: bool = False,
    joined_now: bool = False,
    may_change_role: bool = True,
) -> dict:
    """Claim ``inv`` for ``user`` and apply it: membership (created or moved to
    the chosen role), groups and courses, in one commit.

    ``ownership_proven``: the caller proved the inbox (the emailed link, or
    Google vouching for this address); otherwise the account itself must have
    a proven inbox. ``joined_now``: the membership was created moments ago as
    part of this arrival (a signup), so its placeholder role is replaced
    freely. Otherwise an existing member's role only changes when
    ``may_change_role`` (explicit acceptance through the link or the hub, never
    an automatic path) and the new role takes nothing away: an invitation
    never demotes anyone.
    """
    from src.routers.users import _invalidate_session_cache
    from src.security.features_utils.usage import increase_feature_usage
    from src.services.analytics import events as analytics_events
    from src.services.analytics.analytics import track
    from src.services.audit.org_log import role_name
    from src.services.orgs.join_notifications import notify_user_joined_org

    if inv.org_id != org.id or normalize_email(user.email) != inv.email:
        raise HTTPException(status_code=404, detail=INVALID_INVITATION)
    # Matching the address is not proof of owning it: anyone can sign up with
    # an invited address. Only a verified address or the personal link (its
    # token was mailed to that address) proves it.
    from src.services.users.users import inbox_proven

    if not ownership_proven and not inbox_proven(user):
        raise HTTPException(status_code=404, detail=INVALID_INVITATION)

    membership = (await db_session.execute(
        select(UserOrganization).where(UserOrganization.user_id == user.id, UserOrganization.org_id == org.id)
    )).scalars().first()
    created = membership is None
    if created:
        await check_room_for_invitee(org.id, db_session)

    # The claim and every grant in one savepoint: if a grant fails, the claim
    # goes too, so a caller that carries on never commits an accepted
    # invitation with nothing applied.
    try:
        async with db_session.begin_nested():
            now = utcnow()
            claimed = await db_session.execute(
                update(OrgInvitation)
                .where(
                    OrgInvitation.id == inv.id,
                    OrgInvitation.status == InvitationStatus.PENDING.value,
                    OrgInvitation.expires_at > now,
                )
                .values(
                    status=InvitationStatus.ACCEPTED.value,
                    accepted_at=now,
                    accepted_user_id=user.id,
                    updated_at=now,
                )
                # Not "evaluate": SQLite hands back naive datetimes to compare.
                .execution_options(synchronize_session="fetch")
            )
            if claimed.rowcount != 1:
                # Nothing was changed: the savepoint has nothing to undo.
                raise HTTPException(status_code=404, detail=INVALID_INVITATION)
            # Any other invitation still pending for the address here is settled by
            # this one (one invitation per address).
            await db_session.execute(
                update(OrgInvitation)
                .where(
                    OrgInvitation.org_id == org.id,
                    OrgInvitation.email == inv.email,
                    OrgInvitation.status == InvitationStatus.PENDING.value,
                    OrgInvitation.id != inv.id,
                )
                .values(status=InvitationStatus.REVOKED.value, updated_at=now)
                .execution_options(synchronize_session="fetch")
            )

            role: Role = await role_for_grant(db_session, org.id, inv.role_id)
            previous_role_id = membership.role_id if membership is not None else None
            if created:
                staged = await stage_membership(db_session, user.id, org.id, role.id)
                if staged is None:
                    # Joined another way a moment ago: an existing member now.
                    created = False
                    membership = (await db_session.execute(
                        select(UserOrganization).where(UserOrganization.user_id == user.id, UserOrganization.org_id == org.id)
                    )).scalars().first()
                    previous_role_id = membership.role_id
                else:
                    membership = staged
            if not created and membership.role_id != role.id and (
                joined_now or (may_change_role and await _role_is_upgrade(db_session, org.id, membership.role_id, role))
            ):
                membership.role_id = role.id
                membership.update_date = str(datetime.now())
                db_session.add(membership)
            role_applied = membership.role_id == role.id

            groups = await _grant_groups(db_session, org.id, user.id, inv.usergroup_ids, "manual", inv.invited_by_user_id)
            courses = await _grant_courses(db_session, org.id, user.id, inv.course_uuids)
    except Exception:
        # Rolled back: the row in memory must not still read "accepted".
        with contextlib.suppress(Exception):
            await db_session.refresh(inv)
        raise
    await db_session.commit()

    if created:
        await increase_feature_usage("members", org.id, db_session)
        await track(
            event_name=analytics_events.USER_JOINED_ORG,
            org_id=org.id,
            user_id=user.id,
            properties={"join_method": via},
        )
        await notify_user_joined_org(request, db_session, user, org.id, org=org)
    _invalidate_session_cache(user.id)
    await _after_grants(request, db_session, org, user, groups, courses, "invitation")

    audit_event(
        request, action="members.invitation.accepted", org_id=org.id, actor=user,
        target_type="invitation", target_id=inv.invitation_uuid, target_name=inv.email,
        details={"via": via, "joined": created},
    )
    if role_applied and previous_role_id != role.id:
        audit_event(
            request, action="members.invitation.role_applied", org_id=org.id, actor=user,
            target_type="user", target_id=user.user_uuid, target_name=user.username,
            changes={"role": {"from": await role_name(db_session, previous_role_id) if previous_role_id else None, "to": role.name}},
            details={
                "invitation": inv.invitation_uuid,
                "usergroup_ids": [g.id for g in groups],
                "course_uuids": [c.course_uuid for c in courses],
            },
        )
    await notify_inviter(db_session, inv, user)
    return {
        "org_id": org.id,
        "slug": org.slug,
        "name": org.name,
        "role": role.name if role_applied else None,
        "usergroups": len(groups),
        "courses": len(courses),
        "already_member": not created,
    }


async def claim_code_use(db_session: AsyncSession, code_id: int) -> bool:
    """Count one use, atomically, if the code is still live and under its cap."""
    now = utcnow()
    result = await db_session.execute(
        update(OrgInviteCode)
        .where(
            OrgInviteCode.id == code_id,
            OrgInviteCode.revoked_at.is_(None),  # type: ignore[union-attr]
            (OrgInviteCode.max_uses.is_(None)) | (OrgInviteCode.uses < OrgInviteCode.max_uses),  # type: ignore[union-attr,operator]
            (OrgInviteCode.expires_at.is_(None)) | (OrgInviteCode.expires_at > now),  # type: ignore[union-attr,operator]
        )
        .values(uses=OrgInviteCode.uses + 1, updated_at=now)
        .execution_options(synchronize_session="fetch")
    )
    return result.rowcount == 1


CODE_EXHAUSTED = {
    "code": "INVITE_CODE_EXHAUSTED",
    "message": "This invite code has been used up or has expired. Ask for a new one.",
}


async def claim_code_for_join(db_session: AsyncSession, code_data: Optional[dict]) -> bool:
    """Count one use of a database code before the membership is created, in
    the same transaction (the caller's next commit). Raises 403 when the code
    ran out or expired meanwhile, so a capped code never lets one more in.
    False for a Redis code or no code (nothing to count)."""
    if not code_data or code_data.get("source") != "db":
        return False
    if not await claim_code_use(db_session, code_data["id"]):
        raise HTTPException(status_code=403, detail=CODE_EXHAUSTED)
    return True


async def apply_invite_code(
    request: Optional[Request],
    db_session: AsyncSession,
    user: User,
    org: Organization,
    code_data: Optional[dict],
    *,
    claimed: bool = False,
) -> None:
    """Apply an invite code to someone who just joined ``org`` through it.

    A code stored in the database: count the use (unless the caller already
    did, see ``claim_code_for_join``), set its role (only on a
    plain member, and only if the role still has no management rights),
    add the groups and courses, one commit. A legacy Redis code: its user
    group, as before. Never raises: the person is already a member.
    """
    if not code_data:
        return
    try:
        if code_data.get("source") != "db":
            group_id = code_data.get("usergroup_id")
            if group_id:
                from src.db.users import InternalUser
                from src.services.users.usergroups import add_users_to_usergroup

                await add_users_to_usergroup(request, db_session, InternalUser(id=0), int(group_id), str(user.id))
            return

        code = await db_session.get(OrgInviteCode, code_data["id"])
        if code is None or code.org_id != org.id:
            return
        if not claimed and not await claim_code_use(db_session, code.id):
            logger.warning("Invite code %s was used up before user %s joined", code.code_uuid, user.id)
            return
        membership = (await db_session.execute(
            select(UserOrganization).where(UserOrganization.user_id == user.id, UserOrganization.org_id == org.id)
        )).scalars().first()
        role = await role_for_grant(db_session, org.id, code.role_id)
        if not code_role_allowed(role, await db_session.get(Role, USER_ROLE_ID)):
            role = await db_session.get(Role, USER_ROLE_ID)
        role_set = False
        if membership is not None and role is not None and membership.role_id == USER_ROLE_ID and role.id != USER_ROLE_ID:
            membership.role_id = role.id
            membership.update_date = str(datetime.now())
            db_session.add(membership)
            role_set = True
        groups = await _grant_groups(db_session, org.id, user.id, code.usergroup_ids, "code", code.created_by_user_id)
        courses = await _grant_courses(db_session, org.id, user.id, code.course_uuids)
        await db_session.commit()
        if role_set:
            from src.routers.users import _invalidate_session_cache

            _invalidate_session_cache(user.id)
        await _after_grants(request, db_session, org, user, groups, courses, "invite_code")
        audit_event(
            request, action="members.invite_code.used", org_id=org.id, actor=user,
            target_type="invite_code", target_id=code.code_uuid,
            details={
                "role": role.name if role_set and role else None,
                "usergroup_ids": [g.id for g in groups],
                "course_uuids": [c.course_uuid for c in courses],
            },
        )
    except Exception:
        logger.warning("Could not apply invite code for user %s in org %s", user.id, org.id, exc_info=True)


async def has_pending_invitations(db_session: AsyncSession, org_id: int) -> bool:
    count = (await db_session.execute(
        select(func.count()).select_from(OrgInvitation).where(
            OrgInvitation.org_id == org_id,
            OrgInvitation.status == InvitationStatus.PENDING.value,
            OrgInvitation.expires_at > utcnow(),
        )
    )).scalar_one()
    return bool(count)

