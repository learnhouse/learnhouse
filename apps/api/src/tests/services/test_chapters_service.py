"""Tests for src/services/courses/chapters.py."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.courses.activities import Activity, ActivityLockType, ActivityRead, ActivitySubTypeEnum, ActivityTypeEnum
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.chapters import Chapter, ChapterCreate, ChapterRead, ChapterUpdate, ChapterUpdateOrder, LockType
from src.db.courses.course_chapters import CourseChapter
from src.db.courses.courses import Course
from src.services.courses.chapters import (
    DEPRECEATED_get_course_chapters,
    _apply_locks_to_chapters,
    create_chapter,
    delete_chapter,
    get_chapter,
    get_course_chapters,
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
        link = (await db.execute(
            select(CourseChapter).where(CourseChapter.chapter_id == result.id)
        )).scalars().first()
        assert link is not None
        assert link.order == 2

    @pytest.mark.asyncio
    async def test_create_chapter_missing_course_raises(
        self, db, admin_user, mock_request
    ):
        with patch(
            "src.services.courses.chapters.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc_info:
                await create_chapter(
                    mock_request,
                    ChapterCreate(
                        name="Missing",
                        description="Missing",
                        thumbnail_image="",
                        org_id=1,
                        course_id=999,
                    ),
                    admin_user,
                    db,
                )

        assert exc_info.value.status_code == 404
        assert "Course not found" in exc_info.value.detail


class TestGetChapter:
    @pytest.mark.asyncio
    async def test_get_chapter_missing_course_raises(
        self, db, chapter, admin_user, mock_request
    ):
        chapter.course_id = 999
        db.add(chapter)
        await db.commit()

        with pytest.raises(HTTPException) as exc_info:
            await get_chapter(mock_request, chapter.id, admin_user, db)

        assert exc_info.value.status_code == 404
        assert "Course does not exist" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_get_chapter_missing_chapter_raises(
        self, db, admin_user, mock_request
    ):
        with pytest.raises(HTTPException) as exc_info:
            await get_chapter(mock_request, 9999, admin_user, db)

        assert exc_info.value.status_code == 404
        assert "Chapter does not exist" in exc_info.value.detail


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

    @pytest.mark.asyncio
    async def test_update_chapter_missing_raises(
        self, db, admin_user, mock_request
    ):
        with pytest.raises(HTTPException) as exc_info:
            await update_chapter(
                mock_request,
                ChapterUpdate(name="Missing"),
                9999,
                admin_user,
                db,
            )

        assert exc_info.value.status_code == 404
        assert "Chapter does not exist" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_update_chapter_course_missing_raises(
        self, db, chapter, admin_user, mock_request
    ):
        chapter.course_id = 999
        db.add(chapter)
        await db.commit()

        with patch(
            "src.services.courses.chapters.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc_info:
                await update_chapter(
                    mock_request, ChapterUpdate(name="x"), chapter.id, admin_user, db
                )

        assert exc_info.value.status_code == 404
        assert "Course does not exist" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_update_chapter_cannot_change_org_or_course(
        self, db, org, course, chapter, admin_user, mock_request, activity, other_org
    ):
        """Covers line 172-173: update_chapter skips org_id/course_id keys, so a
        payload carrying them can never re-home a chapter to another org/course."""
        original_org_id = chapter.org_id
        original_course_id = chapter.course_id

        # Use a loose object so org_id/course_id survive into vars() the way a
        # crafted/extra-bearing payload would at runtime. ChapterUpdate forbids
        # these fields, so this is the only way to drive the guard.
        payload = SimpleNamespace(
            name="Renamed Chapter",
            org_id=other_org.id,
            course_id=99999,
            description=None,
            thumbnail_image=None,
            lock_type=None,
            extra_metadata=None,
        )

        with patch(
            "src.services.courses.chapters.check_resource_access",
            new_callable=AsyncMock,
        ):
            result = await update_chapter(
                mock_request, payload, chapter.id, admin_user, db
            )

        # name applied, but org_id/course_id untouched
        assert result.name == "Renamed Chapter"
        await db.refresh(chapter)
        assert chapter.org_id == original_org_id
        assert chapter.course_id == original_course_id
        assert chapter.org_id != other_org.id
        assert chapter.course_id != 99999


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
        assert (await db.execute(select(Chapter).where(Chapter.id == chapter.id))).scalars().first() is None
        assert (
            (await db.execute(
                select(ChapterActivity).where(ChapterActivity.chapter_id == chapter.id)
            )).scalars().all()
            == []
        )

    @pytest.mark.asyncio
    async def test_delete_chapter_missing_raises(
        self, db, admin_user, mock_request
    ):
        with pytest.raises(HTTPException) as exc_info:
            await delete_chapter(mock_request, "9999", admin_user, db)

        assert exc_info.value.status_code == 404
        assert "Chapter does not exist" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_delete_chapter_course_missing_raises(
        self, db, chapter, admin_user, mock_request
    ):
        chapter.course_id = 999
        db.add(chapter)
        await db.commit()

        with patch(
            "src.services.courses.chapters.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc_info:
                await delete_chapter(mock_request, chapter.id, admin_user, db)

        assert exc_info.value.status_code == 404
        assert "Course not found" in exc_info.value.detail


class TestCourseChapters:
    @pytest.mark.asyncio
    async def test_get_course_chapters_slim_full_and_deprecated_paths(
        self, db, course, chapter, activity, admin_user, mock_request
    ):
        second_chapter = Chapter(
            name="Second Chapter",
            description="",
            thumbnail_image="",
            org_id=course.org_id,
            course_id=course.id,
            chapter_uuid="chapter_second",
            creation_date="2024-01-01",
            update_date="2024-01-01",
        )
        db.add(second_chapter)
        await db.commit()
        await db.refresh(second_chapter)

        db.add(
            CourseChapter(
                chapter_id=second_chapter.id,
                course_id=course.id,
                org_id=course.org_id,
                order=2,
                creation_date="2024-01-01",
                update_date="2024-01-01",
            )
        )
        await db.commit()

        second_activity = Activity(
            name="Second Activity",
            activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
            activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
            content={"body": "content"},
            details=None,
            published=False,
            org_id=course.org_id,
            course_id=course.id,
            activity_uuid="activity_second",
            creation_date="2024-01-01",
            update_date="2024-01-01",
            current_version=1,
            last_modified_by_id=admin_user.id,
        )
        db.add(second_activity)
        await db.commit()
        await db.refresh(second_activity)

        # Link second_activity to second_chapter (chapter+activity link is set
        # up by the `activity` fixture). The unique constraint on
        # (chapter_id, activity_id) prevents truly-duplicate inserts.
        db.add(
            ChapterActivity(
                chapter_id=second_chapter.id,
                activity_id=second_activity.id,
                course_id=course.id,
                org_id=course.org_id,
                order=0,
                creation_date="2024-01-01",
                update_date="2024-01-01",
            )
        )
        await db.commit()

        slim_result = await get_course_chapters(
            mock_request,
            course.id,
            db,
            admin_user,
            with_unpublished_activities=False,
            slim=True,
            course=course,
        )
        full_result = await get_course_chapters(
            mock_request,
            course.id,
            db,
            admin_user,
            with_unpublished_activities=True,
            slim=False,
            course=course,
        )

        assert len(slim_result) == 2
        assert len(full_result) == 2
        assert slim_result[0].activities[0].activity_uuid == activity.activity_uuid
        assert full_result[0].activities[0].activity_uuid == activity.activity_uuid
        assert full_result[1].activities[0].activity_uuid == second_activity.activity_uuid

        courseless = await get_course_chapters(
            mock_request,
            course.id,
            db,
            admin_user,
            with_unpublished_activities=False,
            slim=False,
        )
        assert len(courseless) == 2

        with patch(
            "src.services.courses.chapters.get_course_chapters",
            new_callable=AsyncMock,
            return_value=[
                SimpleNamespace(
                    chapter_uuid=chapter.chapter_uuid,
                    id=chapter.id,
                    name=chapter.name,
                    activities=[SimpleNamespace(activity_uuid=activity.activity_uuid)],
                )
            ],
        ):
            legacy_result = await DEPRECEATED_get_course_chapters(
                mock_request,
                course.course_uuid,
                admin_user,
                db,
            )
        assert legacy_result["chapterOrder"][0] == chapter.chapter_uuid
        assert activity.activity_uuid in legacy_result["activities"]

    @pytest.mark.asyncio
    async def test_get_course_chapters_missing_course_raises_404(
        self, db, admin_user, mock_request
    ):
        # chapters.py:251 - when no `course` is supplied and the course_id does
        # not exist, the lookup returns None and the function must raise a clean
        # 404 instead of dereferencing None (which would 500).
        with pytest.raises(HTTPException) as exc_info:
            await get_course_chapters(
                mock_request,
                999999,
                db,
                admin_user,
                with_unpublished_activities=False,
            )

        assert exc_info.value.status_code == 404

    @pytest.mark.asyncio
    async def test_deprecated_get_course_chapters_missing_course_raises(
        self, db, admin_user, mock_request
    ):
        with pytest.raises(HTTPException) as exc_info:
            await DEPRECEATED_get_course_chapters(
                mock_request, "missing-course", admin_user, db
            )

        assert exc_info.value.status_code == 404
        assert "Course does not exist" in exc_info.value.detail


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
        await db.commit()
        await db.refresh(extra_chapter)

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
        await db.commit()

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
        remaining_chapters = (await db.execute(
            select(CourseChapter).where(CourseChapter.course_id == course.id)
        )).scalars().all()
        assert len(remaining_chapters) == 1
        assert remaining_chapters[0].chapter_id == chapter.id
        remaining_activities = (await db.execute(
            select(ChapterActivity).where(ChapterActivity.course_id == course.id)
        )).scalars().all()
        assert len(remaining_activities) == 1
        assert remaining_activities[0].chapter_id == chapter.id

    @pytest.mark.asyncio
    async def test_reorder_creates_missing_links(
        self, db, org, course, chapter, activity, admin_user, mock_request
    ):
        third_chapter = Chapter(
            name="Third Chapter",
            description="",
            thumbnail_image="",
            org_id=org.id,
            course_id=course.id,
            chapter_uuid="chapter_third",
            creation_date="2024-01-01",
            update_date="2024-01-01",
        )
        db.add(third_chapter)
        await db.commit()
        await db.refresh(third_chapter)

        third_activity = Activity(
            name="Third Activity",
            activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
            activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
            content={"type": "doc", "content": []},
            published=True,
            org_id=org.id,
            course_id=course.id,
            activity_uuid="activity_third",
            creation_date="2024-01-01",
            update_date="2024-01-01",
            current_version=1,
        )
        db.add(third_activity)
        await db.commit()
        await db.refresh(third_activity)

        payload = ChapterUpdateOrder.model_validate(
            {
                "chapter_order_by_ids": [
                    {
                        "chapter_id": chapter.id,
                        "activities_order_by_ids": [
                            {"activity_id": activity.id},
                        ],
                    },
                    {
                        "chapter_id": third_chapter.id,
                        "activities_order_by_ids": [
                            {"activity_id": third_activity.id},
                        ],
                    },
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
        new_course_chapter = (await db.execute(
            select(CourseChapter).where(CourseChapter.chapter_id == third_chapter.id)
        )).scalars().first()
        assert new_course_chapter is not None
        new_chapter_activity = (await db.execute(
            select(ChapterActivity).where(ChapterActivity.activity_id == third_activity.id)
        )).scalars().first()
        assert new_chapter_activity is not None

    @pytest.mark.asyncio
    async def test_reorder_rejects_chapter_from_another_course(
        self, db, org, other_org, course, chapter, activity, admin_user, mock_request
    ):
        """Covers line 586-590: a chapter that has no link to this course AND is
        owned by a different course/org must be rejected with 400."""
        foreign_course = Course(
            id=777,
            name="Foreign Course",
            description="",
            public=True,
            published=True,
            open_to_contributors=False,
            org_id=other_org.id,
            course_uuid="course_foreign",
            creation_date="2024-01-01",
            update_date="2024-01-01",
        )
        db.add(foreign_course)
        await db.commit()
        await db.refresh(foreign_course)

        foreign_chapter = Chapter(
            name="Foreign Chapter",
            description="",
            thumbnail_image="",
            org_id=other_org.id,
            course_id=foreign_course.id,
            chapter_uuid="chapter_foreign",
            creation_date="2024-01-01",
            update_date="2024-01-01",
        )
        db.add(foreign_chapter)
        await db.commit()
        await db.refresh(foreign_chapter)

        payload = ChapterUpdateOrder.model_validate(
            {
                "chapter_order_by_ids": [
                    {
                        "chapter_id": foreign_chapter.id,
                        "activities_order_by_ids": [],
                    }
                ]
            }
        )

        with patch(
            "src.services.courses.chapters.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc_info:
                await reorder_chapters_and_activities(
                    mock_request, course.course_uuid, payload, admin_user, db
                )

        assert exc_info.value.status_code == 400
        assert "not part of this course" in exc_info.value.detail
        # No link should have been created for the foreign chapter.
        link = (await db.execute(
            select(CourseChapter).where(
                CourseChapter.chapter_id == foreign_chapter.id,
                CourseChapter.course_id == course.id,
            )
        )).scalars().first()
        assert link is None

    @pytest.mark.asyncio
    async def test_reorder_rejects_activity_from_another_course(
        self, db, org, other_org, course, chapter, activity, admin_user, mock_request
    ):
        """Covers line 654-667: an activity owned by a different course/org that
        is being linked under a valid chapter must be rejected with 400."""
        foreign_course = Course(
            id=778,
            name="Foreign Course 2",
            description="",
            public=True,
            published=True,
            open_to_contributors=False,
            org_id=other_org.id,
            course_uuid="course_foreign2",
            creation_date="2024-01-01",
            update_date="2024-01-01",
        )
        db.add(foreign_course)
        await db.commit()
        await db.refresh(foreign_course)

        foreign_activity = Activity(
            name="Foreign Activity",
            activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
            activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
            content={"type": "doc", "content": []},
            published=True,
            org_id=other_org.id,
            course_id=foreign_course.id,
            activity_uuid="activity_foreign",
            creation_date="2024-01-01",
            update_date="2024-01-01",
            current_version=1,
        )
        db.add(foreign_activity)
        await db.commit()
        await db.refresh(foreign_activity)

        # The chapter IS valid for this course, but the activity is foreign.
        payload = ChapterUpdateOrder.model_validate(
            {
                "chapter_order_by_ids": [
                    {
                        "chapter_id": chapter.id,
                        "activities_order_by_ids": [
                            {"activity_id": foreign_activity.id},
                        ],
                    }
                ]
            }
        )

        with patch(
            "src.services.courses.chapters.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc_info:
                await reorder_chapters_and_activities(
                    mock_request, course.course_uuid, payload, admin_user, db
                )

        assert exc_info.value.status_code == 400
        assert "not part of this course" in exc_info.value.detail
        link = (await db.execute(
            select(ChapterActivity).where(
                ChapterActivity.activity_id == foreign_activity.id,
                ChapterActivity.course_id == course.id,
            )
        )).scalars().first()
        assert link is None

    @pytest.mark.asyncio
    async def test_reorder_missing_course_raises(
        self, db, admin_user, mock_request
    ):
        payload = ChapterUpdateOrder.model_validate(
            {"chapter_order_by_ids": []}
        )

        with pytest.raises(HTTPException) as exc_info:
            await reorder_chapters_and_activities(
                mock_request, "missing-course", payload, admin_user, db
            )

        assert exc_info.value.status_code == 404
        assert "Course does not exist" in exc_info.value.detail


class TestApplyLocksToChapters:
    def _make_chapter_read(self, chapter_uuid: str, lock_type: LockType, activities=None) -> ChapterRead:
        return ChapterRead(
            id=1,
            name="Test Chapter",
            description="desc",
            thumbnail_image="thumb.png",
            org_id=1,
            course_id=1,
            chapter_uuid=chapter_uuid,
            lock_type=lock_type,
            activities=activities or [],
            creation_date="2024-01-01",
            update_date="2024-01-01",
        )

    def _make_activity_read(self, activity_uuid: str, lock_type: ActivityLockType) -> ActivityRead:
        return ActivityRead(
            id=1,
            name="Test Activity",
            activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
            activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
            content={"body": "secret"},
            details={"key": "val"},
            published=True,
            lock_type=lock_type,
            org_id=1,
            course_id=1,
            activity_uuid=activity_uuid,
            creation_date="2024-01-01",
            update_date="2024-01-01",
        )

    @pytest.mark.asyncio
    async def test_anonymous_user_locked_out_of_restricted_chapters(
        self, db, course, anonymous_user
    ):
        """Lines 394-398, 420-422, 440-442: restricted lock_type → uuid collected;
        anonymous user → chapter+activity locked and content stripped."""
        activity = self._make_activity_read("act_restricted", ActivityLockType.RESTRICTED)
        chapter = self._make_chapter_read(
            "ch_restricted", LockType.RESTRICTED, activities=[activity]
        )

        await _apply_locks_to_chapters([chapter], course, anonymous_user, db)

        assert chapter.is_locked is True
        assert chapter.description == ""
        assert chapter.thumbnail_image == ""
        assert activity.is_locked is True
        assert activity.content == {}
        assert activity.details is None

    @pytest.mark.asyncio
    async def test_course_grants_access_unlocks_activities(
        self, db, org, course, regular_user
    ):
        """Lines 426-428: when the course uuid is in the accessible set,
        course_grants_access=True → activity_locked=False even if activity is restricted."""
        from datetime import datetime
        from src.db.usergroups import UserGroup
        from src.db.usergroup_resources import UserGroupResource
        from src.db.usergroup_user import UserGroupUser

        ug = UserGroup(
            org_id=org.id,
            name="CourseAccessGroup",
            description="",
            usergroup_uuid="ug_course_access",
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(ug)
        await db.commit()
        await db.refresh(ug)

        # Grant access to the course_uuid itself → course_grants_access=True
        ugr = UserGroupResource(
            usergroup_id=ug.id,
            resource_uuid=course.course_uuid,
            org_id=org.id,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(ugr)
        await db.commit()

        ugu = UserGroupUser(
            usergroup_id=ug.id,
            user_id=regular_user.id,
            org_id=org.id,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(ugu)
        await db.commit()

        activity = self._make_activity_read("act_restricted_course", ActivityLockType.RESTRICTED)
        chapter = self._make_chapter_read(
            "ch_public_course", LockType.PUBLIC, activities=[activity]
        )

        await _apply_locks_to_chapters([chapter], course, regular_user, db)

        # course_grants_access=True → activity must NOT be locked (line 427-428)
        assert chapter.is_locked is False
        assert activity.is_locked is False

    @pytest.mark.asyncio
    async def test_get_course_chapters_dedup_slim_and_full(
        self, db, course, chapter, activity, admin_user, mock_request
    ):
        """Cover lines 313 (slim dedup) and 351 (full dedup) by injecting duplicate rows."""
        from unittest.mock import MagicMock

        original_execute = db.execute

        # slim=True path → line 313
        slim_call = {"n": 0}
        dup_row = (
            chapter.id, activity.id, activity.org_id, activity.course_id,
            activity.name, activity.activity_type, activity.activity_sub_type,
            activity.activity_uuid, activity.published,
            activity.creation_date, activity.update_date,
            1, None, activity.lock_type, 1,
        )
        async def execute_with_slim_dupes(statement):
            slim_call["n"] += 1
            if slim_call["n"] == 2:  # activity query is second execute call
                result = MagicMock()
                result.all.return_value = [dup_row, dup_row]
                return result
            return await original_execute(statement)

        with patch("src.services.courses.chapters.check_resource_access", new_callable=AsyncMock):
            with patch.object(db, "execute", side_effect=execute_with_slim_dupes):
                slim_result = await get_course_chapters(
                    mock_request, course.id, db, admin_user,
                    with_unpublished_activities=True, slim=True, course=course,
                )
        assert len(slim_result[0].activities) == 1

        # slim=False path → line 351
        full_call = {"n": 0}
        async def execute_with_full_dupes(statement):
            full_call["n"] += 1
            if full_call["n"] == 2:  # activity query is second execute call
                ca_mock = MagicMock()
                ca_mock.chapter_id = chapter.id
                result = MagicMock()
                result.all.return_value = [(ca_mock, activity), (ca_mock, activity)]
                return result
            return await original_execute(statement)

        with patch("src.services.courses.chapters.check_resource_access", new_callable=AsyncMock):
            with patch.object(db, "execute", side_effect=execute_with_full_dupes):
                full_result = await get_course_chapters(
                    mock_request, course.id, db, admin_user,
                    with_unpublished_activities=True, slim=False, course=course,
                )
        assert len(full_result[0].activities) == 1
