"""Tests for src/services/courses/chapters.py."""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.chapters import Chapter, ChapterCreate, ChapterUpdate, ChapterUpdateOrder
from src.db.courses.course_chapters import CourseChapter
from src.services.courses.chapters import (
    create_chapter,
    delete_chapter,
    get_chapter,
    reorder_chapters_and_activities,
    update_chapter,
)


class TestCreateChapter:
    @pytest.mark.asyncio
    async def test_create_chapter_appends_order(
        self, db, course, chapter, admin_user, mock_request
    ):
        chapter_object = ChapterCreate(
            name="New Chapter",
            description="New chapter description",
            thumbnail_image="",
            org_id=course.org_id,
            course_id=course.id,
        )

        with patch(
            "src.services.courses.chapters.check_resource_access",
            new_callable=AsyncMock,
        ):
            result = await create_chapter(mock_request, chapter_object, admin_user, db)

        assert result.name == "New Chapter"
        link = db.exec(
            select(CourseChapter).where(CourseChapter.chapter_id == result.id)
        ).first()
        assert link is not None
        assert link.order == 2


class TestGetChapter:
    @pytest.mark.asyncio
    async def test_get_chapter_missing_course_raises(
        self, db, chapter, admin_user, mock_request
    ):
        chapter.course_id = 999
        db.add(chapter)
        db.commit()

        with pytest.raises(HTTPException) as exc_info:
            await get_chapter(mock_request, chapter.id, admin_user, db)

        assert exc_info.value.status_code == 409
        assert "Course does not exist" in exc_info.value.detail


class TestUpdateChapter:
    @pytest.mark.asyncio
    async def test_update_chapter_only_updates_provided_fields(
        self, db, chapter, admin_user, mock_request, activity
    ):
        update = ChapterUpdate(name="Updated Chapter")

        with patch(
            "src.services.courses.chapters.check_resource_access",
            new_callable=AsyncMock,
        ):
            result = await update_chapter(
                mock_request, update, chapter.id, admin_user, db
            )

        assert result.name == "Updated Chapter"
        assert result.description == chapter.description
        assert len(result.activities) == 1


class TestDeleteChapter:
    @pytest.mark.asyncio
    async def test_delete_chapter_removes_links(
        self, db, chapter, activity, admin_user, mock_request
    ):
        with patch(
            "src.services.courses.chapters.check_resource_access",
            new_callable=AsyncMock,
        ):
            result = await delete_chapter(mock_request, chapter.id, admin_user, db)

        assert result == {"detail": "chapter deleted"}
        assert db.exec(select(Chapter).where(Chapter.id == chapter.id)).first() is None
        assert (
            db.exec(
                select(ChapterActivity).where(ChapterActivity.chapter_id == chapter.id)
            ).all()
            == []
        )


class TestReorderChaptersAndActivities:
    @pytest.mark.asyncio
    async def test_reorder_updates_creates_and_deletes_links(
        self, db, org, course, chapter, activity, admin_user, mock_request
    ):
        extra_chapter = Chapter(
            name="Extra Chapter",
            description="",
            thumbnail_image="",
            org_id=org.id,
            course_id=course.id,
            chapter_uuid="chapter_extra",
            creation_date="2024-01-01",
            update_date="2024-01-01",
        )
        db.add(extra_chapter)
        db.commit()
        db.refresh(extra_chapter)

        stale_link = CourseChapter(
            chapter_id=extra_chapter.id,
            course_id=course.id,
            org_id=org.id,
            order=5,
            creation_date="2024-01-01",
            update_date="2024-01-01",
        )
        stale_activity_link = ChapterActivity(
            chapter_id=extra_chapter.id,
            activity_id=activity.id,
            course_id=course.id,
            org_id=org.id,
            order=0,
            creation_date="2024-01-01",
            update_date="2024-01-01",
        )
        db.add(stale_link)
        db.add(stale_activity_link)
        db.commit()

        payload = ChapterUpdateOrder.model_validate(
            {
                "chapter_order_by_ids": [
                    {
                        "chapter_id": chapter.id,
                        "activities_order_by_ids": [{"activity_id": activity.id}],
                    }
                ]
            }
        )

        with patch(
            "src.services.courses.chapters.check_resource_access",
            new_callable=AsyncMock,
        ):
            result = await reorder_chapters_and_activities(
                mock_request, course.course_uuid, payload, admin_user, db
            )

        assert result["detail"] == "Chapters and activities reordered successfully"
        remaining_chapters = db.exec(
            select(CourseChapter).where(CourseChapter.course_id == course.id)
        ).all()
        assert len(remaining_chapters) == 1
        assert remaining_chapters[0].chapter_id == chapter.id
        remaining_activities = db.exec(
            select(ChapterActivity).where(ChapterActivity.course_id == course.id)
        ).all()
        assert len(remaining_activities) == 1
        assert remaining_activities[0].chapter_id == chapter.id
