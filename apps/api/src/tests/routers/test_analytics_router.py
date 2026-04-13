"""Router tests for src/routers/analytics.py."""

from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient

import src.routers.analytics as analytics_router_module
from src.core.events.database import get_db_session
from src.db.users import AnonymousUser
from src.routers.analytics import (
    _build_sql,
    _enrich_with_metadata,
    _execute_tinybird_query,
    _get_read_client,
    _parse_safe_params,
    _validate_course_uuid,
    _verify_org_admin,
    _verify_org_membership,
    router as analytics_router,
)
from src.security.auth import get_current_user


@pytest.fixture
def db_session():
    session = Mock()
    session.exec.return_value.all.return_value = []
    session.exec.return_value.first.return_value = None
    return session


@pytest.fixture
def current_user():
    return SimpleNamespace(id=1)


@pytest.fixture
def app(db_session, current_user):
    app = FastAPI()
    app.include_router(analytics_router, prefix="/api/v1/analytics")
    app.dependency_overrides[get_db_session] = lambda: db_session
    app.dependency_overrides[get_current_user] = lambda: current_user
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@contextmanager
def _analytics_guard_patches():
    with (
        patch("src.routers.analytics._verify_org_membership"),
        patch("src.routers.analytics._verify_org_admin"),
    ):
        yield


def _result(all_result=None, first_result=None):
    result = Mock()
    result.all.return_value = [] if all_result is None else all_result
    result.first.return_value = first_result
    return result


class TestAnalyticsHelpers:
    def test_validate_course_uuid_and_sql_helpers(self):
        request = SimpleNamespace(query_params={"days": "14"})
        assert _parse_safe_params(3, request, 30) == (3, 14)
        assert _validate_course_uuid("course_1") == "course_1"
        assert _validate_course_uuid("c" * 100) == "c" * 100

        with pytest.raises(HTTPException):
            _parse_safe_params("bad", request, 30)

        with pytest.raises(HTTPException):
            _validate_course_uuid("bad course")

        with pytest.raises(HTTPException):
            _validate_course_uuid("c" * 101)

        with pytest.raises(HTTPException):
            _build_sql("select {org_id} {days}", "bad", 7)

        with pytest.raises(HTTPException):
            _build_sql("select {org_id} {days}", 1, 7, "bad course")

    def test_get_read_client_handles_missing_and_configured_tinybird(self, monkeypatch):
        monkeypatch.setattr(analytics_router_module, "_read_client", None)
        monkeypatch.setattr(
            "src.routers.analytics.get_learnhouse_config",
            lambda: SimpleNamespace(tinybird_config=None),
        )
        assert _get_read_client() is None

        fake_client = SimpleNamespace()
        monkeypatch.setattr(analytics_router_module, "_read_client", None)
        monkeypatch.setattr(
            "src.routers.analytics.get_learnhouse_config",
            lambda: SimpleNamespace(
                tinybird_config=SimpleNamespace(
                    api_url="https://tinybird.test",
                    read_token="token",
                )
            ),
        )
        with patch("src.routers.analytics.httpx.AsyncClient", return_value=fake_client):
            assert _get_read_client() is fake_client

        monkeypatch.setattr(analytics_router_module, "_read_client", fake_client)
        assert _get_read_client() is fake_client

    def test_verify_org_membership_and_admin(self):
        db = Mock()

        with patch("src.routers.analytics.is_user_superadmin", return_value=True):
            _verify_org_membership(1, 10, db)
            _verify_org_admin(1, 10, db)

        db.exec.return_value.first.return_value = None
        with patch("src.routers.analytics.is_user_superadmin", return_value=False):
            with pytest.raises(HTTPException, match="Not a member"):
                _verify_org_membership(1, 10, db)

        membership = SimpleNamespace(role_id=7)
        membership_result = _result(first_result=membership)
        role_result = _result(first_result=SimpleNamespace(rights={"organizations": {"action_update": True}}))
        db.exec.side_effect = [membership_result, role_result]
        with patch("src.routers.analytics.is_user_superadmin", return_value=False):
            _verify_org_admin(1, 10, db)

        membership_result = _result(first_result=membership)
        role_result = _result(first_result=SimpleNamespace(rights={"organizations": {"action_update": False}}))
        db.exec.side_effect = [membership_result, role_result]
        with patch("src.routers.analytics.is_user_superadmin", return_value=False):
            with pytest.raises(HTTPException, match="Admin access required"):
                _verify_org_admin(1, 10, db)

        db.exec.side_effect = [_result(first_result=None)]
        with patch("src.routers.analytics.is_user_superadmin", return_value=False):
            with pytest.raises(HTTPException, match="Admin access required"):
                _verify_org_admin(1, 10, db)

        db.exec.side_effect = [membership_result, _result(first_result=None)]
        with patch("src.routers.analytics.is_user_superadmin", return_value=False):
            with pytest.raises(HTTPException, match="Admin access required"):
                _verify_org_admin(1, 10, db)

    def test_enrich_with_metadata(self):
        db = Mock()
        rows = [
            {"user_id": 9, "course_uuid": "course_1", "activity_uuid": "activity_1", "last_activity_uuid": "activity_2"},
            {"user_id": 10, "activity_uuid": "activity_2"},
        ]
        courses = [
            SimpleNamespace(id=1, course_uuid="course_1", name="Course 1", thumbnail_image=None),
            SimpleNamespace(id=2, course_uuid="course_2", name="Course 2", thumbnail_image="thumb"),
        ]
        activities = [
            SimpleNamespace(activity_uuid="activity_1", name="Activity 1", course_id=1),
            SimpleNamespace(activity_uuid="activity_2", name="Activity 2", course_id=2),
        ]
        db.exec.side_effect = [_result(all_result=courses), _result(all_result=activities), _result(all_result=[courses[1]])]

        enriched = _enrich_with_metadata(rows, db)

        assert enriched[0]["course_name"] == "Course 1"
        assert enriched[0]["thumbnail_image"] == ""
        assert enriched[0]["activity_name"] == "Activity 1"
        assert enriched[0]["last_activity_name"] == "Activity 2"
        assert enriched[1]["course_uuid"] == "course_2"
        assert enriched[1]["course_name"] == "Course 2"

    def test_enrich_with_metadata_empty_and_missing_course_resolution(self):
        db = Mock()
        assert _enrich_with_metadata([], db) == []

        rows = [{"activity_uuid": "activity_1"}]
        db.exec.side_effect = [
            _result(all_result=[SimpleNamespace(activity_uuid="activity_1", name="Activity 1", course_id=2)]),
            _result(all_result=[SimpleNamespace(id=2, course_uuid="course_2", name="Course 2", thumbnail_image="thumb")]),
        ]

        enriched = _enrich_with_metadata(rows, db)

        assert enriched[0]["course_uuid"] == "course_2"
        assert enriched[0]["course_name"] == "Course 2"
        assert enriched[0]["activity_name"] == "Activity 1"

    @pytest.mark.asyncio
    async def test_execute_tinybird_query_cache_and_error_paths(self):
        cached = {"data": [{"ok": True}], "rows": 1, "meta": []}
        with patch("src.routers.analytics.get_cached_result", return_value=cached):
            assert await _execute_tinybird_query("daily_active_users", "sql", 1, 30) == cached

        with patch("src.routers.analytics.get_cached_result", return_value=None), patch(
            "src.routers.analytics._get_read_client",
            return_value=None,
        ):
            with pytest.raises(HTTPException, match="Analytics not configured"):
                await _execute_tinybird_query("daily_active_users", "sql", 1, 30)

        request = httpx.Request("POST", "https://tinybird.test/v0/sql")
        not_found_response = httpx.Response(404, request=request, content=b"table not found")
        not_found_exc = httpx.HTTPStatusError("not found", request=request, response=not_found_response)
        fake_client = SimpleNamespace(post=AsyncMock(side_effect=not_found_exc))
        with patch("src.routers.analytics.get_cached_result", return_value=None), patch(
            "src.routers.analytics._get_read_client",
            return_value=fake_client,
        ), patch("src.routers.analytics.set_cached_result") as set_cached:
            result = await _execute_tinybird_query("daily_active_users", "sql", 1, 30)
        assert result == {"data": [], "rows": 0, "meta": []}
        set_cached.assert_not_called()

        bad_response = httpx.Response(500, request=request, content=b"boom")
        bad_exc = httpx.HTTPStatusError("boom", request=request, response=bad_response)
        fake_client = SimpleNamespace(post=AsyncMock(side_effect=bad_exc))
        with patch("src.routers.analytics.get_cached_result", return_value=None), patch(
            "src.routers.analytics._get_read_client",
            return_value=fake_client,
        ):
            with pytest.raises(HTTPException, match="Analytics query failed"):
                await _execute_tinybird_query("daily_active_users", "sql", 1, 30)

        fake_client = SimpleNamespace(post=AsyncMock(side_effect=RuntimeError("boom")))
        with patch("src.routers.analytics.get_cached_result", return_value=None), patch(
            "src.routers.analytics._get_read_client",
            return_value=fake_client,
        ):
            with pytest.raises(HTTPException, match="Analytics query failed"):
                await _execute_tinybird_query("daily_active_users", "sql", 1, 30)

        payload = {
            "data": [{"value": float("nan"), "other": float("inf"), "negative": float("-inf"), "ok": 1}],
            "rows": 1,
            "meta": [{"field": "value"}],
        }
        fake_response = SimpleNamespace(
            raise_for_status=lambda: None,
            json=lambda: payload,
        )
        fake_client = SimpleNamespace(post=AsyncMock(return_value=fake_response))
        with patch("src.routers.analytics.get_cached_result", return_value=None), patch(
            "src.routers.analytics._get_read_client",
            return_value=fake_client,
        ), patch("src.routers.analytics.set_cached_result") as set_cached:
            result = await _execute_tinybird_query("daily_active_users", "sql", 1, 30)
        assert result["data"][0]["value"] is None
        assert result["data"][0]["other"] is None
        assert result["data"][0]["negative"] is None
        set_cached.assert_called_once()


class TestAnalyticsRouter:
    async def test_status_and_plan_info(self, client, app):
        with patch("src.routers.analytics.get_learnhouse_config", return_value=SimpleNamespace(tinybird_config=None)):
            response = await client.get("/api/v1/analytics/status")
        assert response.status_code == 200
        assert response.json()["configured"] is False

        app.dependency_overrides[get_current_user] = lambda: AnonymousUser()
        response = await client.get("/api/v1/analytics/status")
        assert response.status_code == 401
        app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=1)

        with patch("src.routers.analytics.get_org_plan", return_value="pro"), patch(
            "src.routers.analytics.plan_meets_requirement",
            return_value=True,
        ), patch("src.routers.analytics._verify_org_membership"), patch(
            "src.routers.analytics._verify_org_admin",
        ):
            response = await client.get("/api/v1/analytics/plan-info?org_id=1")
        assert response.status_code == 200
        assert response.json()["tier"] == "advanced"

        app.dependency_overrides[get_current_user] = lambda: AnonymousUser()
        response = await client.get("/api/v1/analytics/plan-info?org_id=1")
        assert response.status_code == 401
        app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=1)

    async def test_ingest_frontend_event_branches(self, client, app):
        app.dependency_overrides[get_current_user] = lambda: AnonymousUser()
        response = await client.post(
            "/api/v1/analytics/events",
            json={"event_name": "page_view", "org_id": 1},
        )
        assert response.status_code == 401
        app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=1)

        with _analytics_guard_patches(), patch(
            "src.routers.analytics.track",
            new_callable=AsyncMock,
        ):
            response = await client.post(
                "/api/v1/analytics/events",
                json={"event_name": "bad_event", "org_id": 1},
            )
        assert response.status_code == 400

        with _analytics_guard_patches(), patch(
            "src.routers.analytics.track",
            new_callable=AsyncMock,
        ) as track_mock:
            response = await client.post(
                "/api/v1/analytics/events",
                json={
                    "event_name": "page_view",
                    "org_id": 1,
                    "session_id": "session-1",
                    "properties": {"seconds_spent": 20000, "device_type": "desktop"},
                },
                headers={"cf-ipcountry": "us"},
            )
        assert response.status_code == 200
        track_mock.assert_awaited_once()
        assert track_mock.await_args.kwargs["properties"]["seconds_spent"] == 14400
        assert track_mock.await_args.kwargs["properties"]["country_code"] == "US"

        with _analytics_guard_patches(), patch(
            "src.routers.analytics.track",
            new_callable=AsyncMock,
        ) as track_mock:
            response = await client.post(
                "/api/v1/analytics/events",
                json={
                    "event_name": "page_view",
                    "org_id": 1,
                    "properties": {"seconds_spent": 0},
                },
            )
        assert response.status_code == 200
        assert "seconds_spent" not in track_mock.await_args.kwargs["properties"]

        with _analytics_guard_patches(), patch(
            "src.routers.analytics.track",
            new_callable=AsyncMock,
        ) as track_mock:
            response = await client.post(
                "/api/v1/analytics/events",
                json={
                    "event_name": "page_view",
                    "org_id": 1,
                    "properties": {"seconds_spent": "bad"},
                },
            )
        assert response.status_code == 200
        assert "seconds_spent" not in track_mock.await_args.kwargs["properties"]

    async def test_dashboard_routes(self, client, db_session):
        with _analytics_guard_patches(), patch(
            "src.routers.analytics._enrich_with_metadata",
            side_effect=lambda rows, db: rows,
        ), patch(
            "src.routers.analytics._execute_tinybird_query",
            new_callable=AsyncMock,
            return_value={"data": [{"course_uuid": "course_1", "user_id": 1}], "rows": 1, "meta": []},
        ):
            response = await client.get("/api/v1/analytics/dashboard/daily_active_users?org_id=1")
        assert response.status_code == 200
        assert response.json()["rows"] == 1

        db_session.exec.return_value.all.return_value = [
            SimpleNamespace(
                id=1,
                user_uuid="user_1",
                first_name="First",
                last_name="Last",
                username="user1",
                email="user1@test.com",
                avatar_image="",
            )
        ]
        with _analytics_guard_patches(), patch(
            "src.security.features_utils.plan_check._check_mode_bypass",
            return_value=None,
        ), patch(
            "src.routers.analytics.get_org_plan",
            return_value="starter",
        ), patch(
            "src.routers.analytics.plan_meets_requirement",
            return_value=False,
        ):
            response = await client.get("/api/v1/analytics/dashboard/course_dropoff?org_id=1")
        assert response.status_code == 403

        with _analytics_guard_patches(), patch(
            "src.routers.analytics._enrich_with_metadata",
            side_effect=lambda rows, db: rows,
        ), patch(
            "src.routers.analytics._execute_tinybird_query",
            new_callable=AsyncMock,
            return_value={"data": [{"course_uuid": "course_1", "user_id": 1}], "rows": 1, "meta": []},
        ):
            response = await client.get("/api/v1/analytics/dashboard/detail/detail_signups?org_id=1")
        assert response.status_code == 200
        assert response.json()["users"]["1"]["user_uuid"] == "user_1"

        with _analytics_guard_patches():
            response = await client.get("/api/v1/analytics/dashboard/not_a_query?org_id=1")
        assert response.status_code == 404

        with _analytics_guard_patches(), patch(
            "src.routers.analytics.get_org_plan",
            return_value="starter",
        ), patch(
            "src.routers.analytics.plan_meets_requirement",
            return_value=False,
        ):
            response = await client.get("/api/v1/analytics/dashboard/db/unknown_query?org_id=1")
        assert response.status_code == 404

        with _analytics_guard_patches(), patch(
            "src.routers.analytics.get_org_plan",
            return_value="starter",
        ), patch(
            "src.routers.analytics.plan_meets_requirement",
            return_value=False,
        ):
            response = await client.get("/api/v1/analytics/dashboard/db/grade_distribution?org_id=1")
        assert response.status_code == 403

    async def test_dashboard_db_and_course_routes(self, client, db_session):
        db_session.exec.side_effect = [_result(all_result=[(90, 2), (100, 1)])]
        with _analytics_guard_patches(), patch(
            "src.routers.analytics.get_org_plan",
            return_value="pro",
        ), patch(
            "src.routers.analytics.plan_meets_requirement",
            return_value=True,
        ):
            response = await client.get("/api/v1/analytics/dashboard/db/grade_distribution?org_id=1")
        assert response.status_code == 200
        assert response.json()["data"][0]["grade"] == 90

        with _analytics_guard_patches(), patch(
            "src.routers.analytics.get_org_plan",
            return_value="pro",
        ), patch(
            "src.routers.analytics.plan_meets_requirement",
            return_value=True,
        ), patch(
            "src.routers.analytics._enrich_with_metadata",
            side_effect=lambda rows, db: rows,
        ), patch(
            "src.routers.analytics._execute_tinybird_query",
            new_callable=AsyncMock,
            return_value={"data": [{"course_uuid": "course_1", "user_id": 1}], "rows": 1, "meta": []},
        ):
            response = await client.get(
                "/api/v1/analytics/dashboard/course/course_overview_stats?org_id=1&course_uuid=course_1"
            )
        assert response.status_code == 200
        assert response.json()["data"][0]["course_uuid"] == "course_1"

        db_session.exec.side_effect = [
            _result(first_result=SimpleNamespace(id=100, course_uuid="course_1", name="Course 1")),
            _result(all_result=[SimpleNamespace(user_id=7, creation_date="2024-01-01")]),
            _result(
                all_result=[
                    SimpleNamespace(
                        id=7,
                        user_uuid="user_7",
                        first_name="User",
                        last_name="Seven",
                        username="user7",
                        email="user7@test.com",
                        avatar_image="",
                    )
                ]
            ),
        ]
        with _analytics_guard_patches(), patch(
            "src.routers.analytics.get_org_plan",
            return_value="pro",
        ), patch(
            "src.routers.analytics.plan_meets_requirement",
            return_value=True,
        ), patch(
            "src.routers.analytics._enrich_with_metadata",
            side_effect=lambda rows, db: rows,
        ), patch(
            "src.routers.analytics._execute_tinybird_query",
            new_callable=AsyncMock,
            return_value={"data": [], "rows": 0, "meta": []},
        ):
            response = await client.get(
                "/api/v1/analytics/dashboard/course/detail/course_recent_enrollments?org_id=1&course_uuid=course_1"
            )
        assert response.status_code == 200
        assert response.json()["data"][0]["user_id"] == 7

        with _analytics_guard_patches(), patch(
            "src.routers.analytics.get_org_plan",
            return_value="starter",
        ), patch(
            "src.routers.analytics.plan_meets_requirement",
            return_value=False,
        ):
            response = await client.get(
                "/api/v1/analytics/dashboard/course/course_overview_stats?org_id=1&course_uuid=course_1"
            )
        assert response.status_code == 403

        with _analytics_guard_patches(), patch(
            "src.routers.analytics.get_org_plan",
            return_value="pro",
        ), patch(
            "src.routers.analytics.plan_meets_requirement",
            return_value=True,
        ):
            response = await client.get(
                "/api/v1/analytics/dashboard/course/detail/unknown_detail?org_id=1&course_uuid=course_1"
            )
        assert response.status_code == 404

        with _analytics_guard_patches(), patch(
            "src.routers.analytics.get_org_plan",
            return_value="pro",
        ), patch(
            "src.routers.analytics.plan_meets_requirement",
            return_value=True,
        ):
            response = await client.get(
                "/api/v1/analytics/dashboard/course/detail/course_recent_enrollments?org_id=1&course_uuid=bad course"
            )
        assert response.status_code == 400

    async def test_export_json_csv_and_errors(self, client):
        with _analytics_guard_patches(), patch(
            "src.routers.analytics._enrich_with_metadata",
            side_effect=lambda rows, db: rows,
        ), patch(
            "src.routers.analytics._execute_tinybird_query",
            new_callable=AsyncMock,
            return_value={"data": [{"course_uuid": "course_1", "user_id": 1}], "rows": 1, "meta": []},
        ):
            response = await client.get("/api/v1/analytics/export?org_id=1&format=json&queries=daily_active_users")
        assert response.status_code == 200
        assert response.json()["daily_active_users"]["rows"] == 1

        with _analytics_guard_patches(), patch(
            "src.routers.analytics._enrich_with_metadata",
            side_effect=lambda rows, db: rows,
        ), patch(
            "src.routers.analytics._execute_tinybird_query",
            new_callable=AsyncMock,
            return_value={"data": [{"course_uuid": "course_1", "user_id": 1}], "rows": 1, "meta": []},
        ):
            response = await client.get(
                "/api/v1/analytics/export?org_id=1&format=csv&queries=daily_active_users"
            )
        assert response.status_code == 200
        assert "# daily_active_users" in response.text

        with _analytics_guard_patches():
            response = await client.get("/api/v1/analytics/export?org_id=1&format=xml&queries=daily_active_users")
        assert response.status_code == 400

        with _analytics_guard_patches():
            response = await client.get("/api/v1/analytics/export?org_id=1&format=json")
        assert response.status_code == 400

        with _analytics_guard_patches(), patch(
            "src.routers.analytics._enrich_with_metadata",
            side_effect=lambda rows, db: rows,
        ), patch(
            "src.routers.analytics._execute_tinybird_query",
            new_callable=AsyncMock,
            return_value={"data": [{"course_uuid": "course_1", "user_id": 1}], "rows": 1, "meta": []},
        ):
            response = await client.get(
                "/api/v1/analytics/export?org_id=1&format=json&queries=daily_active_users,unknown_query"
            )
        assert response.status_code == 200

        with _analytics_guard_patches():
            response = await client.get("/api/v1/analytics/export?org_id=1&format=json&queries=daily_active_users&days=bad")
        assert response.status_code == 400

        with _analytics_guard_patches(), patch(
            "src.routers.analytics._enrich_with_metadata",
            side_effect=lambda rows, db: rows,
        ), patch(
            "src.routers.analytics._execute_tinybird_query",
            new_callable=AsyncMock,
            return_value={"data": [{"course_uuid": "course_1", "user_id": 1}], "rows": 1, "meta": []},
        ):
            response = await client.get(
                "/api/v1/analytics/export?org_id=1&format=json&queries=daily_active_users&course_uuid=course_1"
            )
        assert response.status_code == 200

    async def test_dashboard_unknown_and_course_plan_and_query_validation(self, client):
        with _analytics_guard_patches():
            response = await client.get("/api/v1/analytics/dashboard/detail/unknown_detail?org_id=1")
        assert response.status_code == 404

        with _analytics_guard_patches(), patch(
            "src.routers.analytics.get_org_plan",
            return_value="starter",
        ), patch(
            "src.routers.analytics.plan_meets_requirement",
            return_value=False,
        ):
            response = await client.get(
                "/api/v1/analytics/dashboard/course/detail/course_recent_enrollments?org_id=1&course_uuid=course_1"
            )
        assert response.status_code == 403

        with _analytics_guard_patches(), patch(
            "src.routers.analytics.get_org_plan",
            return_value="pro",
        ), patch(
            "src.routers.analytics.plan_meets_requirement",
            return_value=True,
        ):
            response = await client.get(
                "/api/v1/analytics/dashboard/course/unknown_course_query?org_id=1&course_uuid=course_1"
            )
        assert response.status_code == 404

    async def test_anonymous_routes_return_401(self, client, app):
        app.dependency_overrides[get_current_user] = lambda: AnonymousUser()
        routes = [
            "/api/v1/analytics/dashboard/detail/detail_signups?org_id=1",
            "/api/v1/analytics/dashboard/daily_active_users?org_id=1",
            "/api/v1/analytics/dashboard/db/grade_distribution?org_id=1",
            "/api/v1/analytics/dashboard/course/detail/course_recent_enrollments?org_id=1&course_uuid=course_1",
            "/api/v1/analytics/dashboard/course/course_overview_stats?org_id=1&course_uuid=course_1",
            "/api/v1/analytics/export?org_id=1&format=json&queries=daily_active_users",
            "/api/v1/analytics/plan-info?org_id=1",
        ]

        for route in routes:
            response = await client.get(route)
            assert response.status_code == 401
