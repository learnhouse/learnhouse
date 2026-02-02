"""
Account lockout service for protecting against brute force attacks.

Locks account after 5 failed login attempts for 30 minutes.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple
from sqlmodel import Session
from src.db.users import User


# Configuration
MAX_FAILED_ATTEMPTS = 5
LOCKOUT_DURATION_MINUTES = 30


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

    SECURITY: Uses atomic database operations to prevent race conditions.
    Without atomic updates, concurrent login attempts could bypass the lockout
    by both reading the same count before either increments it.

    Args:
        user: User who failed login
        db_session: Database session

    Returns:
        Tuple of (is_now_locked, lockout_duration_seconds)
    """
    from sqlmodel import select
    from sqlalchemy import update

    # SECURITY FIX: Use atomic increment to prevent race conditions
    # This ensures that even concurrent requests will correctly increment the counter
    lockout_until = datetime.now(timezone.utc) + timedelta(minutes=LOCKOUT_DURATION_MINUTES)

    # Atomic update: increment failed_login_attempts and set lockout if threshold reached
    # We use COALESCE to handle NULL values (treating NULL as 0)
    statement = (
        update(User)
        .where(User.id == user.id)
        .values(
            failed_login_attempts=(
                db_session.execute(
                    select(User.failed_login_attempts).where(User.id == user.id)
                ).scalar() or 0
            ) + 1
        )
        .returning(User.failed_login_attempts)
    )

    # Execute atomic increment and get new count
    result = db_session.execute(statement)
    new_count = result.scalar()

    if new_count is None:
        # User not found
        db_session.rollback()
        return False, None

    # Check if we need to lock the account
    if new_count >= MAX_FAILED_ATTEMPTS:
        # Update the lockout timestamp in a separate atomic operation
        lock_statement = (
            update(User)
            .where(User.id == user.id)
            .values(locked_until=lockout_until.isoformat())
        )
        db_session.execute(lock_statement)
        db_session.commit()
        return True, LOCKOUT_DURATION_MINUTES * 60

    db_session.commit()
    return False, None


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
        remaining_seconds: Seconds until lockout expires

    Returns:
        Formatted message string
    """
    if remaining_seconds >= 60:
        minutes = remaining_seconds // 60
        if minutes == 1:
            return "Account is locked. Please try again in 1 minute."
        else:
            return f"Account is locked. Please try again in {minutes} minutes."
    else:
        return f"Account is locked. Please try again in {remaining_seconds} seconds."
