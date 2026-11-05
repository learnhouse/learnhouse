"""Router tests for src/routers/analytics.py."""

from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, Mock, patch

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.users import AnonymousUser
from src.routers.analytics import (
    _enrich_with_metadata,
    _execute_query,
    _execute_tinybird_query,
    _parse_safe_params,
    _query_params,
    _validate_course_uuid,
    _verify_org_admin,
    _verify_org_membership,
    router as analytics_router,
)
from src.security.auth import get_current_user


@pytest.fixture
def db_session():
    session = AsyncMock()
    result = MagicMock()
    result.all.return_value = []
    result.first.return_value = None
    scalars = MagicMock()
    scalars.all.return_value = []
    scalars.first.return_value = None
    result.scalars.return_value = scalars
    session.execute.return_value = result
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
        patch("src.routers.analytics._verify_org_membership", new_callable=AsyncMock),
        patch("src.routers.analytics._verify_org_admin", new_callable=AsyncMock),
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

    async def test_verify_org_membership_and_admin(self):
        db = AsyncMock()

        def _make_execute_result(first_result=None, all_result=None):
            scalars = MagicMock()
            scalars.first.return_value = first_result
            scalars.all.return_value = all_result if all_result is not None else []
            result = MagicMock()
            result.scalars.return_value = scalars
            return result

        with patch("src.routers.analytics.is_user_superadmin", new_callable=AsyncMock, return_value=True):
            await _verify_org_membership(1, 10, db)
            await _verify_org_admin(1, 10, db)

        db.execute.return_value = _make_execute_result(first_result=None)
        with patch("src.routers.analytics.is_user_superadmin", new_callable=AsyncMock, return_value=False):
            with pytest.raises(HTTPException, match="Not a member"):
                await _verify_org_membership(1, 10, db)

        membership = SimpleNamespace(role_id=7)
        db.execute.side_effect = [
            _make_execute_result(first_result=membership),
            _make_execute_result(first_result=SimpleNamespace(rights={"organizations": {"action_update": True}})),
        ]
        with patch("src.routers.analytics.is_user_superadmin", new_callable=AsyncMock, return_value=False):
            await _verify_org_admin(1, 10, db)

        db.execute.side_effect = [
            _make_execute_result(first_result=membership),
            _make_execute_result(first_result=SimpleNamespace(rights={"organizations": {"action_update": False}})),
        ]
        with patch("src.routers.analytics.is_user_superadmin", new_callable=AsyncMock, return_value=False):
            with pytest.raises(HTTPException, match="Admin access required"):
                await _verify_org_admin(1, 10, db)

        db.execute.side_effect = [_make_execute_result(first_result=None)]
        with patch("src.routers.analytics.is_user_superadmin", new_callable=AsyncMock, return_value=False):
            with pytest.raises(HTTPException, match="Admin access required"):
                await _verify_org_admin(1, 10, db)

        db.execute.side_effect = [
            _make_execute_result(first_result=membership),
            _make_execute_result(first_result=None),
        ]
        with patch("src.routers.analytics.is_user_superadmin", new_callable=AsyncMock, return_value=False):
            with pytest.raises(HTTPException, match="Admin access required"):
                await _verify_org_admin(1, 10, db)

    async def test_enrich_with_metadata(self):
        db = AsyncMock()

        def _make_execute_result(all_result=None):
            scalars = MagicMock()
            scalars.all.return_value = all_result if all_result is not None else []
            result = MagicMock()
            result.scalars.return_value = scalars
            return result

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
        db.execute.side_effect = [
            _make_execute_result(all_result=courses),
            _make_execute_result(all_result=activities),
            _make_execute_result(all_result=[courses[1]]),
        ]

        enriched = await _enrich_with_metadata(rows, db)

        assert enriched[0]["course_name"] == "Course 1"
        assert enriched[0]["thumbnail_image"] == ""
        assert enriched[0]["activity_name"] == "Activity 1"
        assert enriched[0]["last_activity_name"] == "Activity 2"
        assert enriched[1]["course_uuid"] == "course_2"
        assert enriched[1]["course_name"] == "Course 2"

    async def test_enrich_with_metadata_empty_and_missing_course_resolution(self):
        db = AsyncMock()
        assert await _enrich_with_metadata([], db) == []

        def _make_execute_result(all_result=None):
            scalars = MagicMock()
            scalars.all.return_value = all_result if all_result is not None else []
            result = MagicMock()
            result.scalars.return_value = scalars
            return result

        rows = [{"activity_uuid": "activity_1"}]
        db.execute.side_effect = [
            _make_execute_result(all_result=[SimpleNamespace(activity_uuid="activity_1", name="Activity 1", course_id=2)]),
            _make_execute_result(all_result=[SimpleNamespace(id=2, course_uuid="course_2", name="Course 2", thumbnail_image="thumb")]),
        ]

        enriched = await _enrich_with_metadata(rows, db)

        assert enriched[0]["course_uuid"] == "course_2"
        assert enriched[0]["course_name"] == "Course 2"
        assert enriched[0]["activity_name"] == "Activity 1"

    def test_query_params_validates_parameter_types_and_course_uuid(self):
        assert _query_params(1, 7) == {"org_id": 1, "days": 7}
        assert _query_params(1, 7, "course_1") == {"org_id": 1, "days": 7, "course_uuid": "course_1"}

        with pytest.raises(HTTPException, match="Invalid parameter types"):
            _query_params("bad", 7)

        with pytest.raises(HTTPException, match="Invalid course_uuid"):
            _query_params(1, 7, "bad course")

        with pytest.raises(HTTPException, match="Invalid course_uuid"):
            _query_params(1, 7, "c" * 101)

    @pytest.mark.asyncio
    async def test_execute_query_cache_and_error_paths(self):
        params = {"org_id": 1, "days": 30}
        cached = {"data": [{"ok": True}], "rows": 1, "meta": []}
        with patch("src.routers.analytics.get_cached_result", return_value=cached) as get_cached, patch(
            "src.routers.analytics.store.run_query", new_callable=AsyncMock
        ) as run_query:
            assert await _execute_query("daily_active_users", "SQL", params, 1, 30, "course_1") == cached
        get_cached.assert_called_once_with("daily_active_users", 1, 30, "course_1")
        run_query.assert_not_awaited()

        with patch("src.routers.analytics.get_cached_result", return_value=None), patch(
            "src.routers.analytics.store.run_query",
            new_callable=AsyncMock,
            side_effect=RuntimeError("boom"),
        ), patch("src.routers.analytics.set_cached_result") as set_cached:
            with pytest.raises(HTTPException, match="Analytics query failed") as exc_info:
                await _execute_query("daily_active_users", "SQL", params, 1, 30)
        assert exc_info.value.status_code == 502
        set_cached.assert_not_called()

        rows = [{"date": "2026-11-01", "dau": 3}]
        with patch("src.routers.analytics.get_cached_result", return_value=None), patch(
            "src.routers.analytics.store.run_query", new_callable=AsyncMock, return_value=rows
        ) as run_query, patch("src.routers.analytics.set_cached_result") as set_cached:
            result = await _execute_query("daily_active_users", "SQL", params, 1, 30)
        assert result == {"data": rows, "rows": 1, "meta": []}
        run_query.assert_awaited_once_with("SQL", params)
        set_cached.assert_called_once_with("daily_active_users", 1, 30, result, None)

    @pytest.mark.asyncio
    async def test_legacy_tinybird_shim_resolves_by_name(self):
        from src.services.analytics.queries import CORE_QUERIES, SUPERADMIN_QUERIES

        rows = [{"org_id": 1, "views": 5}]
        with patch(
            "src.routers.analytics._execute_query", new_callable=AsyncMock,
            return_value={"data": rows, "rows": 1, "meta": []},
        ) as execute:
            # The ClickHouse SQL the caller passes is ignored.
            result = await _execute_tinybird_query("superadmin_org_visits_rank", "SELECT count() FROM events", 0, 30)
            assert result["data"] == rows
            execute.assert_awaited_with(
                "superadmin_org_visits_rank", SUPERADMIN_QUERIES["superadmin_org_visits_rank"][0],
                {"org_id": 0, "days": 30}, 0, 30, None,
            )

            await _execute_tinybird_query("superadmin_org_weekly_visits", "ignored", 0, 0)
            execute.assert_awaited_with(
                "superadmin_org_weekly_visits", SUPERADMIN_QUERIES["superadmin_org_weekly_visits"][0],
                {"org_id": 0, "days": 7}, 0, 7, None,
            )

            await _execute_tinybird_query("superadmin_top_courses", "ignored", 4, 99999)
            execute.assert_awaited_with(
                "superadmin_top_courses", CORE_QUERIES["top_courses"][0],
                {"org_id": 4, "days": 3650}, 4, 3650, None,
            )

            await _execute_tinybird_query("global_live_users", "ignored", 0, 30)
            execute.assert_awaited_with(
                "global_live_users", CORE_QUERIES["live_users"][0],
                {"org_id": 0, "days": 30}, 0, 30, None,
            )

            assert await _execute_tinybird_query("superadmin_unknown", "ignored", 0, 30) == {
                "data": [], "rows": 0, "meta": [],
            }
            assert await _execute_tinybird_query(
                "superadmin_course_dropoff", "ignored", 0, 30, empty_response={"data": []}
            ) == {"data": []}
            assert execute.await_count == 4

            with pytest.raises(HTTPException, match="Invalid parameter"):
                await _execute_tinybird_query("superadmin_top_courses", "ignored", "bad", 30)


class TestAnalyticsRouter:
    async def test_status_and_plan_info(self, client, app):
        response = await client.get("/api/v1/analytics/status")
        assert response.status_code == 200
        assert response.json()["configured"] is True

        app.dependency_overrides[get_current_user] = lambda: AnonymousUser()
        response = await client.get("/api/v1/analytics/status")
        assert response.status_code == 401
        app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=1)

        with patch("src.routers.analytics.get_org_plan", new_callable=AsyncMock, return_value="pro"), patch(
            "src.routers.analytics.plan_meets_requirement",
            return_value=True,
        ), patch("src.routers.analytics._verify_org_membership", new_callable=AsyncMock), patch(
            "src.routers.analytics._verify_org_admin", new_callable=AsyncMock,
        ):
            response = await client.get("/api/v1/analytics/plan-info?org_id=1")
        assert response.status_code == 200
        assert response.json()["tier"] == "advanced"

        app.dependency_overrides[get_current_user] = lambda: AnonymousUser()
        response = await client.get("/api/v1/analytics/plan-info?org_id=1")
        assert response.status_code == 401
        app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=1)

    async def test_dashboard_routes(self, client, db_session):
        with _analytics_guard_patches(), patch(
            "src.routers.analytics._enrich_with_metadata",
            new_callable=AsyncMock,
            side_effect=lambda rows, db, **_: rows,
        ), patch(
            "src.routers.analytics._execute_query",
            new_callable=AsyncMock,
            return_value={"data": [{"course_uuid": "course_1", "user_id": 1}], "rows": 1, "meta": []},
        ):
            response = await client.get("/api/v1/analytics/dashboard/daily_active_users?org_id=1")
        assert response.status_code == 200
        assert response.json()["rows"] == 1

        user_ns = SimpleNamespace(
            id=1,
            user_uuid="user_1",
            first_name="First",
            last_name="Last",
            username="user1",
            email="user1@test.com",
            avatar_image="",
        )
        scalars_mock = MagicMock()
        scalars_mock.all.return_value = [user_ns]
        result_mock = MagicMock()
        result_mock.scalars.return_value = scalars_mock
        db_session.execute.return_value = result_mock
        with _analytics_guard_patches(), patch(
            "src.security.features_utils.plan_check._check_mode_bypass",
            return_value=None,
        ), patch(
            "src.routers.analytics.get_org_plan",
            new_callable=AsyncMock,
            return_value="starter",
        ), patch(
            "src.routers.analytics.plan_meets_requirement",
            return_value=False,
        ):
            response = await client.get("/api/v1/analytics/dashboard/course_dropoff?org_id=1")
        assert response.status_code == 403

        with _analytics_guard_patches(), patch(
            "src.routers.analytics._enrich_with_metadata",
            new_callable=AsyncMock,
            side_effect=lambda rows, db, **_: rows,
        ), patch(
            "src.routers.analytics._execute_query",
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
            new_callable=AsyncMock,
            return_value="starter",
        ), patch(
            "src.routers.analytics.plan_meets_requirement",
            return_value=False,
        ):
            response = await client.get("/api/v1/analytics/dashboard/db/unknown_query?org_id=1")
        assert response.status_code == 404

        with _analytics_guard_patches(), patch(
            "src.routers.analytics.get_org_plan",
            new_callable=AsyncMock,
            return_value="starter",
        ), patch(
            "src.routers.analytics.plan_meets_requirement",
            return_value=False,
        ):
            response = await client.get("/api/v1/analytics/dashboard/db/grade_distribution?org_id=1")
        assert response.status_code == 403

    async def test_dashboard_db_and_course_routes(self, client, db_session):
        def _make_execute_result(all_result=None, first_result=None):
            scalars = MagicMock()
            scalars.all.return_value = all_result if all_result is not None else []
            scalars.first.return_value = first_result
            result = MagicMock()
            result.scalars.return_value = scalars
            result.all.return_value = all_result if all_result is not None else []
            return result

        db_session.execute.return_value = _make_execute_result(all_result=[(90, 2), (100, 1)])
        with _analytics_guard_patches(), patch(
            "src.routers.analytics.get_org_plan",
            new_callable=AsyncMock,
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
            new_callable=AsyncMock,
            return_value="pro",
        ), patch(
            "src.routers.analytics.plan_meets_requirement",
            return_value=True,
        ), patch(
            "src.routers.analytics._enrich_with_metadata",
            new_callable=AsyncMock,
            side_effect=lambda rows, db, **_: rows,
        ), patch(
            "src.routers.analytics._execute_query",
            new_callable=AsyncMock,
            return_value={"data": [{"course_uuid": "course_1", "user_id": 1}], "rows": 1, "meta": []},
        ):
            response = await client.get(
                "/api/v1/analytics/dashboard/course/course_overview_stats?org_id=1&course_uuid=course_1"
            )
        assert response.status_code == 200
        assert response.json()["data"][0]["course_uuid"] == "course_1"

        db_session.execute.side_effect = [
            _make_execute_result(first_result=SimpleNamespace(id=100, course_uuid="course_1", name="Course 1")),
            _make_execute_result(all_result=[SimpleNamespace(user_id=7, creation_date="2024-01-01")]),
            # Enriching the rows with user names first asks whether this is the
            # demo organization, because there the names of other visitors must
            # not be handed out. Not a demo here.
            _make_execute_result(first_result=False),
            _make_execute_result(
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
            new_callable=AsyncMock,
            return_value="pro",
        ), patch(
            "src.routers.analytics.plan_meets_requirement",
            return_value=True,
        ), patch(
            "src.routers.analytics._enrich_with_metadata",
            new_callable=AsyncMock,
            side_effect=lambda rows, db, **_: rows,
        ), patch(
            "src.routers.analytics._execute_query",
            new_callable=AsyncMock,
            return_value={"data": [], "rows": 0, "meta": []},
        ):
            response = await client.get(
                "/api/v1/analytics/dashboard/course/detail/course_recent_enrollments?org_id=1&course_uuid=course_1"
            )
        assert response.status_code == 200
        assert response.json()["data"][0]["user_id"] == 7

        db_session.execute.side_effect = None
        with _analytics_guard_patches(), patch(
            "src.routers.analytics.get_org_plan",
            new_callable=AsyncMock,
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
            new_callable=AsyncMock,
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
            new_callable=AsyncMock,
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
            new_callable=AsyncMock,
            side_effect=lambda rows, db, **_: rows,
        ), patch(
            "src.routers.analytics._execute_query",
            new_callable=AsyncMock,
            return_value={"data": [{"course_uuid": "course_1", "user_id": 1}], "rows": 1, "meta": []},
        ):
            response = await client.get("/api/v1/analytics/export?org_id=1&format=json&queries=daily_active_users")
        assert response.status_code == 200
        assert response.json()["daily_active_users"]["rows"] == 1

        with _analytics_guard_patches(), patch(
            "src.routers.analytics._enrich_with_metadata",
            new_callable=AsyncMock,
            side_effect=lambda rows, db, **_: rows,
        ), patch(
            "src.routers.analytics._execute_query",
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
            new_callable=AsyncMock,
            side_effect=lambda rows, db, **_: rows,
        ), patch(
            "src.routers.analytics._execute_query",
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
            new_callable=AsyncMock,
            side_effect=lambda rows, db, **_: rows,
        ), patch(
            "src.routers.analytics._execute_query",
            new_callable=AsyncMock,
            return_value={"data": [{"course_uuid": "course_1", "user_id": 1}], "rows": 1, "meta": []},
        ):
            response = await client.get(
                "/api/v1/analytics/export?org_id=1&format=json&queries=daily_active_users&course_uuid=course_1"
            )
        assert response.status_code == 200

    async def test_export_course_scoped_requires_pro_plan(self, client):
        # Course-scoped export on a sub-Pro plan must be rejected with 403.
        with _analytics_guard_patches(), patch(
            "src.routers.analytics.get_org_plan",
            new_callable=AsyncMock,
            return_value="starter",
        ) as mock_plan, patch(
            "src.routers.analytics.plan_meets_requirement",
            return_value=False,
        ):
            response = await client.get(
                "/api/v1/analytics/export?org_id=1&format=json"
                "&queries=course_overview_stats&course_uuid=course_1"
            )
        assert response.status_code == 403
        assert "Pro plan" in response.json()["detail"]
        mock_plan.assert_awaited_once()

    async def test_export_course_scoped_allows_pro_plan(self, client):
        # When the plan meets Pro the course export proceeds past the gate.
        with _analytics_guard_patches(), patch(
            "src.routers.analytics.get_org_plan",
            new_callable=AsyncMock,
            return_value="pro",
        ), patch(
            "src.routers.analytics.plan_meets_requirement",
            return_value=True,
        ), patch(
            "src.routers.analytics._enrich_with_metadata",
            new_callable=AsyncMock,
            side_effect=lambda rows, db, **_: rows,
        ), patch(
            "src.routers.analytics._execute_query",
            new_callable=AsyncMock,
            return_value={"data": [], "rows": 0, "meta": []},
        ):
            response = await client.get(
                "/api/v1/analytics/export?org_id=1&format=json"
                "&queries=course_overview_stats&course_uuid=course_1"
            )
        assert response.status_code == 200

    async def test_export_advanced_query_requires_enterprise_plan(self, client):
        # Advanced (org-level) queries require Enterprise in SaaS mode; when no
        # bypass applies and the plan is below Enterprise the export is rejected.
        with _analytics_guard_patches(), patch(
            "src.security.features_utils.plan_check._check_mode_bypass",
            return_value=None,
        ), patch(
            "src.routers.analytics.get_org_plan",
            new_callable=AsyncMock,
            return_value="pro",
        ) as mock_plan, patch(
            "src.routers.analytics.plan_meets_requirement",
            return_value=False,
        ):
            response = await client.get(
                "/api/v1/analytics/export?org_id=1&format=json"
                "&queries=peak_usage_hours"
            )
        assert response.status_code == 403
        assert "Enterprise plan" in response.json()["detail"]
        mock_plan.assert_awaited_once()

    async def test_dashboard_unknown_and_course_plan_and_query_validation(self, client):
        with _analytics_guard_patches():
            response = await client.get("/api/v1/analytics/dashboard/detail/unknown_detail?org_id=1")
        assert response.status_code == 404

        with _analytics_guard_patches(), patch(
            "src.routers.analytics.get_org_plan",
            new_callable=AsyncMock,
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
            new_callable=AsyncMock,
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
