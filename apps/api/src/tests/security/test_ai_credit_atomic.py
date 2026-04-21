"""
Regression tests for the F-06 atomic AI-credit reservation fix.

Before the fix, ``check_ai_credits`` + ``deduct_ai_credit`` were two separate
Redis operations, so N concurrent requests at ``remaining=1`` could all pass
the check and all decrement — burning N model calls while billing for 1.

``reserve_ai_credit`` bundles the check + increment into a single Redis Lua
script, so at most one caller can cross the boundary per reservation.
"""

from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from src.security.features_utils import usage


class _FakeRedis:
    """Minimal Redis stand-in covering only the methods ``usage`` uses. The
    production code no longer calls ``.eval`` directly; it goes through
    ``register_script``, which we emulate here with a callable that performs
    the same check-and-increment that the Lua script does atomically in
    real Redis.
    """

    def __init__(self):
        self._store: dict[str, int] = {}

    def get(self, key: str):
        val = self._store.get(key)
        return None if val is None else str(val).encode()

    def mget(self, *keys):
        return [self.get(k) for k in keys]

    def set(self, key: str, value):
        self._store[key] = int(value)

    def incrby(self, key: str, amount: int):
        self._store[key] = self._store.get(key, 0) + int(amount)
        return self._store[key]

    def register_script(self, src: str):
        fake = self
        is_reserve = "INCRBY" in src and "ARGV[4]" in src

        class _Script:
            def __call__(self, keys, args):
                if is_reserve:
                    used_key, purchased_key = keys[0], keys[1]
                    base = int(args[0])
                    extra = int(args[1])
                    amount = int(args[2])
                    unlimited = args[3] == "1"
                    if unlimited:
                        fake._store[used_key] = fake._store.get(used_key, 0) + amount
                        return fake._store[used_key]
                    purchased = fake._store.get(purchased_key, 0)
                    used = fake._store.get(used_key, 0)
                    total = base + extra + purchased
                    if total - used < amount:
                        return -1
                    fake._store[used_key] = used + amount
                    return fake._store[used_key]
                # refund script
                used_key = keys[0]
                decrement = int(args[0])
                current = fake._store.get(used_key, 0)
                new_val = max(0, current - decrement)
                fake._store[used_key] = new_val
                return new_val

        return _Script()


@pytest.fixture
def fake_redis():
    return _FakeRedis()


@pytest.fixture
def patched_usage(fake_redis):
    with patch.object(usage, "_get_redis_client", return_value=fake_redis), patch.object(
        usage, "_is_non_saas", return_value=False
    ), patch.object(
        usage,
        "_load_org_config_for_ai",
        return_value=MagicMock(config={"plan": "standard"}),
    ), patch.object(
        usage, "_get_org_plan", return_value="standard"
    ), patch.object(
        usage, "get_ai_credit_limit", return_value=10
    ), patch(
        "src.security.features_utils.resolve.resolve_feature",
        return_value={"enabled": True, "limit": 10},
    ):
        yield


def test_reserve_grants_when_under_limit(patched_usage, fake_redis):
    new_used = usage.reserve_ai_credit(org_id=1, db_session=MagicMock(), amount=1)
    assert new_used == 1
    assert fake_redis._store["ai_credits_used:1"] == 1


def test_reserve_rejects_at_limit(patched_usage, fake_redis):
    fake_redis.set("ai_credits_used:1", 10)
    with pytest.raises(HTTPException) as exc:
        usage.reserve_ai_credit(org_id=1, db_session=MagicMock(), amount=1)
    assert exc.value.status_code == 403
    assert fake_redis._store["ai_credits_used:1"] == 10


def test_reserve_rejects_oversize_request(patched_usage, fake_redis):
    fake_redis.set("ai_credits_used:1", 8)
    with pytest.raises(HTTPException):
        usage.reserve_ai_credit(org_id=1, db_session=MagicMock(), amount=5)
    assert fake_redis._store["ai_credits_used:1"] == 8


def test_concurrent_burst_cannot_exceed_limit(patched_usage, fake_redis):
    """50 rapid-fire calls with 3 remaining: only 3 succeed."""
    fake_redis.set("ai_credits_used:1", 7)

    successes = 0
    failures = 0
    for _ in range(50):
        try:
            usage.reserve_ai_credit(org_id=1, db_session=MagicMock(), amount=1)
            successes += 1
        except HTTPException:
            failures += 1

    assert successes == 3
    assert failures == 47
    assert fake_redis._store["ai_credits_used:1"] == 10


def test_refund_clamps_at_zero(patched_usage, fake_redis):
    fake_redis.set("ai_credits_used:1", 1)
    new_used = usage.refund_ai_credit(org_id=1, amount=5)
    assert new_used == 0
    assert fake_redis._store["ai_credits_used:1"] == 0


def test_refund_then_reserve_roundtrip(patched_usage, fake_redis):
    fake_redis.set("ai_credits_used:1", 9)

    usage.reserve_ai_credit(org_id=1, db_session=MagicMock(), amount=1)
    assert fake_redis._store["ai_credits_used:1"] == 10

    usage.refund_ai_credit(org_id=1, amount=1)
    assert fake_redis._store["ai_credits_used:1"] == 9

    usage.reserve_ai_credit(org_id=1, db_session=MagicMock(), amount=1)
    assert fake_redis._store["ai_credits_used:1"] == 10


def test_refund_no_op_on_zero_or_negative_amount(patched_usage, fake_redis):
    fake_redis.set("ai_credits_used:1", 5)
    assert usage.refund_ai_credit(org_id=1, amount=0) == 0
    assert usage.refund_ai_credit(org_id=1, amount=-3) == 0
    # Must not touch the counter.
    assert fake_redis._store["ai_credits_used:1"] == 5


# --- reserve_ai_credit early-exit branches ----------------------------------


def test_reserve_raises_404_when_org_has_no_config(fake_redis):
    with patch.object(usage, "_get_redis_client", return_value=fake_redis), patch.object(
        usage, "_load_org_config_for_ai", return_value=None
    ):
        with pytest.raises(HTTPException) as exc:
            usage.reserve_ai_credit(org_id=99, db_session=MagicMock(), amount=1)
    assert exc.value.status_code == 404


def test_reserve_raises_403_when_ai_feature_disabled(fake_redis):
    with patch.object(usage, "_get_redis_client", return_value=fake_redis), patch.object(
        usage,
        "_load_org_config_for_ai",
        return_value=MagicMock(config={"plan": "free"}),
    ), patch(
        "src.security.features_utils.resolve.resolve_feature",
        return_value={"enabled": False, "limit": 0},
    ):
        with pytest.raises(HTTPException) as exc:
            usage.reserve_ai_credit(org_id=1, db_session=MagicMock(), amount=1)
    assert exc.value.status_code == 403
    assert "not enabled" in exc.value.detail.lower()


def test_reserve_raises_403_on_free_plan_with_zero_credits(fake_redis):
    with patch.object(usage, "_get_redis_client", return_value=fake_redis), patch.object(
        usage, "_is_non_saas", return_value=False
    ), patch.object(
        usage,
        "_load_org_config_for_ai",
        return_value=MagicMock(config={"plan": "free"}),
    ), patch.object(
        usage, "_get_org_plan", return_value="free"
    ), patch.object(
        usage, "get_ai_credit_limit", return_value=0
    ), patch(
        "src.security.features_utils.resolve.resolve_feature",
        return_value={"enabled": True, "limit": 0},
    ):
        with pytest.raises(HTTPException) as exc:
            usage.reserve_ai_credit(org_id=1, db_session=MagicMock(), amount=1)
    assert exc.value.status_code == 403
    assert "free plan" in exc.value.detail.lower()


def test_reserve_in_non_saas_mode_increments_without_limit(fake_redis):
    """OSS/EE deployments track usage but never gate on the limit."""
    fake_redis.set("ai_credits_used:1", 9999)
    with patch.object(usage, "_get_redis_client", return_value=fake_redis), patch.object(
        usage, "_is_non_saas", return_value=True
    ), patch.object(
        usage,
        "_load_org_config_for_ai",
        return_value=MagicMock(config={"plan": "free"}),
    ), patch(
        "src.security.features_utils.resolve.resolve_feature",
        return_value={"enabled": True, "limit": 0},
    ):
        new_used = usage.reserve_ai_credit(org_id=1, db_session=MagicMock(), amount=2)
    assert new_used == 10001


def test_reserve_raises_503_when_redis_script_fails():
    failing_redis = MagicMock()
    failing_redis.register_script.side_effect = RuntimeError("lua boom")

    with patch.object(usage, "_get_redis_client", return_value=failing_redis), patch.object(
        usage, "_is_non_saas", return_value=False
    ), patch.object(
        usage,
        "_load_org_config_for_ai",
        return_value=MagicMock(config={"plan": "standard"}),
    ), patch.object(
        usage, "_get_org_plan", return_value="standard"
    ), patch.object(
        usage, "get_ai_credit_limit", return_value=100
    ), patch(
        "src.security.features_utils.resolve.resolve_feature",
        return_value={"enabled": True, "limit": 100},
    ):
        with pytest.raises(HTTPException) as exc:
            usage.reserve_ai_credit(org_id=1, db_session=MagicMock(), amount=1)
    assert exc.value.status_code == 503
    assert "temporarily unavailable" in exc.value.detail.lower()


def test_reserve_unlimited_plan_always_grants(fake_redis):
    """``base_credits == -1`` signals unlimited; every reserve succeeds."""
    fake_redis.set("ai_credits_used:1", 100)
    with patch.object(usage, "_get_redis_client", return_value=fake_redis), patch.object(
        usage, "_is_non_saas", return_value=False
    ), patch.object(
        usage,
        "_load_org_config_for_ai",
        return_value=MagicMock(config={"plan": "enterprise"}),
    ), patch.object(
        usage, "_get_org_plan", return_value="enterprise"
    ), patch.object(
        usage, "get_ai_credit_limit", return_value=-1
    ), patch(
        "src.security.features_utils.resolve.resolve_feature",
        return_value={"enabled": True, "limit": -1},
    ):
        new_used = usage.reserve_ai_credit(org_id=1, db_session=MagicMock(), amount=5)
    assert new_used == 105


def test_reserve_uses_v2_config_extra_limit(fake_redis):
    """v2 configs expose extra credits via ``overrides.ai.extra_limit``."""
    fake_redis.set("ai_credits_used:1", 10)
    v2_config = {
        "config_version": "2.0",
        "plan": "standard",
        "overrides": {"ai": {"extra_limit": 5}},
    }
    with patch.object(usage, "_get_redis_client", return_value=fake_redis), patch.object(
        usage, "_is_non_saas", return_value=False
    ), patch.object(
        usage,
        "_load_org_config_for_ai",
        return_value=MagicMock(config=v2_config),
    ), patch.object(
        usage, "_get_org_plan", return_value="standard"
    ), patch.object(
        usage, "get_ai_credit_limit", return_value=10
    ), patch(
        "src.security.features_utils.resolve.resolve_feature",
        return_value={"enabled": True, "limit": 10},
    ):
        # base 10 + extra 5 = 15 total; used=10, so 5 remaining. Take 5 → OK.
        new_used = usage.reserve_ai_credit(org_id=1, db_session=MagicMock(), amount=5)
    assert new_used == 15
