"""
Regression tests for F-9: per-user and per-org AI rate limiting.

Before the fix, AI endpoints had no concurrency throttle — credits alone
gated spend but not request rate. A single authenticated user could flood
``/ai/*``, ``/boards/playground/*``, ``/playgrounds/generator``,
``/ai/courseplanning/*``, etc., and exhaust provider capacity or monopolise
worker threads for every tenant on the node.

``enforce_ai_rate_limit`` is the new shared gate. These tests pin its
contract: a per-user cap, an independent per-org cap, 429 with
``Retry-After``, and the existing ``{"code":"RATE_LIMITED",...}`` error
envelope so the frontend doesn't need to learn a new shape.
"""
import pytest
from fastapi import HTTPException

from src.services.security import rate_limiting


@pytest.fixture
def fake_redis(monkeypatch):
    """An in-memory Redis stub good enough for the rate-limit counters."""
    store: dict[str, tuple[int, int]] = {}

    class _Redis:
        def get(self, key):
            v = store.get(key)
            return v[0] if v else None

        def setex(self, key, ttl, value):
            store[key] = (int(value), ttl)

        def incr(self, key):
            current = store.get(key, (0, 60))
            new = current[0] + 1
            store[key] = (new, current[1])
            return new

        def ttl(self, key):
            v = store.get(key)
            return v[1] if v else -2

    fake = _Redis()
    monkeypatch.setattr(rate_limiting, "get_redis_connection", lambda: fake)
    monkeypatch.setattr(rate_limiting, "AI_USER_MAX_REQUESTS_PER_MINUTE", 3)
    monkeypatch.setattr(rate_limiting, "AI_ORG_MAX_REQUESTS_PER_MINUTE", 100)
    monkeypatch.setattr(rate_limiting, "AI_RATE_LIMIT_WINDOW_SECONDS", 60)
    return fake


def test_user_bucket_allows_up_to_limit(fake_redis):
    """Every call under the per-user ceiling is allowed."""
    for _ in range(3):
        allowed, retry = rate_limiting.check_ai_rate_limit(user_id=1, org_id=1)
        assert allowed is True
        assert retry > 0


def test_user_bucket_denies_over_limit(fake_redis):
    """One request over the per-user ceiling is denied with a retry hint."""
    for _ in range(3):
        rate_limiting.check_ai_rate_limit(user_id=1, org_id=1)
    allowed, retry = rate_limiting.check_ai_rate_limit(user_id=1, org_id=1)
    assert allowed is False
    assert retry > 0


def test_separate_users_have_independent_buckets(fake_redis):
    """User A exhausting their bucket must not affect User B."""
    for _ in range(3):
        rate_limiting.check_ai_rate_limit(user_id=1, org_id=1)
    # user 1 is capped
    capped, _ = rate_limiting.check_ai_rate_limit(user_id=1, org_id=1)
    assert capped is False
    # user 2 is fresh
    allowed, _ = rate_limiting.check_ai_rate_limit(user_id=2, org_id=1)
    assert allowed is True


def test_separate_orgs_have_independent_buckets(fake_redis, monkeypatch):
    """Org A hitting its ceiling must not leak into org B's bucket."""
    monkeypatch.setattr(rate_limiting, "AI_USER_MAX_REQUESTS_PER_MINUTE", 100)
    monkeypatch.setattr(rate_limiting, "AI_ORG_MAX_REQUESTS_PER_MINUTE", 2)
    # Use different users so the org bucket is the constraining factor.
    rate_limiting.check_ai_rate_limit(user_id=1, org_id=1)
    rate_limiting.check_ai_rate_limit(user_id=2, org_id=1)
    over, retry = rate_limiting.check_ai_rate_limit(user_id=3, org_id=1)
    assert over is False
    assert retry > 0

    fresh, _ = rate_limiting.check_ai_rate_limit(user_id=3, org_id=2)
    assert fresh is True


def test_enforce_ai_rate_limit_raises_429_with_retry_after(fake_redis):
    """Over-limit calls raise 429 with Retry-After header and the shared envelope."""
    for _ in range(3):
        rate_limiting.enforce_ai_rate_limit(user_id=1, org_id=1)

    with pytest.raises(HTTPException) as exc_info:
        rate_limiting.enforce_ai_rate_limit(user_id=1, org_id=1)

    assert exc_info.value.status_code == 429
    # Shared error envelope — frontend already handles this for auth routes.
    detail = exc_info.value.detail
    assert isinstance(detail, dict)
    assert detail["code"] == "RATE_LIMITED"
    assert isinstance(detail["retry_after"], int) and detail["retry_after"] > 0
    # Retry-After header is present so plain HTTP clients also honour it.
    assert "Retry-After" in exc_info.value.headers
    assert int(exc_info.value.headers["Retry-After"]) > 0


def test_enforce_ai_rate_limit_passes_when_under_limit(fake_redis):
    """Legitimate calls do not raise."""
    rate_limiting.enforce_ai_rate_limit(user_id=1, org_id=1)
