"""Tests that count-limited features are enforced against actual DB rows.

Regression guard: usergroups/podcasts/assignments were enforced via a mutable
Redis counter that could drift or be lost, silently disabling the limit (e.g. a
free org exceeding its 5-assignment cap). They are now counted from live rows.
"""
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from src.security.features_utils import usage
from src.security.features_utils.usage import (
    DB_COUNTED_FEATURES,
    check_limits_with_usage,
)


def test_db_counted_features_include_the_drift_prone_ones():
    for f in ("usergroups", "podcasts", "assignments", "members", "courses", "admin_seats"):
        assert f in DB_COUNTED_FEATURES


@pytest.mark.asyncio
async def test_get_actual_usage_routes_row_counted_features():
    # The usergroups/podcasts/assignments helpers count live rows via scalar_one.
    from src.security.features_utils.usage import _get_actual_usage

    db = AsyncMock()
    db.execute = AsyncMock(return_value=SimpleNamespace(scalar_one=lambda: 7))
    for feat in ("usergroups", "podcasts", "assignments", "members", "courses"):
        assert await _get_actual_usage(feat, 1, db) == 7
    assert await _get_actual_usage("unknown_feature", 1, db) == 0


async def _run_check(*, feature, limit, plan, actual, enabled=True):
    patches = [
        patch.object(usage, "_get_org_config", AsyncMock(return_value=SimpleNamespace(config={}))),
        patch.object(usage, "_get_org_plan", return_value=plan),
        patch.object(usage, "_get_actual_usage", AsyncMock(return_value=actual)),
        patch("src.security.features_utils.resolve.resolve_feature",
              return_value={"enabled": enabled, "limit": limit}),
    ]
    for p in patches:
        p.start()
    try:
        return await check_limits_with_usage(feature, 1, AsyncMock())
    finally:
        for p in patches:
            p.stop()


@pytest.mark.asyncio
async def test_assignments_free_blocks_at_actual_row_limit():
    # Free assignments limit is 5; with 5 real rows the next create is blocked,
    # regardless of any Redis counter value.
    with pytest.raises(HTTPException) as exc:
        await _run_check(feature="assignments", limit=5, plan="free", actual=5)
    assert exc.value.status_code == 403
    assert "Assignments" in exc.value.detail


@pytest.mark.asyncio
async def test_assignments_free_allows_under_limit():
    assert await _run_check(feature="assignments", limit=5, plan="free", actual=4) is True


@pytest.mark.asyncio
async def test_paid_plan_gets_overage():
    # A paid plan at/over a numeric limit is allowed (billing tracks overage).
    assert await _run_check(feature="assignments", limit=5, plan="pro", actual=99) is True


@pytest.mark.asyncio
async def test_unlimited_limit_zero_passes():
    assert await _run_check(feature="podcasts", limit=0, plan="free", actual=999) is True


@pytest.mark.asyncio
async def test_disabled_feature_blocked_regardless_of_count():
    # usergroups is disabled on free → blocked even with zero rows.
    with pytest.raises(HTTPException) as exc:
        await _run_check(feature="usergroups", limit=0, plan="free", actual=0, enabled=False)
    assert exc.value.status_code == 403
