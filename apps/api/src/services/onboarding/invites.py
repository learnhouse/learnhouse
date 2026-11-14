"""Invitations waiting for a signed-in user, and accepting them.

An admin who invites someone by email stores ``invited_user:{email}:org:{uuid}``
in Redis. Signing up through the invite consumes it, but someone who already
had an account, or who signed up on the platform's own page, had no way to
accept: an invite-only org refuses a join without a code. These endpoints let
the hub list the invitations addressed to the user's verified email and join
the org in one click, so an invited person never has to create an org.
"""

import json
import logging
from datetime import datetime
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
        for key in r.scan_iter(match=prefix + "*", count=200):
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


VERIFY_FIRST = "Please verify your email address first."


def _require_verified(user: User) -> None:
    """Invitations are addressed to an email: only its verified owner may see,
    accept or decline them. Anyone can sign up with someone else's address;
    until they prove they own it, they must not learn which orgs invited it
    (an information leak) or decline those invitations (denying the real
    invitee)."""
    if not user.email_verified:
        raise HTTPException(status_code=403, detail=VERIFY_FIRST)


async def list_pending_invites(db_session: AsyncSession, user_id: int) -> list[dict]:
    user = await _user(db_session, user_id)
    if not user.email_verified:
        return []
    records = _pending_records(user.email)
    if not records:
        return []
    orgs = (await db_session.execute(select(Organization).where(Organization.org_uuid.in_(list(records))))).scalars().all()
    member_of = set((await db_session.execute(
        select(UserOrganization.org_id).where(UserOrganization.user_id == user_id)
    )).scalars().all())
    out = []
    for org in orgs:
        if org.id in member_of or org.is_demo:
            continue
        rec = records[org.org_uuid]
        out.append({
            "org_uuid": org.org_uuid,
            "org_id": org.id,
            "name": org.name,
            "slug": org.slug,
            "logo_image": org.logo_image,
            "invited_at": rec.get("created_at"),
        })
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


async def accept_invite(request: Request, db_session: AsyncSession, user_id: int, org_uuid: str) -> dict:
    from src.routers.users import _invalidate_session_cache
    from src.security.features_utils.usage import check_limits_with_usage, increase_feature_usage
    from src.services.analytics import events as analytics_events
    from src.services.analytics.analytics import track
    from src.services.orgs.join_notifications import notify_user_joined_org

    user = await _user(db_session, user_id)
    _require_verified(user)
    org = await _org_by_uuid(db_session, org_uuid)
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

    await check_limits_with_usage("members", org.id, db_session)
    db_session.add(UserOrganization(
        user_id=user.id, org_id=org.id, role_id=USER_ROLE_ID,
        creation_date=str(datetime.now()), update_date=str(datetime.now()),
    ))
    await db_session.commit()
    await increase_feature_usage("members", org.id, db_session)
    _invalidate_session_cache(user.id)

    group_id = _invite_usergroup(r, record, org.org_uuid)
    ttl = r.ttl(key)
    r.set(key, json.dumps({**record, "pending": False}), ex=ttl if ttl and ttl > 0 else None)
    if group_id:
        from src.services.users.usergroups import add_users_to_usergroup

        try:
            await add_users_to_usergroup(request, db_session, InternalUser(id=0), group_id, str(user.id))
        except HTTPException:
            logger.warning("Invited user %s joined org %s but not group %s", user.id, org.id, group_id)

    await track(
        event_name=analytics_events.USER_JOINED_ORG,
        org_id=org.id,
        user_id=user.id,
        properties={"join_method": "email_invite"},
    )
    await notify_user_joined_org(request, db_session, user, org.id, org=org)
    return {"org_id": org.id, "slug": org.slug, "name": org.name}


async def decline_invite(db_session: AsyncSession, user_id: int, org_uuid: str) -> dict:
    user = await _user(db_session, user_id)
    _require_verified(user)
    org = await _org_by_uuid(db_session, org_uuid)
    r = _redis()
    if r is None:
        raise HTTPException(status_code=503, detail="Could not update your invitation right now, please try again.")
    key = _invite_key(user.email, org.org_uuid)
    if not r.get(key):
        raise HTTPException(status_code=404, detail="This invitation is no longer valid")
    r.delete(key)
    return {"org_id": org.id, "declined": True}
