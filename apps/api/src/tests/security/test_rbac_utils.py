import pytest
from unittest.mock import AsyncMock, patch
from fastapi import HTTPException
from src.security.rbac.utils import (
    check_element_type,
    get_singular_form_of_element,
    get_id_identifier_of_element,
)


class TestRBACUtils:
    """Test cases for RBAC utils module"""

    @pytest.mark.asyncio
    async def test_check_element_type_course(self):
        """Test element type checking for course"""
        result = await check_element_type("course_123")
        assert result == "courses"

    @pytest.mark.asyncio
    async def test_check_element_type_course_update(self):
        """Test element type checking for course update"""
        result = await check_element_type("courseupdate_123")
        assert result == "courses"

    @pytest.mark.asyncio
    async def test_check_element_type_user(self):
        """Test element type checking for user"""
        result = await check_element_type("user_123")
        assert result == "users"

    @pytest.mark.asyncio
    async def test_check_element_type_usergroup(self):
        """Test element type checking for usergroup"""
        result = await check_element_type("usergroup_123")
        assert result == "usergroups"

    @pytest.mark.asyncio
    async def test_check_element_type_house(self):
        """Test element type checking for house"""
        result = await check_element_type("house_123")
        assert result == "houses"

    @pytest.mark.asyncio
    async def test_check_element_type_org(self):
        """Test element type checking for organization"""
        result = await check_element_type("org_123")
        assert result == "organizations"

    @pytest.mark.asyncio
    async def test_check_element_type_chapter(self):
        """Test element type checking for chapter"""
        result = await check_element_type("chapter_123")
        assert result == "coursechapters"

    @pytest.mark.asyncio
    async def test_check_element_type_collection(self):
        """Test element type checking for collection"""
        result = await check_element_type("collection_123")
        assert result == "collections"

    @pytest.mark.asyncio
    async def test_check_element_type_activity(self):
        """Test element type checking for activity"""
        result = await check_element_type("activity_123")
        assert result == "activities"

    @pytest.mark.asyncio
    async def test_check_element_type_role(self):
        """Test element type checking for role"""
        result = await check_element_type("role_123")
        assert result == "roles"

    @pytest.mark.asyncio
    async def test_check_element_type_unknown(self):
        """Test element type checking for unknown element"""
        with pytest.raises(HTTPException) as exc_info:
            await check_element_type("unknown_123")
        
        assert exc_info.value.status_code == 409
        assert "Issue verifying element nature" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_check_element_type_empty_uuid(self):
        """Test element type checking for empty UUID"""
        with pytest.raises(HTTPException) as exc_info:
            await check_element_type("")
        
        assert exc_info.value.status_code == 409
        assert "Issue verifying element nature" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_get_singular_form_of_element_activity(self):
        """Test getting singular form for activity"""
        result = await get_singular_form_of_element("activity_123")
        assert result == "activity"

    @pytest.mark.asyncio
    async def test_get_singular_form_of_element_course(self):
        """Test getting singular form for course"""
        result = await get_singular_form_of_element("course_123")
        assert result == "course"

    @pytest.mark.asyncio
    async def test_get_singular_form_of_element_user(self):
        """Test getting singular form for user"""
        result = await get_singular_form_of_element("user_123")
        assert result == "user"

    @pytest.mark.asyncio
    async def test_get_singular_form_of_element_collection(self):
        """Test getting singular form for collection"""
        result = await get_singular_form_of_element("collection_123")
        assert result == "collection"

    @pytest.mark.asyncio
    async def test_get_singular_form_of_element_organization(self):
        """Test getting singular form for organization"""
        result = await get_singular_form_of_element("org_123")
        assert result == "organization"

    @pytest.mark.asyncio
    async def test_get_id_identifier_of_element_activity(self):
        """Test getting ID identifier for activity"""
        result = await get_id_identifier_of_element("activity_123")
        assert result == "activity_id"

    @pytest.mark.asyncio
    async def test_get_id_identifier_of_element_course(self):
        """Test getting ID identifier for course"""
        result = await get_id_identifier_of_element("course_123")
        assert result == "course_id"

    @pytest.mark.asyncio
    async def test_get_id_identifier_of_element_user(self):
        """Test getting ID identifier for user"""
        result = await get_id_identifier_of_element("user_123")
        assert result == "user_id"

    @pytest.mark.asyncio
    async def test_get_id_identifier_of_element_organization(self):
        """Test getting ID identifier for organization"""
        result = await get_id_identifier_of_element("org_123")
        assert result == "org_id"

    @pytest.mark.asyncio
    async def test_get_id_identifier_of_element_collection(self):
        """Test getting ID identifier for collection"""
        result = await get_id_identifier_of_element("collection_123")
        assert result == "collection_id"

    @pytest.mark.asyncio
    async def test_element_type_consistency(self):
        """Test consistency between element type checking and singular form"""
        test_cases = [
            ("course_123", "courses", "course"),
            ("user_123", "users", "user"),
            ("collection_123", "collections", "collection"),
            ("activity_123", "activities", "activity"),
            ("org_123", "organizations", "organization"),
        ]
        
        for uuid, expected_plural, expected_singular in test_cases:
            element_type = await check_element_type(uuid)
            singular_form = await get_singular_form_of_element(uuid)
            
            assert element_type == expected_plural
            assert singular_form == expected_singular

    @pytest.mark.asyncio
    async def test_id_identifier_consistency(self):
        """Test consistency between singular form and ID identifier"""
        test_cases = [
            ("course_123", "course_id"),
            ("user_123", "user_id"),
            ("collection_123", "collection_id"),
            ("activity_123", "activity_id"),
            ("org_123", "org_id"),
        ]
        
        for uuid, expected_id_identifier in test_cases:
            id_identifier = await get_id_identifier_of_element(uuid)
            assert id_identifier == expected_id_identifier

    @pytest.mark.asyncio
    async def test_edge_cases_with_underscores(self):
        """Test edge cases with multiple underscores"""
        # Test with multiple underscores
        result = await check_element_type("course_123_456")
        assert result == "courses"
        
        result = await get_singular_form_of_element("course_123_456")
        assert result == "course"
        
        result = await get_id_identifier_of_element("course_123_456")
        assert result == "course_id"

    @pytest.mark.asyncio
    async def test_edge_cases_with_numbers_only(self):
        """Test edge cases with numbers only after prefix"""
        result = await check_element_type("course_123456")
        assert result == "courses"
        
        result = await get_singular_form_of_element("course_123456")
        assert result == "course"
        
        result = await get_id_identifier_of_element("course_123456")
        assert result == "course_id" 