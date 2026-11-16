import json
import logging
from typing import Optional

import redis
from fastapi import HTTPException, Request
from pydantic import EmailStr
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from config.config import get_learnhouse_config
from src.core.ee_hooks import audit_event
from src.db.organization_config import OrganizationConfig
from src.db.organizations import Organization, OrganizationRead
from src.db.users import AnonymousUser, PublicUser, UserRead
from src.services.orgs.orgs import (
    rbac_check,
)
from src.services.users.emails import send_invitation_email

logger = logging.getLogger(__name__)

_redis_pool: Optional[redis.ConnectionPool] = None

def _get_redis(redis_conn_string: str) -> redis.Redis:
    global _redis_pool
    if _redis_pool is None:
        _redis_pool = redis.ConnectionPool.from_url(redis_conn_string, max_connections=10)
    return redis.Redis(connection_pool=_redis_pool)


async def create_invite_code(
    request: Request,
    org_id: int,
    current_user: PublicUser | AnonymousUser,
    db_session: AsyncSession,
    usergroup_id: Optional[int] = None,
    *,
    settings=None,
):
    """Create a shareable invite code (stored in the database, see
    ``src.services.orgs.invitations.codes``). ``usergroup_id`` is the older
    single-group form; ``settings`` an ``InviteCodeCreate``."""
    from src.services.orgs.invitations.codes import InviteCodeCreate, create_code

    if settings is None:
        settings = InviteCodeCreate(usergroup_ids=[usergroup_id] if usergroup_id is not None else [])
    return await create_code(request, db_session, org_id, settings, current_user)


async def get_invite_codes(
    request: Request,
    org_id: int,
    current_user: PublicUser | AnonymousUser,
    db_session: AsyncSession,
):
    """Every live invite code of the org, with its settings and usage, and
    the older Redis codes still in use."""
    from src.services.orgs.invitations.codes import list_codes

    return await list_codes(request, db_session, org_id, current_user)


async def get_invite_code(
    request: Request,
    org_id: int,
    invite_code: str,
    current_user: PublicUser | AnonymousUser,
    db_session: AsyncSession,
):
    statement = select(Organization).where(Organization.id == org_id)
    org = (await db_session.execute(statement)).scalars().first()

    if not org:
        raise HTTPException(
            status_code=404,
            detail="Organization not found",
        )

    # RBAC check - verify user has permission to view invite codes for this org
    await rbac_check(request, org.org_uuid, current_user, "read", db_session)

    # SECURITY: Validate invite code is alphanumeric to prevent Redis wildcard injection
    if not invite_code.isalnum():
        raise HTTPException(
            status_code=404,
            detail="Invite code not found",
        )

    # Codes live in the database now; an expired, used-up or deleted one is
    # simply not found. Older codes are still read from Redis below.
    from src.services.orgs.invitations.codes import as_join_data, find_active_code

    db_code = await find_active_code(db_session, org.id, invite_code)
    if db_code is not None:
        return as_join_data(db_code)

    # A legacy code: without a reachable Redis it simply isn't found.
    not_found = HTTPException(status_code=404, detail="Invite code not found")
    redis_conn_string = get_learnhouse_config().redis_config.redis_connection_string
    r = _get_redis(redis_conn_string) if redis_conn_string else None
    if not r:
        raise not_found
    try:
        # Use scan_iter to avoid blocking Redis.
        matched_key = next(iter(r.scan_iter(match=f"org_invite_code_*:org:{org.org_uuid}:code:{invite_code}", count=10)), None)
        invite_code_value = r.get(matched_key) if matched_key else None
    except redis.RedisError:
        logger.warning("Could not look up a legacy invite code for org %s", org.id, exc_info=True)
        raise not_found
    if not invite_code_value:
        raise not_found
    return json.loads(invite_code_value)


async def delete_invite_code(
    request: Request,
    org_id: int,
    invite_code_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: AsyncSession,
):
    # Redis init
    LH_CONFIG = get_learnhouse_config()
    redis_conn_string = LH_CONFIG.redis_config.redis_connection_string

    if not redis_conn_string:
        raise HTTPException(
            status_code=500,
            detail="Redis connection string not found",
        )

    statement = select(Organization).where(Organization.id == org_id)
    org = (await db_session.execute(statement)).scalars().first()

    if not org:
        raise HTTPException(
            status_code=404,
            detail="Organization not found",
        )

    # RBAC check
    await rbac_check(request, org.org_uuid, current_user, "update", db_session)

    from src.services.orgs.invitations.codes import revoke_code

    revoked = await revoke_code(request, db_session, org_id, invite_code_uuid, current_user)
    if revoked is not None:
        return revoked

    # Connect to Redis
    r = _get_redis(redis_conn_string)

    if not r:
        raise HTTPException(
            status_code=500,
            detail="Could not connect to Redis",
        )

    # SECURITY: the UUID is interpolated into a Redis SCAN glob pattern;
    # revoke_code above already refused anything but the exact
    # "org_invite_code_<uuid4>" shape, so no wildcard can reach it.
    # Delete invite code (use scan_iter to avoid blocking Redis)
    keys = list(r.scan_iter(match=f"{invite_code_uuid}:org:{org.org_uuid}:code:*", count=10))
    if keys:
        r.delete(*keys)

    if not keys:
        raise HTTPException(
            status_code=404,
            detail="Invite code not found",
        )
    audit_event(
        request, action="members.invite_code.deleted", org_id=org_id, actor=current_user,
        target_type="invite_code", target_id=invite_code_uuid,
    )

    return keys


async def send_invite_email(
    org: OrganizationRead,
    invite_code_uuid: str | None,
    user: UserRead,
    email: EmailStr,
    request: Request,
    db_session=None,
    invite_link_token: str | None = None,
):
    invite_code = None

    # Look up the invite code from Redis if a UUID was provided
    if invite_code_uuid:
        LH_CONFIG = get_learnhouse_config()
        redis_conn_string = LH_CONFIG.redis_config.redis_connection_string

        if redis_conn_string:
            r = _get_redis(redis_conn_string)
            matched = list(r.scan_iter(match=f"{invite_code_uuid}:org:{org.org_uuid}:code:*", count=10))  # type: ignore
            if matched:
                data = r.get(matched[0])
                if data:
                    invite_code = json.loads(data).get("invite_code")

    # Build signup URL rooted at the org's own frontend subdomain (or primary
    # verified custom domain if one is configured; passing db_session opts in).
    from src.services.email.utils import get_org_signup_base_url
    org_base_url = await get_org_signup_base_url(
        org.slug, request, db_session=db_session, org_id=org.id
    )

    if invite_link_token:
        # Personal link: the org's signup page, address filled in, no code to
        # type (the token stands in for it on invite-only orgs).
        signup_url = f"{org_base_url}/signup?invite={invite_link_token}"
    elif invite_code:
        signup_url = f"{org_base_url}/signup?inviteCode={invite_code}"
    else:
        signup_url = f"{org_base_url}/signup"

    from src.services.email.branding import resolve_org_email_branding

    org_config = None
    if db_session is not None:
        try:
            org_config_stmt = select(OrganizationConfig).where(OrganizationConfig.org_id == org.id)
            org_config = (await db_session.execute(org_config_stmt)).scalars().first()
        except Exception:
            pass
    branding = resolve_org_email_branding(org, org_config, request)

    try:
        # Defense in depth: scrub any link out of the inviter's display name
        # before it is relayed to recipients, even if it slipped past
        # write-time validation (e.g. imported via OAuth).
        from src.services.security.profile_validation import sanitize_display_name

        result = send_invitation_email(
            email=email,
            org_name=sanitize_display_name(org.name, fallback="A LearnHouse organization"),
            inviter_username=sanitize_display_name(user.username),
            # The personal link replaces the code: nothing to type.
            invite_code=None if invite_link_token else invite_code,
            signup_url=signup_url,
            **branding.as_kwargs(),
        )
        return result is not None
    except Exception:
        logger.exception("Failed to send invite email to %s", email)
        return False
