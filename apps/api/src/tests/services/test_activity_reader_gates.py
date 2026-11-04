"""Reader-side gates for activity content.

Covers the branches of the activity access gate and the chapter read that
only trigger for non-editors: a restricted parent chapter locks the activity,
a course_uuid mismatch hides an activity from another course, a redacted read
of a draft 404s, and the chapter tree hides drafts from readers.
"""

from datetime import datetime

import pytest
from fastapi import HTTPException

from src.db.courses.activities import (
    Activity,
    ActivityRead,
    ActivitySubTypeEnum,
    ActivityTypeEnum,
)
from src.db.courses.chapter_activities import ChapterActivity
from src.services.courses.activities.access import (
    apply_activity_lock,
    redact_activity_for_reader,
    verify_activity_reader_access_by_uuid,
)
from src.services.courses.chapters import get_chapter


async def _add_draft_activity(db, org, course, chapter) -> Activity:
    draft = Activity(
        id=2,
        name="Draft Activity",
        activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
        content={"type": "doc", "content": [{"type": "paragraph"}]},
        published=False,
        org_id=org.id,
        course_id=course.id,
        activity_uuid="activity_draft",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(draft)
    await db.commit()
    await db.refresh(draft)
    db.add(
        ChapterActivity(
            order=2,
            chapter_id=chapter.id,
            activity_id=draft.id,
            course_id=course.id,
            org_id=org.id,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
    )
    await db.commit()
    return draft


class TestApplyActivityLock:
    async def test_restricted_parent_chapter_locks_a_public_activity(
        self, db, course, chapter, activity, regular_user
    ):
        """The activity itself is public, but its chapter is restricted to
        user groups the reader is not in, so the content is scrubbed."""
        chapter.lock_type = "restricted"
        db.add(chapter)
        await db.commit()
        read = ActivityRead.model_validate(activity)

        await apply_activity_lock(read, activity, course, regular_user, db)

        assert read.is_locked is True
        assert read.content == {}
        assert read.details is None


class TestVerifyReaderAccessByUuid:
    async def test_activity_from_another_course_is_404(
        self, db, activity, admin_user, mock_request
    ):
        """``courses/{c}/activities/{a}`` must not serve an activity that
        lives in a different course, even to someone who can read both."""
        with pytest.raises(HTTPException) as exc:
            await verify_activity_reader_access_by_uuid(
                mock_request, activity.activity_uuid, admin_user, db,
                course_uuid="course_somewhere_else",
            )

        assert exc.value.status_code == 404
        assert exc.value.detail == "Activity not found"

    async def test_matching_course_passes(self, db, course, activity, admin_user, mock_request):
        found, found_course = await verify_activity_reader_access_by_uuid(
            mock_request, activity.activity_uuid, admin_user, db,
            course_uuid=course.course_uuid,
        )
        assert found.id == activity.id
        assert found_course.id == course.id


class TestRedactActivityForReader:
    async def test_draft_is_404_for_a_reader_who_cannot_edit(
        self, db, org, course, chapter, activity, regular_user, mock_request
    ):
        draft = await _add_draft_activity(db, org, course, chapter)

        with pytest.raises(HTTPException) as exc:
            await redact_activity_for_reader(
                mock_request, ActivityRead.model_validate(draft), draft, course,
                regular_user, db,
            )

        assert exc.value.status_code == 404


class TestGetChapterHidesDrafts:
    async def test_reader_only_sees_published_activities(
        self, db, org, course, chapter, activity, regular_user, mock_request
    ):
        await _add_draft_activity(db, org, course, chapter)

        result = await get_chapter(mock_request, chapter.id, regular_user, db)

        assert [a.activity_uuid for a in result.activities] == [activity.activity_uuid]

    async def test_editor_sees_drafts_too(
        self, db, org, course, chapter, activity, admin_user, mock_request
    ):
        await _add_draft_activity(db, org, course, chapter)

        result = await get_chapter(mock_request, chapter.id, admin_user, db)

        assert sorted(a.activity_uuid for a in result.activities) == [
            "activity_draft",
            activity.activity_uuid,
        ]
