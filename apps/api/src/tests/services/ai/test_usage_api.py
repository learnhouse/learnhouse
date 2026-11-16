"""The usage page APIs (prices, usage breakdown, low-balance state) and the
reports behind them and the platform console (src/services/ai/usage_reports.py)."""

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

import src.db.ai_usage  # noqa: F401  (registers the ledger table before the test engine)
from src.core.events.database import get_db_session
from src.db.ai_usage import AIUsageEvent
from src.db.users import APITokenUser
from src.routers.orgs.ai_credits import router as ai_credits_router
from src.security.auth import get_current_user
from src.services.ai import pricing, usage_reports

pytestmark = pytest.mark.asyncio


def _event(org_id, feature, credits, *, user_id=None, cost_micros=0, days_ago=0, key=None):
    return AIUsageEvent(
        org_id=org_id,
        user_id=user_id,
        feature=feature,
        credits=credits,
        cost_micros=cost_micros,
        requests=1,
        charge_key=key or f"{feature}:{org_id}:{credits}:{days_ago}:{user_id}:{cost_micros}",
        created_at=datetime.now(timezone.utc) - timedelta(days=days_ago),
    )


@pytest.fixture
async def ledger(db, org, admin_user, regular_user):
    rows = [
        _event(org.id, "atlas_chat", 30, user_id=admin_user.id, cost_micros=100_000),
        _event(org.id, "atlas_chat", 10, user_id=regular_user.id, cost_micros=20_000, days_ago=1),
        _event(org.id, "magic_block", 3, user_id=regular_user.id, cost_micros=1_000),
        _event(org.id, "retired_feature", 2, cost_micros=0),
        _event(org.id, "magic_block", 99, user_id=admin_user.id, days_ago=90),  # outside 30 days
    ]
    db.add_all(rows)
    await db.commit()
    return rows


@pytest.fixture
def app(db, admin_user):
    app = FastAPI()
    app.include_router(ai_credits_router, prefix="/api/v1/orgs")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: admin_user
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


# ── balance state ──────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "remaining,total,state,pct",
    [
        ("unlimited", "unlimited", "unlimited", None),
        (0, 100, "empty", 0.0),
        (5, 0, "empty", 0.0),
        (5, 100, "critical", 5.0),
        (20, 100, "low", 20.0),
        (21, 100, "ok", 21.0),
    ],
)
def test_balance_state(remaining, total, state, pct):
    assert usage_reports.balance_state(remaining, total) == {"state": state, "remaining_pct": pct}


async def test_summary_carries_the_balance_state(client, org):
    summary = {"plan": "standard", "base_credits": 1000, "purchased_credits": 0, "total_credits": 1000,
               "used_credits": 960, "remaining_credits": 40}
    with patch("src.routers.orgs.ai_credits.verify_user_is_org_member", new=AsyncMock(return_value=True)), \
         patch("src.routers.orgs.ai_credits.get_ai_credits_summary", new=AsyncMock(return_value=summary)):
        res = await client.get(f"/api/v1/orgs/{org.id}/ai-credits")
    assert res.status_code == 200
    assert res.json()["balance_state"] == "critical"
    assert res.json()["remaining_pct"] == 4.0


# ── prices ─────────────────────────────────────────────────────────────────


async def test_prices_for_members(client, org):
    with patch("src.routers.orgs.ai_credits.verify_user_is_org_member", new=AsyncMock(return_value=True)):
        res = await client.get(f"/api/v1/orgs/{org.id}/ai-credits/prices")
    assert res.status_code == 200
    body = res.json()
    assert {f["key"] for f in body["features"]} == set(pricing.FEATURES)
    assert (body["low_balance_pct"], body["critical_balance_pct"]) == (20, 5)
    # Money values stay internal.
    assert "credit_value_usd" not in body


async def test_prices_refused_to_outsiders(client, org):
    with patch("src.routers.orgs.ai_credits.verify_user_is_org_member", new=AsyncMock(return_value=False)):
        res = await client.get(f"/api/v1/orgs/{org.id}/ai-credits/prices")
    assert res.status_code == 403


async def test_prices_unknown_org(client):
    res = await client.get("/api/v1/orgs/999/ai-credits/prices")
    assert res.status_code == 404


async def test_prices_refuse_a_token_of_another_org(app, client, org):
    app.dependency_overrides[get_current_user] = lambda: APITokenUser(
        id=0, user_uuid="t", username="t", org_id=org.id + 1, rights={}, token_name="t", created_by_user_id=1,
    )
    res = await client.get(f"/api/v1/orgs/{org.id}/ai-credits/prices")
    assert res.status_code == 403


# ── usage breakdown ────────────────────────────────────────────────────────


async def test_usage_breakdown_for_admins(client, org, admin_user, regular_user, ledger):
    with patch("src.routers.orgs.ai_credits.verify_user_is_org_admin", new=AsyncMock(return_value=True)):
        res = await client.get(f"/api/v1/orgs/{org.id}/ai-credits/usage?days=30")
    assert res.status_code == 200
    body = res.json()
    assert body["total_credits"] == 45 and body["total_requests"] == 4
    feats = {f["feature"]: f for f in body["by_feature"]}
    assert feats["atlas_chat"]["credits"] == 40 and feats["atlas_chat"]["label"] == "Atlas message"
    assert feats["retired_feature"]["label"] == "retired_feature"
    members = {m["user_id"]: m for m in body["by_member"]}
    assert members[admin_user.id]["credits"] == 30
    assert members[regular_user.id]["credits"] == 13
    assert members[regular_user.id]["username"] == regular_user.username
    assert members[None]["username"] is None  # system work
    assert sum(d["credits"] for d in body["by_day"]) == 45
    assert len(body["by_day"]) == 2


async def test_usage_is_admin_only(client, org, ledger):
    with patch("src.routers.orgs.ai_credits.verify_user_is_org_admin", new=AsyncMock(return_value=False)):
        res = await client.get(f"/api/v1/orgs/{org.id}/ai-credits/usage")
    assert res.status_code == 403
    assert res.json()["detail"] == "Admin rights required"


async def test_usage_of_an_org_without_events(db, org):
    data = await usage_reports.org_usage(db, org.id, days=7)
    assert data["total_credits"] == 0 and data["by_member"] == [] and data["by_day"] == []


# ── platform reports ───────────────────────────────────────────────────────


async def test_platform_costs(db, org, ledger):
    with patch.object(usage_reports, "unmetered_calls", return_value=[{"model": "m", "calls": 1, "cost_usd": 0.1}]):
        data = await usage_reports.platform_costs(db, days=30)
    feats = {f["feature"]: f for f in data["by_feature"]}
    chat = feats["atlas_chat"]
    assert chat["credits"] == 40 and chat["cost_usd"] == 0.12
    assert chat["published_credits"] == pricing.FEATURES["atlas_chat"].credits and chat["metered"] is True
    assert chat["margin_multiple"] == round(0.40 / 0.12, 3)
    assert chat["below_floor"] is False
    assert feats["retired_feature"]["published_credits"] is None
    assert feats["retired_feature"]["margin_multiple"] is None
    assert data["by_org"][0]["org_name"] == org.name
    assert data["totals"]["credits"] == 45
    assert data["by_day"] and data["unmetered"][0]["model"] == "m"
    assert data["pricing"]["margin_floor"] == pricing.MARGIN_FLOOR


async def test_platform_costs_filters(db, org, ledger):
    data = await usage_reports.platform_costs(db, days=30, org_id=org.id, feature="magic_block")
    assert [f["feature"] for f in data["by_feature"]] == ["magic_block"]
    empty = await usage_reports.platform_costs(db, days=30, org_id=org.id + 100)
    assert empty["by_org"] == [] and empty["totals"]["credits"] == 0


async def test_features_below_floor(db, org):
    db.add_all([_event(org.id, "thumbnail", 2, cost_micros=40_000, key=f"t{i}") for i in range(3)])
    await db.commit()
    low = await usage_reports.features_below_floor(db, days=7, min_requests=3)
    assert [f["feature"] for f in low] == ["thumbnail"]
    assert await usage_reports.features_below_floor(db, days=7, min_requests=4) == []


async def test_absorbed_features_never_alert(db, org):
    # Indexing is paid by the platform: cost with 0 credits is expected, not a margin problem.
    db.add_all([_event(org.id, "rag_indexing", 0, cost_micros=500, key=f"r{i}") for i in range(3)])
    await db.commit()
    assert await usage_reports.features_below_floor(db, days=7, min_requests=1) == []


def test_unmetered_calls_without_redis(monkeypatch):
    from src.security.features_utils import usage

    monkeypatch.setattr(usage, "_get_redis_client", MagicMock(side_effect=ConnectionError))
    assert usage_reports.unmetered_calls() == []
    broken = MagicMock()
    broken.hgetall.side_effect = ConnectionError
    monkeypatch.setattr(usage, "_get_redis_client", lambda: broken)
    assert usage_reports.unmetered_calls(days=2) == []


def test_unmetered_calls_ignore_unknown_fields(monkeypatch):
    from src.security.features_utils import usage

    r = MagicMock()
    r.hgetall.return_value = {"m:calls": "2", "m:other": "9"}
    monkeypatch.setattr(usage, "_get_redis_client", lambda: r)
    assert usage_reports.unmetered_calls(days=1) == [{"model": "m", "calls": 2, "cost_usd": 0.0}]
