from datetime import datetime
import json
import random
import redis
import string
import uuid
from fastapi import HTTPException, Request
from pydantic import EmailStr
from sqlmodel import Session, select
from src.db.organizations import Organization, OrganizationRead
from src.security.security import security_hash_password
from config.config import get_learnhouse_config
from src.services.users.emails import (
    send_password_reset_email,
)
from src.db.users import (
    AnonymousUser,
    PublicUser,
    User,
    UserRead,
)


async def send_reset_password_code(
    request: Request,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
    org_id: int,
    email: EmailStr,
):
    # Get user
    statement = select(User).where(User.email == email)
    user = db_session.exec(statement).first()

    if not user:
        raise HTTPException(
            status_code=400,
            detail="User does not exist",
        )

    # Get org
    statement = select(Organization).where(Organization.id == org_id)
    org = db_session.exec(statement).first()

    if not org:
        raise HTTPException(
            status_code=400,
            detail="Organization not found",
        )

    # Redis init
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

    # Generate reset code
    def generate_code(length=5):
        letters_and_digits = string.ascii_letters + string.digits
        return "".join(random.choice(letters_and_digits) for _ in range(length))

    generated_reset_code = generate_code()
    reset_email_invite_uuid = f"reset_email_invite_code_{uuid.uuid4()}"

    ttl = int(datetime.now().timestamp()) + 60 * 60 * 1  # 1 hour

    resetCodeObject = {
        "reset_code": generated_reset_code,
        "reset_email_invite_uuid": reset_email_invite_uuid,
        "reset_code_expires": ttl,
        "reset_code_type": "signup",
        "created_at": datetime.now().isoformat(),
        "created_by": user.user_uuid,
        "org_uuid": org.org_uuid,
    }

    r.set(
        f"{reset_email_invite_uuid}:user:{user.user_uuid}:org:{org.org_uuid}:code:{generated_reset_code}",
        json.dumps(resetCodeObject),
        ex=ttl,
    )

    user = UserRead.from_orm(user)

    org = OrganizationRead.from_orm(org)

    # Send reset code via email
    isEmailSent = send_password_reset_email(
        generated_reset_code=generated_reset_code,
        user=user,
        organization=org,
        email=user.email,
    )

    if not isEmailSent:
        raise HTTPException(
            status_code=500,
            detail="Issue with sending reset code",
        )

    return "Reset code sent"


async def change_password_with_reset_code(
    request: Request,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
    new_password: str,
    org_id: int,
    email: EmailStr,
    reset_code: str,
):
    # Get user
    statement = select(User).where(User.email == email)
    user = db_session.exec(statement).first()

    if not user:
        raise HTTPException(
            status_code=400,
            detail="User does not exist",
        )

    # Get org
    statement = select(Organization).where(Organization.id == org_id)
    org = db_session.exec(statement).first()

    if not org:
        raise HTTPException(
            status_code=400,
            detail="Organization not found",
        )

    # Redis init
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

    # Get reset code
    reset_code_key = f"*:user:{user.user_uuid}:org:{org.org_uuid}:code:{reset_code}"
    keys = r.keys(reset_code_key)

    if not keys:
        raise HTTPException(
            status_code=400,
            detail="Reset code not found",
        )

    # Get reset code object
    reset_code_value = r.get(keys[0])

    if reset_code_value is None:
        raise HTTPException(
            status_code=400,
            detail="Reset code value not found",
        )
    reset_code_object = json.loads(reset_code_value)

    # Check if reset code is expired
    if reset_code_object["reset_code_expires"] < int(datetime.now().timestamp()):
        raise HTTPException(
            status_code=400,
            detail="Reset code expired",
        )

    # Change password
    user.password = await security_hash_password(new_password)
    db_session.add(user)

    db_session.commit()
    db_session.refresh(user)

    # Delete reset code
    r.delete(keys[0])

    return "Password changed"
