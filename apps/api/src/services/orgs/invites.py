import json
import random
import string
import uuid
from pydantic import EmailStr
import redis
from datetime import datetime, timedelta
from sqlmodel import Session, select
from src.services.email.utils import send_email
from config.config import get_learnhouse_config
from src.services.orgs.orgs import rbac_check
from src.db.users import AnonymousUser, PublicUser, UserRead
from src.db.organizations import (
    Organization,
    OrganizationRead,
)
from fastapi import HTTPException, Request


async def create_invite_code(
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

    # Check if this org has more than 6 invite codes
    invite_codes = r.keys(f"*:org:{org.org_uuid}:code:*")

    if len(invite_codes) >= 6:
        raise HTTPException(
            status_code=400,
            detail="Organization has reached the maximum number of invite codes",
        )

    # Generate invite code
    def generate_code(length=5):
        letters_and_digits = string.ascii_letters + string.digits
        return "".join(random.choice(letters_and_digits) for _ in range(length))

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

    # Get invite codes
    invite_codes = r.keys(f"org_invite_code_*:org:{org.org_uuid}:code:*")

    invite_codes_list = []

    for invite_code in invite_codes:
        invite_code = r.get(invite_code)
        invite_code = json.loads(invite_code) # type: ignore
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

    # RBAC check
    # await rbac_check(request, org.org_uuid, current_user, "update", db_session)

    # Connect to Redis
    r = redis.Redis.from_url(redis_conn_string)

    if not r:
        raise HTTPException(
            status_code=500,
            detail="Could not connect to Redis",
        )

    # Get invite code
    invite_code = r.keys(f"org_invite_code_*:org:{org.org_uuid}:code:{invite_code}")  # type: ignore

    if not invite_code:
        raise HTTPException(
            status_code=404,
            detail="Invite code not found",
        )

    invite_code = r.get(invite_code[0])  # type: ignore
    invite_code = json.loads(invite_code)

    return invite_code


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

    # Delete invite code
    keys = r.keys(f"{invite_code_uuid}:org:{org.org_uuid}:code:*")
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
    invite_code_uuid: str,
    user: UserRead,
    email: EmailStr,
):
    LH_CONFIG = get_learnhouse_config()
    redis_conn_string = LH_CONFIG.redis_config.redis_connection_string

    if not redis_conn_string:
        raise HTTPException(
            status_code=500,
            detail="Redis connection string not found",
        )

    # Connect to Redis
    r = redis.Redis.from_url(redis_conn_string)

    if not r:
        raise HTTPException(
            status_code=500,
            detail="Could not connect to Redis",
        )

    # Get invite code
    invite = r.keys(f"{invite_code_uuid}:org:{org.org_uuid}:code:*")  # type: ignore

    # Send email
    if invite:
        invite = r.get(invite[0])
        invite = json.loads(invite) # type: ignore

        # send email
        send_email(
            to=email,
            subject=f"You have been invited to {org.name}",
            body=f"""
<html>
    <body>
        <p>Hello {email}</p>
        <p>You have been invited to {org.name} by @{user.username}. Your invite code is {invite['invite_code']}.</p>
        <p>Click <a href="{org.slug}.learnhouse.io/signup?inviteCode={invite['invite_code']}">here</a> to sign up.</p>
        <p>Thank you</p>
    </body>
</html>
""",
        )

        return True

    else:
        return False
