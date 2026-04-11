"""
Tests for the Unified Resource Access Checker

This module tests the ResourceAccessChecker class and related functionality
for the unified RBAC system.
"""

import pytest
from unittest.mock import Mock, AsyncMock, patch
from fastapi import HTTPException, Request
from sqlmodel import Session

from src.security.rbac.types import AccessAction, AccessContext, AccessDecision
from src.security.rbac.config import (
    RESOURCE_CONFIGS,
    get_resource_config,
    get_resource_type,
)
from src.security.rbac.resource_access import (
    ResourceAccessChecker,
    check_resource_access,
    _get_request_checker,
)
from src.db.users import AnonymousUser, PublicUser, APITokenUser


class TestResourceConfig:
    """Test cases for resource configuration."""

    def test_get_resource_config_for_course(self):
        """Test getting config for course UUID."""
        config = get_resource_config("course_abc123")
        assert config is not None
        assert config.resource_type == "courses"
        assert config.has_published_field is True
        assert config.supports_usergroups is True
        assert config.supports_authorship is True

    def test_get_resource_config_for_podcast(self):
        """Test getting config for podcast UUID."""
        config = get_resource_config("podcast_abc123")
        assert config is not None
        assert config.resource_type == "podcasts"
        assert config.has_published_field is True

    def test_get_resource_config_for_community(self):
        """Test getting config for community UUID."""
        config = get_resource_config("community_abc123")
        assert config is not None
        assert config.resource_type == "communities"
        assert config.has_published_field is False  # Communities don't have published field
        assert config.supports_authorship is False  # Communities don't have authors

    def test_get_resource_config_for_chapter(self):
        """Test getting config for chapter UUID (child resource)."""
        config = get_resource_config("chapter_abc123")
        assert config is not None
        assert config.resource_type == "coursechapters"
        assert config.parent_resource_type == "courses"
        assert config.parent_id_field == "course_id"

    def test_get_resource_config_for_activity(self):
        """Test getting config for activity UUID (child of chapter)."""
        config = get_resource_config("activity_abc123")
        assert config is not None
        assert config.resource_type == "activities"
        assert config.parent_resource_type == "coursechapters"
        assert config.parent_id_field == "chapter_id"

    def test_get_resource_config_for_episode(self):
        """Test getting config for episode UUID."""
        config = get_resource_config("episode_abc123")
        assert config is not None
        assert config.resource_type == "episodes"
        assert config.parent_resource_type == "podcasts"

    def test_get_resource_config_for_discussion(self):
        """Test getting config for discussion UUID."""
        config = get_resource_config("discussion_abc123")
        assert config is not None
        assert config.resource_type == "discussions"
        assert config.parent_resource_type == "communities"

    def test_get_resource_config_for_unknown(self):
        """Test getting config for unknown UUID prefix."""
        config = get_resource_config("unknown_abc123")
        assert config is None

    def test_get_resource_config_for_empty(self):
        """Test getting config for empty/None UUID."""
        assert get_resource_config("") is None
        assert get_resource_config(None) is None

    def test_get_resource_type(self):
        """Test getting resource type from UUID."""
        assert get_resource_type("course_123") == "courses"
        assert get_resource_type("podcast_123") == "podcasts"
        assert get_resource_type("community_123") == "communities"
        assert get_resource_type("unknown_123") is None

    def test_all_resource_configs_have_required_fields(self):
        """Test that all resource configs have required fields."""
        for name, config in RESOURCE_CONFIGS.items():
            assert config.resource_type is not None
            assert config.uuid_prefix is not None
            assert isinstance(config.has_published_field, bool)
            assert isinstance(config.supports_usergroups, bool)
            assert isinstance(config.supports_authorship, bool)


class TestAccessDecision:
    """Test cases for AccessDecision model."""

    def test_access_decision_allowed(self):
        """Test creating an allowed access decision."""
        decision = AccessDecision(
            allowed=True,
            reason="User has permission",
            via_role=True,
            resource_uuid="course_123",
            user_id=1,
            action="read",
        )
        assert decision.allowed is True
        assert decision.via_role is True
        assert decision.reason == "User has permission"

    def test_access_decision_denied(self):
        """Test creating a denied access decision."""
        decision = AccessDecision(
            allowed=False,
            reason="Access denied",
            resource_uuid="course_123",
            user_id=1,
            action="read",
        )
        assert decision.allowed is False
        assert decision.via_role is False
        assert decision.via_admin is False

    def test_access_decision_audit_flags(self):
        """Test that all audit flags work correctly."""
        # Test each flag individually
        decision = AccessDecision(allowed=True, reason="test", via_usergroup=True)
        assert decision.via_usergroup is True

        decision = AccessDecision(allowed=True, reason="test", via_authorship=True)
        assert decision.via_authorship is True

        decision = AccessDecision(allowed=True, reason="test", via_admin=True)
        assert decision.via_admin is True

        decision = AccessDecision(allowed=True, reason="test", via_public=True)
        assert decision.via_public is True


class TestResourceAccessChecker:
    """Test cases for ResourceAccessChecker class."""

    @pytest.fixture
    def mock_request(self):
        """Create a mock request object."""
        request = Mock(spec=Request)
        request.state = Mock()
        return request

    @pytest.fixture
    def mock_db_session(self):
        """Create a mock database session."""
        session = Mock(spec=Session)
        session.exec = Mock()
        return session

    @pytest.fixture
    def mock_public_user(self):
        """Create a mock authenticated user."""
        user = Mock(spec=PublicUser)
        user.id = 1
        user.user_uuid = "user_123"
        user.username = "testuser"
        return user

    @pytest.fixture
    def mock_anonymous_user(self):
        """Create a mock anonymous user."""
        return AnonymousUser()

    @pytest.fixture
    def mock_api_token_user(self):
        """Create a mock API token user."""
        user = Mock(spec=APITokenUser)
        user.org_id = 1
        user.rights = {
            "courses": {"action_read": True, "action_create": True},
        }
        return user

    @pytest.mark.asyncio
    async def test_check_access_empty_uuid(self, mock_request, mock_db_session, mock_public_user):
        """Test that empty UUID returns denied decision."""
        checker = ResourceAccessChecker(mock_request, mock_db_session, mock_public_user)
        decision = await checker.check_access("", AccessAction.READ)

        assert decision.allowed is False
        assert "required" in decision.reason.lower()

    @pytest.mark.asyncio
    async def test_check_access_unknown_resource_type(self, mock_request, mock_db_session, mock_public_user):
        """Test that unknown resource type returns denied decision."""
        checker = ResourceAccessChecker(mock_request, mock_db_session, mock_public_user)
        decision = await checker.check_access("unknown_123", AccessAction.READ)

        assert decision.allowed is False
        assert "unknown resource type" in decision.reason.lower()

    @pytest.mark.asyncio
    async def test_check_access_anonymous_user_public_resource(
        self, mock_request, mock_db_session, mock_anonymous_user
    ):
        """Test anonymous user can read public+published resource."""
        checker = ResourceAccessChecker(mock_request, mock_db_session, mock_anonymous_user)

        # Mock the course lookup
        mock_course = Mock()
        mock_course.public = True
        mock_course.published = True
        mock_course.org_id = 1
        mock_db_session.exec.return_value.first.return_value = mock_course

        decision = await checker.check_access("course_123", AccessAction.READ)

        assert decision.allowed is True
        assert decision.via_public is True

    @pytest.mark.asyncio
    async def test_check_access_anonymous_user_private_resource(
        self, mock_request, mock_db_session, mock_anonymous_user
    ):
        """Test anonymous user cannot read private resource."""
        checker = ResourceAccessChecker(mock_request, mock_db_session, mock_anonymous_user)

        # Mock the course lookup - private course
        mock_course = Mock()
        mock_course.public = False
        mock_course.published = True
        mock_course.org_id = 1
        mock_db_session.exec.return_value.first.return_value = mock_course

        decision = await checker.check_access("course_123", AccessAction.READ)

        assert decision.allowed is False

    @pytest.mark.asyncio
    async def test_check_access_anonymous_user_write_denied(
        self, mock_request, mock_db_session, mock_anonymous_user
    ):
        """Test anonymous user cannot perform write operations."""
        checker = ResourceAccessChecker(mock_request, mock_db_session, mock_anonymous_user)

        decision = await checker.check_access("course_123", AccessAction.UPDATE)

        assert decision.allowed is False
        assert "logged in" in decision.reason.lower()

    @pytest.mark.asyncio
    async def test_check_access_community_no_published_field(
        self, mock_request, mock_db_session, mock_anonymous_user
    ):
        """Test community access without published field."""
        checker = ResourceAccessChecker(mock_request, mock_db_session, mock_anonymous_user)

        # Mock the community lookup - public community (no published field)
        mock_community = Mock()
        mock_community.public = True
        mock_community.org_id = 1
        # Community doesn't have published field
        del mock_community.published
        mock_db_session.exec.return_value.first.return_value = mock_community

        decision = await checker.check_access("community_123", AccessAction.READ)

        assert decision.allowed is True
        assert decision.via_public is True


class TestCheckResourceAccessFunction:
    """Test cases for the check_resource_access convenience function."""

    @pytest.fixture
    def mock_request(self):
        """Create a mock request object."""
        return Mock(spec=Request)

    @pytest.fixture
    def mock_db_session(self):
        """Create a mock database session."""
        return Mock(spec=Session)

    @pytest.fixture
    def mock_public_user(self):
        """Create a mock authenticated user."""
        user = Mock(spec=PublicUser)
        user.id = 1
        return user

    @pytest.mark.asyncio
    async def test_check_resource_access_raises_on_denial(
        self, mock_request, mock_db_session, mock_public_user
    ):
        """Test that check_resource_access raises HTTPException on denial."""
        with pytest.raises(HTTPException) as exc_info:
            await check_resource_access(
                mock_request,
                mock_db_session,
                mock_public_user,
                "unknown_123",  # Unknown resource type
                AccessAction.READ,
                raise_on_deny=True,
            )

        assert exc_info.value.status_code == 403

    @pytest.mark.asyncio
    async def test_check_resource_access_returns_decision_when_not_raising(
        self, mock_request, mock_db_session, mock_public_user
    ):
        """Test that check_resource_access returns decision without raising."""
        decision = await check_resource_access(
            mock_request,
            mock_db_session,
            mock_public_user,
            "unknown_123",  # Unknown resource type
            AccessAction.READ,
            raise_on_deny=False,
        )

        assert decision.allowed is False
        # Should not raise, just return the decision


class TestParentResourceResolution:
    """Test cases for parent resource resolution logic."""

    def test_chapter_has_course_parent(self):
        """Test that chapter config points to course as parent."""
        config = get_resource_config("chapter_123")
        assert config.parent_resource_type == "courses"
        assert config.parent_id_field == "course_id"

    def test_activity_has_chapter_parent(self):
        """Test that activity config points to chapter as parent."""
        config = get_resource_config("activity_123")
        assert config.parent_resource_type == "coursechapters"
        assert config.parent_id_field == "chapter_id"

    def test_episode_has_podcast_parent(self):
        """Test that episode config points to podcast as parent."""
        config = get_resource_config("episode_123")
        assert config.parent_resource_type == "podcasts"
        assert config.parent_id_field == "podcast_id"

    def test_discussion_has_community_parent(self):
        """Test that discussion config points to community as parent."""
        config = get_resource_config("discussion_123")
        assert config.parent_resource_type == "communities"
        assert config.parent_id_field == "community_id"

    def test_primary_resources_have_no_parent(self):
        """Test that primary resources don't have parent configuration."""
        primary_resources = ["course_123", "podcast_123", "community_123", "collection_123"]

        for resource_uuid in primary_resources:
            config = get_resource_config(resource_uuid)
            assert config.parent_resource_type is None
            assert config.parent_id_field is None


class TestAccessActionEnum:
    """Test cases for AccessAction enum."""

    def test_action_values(self):
        """Test that AccessAction enum has expected values."""
        assert AccessAction.CREATE.value == "create"
        assert AccessAction.READ.value == "read"
        assert AccessAction.UPDATE.value == "update"
        assert AccessAction.DELETE.value == "delete"

    def test_action_count(self):
        """Test that AccessAction enum has exactly 4 values."""
        assert len(AccessAction) == 4


class TestAccessContextEnum:
    """Test cases for AccessContext enum."""

    def test_context_values(self):
        """Test that AccessContext enum has expected values."""
        assert AccessContext.PUBLIC_VIEW.value == "public_view"
        assert AccessContext.DASHBOARD.value == "dashboard"

    def test_context_count(self):
        """Test that AccessContext enum has exactly 2 values."""
        assert len(AccessContext) == 2


# ──────────────────────────────────────────────────────────────────────────
# DASHBOARD-context semantics for courses.
#
# These tests lock in the intended behaviour of get_course / get_course_meta
# after the rewrite that removed the bespoke _user_can_view_unpublished_course
# helper in favour of a single check_resource_access(context=DASHBOARD) call.
#
# The critical invariant: usergroup members must NOT be able to read an
# unpublished course through the DASHBOARD context. Only admins/authors can.
# ──────────────────────────────────────────────────────────────────────────


class TestDashboardContext:
    """Lock in DASHBOARD-context read semantics for courses."""

    @pytest.fixture
    def mock_request(self):
        request = Mock(spec=Request)
        # Use a real object for state so attribute assignment works but starts empty
        request.state = type("S", (), {})()
        return request

    @pytest.fixture
    def mock_db_session(self):
        return Mock(spec=Session)

    @pytest.fixture
    def mock_public_user(self):
        user = Mock(spec=PublicUser)
        user.id = 42
        return user

    def _make_checker(self, request, session, user, **overrides):
        """Build a checker with the helper methods pre-mocked to the desired return values."""
        checker = ResourceAccessChecker(request, session, user)
        checker._is_admin_or_maintainer = AsyncMock(
            return_value=overrides.get("is_admin", False)
        )
        checker._is_resource_author = AsyncMock(
            return_value=overrides.get("is_author", False)
        )
        checker._is_public_and_published = AsyncMock(
            return_value=overrides.get("public_published", (False, False))
        )
        checker._check_usergroup_membership = AsyncMock(
            return_value=overrides.get("usergroup", False)
        )
        return checker

    @pytest.mark.asyncio
    async def test_admin_on_unpublished_course_is_allowed(
        self, mock_request, mock_db_session, mock_public_user
    ):
        checker = self._make_checker(
            mock_request, mock_db_session, mock_public_user,
            is_admin=True, public_published=(False, False),
        )
        decision = await checker.check_access(
            "course_unpub_1", AccessAction.READ, AccessContext.DASHBOARD
        )
        assert decision.allowed is True
        assert decision.via_admin is True

    @pytest.mark.asyncio
    async def test_author_on_unpublished_course_is_allowed(
        self, mock_request, mock_db_session, mock_public_user
    ):
        checker = self._make_checker(
            mock_request, mock_db_session, mock_public_user,
            is_author=True, public_published=(False, False),
        )
        decision = await checker.check_access(
            "course_unpub_2", AccessAction.READ, AccessContext.DASHBOARD
        )
        assert decision.allowed is True
        assert decision.via_authorship is True

    @pytest.mark.asyncio
    async def test_usergroup_member_on_unpublished_course_is_denied(
        self, mock_request, mock_db_session, mock_public_user
    ):
        """REGRESSION GUARD: a non-author/non-admin usergroup member must NOT
        be able to read an unpublished course via DASHBOARD context.

        Rule 5 of the public_view fallthrough only allows usergroup access
        when is_published=True, so the dashboard path correctly denies this
        combination."""
        checker = self._make_checker(
            mock_request, mock_db_session, mock_public_user,
            is_admin=False, is_author=False,
            public_published=(False, False),
            usergroup=True,
        )
        with patch(
            "src.security.rbac.resource_access.authorization_verify_based_on_roles",
            new_callable=AsyncMock, return_value=False,
        ):
            decision = await checker.check_access(
                "course_unpub_3", AccessAction.READ, AccessContext.DASHBOARD
            )
        assert decision.allowed is False

    @pytest.mark.asyncio
    async def test_anonymous_user_on_unpublished_course_is_denied(
        self, mock_request, mock_db_session,
    ):
        """Anonymous users never see unpublished courses even via dashboard."""
        checker = ResourceAccessChecker(mock_request, mock_db_session, AnonymousUser())
        # Anonymous path goes straight to _check_anonymous_read_access which
        # only inspects public/published flags.
        checker._is_public_and_published = AsyncMock(return_value=(False, False))

        decision = await checker.check_access(
            "course_unpub_4", AccessAction.READ, AccessContext.DASHBOARD
        )
        assert decision.allowed is False

    @pytest.mark.asyncio
    async def test_regular_user_on_public_published_course_is_allowed(
        self, mock_request, mock_db_session, mock_public_user
    ):
        """Dashboard falls through to public_view, so public+published stays allowed."""
        checker = self._make_checker(
            mock_request, mock_db_session, mock_public_user,
            public_published=(True, True),
        )
        decision = await checker.check_access(
            "course_pub_1", AccessAction.READ, AccessContext.DASHBOARD
        )
        assert decision.allowed is True
        assert decision.via_public is True

    @pytest.mark.asyncio
    async def test_usergroup_member_on_published_nonpublic_course_is_allowed(
        self, mock_request, mock_db_session, mock_public_user
    ):
        """Published + non-public + usergroup member: allowed via public_view rule 5."""
        checker = self._make_checker(
            mock_request, mock_db_session, mock_public_user,
            public_published=(False, True),
            usergroup=True,
        )
        with patch(
            "src.security.rbac.resource_access.authorization_verify_based_on_roles",
            new_callable=AsyncMock, return_value=False,
        ):
            decision = await checker.check_access(
                "course_priv_1", AccessAction.READ, AccessContext.DASHBOARD
            )
        assert decision.allowed is True
        assert decision.via_usergroup is True


# ──────────────────────────────────────────────────────────────────────────
# Request-scoped ResourceAccessChecker memoization.
#
# Course endpoints call check_resource_access() multiple times per request
# (once in get_course_meta, once inside get_course_chapters, once per child
# resource). The checker is now cached on request.state and its helper
# methods short-circuit via per-instance dicts so repeated lookups are free.
# ──────────────────────────────────────────────────────────────────────────


class TestRequestScopedChecker:
    """Lock in the single-checker-per-request contract and helper memoization."""

    @pytest.fixture
    def mock_db_session(self):
        return Mock(spec=Session)

    @pytest.fixture
    def mock_public_user(self):
        user = Mock(spec=PublicUser)
        user.id = 7
        return user

    def _make_request(self):
        request = Mock(spec=Request)
        request.state = type("S", (), {})()
        return request

    def test_same_request_reuses_checker(self, mock_db_session, mock_public_user):
        """Two _get_request_checker calls on the same request return the same instance."""
        request = self._make_request()
        first = _get_request_checker(request, mock_db_session, mock_public_user)
        second = _get_request_checker(request, mock_db_session, mock_public_user)
        assert first is second
        assert getattr(request.state, "rbac_checker", None) is first

    def test_different_requests_get_distinct_checkers(self, mock_db_session, mock_public_user):
        """Different request objects each get their own checker."""
        req1 = self._make_request()
        req2 = self._make_request()
        c1 = _get_request_checker(req1, mock_db_session, mock_public_user)
        c2 = _get_request_checker(req2, mock_db_session, mock_public_user)
        assert c1 is not c2

    def test_new_checker_when_session_changes(self, mock_public_user):
        """If the same request is somehow paired with a new session, return a fresh checker."""
        request = self._make_request()
        s1 = Mock(spec=Session)
        s2 = Mock(spec=Session)
        c1 = _get_request_checker(request, s1, mock_public_user)
        c2 = _get_request_checker(request, s2, mock_public_user)
        assert c1 is not c2

    def test_new_checker_when_user_changes(self, mock_db_session):
        """If the same request is paired with a different user, return a fresh checker."""
        request = self._make_request()
        u1 = Mock(spec=PublicUser); u1.id = 1
        u2 = Mock(spec=PublicUser); u2.id = 2
        c1 = _get_request_checker(request, mock_db_session, u1)
        c2 = _get_request_checker(request, mock_db_session, u2)
        assert c1 is not c2

    @pytest.mark.asyncio
    async def test_author_check_hits_cache(self, mock_db_session, mock_public_user):
        """Pre-seeded _author_cache entry must bypass any DB work."""
        request = self._make_request()
        checker = ResourceAccessChecker(request, mock_db_session, mock_public_user)
        checker._author_cache["course_cached_author"] = True

        assert await checker._is_resource_author("course_cached_author") is True
        mock_db_session.exec.assert_not_called()

    @pytest.mark.asyncio
    async def test_admin_check_hits_cache(self, mock_db_session, mock_public_user):
        request = self._make_request()
        checker = ResourceAccessChecker(request, mock_db_session, mock_public_user)
        checker._admin_cache["course_cached_admin"] = True

        assert await checker._is_admin_or_maintainer("course_cached_admin") is True
        mock_db_session.exec.assert_not_called()

    @pytest.mark.asyncio
    async def test_public_published_check_hits_cache(self, mock_db_session, mock_public_user):
        request = self._make_request()
        checker = ResourceAccessChecker(request, mock_db_session, mock_public_user)
        checker._public_published_cache["course_cached_pp"] = (True, True)

        config = get_resource_config("course_cached_pp")
        assert await checker._is_public_and_published("course_cached_pp", config) == (True, True)
        mock_db_session.exec.assert_not_called()

    @pytest.mark.asyncio
    async def test_usergroup_check_hits_cache(self, mock_db_session, mock_public_user):
        request = self._make_request()
        checker = ResourceAccessChecker(request, mock_db_session, mock_public_user)
        checker._usergroup_cache[("course_cached_ug", False)] = True

        assert await checker._check_usergroup_membership("course_cached_ug", False) is True
        mock_db_session.exec.assert_not_called()

    @pytest.mark.asyncio
    async def test_parent_uuid_resolution_hits_cache(self, mock_db_session, mock_public_user):
        """Child→parent UUID resolution is cached per request."""
        request = self._make_request()
        checker = ResourceAccessChecker(request, mock_db_session, mock_public_user)
        checker._parent_uuid_cache["chapter_xyz"] = "course_parent"

        config = get_resource_config("chapter_xyz")
        result = await checker._resolve_parent_resource_uuid("chapter_xyz", config)
        assert result == "course_parent"
        mock_db_session.exec.assert_not_called()
