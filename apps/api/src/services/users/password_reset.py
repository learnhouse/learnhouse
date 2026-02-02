from datetime import datetime
import json
import secrets
import logging
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
from src.services.security.password_validation import validate_password_complexity


def generate_secure_reset_code(length: int = 8) -> str:
    """
    Generate a cryptographically secure reset code.

    SECURITY: Uses secrets module for cryptographically secure random generation.
    The code is 8 characters by default, providing ~47 bits of entropy.

    Args:
        length: Length of the reset code (default: 8)

    Returns:
        str: Secure random alphanumeric code
    """
    alphabet = string.ascii_letters + string.digits
    return ''.join(secrets.choice(alphabet) for _ in range(length))


async def send_reset_password_code(
    request: Request,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
    org_id: int,
    email: EmailStr,
):
    """
    Send a password reset code to the user's email.

    SECURITY NOTES:
    - Uses cryptographically secure code generation (secrets module)
    - Returns generic message to prevent user enumeration
    - Logs attempts for security audit
    """
    # Get org first (public info, safe to fail explicitly)
    statement = select(Organization).where(Organization.id == org_id)
    org = db_session.exec(statement).first()

    if not org:
        raise HTTPException(
            status_code=400,
            detail="Organization not found",
        )

    # Get user - SECURITY: Don't reveal if user exists or not
    statement = select(User).where(User.email == email)
    user = db_session.exec(statement).first()

    # SECURITY FIX: Always return success message to prevent user enumeration
    # Log the attempt for security monitoring
    if not user:
        logging.info(f"Password reset requested for non-existent email: {email[:3]}***")
        # Return same message as success to prevent enumeration
        return "If an account with that email exists, a reset code has been sent"

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

    # SECURITY FIX: Use cryptographically secure code generation
    # Increased from 5 to 8 characters for better entropy
    generated_reset_code = generate_secure_reset_code(length=8)
    reset_email_invite_uuid = f"reset_email_invite_code_{uuid.uuid4()}"

    ttl = 60 * 60 * 1  # 1 hour in seconds

    resetCodeObject = {
        "reset_code": generated_reset_code,
        "reset_email_invite_uuid": reset_email_invite_uuid,
        "reset_code_expires": int(datetime.now().timestamp()) + ttl,
        "reset_code_type": "password_reset",
        "created_at": datetime.now().isoformat(),
        "created_by": user.user_uuid,
        "org_uuid": org.org_uuid,
    }

    r.set(
        f"{reset_email_invite_uuid}:user:{user.user_uuid}:org:{org.org_uuid}:code:{generated_reset_code}",
        json.dumps(resetCodeObject),
        ex=ttl,
    )

    user_read = UserRead.model_validate(user)
    org_read = OrganizationRead.model_validate(org)

    # Send reset code via email
    isEmailSent = send_password_reset_email(
        generated_reset_code=generated_reset_code,
        user=user_read,
        organization=org_read,
        email=user_read.email,
    )

    if not isEmailSent:
        logging.error(f"Failed to send password reset email to user: {user.user_uuid}")
        raise HTTPException(
            status_code=500,
            detail="Issue with sending reset code",
        )

    logging.info(f"Password reset code sent to user: {user.user_uuid}")
    return "If an account with that email exists, a reset code has been sent"


async def change_password_with_reset_code(
    request: Request,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
    new_password: str,
    org_id: int,
    email: EmailStr,
    reset_code: str,
):
    """
    Change password using a reset code.

    SECURITY NOTES:
    - Validates password complexity before changing
    - Uses generic error messages to prevent user/code enumeration
    - Deletes reset code after successful use (one-time use)
    """
    # Validate new password complexity first (before any DB lookups)
    validation_result = validate_password_complexity(new_password)
    if not validation_result.is_valid:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "WEAK_PASSWORD",
                "message": "Password does not meet security requirements",
                "errors": validation_result.errors,
                "requirements": validation_result.requirements,
            },
        )

    # Get org first (public info)
    statement = select(Organization).where(Organization.id == org_id)
    org = db_session.exec(statement).first()

    if not org:
        raise HTTPException(
            status_code=400,
            detail="Organization not found",
        )

    # Get user - SECURITY: Use generic error message
    statement = select(User).where(User.email == email)
    user = db_session.exec(statement).first()

    # SECURITY FIX: Generic error message to prevent enumeration
    if not user:
        logging.warning(f"Password change attempted for non-existent email: {email[:3]}***")
        raise HTTPException(
            status_code=400,
            detail="Invalid reset code or email",
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

    # Get reset code - SECURITY: Use generic error messages
    reset_code_key = f"*:user:{user.user_uuid}:org:{org.org_uuid}:code:{reset_code}"
    keys = r.keys(reset_code_key)

    # SECURITY FIX: Generic error message to prevent code enumeration
    if not keys:
        logging.warning(f"Invalid reset code attempt for user: {user.user_uuid}")
        raise HTTPException(
            status_code=400,
            detail="Invalid or expired reset code",
        )

    # Get reset code object
    reset_code_value = r.get(keys[0])

    if reset_code_value is None:
        logging.warning(f"Reset code value missing for user: {user.user_uuid}")
        raise HTTPException(
            status_code=400,
            detail="Invalid or expired reset code",
        )
    reset_code_object = json.loads(reset_code_value)

    # Check if reset code is expired
    if reset_code_object["reset_code_expires"] < int(datetime.now().timestamp()):
        # Delete expired code
        r.delete(keys[0])
        logging.info(f"Expired reset code used for user: {user.user_uuid}")
        raise HTTPException(
            status_code=400,
            detail="Invalid or expired reset code",
        )

    # Change password
    user.password = security_hash_password(new_password)
    db_session.add(user)

    db_session.commit()
    db_session.refresh(user)

    # Delete reset code (one-time use)
    r.delete(keys[0])

    logging.info(f"Password successfully changed for user: {user.user_uuid}")
    return "Password changed"
