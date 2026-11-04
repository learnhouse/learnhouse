"""Redis-backed security helpers: real behaviour on a fake Redis, and graceful
degradation when Redis misbehaves.

Covers:
  * account lockout counting distinct source IPs (HyperLogLog), so a lock needs
    attempts from more than one IP, and falling back to "one IP" when Redis is
    down;
  * the per-token / per-user rate limiters for admin provisioning, admin
    lookups and search (keys and ceilings);
  * activity tracking falling through to the DB when the Redis day-guard
    errors, and never raising out of the background task.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import fakeredis
import pytest

from src.db.users import User
from src.services.security import activity
from src.services.security.account_lockout import (
    FAILED_IP_WINDOW_SECONDS,
    MAX_FAILED_ATTEMPTS,
    record_failed_login,
)
from src.services.security.rate_limiting import (
    check_admin_user_lookup_rate_limit,
    check_admin_user_provision_rate_limit,
    check_search_rate_limit,
)


@pytest.fixture
def fake_redis():
    r = fakeredis.FakeRedis()
    with patch(
        "src.services.security.rate_limiting.get_redis_connection", return_value=r
    ):
        yield r


async def _two_attempts_from_lock(db, public_user) -> User:
    """The DB row for ``public_user``, two failures short of the threshold."""
    user = await db.get(User, public_user.id)
    user.failed_login_attempts = MAX_FAILED_ATTEMPTS - 2
    user.locked_until = None
    await db.commit()
    return user


class TestLockoutDistinctIps:
    async def test_attempts_from_two_ips_lock_the_account(self, db, regular_user, fake_redis):
        user = await _two_attempts_from_lock(db, regular_user)

        locked, _ = await record_failed_login(user, db, ip_address="10.0.0.1")
        assert locked is False  # one IP so far, and still under the threshold

        locked, duration = await record_failed_login(user, db, ip_address="10.0.0.2")

        assert locked is True
        assert duration == 5 * 60
        assert user.failed_login_attempts == MAX_FAILED_ATTEMPTS
        key = f"failed_login_ips:{user.id}"
        assert fake_redis.pfcount(key) == 2
        assert 0 < fake_redis.ttl(key) <= FAILED_IP_WINDOW_SECONDS

    async def test_attempts_from_a_single_ip_never_lock(self, db, regular_user, fake_redis):
        """One misbehaving client (a stale keychain password) must not be able
        to lock the account on its own; the per-IP limiter handles it."""
        user = await _two_attempts_from_lock(db, regular_user)

        await record_failed_login(user, db, ip_address="10.0.0.1")
        locked, duration = await record_failed_login(user, db, ip_address="10.0.0.1")

        assert locked is False
        assert duration is None
        assert user.failed_login_attempts == MAX_FAILED_ATTEMPTS
        assert user.locked_until is None

    async def test_redis_failure_counts_as_a_single_ip(self, db, regular_user):
        user = await _two_attempts_from_lock(db, regular_user)
        broken = MagicMock()
        broken.pfadd.side_effect = ConnectionError("redis down")

        with patch(
            "src.services.security.rate_limiting.get_redis_connection", return_value=broken
        ):
            await record_failed_login(user, db, ip_address="10.0.0.1")
            locked, _ = await record_failed_login(user, db, ip_address="10.0.0.2")

        assert locked is False
        assert user.failed_login_attempts == MAX_FAILED_ATTEMPTS


class TestPerPrincipalRateLimiters:
    @pytest.mark.parametrize(
        "limiter, arg, key, max_attempts",
        [
            (check_admin_user_provision_rate_limit, 7, "admin_user_provision:7", 30),
            (check_admin_user_lookup_rate_limit, 7, "admin_user_lookup:7", 60),
            (check_search_rate_limit, 42, "search:42", 60),
        ],
    )
    def test_key_and_ceiling(self, limiter, arg, key, max_attempts):
        with patch(
            "src.services.security.rate_limiting.check_rate_limit",
            return_value=(False, max_attempts + 1, 37),
        ) as check:
            assert limiter(arg) == (False, 37)

        check.assert_called_once_with(key=key, max_attempts=max_attempts, window_seconds=60)

    def test_allowed_until_ceiling_on_real_counter(self, fake_redis):
        for _ in range(30):
            allowed, _retry = check_admin_user_provision_rate_limit(99)
            assert allowed is True

        allowed, retry_after = check_admin_user_provision_rate_limit(99)
        assert allowed is False
        assert 0 < retry_after <= 60


class TestActivityRedisGuard:
    async def test_guard_error_falls_through_to_db_insert(self):
        broken = MagicMock()
        broken.set.side_effect = ConnectionError("redis down")
        insert = AsyncMock(return_value=True)

        with patch.object(activity, "_activity_tracking_enabled", return_value=True), patch.object(
            activity, "get_redis_client", return_value=broken
        ), patch.object(activity, "_insert_activity_row", insert):
            await activity.record_user_activity(5, org_id=3)

        # The row is still written; the unique constraint keeps it idempotent.
        insert.assert_awaited_once()
        assert insert.await_args.args[:2] == (3, 5)

    async def test_unexpected_failure_never_escapes_the_background_task(self):
        insert = AsyncMock()

        with patch.object(activity, "_activity_tracking_enabled", return_value=True), patch.object(
            activity, "_resolve_org_id", AsyncMock(side_effect=RuntimeError("db gone"))
        ), patch.object(activity, "_insert_activity_row", insert):
            # Must not raise.
            assert await activity.record_user_activity(5, org_slug="acme") is None

        insert.assert_not_awaited()
