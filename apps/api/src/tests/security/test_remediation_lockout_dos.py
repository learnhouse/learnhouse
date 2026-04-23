"""
F-08: account lockout can't be weaponized as DoS from a single IP.

Negative test (original vuln): repeated failures from ONE IP no longer lock
the account. Positive test: failures from TWO distinct IPs still lock it so
the existing brute-force protection is preserved.
"""

from types import SimpleNamespace
from unittest.mock import Mock, patch

from sqlmodel import Session

from src.services.security import account_lockout


def test_single_ip_does_not_lock_account_even_past_threshold():
    """
    F-08: 10 failed attempts from the SAME IP must not trigger the lockout
    (distinct_ips < 2). Previously this was the DoS primitive — any attacker
    could lock any victim's account with 10 requests to /auth/login.
    """
    user = SimpleNamespace(id=7, locked_until=None)
    db_session = Mock(spec=Session)

    # Fake Redis reporting only one distinct IP for this account.
    with patch.object(
        account_lockout, "_record_failed_ip", return_value=1
    ):
        for _ in range(10):
            is_locked, _ = account_lockout.record_failed_login(
                user, db_session, ip_address="1.2.3.4"
            )

    # db_session.refresh is a Mock — so user.locked_until stays None — and
    # we expect no lock.
    assert user.locked_until is None
    assert is_locked is False


def test_multi_ip_failures_still_lock_account(monkeypatch):
    """
    Distributed brute-force (attempts across ≥2 IPs) still locks the account.
    F-08 closes the DoS amplifier, not the legitimate lockout.
    """
    # Simulate Redis reporting 3 distinct IPs.
    monkeypatch.setattr(
        account_lockout, "_record_failed_ip", lambda user_id, ip: 3
    )

    # Post-refresh, DB would stamp locked_until into the future; the mocked
    # refresh copies that value back. We simulate by setting it directly.
    future = "2999-01-01T00:00:00+00:00"
    user = SimpleNamespace(id=8, locked_until=future)
    db_session = Mock(spec=Session)

    is_locked, duration = account_lockout.record_failed_login(
        user, db_session, ip_address="2.2.2.2"
    )

    assert is_locked is True
    assert duration == account_lockout.LOCKOUT_DURATION_MINUTES * 60


def test_record_failed_login_is_backwards_compatible_without_ip():
    """
    Existing callers that did not pass ``ip_address`` still work (the kwarg
    is optional). Without an IP we treat ``distinct_ips=1`` (no lock via the
    new guard), preserving the original "lockout only via the DB counter"
    semantics for legacy call sites.
    """
    user = SimpleNamespace(id=9, locked_until=None)
    db_session = Mock(spec=Session)

    # Should not raise TypeError.
    is_locked, duration = account_lockout.record_failed_login(user, db_session)
    assert is_locked is False
    assert duration is None
