"""
Coverage for the F-08 session-revocation helpers in ``src/security/auth.py``.

The helpers intentionally fail open when Redis is unavailable — the JWT's
``exp`` claim and the ``password_changed_at`` check are still load-bearing.
These tests pin every branch: configured/unconfigured Redis, set/get roundtrip,
transient Redis errors, and the ``iat``-absent pre-upgrade token path.
"""

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

from src.security import auth as auth_module


class _FakeRedis:
    def __init__(self):
        self.store: dict[str, bytes] = {}
        self.ex: dict[str, int] = {}

    def setex(self, key, ttl, value):
        self.store[key] = str(value).encode()
        self.ex[key] = int(ttl)

    def get(self, key):
        return self.store.get(key)


def _patch_redis(fake):
    return patch.object(auth_module, "_get_revocation_redis_client", return_value=fake)


# ----------------------------------------------------------------------------
# _get_revocation_redis_client
# ----------------------------------------------------------------------------

def test_get_revocation_redis_client_returns_none_when_no_url():
    fake_config = MagicMock()
    fake_config.redis_config.redis_connection_string = None
    with patch.object(auth_module, "get_learnhouse_config", return_value=fake_config):
        assert auth_module._get_revocation_redis_client() is None


def test_get_revocation_redis_client_returns_client_when_configured():
    fake_config = MagicMock()
    fake_config.redis_config.redis_connection_string = "redis://localhost:6379/0"
    with patch.object(auth_module, "get_learnhouse_config", return_value=fake_config):
        client = auth_module._get_revocation_redis_client()
        # We don't actually want to connect — just confirm the code path returns
        # a Redis object (redis-py constructs lazily).
        assert client is not None


def test_get_revocation_redis_client_swallows_exceptions():
    with patch.object(
        auth_module, "get_learnhouse_config", side_effect=RuntimeError("boom")
    ):
        assert auth_module._get_revocation_redis_client() is None


# ----------------------------------------------------------------------------
# revoke_user_sessions_before
# ----------------------------------------------------------------------------

def test_revoke_user_sessions_returns_false_when_redis_unavailable():
    with _patch_redis(None):
        assert auth_module.revoke_user_sessions_before(1) is False


def test_revoke_user_sessions_writes_key_with_ttl():
    fake = _FakeRedis()
    cutoff = datetime(2026, 1, 1, tzinfo=timezone.utc)
    with _patch_redis(fake):
        ok = auth_module.revoke_user_sessions_before(42, cutoff=cutoff)
    assert ok is True
    assert "jwt_revoked_before:42" in fake.store
    assert fake.store["jwt_revoked_before:42"] == str(int(cutoff.timestamp())).encode()
    # TTL matches refresh-token lifetime.
    assert fake.ex["jwt_revoked_before:42"] == int(
        auth_module.JWT_REFRESH_TOKEN_EXPIRES.total_seconds()
    )


def test_revoke_user_sessions_defaults_cutoff_to_now():
    fake = _FakeRedis()
    before = int(datetime.now(timezone.utc).timestamp())
    with _patch_redis(fake):
        assert auth_module.revoke_user_sessions_before(7) is True
    after = int(datetime.now(timezone.utc).timestamp())
    stored = int(fake.store["jwt_revoked_before:7"])
    assert before <= stored <= after + 1


def test_revoke_user_sessions_returns_false_on_redis_error():
    bad = MagicMock()
    bad.setex.side_effect = RuntimeError("redis boom")
    with _patch_redis(bad):
        assert auth_module.revoke_user_sessions_before(3) is False


# ----------------------------------------------------------------------------
# _is_token_revoked_for_user
# ----------------------------------------------------------------------------

def test_is_token_revoked_returns_false_when_redis_unavailable():
    with _patch_redis(None):
        assert (
            auth_module._is_token_revoked_for_user(
                1, datetime.now(timezone.utc)
            )
            is False
        )


def test_is_token_revoked_returns_false_when_no_key():
    fake = _FakeRedis()
    with _patch_redis(fake):
        assert (
            auth_module._is_token_revoked_for_user(
                1, datetime.now(timezone.utc)
            )
            is False
        )


def test_is_token_revoked_true_when_iat_predates_cutoff():
    fake = _FakeRedis()
    cutoff = datetime.now(timezone.utc)
    fake.setex("jwt_revoked_before:5", 3600, int(cutoff.timestamp()))
    # Token issued 10 minutes before revocation — must be rejected.
    old_iat = cutoff - timedelta(minutes=10)
    with _patch_redis(fake):
        assert auth_module._is_token_revoked_for_user(5, old_iat) is True


def test_is_token_revoked_false_when_iat_postdates_cutoff():
    fake = _FakeRedis()
    cutoff = datetime.now(timezone.utc) - timedelta(hours=1)
    fake.setex("jwt_revoked_before:5", 3600, int(cutoff.timestamp()))
    # Token issued after revocation — must still be valid (user logged back in).
    new_iat = cutoff + timedelta(minutes=1)
    with _patch_redis(fake):
        assert auth_module._is_token_revoked_for_user(5, new_iat) is False


def test_is_token_revoked_handles_garbage_cutoff_value():
    fake = _FakeRedis()
    fake.store["jwt_revoked_before:6"] = b"not-an-int"
    with _patch_redis(fake):
        assert (
            auth_module._is_token_revoked_for_user(
                6, datetime.now(timezone.utc)
            )
            is False
        )


def test_is_token_revoked_handles_get_raising():
    bad = MagicMock()
    bad.get.side_effect = RuntimeError("redis boom")
    with _patch_redis(bad):
        assert (
            auth_module._is_token_revoked_for_user(
                6, datetime.now(timezone.utc)
            )
            is False
        )


# Pre-upgrade tokens (no ``iat``) --------------------------------------------

def test_is_token_revoked_without_iat_false_when_no_redis():
    with _patch_redis(None):
        assert auth_module._is_token_revoked_for_user(1, None) is False


def test_is_token_revoked_without_iat_false_when_no_key():
    fake = _FakeRedis()
    with _patch_redis(fake):
        assert auth_module._is_token_revoked_for_user(1, None) is False


def test_is_token_revoked_without_iat_true_when_key_exists():
    """
    A pre-upgrade token (no ``iat``) must be treated as revoked whenever the
    user has an active revocation key, otherwise logout would silently fail
    for any session minted before the fix shipped.
    """
    fake = _FakeRedis()
    fake.setex("jwt_revoked_before:9", 3600, int(datetime.now(timezone.utc).timestamp()))
    with _patch_redis(fake):
        assert auth_module._is_token_revoked_for_user(9, None) is True


def test_is_token_revoked_without_iat_swallows_redis_error():
    bad = MagicMock()
    bad.get.side_effect = RuntimeError("redis boom")
    with _patch_redis(bad):
        assert auth_module._is_token_revoked_for_user(9, None) is False
