"""Tests for src/services/security/account_lockout.py."""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import Mock

from src.services.security.account_lockout import (
    check_account_locked,
    format_lockout_message,
    get_remaining_attempts,
    record_failed_login,
    reset_failed_attempts,
    update_login_info,
)


class TestAccountLockoutService:
    def test_check_account_locked_and_helpers(self):
        assert check_account_locked(SimpleNamespace(locked_until=None)) == (
            False,
            None,
        )
        assert check_account_locked(
            SimpleNamespace(locked_until="not-a-datetime")
        ) == (False, None)

        past_until = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
        assert check_account_locked(
            SimpleNamespace(locked_until=past_until)
        ) == (False, None)

        aware_future_until = (
            datetime.now(timezone.utc) + timedelta(hours=1)
        ).isoformat()
        locked, remaining = check_account_locked(
            SimpleNamespace(locked_until=aware_future_until)
        )
        assert locked is True
        assert remaining is not None
        assert remaining > 3500

        naive_future_until = (datetime.now() + timedelta(hours=1)).isoformat()
        locked, remaining = check_account_locked(
            SimpleNamespace(locked_until=naive_future_until)
        )
        assert locked is True
        assert remaining is not None
        assert remaining > 3500

        assert get_remaining_attempts(SimpleNamespace(failed_login_attempts=None)) == 10
        assert get_remaining_attempts(
            SimpleNamespace(failed_login_attempts=3)
        ) == 7
        assert get_remaining_attempts(
            SimpleNamespace(failed_login_attempts=12)
        ) == 0

        assert format_lockout_message(45) == "Account is locked. Please try again in 45 seconds."
        assert format_lockout_message(61) == "Account is locked. Please try again in 1 minute."
        assert format_lockout_message(120) == "Account is locked. Please try again in 2 minutes."

    def test_record_failed_login_below_threshold_and_missing_user(self):
        user = SimpleNamespace(id=1)
        db_session = Mock()
        below_threshold_result = Mock()
        below_threshold_result.scalar.return_value = None
        update_result = Mock()
        update_result.scalar.return_value = 1
        db_session.execute.side_effect = [below_threshold_result, update_result]

        is_locked, duration = record_failed_login(user, db_session)

        assert is_locked is False
        assert duration is None
        assert db_session.rollback.call_count == 0
        assert db_session.commit.call_count == 1

        missing_db_session = Mock()
        first_result = Mock()
        first_result.scalar.return_value = 9
        second_result = Mock()
        second_result.scalar.return_value = None
        missing_db_session.execute.side_effect = [first_result, second_result]

        is_locked, duration = record_failed_login(user, missing_db_session)

        assert is_locked is False
        assert duration is None
        missing_db_session.rollback.assert_called_once()
        assert missing_db_session.commit.call_count == 0

    def test_record_failed_login_threshold_locks_account(self):
        user = SimpleNamespace(id=1)
        db_session = Mock()
        first_result = Mock()
        first_result.scalar.return_value = 9
        second_result = Mock()
        second_result.scalar.return_value = 10
        lock_result = Mock()
        db_session.execute.side_effect = [first_result, second_result, lock_result]

        is_locked, duration = record_failed_login(user, db_session)

        assert is_locked is True
        assert duration == 300
        assert db_session.commit.call_count == 1
        assert db_session.rollback.call_count == 0
        assert db_session.execute.call_count == 3

    def test_reset_failed_attempts_and_update_login_info_found(self):
        user = SimpleNamespace(id=1)
        db_user = SimpleNamespace(
            failed_login_attempts=6,
            locked_until="2025-01-01T00:00:00+00:00",
            last_login_at=None,
            last_login_ip=None,
        )

        reset_result = Mock()
        reset_result.first.return_value = db_user
        update_result = Mock()
        update_result.first.return_value = db_user

        db_session = Mock()
        db_session.exec.side_effect = [reset_result, update_result]

        reset_failed_attempts(user, db_session)
        update_login_info(user, "127.0.0.1", db_session)

        assert db_user.failed_login_attempts == 0
        assert db_user.locked_until is None
        assert db_user.last_login_ip == "127.0.0.1"
        assert db_user.last_login_at is not None
        assert db_session.commit.call_count == 2

    def test_reset_failed_attempts_and_update_login_info_missing_user(self):
        user = SimpleNamespace(id=1)
        reset_result = Mock()
        reset_result.first.return_value = None
        update_result = Mock()
        update_result.first.return_value = None

        db_session = Mock()
        db_session.exec.side_effect = [reset_result, update_result]

        reset_failed_attempts(user, db_session)
        update_login_info(user, "127.0.0.1", db_session)

        assert db_session.commit.call_count == 0
