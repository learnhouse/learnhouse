"""
Account lockout service for protecting against brute force attacks.

Locks account after 10 failed login attempts for 5 minutes.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple
from sqlmodel import Session
from src.db.users import User


# Configuration
MAX_FAILED_ATTEMPTS = 10
LOCKOUT_DURATION_MINUTES = 5


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


def record_failed_login(user: User, db_session: Session) -> Tuple[bool, Optional[int]]:
    """
    Record a failed login attempt and lock account if threshold is reached.

    SECURITY: Uses a single atomic SQL UPDATE to prevent race conditions.
    Without atomic updates, concurrent login attempts could bypass the lockout
    by both reading the same count before either increments it.

    Args:
        user: User who failed login
        db_session: Database session

    Returns:
        Tuple of (is_now_locked, lockout_duration_seconds)
    """
    from sqlalchemy import update, case, func

    # Single atomic statement: increment the counter AND conditionally set
    # locked_until when the threshold is reached — no separate read or second
    # UPDATE required.
    stmt = (
        update(User)
        .where(User.id == user.id)
        .values(
            failed_login_attempts=User.failed_login_attempts + 1,
            locked_until=case(
                (
                    User.failed_login_attempts + 1 >= MAX_FAILED_ATTEMPTS,
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
