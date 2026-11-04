"""Activity and version endpoints must 404 cleanly when the parent row is gone.

An activity (or chapter) can outlive its course row, e.g. after a partial
delete or a restore that skipped the course. Every service that resolves the
course for its RBAC check has to answer 404 in that case instead of crashing
on ``None.course_uuid``. These tests orphan the fixtures and check each path.
"""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.courses.activities import Activity, ActivityCreate, ActivityUpdate
from src.db.courses.chapter_activities import ChapterActivity
from src.services.courses.activities.activities import (
    create_activity,
    delete_activity,
    update_activity,
)
from src.services.courses.activities.versioning import (
    get_activity_state,
    get_activity_version,
    get_activity_versions,
    restore_activity_version,
)

MISSING_COURSE_ID = 999


async def _orphan(db, row):
    """Point ``row`` at a course id that has no Course row."""
    row.course_id = MISSING_COURSE_ID
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


@pytest.fixture
def allow_rbac():
    """Let the RBAC call through so the test reaches the branch after it."""
    with patch(
        "src.services.courses.activities.activities.check_resource_access",
        new_callable=AsyncMock,
    ) as mock:
        yield mock


class TestCreateActivity:
    async def test_chapter_whose_course_is_gone_is_404(
        self, db, chapter, admin_user, mock_request
    ):
        await _orphan(db, chapter)

        with pytest.raises(HTTPException) as exc:
            await create_activity(
                mock_request,
                ActivityCreate(name="New", chapter_id=chapter.id),
                admin_user,
                db,
            )

        assert exc.value.status_code == 404
        assert exc.value.detail == "Course not found"

    async def test_flush_that_assigns_no_id_is_a_500_not_a_bad_link(
        self, db, chapter, admin_user, mock_request, allow_rbac
    ):
        """Without an id the ChapterActivity link would point at NULL; the
        service refuses instead of writing a dangling row."""
        with patch.object(db, "flush", new=AsyncMock()):
            with pytest.raises(HTTPException) as exc:
                await create_activity(
                    mock_request,
                    ActivityCreate(name="New", chapter_id=chapter.id),
                    admin_user,
                    db,
                )

        assert exc.value.status_code == 500
        assert "could not retrieve activity ID" in exc.value.detail
        allow_rbac.assert_awaited_once()


class TestUpdateActivity:
    async def test_activity_whose_course_is_gone_is_404(
        self, db, activity, admin_user, mock_request
    ):
        await _orphan(db, activity)

        with pytest.raises(HTTPException) as exc:
            await update_activity(
                mock_request, ActivityUpdate(name="Renamed"), activity.activity_uuid,
                admin_user, db,
            )

        assert exc.value.status_code == 404
        assert exc.value.detail == "Course not found"
        await db.refresh(activity)
        assert activity.name == "Test Activity"


class TestDeleteActivity:
    async def test_activity_whose_course_is_gone_is_404(
        self, db, activity, admin_user, mock_request
    ):
        await _orphan(db, activity)

        with pytest.raises(HTTPException) as exc:
            await delete_activity(mock_request, activity.activity_uuid, admin_user, db)

        assert exc.value.status_code == 404
        assert exc.value.detail == "Course not found"

    async def test_activity_missing_its_chapter_link_is_404_and_kept(
        self, db, activity, admin_user, mock_request, allow_rbac
    ):
        """An activity with no ChapterActivity row is reported, not deleted
        half-way (the activity row must survive)."""
        link = (await db.execute(
            select(ChapterActivity).where(ChapterActivity.activity_id == activity.id)
        )).scalars().first()
        await db.delete(link)
        await db.commit()

        with patch(
            "src.services.courses.transfer.storage_utils.delete_storage_directory"
        ) as delete_dir:
            with pytest.raises(HTTPException) as exc:
                await delete_activity(
                    mock_request, activity.activity_uuid, admin_user, db
                )

        assert exc.value.status_code == 404
        assert exc.value.detail == "Activity not found in chapter"
        delete_dir.assert_called_once()
        still_there = (await db.execute(
            select(Activity).where(Activity.id == activity.id)
        )).scalars().first()
        assert still_there is not None


class TestVersioningWithoutCourse:
    """Each versioning read/write resolves the course for its RBAC check."""

    async def test_list_versions(self, db, activity, admin_user, mock_request):
        await _orphan(db, activity)
        with pytest.raises(HTTPException) as exc:
            await get_activity_versions(
                mock_request, activity.activity_uuid, admin_user, db
            )
        assert exc.value.status_code == 404
        assert exc.value.detail == "Course not found"

    async def test_get_version(self, db, activity, admin_user, mock_request):
        await _orphan(db, activity)
        with pytest.raises(HTTPException) as exc:
            await get_activity_version(
                mock_request, activity.activity_uuid, 1, admin_user, db
            )
        assert exc.value.status_code == 404
        assert exc.value.detail == "Course not found"

    async def test_get_state(self, db, activity, admin_user, mock_request):
        await _orphan(db, activity)
        with pytest.raises(HTTPException) as exc:
            await get_activity_state(
                mock_request, activity.activity_uuid, admin_user, db
            )
        assert exc.value.status_code == 404
        assert exc.value.detail == "Course not found"

    async def test_restore_version(self, db, activity, admin_user, mock_request):
        await _orphan(db, activity)
        with pytest.raises(HTTPException) as exc:
            await restore_activity_version(
                mock_request, activity.activity_uuid, 1, admin_user, db
            )
        assert exc.value.status_code == 404
        assert exc.value.detail == "Course not found"
        await db.refresh(activity)
        assert activity.current_version == 1
