"""get_context reports the organization's AI credits, best effort: an
unreadable balance is null and never fails the call."""

from unittest.mock import AsyncMock, patch

import pytest

from src.services.ai.tools import ToolRegistry, discovery, run_tool
from src.tests.services.ai_tools.test_discovery import ctx_for, ok

SUMMARY = "src.security.features_utils.usage.get_ai_credits_summary"


@pytest.fixture
def registry():
    r = ToolRegistry()
    r.register_all(discovery.SPECS)
    return r


async def _credits(registry, db, org, user, summary=None, error=None):
    mock = AsyncMock(return_value=summary, side_effect=error)
    with patch(SUMMARY, new=mock):
        return ok(await run_tool(registry, "get_context", {}, ctx_for(db, org, user)))["ai_credits"]


async def test_limited_plan(registry, db, org, admin_user):
    credits = await _credits(registry, db, org, admin_user, {
        "plan": "standard", "base_credits": 500, "purchased_credits": 100, "total_credits": 600,
        "used_credits": 120, "remaining_credits": 480,
    })
    assert credits == {"used": 120, "limit": 600, "remaining": 480, "unlimited": False, "purchased": 100, "resets_at": None}


async def test_unlimited(registry, db, org, admin_user):
    credits = await _credits(registry, db, org, admin_user, {
        "plan": "enterprise", "base_credits": "unlimited", "purchased_credits": 0, "total_credits": "unlimited",
        "used_credits": 42, "remaining_credits": "unlimited",
    })
    assert credits["unlimited"] is True and credits["used"] == 42
    assert credits["limit"] is None and credits["remaining"] is None


async def test_unreadable_balance_is_null(registry, db, org, admin_user):
    assert await _credits(registry, db, org, admin_user, {"error": "Organization has no config"}) is None
    assert await _credits(registry, db, org, admin_user, error=RuntimeError("redis down")) is None
