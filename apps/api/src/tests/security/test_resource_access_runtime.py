from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest
from fastapi import HTTPException, Request
from sqlmodel import Session

from src.db.resource_authors import (
    ResourceAuthorshipEnum,
    ResourceAuthorshipStatusEnum,
)
from src.db.users import APITokenUser, AnonymousUser, PublicUser
from src.security.rbac.resource_access import (
    ResourceAccessChecker,
    _get_request_checker,
    check_resource_access,
)
from src.security.rbac.types import AccessAction, AccessContext, AccessDecision, ResourceConfig


class _FrozenState:
    __slots__ = ()


class TestResourceAccessRuntime:
    @pytest.fixture
    def mock_request(self):
        req = Mock(spec=Request)
        req.state = type("State", (), {})()
        return req

    @pytest.fixture
    def frozen_mock_request(self):
        req = Mock(spec=Request)
        req.state = _FrozenState()
        return req

    @pytest.fixture
    def session(self):
        sess = Mock(spec=Session)
        sess.exec = Mock()
        return sess

    @pytest.fixture
    def public_user(self):
        user = Mock(spec=PublicUser)
        user.id = 7
        user.user_uuid = "user_7"
        return user

    @pytest.fixture
    def anonymous_user(self):
        return AnonymousUser()

    @pytest.fixture
    def api_token_user(self):
        return APITokenUser(org_id=11, rights={"courses": {"action_read": True}})

    def _checker(self, request, session, user):
        return ResourceAccessChecker(request, session, user)

    @pytest.mark.asyncio
    async def test_check_access_routes_api_tokens_to_token_branch(self, mock_request, session):
        token_user = APITokenUser(org_id=11, rights={"courses": {"action_read": True}})
        checker = self._checker(mock_request, session, token_user)
        decision = AccessDecision(allowed=True, reason="ok")
        checker._check_api_token_access = AsyncMock(return_value=decision)

        result = await checker.check_access("course_1", AccessAction.READ)

        assert result is decision
        checker._check_api_token_access.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_check_access_child_resource_delegates_to_parent(self, mock_request, session, anonymous_user):
        checker = self._checker(mock_request, session, anonymous_user)
        chapter = SimpleNamespace(chapter_uuid="chapter_1", course_id=101)
        course = SimpleNamespace(course_uuid="course_101", public=True, published=True, org_id=1)
        chapter_exec = Mock()
        chapter_exec.first.return_value = chapter
        parent_exec = Mock()
        parent_exec.first.return_value = course
        course_exec = Mock()
        course_exec.first.return_value = course
        session.exec.side_effect = [chapter_exec, parent_exec, course_exec]

        decision = await checker.check_access("chapter_1", AccessAction.READ)

        assert decision.allowed is True
        assert decision.resource_uuid == "chapter_1"

    @pytest.mark.asyncio
    async def test_check_access_child_resource_missing_parent_denied(self, mock_request, session, anonymous_user):
        checker = self._checker(mock_request, session, anonymous_user)
        chapter = SimpleNamespace(chapter_uuid="chapter_2", course_id=None)
        chapter_exec = Mock()
        chapter_exec.first.return_value = chapter
        session.exec.return_value = chapter_exec

        decision = await checker.check_access("chapter_2", AccessAction.READ)

        assert decision.allowed is False
        assert "parent resource" in decision.reason.lower()

    @pytest.mark.asyncio
    async def test_check_access_public_view_on_authenticated_user(self, mock_request, session, public_user):
        checker = self._checker(mock_request, session, public_user)
        course = SimpleNamespace(course_uuid="course_1", public=True, published=True, org_id=1)
        exec_result = Mock()
        exec_result.first.return_value = course
        session.exec.return_value = exec_result

        decision = await checker.check_access("course_1", AccessAction.READ, AccessContext.PUBLIC_VIEW)

        assert decision.allowed is True
        assert decision.via_public is True

    @pytest.mark.asyncio
    async def test_check_access_community_public_read_for_anonymous_user(self, mock_request, session, anonymous_user):
        checker = self._checker(mock_request, session, anonymous_user)
        community = SimpleNamespace(community_uuid="community_1", public=True, org_id=1)
        exec_result = Mock()
        exec_result.first.return_value = community
        session.exec.return_value = exec_result

        decision = await checker.check_access("community_1", AccessAction.READ)

        assert decision.allowed is True
        assert decision.via_public is True

    @pytest.mark.asyncio
    async def test_check_access_authenticated_user_community_public_view(self, mock_request, session, public_user):
        checker = self._checker(mock_request, session, public_user)
        community = SimpleNamespace(community_uuid="community_3", public=True, org_id=1)
        exec_result = Mock()
        exec_result.first.return_value = community
        session.exec.return_value = exec_result

        decision = await checker.check_access(
            "community_3", AccessAction.READ, AccessContext.PUBLIC_VIEW
        )

        assert decision.allowed is True
        assert decision.via_public is True

    @pytest.mark.asyncio
    async def test_check_access_anonymous_community_private_denied(self, mock_request, session, anonymous_user):
        checker = self._checker(mock_request, session, anonymous_user)
        community = SimpleNamespace(community_uuid="community_4", public=False, org_id=1)
        exec_result = Mock()
        exec_result.first.return_value = community
        session.exec.return_value = exec_result

        decision = await checker.check_access("community_4", AccessAction.READ)

        assert decision.allowed is False
        assert "not public" in decision.reason.lower()

    @pytest.mark.asyncio
    async def test_check_access_community_private_read_for_anonymous_user(self, mock_request, session, anonymous_user):
        checker = self._checker(mock_request, session, anonymous_user)
        community = SimpleNamespace(community_uuid="community_2", public=False, org_id=1)
        exec_result = Mock()
        exec_result.first.return_value = community
        session.exec.return_value = exec_result

        decision = await checker.check_access("community_2", AccessAction.READ)

        assert decision.allowed is False
        assert "not public" in decision.reason.lower()

    @pytest.mark.asyncio
    async def test_public_view_authorship_admin_role_and_usergroup_paths(self, mock_request, session, public_user):
        checker = self._checker(mock_request, session, public_user)
        course_cfg = ResourceConfig(
            resource_type="courses",
            uuid_prefix="course_",
            has_published_field=True,
            supports_usergroups=True,
            supports_authorship=True,
        )

        checker._is_public_and_published = AsyncMock(return_value=(True, False))
        checker._is_resource_author = AsyncMock(return_value=False)
        checker._is_admin_or_maintainer = AsyncMock(return_value=False)
        checker._check_usergroup_membership = AsyncMock(return_value=False)
        with patch(
            "src.security.rbac.resource_access.authorization_verify_based_on_roles",
            new_callable=AsyncMock,
            return_value=True,
        ):
            role_decision = await checker._check_public_view_read_access("course_3", course_cfg)
        assert role_decision.allowed is True
        assert role_decision.via_role is True

        checker._is_public_and_published = AsyncMock(return_value=(False, False))
        checker._is_resource_author = AsyncMock(return_value=True)
        checker._is_admin_or_maintainer = AsyncMock(return_value=False)
        checker._check_usergroup_membership = AsyncMock(return_value=False)
        with patch(
            "src.security.rbac.resource_access.authorization_verify_based_on_roles",
            new_callable=AsyncMock,
            return_value=False,
        ):
            author_decision = await checker._check_public_view_read_access("course_4", course_cfg)
        assert author_decision.allowed is True
        assert author_decision.via_authorship is True

        checker._is_public_and_published = AsyncMock(return_value=(False, False))
        checker._is_resource_author = AsyncMock(return_value=False)
        checker._is_admin_or_maintainer = AsyncMock(return_value=True)
        checker._check_usergroup_membership = AsyncMock(return_value=False)
        with patch(
            "src.security.rbac.resource_access.authorization_verify_based_on_roles",
            new_callable=AsyncMock,
            return_value=False,
        ):
            admin_decision = await checker._check_public_view_read_access("course_5", course_cfg)
        assert admin_decision.allowed is True
        assert admin_decision.via_admin is True

        checker._is_public_and_published = AsyncMock(return_value=(False, False))
        checker._is_resource_author = AsyncMock(return_value=False)
        checker._is_admin_or_maintainer = AsyncMock(return_value=False)
        checker._check_usergroup_membership = AsyncMock(return_value=True)
        with patch(
            "src.security.rbac.resource_access.authorization_verify_based_on_roles",
            new_callable=AsyncMock,
            return_value=False,
        ):
            usergroup_decision = await checker._check_public_view_read_access(
                "community_6",
                ResourceConfig(
                    resource_type="communities",
                    uuid_prefix="community_",
                    has_published_field=False,
                    supports_usergroups=True,
                    supports_authorship=False,
                ),
            )
        assert usergroup_decision.allowed is True
        assert usergroup_decision.via_usergroup is True

    @pytest.mark.asyncio
    async def test_write_access_create_update_and_deny_paths(self, mock_request, session, public_user):
        checker = self._checker(mock_request, session, public_user)
        course_cfg = ResourceConfig(
            resource_type="courses",
            uuid_prefix="course_",
            has_published_field=True,
            supports_usergroups=True,
            supports_authorship=True,
        )

        checker._get_user_id = lambda: 0
        denied = await checker._check_write_access("course_1", AccessAction.UPDATE, course_cfg, False)
        assert denied.allowed is False

        checker._get_user_id = lambda: 7
        with patch(
            "src.security.rbac.resource_access.authorization_verify_based_on_roles",
            new_callable=AsyncMock,
            return_value=True,
        ), patch(
            "src.security.rbac.resource_access.authorization_verify_based_on_org_admin_status",
            new_callable=AsyncMock,
            return_value=False,
        ):
            create_allowed = await checker._check_write_access("course_x", AccessAction.CREATE, course_cfg, False)
            assert create_allowed.allowed is True and create_allowed.via_role is True

        with patch(
            "src.security.rbac.resource_access.authorization_verify_based_on_roles",
            new_callable=AsyncMock,
            return_value=False,
        ), patch(
            "src.security.rbac.resource_access.authorization_verify_based_on_org_admin_status",
            new_callable=AsyncMock,
            return_value=True,
        ):
            create_admin = await checker._check_write_access("course_x", AccessAction.CREATE, course_cfg, False)
            assert create_admin.allowed is True and create_admin.via_admin is True

        with patch(
            "src.security.rbac.resource_access.authorization_verify_based_on_roles",
            new_callable=AsyncMock,
            return_value=False,
        ), patch(
            "src.security.rbac.resource_access.authorization_verify_based_on_org_admin_status",
            new_callable=AsyncMock,
            return_value=False,
        ):
            create_denied = await checker._check_write_access("course_x", AccessAction.CREATE, course_cfg, False)
            assert create_denied.allowed is False

        checker._is_resource_author = AsyncMock(return_value=True)
        checker._is_admin_or_maintainer = AsyncMock(return_value=False)
        with patch(
            "src.security.rbac.resource_access.authorization_verify_based_on_roles",
            new_callable=AsyncMock,
            return_value=False,
        ):
            owned_update = await checker._check_write_access("course_2", AccessAction.UPDATE, course_cfg, True)
        assert owned_update.allowed is True
        assert owned_update.via_authorship is True

    @pytest.mark.asyncio
    async def test_write_access_default_role_branch(self, mock_request, session, public_user):
        checker = self._checker(mock_request, session, public_user)
        course_cfg = ResourceConfig(
            resource_type="courses",
            uuid_prefix="course_",
            has_published_field=True,
            supports_usergroups=True,
            supports_authorship=True,
        )

        with patch(
            "src.security.rbac.resource_access.authorization_verify_based_on_roles",
            new_callable=AsyncMock,
            return_value=True,
        ):
            allowed = await checker._check_write_access("course_9", AccessAction.READ, course_cfg, False)
        assert allowed.allowed is True

        with patch(
            "src.security.rbac.resource_access.authorization_verify_based_on_roles",
            new_callable=AsyncMock,
            return_value=False,
        ):
            denied = await checker._check_write_access("course_10", AccessAction.READ, course_cfg, False)
        assert denied.allowed is False

    @pytest.mark.asyncio
    async def test_check_create_permission_role_admin_and_deny(self, mock_request, session, public_user):
        checker = self._checker(mock_request, session, public_user)
        course_cfg = ResourceConfig(
            resource_type="courses",
            uuid_prefix="course_",
            has_published_field=True,
            supports_usergroups=True,
            supports_authorship=True,
        )

        with patch(
            "src.security.rbac.resource_access.authorization_verify_based_on_roles",
            new_callable=AsyncMock,
            return_value=True,
        ), patch(
            "src.security.rbac.resource_access.authorization_verify_based_on_org_admin_status",
            new_callable=AsyncMock,
            return_value=False,
        ):
            allowed = await checker._check_create_permission("course_x", course_cfg)

        with patch(
            "src.security.rbac.resource_access.authorization_verify_based_on_roles",
            new_callable=AsyncMock,
            return_value=False,
        ), patch(
            "src.security.rbac.resource_access.authorization_verify_based_on_org_admin_status",
            new_callable=AsyncMock,
            return_value=True,
        ):
            admin_allowed = await checker._check_create_permission("course_x", course_cfg)

        with patch(
            "src.security.rbac.resource_access.authorization_verify_based_on_roles",
            new_callable=AsyncMock,
            return_value=False,
        ), patch(
            "src.security.rbac.resource_access.authorization_verify_based_on_org_admin_status",
            new_callable=AsyncMock,
            return_value=False,
        ):
            denied = await checker._check_create_permission("course_x", course_cfg)

        assert allowed.allowed is True and allowed.via_role is True
        assert admin_allowed.allowed is True and admin_allowed.via_admin is True
        assert denied.allowed is False

    @pytest.mark.asyncio
    async def test_ownership_access_author_admin_role_and_deny(self, mock_request, session, public_user):
        checker = self._checker(mock_request, session, public_user)
        course_cfg = ResourceConfig(
            resource_type="courses",
            uuid_prefix="course_",
            has_published_field=True,
            supports_usergroups=True,
            supports_authorship=True,
        )
        checker._is_resource_author = AsyncMock(return_value=True)
        checker._is_admin_or_maintainer = AsyncMock(return_value=False)
        with patch(
            "src.security.rbac.resource_access.authorization_verify_based_on_roles",
            new_callable=AsyncMock,
            return_value=False,
        ):
            author = await checker._check_ownership_access("course_1", AccessAction.UPDATE, course_cfg)

        checker._is_resource_author = AsyncMock(return_value=False)
        checker._is_admin_or_maintainer = AsyncMock(return_value=True)
        with patch(
            "src.security.rbac.resource_access.authorization_verify_based_on_roles",
            new_callable=AsyncMock,
            return_value=False,
        ):
            admin = await checker._check_ownership_access("course_2", AccessAction.DELETE, course_cfg)

        checker._is_resource_author = AsyncMock(return_value=False)
        checker._is_admin_or_maintainer = AsyncMock(return_value=False)
        with patch(
            "src.security.rbac.resource_access.authorization_verify_based_on_roles",
            new_callable=AsyncMock,
            return_value=True,
        ):
            role = await checker._check_ownership_access("course_3", AccessAction.DELETE, course_cfg)

        checker._is_resource_author = AsyncMock(return_value=False)
        checker._is_admin_or_maintainer = AsyncMock(return_value=False)
        with patch(
            "src.security.rbac.resource_access.authorization_verify_based_on_roles",
            new_callable=AsyncMock,
            return_value=False,
        ):
            denied = await checker._check_ownership_access("course_4", AccessAction.DELETE, course_cfg)

        assert author.allowed is True and author.via_authorship is True
        assert admin.allowed is True and admin.via_admin is True
        assert role.allowed is True and role.via_role is True
        assert denied.allowed is False

    @pytest.mark.asyncio
    async def test_api_token_create_existing_org_rights_and_denials(self, mock_request, session):
        course_cfg = ResourceConfig(
            resource_type="courses",
            uuid_prefix="course_",
            has_published_field=True,
            supports_usergroups=True,
            supports_authorship=True,
        )
        resource = SimpleNamespace(org_id=11)
        checker = self._checker(mock_request, session, APITokenUser(org_id=11, rights=None))
        checker._get_resource = AsyncMock(return_value=resource)

        no_rights = await checker._check_api_token_access("course_1", AccessAction.READ, course_cfg)
        assert no_rights.allowed is False

        checker.current_user = APITokenUser(org_id=11, rights={"courses": {"action_read": True}})
        allowed = await checker._check_api_token_access("course_1", AccessAction.READ, course_cfg)
        assert allowed.allowed is True

        checker.current_user = APITokenUser(org_id=11, rights={"courses": {"action_read": False}})
        denied = await checker._check_api_token_access("course_1", AccessAction.READ, course_cfg)
        assert denied.allowed is False

        checker.current_user = APITokenUser(org_id=99, rights={"courses": {"action_read": True}})
        org_denied = await checker._check_api_token_access("course_1", AccessAction.READ, course_cfg)
        assert org_denied.allowed is False

    @pytest.mark.asyncio
    async def test_api_token_create_new_resource_dict_and_object_rights(self, mock_request, session):
        course_cfg = ResourceConfig(
            resource_type="courses",
            uuid_prefix="course_",
            has_published_field=True,
            supports_usergroups=True,
            supports_authorship=True,
        )
        checker = self._checker(mock_request, session, APITokenUser(org_id=11, rights={"courses": {"action_create": True}}))
        checker.current_user.rights = None
        no_rights = await checker._check_api_token_access("course_x", AccessAction.CREATE, course_cfg)
        assert no_rights.allowed is False

        checker.current_user.rights = {"courses": {"action_create": True}}
        allowed = await checker._check_api_token_access("course_x", AccessAction.CREATE, course_cfg)
        assert allowed.allowed is True

        checker.current_user = APITokenUser(org_id=11, rights={"courses": {"action_create": False}})
        denied = await checker._check_api_token_access("course_x", AccessAction.CREATE, course_cfg)
        assert denied.allowed is False

        class RightsObject:
            def __init__(self, create: bool, read: bool):
                self.courses = SimpleNamespace(action_create=create, action_read=read)

        checker.current_user.rights = RightsObject(True, True)
        allowed_obj = await checker._check_api_token_access("course_x", AccessAction.CREATE, course_cfg)
        assert allowed_obj.allowed is True

        checker.current_user.rights = RightsObject(False, False)
        denied_obj = await checker._check_api_token_access("course_x", AccessAction.CREATE, course_cfg)
        assert denied_obj.allowed is False

    @pytest.mark.asyncio
    async def test_api_token_existing_resource_object_rights_and_not_found(self, mock_request, session):
        course_cfg = ResourceConfig(
            resource_type="courses",
            uuid_prefix="course_",
            has_published_field=True,
            supports_usergroups=True,
            supports_authorship=True,
        )
        checker = self._checker(mock_request, session, APITokenUser(org_id=11, rights={"courses": {"action_read": True}}))

        checker._get_resource = AsyncMock(return_value=None)
        not_found = await checker._check_api_token_access("course_1", AccessAction.READ, course_cfg)
        assert not_found.allowed is False

        checker._get_resource = AsyncMock(return_value=SimpleNamespace(org_id=11))
        checker.current_user = APITokenUser(org_id=11, rights={"courses": {"action_read": True}})
        allowed = await checker._check_api_token_access("course_1", AccessAction.READ, course_cfg)
        assert allowed.allowed is True

        checker.current_user = APITokenUser(org_id=11, rights={"courses": {"action_read": False}})
        denied = await checker._check_api_token_access("course_1", AccessAction.READ, course_cfg)
        assert denied.allowed is False

        class RightsObject:
            def __init__(self, read: bool):
                self.courses = SimpleNamespace(action_read=read)

        checker.current_user.rights = RightsObject(True)
        allowed_obj = await checker._check_api_token_access("course_1", AccessAction.READ, course_cfg)
        assert allowed_obj.allowed is True

        checker.current_user.rights = RightsObject(False)
        denied_obj = await checker._check_api_token_access("course_1", AccessAction.READ, course_cfg)
        assert denied_obj.allowed is False

    @pytest.mark.asyncio
    async def test_helper_branches_for_user_id_authorship_admin_usergroups_and_public_cache(
        self, mock_request, session, public_user
    ):
        checker = self._checker(mock_request, session, public_user)
        assert checker._get_user_id() == 7
        assert ResourceAccessChecker(mock_request, session, APITokenUser(org_id=1, rights={}))._get_user_id() == 0

        anonymous_checker = self._checker(mock_request, session, AnonymousUser())
        assert await anonymous_checker._is_resource_author("course_1") is False
        assert await anonymous_checker._is_admin_or_maintainer("course_1") is False
        assert await anonymous_checker._check_usergroup_membership("course_1") is False

        with patch(
            "src.security.rbac.resource_access.authorization_verify_based_on_org_admin_status",
            new_callable=AsyncMock,
            return_value=True,
        ):
            assert await checker._is_admin_or_maintainer("course_1") is True
            assert await checker._is_admin_or_maintainer("course_1") is True

        checker._get_resource = AsyncMock(return_value=None)
        config = ResourceConfig(
            resource_type="courses",
            uuid_prefix="course_",
            has_published_field=True,
            supports_usergroups=True,
            supports_authorship=True,
        )
        assert await checker._is_public_and_published("course_1", config) == (False, False)

    @pytest.mark.asyncio
    async def test_usergroup_membership_helper_branches(self, mock_request, session, public_user):
        checker = self._checker(mock_request, session, public_user)
        checker._get_user_id = lambda: 0
        assert await checker._check_usergroup_membership("course_1") is False

        checker = self._checker(mock_request, session, public_user)
        session.exec.return_value.all.return_value = []
        assert await checker._check_usergroup_membership("course_2", True) is True
        assert await checker._check_usergroup_membership("course_3", False) is False

        checker = self._checker(mock_request, session, public_user)
        session.exec.return_value.all.return_value = [SimpleNamespace(usergroup_id=1)]
        session.exec.return_value.first.return_value = SimpleNamespace(usergroup_id=1)
        assert await checker._check_usergroup_membership("course_4") is True

        checker = self._checker(mock_request, session, public_user)
        session.exec.return_value.all.return_value = [SimpleNamespace(usergroup_id=1)]
        session.exec.return_value.first.return_value = None
        assert await checker._check_usergroup_membership("course_5") is False

    @pytest.mark.asyncio
    async def test_authorship_status_cache_and_variants(self, mock_request, session, public_user):
        checker = self._checker(mock_request, session, public_user)
        session.exec.return_value.first.return_value = None
        assert await checker._is_resource_author("course_1") is False

        checker._author_cache.clear()
        resource_author = SimpleNamespace(
            authorship=ResourceAuthorshipEnum.CREATOR,
            authorship_status=ResourceAuthorshipStatusEnum.ACTIVE,
        )
        exec_result = Mock()
        exec_result.first.return_value = resource_author
        session.exec.return_value = exec_result
        assert await checker._is_resource_author("course_2") is True

        checker._author_cache.clear()
        resource_author.authorship_status = ResourceAuthorshipStatusEnum.INACTIVE
        assert await checker._is_resource_author("course_2") is False

        checker._author_cache.clear()
        resource_author.authorship = ResourceAuthorshipEnum.REPORTER
        resource_author.authorship_status = ResourceAuthorshipStatusEnum.ACTIVE
        assert await checker._is_resource_author("course_2") is False

    @pytest.mark.asyncio
    async def test_parent_uuid_lookup_and_resolution_variants(self, mock_request, session, public_user):
        checker = self._checker(mock_request, session, public_user)

        course_cfg = ResourceConfig(
            resource_type="coursechapters",
            uuid_prefix="chapter_",
            has_published_field=False,
            supports_usergroups=False,
            supports_authorship=False,
            parent_resource_type="courses",
            parent_id_field="course_id",
        )
        checker._get_resource = AsyncMock(return_value=SimpleNamespace(course_id=1))
        course_exec = Mock()
        course_exec.first.return_value = SimpleNamespace(course_uuid="course_1")
        session.exec.return_value = course_exec
        assert await checker._resolve_parent_resource_uuid("chapter_1", course_cfg) == "course_1"

        checker._get_resource = AsyncMock(return_value=None)
        assert await checker._resolve_parent_resource_uuid("chapter_missing", course_cfg) is None

        checker._parent_uuid_cache["chapter_1"] = "course_1"
        assert await checker._resolve_parent_resource_uuid("chapter_1", course_cfg) == "course_1"

        no_parent_cfg = ResourceConfig(
            resource_type="custom",
            uuid_prefix="custom_",
            has_published_field=False,
            supports_usergroups=False,
            supports_authorship=False,
        )
        assert await checker._resolve_parent_resource_uuid("custom_1", no_parent_cfg) is None

        missing_parent_cfg = ResourceConfig(
            resource_type="custom_child",
            uuid_prefix="customchild_",
            has_published_field=False,
            supports_usergroups=False,
            supports_authorship=False,
            parent_resource_type="missing",
            parent_id_field="parent_id",
        )
        checker._get_resource = AsyncMock(return_value=SimpleNamespace(parent_id=1))
        assert await checker._resolve_parent_resource_uuid("customchild_1", missing_parent_cfg) is None

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("resource_type", "uuid_field", "uuid_value"),
        [
            ("courses", "course_uuid", "course_1"),
            ("podcasts", "podcast_uuid", "podcast_1"),
            ("communities", "community_uuid", "community_1"),
            ("collections", "collection_uuid", "collection_1"),
            ("coursechapters", "chapter_uuid", "chapter_1"),
            ("activities", "activity_uuid", "activity_1"),
            ("episodes", "episode_uuid", "episode_1"),
            ("discussions", "discussion_uuid", "discussion_1"),
        ],
    )
    async def test_get_resource_branches(self, mock_request, session, public_user, resource_type, uuid_field, uuid_value):
        checker = self._checker(mock_request, session, public_user)
        resource = SimpleNamespace(**{uuid_field: uuid_value})
        exec_result = Mock()
        exec_result.first.return_value = resource
        session.exec.return_value = exec_result

        cfg = ResourceConfig(
            resource_type=resource_type,
            uuid_prefix="prefix_",
            has_published_field=False,
            supports_usergroups=False,
            supports_authorship=False,
            uuid_field=uuid_field,
        )
        assert await checker._get_resource(uuid_value, cfg) is resource
        assert await checker._get_resource(uuid_value, cfg) is resource

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("resource_type", "expected_attr"),
        [
            ("courses", "course_uuid"),
            ("podcasts", "podcast_uuid"),
            ("communities", "community_uuid"),
            ("coursechapters", "chapter_uuid"),
            ("collections", "collection_uuid"),
        ],
    )
    async def test_get_parent_uuid_by_id_branches(self, mock_request, session, public_user, resource_type, expected_attr):
        checker = self._checker(mock_request, session, public_user)
        parent = SimpleNamespace(**{expected_attr: f"{resource_type}_1"})
        exec_result = Mock()
        exec_result.first.return_value = parent
        session.exec.return_value = exec_result

        parent_cfg = ResourceConfig(
            resource_type=resource_type,
            uuid_prefix="prefix_",
            has_published_field=False,
            supports_usergroups=False,
            supports_authorship=False,
        )

        assert await checker._get_parent_uuid_by_id(1, parent_cfg) == f"{resource_type}_1"
        assert await checker._get_parent_uuid_by_id(1, ResourceConfig(
            resource_type="unknown",
            uuid_prefix="unknown_",
            has_published_field=False,
            supports_usergroups=False,
            supports_authorship=False,
        )) is None

    @pytest.mark.asyncio
    async def test_request_checker_reuses_and_handles_state_assignment_error(self, mock_request, frozen_mock_request, session, public_user):
        first = _get_request_checker(mock_request, session, public_user)
        second = _get_request_checker(mock_request, session, public_user)
        assert first is second

        checker = _get_request_checker(frozen_mock_request, session, public_user)
        assert isinstance(checker, ResourceAccessChecker)

    @pytest.mark.asyncio
    async def test_check_resource_access_raises_and_returns(self, mock_request, session, public_user):
        denied = AccessDecision(allowed=False, reason="nope")
        with patch("src.security.rbac.resource_access._get_request_checker", return_value=Mock(check_access=AsyncMock(return_value=denied))):
            with pytest.raises(HTTPException) as exc_info:
                await check_resource_access(mock_request, session, public_user, "course_1", AccessAction.READ)
            assert exc_info.value.status_code == 403

        with patch("src.security.rbac.resource_access._get_request_checker", return_value=Mock(check_access=AsyncMock(return_value=denied))):
            result = await check_resource_access(
                mock_request,
                session,
                public_user,
                "course_1",
                AccessAction.READ,
                raise_on_deny=False,
            )
            assert result is denied
