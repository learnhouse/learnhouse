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
    r = redis.Redis.from_url(redis_conn_string)

    if not r:
        raise HTTPException(
            status_code=500,
            detail="Could not connect to Redis",
        )

    # Check if this org has more than 6 invite codes (use scan_iter to avoid blocking Redis)
    invite_codes = list(r.scan_iter(match=f"org_invite_code_*:org:{org.org_uuid}:code:*", count=100))

    if len(invite_codes) >= 6:
        raise HTTPException(
            status_code=400,
            detail="Organization has reached the maximum number of invite codes",
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

    r.set(
        f"{invite_code_uuid}:org:{org.org_uuid}:code:{generated_invite_code}",
        json.dumps(inviteCodeObject),
        ex=ttl,
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
    r = redis.Redis.from_url(redis_conn_string)

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
    r = redis.Redis.from_url(redis_conn_string)

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
    r = redis.Redis.from_url(redis_conn_string)

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
):
    invite_code = None

    # Look up the invite code from Redis if a UUID was provided
    if invite_code_uuid:
        LH_CONFIG = get_learnhouse_config()
        redis_conn_string = LH_CONFIG.redis_config.redis_connection_string

        if redis_conn_string:
            r = redis.Redis.from_url(redis_conn_string)
            matched = list(r.scan_iter(match=f"{invite_code_uuid}:org:{org.org_uuid}:code:*", count=10))  # type: ignore
            if matched:
                data = r.get(matched[0])
                if data:
                    invite_code = json.loads(data).get("invite_code")

    # Build signup URL rooted at the org's own frontend subdomain, NOT the
    # platform root.
    from src.services.email.utils import get_org_signup_base_url
    org_base_url = get_org_signup_base_url(org.slug, request)

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
