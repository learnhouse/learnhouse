"""Tests for counting pending invites toward the members limit.

Before this, ``check_limits_with_usage("members")`` counted only joined
members, so a free org at its cap could still queue unbounded pending invites.
"""
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from src.security.features_utils import usage
from src.security.features_utils.usage import check_members_limit_with_pending


def _patches(*, limit, plan, member_count, enabled=True):
    return [
        patch.object(usage, "_get_org_config", AsyncMock(return_value=SimpleNamespace(config={}))),
        patch.object(usage, "_get_org_plan", return_value=plan),
        patch.object(usage, "_get_actual_member_count", AsyncMock(return_value=member_count)),
        patch(
            "src.security.features_utils.resolve.resolve_feature",
            return_value={"enabled": enabled, "limit": limit},
        ),
    ]


async def _run(**kw):
    pending_and_new = kw.pop("pending_and_new")
    ps = _patches(**kw)
    for p in ps:
        p.start()
    try:
        return await check_members_limit_with_pending(1, pending_and_new, AsyncMock())
    finally:
        for p in ps:
            p.stop()


@pytest.mark.asyncio
async def test_unlimited_limit_always_passes():
    assert await _run(limit=0, plan="free", member_count=999, pending_and_new=999) is True


@pytest.mark.asyncio
async def test_paid_plan_allows_overage():
    assert await _run(limit=5, plan="pro", member_count=5, pending_and_new=10) is True


@pytest.mark.asyncio
async def test_free_blocks_when_members_plus_pending_exceed_limit():
    # 8 members + 3 pending/new = 11 > 10 → blocked.
    with pytest.raises(HTTPException) as exc:
        await _run(limit=10, plan="free", member_count=8, pending_and_new=3)
    assert exc.value.status_code == 403
    assert "Members" in exc.value.detail


@pytest.mark.asyncio
async def test_free_allows_at_exactly_limit():
    # 8 members + 2 pending = 10 == 10 → allowed (boundary).
    assert await _run(limit=10, plan="free", member_count=8, pending_and_new=2) is True


@pytest.mark.asyncio
async def test_disabled_feature_raises_403():
    with pytest.raises(HTTPException) as exc:
        await _run(limit=10, plan="free", member_count=0, pending_and_new=1, enabled=False)
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_missing_org_config_raises_404():
    with patch.object(usage, "_get_org_config", AsyncMock(return_value=None)):
        with pytest.raises(HTTPException) as exc:
            await check_members_limit_with_pending(1, 1, AsyncMock())
    assert exc.value.status_code == 404
