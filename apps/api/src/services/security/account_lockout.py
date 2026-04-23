"""
Account lockout service.

Locks an account after 10 failed login attempts for 5 minutes — but only
when the attempts span multiple source IPs. Per-account lockout paired with
IP-only login rate limiting would otherwise be a DoS amplifier: a single
attacker rotating IPs could lock any account with 10 requests while staying
under the per-IP rate cap. Multi-IP gating ensures a single misbehaving
client (e.g. a stale password in a keychain) can't trigger a lock on its own.
"""
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple
from sqlmodel import Session
from src.db.users import User


logger = logging.getLogger(__name__)

# Configuration
MAX_FAILED_ATTEMPTS = 10
LOCKOUT_DURATION_MINUTES = 5
# Rolling window over which distinct IPs are counted for lockout eligibility.
FAILED_IP_WINDOW_SECONDS = 30 * 60


def _record_failed_ip(user_id: int, ip_address: Optional[str]) -> int:
    """
    Record a failed-login IP for this user and return the approximate count of
    distinct IPs that have hit this account in the current window. Uses Redis
    HyperLogLog so the storage is O(12KB) per account regardless of volume.

    Returns 1 (i.e. "only one IP observed") if Redis is unavailable or the
    caller did not supply an IP, so behaviour matches the historical
    per-account counter in degraded environments.
    """
    if not ip_address:
        return 1
    try:
        from src.services.security.rate_limiting import get_redis_connection
        r = get_redis_connection()
        key = f"failed_login_ips:{user_id}"
        r.pfadd(key, ip_address)
        r.expire(key, FAILED_IP_WINDOW_SECONDS)
        return int(r.pfcount(key) or 1)
    except Exception:
        logger.debug("Redis unavailable for failed-login IP tracking", exc_info=True)
        return 1


def check_account_locked(user: User) -> Tuple[bool, Optional[int]]:
    """
    Check if a user account is currently locked.

    Args:
        user: User object to check

    Returns:
        Tuple of (is_locked, remaining_seconds)
        - is_locked: True if account is locked
        - remaining_seconds: Seconds until lock expires (None if not locked)
    """
    if not user.locked_until:
        return False, None

    try:
        locked_until = datetime.fromisoformat(user.locked_until)
        # Ensure timezone awareness
        if locked_until.tzinfo is None:
            locked_until = locked_until.replace(tzinfo=timezone.utc)

        now = datetime.now(timezone.utc)

        if now < locked_until:
            remaining = int((locked_until - now).total_seconds())
            return True, remaining
        else:
            # Lock has expired
            return False, None
    except (ValueError, TypeError):
        # Invalid date format, treat as not locked
        return False, None


def record_failed_login(
    user: User,
    db_session: Session,
    ip_address: Optional[str] = None,
) -> Tuple[bool, Optional[int]]:
    """
    Record a failed login attempt and lock the account if the threshold is
    reached AND the attempts originated from more than one source IP.

    Uses a single atomic SQL UPDATE so concurrent login attempts can't
    bypass the lockout by both reading the counter before either increments.

    The lockout only engages when ``distinct_ips >= 2`` in the tracking
    window — see the module docstring for why single-IP lockouts would be
    a DoS amplifier. The failure counter still increments for single-IP
    attacks so the audit trail is preserved, but ``locked_until`` stays
    unset; the existing per-IP login rate limiter handles that case.

    Args:
        user: User who failed login
        db_session: Database session
        ip_address: Source IP of the failed attempt. Optional for backwards
            compatibility; callers should supply it whenever available.

    Returns:
        Tuple of (is_now_locked, lockout_duration_seconds)
    """
    from sqlalchemy import update, case, func

    distinct_ips = _record_failed_ip(user.id, ip_address)
    MIN_DISTINCT_IPS_FOR_LOCK = 2

    lock_trigger = (
        (User.failed_login_attempts + 1 >= MAX_FAILED_ATTEMPTS)
        if distinct_ips >= MIN_DISTINCT_IPS_FOR_LOCK
        else False
    )

    stmt = (
        update(User)
        .where(User.id == user.id)
        .values(
            failed_login_attempts=User.failed_login_attempts + 1,
            locked_until=case(
                (
                    lock_trigger,
                    func.now() + timedelta(minutes=LOCKOUT_DURATION_MINUTES),
                ),
                else_=User.locked_until,
            ),
        )
        .execution_options(synchronize_session="fetch")
    )
    db_session.execute(stmt)
    db_session.commit()

    # Refresh the user object so callers see the updated values
    db_session.refresh(user)

    # Check whether the updated locked_until is actually in the future.
    # user.locked_until may hold an expired timestamp from a previous lockout
    # if reset_failed_attempts was never called (e.g. the user never logged in
    # successfully after the last lockout expired).
    is_locked = False
    if user.locked_until:
        try:
            lu = datetime.fromisoformat(str(user.locked_until))
            if lu.tzinfo is None:
                lu = lu.replace(tzinfo=timezone.utc)
            is_locked = datetime.now(timezone.utc) < lu
        except (ValueError, TypeError):
            is_locked = False
    return is_locked, LOCKOUT_DURATION_MINUTES * 60 if is_locked else None


def reset_failed_attempts(user: User, db_session: Session) -> None:
    """
    Reset failed login attempts counter on successful login.

    Args:
        user: User who logged in successfully
        db_session: Database session
    """
    from sqlmodel import select

    # Fetch fresh user from session to avoid detached object issues
    statement = select(User).where(User.id == user.id)
    db_user = db_session.exec(statement).first()

    if not db_user:
        return

    db_user.failed_login_attempts = 0
    db_user.locked_until = None
    db_session.commit()


def update_login_info(user: User, ip_address: str, db_session: Session) -> None:
    """
    Update last login information on successful login.

    Args:
        user: User who logged in
        ip_address: Client IP address
        db_session: Database session
    """
    from sqlmodel import select

    # Fetch fresh user from session to avoid detached object issues
    statement = select(User).where(User.id == user.id)
    db_user = db_session.exec(statement).first()

    if not db_user:
        return

    db_user.last_login_at = datetime.now(timezone.utc).isoformat()
    db_user.last_login_ip = ip_address
    db_session.commit()


def get_remaining_attempts(user: User) -> int:
    """
    Get the number of remaining login attempts before lockout.

    Args:
        user: User to check

    Returns:
        Number of remaining attempts
    """
    current_attempts = user.failed_login_attempts or 0
    remaining = MAX_FAILED_ATTEMPTS - current_attempts
    return max(0, remaining)


def format_lockout_message(remaining_seconds: int) -> str:
    """
    Format a human-readable lockout message.

    Args:
        remaining_seconds: Seconds until lockout expires (used for internal
            logging only; not exposed in the returned message to avoid leaking
            exact timing information to clients)

    Returns:
        Generic message string that does not reveal the remaining lock duration
    """
    # SECURITY: Do not include the exact remaining duration in the user-facing
    # message — it leaks information that could help an attacker time requests
    # to avoid triggering the lockout check.  The remaining_seconds argument is
    # retained so callers can still log the actual value for operations purposes.
    return "Account is temporarily locked due to too many failed login attempts. Please try again later."
