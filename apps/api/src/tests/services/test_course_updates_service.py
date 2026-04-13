"""Tests for src/services/courses/updates.py."""

from uuid import UUID
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from src.db.courses.course_updates import (
    CourseUpdate,
    CourseUpdateCreate,
    CourseUpdateUpdate,
)
from src.services.courses.updates import (
    create_update,
    delete_update,
    get_updates_by_course_uuid,
    update_update,
)


def _seed_course_update(
    db, org, course, *, update_id: int, courseupdate_uuid: str, creation_date: str
):
    update = CourseUpdate(
        id=update_id,
        title=f"Update {update_id}",
        content=f"Content {update_id}",
        course_id=course.id,
        courseupdate_uuid=courseupdate_uuid,
        linked_activity_uuids=f"activity-{update_id}",
        org_id=org.id,
        creation_date=creation_date,
        update_date=creation_date,
    )
    db.add(update)
    db.commit()
    db.refresh(update)
    return update


class TestCourseUpdatesService:
    @pytest.mark.asyncio
    async def test_create_update_validates_org_and_course(self, db, org, course, admin_user, mock_request):
        with pytest.raises(HTTPException) as org_exc:
            await create_update(
                mock_request,
                course.course_uuid,
                CourseUpdateCreate(title="New update", content="Body", org_id=999),
                admin_user,
                db,
            )

        assert org_exc.value.status_code == 409
        assert org_exc.value.detail == "Organization does not exist"

        with pytest.raises(HTTPException) as course_exc:
            await create_update(
                mock_request,
                "missing-course",
                CourseUpdateCreate(title="New update", content="Body", org_id=org.id),
                admin_user,
                db,
            )

        assert course_exc.value.status_code == 409
        assert course_exc.value.detail == "Course does not exist"

    @pytest.mark.asyncio
    async def test_create_update_success_dispatches_webhook(self, db, org, course, admin_user, mock_request):
        with (
            patch(
                "src.services.courses.updates.check_resource_access",
                new_callable=AsyncMock,
            ) as mock_access,
            patch("src.services.courses.updates.dispatch_webhooks", new_callable=AsyncMock) as mock_dispatch,
            patch("src.services.courses.updates.uuid4", return_value=UUID("12345678-1234-5678-1234-567812345678")),
        ):
            created = await create_update(
                mock_request,
                course.course_uuid,
                CourseUpdateCreate(
                    title="Release notes",
                    content="Body",
                    linked_activity_uuids="activity-1",
                    org_id=org.id,
                ),
                admin_user,
                db,
            )

        mock_access.assert_awaited_once()
        mock_dispatch.assert_awaited_once_with(
            event_name="course_update_published",
            org_id=org.id,
            data={
                "courseupdate_uuid": "courseupdate_12345678-1234-5678-1234-567812345678",
                "course_uuid": course.course_uuid,
            },
        )
        assert created.title == "Release notes"
        assert created.content == "Body"
        assert created.course_id == course.id
        assert created.org_id == org.id
        assert created.courseupdate_uuid == "courseupdate_12345678-1234-5678-1234-567812345678"

        stored = db.get(CourseUpdate, created.id)
        assert stored is not None
        assert stored.courseupdate_uuid == created.courseupdate_uuid

    @pytest.mark.asyncio
    async def test_update_update_validates_missing_update(self, db, admin_user, mock_request):
        with pytest.raises(HTTPException) as exc_info:
            await update_update(
                mock_request,
                "missing-update",
                CourseUpdateUpdate(title="Updated"),
                admin_user,
                db,
            )

        assert exc_info.value.status_code == 409
        assert exc_info.value.detail == "Update does not exist"

    @pytest.mark.asyncio
    async def test_update_update_updates_only_provided_fields(self, db, org, course, admin_user, mock_request):
        seeded = _seed_course_update(
            db,
            org,
            course,
            update_id=1,
            courseupdate_uuid="courseupdate_test",
            creation_date="2025-01-01 10:00:00",
        )

        with patch(
            "src.services.courses.updates.check_resource_access",
            new_callable=AsyncMock,
        ) as mock_access:
            updated = await update_update(
                mock_request,
                seeded.courseupdate_uuid,
                CourseUpdateUpdate(title="Renamed", linked_activity_uuids="activity-updated"),
                admin_user,
                db,
            )

        mock_access.assert_awaited_once()
        assert updated.title == "Renamed"
        assert updated.linked_activity_uuids == "activity-updated"
        assert updated.content == seeded.content

    @pytest.mark.asyncio
    async def test_delete_update_validates_missing_update(self, db, admin_user, mock_request):
        with pytest.raises(HTTPException) as exc_info:
            await delete_update(mock_request, "missing-update", admin_user, db)

        assert exc_info.value.status_code == 409
        assert exc_info.value.detail == "Update does not exist"

    @pytest.mark.asyncio
    async def test_delete_update_removes_row(self, db, org, course, admin_user, mock_request):
        seeded = _seed_course_update(
            db,
            org,
            course,
            update_id=1,
            courseupdate_uuid="courseupdate_delete",
            creation_date="2025-01-01 10:00:00",
        )

        with patch(
            "src.services.courses.updates.check_resource_access",
            new_callable=AsyncMock,
        ) as mock_access:
            result = await delete_update(mock_request, seeded.courseupdate_uuid, admin_user, db)

        mock_access.assert_awaited_once()
        assert result == {"message": "Update deleted successfully"}
        assert db.get(CourseUpdate, seeded.id) is None

    @pytest.mark.asyncio
    async def test_get_updates_by_course_uuid_validates_missing_course(self, db, admin_user, mock_request):
        with pytest.raises(HTTPException) as exc_info:
            await get_updates_by_course_uuid(mock_request, "missing-course", admin_user, db)

        assert exc_info.value.status_code == 409
        assert exc_info.value.detail == "Course does not exist"

    @pytest.mark.asyncio
    async def test_get_updates_by_course_uuid_returns_newest_first(self, db, org, course, admin_user, mock_request):
        older = _seed_course_update(
            db,
            org,
            course,
            update_id=1,
            courseupdate_uuid="courseupdate_old",
            creation_date="2025-01-01 10:00:00",
        )
        newer = _seed_course_update(
            db,
            org,
            course,
            update_id=2,
            courseupdate_uuid="courseupdate_new",
            creation_date="2025-02-01 10:00:00",
        )

        updates = await get_updates_by_course_uuid(mock_request, course.course_uuid, admin_user, db)

        assert [item.courseupdate_uuid for item in updates] == [newer.courseupdate_uuid, older.courseupdate_uuid]
        assert updates[0].title == "Update 2"
        assert updates[1].title == "Update 1"
