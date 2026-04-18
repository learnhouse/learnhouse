import json
import logging
import secrets
import string
import uuid
from datetime import datetime, timedelta
from typing import Optional

import redis
from fastapi import HTTPException, Request
from pydantic import EmailStr
from sqlmodel import Session, select

from config.config import get_learnhouse_config
from src.db.organizations import Organization, OrganizationRead
from src.db.usergroups import UserGroup
from src.db.users import AnonymousUser, PublicUser, UserRead
from src.services.orgs.orgs import rbac_check
from src.services.users.emails import send_invitation_email

logger = logging.getLogger(__name__)

_redis_pool: Optional[redis.ConnectionPool] = None

def _get_redis(redis_conn_string: str) -> redis.Redis:
    global _redis_pool
    if _redis_pool is None:
        _redis_pool = redis.ConnectionPool.from_url(redis_conn_string, max_connections=10)
    return redis.Redis(connection_pool=_redis_pool)


# Lua script: atomically count existing org invite codes and add a new one if
# the per-org limit has not been reached.  Runs as a single atomic unit on the
# Redis server, eliminating the check-then-set race condition.
#
# KEYS[1] = glob pattern for existing codes   (e.g. "org_invite_code_*:org:<uuid>:code:*")
# KEYS[2] = the new key to write
# ARGV[1] = JSON value to store
# ARGV[2] = TTL in seconds
# ARGV[3] = maximum number of codes allowed
#
# Returns 1 on success, 0 when the limit is already reached.
_LUA_ATOMIC_INVITE = (
    "local pattern = KEYS[1]\n"
    "local new_key = KEYS[2]\n"
    "local new_value = ARGV[1]\n"
    "local ttl = tonumber(ARGV[2])\n"
    "local max_codes = tonumber(ARGV[3])\n"
    "local existing = redis.call('KEYS', pattern)\n"
    "if #existing >= max_codes then\n"
    "    return 0\n"
    "end\n"
    "redis.call('SET', new_key, new_value, 'EX', ttl)\n"
    "return 1\n"
)


async def create_invite_code(
    request: Request,
    org_id: int,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
    usergroup_id: Optional[int] = None,
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
    result = db_session.exec(statement)

    org = result.first()

    if not org:
        raise HTTPException(
            status_code=404,
            detail="Organization not found",
        )

    # RBAC check
    await rbac_check(request, org.org_uuid, current_user, "update", db_session)

    # Connect to Redis
    r = _get_redis(redis_conn_string)

    if not r:
        raise HTTPException(
            status_code=500,
            detail="Could not connect to Redis",
        )

    # Validate usergroup exists if provided
    if usergroup_id is not None:
        statement = select(UserGroup).where(
            UserGroup.id == usergroup_id,
            UserGroup.org_id == org_id,
        )
        usergroup = db_session.exec(statement).first()
        if not usergroup:
            raise HTTPException(
                status_code=404,
                detail="UserGroup not found or does not belong to this organization",
            )

    # Generate invite code using cryptographically secure random
    def generate_code(length=8):
        alphabet = string.ascii_letters + string.digits
        return "".join(secrets.choice(alphabet) for _ in range(length))

    generated_invite_code = generate_code()
    invite_code_uuid = f"org_invite_code_{uuid.uuid4()}"

    # time to live in days to seconds
    ttl = int(timedelta(days=365).total_seconds())

    inviteCodeObject = {
        "invite_code": generated_invite_code,
        "invite_code_uuid": invite_code_uuid,
        "invite_code_expires": ttl,
        "invite_code_type": "signup",
        "created_at": datetime.now().isoformat(),
        "created_by": current_user.user_uuid,
    }

    if usergroup_id is not None:
        inviteCodeObject["usergroup_id"] = usergroup_id

    new_invite_key = f"{invite_code_uuid}:org:{org.org_uuid}:code:{generated_invite_code}"
    invite_value = json.dumps(inviteCodeObject)

    # Atomically check the per-org code limit and write the new key.
    # _LUA_ATOMIC_INVITE returns 0 when the limit is reached, 1 on success.
    result = r.eval(  # type: ignore[attr-defined]
        _LUA_ATOMIC_INVITE,
        2,
        f"org_invite_code_*:org:{org.org_uuid}:code:*",
        new_invite_key,
        invite_value,
        str(ttl),
        "6",
    )

    if result == 0:
        raise HTTPException(
            status_code=400,
            detail="Maximum number of invite codes reached",
        )

    return inviteCodeObject


async def get_invite_codes(
    request: Request,
    org_id: int,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
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
    result = db_session.exec(statement)

    org = result.first()

    if not org:
        raise HTTPException(
            status_code=404,
            detail="Organization not found",
        )

    # RBAC check
    await rbac_check(request, org.org_uuid, current_user, "update", db_session)

    # Connect to Redis
    r = _get_redis(redis_conn_string)

    if not r:
        raise HTTPException(
            status_code=500,
            detail="Could not connect to Redis",
        )

    # Get invite codes (use scan_iter to avoid blocking Redis)
    invite_codes = list(r.scan_iter(match=f"org_invite_code_*:org:{org.org_uuid}:code:*", count=100))

    invite_codes_list = []

    for invite_code in invite_codes:  # type: ignore
        invite_code = r.get(invite_code)
        invite_code = json.loads(invite_code)  # type: ignore

        # Enrich with usergroup name if linked
        if invite_code.get("usergroup_id"):
            statement = select(UserGroup).where(
                UserGroup.id == invite_code["usergroup_id"]
            )
            usergroup = db_session.exec(statement).first()
            invite_code["usergroup_name"] = usergroup.name if usergroup else None

        invite_codes_list.append(invite_code)

    return invite_codes_list


async def get_invite_code(
    request: Request,
    org_id: int,
    invite_code: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
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
    result = db_session.exec(statement)

    org = result.first()

    if not org:
        raise HTTPException(
            status_code=404,
            detail="Organization not found",
        )

    # RBAC check - verify user has permission to view invite codes for this org
    await rbac_check(request, org.org_uuid, current_user, "read", db_session)

    # Connect to Redis
    r = _get_redis(redis_conn_string)

    if not r:
        raise HTTPException(
            status_code=500,
            detail="Could not connect to Redis",
        )

    # SECURITY: Validate invite code is alphanumeric to prevent Redis wildcard injection
    if not invite_code.isalnum():
        raise HTTPException(
            status_code=404,
            detail="Invite code not found",
        )

    # Get invite code (use scan_iter to avoid blocking Redis)
    matched_key = None
    for key in r.scan_iter(match=f"org_invite_code_*:org:{org.org_uuid}:code:{invite_code}", count=10):
        matched_key = key
        break

    if not matched_key:
        raise HTTPException(
            status_code=404,
            detail="Invite code not found",
        )

    invite_code_value = r.get(matched_key)
    invite_code_data = json.loads(invite_code_value)

    return invite_code_data


async def delete_invite_code(
    request: Request,
    org_id: int,
    invite_code_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
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
    result = db_session.exec(statement)

    org = result.first()

    if not org:
        raise HTTPException(
            status_code=404,
            detail="Organization not found",
        )

    # RBAC check
    await rbac_check(request, org.org_uuid, current_user, "update", db_session)

    # Connect to Redis
    r = _get_redis(redis_conn_string)

    if not r:
        raise HTTPException(
            status_code=500,
            detail="Could not connect to Redis",
        )

    # Delete invite code (use scan_iter to avoid blocking Redis)
    keys = list(r.scan_iter(match=f"{invite_code_uuid}:org:{org.org_uuid}:code:*", count=10))
    if keys:
        r.delete(*keys)

    if not keys:
        raise HTTPException(
            status_code=404,
            detail="Invite code not found",
        )

    return keys


def send_invite_email(
    org: OrganizationRead,
    invite_code_uuid: str | None,
    user: UserRead,
    email: EmailStr,
    request: Request,
    db_session: Session | None = None,
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
    # verified custom domain if one is configured — passing db_session opts in).
    from src.services.email.utils import get_org_signup_base_url
    org_base_url = get_org_signup_base_url(
        org.slug, request, db_session=db_session, org_id=org.id
    )

    if invite_code:
        signup_url = f"{org_base_url}/signup?inviteCode={invite_code}"
    else:
        signup_url = f"{org_base_url}/signup"

    try:
        result = send_invitation_email(
            email=email,
            org_name=org.name,
            inviter_username=user.username,
            invite_code=invite_code,
            signup_url=signup_url,
        )
        return result is not None
    except Exception:
        logger.exception("Failed to send invite email to %s", email)
        return False
