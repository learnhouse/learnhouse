"""Demo-visitor AI cap failing closed, and the superadmin "set credits" helper.

The demo cap's happy path and 429 are covered in test_hardening_round4.py.
Here: when the counter store errors, the request is refused with 503 rather
than letting a visitor draw on the shared pool uncounted. ``set_ai_credits``
writes an absolute purchased balance (it does not add to it).
"""

from contextlib import contextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import fakeredis
import pytest
from fastapi import HTTPException

from src.security.features_utils import usage
from src.services.security import rate_limiting


@contextmanager
def acting_demo_visitor():
    """User 11 calling AI in demo org 5. Entered inside the test body so the
    ContextVar is set in the test's own context."""
    token = rate_limiting.ai_acting_user.set((11, 5))
    try:
        with patch("src.services.demo.guards.is_demo_org", AsyncMock(return_value=True)):
            yield
    finally:
        rate_limiting.ai_acting_user.reset(token)


class TestDemoVisitorCapStoreErrors:
    async def test_counter_store_error_fails_closed(self):
        broken = MagicMock()
        broken.incr.side_effect = ConnectionError("redis down")

        with acting_demo_visitor(), patch.object(usage, "_get_redis_client", return_value=broken):
            with pytest.raises(HTTPException) as exc_info:
                await usage._enforce_demo_visitor_ai_cap(5, MagicMock())

        assert exc_info.value.status_code == 503
        assert "temporarily unavailable" in exc_info.value.detail

    async def test_first_request_of_the_day_starts_an_expiring_counter(self):
        r = fakeredis.FakeRedis()

        with acting_demo_visitor(), patch.object(usage, "_get_redis_client", return_value=r):
            await usage._enforce_demo_visitor_ai_cap(5, MagicMock())

        (key,) = r.keys("ai_demo_daily:5:11:*")
        assert int(r.get(key)) == 1
        assert 0 < r.ttl(key) <= usage._DEMO_AI_DAILY_TTL_SECONDS


class TestSetAiCredits:
    def test_overwrites_the_purchased_balance(self):
        r = fakeredis.FakeRedis()
        r.set("ai_credits_purchased:3", 500)

        with patch.object(usage, "_get_redis_client", return_value=r):
            assert usage.set_ai_credits(3, 120) == 120

        assert int(r.get("ai_credits_purchased:3")) == 120
