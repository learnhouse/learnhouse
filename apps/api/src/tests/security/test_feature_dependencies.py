import pytest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, Mock, patch

from fastapi import HTTPException
from fastapi import Request

from src.db.users import AnonymousUser, PublicUser
from src.security.features_utils.dependencies import (
    _check_feature_enabled,
    require_boards_feature,
    require_courses_feature,
    require_courses_feature_by_activity_uuid,
    require_courses_feature_by_course_uuid,
    require_courses_feature_by_org_id,
    require_courses_feature_by_org_slug,
    require_org_admin,
    require_playgrounds_feature,
)


def _public_user(user_id: int = 7) -> PublicUser:
    return PublicUser(
        id=user_id,
        user_uuid=f"user-{user_id}",
        username=f"user-{user_id}",
        first_name="Test",
        last_name="User",
        email=f"user-{user_id}@example.com",
    )


def _request(path_params=None, query_params=None) -> Mock:
    request = Mock(spec=Request)
    request.path_params = path_params or {}
    request.query_params = query_params or {}
    return request


def _make_async_session(*results: object) -> AsyncMock:
    """
    Build an AsyncMock session that returns each item in `results` in sequence
    from ``(await session.execute(...)).scalars().first()``.
    """
    session = AsyncMock()
    execute_results = []
    for result in results:
        mock_result = MagicMock()
        mock_result.scalars.return_value.first.return_value = result
        execute_results.append(mock_result)

    if len(execute_results) == 1:
        session.execute.return_value = execute_results[0]
    else:
        session.execute.side_effect = execute_results

    return session


class TestFeatureDependencies:
    async def test_require_org_admin_rejects_anonymous_user(self):
        with pytest.raises(HTTPException) as exc_info:
            await require_org_admin(1, AnonymousUser(), AsyncMock())

        assert exc_info.value.status_code == 401
        assert "Authentication required" in exc_info.value.detail

    async def test_require_org_admin_returns_404_when_org_missing(self):
        db_session = _make_async_session(None)

        with patch("src.security.superadmin.is_user_superadmin", new=AsyncMock(return_value=False)):
            with pytest.raises(HTTPException) as exc_info:
                await require_org_admin(1, _public_user(), db_session)

        assert exc_info.value.status_code == 404
        assert "Organization not found" in exc_info.value.detail

    async def test_require_org_admin_allows_superadmin_bypass(self):
        db_session = _make_async_session(SimpleNamespace(id=1))

        with patch("src.security.superadmin.is_user_superadmin", new=AsyncMock(return_value=True)):
            result = await require_org_admin(1, _public_user(), db_session)

        assert result is True

    async def test_require_org_admin_allows_org_admin(self):
        db_session = _make_async_session(SimpleNamespace(id=1), SimpleNamespace(id=2))

        with patch("src.security.superadmin.is_user_superadmin", new=AsyncMock(return_value=False)):
            result = await require_org_admin(1, _public_user(), db_session)

        assert result is True

    async def test_require_org_admin_rejects_non_admin_member(self):
        db_session = _make_async_session(SimpleNamespace(id=1), None)

        with patch("src.security.superadmin.is_user_superadmin", new=AsyncMock(return_value=False)):
            with pytest.raises(HTTPException) as exc_info:
                await require_org_admin(1, _public_user(), db_session)

        assert exc_info.value.status_code == 403
        assert "Only organization admins" in exc_info.value.detail

    async def test_check_feature_enabled_returns_404_without_config(self):
        db_session = _make_async_session(None)

        with pytest.raises(HTTPException) as exc_info:
            await _check_feature_enabled("courses", 1, db_session)

        assert exc_info.value.status_code == 404
        assert "Organization has no config" in exc_info.value.detail

    async def test_check_feature_enabled_rejects_disabled_feature(self):
        db_session = _make_async_session(SimpleNamespace(config={"config_version": "2.0"}))

        with patch("src.security.features_utils.resolve.resolve_feature", return_value={"enabled": False}):
            with pytest.raises(HTTPException) as exc_info:
                await _check_feature_enabled("courses", 1, db_session)

        assert exc_info.value.status_code == 403
        assert "Courses feature is not enabled" in exc_info.value.detail

    async def test_check_feature_enabled_allows_enabled_feature(self):
        org_config = SimpleNamespace(config={"config_version": "2.0", "plan": "pro"})
        db_session = _make_async_session(org_config)

        with patch("src.security.features_utils.resolve.resolve_feature", return_value={"enabled": True}):
            result = await _check_feature_enabled("courses", 1, db_session)

        assert result is True

    async def test_require_courses_feature_by_org_id_delegates(self):
        db_session = AsyncMock()

        with patch("src.security.features_utils.dependencies._check_feature_enabled", new=AsyncMock(return_value=True)) as mock_check:
            result = await require_courses_feature_by_org_id(3, db_session)

        assert result is True
        mock_check.assert_called_once_with("courses", 3, db_session)

    async def test_require_courses_feature_by_org_slug_returns_404_when_missing(self):
        db_session = _make_async_session(None)

        with pytest.raises(HTTPException) as exc_info:
            await require_courses_feature_by_org_slug("missing", db_session)

        assert exc_info.value.status_code == 404

    async def test_require_courses_feature_by_org_slug_delegates(self):
        db_session = _make_async_session(SimpleNamespace(id=8))

        with patch("src.security.features_utils.dependencies._check_feature_enabled", new=AsyncMock(return_value=True)) as mock_check:
            result = await require_courses_feature_by_org_slug("org-8", db_session)

        assert result is True
        mock_check.assert_called_once_with("courses", 8, db_session)

    async def test_require_courses_feature_by_course_uuid_returns_404_when_missing(self):
        db_session = _make_async_session(None)

        with pytest.raises(HTTPException) as exc_info:
            await require_courses_feature_by_course_uuid("course-1", db_session)

        assert exc_info.value.status_code == 404

    async def test_require_courses_feature_by_course_uuid_delegates(self):
        db_session = _make_async_session(SimpleNamespace(org_id=11))

        with patch("src.security.features_utils.dependencies._check_feature_enabled", new=AsyncMock(return_value=True)) as mock_check:
            result = await require_courses_feature_by_course_uuid("course-1", db_session)

        assert result is True
        mock_check.assert_called_once_with("courses", 11, db_session)

    async def test_require_courses_feature_by_activity_uuid_returns_404_when_activity_missing(self):
        db_session = _make_async_session(None)

        with pytest.raises(HTTPException) as exc_info:
            await require_courses_feature_by_activity_uuid("activity-1", db_session)

        assert exc_info.value.status_code == 404
        assert "Activity not found" in exc_info.value.detail

    async def test_require_courses_feature_by_activity_uuid_returns_404_when_course_missing(self):
        db_session = _make_async_session(SimpleNamespace(course_id=22), None)

        with pytest.raises(HTTPException) as exc_info:
            await require_courses_feature_by_activity_uuid("activity-1", db_session)

        assert exc_info.value.status_code == 404
        assert "Course not found" in exc_info.value.detail

    async def test_require_courses_feature_by_activity_uuid_delegates(self):
        db_session = _make_async_session(SimpleNamespace(course_id=22), SimpleNamespace(org_id=44))

        with patch("src.security.features_utils.dependencies._check_feature_enabled", new=AsyncMock(return_value=True)) as mock_check:
            result = await require_courses_feature_by_activity_uuid("activity-1", db_session)

        assert result is True
        mock_check.assert_called_once_with("courses", 44, db_session)

    async def test_require_courses_feature_prefers_course_uuid(self):
        db_session = _make_async_session(SimpleNamespace(org_id=5))
        request = _request({"course_uuid": "course-1"})

        with patch("src.security.features_utils.dependencies._check_feature_enabled", new=AsyncMock(return_value=True)) as mock_check:
            result = await require_courses_feature(request, db_session)

        assert result is True
        mock_check.assert_called_once_with("courses", 5, db_session)

    async def test_require_courses_feature_rejects_missing_course_uuid(self):
        db_session = _make_async_session(None)
        request = _request({"course_uuid": "course-1"})

        with pytest.raises(HTTPException) as exc_info:
            await require_courses_feature(request, db_session)

        assert exc_info.value.status_code == 404
        assert "Course not found" in exc_info.value.detail

    async def test_require_courses_feature_handles_activity_uuid(self):
        db_session = _make_async_session(SimpleNamespace(course_id=2), SimpleNamespace(org_id=9))
        request = _request({"activity_uuid": "activity-1"})

        with patch("src.security.features_utils.dependencies._check_feature_enabled", new=AsyncMock(return_value=True)) as mock_check:
            result = await require_courses_feature(request, db_session)

        assert result is True
        mock_check.assert_called_once_with("courses", 9, db_session)

    async def test_require_courses_feature_rejects_missing_activity_uuid(self):
        db_session = _make_async_session(None)
        request = _request({"activity_uuid": "activity-1"})

        with pytest.raises(HTTPException) as exc_info:
            await require_courses_feature(request, db_session)

        assert exc_info.value.status_code == 404
        assert "Activity not found" in exc_info.value.detail

    async def test_require_courses_feature_rejects_missing_course_for_activity(self):
        db_session = _make_async_session(SimpleNamespace(course_id=2), None)
        request = _request({"activity_uuid": "activity-1"})

        with pytest.raises(HTTPException) as exc_info:
            await require_courses_feature(request, db_session)

        assert exc_info.value.status_code == 404
        assert "Course not found" in exc_info.value.detail

    async def test_require_courses_feature_handles_org_slug(self):
        db_session = _make_async_session(SimpleNamespace(id=12))
        request = _request({"org_slug": "org-12"})

        with patch("src.security.features_utils.dependencies._check_feature_enabled", new=AsyncMock(return_value=True)) as mock_check:
            result = await require_courses_feature(request, db_session)

        assert result is True
        mock_check.assert_called_once_with("courses", 12, db_session)

    async def test_require_courses_feature_rejects_missing_org_slug(self):
        db_session = _make_async_session(None)
        request = _request({"org_slug": "missing"})

        with pytest.raises(HTTPException) as exc_info:
            await require_courses_feature(request, db_session)

        assert exc_info.value.status_code == 404
        assert "Organization not found" in exc_info.value.detail

    async def test_require_courses_feature_handles_org_id(self):
        db_session = AsyncMock()
        request = _request({"org_id": "13"})

        with patch("src.security.features_utils.dependencies._check_feature_enabled", new=AsyncMock(return_value=True)) as mock_check:
            result = await require_courses_feature(request, db_session)

        assert result is True
        mock_check.assert_called_once_with("courses", 13, db_session)

    async def test_require_courses_feature_rejects_invalid_org_id(self):
        request = _request({"org_id": "bad"})

        with pytest.raises(HTTPException) as exc_info:
            await require_courses_feature(request, AsyncMock())

        assert exc_info.value.status_code == 400
        assert "Invalid org_id format" in exc_info.value.detail

    async def test_require_courses_feature_allows_unrelated_route(self):
        result = await require_courses_feature(_request(), AsyncMock())

        assert result is True

    async def test_require_boards_feature_returns_true_when_no_org(self):
        result = await require_boards_feature(_request(), AsyncMock())

        assert result is True

    async def test_require_boards_feature_ignores_invalid_query_org_id(self):
        request = _request(query_params={"org_id": "bad"})

        result = await require_boards_feature(request, AsyncMock())

        assert result is True

    async def test_require_boards_feature_rejects_invalid_org_id(self):
        request = _request({"org_id": "bad"})

        with pytest.raises(HTTPException) as exc_info:
            await require_boards_feature(request, AsyncMock())

        assert exc_info.value.status_code == 400

    async def test_require_boards_feature_rejects_missing_board(self):
        db_session = _make_async_session(None)
        request = _request({"board_uuid": "board-1"})

        with pytest.raises(HTTPException) as exc_info:
            await require_boards_feature(request, db_session)

        assert exc_info.value.status_code == 404
        assert "Board not found" in exc_info.value.detail

    async def test_require_boards_feature_allows_query_org_id(self):
        db_session = _make_async_session(SimpleNamespace(config={"config_version": "2.0", "plan": "pro"}))
        request = _request(query_params={"org_id": "42"})

        with patch("src.security.features_utils.dependencies._check_feature_enabled", new=AsyncMock(return_value=True)) as mock_check, \
             patch("src.security.features_utils.plan_check.get_org_plan", return_value="pro"), \
             patch("src.security.features_utils.plans.plan_meets_requirement", return_value=True):
            result = await require_boards_feature(request, db_session)

        assert result is True
        mock_check.assert_called_once_with("boards", 42, db_session)

    async def test_require_boards_feature_rejects_below_personal_plan(self):
        db_session = _make_async_session(SimpleNamespace(org_id=21), SimpleNamespace(config={"config_version": "2.0", "plan": "free"}))
        request = _request({"board_uuid": "board-1"})

        with patch("src.security.features_utils.dependencies._check_feature_enabled", new=AsyncMock(return_value=True)) as mock_check, \
             patch("src.security.features_utils.plan_check.get_org_plan", return_value="free"), \
             patch("src.security.features_utils.plans.plan_meets_requirement", return_value=False):
            with pytest.raises(HTTPException) as exc_info:
                await require_boards_feature(request, db_session)

        mock_check.assert_called_once_with("boards", 21, db_session)
        assert exc_info.value.status_code == 403
        assert "Boards requires a Personal plan or higher" in exc_info.value.detail

    async def test_require_boards_feature_allows_pro_plan(self):
        db_session = _make_async_session(SimpleNamespace(org_id=21), SimpleNamespace(config={"config_version": "2.0", "plan": "pro"}))
        request = _request({"board_uuid": "board-1"})

        with patch("src.security.features_utils.dependencies._check_feature_enabled", new=AsyncMock(return_value=True)) as mock_check, \
             patch("src.security.features_utils.plan_check.get_org_plan", return_value="pro"), \
             patch("src.security.features_utils.plans.plan_meets_requirement", return_value=True):
            result = await require_boards_feature(request, db_session)

        assert result is True
        mock_check.assert_called_once_with("boards", 21, db_session)

    async def test_require_playgrounds_feature_returns_true_when_no_org(self):
        result = await require_playgrounds_feature(_request(), AsyncMock())

        assert result is True

    async def test_require_playgrounds_feature_rejects_invalid_org_id(self):
        request = _request({"org_id": "bad"})

        with pytest.raises(HTTPException) as exc_info:
            await require_playgrounds_feature(request, AsyncMock())

        assert exc_info.value.status_code == 400

    async def test_require_playgrounds_feature_ignores_invalid_query_org_id(self):
        request = _request(query_params={"org_id": "bad"})

        result = await require_playgrounds_feature(request, AsyncMock())

        assert result is True

    async def test_require_playgrounds_feature_ignores_missing_playground_uuid(self):
        db_session = _make_async_session(None)
        request = _request({"playground_uuid": "pg-1", "org_id": "23"})

        with patch("src.security.features_utils.dependencies._check_feature_enabled", new=AsyncMock(return_value=True)) as mock_check, \
             patch("src.core.deployment_mode.get_deployment_mode", return_value="ee"):
            result = await require_playgrounds_feature(request, db_session)

        assert result is True
        mock_check.assert_called_once_with("playgrounds", 23, db_session)

    async def test_require_playgrounds_feature_allows_query_org_id_in_saas(self):
        db_session = _make_async_session(SimpleNamespace(config={"config_version": "2.0", "plan": "pro"}))
        request = _request(query_params={"org_id": "55"})

        with patch("src.security.features_utils.dependencies._check_feature_enabled", new=AsyncMock(return_value=True)) as mock_check, \
             patch("src.core.deployment_mode.get_deployment_mode", return_value="saas"), \
             patch("src.security.features_utils.plan_check.get_org_plan", return_value="pro"), \
             patch("src.security.features_utils.plans.plan_meets_requirement", return_value=True):
            result = await require_playgrounds_feature(request, db_session)

        assert result is True
        mock_check.assert_called_once_with("playgrounds", 55, db_session)

    async def test_require_playgrounds_feature_rejects_below_personal_plan_in_saas(self):
        db_session = _make_async_session(SimpleNamespace(org_id=31), SimpleNamespace(config={"config_version": "2.0", "plan": "free"}))
        request = _request({"playground_uuid": "pg-1"})

        with patch("src.security.features_utils.dependencies._check_feature_enabled", new=AsyncMock(return_value=True)) as mock_check, \
             patch("src.core.deployment_mode.get_deployment_mode", return_value="saas"), \
             patch("src.security.features_utils.plan_check.get_org_plan", return_value="free"), \
             patch("src.security.features_utils.plans.plan_meets_requirement", return_value=False):
            with pytest.raises(HTTPException) as exc_info:
                await require_playgrounds_feature(request, db_session)

        mock_check.assert_called_once_with("playgrounds", 31, db_session)
        assert exc_info.value.status_code == 403
        assert "Playgrounds requires a Personal plan or higher" in exc_info.value.detail

    async def test_require_playgrounds_feature_allows_non_saas_bypass(self):
        db_session = _make_async_session(SimpleNamespace(org_id=31), SimpleNamespace(config={"config_version": "2.0", "plan": "standard"}))
        request = _request({"playground_uuid": "pg-1"})

        with patch("src.security.features_utils.dependencies._check_feature_enabled", new=AsyncMock(return_value=True)) as mock_check, \
             patch("src.core.deployment_mode.get_deployment_mode", return_value="oss"):
            result = await require_playgrounds_feature(request, db_session)

        assert result is True
        mock_check.assert_called_once_with("playgrounds", 31, db_session)
