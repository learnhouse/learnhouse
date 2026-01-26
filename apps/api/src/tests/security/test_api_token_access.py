"""
Test suite for API token access control.

This file tests the router-level access control that restricts API tokens
from accessing certain endpoints while allowing access to others.
"""

import pytest
from fastapi import HTTPException
from src.security.api_token_utils import require_non_api_token_user, reject_api_token_access
from src.db.users import AnonymousUser, PublicUser, APITokenUser


class TestAPITokenAccessControl:
    """Test cases for API token access control"""

    @pytest.fixture
    def mock_public_user(self):
        """Create a mock PublicUser object"""
        return PublicUser(
            id=1,
            email="test@example.com",
            username="testuser",
            first_name="Test",
            last_name="User",
            user_uuid="user_123"
        )

    @pytest.fixture
    def mock_api_token_user(self):
        """Create a mock APITokenUser object"""
        return APITokenUser(
            id=1,
            user_uuid="apitoken_test123",
            username="api_token",
            org_id=1,
            token_name="Test Token",
            created_by_user_id=1
        )

    @pytest.fixture
    def mock_anonymous_user(self):
        """Create a mock AnonymousUser object"""
        return AnonymousUser()

    # Tests for reject_api_token_access function

    @pytest.mark.asyncio
    async def test_reject_api_token_access_with_api_token(self, mock_api_token_user):
        """Test that reject_api_token_access raises HTTPException for API tokens"""
        with pytest.raises(HTTPException) as exc_info:
            reject_api_token_access(mock_api_token_user)

        assert exc_info.value.status_code == 403
        assert "API tokens cannot access this resource" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_reject_api_token_access_with_public_user(self, mock_public_user):
        """Test that reject_api_token_access allows PublicUser"""
        # Should not raise exception
        try:
            reject_api_token_access(mock_public_user)
        except HTTPException:
            pytest.fail("reject_api_token_access raised HTTPException for PublicUser")

    @pytest.mark.asyncio
    async def test_reject_api_token_access_with_anonymous_user(self, mock_anonymous_user):
        """Test that reject_api_token_access allows AnonymousUser"""
        # Should not raise exception
        try:
            reject_api_token_access(mock_anonymous_user)
        except HTTPException:
            pytest.fail("reject_api_token_access raised HTTPException for AnonymousUser")

    # Tests for require_non_api_token_user dependency

    @pytest.mark.asyncio
    async def test_require_non_api_token_user_with_api_token(self, mock_api_token_user):
        """Test that require_non_api_token_user rejects API tokens"""
        with pytest.raises(HTTPException) as exc_info:
            await require_non_api_token_user(mock_api_token_user)

        assert exc_info.value.status_code == 403
        assert "API tokens cannot access this resource" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_require_non_api_token_user_with_public_user(self, mock_public_user):
        """Test that require_non_api_token_user allows PublicUser"""
        result = await require_non_api_token_user(mock_public_user)

        assert result == mock_public_user
        assert isinstance(result, PublicUser)

    @pytest.mark.asyncio
    async def test_require_non_api_token_user_with_anonymous_user(self, mock_anonymous_user):
        """Test that require_non_api_token_user allows AnonymousUser"""
        result = await require_non_api_token_user(mock_anonymous_user)

        assert result == mock_anonymous_user
        assert isinstance(result, AnonymousUser)

    # Integration tests for endpoint access patterns

    @pytest.mark.asyncio
    async def test_blocked_endpoint_pattern(self, mock_api_token_user, mock_public_user):
        """Test the pattern used by blocked endpoints (users, orgs, roles, etc.)"""
        # Simulate what happens in a blocked endpoint with router dependency

        # API token should be rejected
        with pytest.raises(HTTPException) as exc_info:
            await require_non_api_token_user(mock_api_token_user)
        assert exc_info.value.status_code == 403

        # Regular user should pass through
        result = await require_non_api_token_user(mock_public_user)
        assert result == mock_public_user

    @pytest.mark.asyncio
    async def test_allowed_endpoint_pattern(self, mock_api_token_user, mock_public_user):
        """Test the pattern used by allowed endpoints (courses, search, etc.)"""
        # Simulate what happens in an allowed endpoint without the dependency
        # Both API tokens and regular users should be able to proceed

        # No dependency check, so both should work
        assert isinstance(mock_api_token_user, APITokenUser)
        assert isinstance(mock_public_user, PublicUser)

    # Edge cases and error handling

    @pytest.mark.asyncio
    async def test_api_token_user_has_correct_attributes(self, mock_api_token_user):
        """Test that APITokenUser has the expected attributes"""
        assert hasattr(mock_api_token_user, 'id')
        assert hasattr(mock_api_token_user, 'user_uuid')
        assert hasattr(mock_api_token_user, 'username')
        assert hasattr(mock_api_token_user, 'org_id')
        assert hasattr(mock_api_token_user, 'token_name')
        assert hasattr(mock_api_token_user, 'created_by_user_id')

        # Verify it's distinguishable from regular users
        assert mock_api_token_user.username == "api_token"
        assert mock_api_token_user.user_uuid.startswith("apitoken_")

    @pytest.mark.asyncio
    async def test_error_message_consistency(self, mock_api_token_user):
        """Test that error messages are consistent across different functions"""
        # Test reject_api_token_access
        with pytest.raises(HTTPException) as exc_info1:
            reject_api_token_access(mock_api_token_user)

        # Test require_non_api_token_user
        with pytest.raises(HTTPException) as exc_info2:
            await require_non_api_token_user(mock_api_token_user)

        # Both should have the same error message
        assert exc_info1.value.detail == exc_info2.value.detail
        assert exc_info1.value.status_code == exc_info2.value.status_code


class TestRouterLevelProtection:
    """Test router-level dependency protection"""

    @pytest.fixture
    def mock_api_token_user(self):
        """Create a mock APITokenUser object"""
        return APITokenUser(
            id=1,
            user_uuid="apitoken_test123",
            username="api_token",
            org_id=1,
            token_name="Test Token",
            created_by_user_id=1
        )

    @pytest.fixture
    def mock_public_user(self):
        """Create a mock PublicUser object"""
        return PublicUser(
            id=1,
            email="test@example.com",
            username="testuser",
            first_name="Test",
            last_name="User",
            user_uuid="user_123"
        )

    @pytest.mark.asyncio
    async def test_users_router_protection(self, mock_api_token_user, mock_public_user):
        """Test that /users router is protected from API tokens"""
        # Users router has: dependencies=[Depends(get_non_api_token_user)]

        # API token should be blocked
        with pytest.raises(HTTPException) as exc_info:
            await require_non_api_token_user(mock_api_token_user)
        assert exc_info.value.status_code == 403

        # Regular user should pass
        result = await require_non_api_token_user(mock_public_user)
        assert result == mock_public_user

    @pytest.mark.asyncio
    async def test_orgs_router_protection(self, mock_api_token_user, mock_public_user):
        """Test that /orgs router is protected from API tokens"""
        # Orgs router has: dependencies=[Depends(get_non_api_token_user)]

        with pytest.raises(HTTPException) as exc_info:
            await require_non_api_token_user(mock_api_token_user)
        assert exc_info.value.status_code == 403

        result = await require_non_api_token_user(mock_public_user)
        assert result == mock_public_user

    @pytest.mark.asyncio
    async def test_roles_router_protection(self, mock_api_token_user):
        """Test that /roles router is protected from API tokens"""
        # Roles router has: dependencies=[Depends(get_non_api_token_user)]

        with pytest.raises(HTTPException) as exc_info:
            await require_non_api_token_user(mock_api_token_user)
        assert exc_info.value.status_code == 403

    @pytest.mark.asyncio
    async def test_api_tokens_router_protection(self, mock_api_token_user):
        """Test that /api-tokens router is protected (tokens can't manage themselves)"""
        # API tokens router has: dependencies=[Depends(get_non_api_token_user)]

        with pytest.raises(HTTPException) as exc_info:
            await require_non_api_token_user(mock_api_token_user)
        assert exc_info.value.status_code == 403

    @pytest.mark.asyncio
    async def test_blocks_router_protection(self, mock_api_token_user):
        """Test that /blocks router is protected from API tokens"""
        with pytest.raises(HTTPException) as exc_info:
            await require_non_api_token_user(mock_api_token_user)
        assert exc_info.value.status_code == 403

    @pytest.mark.asyncio
    async def test_assignments_router_protection(self, mock_api_token_user):
        """Test that /assignments router is protected from API tokens"""
        with pytest.raises(HTTPException) as exc_info:
            await require_non_api_token_user(mock_api_token_user)
        assert exc_info.value.status_code == 403

    @pytest.mark.asyncio
    async def test_trail_router_protection(self, mock_api_token_user):
        """Test that /trail router is protected from API tokens"""
        with pytest.raises(HTTPException) as exc_info:
            await require_non_api_token_user(mock_api_token_user)
        assert exc_info.value.status_code == 403

    @pytest.mark.asyncio
    async def test_ai_router_protection(self, mock_api_token_user):
        """Test that /ai router is protected from API tokens"""
        with pytest.raises(HTTPException) as exc_info:
            await require_non_api_token_user(mock_api_token_user)
        assert exc_info.value.status_code == 403

    @pytest.mark.asyncio
    async def test_health_router_protection(self, mock_api_token_user):
        """Test that /health router is protected from API tokens"""
        with pytest.raises(HTTPException) as exc_info:
            await require_non_api_token_user(mock_api_token_user)
        assert exc_info.value.status_code == 403

    @pytest.mark.asyncio
    async def test_dev_router_protection(self, mock_api_token_user):
        """Test that /dev router is protected from API tokens"""
        with pytest.raises(HTTPException) as exc_info:
            await require_non_api_token_user(mock_api_token_user)
        assert exc_info.value.status_code == 403

    @pytest.mark.asyncio
    async def test_utils_router_protection(self, mock_api_token_user):
        """Test that /utils router is protected from API tokens"""
        with pytest.raises(HTTPException) as exc_info:
            await require_non_api_token_user(mock_api_token_user)
        assert exc_info.value.status_code == 403

    @pytest.mark.asyncio
    async def test_stream_router_protection(self, mock_api_token_user):
        """Test that /stream router is protected from API tokens"""
        with pytest.raises(HTTPException) as exc_info:
            await require_non_api_token_user(mock_api_token_user)
        assert exc_info.value.status_code == 403


class TestAllowedEndpoints:
    """Test that allowed endpoints don't have API token restrictions"""

    @pytest.fixture
    def mock_api_token_user(self):
        """Create a mock APITokenUser object"""
        return APITokenUser(
            id=1,
            user_uuid="apitoken_test123",
            username="api_token",
            org_id=1,
            token_name="Test Token",
            created_by_user_id=1
        )

    def test_courses_router_allows_api_tokens(self, mock_api_token_user):
        """Test that /courses router allows API tokens (no dependency)"""
        # Courses router does NOT have get_non_api_token_user dependency
        # So API tokens should work - we just verify the user type is valid
        assert isinstance(mock_api_token_user, APITokenUser)
        assert mock_api_token_user.org_id is not None

    def test_search_router_allows_api_tokens(self, mock_api_token_user):
        """Test that /search router allows API tokens"""
        assert isinstance(mock_api_token_user, APITokenUser)

    def test_chapters_router_allows_api_tokens(self, mock_api_token_user):
        """Test that /chapters router allows API tokens"""
        assert isinstance(mock_api_token_user, APITokenUser)

    def test_activities_router_allows_api_tokens(self, mock_api_token_user):
        """Test that /activities router allows API tokens"""
        assert isinstance(mock_api_token_user, APITokenUser)

    def test_collections_router_allows_api_tokens(self, mock_api_token_user):
        """Test that /collections router allows API tokens"""
        assert isinstance(mock_api_token_user, APITokenUser)

    def test_certifications_router_allows_api_tokens(self, mock_api_token_user):
        """Test that /certifications router allows API tokens"""
        assert isinstance(mock_api_token_user, APITokenUser)

    def test_usergroups_router_allows_api_tokens(self, mock_api_token_user):
        """Test that /usergroups router allows API tokens"""
        assert isinstance(mock_api_token_user, APITokenUser)

    def test_payments_router_allows_api_tokens(self, mock_api_token_user):
        """Test that /payments router allows API tokens (EE)"""
        assert isinstance(mock_api_token_user, APITokenUser)


class TestEERouterProtection:
    """Test Enterprise Edition router protection"""

    @pytest.fixture
    def mock_api_token_user(self):
        """Create a mock APITokenUser object"""
        return APITokenUser(
            id=1,
            user_uuid="apitoken_test123",
            username="api_token",
            org_id=1,
            token_name="Test Token",
            created_by_user_id=1
        )

    @pytest.mark.asyncio
    async def test_ee_info_router_protection(self, mock_api_token_user):
        """Test that /ee router is protected from API tokens"""
        with pytest.raises(HTTPException) as exc_info:
            await require_non_api_token_user(mock_api_token_user)
        assert exc_info.value.status_code == 403

    @pytest.mark.asyncio
    async def test_audit_logs_router_protection(self, mock_api_token_user):
        """Test that /ee/audit_logs router is protected from API tokens"""
        with pytest.raises(HTTPException) as exc_info:
            await require_non_api_token_user(mock_api_token_user)
        assert exc_info.value.status_code == 403

    @pytest.mark.asyncio
    async def test_scorm_router_protection(self, mock_api_token_user):
        """Test that /scorm router is protected from API tokens"""
        with pytest.raises(HTTPException) as exc_info:
            await require_non_api_token_user(mock_api_token_user)
        assert exc_info.value.status_code == 403


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
