import pytest
from unittest.mock import Mock, AsyncMock, patch
from fastapi import HTTPException, Request
from sqlmodel import Session
from src.security.rbac.rbac import (
    authorization_verify_if_element_is_public,
    authorization_verify_if_user_is_author,
    authorization_verify_based_on_roles,
    authorization_verify_based_on_org_admin_status,
    authorization_verify_based_on_roles_and_authorship,
    authorization_verify_if_user_is_anon,
)
from src.db.courses.courses import Course
from src.db.collections import Collection
from src.db.resource_authors import ResourceAuthor, ResourceAuthorshipEnum, ResourceAuthorshipStatusEnum
from src.db.roles import Role


class TestRBAC:
    """Test cases for RBAC module"""

    @pytest.fixture
    def mock_request(self):
        """Create a mock request object"""
        return Mock(spec=Request)

    @pytest.fixture
    def mock_db_session(self):
        """Create a mock database session"""
        return Mock(spec=Session)

    @pytest.fixture
    def mock_course(self):
        """Create a mock course object"""
        course = Mock(spec=Course)
        course.course_uuid = "course_123"
        course.public = True
        return course

    @pytest.fixture
    def mock_collection(self):
        """Create a mock collection object"""
        collection = Mock(spec=Collection)
        collection.collection_uuid = "collection_123"
        collection.public = True
        return collection

    @pytest.fixture
    def mock_resource_author(self):
        """Create a mock resource author object"""
        author = Mock(spec=ResourceAuthor)
        author.user_id = 1
        author.authorship = ResourceAuthorshipEnum.CREATOR
        author.authorship_status = ResourceAuthorshipStatusEnum.ACTIVE
        return author

    @pytest.fixture
    def mock_role(self):
        """Create a mock role object"""
        from src.db.roles import RoleTypeEnum, Rights, PermissionsWithOwn, Permission, DashboardPermission
        role = Mock(spec=Role)
        role.id = 1
        role.org_id = 1
        role.name = "Test Role"
        role.description = "A test role."
        # Rights should be a Rights object with proper Permission objects
        role.rights = Rights(
            courses=PermissionsWithOwn(
                action_create=False,
                action_read=True,
                action_read_own=False,
                action_update=False,
                action_update_own=False,
                action_delete=False,
                action_delete_own=False,
            ),
            users=Permission(
                action_create=False,
                action_read=True,
                action_update=False,
                action_delete=False,
            ),
            usergroups=Permission(
                action_create=False,
                action_read=True,
                action_update=False,
                action_delete=False,
            ),
            collections=Permission(
                action_create=False,
                action_read=True,
                action_update=False,
                action_delete=False,
            ),
            organizations=Permission(
                action_create=False,
                action_read=True,
                action_update=False,
                action_delete=False,
            ),
            coursechapters=Permission(
                action_create=False,
                action_read=True,
                action_update=False,
                action_delete=False,
            ),
            activities=Permission(
                action_create=False,
                action_read=True,
                action_update=False,
                action_delete=False,
            ),
            roles=Permission(
                action_create=False,
                action_read=True,
                action_update=False,
                action_delete=False,
            ),
            dashboard=DashboardPermission(
                action_access=True,
            )
        )
        role.role_type = RoleTypeEnum.TYPE_GLOBAL
        role.role_uuid = "role_test"
        role.creation_date = "2024-01-01T00:00:00"
        role.update_date = "2024-01-01T00:00:00"
        return role

    @pytest.mark.asyncio
    async def test_authorization_verify_if_element_is_public_course_success(self, mock_request, mock_db_session, mock_course):
        """Test public course authorization success"""
        with patch('src.security.rbac.rbac.check_element_type', new_callable=AsyncMock) as mock_check_type:
            mock_check_type.return_value = "courses"
            
            # Mock database query
            mock_db_session.exec.return_value.first.return_value = mock_course
            
            result = await authorization_verify_if_element_is_public(
                request=mock_request,
                element_uuid="course_123",
                action="read",
                db_session=mock_db_session
            )
            
            assert result is True

    @pytest.mark.asyncio
    async def test_authorization_verify_if_element_is_public_course_not_public(self, mock_request, mock_db_session):
        """Test public course authorization failure when course is not public"""
        with patch('src.security.rbac.rbac.check_element_type', new_callable=AsyncMock) as mock_check_type:
            mock_check_type.return_value = "courses"
            
            # Mock database query to return None (course not found or not public)
            mock_db_session.exec.return_value.first.return_value = None
            
            with pytest.raises(HTTPException) as exc_info:
                await authorization_verify_if_element_is_public(
                    request=mock_request,
                    element_uuid="course_123",
                    action="read",
                    db_session=mock_db_session
                )
            
            assert exc_info.value.status_code == 403
            assert "You don't have the right to perform this action" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_authorization_verify_if_element_is_public_collection_success(self, mock_request, mock_db_session, mock_collection):
        """Test public collection authorization success"""
        with patch('src.security.rbac.rbac.check_element_type', new_callable=AsyncMock) as mock_check_type:
            mock_check_type.return_value = "collections"
            
            # Mock database query
            mock_db_session.exec.return_value.first.return_value = mock_collection
            
            result = await authorization_verify_if_element_is_public(
                request=mock_request,
                element_uuid="collection_123",
                action="read",
                db_session=mock_db_session
            )
            
            assert result is True

    @pytest.mark.asyncio
    async def test_authorization_verify_if_element_is_public_unsupported_element_type(self, mock_request, mock_db_session):
        """Test public element authorization with unsupported element type"""
        with patch('src.security.rbac.rbac.check_element_type', new_callable=AsyncMock) as mock_check_type:
            mock_check_type.return_value = "users"  # Unsupported element type
            
            with pytest.raises(HTTPException) as exc_info:
                await authorization_verify_if_element_is_public(
                    request=mock_request,
                    element_uuid="user_123",
                    action="read",
                    db_session=mock_db_session
                )
            
            assert exc_info.value.status_code == 403
            assert "You don't have the right to perform this action" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_authorization_verify_if_user_is_author_create_action(self, mock_request, mock_db_session):
        """Test author verification for create action"""
        result = await authorization_verify_if_user_is_author(
            request=mock_request,
            user_id=1,
            action="create",
            element_uuid="course_123",
            db_session=mock_db_session
        )
        
        assert result is True

    @pytest.mark.asyncio
    async def test_authorization_verify_if_user_is_author_success(self, mock_request, mock_db_session, mock_resource_author):
        """Test author verification success"""
        with patch('src.security.rbac.rbac.check_element_type', new_callable=AsyncMock):
            # Mock database query
            mock_db_session.exec.return_value.first.return_value = mock_resource_author
            
            result = await authorization_verify_if_user_is_author(
                request=mock_request,
                user_id=1,
                action="read",
                element_uuid="course_123",
                db_session=mock_db_session
            )
            
            assert result is True

    @pytest.mark.asyncio
    async def test_authorization_verify_if_user_is_author_wrong_user(self, mock_request, mock_db_session, mock_resource_author):
        """Test author verification with wrong user"""
        with patch('src.security.rbac.rbac.check_element_type', new_callable=AsyncMock):
            # Mock database query
            mock_db_session.exec.return_value.first.return_value = mock_resource_author
            
            result = await authorization_verify_if_user_is_author(
                request=mock_request,
                user_id=2,  # Different user
                action="read",
                element_uuid="course_123",
                db_session=mock_db_session
            )
            
            assert result is False

    @pytest.mark.asyncio
    async def test_authorization_verify_if_user_is_author_no_resource_author(self, mock_request, mock_db_session):
        """Test author verification when no resource author exists"""
        with patch('src.security.rbac.rbac.check_element_type', new_callable=AsyncMock):
            # Mock database query to return None
            mock_db_session.exec.return_value.first.return_value = None
            
            result = await authorization_verify_if_user_is_author(
                request=mock_request,
                user_id=1,
                action="read",
                element_uuid="course_123",
                db_session=mock_db_session
            )
            
            assert result is False

    @pytest.mark.asyncio
    async def test_authorization_verify_based_on_roles_success(self, mock_request, mock_db_session, mock_role):
        """Test role-based authorization success"""
        with patch('src.security.rbac.rbac.check_element_type', new_callable=AsyncMock) as mock_check_type:
            mock_check_type.return_value = "courses"
            
            # Mock database query
            mock_db_session.exec.return_value.all.return_value = [mock_role]
            
            result = await authorization_verify_based_on_roles(
                request=mock_request,
                user_id=1,
                action="read",
                element_uuid="course_123",
                db_session=mock_db_session
            )
            
            assert result is True

    @pytest.mark.asyncio
    async def test_authorization_verify_based_on_roles_no_permission(self, mock_request, mock_db_session, mock_role):
        """Test role-based authorization failure"""
        with patch('src.security.rbac.rbac.check_element_type', new_callable=AsyncMock) as mock_check_type:
            mock_check_type.return_value = "courses"
            
            # Mock role without permission
            mock_role.rights.courses.action_read = False
            
            # Mock database query
            mock_db_session.exec.return_value.all.return_value = [mock_role]
            
            result = await authorization_verify_based_on_roles(
                request=mock_request,
                user_id=1,
                action="read",
                element_uuid="course_123",
                db_session=mock_db_session
            )
            
            assert result is False

    @pytest.mark.asyncio
    async def test_authorization_verify_based_on_org_admin_status_success(self, mock_request, mock_db_session):
        """Test org admin status verification success"""
        with patch('src.security.rbac.rbac.check_element_type', new_callable=AsyncMock):
            # Mock admin role
            from src.db.roles import RoleTypeEnum
            admin_role = Mock(spec=Role)
            admin_role.id = 1  # Admin role ID
            admin_role.org_id = 1
            admin_role.name = "Admin Role"
            admin_role.description = "An admin role."
            admin_role.rights = {}
            admin_role.role_type = RoleTypeEnum.TYPE_GLOBAL
            admin_role.role_uuid = "role_admin"
            admin_role.creation_date = "2024-01-01T00:00:00"
            admin_role.update_date = "2024-01-01T00:00:00"
            
            # Mock database query
            mock_db_session.exec.return_value.all.return_value = [admin_role]
            
            result = await authorization_verify_based_on_org_admin_status(
                request=mock_request,
                user_id=1,
                action="read",
                element_uuid="course_123",
                db_session=mock_db_session
            )
            
            assert result is True

    @pytest.mark.asyncio
    async def test_authorization_verify_based_on_org_admin_status_no_admin(self, mock_request, mock_db_session):
        """Test org admin status verification failure"""
        with patch('src.security.rbac.rbac.check_element_type', new_callable=AsyncMock):
            # Mock non-admin role
            from src.db.roles import RoleTypeEnum
            regular_role = Mock(spec=Role)
            regular_role.id = 3  # Non-admin role ID
            regular_role.org_id = 1
            regular_role.name = "Regular Role"
            regular_role.description = "A regular role."
            regular_role.rights = {}
            regular_role.role_type = RoleTypeEnum.TYPE_GLOBAL
            regular_role.role_uuid = "role_regular"
            regular_role.creation_date = "2024-01-01T00:00:00"
            regular_role.update_date = "2024-01-01T00:00:00"
            
            # Mock database query
            mock_db_session.exec.return_value.all.return_value = [regular_role]
            
            result = await authorization_verify_based_on_org_admin_status(
                request=mock_request,
                user_id=1,
                action="read",
                element_uuid="course_123",
                db_session=mock_db_session
            )
            
            assert result is False

    @pytest.mark.asyncio
    async def test_authorization_verify_based_on_roles_and_authorship_success(self, mock_request, mock_db_session, mock_resource_author):
        """Test combined roles and authorship authorization success"""
        with patch('src.security.rbac.rbac.authorization_verify_if_user_is_author', new_callable=AsyncMock) as mock_author, \
             patch('src.security.rbac.rbac.authorization_verify_based_on_roles', new_callable=AsyncMock) as mock_roles:
            
            mock_author.return_value = True
            mock_roles.return_value = False
            
            result = await authorization_verify_based_on_roles_and_authorship(
                request=mock_request,
                user_id=1,
                action="read",
                element_uuid="course_123",
                db_session=mock_db_session
            )
            
            assert result is True

    @pytest.mark.asyncio
    async def test_authorization_verify_based_on_roles_and_authorship_failure(self, mock_request, mock_db_session):
        """Test combined roles and authorship authorization failure"""
        with patch('src.security.rbac.rbac.authorization_verify_if_user_is_author', new_callable=AsyncMock) as mock_author, \
             patch('src.security.rbac.rbac.authorization_verify_based_on_roles', new_callable=AsyncMock) as mock_roles:
            
            mock_author.return_value = False
            mock_roles.return_value = False
            
            with pytest.raises(HTTPException) as exc_info:
                await authorization_verify_based_on_roles_and_authorship(
                    request=mock_request,
                    user_id=1,
                    action="read",
                    element_uuid="course_123",
                    db_session=mock_db_session
                )
            
            assert exc_info.value.status_code == 403
            assert "User rights (roles & authorship)" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_authorization_verify_if_user_is_anon_anonymous_user(self):
        """Test anonymous user verification"""
        with pytest.raises(HTTPException) as exc_info:
            await authorization_verify_if_user_is_anon(user_id=0)
        
        assert exc_info.value.status_code == 403
        assert "You should be logged in to perform this action" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_authorization_verify_if_user_is_anon_authenticated_user(self):
        """Test authenticated user verification"""
        # Should not raise any exception
        await authorization_verify_if_user_is_anon(user_id=1) 