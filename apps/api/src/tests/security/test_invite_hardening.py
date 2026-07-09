"""Tests for invite-abuse hardening: batch-size cap, per-org/per-user daily
invite rate limit, and generic batch-size guard.

Regression guard for the phishing-relay incident (400+ invites blasted from a
fresh free org, exhausting the shared email quota)."""
import pytest
from fastapi import HTTPException

from src.services.security import rate_limiting
from src.services.security.rate_limiting import (
    check_invite_rate_limit,
    enforce_batch_size_limit,
    enforce_invite_rate_limit,
)


class _FakeRedis:
    """Minimal Redis stand-in covering the ops the invite limiter uses."""

    def __init__(self):
        self._store = {}
        self._ttl = {}

    def get(self, key):
        val = self._store.get(key)
        return None if val is None else str(val).encode()

    def ttl(self, key):
        return self._ttl.get(key, -2)

    def incrby(self, key, amount):
        self._store[key] = self._store.get(key, 0) + int(amount)
        return self._store[key]

    def expire(self, key, seconds):
        self._ttl[key] = seconds


@pytest.fixture
def fake_redis(monkeypatch):
    r = _FakeRedis()
    monkeypatch.setattr(rate_limiting, "get_redis_connection", lambda: r)
    return r


# ---- batch-size caps -------------------------------------------------------

def test_enforce_batch_size_limit_passes_under_cap():
    enforce_batch_size_limit(10, "users", max_size=100)  # no raise


def test_enforce_batch_size_limit_raises_over_cap():
    with pytest.raises(HTTPException) as exc:
        enforce_batch_size_limit(101, "users", max_size=100)
    assert exc.value.status_code == 400
    assert exc.value.detail["code"] == "BATCH_TOO_LARGE"
    assert exc.value.detail["max_batch_size"] == 100


# ---- invite rate limit -----------------------------------------------------

def test_invite_rate_limit_allows_within_ceiling(fake_redis, monkeypatch):
    monkeypatch.setattr(rate_limiting, "INVITE_ORG_MAX_PER_DAY", 10)
    monkeypatch.setattr(rate_limiting, "INVITE_USER_MAX_PER_DAY", 10)
    allowed, _ = check_invite_rate_limit(org_id=1, user_id=2, count=5)
    assert allowed is True
    # Reserved capacity persisted in both buckets.
    assert fake_redis.get("rate_limit:invite_send:org:1") == b"5"
    assert fake_redis.get("rate_limit:invite_send:user:2") == b"5"


def test_invite_rate_limit_blocks_when_batch_would_exceed(fake_redis, monkeypatch):
    monkeypatch.setattr(rate_limiting, "INVITE_ORG_MAX_PER_DAY", 5)
    monkeypatch.setattr(rate_limiting, "INVITE_USER_MAX_PER_DAY", 100)
    assert check_invite_rate_limit(1, 2, count=5)[0] is True
    # Next invite would make 6 > 5 → blocked, and nothing further reserved.
    allowed, retry_after = check_invite_rate_limit(1, 2, count=1)
    assert allowed is False
    assert retry_after > 0
    assert fake_redis.get("rate_limit:invite_send:org:1") == b"5"


def test_invite_rate_limit_org_bucket_independent_of_user(fake_redis, monkeypatch):
    monkeypatch.setattr(rate_limiting, "INVITE_ORG_MAX_PER_DAY", 100)
    monkeypatch.setattr(rate_limiting, "INVITE_USER_MAX_PER_DAY", 3)
    assert check_invite_rate_limit(org_id=1, user_id=2, count=3)[0] is True
    # Same user, different org: user bucket already exhausted → blocked.
    assert check_invite_rate_limit(org_id=9, user_id=2, count=1)[0] is False


def test_enforce_invite_rate_limit_raises_429_with_retry_after(fake_redis, monkeypatch):
    monkeypatch.setattr(rate_limiting, "INVITE_ORG_MAX_PER_DAY", 1)
    monkeypatch.setattr(rate_limiting, "INVITE_USER_MAX_PER_DAY", 100)
    enforce_invite_rate_limit(1, 2, count=1)  # first ok
    with pytest.raises(HTTPException) as exc:
        enforce_invite_rate_limit(1, 2, count=1)
    assert exc.value.status_code == 429
    assert exc.value.detail["code"] == "RATE_LIMITED"
    assert "Retry-After" in exc.value.headers
