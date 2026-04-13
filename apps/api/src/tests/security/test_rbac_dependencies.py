from unittest.mock import AsyncMock, Mock, patch

import pytest
from fastapi import HTTPException, Request

from src.db.users import PublicUser
from src.security.rbac.dependencies import (
    _get_current_user_dependency,
    CommunityAccess,
    CourseAccess,
    PodcastAccess,
    require_create_access,
    require_dashboard_access,
    require_read_access,
    require_resource_access,
    require_write_access,
)
from src.security.rbac.types import AccessAction, AccessContext, AccessDecision


def _request(path_params=None):
    request = Mock(spec=Request)
    request.path_params = path_params or {}
    return request


def _user(user_id: int = 7) -> PublicUser:
    return PublicUser(
        id=user_id,
        user_uuid=f"user-{user_id}",
        username=f"user-{user_id}",
        first_name="Test",
        last_name="User",
        email=f"user-{user_id}@example.com",
    )


class TestRbacDependencies:
    def test_get_current_user_dependency_returns_auth_helper(self):
        from src.security.auth import get_current_user

        assert _get_current_user_dependency() is get_current_user

    @pytest.mark.asyncio
    async def test_require_resource_access_allows_and_passes_through_flags(self):
        request = _request({"course_uuid": "course_123"})
        db_session = Mock()
        current_user = _user()
        decision = AccessDecision(
            allowed=True,
            reason="allowed",
            resource_uuid="course_123",
        )

        with patch("src.security.rbac.dependencies.ResourceAccessChecker") as mock_checker_cls:
            checker = mock_checker_cls.return_value
            checker.check_access = AsyncMock(return_value=decision)

            dependency = require_resource_access(
                AccessAction.DELETE,
                AccessContext.DASHBOARD,
                require_ownership=True,
                resource_uuid_param="course_uuid",
            )
            result = await dependency(
                request=request,
                db_session=db_session,
                current_user=current_user,
            )

        assert result is decision
        mock_checker_cls.assert_called_once_with(request, db_session, current_user)
        checker.check_access.assert_awaited_once_with(
            "course_123",
            AccessAction.DELETE,
            AccessContext.DASHBOARD,
            True,
        )

    @pytest.mark.asyncio
    async def test_require_resource_access_rejects_missing_path_param(self):
        request = _request({})
        db_session = Mock()

        dependency = require_resource_access(
            AccessAction.READ,
            resource_uuid_param="course_uuid",
        )

        with pytest.raises(HTTPException) as exc_info:
            await dependency(
                request=request,
                db_session=db_session,
                current_user=_user(),
            )

        assert exc_info.value.status_code == 400
        assert "course_uuid" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_require_resource_access_rejects_denied_access(self):
        request = _request({"resource_uuid": "course_123"})
        db_session = Mock()
        decision = AccessDecision(
            allowed=False,
            reason="forbidden",
            resource_uuid="course_123",
        )

        with patch("src.security.rbac.dependencies.ResourceAccessChecker") as mock_checker_cls:
            checker = mock_checker_cls.return_value
            checker.check_access = AsyncMock(return_value=decision)

            dependency = require_resource_access(AccessAction.READ)

            with pytest.raises(HTTPException) as exc_info:
                await dependency(
                    request=request,
                    db_session=db_session,
                    current_user=_user(),
                )

        assert exc_info.value.status_code == 403
        assert exc_info.value.detail == "forbidden"
        checker.check_access.assert_awaited_once_with(
            "course_123",
            AccessAction.READ,
            AccessContext.PUBLIC_VIEW,
            False,
        )

    def test_read_write_and_dashboard_factories_delegate(self):
        with patch("src.security.rbac.dependencies.require_resource_access", return_value="sentinel") as mock_rr:
            assert require_read_access("course_uuid", AccessContext.DASHBOARD) == "sentinel"
            mock_rr.assert_called_once_with(
                action=AccessAction.READ,
                context=AccessContext.DASHBOARD,
                resource_uuid_param="course_uuid",
            )

        with patch("src.security.rbac.dependencies.require_resource_access", return_value="sentinel") as mock_rr:
            assert require_write_access(AccessAction.DELETE, "podcast_uuid", require_ownership=False) == "sentinel"
            mock_rr.assert_called_once_with(
                action=AccessAction.DELETE,
                context=AccessContext.DASHBOARD,
                require_ownership=False,
                resource_uuid_param="podcast_uuid",
            )

        with patch("src.security.rbac.dependencies.require_resource_access", return_value="sentinel") as mock_rr:
            assert require_dashboard_access("community_uuid", AccessAction.DELETE) == "sentinel"
            mock_rr.assert_called_once_with(
                action=AccessAction.DELETE,
                context=AccessContext.DASHBOARD,
                resource_uuid_param="community_uuid",
            )

    @pytest.mark.parametrize(
        "resource_type, expected_uuid",
        [
            ("courses", "course_x"),
            ("podcasts", "podcast_x"),
            ("communities", "communitie_x"),
        ],
    )
    @pytest.mark.asyncio
    async def test_require_create_access_allows_supported_resource_types(
        self,
        resource_type,
        expected_uuid,
    ):
        request = _request({"resource_uuid": "ignored"})
        db_session = Mock()
        current_user = _user()
        decision = AccessDecision(
            allowed=True,
            reason="allowed",
            resource_uuid=expected_uuid,
        )

        with patch("src.security.rbac.dependencies.ResourceAccessChecker") as mock_checker_cls:
            checker = mock_checker_cls.return_value
            checker.check_access = AsyncMock(return_value=decision)

            dependency = require_create_access(resource_type)
            result = await dependency(
                request=request,
                db_session=db_session,
                current_user=current_user,
            )

        assert result is decision
        mock_checker_cls.assert_called_once_with(request, db_session, current_user)
        checker.check_access.assert_awaited_once_with(
            expected_uuid,
            AccessAction.CREATE,
            AccessContext.DASHBOARD,
        )

    @pytest.mark.asyncio
    async def test_require_create_access_rejects_denied_access(self):
        request = _request()
        db_session = Mock()
        decision = AccessDecision(
            allowed=False,
            reason="create denied",
        )

        with patch("src.security.rbac.dependencies.ResourceAccessChecker") as mock_checker_cls:
            checker = mock_checker_cls.return_value
            checker.check_access = AsyncMock(return_value=decision)

            dependency = require_create_access("courses")

            with pytest.raises(HTTPException) as exc_info:
                await dependency(
                    request=request,
                    db_session=db_session,
                    current_user=_user(),
                )

        assert exc_info.value.status_code == 403
        assert exc_info.value.detail == "create denied"
        checker.check_access.assert_awaited_once_with(
            "course_x",
            AccessAction.CREATE,
            AccessContext.DASHBOARD,
        )

    @pytest.mark.parametrize(
        "access_class, method_name, invoke_args, expected_call",
        [
            (CourseAccess, "read", (AccessContext.DASHBOARD,), ("require_read_access", ("course_uuid", AccessContext.DASHBOARD), {})),
            (CourseAccess, "create", (), ("require_create_access", ("courses",), {})),
            (CourseAccess, "update", (), ("require_write_access", (AccessAction.UPDATE, "course_uuid"), {})),
            (CourseAccess, "delete", (), ("require_write_access", (AccessAction.DELETE, "course_uuid"), {})),
            (CourseAccess, "dashboard", (), ("require_dashboard_access", ("course_uuid",), {})),
            (PodcastAccess, "read", (AccessContext.DASHBOARD,), ("require_read_access", ("podcast_uuid", AccessContext.DASHBOARD), {})),
            (PodcastAccess, "create", (), ("require_create_access", ("podcasts",), {})),
            (PodcastAccess, "update", (), ("require_write_access", (AccessAction.UPDATE, "podcast_uuid"), {})),
            (PodcastAccess, "delete", (), ("require_write_access", (AccessAction.DELETE, "podcast_uuid"), {})),
            (PodcastAccess, "dashboard", (), ("require_dashboard_access", ("podcast_uuid",), {})),
            (CommunityAccess, "read", (AccessContext.DASHBOARD,), ("require_read_access", ("community_uuid", AccessContext.DASHBOARD), {})),
            (CommunityAccess, "create", (), ("require_create_access", ("communities",), {})),
            (CommunityAccess, "update", (), ("require_write_access", (AccessAction.UPDATE, "community_uuid"), {})),
            (CommunityAccess, "delete", (), ("require_write_access", (AccessAction.DELETE, "community_uuid"), {})),
            (CommunityAccess, "dashboard", (), ("require_dashboard_access", ("community_uuid",), {})),
        ],
    )
    def test_access_classes_delegate_to_factory_functions(
        self,
        access_class,
        method_name,
        invoke_args,
        expected_call,
    ):
        patch_target, args, kwargs = expected_call
        with patch(f"src.security.rbac.dependencies.{patch_target}", return_value="sentinel") as mock_factory:
            result = getattr(access_class, method_name)(*invoke_args)

        assert result == "sentinel"
        mock_factory.assert_called_once_with(*args, **kwargs)
