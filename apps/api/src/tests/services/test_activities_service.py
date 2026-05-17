"""Tests for src/services/courses/activities/activities.py."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from src.db.courses.activities import ActivityCreate, ActivityRead, ActivityTypeEnum, ActivitySubTypeEnum
from src.db.organizations import OrganizationRead
from src.services.courses.activities.activities import (
    create_activity,
    get_activity,
    get_editor_bootstrap,
    EditorBootstrapResponse,
)


class TestCreateActivity:
    @pytest.mark.asyncio
    async def test_raises_404_when_chapter_not_found(
        self, mock_request, db, org, admin_user
    ):
        activity_obj = ActivityCreate(
            name="Test",
            activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
            activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
            chapter_id=9999,
            course_id=1,
            org_id=org.id,
            content={},
        )
        with patch(
            "src.services.courses.activities.activities.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc:
                await create_activity(mock_request, activity_obj, admin_user, db)
        assert exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_creates_activity_successfully(
        self, mock_request, db, org, course, chapter, admin_user
    ):
        activity_obj = ActivityCreate(
            name="New Activity",
            activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
            activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
            chapter_id=chapter.id,
            course_id=course.id,
            org_id=org.id,
            content={"type": "doc", "content": []},
        )
        with patch(
            "src.services.courses.activities.activities.check_resource_access",
            new_callable=AsyncMock,
        ):
            result = await create_activity(mock_request, activity_obj, admin_user, db)

        assert isinstance(result, ActivityRead)
        assert result.name == "New Activity"


class TestGetEditorBootstrap:
    @pytest.mark.asyncio
    async def test_raises_404_when_activity_not_found(
        self, mock_request, db, org, course, chapter, admin_user
    ):
        with patch(
            "src.services.courses.activities.activities.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.activities.activities.check_ee_activity_paid_access",
            new_callable=AsyncMock,
            return_value=True,
        ), patch(
            "src.services.courses.activities.activities._apply_activity_lock",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc:
                await get_editor_bootstrap(mock_request, "nonexistent-uuid", admin_user, db)
        assert exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_returns_editor_bootstrap_response(
        self, mock_request, db, org, course, chapter, activity, admin_user
    ):
        fake_org_read = MagicMock(spec=OrganizationRead)

        with patch(
            "src.services.courses.activities.activities.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.activities.activities.check_ee_activity_paid_access",
            new_callable=AsyncMock,
            return_value=True,
        ), patch(
            "src.services.courses.activities.activities._apply_activity_lock",
            new_callable=AsyncMock,
        ), patch(
            "src.services.orgs.orgs._build_org_read_with_resolved",
            return_value=fake_org_read,
        ):
            result = await get_editor_bootstrap(
                mock_request, activity.activity_uuid, admin_user, db
            )

        assert isinstance(result, EditorBootstrapResponse)
        assert result.activity.name == activity.name
        assert result.course.org_uuid == org.org_uuid

    @pytest.mark.asyncio
    async def test_scrubs_content_when_no_paid_access(
        self, mock_request, db, org, course, chapter, activity, admin_user
    ):
        fake_org_read = MagicMock(spec=OrganizationRead)

        with patch(
            "src.services.courses.activities.activities.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.activities.activities.check_ee_activity_paid_access",
            new_callable=AsyncMock,
            return_value=False,
        ), patch(
            "src.services.courses.activities.activities._apply_activity_lock",
            new_callable=AsyncMock,
        ), patch(
            "src.services.orgs.orgs._build_org_read_with_resolved",
            return_value=fake_org_read,
        ):
            result = await get_editor_bootstrap(
                mock_request, activity.activity_uuid, admin_user, db
            )

        assert result.activity.content == {"paid_access": False}


class TestGetActivity:
    @pytest.mark.asyncio
    async def test_raises_404_for_unknown_activity(
        self, mock_request, db, org, course, chapter, admin_user
    ):
        with patch(
            "src.services.courses.activities.activities.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.activities.activities.check_ee_activity_paid_access",
            new_callable=AsyncMock,
            return_value=True,
        ), patch(
            "src.services.courses.activities.activities._apply_activity_lock",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc:
                await get_activity(mock_request, "nonexistent-uuid", admin_user, db)
        assert exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_returns_activity_read(
        self, mock_request, db, org, course, chapter, activity, admin_user
    ):
        with patch(
            "src.services.courses.activities.activities.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.activities.activities.check_ee_activity_paid_access",
            new_callable=AsyncMock,
            return_value=True,
        ), patch(
            "src.services.courses.activities.activities._apply_activity_lock",
            new_callable=AsyncMock,
        ):
            result = await get_activity(
                mock_request, activity.activity_uuid, admin_user, db
            )

        assert isinstance(result, ActivityRead)
        assert result.name == activity.name
