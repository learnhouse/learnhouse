"""Invitations waiting for a signed-in user, and accepting them.

An admin who invites someone by email stores ``invited_user:{email}:org:{uuid}``
in Redis. Signing up through the invite consumes it, but someone who already
had an account, or who signed up on the platform's own page, had no way to
accept: an invite-only org refuses a join without a code. These endpoints let
the hub list the invitations addressed to the user's verified email and join
the org in one click, so an invited person never has to create an org.

Invitations are database records now (``org_invitation``): accepting one
applies its role, groups and courses (``orgs.invitations.apply``). Redis
invitations sent before that are still listed and honoured until they expire.
"""

import json
import logging
import re
from typing import Any, Optional

from fastapi import HTTPException, Request
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.organizations import Organization
from src.db.user_organizations import UserOrganization
from src.db.users import InternalUser, User

logger = logging.getLogger(__name__)

USER_ROLE_ID = 4


def _redis():
    from src.core.redis import get_redis_client

    return get_redis_client()


def _decode(raw: Any) -> str:
    return raw.decode() if isinstance(raw, bytes) else str(raw)


def _invite_key(email: str, org_uuid: str) -> str:
    return f"invited_user:{email.strip().lower()}:org:{org_uuid}"


async def _user(db_session: AsyncSession, user_id: int) -> User:
    user = (await db_session.execute(select(User).where(User.id == user_id))).scalars().first()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user


def _pending_records(email: str) -> dict[str, dict]:
    """org_uuid → invite record, for every pending invite to ``email``."""
    r = _redis()
    if r is None or not email:
        return {}
    prefix = f"invited_user:{email.strip().lower()}:org:"
    found: dict[str, dict] = {}
    try:
        # The address is literal: * ? [ ] in it must not match other
        # people's records.
        for key in r.scan_iter(match=_glob_escape(prefix) + "*", count=200):
            name = _decode(key)
            raw = r.get(name)
            if not raw:
                continue
            record = json.loads(raw)
            if record.get("pending", True):
                found[name[len(prefix):]] = record
    except Exception:
        logger.warning("Could not read pending invitations", exc_info=True)
        return {}
    return found


def _glob_escape(value: str) -> str:
    """``value`` as a literal inside a Redis SCAN MATCH pattern."""
    return re.sub(r"([*?\[\]\\])", r"\\\1", value)


VERIFY_FIRST = "Please verify your email address first."


def _require_verified(user: User) -> None:
    """Invitations are addressed to an email: only its verified owner may see,
    accept or decline them. Anyone can sign up with someone else's address;
    until they prove they own it, they must not learn which orgs invited it
    (an information leak) or decline those invitations (denying the real
    invitee)."""
    from src.services.users.users import inbox_proven

    # A self-hosted signup counts as verified before anything proved the
    # inbox: that is not enough either.
    if not inbox_proven(user):
        raise HTTPException(status_code=403, detail=VERIFY_FIRST)


async def _db_pending(db_session: AsyncSession, email: str) -> dict[int, Any]:
    """org_id → newest usable database invitation for ``email``."""
    from src.db.org_invitations import InvitationStatus, OrgInvitation
    from src.services.orgs.invitations.policy import normalize_email, utcnow

    rows = (await db_session.execute(
        select(OrgInvitation)
        .where(
            OrgInvitation.email == normalize_email(email),
            OrgInvitation.status == InvitationStatus.PENDING.value,
            OrgInvitation.expires_at > utcnow(),
        )
        .order_by(OrgInvitation.id)  # type: ignore[arg-type]
    )).scalars().all()
    return {inv.org_id: inv for inv in rows}


async def _invite_details(db_session: AsyncSession, inv) -> dict:
    from src.db.roles import Role
    from src.services.orgs.invitations.policy import iso, role_for_grant

    role: Optional[Role] = await role_for_grant(db_session, inv.org_id, inv.role_id)
    inviter = await db_session.get(User, inv.invited_by_user_id) if inv.invited_by_user_id else None
    inviter_name = None
    if inviter is not None:
        inviter_name = " ".join(p for p in (inviter.first_name, inviter.last_name) if p).strip() or inviter.username
    return {
        "invited_at": iso(inv.created_at),
        "expires_at": iso(inv.expires_at),
        "role": role.name if role else None,
        "role_uuid": role.role_uuid if role else None,
        "invited_by": inviter_name,
        "message": inv.message,
        "courses": len(inv.course_uuids or []),
        "usergroups": len(inv.usergroup_ids or []),
    }


async def list_pending_invites(db_session: AsyncSession, user_id: int) -> list[dict]:
    from src.services.users.users import inbox_proven

    user = await _user(db_session, user_id)
    if not inbox_proven(user):
        return []
    db_invites = await _db_pending(db_session, user.email)
    records = _pending_records(user.email)
    if not records and not db_invites:
        return []
    orgs = (await db_session.execute(
        select(Organization).where(
            Organization.org_uuid.in_(list(records)) | Organization.id.in_(list(db_invites))  # type: ignore[attr-defined]
        )
    )).scalars().all()
    member_of = set((await db_session.execute(
        select(UserOrganization.org_id).where(UserOrganization.user_id == user_id)
    )).scalars().all())
    out = []
    for org in orgs:
        # A member still sees an invitation that would give them more (its
        # role, groups or courses); an older Redis one adds nothing to them.
        if org.is_demo or (org.id in member_of and org.id not in db_invites):
            continue
        row = {
            "org_uuid": org.org_uuid,
            "org_id": org.id,
            "name": org.name,
            "slug": org.slug,
            "logo_image": org.logo_image,
            "already_member": org.id in member_of,
        }
        if org.id in db_invites:
            row.update(await _invite_details(db_session, db_invites[org.id]))
        else:
            row["invited_at"] = records[org.org_uuid].get("created_at")
        out.append(row)
    out.sort(key=lambda o: o["invited_at"] or "", reverse=True)
    return out


async def _org_by_uuid(db_session: AsyncSession, org_uuid: str) -> Organization:
    org = (await db_session.execute(select(Organization).where(Organization.org_uuid == org_uuid))).scalars().first()
    if org is None:
        raise HTTPException(status_code=404, detail="Organization not found")
    return org


def _invite_usergroup(r, record: dict, org_uuid: str) -> Optional[int]:
    code_uuid = record.get("invite_code_uuid")
    if not code_uuid:
        return None
    for key in r.scan_iter(match=f"{code_uuid}:org:{org_uuid}:code:*", count=50):
        raw = r.get(_decode(key))
        if raw:
            group = json.loads(raw).get("usergroup_id")
            return int(group) if group else None
    return None


async def join_from_invite(request: Request, db_session: AsyncSession, user: User, org: Organization, join_method: str) -> bool:
    """Make ``user`` a member of ``org`` because they were invited: seat check,
    membership, usage, analytics and the admins' "someone joined" notice.
    False when they turned out to be a member already (a concurrent join)."""
    from src.routers.users import _invalidate_session_cache
    from src.security.features_utils.usage import increase_feature_usage
    from src.services.analytics import events as analytics_events
    from src.services.analytics.analytics import track
    from src.services.orgs.invitations.apply import check_room_for_invitee, stage_membership
    from src.services.orgs.join_notifications import notify_user_joined_org

    await check_room_for_invitee(org.id, db_session)
    if await stage_membership(db_session, user.id, org.id, USER_ROLE_ID) is None:
        return False
    await db_session.commit()
    # Joined through an older invitation: newer ones for the address close.
    from src.services.orgs.invitations.apply import close_pending_invitations

    await close_pending_invitations(request, db_session, org.id, user.email, actor=user, owner_proven=_inbox_proven(user))
    await increase_feature_usage("members", org.id, db_session)
    _invalidate_session_cache(user.id)
    await track(
        event_name=analytics_events.USER_JOINED_ORG,
        org_id=org.id,
        user_id=user.id,
        properties={"join_method": join_method},
    )
    await notify_user_joined_org(request, db_session, user, org.id, org=org)
    return True


async def accept_invite(request: Request, db_session: AsyncSession, user_id: int, org_uuid: str) -> dict:
    from src.services.orgs.invitations.apply import accept_invitation, find_pending_invitation

    user = await _user(db_session, user_id)
    _require_verified(user)
    org = await _org_by_uuid(db_session, org_uuid)
    inv = await find_pending_invitation(db_session, user.email, org.id)
    if inv is not None and not org.is_demo:
        joined = await accept_invitation(request, db_session, user, org, inv, via="email_invite")
        return {"org_id": org.id, "slug": org.slug, "name": org.name, "role": joined["role"]}
    r = _redis()
    if r is None:
        raise HTTPException(status_code=503, detail="Could not check your invitation right now, please try again.")
    key = _invite_key(user.email, org.org_uuid)
    raw = r.get(key)
    record = json.loads(raw) if raw else None
    if not record or not record.get("pending", True):
        raise HTTPException(status_code=404, detail="This invitation is no longer valid")
    already = (await db_session.execute(
        select(UserOrganization).where(UserOrganization.user_id == user.id, UserOrganization.org_id == org.id)
    )).scalars().first()
    if already is not None:
        raise HTTPException(status_code=400, detail="You are already a member of this organization")

    await accept_legacy_invite(request, db_session, user, org, key, record, join_method="email_invite")
    return {"org_id": org.id, "slug": org.slug, "name": org.name}


async def accept_legacy_invite(
    request: Optional[Request],
    db_session: AsyncSession,
    user: User,
    org: Organization,
    key: str,
    record: dict,
    *,
    join_method: str,
    joined_now: bool = False,
) -> bool:
    """Apply a pending Redis invitation: membership as a plain member (unless
    they already belong), the user group of the invite code it carried, and
    the record marked answered. ``joined_now``: the membership was created
    moments ago for this arrival, so the group still applies. True when this
    made them a member."""
    from src.services.orgs.invitations.apply import consume_legacy_invite

    member = (await db_session.execute(
        select(UserOrganization.id).where(UserOrganization.user_id == user.id, UserOrganization.org_id == org.id)
    )).first()
    joined = member is None and await join_from_invite(request, db_session, user, org, join_method=join_method)
    if joined or joined_now:
        await _add_legacy_group(request, db_session, user, org, record)
    consume_legacy_invite(key, record)
    return joined


async def _add_legacy_group(request: Optional[Request], db_session: AsyncSession, user: User, org: Organization, record: dict) -> None:
    r = _redis()
    if r is None:
        return
    try:
        group_id = _invite_usergroup(r, record, org.org_uuid)
    except Exception:
        logger.warning("Could not read the invite group for org %s", org.id, exc_info=True)
        return
    if not group_id:
        return
    from src.services.users.usergroups import add_users_to_usergroup

    try:
        await add_users_to_usergroup(request, db_session, InternalUser(id=0), group_id, str(user.id))
    except HTTPException:
        logger.warning("Invited user %s joined org %s but not group %s", user.id, org.id, group_id)


async def apply_all_pending_invites(
    request: Optional[Request],
    db_session: AsyncSession,
    user: User,
    *,
    via: str,
    joined_org_id: Optional[int] = None,
) -> list[int]:
    """The inbox was just proven (a verification email, an emailed link):
    every invitation waiting for the address is accepted, database ones with
    their role (never a demotion), groups and courses, older Redis ones as a
    plain member with their group. ``joined_org_id``: the org whose membership
    was created moments ago for this arrival (its placeholder role is
    replaced). Returns the org ids. Never raises."""
    from src.services.orgs.invitations.apply import accept_invitation
    from src.services.users.users import inbox_proven

    if not inbox_proven(user):
        return []
    user_id = user.id
    applied: list[int] = []
    try:
        db_invites = await _db_pending(db_session, user.email)
        records = _pending_records(user.email)
        legacy_orgs = list((await db_session.execute(
            select(Organization).where(Organization.org_uuid.in_(list(records)))  # type: ignore[attr-defined]
        )).scalars().all()) if records else []
    except Exception:
        logger.warning("Could not list the invitations for user %s", user.id, exc_info=True)
        return []
    for org_id, inv in db_invites.items():
        org = await db_session.get(Organization, org_id)
        if org is None or org.is_demo:
            continue
        # Read before: a failed acceptance rolls back (and expires) the row.
        invitation_uuid = inv.invitation_uuid
        try:
            await accept_invitation(
                request, db_session, user, org, inv, via=via, ownership_proven=True,
                joined_now=org_id == joined_org_id,
            )
            applied.append(org_id)
        except Exception:
            logger.warning("Could not accept invitation %s for user %s", invitation_uuid, user_id, exc_info=True)
    for org in legacy_orgs:
        if org.id in db_invites or org.is_demo:
            continue
        try:
            await accept_legacy_invite(
                request, db_session, user, org, _invite_key(user.email, org.org_uuid), records[org.org_uuid],
                join_method=via, joined_now=org.id == joined_org_id,
            )
            applied.append(org.id)
        except Exception:
            logger.warning("Could not accept the legacy invitation to org %s for user %s", org.id, user_id, exc_info=True)
    return applied


async def decline_invite(db_session: AsyncSession, user_id: int, org_uuid: str, request: Optional[Request] = None) -> dict:
    from src.core.ee_hooks import audit_event
    from src.db.org_invitations import InvitationStatus
    from src.services.orgs.invitations.apply import find_pending_invitation
    from src.services.orgs.invitations.policy import utcnow

    user = await _user(db_session, user_id)
    _require_verified(user)
    org = await _org_by_uuid(db_session, org_uuid)
    inv = await find_pending_invitation(db_session, user.email, org.id)
    if inv is not None:
        # Only while still pending: one accepted meanwhile stays accepted.
        from src.services.orgs.invitations.service import _transition

        await _transition(
            db_session, inv, (InvitationStatus.PENDING.value,), "This invitation is no longer valid",
            status=InvitationStatus.DECLINED.value, updated_at=utcnow(),
        )
        await db_session.commit()
        audit_event(
            request, action="members.invitation.declined", org_id=org.id, actor=user,
            target_type="invitation", target_id=inv.invitation_uuid, target_name=inv.email,
        )
        return {"org_id": org.id, "declined": True}
    r = _redis()
    if r is None:
        raise HTTPException(status_code=503, detail="Could not update your invitation right now, please try again.")
    key = _invite_key(user.email, org.org_uuid)
    if not r.get(key):
        raise HTTPException(status_code=404, detail="This invitation is no longer valid")
    r.delete(key)
    return {"org_id": org.id, "declined": True}


def _inbox_proven(user) -> bool:
    from src.services.users.users import inbox_proven

    return inbox_proven(user)
