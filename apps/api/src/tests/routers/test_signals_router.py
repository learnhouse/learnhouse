"""Router tests for src/routers/signals.py (beacon, settings, raw export)."""

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.analytics import AnalyticsEvent
from src.routers import signals
from src.security.auth import get_current_user
from src.services.analytics import collect
from src.services.analytics import settings as analytics_settings

BROWSER = {"user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0", "origin": "https://acme.test"}


@pytest.fixture(autouse=True)
def _clear_caches():
    collect._org_cache.clear()
    collect._membership_cache.clear()
    analytics_settings._cache.clear()
    with patch.object(signals, "check_rate_limit", return_value=(True, 1, 60)):
        yield


@pytest.fixture
def user_holder(anonymous_user):
    return {"user": anonymous_user}


@pytest.fixture
async def client(db, user_holder):
    app = FastAPI()
    app.include_router(signals.router, prefix="/api/v1/signals")
    app.include_router(signals.legacy_router, prefix="/api/v1/analytics")
    app.include_router(signals.settings_router, prefix="/api/v1/analytics")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user_holder["user"]
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


def _batch(org_id, *events):
    return {"org_id": org_id, "session_id": "s1", "events": [{"name": n, "props": p} for n, p in events]}


class TestBeacon:
    async def test_anonymous_batch(self, client, org, analytics_queue):
        response = await client.post(
            "/api/v1/signals/batch",
            json=_batch(org.id, ("page_view", {"path": "/"}), ("time_on_activity", {"seconds_spent": 5})),
            headers=BROWSER,
        )
        assert response.status_code == 202
        assert response.json() == {"accepted": 1}
        assert analytics_queue[0]["event_name"] == "page_view"
        assert analytics_queue[0]["actor_key"].startswith("v:")

    async def test_member_batch_is_attributed(self, client, org, regular_user, user_holder, analytics_queue):
        user_holder["user"] = regular_user
        response = await client.post(
            "/api/v1/signals/batch",
            json=_batch(org.id, ("time_on_activity", {"seconds_spent": 5, "activity_uuid": "a"})),
            headers=BROWSER,
        )
        assert response.json() == {"accepted": 1}
        assert analytics_queue[0]["user_id"] == regular_user.id

    async def test_nothing_kept_means_nothing_queued(self, client, org, analytics_queue):
        response = await client.post("/api/v1/signals/batch", json=_batch(org.id, ("nope", {})), headers=BROWSER)
        assert response.json() == {"accepted": 0}
        assert analytics_queue == []

    async def test_rate_limited(self, client, org, analytics_queue):
        with patch.object(signals, "check_rate_limit", return_value=(False, 999, 30)):
            response = await client.post("/api/v1/signals/batch", json=_batch(org.id, ("page_view", {})), headers=BROWSER)
        assert response.json() == {"accepted": 0}

    async def test_rate_limiter_unavailable_still_accepts(self, client, org, analytics_queue):
        with patch.object(signals, "check_rate_limit", side_effect=RuntimeError("no redis")):
            response = await client.post("/api/v1/signals/batch", json=_batch(org.id, ("page_view", {})), headers=BROWSER)
        assert response.json() == {"accepted": 1}

    async def test_batch_size_limit(self, client, org):
        events = [("page_view", {})] * (collect.MAX_EVENTS_PER_BATCH + 1)
        response = await client.post("/api/v1/signals/batch", json=_batch(org.id, *events), headers=BROWSER)
        assert response.status_code == 422

    async def test_legacy_endpoint(self, client, org, analytics_queue):
        response = await client.post(
            "/api/v1/analytics/events",
            json={"event_name": "course_view", "org_id": org.id, "properties": {"course_uuid": "c1"}},
            headers=BROWSER,
        )
        assert response.status_code == 202
        assert response.json() == {"accepted": 1}
        assert analytics_queue[0]["course_uuid"] == "c1"


class TestSettings:
    async def test_requires_authentication(self, client, org):
        response = await client.get(f"/api/v1/analytics/settings?org_id={org.id}")
        assert response.status_code == 401

    async def test_requires_admin(self, client, org, regular_user, user_holder):
        user_holder["user"] = regular_user
        response = await client.get(f"/api/v1/analytics/settings?org_id={org.id}")
        assert response.status_code == 403

    async def test_get_and_update(self, client, org, admin_user, user_holder):
        user_holder["user"] = admin_user
        with patch.object(analytics_settings, "can_extend_retention", new=AsyncMock(return_value=False)):
            response = await client.get(f"/api/v1/analytics/settings?org_id={org.id}")
            assert response.status_code == 200
            body = response.json()
            assert body["retention_days"] == 365
            assert body["retention_options"]["extended_available"] is False

            response = await client.put(
                f"/api/v1/analytics/settings?org_id={org.id}", json={"retention_days": 90, "exclude_staff": True}
            )
            assert response.status_code == 200
            assert response.json()["retention_days"] == 90
            assert response.json()["exclude_staff"] is True

            response = await client.put(f"/api/v1/analytics/settings?org_id={org.id}", json={"retention_days": 1825})
            assert response.status_code == 403


class TestExport:
    async def test_requires_enterprise(self, client, org, admin_user, user_holder):
        user_holder["user"] = admin_user
        with patch.object(analytics_settings, "can_extend_retention", new=AsyncMock(return_value=False)):
            response = await client.get(f"/api/v1/analytics/export/events?org_id={org.id}")
        assert response.status_code == 403

    async def test_streams_csv_in_pages(self, client, db, org, other_org, admin_user, user_holder):
        user_holder["user"] = admin_user
        now = datetime.now(timezone.utc)
        db.add_all(
            [
                AnalyticsEvent(ts=now, org_id=org.id, event_name="page_view", actor_key="v:1", path="=cmd()"),
                AnalyticsEvent(ts=now, org_id=org.id, event_name="search_query", user_id=1, actor_key="u:1",
                               properties={"query": "sql"}),
                AnalyticsEvent(ts=now - timedelta(days=90), org_id=org.id, event_name="page_view", actor_key="v:2"),
                AnalyticsEvent(ts=now, org_id=other_org.id, event_name="page_view", actor_key="v:3"),
            ]
        )
        await db.commit()
        with patch.object(analytics_settings, "can_extend_retention", new=AsyncMock(return_value=True)), patch.object(
            signals, "EXPORT_PAGE_SIZE", 1
        ):
            response = await client.get(f"/api/v1/analytics/export/events?org_id={org.id}&days=30")
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/csv")
        lines = response.text.strip().splitlines()
        assert lines[0].startswith("ts,event_name,source,user_id")
        assert len(lines) == 3
        assert "'=cmd()" in lines[1]
        assert '"{""query"": ""sql""}"' in lines[2]
