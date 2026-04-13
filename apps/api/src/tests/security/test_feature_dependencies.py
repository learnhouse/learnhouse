import pytest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from fastapi import HTTPException
from fastapi import Request
from sqlmodel import Session

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


def _exec_sequence(session: Mock, *results: object) -> None:
    calls = []

    def _side_effect(_statement):
        result = Mock()
        index = len(calls)
        result.first.return_value = results[index] if index < len(results) else None
        calls.append(_statement)
        return result

    session.exec.side_effect = _side_effect


class TestFeatureDependencies:
    def test_require_org_admin_rejects_anonymous_user(self):
        with pytest.raises(HTTPException) as exc_info:
            import asyncio

            asyncio.run(require_org_admin(1, AnonymousUser(), Mock(spec=Session)))

        assert exc_info.value.status_code == 401
        assert "Authentication required" in exc_info.value.detail

    def test_require_org_admin_returns_404_when_org_missing(self):
        db_session = Mock(spec=Session)
        _exec_sequence(db_session, None)

        with patch("src.security.superadmin.is_user_superadmin", return_value=False):
            with pytest.raises(HTTPException) as exc_info:
                import asyncio

                asyncio.run(require_org_admin(1, _public_user(), db_session))

        assert exc_info.value.status_code == 404
        assert "Organization not found" in exc_info.value.detail

    def test_require_org_admin_allows_superadmin_bypass(self):
        db_session = Mock(spec=Session)
        _exec_sequence(db_session, SimpleNamespace(id=1))

        with patch("src.security.superadmin.is_user_superadmin", return_value=True):
            import asyncio

            result = asyncio.run(require_org_admin(1, _public_user(), db_session))

        assert result is True
        assert db_session.exec.call_count == 1

    def test_require_org_admin_allows_org_admin(self):
        db_session = Mock(spec=Session)
        _exec_sequence(db_session, SimpleNamespace(id=1), SimpleNamespace(id=2))

        with patch("src.security.superadmin.is_user_superadmin", return_value=False):
            import asyncio

            result = asyncio.run(require_org_admin(1, _public_user(), db_session))

        assert result is True
        assert db_session.exec.call_count == 2

    def test_require_org_admin_rejects_non_admin_member(self):
        db_session = Mock(spec=Session)
        _exec_sequence(db_session, SimpleNamespace(id=1), None)

        with patch("src.security.superadmin.is_user_superadmin", return_value=False):
            with pytest.raises(HTTPException) as exc_info:
                import asyncio

                asyncio.run(require_org_admin(1, _public_user(), db_session))

        assert exc_info.value.status_code == 403
        assert "Only organization admins" in exc_info.value.detail

    def test_check_feature_enabled_returns_404_without_config(self):
        db_session = Mock(spec=Session)
        _exec_sequence(db_session, None)

        with pytest.raises(HTTPException) as exc_info:
            _check_feature_enabled("courses", 1, db_session)

        assert exc_info.value.status_code == 404
        assert "Organization has no config" in exc_info.value.detail

    def test_check_feature_enabled_rejects_disabled_feature(self):
        db_session = Mock(spec=Session)
        _exec_sequence(db_session, SimpleNamespace(config={"config_version": "2.0"}))

        with patch("src.security.features_utils.resolve.resolve_feature", return_value={"enabled": False}):
            with pytest.raises(HTTPException) as exc_info:
                _check_feature_enabled("courses", 1, db_session)

        assert exc_info.value.status_code == 403
        assert "Courses feature is not enabled" in exc_info.value.detail

    def test_check_feature_enabled_allows_enabled_feature(self):
        db_session = Mock(spec=Session)
        org_config = SimpleNamespace(config={"config_version": "2.0", "plan": "pro"})
        _exec_sequence(db_session, org_config)

        with patch("src.security.features_utils.resolve.resolve_feature", return_value={"enabled": True}):
            result = _check_feature_enabled("courses", 1, db_session)

        assert result is True

    def test_require_courses_feature_by_org_id_delegates(self):
        db_session = Mock(spec=Session)

        with patch("src.security.features_utils.dependencies._check_feature_enabled", return_value=True) as mock_check:
            result = require_courses_feature_by_org_id(3, db_session)

        assert result is True
        mock_check.assert_called_once_with("courses", 3, db_session)

    def test_require_courses_feature_by_org_slug_returns_404_when_missing(self):
        db_session = Mock(spec=Session)
        _exec_sequence(db_session, None)

        with pytest.raises(HTTPException) as exc_info:
            require_courses_feature_by_org_slug("missing", db_session)

        assert exc_info.value.status_code == 404

    def test_require_courses_feature_by_org_slug_delegates(self):
        db_session = Mock(spec=Session)
        _exec_sequence(db_session, SimpleNamespace(id=8))

        with patch("src.security.features_utils.dependencies._check_feature_enabled", return_value=True) as mock_check:
            result = require_courses_feature_by_org_slug("org-8", db_session)

        assert result is True
        mock_check.assert_called_once_with("courses", 8, db_session)

    def test_require_courses_feature_by_course_uuid_returns_404_when_missing(self):
        db_session = Mock(spec=Session)
        _exec_sequence(db_session, None)

        with pytest.raises(HTTPException) as exc_info:
            require_courses_feature_by_course_uuid("course-1", db_session)

        assert exc_info.value.status_code == 404

    def test_require_courses_feature_by_course_uuid_delegates(self):
        db_session = Mock(spec=Session)
        _exec_sequence(db_session, SimpleNamespace(org_id=11))

        with patch("src.security.features_utils.dependencies._check_feature_enabled", return_value=True) as mock_check:
            result = require_courses_feature_by_course_uuid("course-1", db_session)

        assert result is True
        mock_check.assert_called_once_with("courses", 11, db_session)

    def test_require_courses_feature_by_activity_uuid_returns_404_when_activity_missing(self):
        db_session = Mock(spec=Session)
        _exec_sequence(db_session, None)

        with pytest.raises(HTTPException) as exc_info:
            require_courses_feature_by_activity_uuid("activity-1", db_session)

        assert exc_info.value.status_code == 404
        assert "Activity not found" in exc_info.value.detail

    def test_require_courses_feature_by_activity_uuid_returns_404_when_course_missing(self):
        db_session = Mock(spec=Session)
        _exec_sequence(db_session, SimpleNamespace(course_id=22), None)

        with pytest.raises(HTTPException) as exc_info:
            require_courses_feature_by_activity_uuid("activity-1", db_session)

        assert exc_info.value.status_code == 404
        assert "Course not found" in exc_info.value.detail

    def test_require_courses_feature_by_activity_uuid_delegates(self):
        db_session = Mock(spec=Session)
        _exec_sequence(db_session, SimpleNamespace(course_id=22), SimpleNamespace(org_id=44))

        with patch("src.security.features_utils.dependencies._check_feature_enabled", return_value=True) as mock_check:
            result = require_courses_feature_by_activity_uuid("activity-1", db_session)

        assert result is True
        mock_check.assert_called_once_with("courses", 44, db_session)

    @pytest.mark.asyncio
    async def test_require_courses_feature_prefers_course_uuid(self):
        db_session = Mock(spec=Session)
        _exec_sequence(db_session, SimpleNamespace(org_id=5))
        request = _request({"course_uuid": "course-1"})

        with patch("src.security.features_utils.dependencies._check_feature_enabled", return_value=True) as mock_check:
            result = await require_courses_feature(request, db_session)

        assert result is True
        mock_check.assert_called_once_with("courses", 5, db_session)

    @pytest.mark.asyncio
    async def test_require_courses_feature_rejects_missing_course_uuid(self):
        db_session = Mock(spec=Session)
        _exec_sequence(db_session, None)
        request = _request({"course_uuid": "course-1"})

        with pytest.raises(HTTPException) as exc_info:
            await require_courses_feature(request, db_session)

        assert exc_info.value.status_code == 404
        assert "Course not found" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_require_courses_feature_handles_activity_uuid(self):
        db_session = Mock(spec=Session)
        _exec_sequence(db_session, SimpleNamespace(course_id=2), SimpleNamespace(org_id=9))
        request = _request({"activity_uuid": "activity-1"})

        with patch("src.security.features_utils.dependencies._check_feature_enabled", return_value=True) as mock_check:
            result = await require_courses_feature(request, db_session)

        assert result is True
        mock_check.assert_called_once_with("courses", 9, db_session)

    @pytest.mark.asyncio
    async def test_require_courses_feature_rejects_missing_activity_uuid(self):
        db_session = Mock(spec=Session)
        _exec_sequence(db_session, None)
        request = _request({"activity_uuid": "activity-1"})

        with pytest.raises(HTTPException) as exc_info:
            await require_courses_feature(request, db_session)

        assert exc_info.value.status_code == 404
        assert "Activity not found" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_require_courses_feature_rejects_missing_course_for_activity(self):
        db_session = Mock(spec=Session)
        _exec_sequence(db_session, SimpleNamespace(course_id=2), None)
        request = _request({"activity_uuid": "activity-1"})

        with pytest.raises(HTTPException) as exc_info:
            await require_courses_feature(request, db_session)

        assert exc_info.value.status_code == 404
        assert "Course not found" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_require_courses_feature_handles_org_slug(self):
        db_session = Mock(spec=Session)
        _exec_sequence(db_session, SimpleNamespace(id=12))
        request = _request({"org_slug": "org-12"})

        with patch("src.security.features_utils.dependencies._check_feature_enabled", return_value=True) as mock_check:
            result = await require_courses_feature(request, db_session)

        assert result is True
        mock_check.assert_called_once_with("courses", 12, db_session)

    @pytest.mark.asyncio
    async def test_require_courses_feature_rejects_missing_org_slug(self):
        db_session = Mock(spec=Session)
        _exec_sequence(db_session, None)
        request = _request({"org_slug": "missing"})

        with pytest.raises(HTTPException) as exc_info:
            await require_courses_feature(request, db_session)

        assert exc_info.value.status_code == 404
        assert "Organization not found" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_require_courses_feature_handles_org_id(self):
        db_session = Mock(spec=Session)
        request = _request({"org_id": "13"})

        with patch("src.security.features_utils.dependencies._check_feature_enabled", return_value=True) as mock_check:
            result = await require_courses_feature(request, db_session)

        assert result is True
        mock_check.assert_called_once_with("courses", 13, db_session)

    @pytest.mark.asyncio
    async def test_require_courses_feature_rejects_invalid_org_id(self):
        request = _request({"org_id": "bad"})

        with pytest.raises(HTTPException) as exc_info:
            await require_courses_feature(request, Mock(spec=Session))

        assert exc_info.value.status_code == 400
        assert "Invalid org_id format" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_require_courses_feature_allows_unrelated_route(self):
        result = await require_courses_feature(_request(), Mock(spec=Session))

        assert result is True

    @pytest.mark.asyncio
    async def test_require_boards_feature_returns_true_when_no_org(self):
        result = await require_boards_feature(_request(), Mock(spec=Session))

        assert result is True

    @pytest.mark.asyncio
    async def test_require_boards_feature_ignores_invalid_query_org_id(self):
        request = _request(query_params={"org_id": "bad"})

        result = await require_boards_feature(request, Mock(spec=Session))

        assert result is True

    @pytest.mark.asyncio
    async def test_require_boards_feature_rejects_invalid_org_id(self):
        request = _request({"org_id": "bad"})

        with pytest.raises(HTTPException) as exc_info:
            await require_boards_feature(request, Mock(spec=Session))

        assert exc_info.value.status_code == 400

    @pytest.mark.asyncio
    async def test_require_boards_feature_rejects_missing_board(self):
        db_session = Mock(spec=Session)
        _exec_sequence(db_session, None)
        request = _request({"board_uuid": "board-1"})

        with pytest.raises(HTTPException) as exc_info:
            await require_boards_feature(request, db_session)

        assert exc_info.value.status_code == 404
        assert "Board not found" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_require_boards_feature_allows_query_org_id(self):
        db_session = Mock(spec=Session)
        _exec_sequence(db_session, SimpleNamespace(config={"config_version": "2.0", "plan": "pro"}))
        request = _request(query_params={"org_id": "42"})

        with patch("src.security.features_utils.dependencies._check_feature_enabled", return_value=True) as mock_check, \
             patch("src.security.features_utils.plan_check.get_org_plan", return_value="pro"), \
             patch("src.security.features_utils.plans.plan_meets_requirement", return_value=True):
            result = await require_boards_feature(request, db_session)

        assert result is True
        mock_check.assert_called_once_with("boards", 42, db_session)

    @pytest.mark.asyncio
    async def test_require_boards_feature_rejects_non_pro_plan(self):
        db_session = Mock(spec=Session)
        _exec_sequence(db_session, SimpleNamespace(org_id=21), SimpleNamespace(config={"config_version": "2.0", "plan": "standard"}))
        request = _request({"board_uuid": "board-1"})

        with patch("src.security.features_utils.dependencies._check_feature_enabled", return_value=True) as mock_check, \
             patch("src.security.features_utils.plan_check.get_org_plan", return_value="standard"), \
             patch("src.security.features_utils.plans.plan_meets_requirement", return_value=False):
            with pytest.raises(HTTPException) as exc_info:
                await require_boards_feature(request, db_session)

        mock_check.assert_called_once_with("boards", 21, db_session)
        assert exc_info.value.status_code == 403
        assert "Boards requires a Pro plan or higher" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_require_boards_feature_allows_pro_plan(self):
        db_session = Mock(spec=Session)
        _exec_sequence(db_session, SimpleNamespace(org_id=21), SimpleNamespace(config={"config_version": "2.0", "plan": "pro"}))
        request = _request({"board_uuid": "board-1"})

        with patch("src.security.features_utils.dependencies._check_feature_enabled", return_value=True) as mock_check, \
             patch("src.security.features_utils.plan_check.get_org_plan", return_value="pro"), \
             patch("src.security.features_utils.plans.plan_meets_requirement", return_value=True):
            result = await require_boards_feature(request, db_session)

        assert result is True
        mock_check.assert_called_once_with("boards", 21, db_session)

    @pytest.mark.asyncio
    async def test_require_playgrounds_feature_returns_true_when_no_org(self):
        result = await require_playgrounds_feature(_request(), Mock(spec=Session))

        assert result is True

    @pytest.mark.asyncio
    async def test_require_playgrounds_feature_rejects_invalid_org_id(self):
        request = _request({"org_id": "bad"})

        with pytest.raises(HTTPException) as exc_info:
            await require_playgrounds_feature(request, Mock(spec=Session))

        assert exc_info.value.status_code == 400

    @pytest.mark.asyncio
    async def test_require_playgrounds_feature_ignores_invalid_query_org_id(self):
        request = _request(query_params={"org_id": "bad"})

        result = await require_playgrounds_feature(request, Mock(spec=Session))

        assert result is True

    @pytest.mark.asyncio
    async def test_require_playgrounds_feature_ignores_missing_playground_uuid(self):
        db_session = Mock(spec=Session)
        _exec_sequence(db_session, None)
        request = _request({"playground_uuid": "pg-1", "org_id": "23"})

        with patch("src.security.features_utils.dependencies._check_feature_enabled", return_value=True) as mock_check, \
             patch("src.core.deployment_mode.get_deployment_mode", return_value="ee"):
            result = await require_playgrounds_feature(request, db_session)

        assert result is True
        mock_check.assert_called_once_with("playgrounds", 23, db_session)

    @pytest.mark.asyncio
    async def test_require_playgrounds_feature_allows_query_org_id_in_saas(self):
        db_session = Mock(spec=Session)
        _exec_sequence(db_session, SimpleNamespace(config={"config_version": "2.0", "plan": "pro"}))
        request = _request(query_params={"org_id": "55"})

        with patch("src.security.features_utils.dependencies._check_feature_enabled", return_value=True) as mock_check, \
             patch("src.core.deployment_mode.get_deployment_mode", return_value="saas"), \
             patch("src.security.features_utils.plan_check.get_org_plan", return_value="pro"), \
             patch("src.security.features_utils.plans.plan_meets_requirement", return_value=True):
            result = await require_playgrounds_feature(request, db_session)

        assert result is True
        mock_check.assert_called_once_with("playgrounds", 55, db_session)

    @pytest.mark.asyncio
    async def test_require_playgrounds_feature_rejects_non_pro_plan_in_saas(self):
        db_session = Mock(spec=Session)
        _exec_sequence(db_session, SimpleNamespace(org_id=31), SimpleNamespace(config={"config_version": "2.0", "plan": "standard"}))
        request = _request({"playground_uuid": "pg-1"})

        with patch("src.security.features_utils.dependencies._check_feature_enabled", return_value=True) as mock_check, \
             patch("src.core.deployment_mode.get_deployment_mode", return_value="saas"), \
             patch("src.security.features_utils.plan_check.get_org_plan", return_value="standard"), \
             patch("src.security.features_utils.plans.plan_meets_requirement", return_value=False):
            with pytest.raises(HTTPException) as exc_info:
                await require_playgrounds_feature(request, db_session)

        mock_check.assert_called_once_with("playgrounds", 31, db_session)
        assert exc_info.value.status_code == 403
        assert "Playgrounds requires a Pro plan or higher" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_require_playgrounds_feature_allows_non_saas_bypass(self):
        db_session = Mock(spec=Session)
        _exec_sequence(db_session, SimpleNamespace(org_id=31), SimpleNamespace(config={"config_version": "2.0", "plan": "standard"}))
        request = _request({"playground_uuid": "pg-1"})

        with patch("src.security.features_utils.dependencies._check_feature_enabled", return_value=True) as mock_check, \
             patch("src.core.deployment_mode.get_deployment_mode", return_value="oss"):
            result = await require_playgrounds_feature(request, db_session)

        assert result is True
        mock_check.assert_called_once_with("playgrounds", 31, db_session)
