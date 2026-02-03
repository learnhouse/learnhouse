"""
Email verification service for verifying user email addresses.

Uses Redis to store verification tokens with 24-hour TTL.
"""
from datetime import datetime, timezone
import json
import secrets
import redis
from fastapi import HTTPException, Request
from pydantic import EmailStr
from sqlmodel import Session, select
from src.db.organizations import Organization, OrganizationRead
from src.db.users import User, UserRead
from config.config import get_learnhouse_config
from src.services.users.emails import send_email_verification_email
from src.services.email.utils import get_base_url_from_request
from src.services.security.rate_limiting import check_verification_resend_rate_limit


# Token expiration time in seconds (24 hours)
TOKEN_TTL_SECONDS = 24 * 60 * 60


def get_redis_connection() -> redis.Redis:
    """Get Redis connection from config."""
    LH_CONFIG = get_learnhouse_config()
    redis_conn_string = LH_CONFIG.redis_config.redis_connection_string

    if not redis_conn_string:
        raise HTTPException(
            status_code=500,
            detail="Redis connection string not found",
        )

    r = redis.Redis.from_url(redis_conn_string)

    if not r:
        raise HTTPException(
            status_code=500,
            detail="Could not connect to Redis",
        )

    return r


def generate_verification_token() -> str:
    """Generate a secure verification token."""
    return secrets.token_urlsafe(32)


async def send_verification_email(
    request: Request,
    db_session: Session,
    user: User,
    org_id: int,
) -> str:
    """
    Generate a verification token, store in Redis, and send verification email.

    Args:
        request: FastAPI request
        db_session: Database session
        user: User to send verification email to
        org_id: Organization ID

    Returns:
        Success message
    """
    # Get organization
    statement = select(Organization).where(Organization.id == org_id)
    org = db_session.exec(statement).first()

    if not org:
        raise HTTPException(
            status_code=400,
            detail="Organization not found",
        )

    # Get Redis connection
    r = get_redis_connection()

    # Generate secure token
    token = generate_verification_token()

    # Create verification object
    verification_data = {
        "token": token,
        "user_uuid": user.user_uuid,
        "org_uuid": org.org_uuid,
        "email": user.email,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "expires_at": (datetime.now(timezone.utc).timestamp() + TOKEN_TTL_SECONDS),
    }

    # Store in Redis with TTL
    # Key format: email_verification:{user_uuid}:org:{org_uuid}:token:{token}
    redis_key = f"email_verification:{user.user_uuid}:org:{org.org_uuid}:token:{token}"
    r.setex(redis_key, TOKEN_TTL_SECONDS, json.dumps(verification_data))

    # Convert to Read models for email function
    user_read = UserRead.model_validate(user)
    org_read = OrganizationRead.model_validate(org)

    # Send verification email
    base_url = get_base_url_from_request(request)
    email_sent = send_email_verification_email(
        token=token,
        user=user_read,
        organization=org_read,
        email=user.email,
        base_url=base_url,
    )

    if not email_sent:
        raise HTTPException(
            status_code=500,
            detail="Failed to send verification email",
        )

    return "Verification email sent"


async def verify_email_token(
    request: Request,
    db_session: Session,
    token: str,
    user_uuid: str,
    org_uuid: str,
) -> str:
    """
    Verify an email verification token and mark email as verified.

    Args:
        request: FastAPI request
        db_session: Database session
        token: Verification token
        user_uuid: User UUID
        org_uuid: Organization UUID

    Returns:
        Success message
    """
    # Get Redis connection
    r = get_redis_connection()

    # Look up token in Redis
    redis_key = f"email_verification:{user_uuid}:org:{org_uuid}:token:{token}"
    token_data = r.get(redis_key)

    if not token_data:
        raise HTTPException(
            status_code=400,
            detail="Invalid or expired verification token",
        )

    # Parse token data
    verification_data = json.loads(token_data)

    # Check if token has expired
    if verification_data["expires_at"] < datetime.now(timezone.utc).timestamp():
        r.delete(redis_key)
        raise HTTPException(
            status_code=400,
            detail="Verification token has expired",
        )

    # Verify user UUID matches
    if verification_data["user_uuid"] != user_uuid:
        raise HTTPException(
            status_code=400,
            detail="Invalid verification token",
        )

    # Get user from database
    statement = select(User).where(User.user_uuid == user_uuid)
    user = db_session.exec(statement).first()

    if not user:
        raise HTTPException(
            status_code=400,
            detail="User not found",
        )

    # Check if already verified
    if user.email_verified:
        # Delete token and return success
        r.delete(redis_key)
        return "Email already verified"

    # Mark email as verified
    user.email_verified = True
    user.email_verified_at = datetime.now(timezone.utc).isoformat()

    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    # Delete used token
    r.delete(redis_key)

    return "Email verified successfully"


async def resend_verification_email(
    request: Request,
    db_session: Session,
    email: EmailStr,
    org_id: int,
) -> str:
    """
    Resend verification email with rate limiting.

    Args:
        request: FastAPI request
        db_session: Database session
        email: User email
        org_id: Organization ID

    Returns:
        Success message
    """
    # Check rate limit
    is_allowed, retry_after = check_verification_resend_rate_limit(email)

    if not is_allowed:
        raise HTTPException(
            status_code=429,
            detail=f"Too many verification email requests. Please try again in {retry_after // 60} minutes.",
        )

    # Get user
    statement = select(User).where(User.email == email)
    user = db_session.exec(statement).first()

    if not user:
        # Don't reveal if email exists
        return "If an account with this email exists, a verification email has been sent"

    # Check if already verified
    if user.email_verified:
        return "Email is already verified"

    # Send verification email
    await send_verification_email(request, db_session, user, org_id)

    return "If an account with this email exists, a verification email has been sent"


def invalidate_verification_tokens(user_uuid: str, org_uuid: str) -> None:
    """
    Invalidate all verification tokens for a user.
    Called when user changes email or for security reasons.

    Args:
        user_uuid: User UUID
        org_uuid: Organization UUID
    """
    r = get_redis_connection()

    # Find and delete all tokens for this user/org
    pattern = f"email_verification:{user_uuid}:org:{org_uuid}:token:*"
    keys = r.keys(pattern)

    if keys:
        r.delete(*keys)
