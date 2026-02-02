"""
Redis-based rate limiting service for authentication endpoints.

Rate limits:
- Login: 30 attempts per 5 minutes per IP
- Signup: 10 attempts per hour per IP
- Verification resend: 5 attempts per 5 minutes per email
"""
from typing import Optional, Tuple
import redis
from fastapi import HTTPException, Request
from config.config import get_learnhouse_config


class RateLimitExceeded(Exception):
    """Exception raised when rate limit is exceeded."""
    def __init__(self, message: str, retry_after: int):
        self.message = message
        self.retry_after = retry_after
        super().__init__(self.message)


def get_redis_connection() -> redis.Redis:
    """Get Redis connection from config."""
    LH_CONFIG = get_learnhouse_config()
    redis_conn_string = LH_CONFIG.redis_config.redis_connection_string

    if not redis_conn_string:
        raise HTTPException(
            status_code=500,
            detail="Redis connection string not found",
        )

    return redis.Redis.from_url(redis_conn_string)


def get_client_ip(request: Request) -> str:
    """
    Extract client IP from request, considering proxy headers.
    """
    # Check for forwarded headers (reverse proxy)
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        # Take the first IP in the chain (original client)
        return forwarded.split(",")[0].strip()

    # Check for real IP header
    real_ip = request.headers.get("X-Real-IP")
    if real_ip:
        return real_ip.strip()

    # Fall back to direct client host
    if request.client:
        return request.client.host

    return "unknown"


def check_rate_limit(
    key: str,
    max_attempts: int,
    window_seconds: int,
    r: Optional[redis.Redis] = None
) -> Tuple[bool, int, int]:
    """
    Check if rate limit is exceeded for a given key.

    Args:
        key: Unique identifier for rate limiting (e.g., "login:192.168.1.1")
        max_attempts: Maximum number of attempts allowed
        window_seconds: Time window in seconds
        r: Optional Redis connection (creates new one if not provided)

    Returns:
        Tuple of (is_allowed, current_count, seconds_until_reset)
    """
    if r is None:
        r = get_redis_connection()

    rate_limit_key = f"rate_limit:{key}"

    # Get current count
    current_count = r.get(rate_limit_key)
    ttl = r.ttl(rate_limit_key)

    if current_count is None:
        # First attempt - set counter with expiry
        r.setex(rate_limit_key, window_seconds, 1)
        return True, 1, window_seconds

    current_count = int(current_count)

    if current_count >= max_attempts:
        # Rate limit exceeded
        return False, current_count, ttl if ttl > 0 else window_seconds

    # Increment counter
    new_count = r.incr(rate_limit_key)
    return True, new_count, ttl if ttl > 0 else window_seconds


def check_login_rate_limit(request: Request) -> Tuple[bool, int]:
    """
    Check login rate limit: 30 attempts per 5 minutes per IP.

    Returns:
        Tuple of (is_allowed, retry_after_seconds)
    """
    ip = get_client_ip(request)
    key = f"login:{ip}"

    is_allowed, count, retry_after = check_rate_limit(
        key=key,
        max_attempts=30,
        window_seconds=5 * 60  # 5 minutes
    )

    return is_allowed, retry_after


def check_signup_rate_limit(request: Request) -> Tuple[bool, int]:
    """
    Check signup rate limit: 10 attempts per hour per IP.

    Returns:
        Tuple of (is_allowed, retry_after_seconds)
    """
    ip = get_client_ip(request)
    key = f"signup:{ip}"

    is_allowed, count, retry_after = check_rate_limit(
        key=key,
        max_attempts=10,
        window_seconds=60 * 60  # 1 hour
    )

    return is_allowed, retry_after


def check_verification_resend_rate_limit(email: str) -> Tuple[bool, int]:
    """
    Check verification email resend rate limit: 5 attempts per 5 minutes per email.

    Returns:
        Tuple of (is_allowed, retry_after_seconds)
    """
    key = f"verify_resend:{email.lower()}"

    is_allowed, count, retry_after = check_rate_limit(
        key=key,
        max_attempts=5,
        window_seconds=5 * 60  # 5 minutes
    )

    return is_allowed, retry_after


def increment_rate_limit(key: str, window_seconds: int) -> None:
    """
    Increment a rate limit counter for tracking purposes.
    Used when we want to count an action without checking.
    """
    r = get_redis_connection()
    rate_limit_key = f"rate_limit:{key}"

    if r.exists(rate_limit_key):
        r.incr(rate_limit_key)
    else:
        r.setex(rate_limit_key, window_seconds, 1)
