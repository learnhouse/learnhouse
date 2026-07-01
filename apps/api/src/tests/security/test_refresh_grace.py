"""Tests for the redis-backed refresh-grace helpers in src/security/auth.py."""

import json
from unittest.mock import patch

from src.security.auth import _get_refresh_grace, _store_refresh_grace


class _FakeRedis:
    """Minimal in-memory stand-in for the revocation redis client."""

    def __init__(self):
        self.store: dict[str, object] = {}

    def setex(self, key, _ttl, value):
        self.store[key] = value

    def get(self, key):
        return self.store.get(key)


def test_store_and_get_roundtrip():
    fake = _FakeRedis()
    with patch("src.security.auth._get_revocation_redis_client", return_value=fake):
        _store_refresh_grace(1, "jti-1", "acc-token", "ref-token")
        got = _get_refresh_grace(1, "jti-1")
    assert got == {"access_token": "acc-token", "refresh_token": "ref-token"}


def test_get_missing_key_returns_none():
    fake = _FakeRedis()
    with patch("src.security.auth._get_revocation_redis_client", return_value=fake):
        assert _get_refresh_grace(1, "absent") is None


def test_helpers_noop_without_redis():
    with patch("src.security.auth._get_revocation_redis_client", return_value=None):
        # Neither should raise, and get returns None.
        _store_refresh_grace(1, "jti", "a", "b")
        assert _get_refresh_grace(1, "jti") is None


def test_get_decodes_bytes_payload():
    fake = _FakeRedis()
    fake.store["refresh_grace:2:j"] = json.dumps(
        {"access_token": "x", "refresh_token": "y"}
    ).encode("utf-8")
    with patch("src.security.auth._get_revocation_redis_client", return_value=fake):
        assert _get_refresh_grace(2, "j") == {"access_token": "x", "refresh_token": "y"}


def test_get_rejects_incomplete_payload():
    fake = _FakeRedis()
    fake.store["refresh_grace:2:bad"] = json.dumps({"access_token": "x"})
    with patch("src.security.auth._get_revocation_redis_client", return_value=fake):
        assert _get_refresh_grace(2, "bad") is None


class _BrokenRedis:
    """Redis stand-in whose operations raise, exercising the error fallbacks."""

    def setex(self, *_args):
        raise RuntimeError("redis down")

    def get(self, *_args):
        raise RuntimeError("redis down")


def test_store_swallows_redis_errors():
    with patch("src.security.auth._get_revocation_redis_client", return_value=_BrokenRedis()):
        # Must not raise — a failed cache write is best-effort.
        _store_refresh_grace(1, "jti", "a", "b")


def test_get_swallows_redis_errors():
    with patch("src.security.auth._get_revocation_redis_client", return_value=_BrokenRedis()):
        assert _get_refresh_grace(1, "jti") is None
