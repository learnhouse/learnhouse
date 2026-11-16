"""Personal invitation links: the link in an admin's invitation email.

Each invitation email carries a random, single-use token bound to the invited
address and the org. Opening it lands the person on that org's own signup page
with the address filled in:

- someone new creates their account with just a password (and an optional
  name) and is a member right away. The token was mailed to that address, so
  following it proves the inbox and the account starts verified;
- someone who already has an account signs in on the org's page and joins,
  provided they are signed in as the invited address.

Only a SHA-256 of the token is stored (kept after the invitation closes, so a
used link is recognised and refused). It is refused once used, once the
invitation is withdrawn or answered, once a newer email replaced it, and after
it expires.

Invitations live in the database now (``org_invitation``): joining through
the link applies the role, user groups and courses the admin chose (see
``src.services.orgs.invitations.apply``). Links minted before that, kept in
Redis, still work until they expire.
"""

import hashlib
import json
import logging
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.organizations import Organization
from src.db.user_organizations import UserOrganization
from src.db.users import AnonymousUser, User, UserCreate

logger = logging.getLogger(__name__)

LINK_PREFIX = "invite_link:"
CLAIM_PREFIX = "invite_link_claim:"
# Tokens are secrets.token_urlsafe(32): 43 URL-safe characters.
TOKEN_RE = re.compile(r"[A-Za-z0-9_-]{32,128}")

INVALID = {"code": "INVITE_LINK_INVALID", "message": "This invitation link is no longer valid. Ask for a new invitation."}
EMAIL_MISMATCH = {
    "code": "INVITE_EMAIL_MISMATCH",
    "message": "This invitation was sent to a different email address. Sign in with that address to accept it.",
}
ACCOUNT_EXISTS = {"code": "ACCOUNT_EXISTS", "message": "You already have an account. Sign in to accept the invitation."}
IN_USE = {"code": "INVITE_LINK_IN_USE", "message": "This invitation is being accepted already. Please try again in a moment."}


class TokenBody(BaseModel):
    token: str = Field(min_length=1, max_length=256)


class InviteSignupBody(TokenBody):
    password: str = Field(min_length=1, max_length=256)
    first_name: str = Field(default="", max_length=100)
    last_name: str = Field(default="", max_length=100)
    custom_fields: Optional[dict] = None


def _redis():
    from src.core.redis import get_redis_client

    return get_redis_client()


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _invite_key(email: str, org_uuid: str) -> str:
    return f"invited_user:{email}:org:{org_uuid}"


def create_invite_link(r, email: str, org_id: int, org_uuid: str, invite_code_uuid: Optional[str], ttl: int) -> tuple[str, str]:
    """Mint the link token for one invitation. Returns (token, token hash); the
    hash goes on the invitation record so only the newest link for it works."""
    token = secrets.token_urlsafe(32)
    digest = _hash(token)
    record = {
        "email": email,
        "org_id": org_id,
        "org_uuid": org_uuid,
        "invite_code_uuid": invite_code_uuid,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "expires_at": (datetime.now(timezone.utc) + timedelta(seconds=ttl)).isoformat(),
    }
    r.set(LINK_PREFIX + digest, json.dumps(record), ex=ttl)
    return token, digest


def _load(r, token: str) -> tuple[str, dict, str, dict]:
    """The link record and its invitation, or 404 when the link can't be used.
    The token's shape was checked by ``_db_invitation`` first."""
    digest = _hash(token)
    raw = r.get(LINK_PREFIX + digest)
    if not raw:
        raise HTTPException(status_code=404, detail=INVALID)
    try:
        record = json.loads(raw)
        expired = datetime.fromisoformat(record["expires_at"]) <= datetime.now(timezone.utc)
        invite_key = _invite_key(record["email"], record["org_uuid"])
    except (ValueError, KeyError, TypeError):
        raise HTTPException(status_code=404, detail=INVALID)
    if expired:
        raise HTTPException(status_code=404, detail=INVALID)
    invite_raw = r.get(invite_key)
    invite = json.loads(invite_raw) if invite_raw else None
    # Withdrawn, already answered, or replaced by a newer invitation email.
    if not invite or not invite.get("pending", True) or invite.get("link_hash") != digest:
        raise HTTPException(status_code=404, detail=INVALID)
    return digest, record, invite_key, invite


async def _org(db_session: AsyncSession, record: dict) -> Organization:
    org = (await db_session.execute(
        select(Organization).where(Organization.org_uuid == record["org_uuid"])
    )).scalars().first()
    if org is None or org.is_demo:
        raise HTTPException(status_code=404, detail=INVALID)
    return org


def _require_redis():
    r = _redis()
    if r is None:
        raise HTTPException(status_code=503, detail="Could not check your invitation right now, please try again.")
    return r


def _public_org(org: Organization) -> dict:
    return {"id": org.id, "org_uuid": org.org_uuid, "slug": org.slug, "name": org.name, "logo_image": org.logo_image}


async def _user_by_email(db_session: AsyncSession, email: str) -> Optional[User]:
    return (await db_session.execute(
        select(User).where(func.lower(User.email) == email.lower())
    )).scalars().first()


async def _db_invitation(db_session: AsyncSession, token: str):
    """(invitation, org) for a database link token, or None when the token is
    not one of them. A database link that can't be used any more is a 404."""
    from src.services.orgs.invitations.apply import invitation_by_token
    from src.services.orgs.invitations.policy import effective_status

    if not TOKEN_RE.fullmatch(token or ""):
        raise HTTPException(status_code=404, detail=INVALID)
    inv = await invitation_by_token(db_session, token)
    if inv is None:
        return None
    if effective_status(inv) != "pending":
        raise HTTPException(status_code=404, detail=INVALID)
    org = await db_session.get(Organization, inv.org_id)
    if org is None or org.is_demo:
        raise HTTPException(status_code=404, detail=INVALID)
    return inv, org


async def _invitation_summary(db_session: AsyncSession, inv) -> dict:
    """What the invitee is told before joining: the role, who invited them,
    their note, the groups and courses, and the deadline."""
    from src.db.courses.courses import Course
    from src.db.roles import Role
    from src.db.usergroups import UserGroup
    from src.services.orgs.invitations.policy import iso, role_for_grant

    role: Optional[Role] = await role_for_grant(db_session, inv.org_id, inv.role_id)
    inviter = await db_session.get(User, inv.invited_by_user_id) if inv.invited_by_user_id else None
    groups = []
    if inv.usergroup_ids:
        groups = (await db_session.execute(
            select(UserGroup.name).where(UserGroup.id.in_(inv.usergroup_ids), UserGroup.org_id == inv.org_id)  # type: ignore[attr-defined]
        )).scalars().all()
    courses = []
    if inv.course_uuids:
        courses = (await db_session.execute(
            select(Course.name).where(Course.course_uuid.in_(inv.course_uuids), Course.org_id == inv.org_id)  # type: ignore[attr-defined]
        )).scalars().all()
    inviter_name = None
    if inviter is not None:
        inviter_name = " ".join(p for p in (inviter.first_name, inviter.last_name) if p).strip() or inviter.username
    return {
        "role": {"name": role.name, "role_uuid": role.role_uuid} if role else None,
        "invited_by": inviter_name,
        "message": inv.message,
        "usergroups": list(groups),
        "courses": list(courses),
        "expires_at": iso(inv.expires_at),
    }


async def peek_invite_link(db_session: AsyncSession, token: str) -> dict:
    """What the org's signup page needs to greet the invitee. Only the holder
    of the token (the invited inbox) can ask, so it may name the address and
    say whether an account exists for it."""
    found = await _db_invitation(db_session, token)
    if found is not None:
        inv, org = found
        existing = await _user_by_email(db_session, inv.email)
        return {
            "email": inv.email,
            "org": _public_org(org),
            "account_exists": existing is not None,
            "invitation": await _invitation_summary(db_session, inv),
        }
    r = _require_redis()
    _digest, record, _key, _invite = _load(r, token)
    org = await _org(db_session, record)
    existing = await _user_by_email(db_session, record["email"])
    return {"email": record["email"], "org": _public_org(org), "account_exists": existing is not None}


def _claim(r, digest: str) -> None:
    """Single use: only one request may redeem a link at a time."""
    if not r.set(CLAIM_PREFIX + digest, "1", nx=True, ex=120):
        raise HTTPException(status_code=409, detail=IN_USE)


def _release(r, digest: str) -> None:
    r.delete(CLAIM_PREFIX + digest)


def _consume(r, digest: str, invite_key: str, invite: dict) -> None:
    r.delete(LINK_PREFIX + digest)
    ttl = r.ttl(invite_key)
    r.set(invite_key, json.dumps({**invite, "pending": False}), ex=ttl if ttl and ttl > 0 else None)


async def _username_for(db_session: AsyncSession, email: str) -> str:
    base = re.sub(r"[^a-z0-9_]", "", email.split("@")[0].lower())[:20]
    base = base if len(base) >= 4 else f"{base}user"[:8]
    for _ in range(6):
        candidate = f"{base}{secrets.randbelow(9000) + 1000}"
        taken = (await db_session.execute(select(User.id).where(User.username == candidate))).first()
        if taken is None:
            return candidate
    return f"{base}{secrets.token_hex(4)}"


async def _add_to_invite_group(request: Request, db_session: AsyncSession, r, record: dict, org: Organization, user_id: int) -> None:
    from src.db.users import InternalUser
    from src.services.onboarding.invites import _invite_usergroup
    from src.services.users.usergroups import add_users_to_usergroup

    group_id = _invite_usergroup(r, record, org.org_uuid)
    if not group_id:
        return
    try:
        await add_users_to_usergroup(request, db_session, InternalUser(id=0), group_id, str(user_id))
    except HTTPException:
        logger.warning("Invited user %s joined org %s but not group %s", user_id, org.id, group_id)


async def signup_with_invite_link(request: Request, db_session: AsyncSession, body: InviteSignupBody) -> dict:
    """Create the invitee's account from the link and make them a member."""
    from src.routers.users import _enforce_password_signup_allowed
    from src.services.users.users import create_user

    found = await _db_invitation(db_session, body.token)
    if found is not None:
        return await _signup_with_db_invitation(request, db_session, body, *found)

    r = _require_redis()
    digest, record, invite_key, invite = _load(r, body.token)
    org = await _org(db_session, record)
    if await _user_by_email(db_session, record["email"]) is not None:
        raise HTTPException(status_code=409, detail=ACCOUNT_EXISTS)
    await _enforce_password_signup_allowed(db_session, org.id)

    _claim(r, digest)
    try:
        user_object = UserCreate(
            email=record["email"],
            username=await _username_for(db_session, record["email"]),
            first_name=body.first_name.strip(),
            last_name=body.last_name.strip(),
            password=body.password,
            custom_fields=body.custom_fields,
        )
        user = await create_user(
            request, db_session, AnonymousUser(), user_object, org.id,
            signup_provider="invite", email_verified_by_link=True,
        )
        await _add_to_invite_group(request, db_session, r, invite, org, user.id)
        _consume(r, digest, invite_key, invite)
    finally:
        _release(r, digest)
    return {"email": record["email"], "org": _public_org(org)}


async def accept_invite_link(request: Request, db_session: AsyncSession, user_id: int, token: str) -> dict:
    """Join from the link while signed in as the invited address."""
    from src.services.onboarding.invites import join_from_invite

    found = await _db_invitation(db_session, token)
    if found is not None:
        return await _accept_db_invitation(request, db_session, user_id, *found)

    r = _require_redis()
    digest, record, invite_key, invite = _load(r, token)
    org = await _org(db_session, record)
    user = (await db_session.execute(select(User).where(User.id == user_id))).scalars().first()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if (user.email or "").strip().lower() != record["email"]:
        raise HTTPException(status_code=403, detail=EMAIL_MISMATCH)

    _claim(r, digest)
    try:
        await _prove_inbox(db_session, user)

        member = (await db_session.execute(
            select(UserOrganization).where(UserOrganization.user_id == user.id, UserOrganization.org_id == org.id)
        )).scalars().first()
        already_member = member is not None
        if not already_member:
            await join_from_invite(request, db_session, user, org, join_method="email_invite_link")
            await _add_to_invite_group(request, db_session, r, invite, org, user.id)
        _consume(r, digest, invite_key, invite)
    finally:
        _release(r, digest)
    return {"org": _public_org(org), "already_member": already_member}



async def _prove_inbox(db_session: AsyncSession, user: User) -> None:
    """Signed in with the password AND holding the link mailed to this
    address: the inbox is proven. Same rule as a magic link, which also drops
    identity-provider links made while it was unproven."""
    if user.email_verified:
        return
    from src.services.auth.utils import _drop_unverified_sso_links

    user.email_verified = True
    user.email_verified_at = datetime.now(timezone.utc).isoformat()
    db_session.add(user)
    await db_session.commit()
    await _drop_unverified_sso_links(user.id, db_session)


def _optional_claim(digest: str):
    """The Redis "being redeemed" marker when Redis is there; the database
    claim on the invitation is the real single-use guard."""
    r = _redis()
    if r is None:
        return None
    _claim(r, digest)
    return r


async def _signup_with_db_invitation(request: Request, db_session: AsyncSession, body: InviteSignupBody, inv, org: Organization) -> dict:
    from src.routers.users import _enforce_password_signup_allowed
    from src.services.orgs.invitations.apply import accept_invitation
    from src.services.users.users import create_user

    if await _user_by_email(db_session, inv.email) is not None:
        raise HTTPException(status_code=409, detail=ACCOUNT_EXISTS)
    await _enforce_password_signup_allowed(db_session, org.id)
    digest = _hash(body.token)
    r = _optional_claim(digest)
    try:
        user_object = UserCreate(
            email=inv.email,
            username=await _username_for(db_session, inv.email),
            first_name=body.first_name.strip(),
            last_name=body.last_name.strip(),
            password=body.password,
            custom_fields=body.custom_fields,
        )
        created = await create_user(
            request, db_session, AnonymousUser(), user_object, org.id,
            signup_provider="invite", email_verified_by_link=True,
        )
        user = await db_session.get(User, created.id)
        await accept_invitation(request, db_session, user, org, inv, via="email_invite_link", ownership_proven=True)
    finally:
        if r is not None:
            _release(r, digest)
    return {"email": inv.email, "org": _public_org(org)}


async def _accept_db_invitation(request: Request, db_session: AsyncSession, user_id: int, inv, org: Organization) -> dict:
    from src.services.orgs.invitations.apply import accept_invitation

    user = await db_session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if (user.email or "").strip().lower() != inv.email:
        raise HTTPException(status_code=403, detail=EMAIL_MISMATCH)
    # Found by this token, so the hash is the one on the invitation.
    digest = inv.token_hash
    r = _optional_claim(digest)
    try:
        await _prove_inbox(db_session, user)
        result = await accept_invitation(request, db_session, user, org, inv, via="email_invite_link", ownership_proven=True)
    finally:
        if r is not None:
            _release(r, digest)
    return {"org": _public_org(org), "already_member": result["already_member"], "role": result["role"]}
