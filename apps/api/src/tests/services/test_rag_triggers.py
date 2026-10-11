"""Content changes schedule re-indexing of exactly what they touched."""

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest

from src.db.courses.activities import ActivityCreate, ActivitySubTypeEnum, ActivityTypeEnum
from src.db.courses.assignments import (
    Assignment,
    AssignmentTaskCreate,
    AssignmentTaskTypeEnum,
    GradingTypeEnum,
)
from src.db.courses.chapters import ChapterCreate, ChapterUpdate
from src.db.courses.courses import CourseUpdate
from src.services.ai.rag.types import ContentRef
from src.services.courses import chapters as chapters_service
from src.services.courses import courses as courses_service
from src.services.courses.activities import activities as activities_service
from src.services.courses.activities import assignments as assignments_service


def _scheduled(rag_dispatch) -> set[ContentRef]:
    return {c.args[0] for c in rag_dispatch.call_args_list}


@pytest.fixture
def allow():
    """Bypass RBAC in every service touched here."""
    targets = [
        "src.services.courses.chapters.check_resource_access",
        "src.services.courses.courses.check_resource_access",
        "src.services.courses.activities.activities.check_resource_access",
        "src.services.courses.activities.assignments.authorize_assignment_access",
    ]
    patches = [patch(t, new_callable=AsyncMock) for t in targets]
    for p in patches:
        p.start()
    yield
    for p in patches:
        p.stop()


class TestActivityTriggers:
    async def test_create_activity(self, mock_request, db, org, course, chapter, admin_user, rag_dispatch, allow):
        with patch.object(activities_service, "check_limits_with_usage", new=AsyncMock(), create=True), \
             patch.object(activities_service, "increase_feature_usage", new=AsyncMock(), create=True):
            created = await activities_service.create_activity(
                mock_request,
                ActivityCreate(
                    name="New page", chapter_id=chapter.id,
                    activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
                    activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
                    content={}, published=True,
                ),
                admin_user, db,
            )
        assert _scheduled(rag_dispatch) == {ContentRef.activity(created.id)}
        # An edit or new page never spends credits on transcription.
        assert rag_dispatch.call_args.args[2] is False


class TestCourseTriggers:
    async def test_update_course_reindexes_course_text(
        self, mock_request, db, org, course, admin_user, rag_dispatch, allow
    ):
        with patch.object(courses_service, "dispatch_webhooks", new=AsyncMock(), create=True):
            await courses_service.update_course(
                mock_request, CourseUpdate(description="New description"), course.course_uuid, admin_user, db
            )
        assert ContentRef.course(course.id) in _scheduled(rag_dispatch)

    async def test_create_chapter(self, mock_request, db, org, course, admin_user, rag_dispatch, allow):
        await chapters_service.create_chapter(
            mock_request,
            ChapterCreate(name="Week 2", description="", org_id=org.id, course_id=course.id),
            admin_user, db,
        )
        assert _scheduled(rag_dispatch) == {ContentRef.course(course.id)}

    async def test_renaming_a_chapter_reindexes_its_activities(
        self, mock_request, db, org, course, chapter, activity, admin_user, rag_dispatch, allow
    ):
        await chapters_service.update_chapter(
            mock_request, ChapterUpdate(name="Renamed"), chapter.id, admin_user, db
        )
        assert _scheduled(rag_dispatch) == {ContentRef.course(course.id), ContentRef.activity(activity.id)}

    async def test_delete_chapter(
        self, mock_request, db, org, course, chapter, activity, admin_user, rag_dispatch, allow
    ):
        await chapters_service.delete_chapter(mock_request, chapter.id, admin_user, db)
        assert ContentRef.course(course.id) in _scheduled(rag_dispatch)


class TestAssignmentTriggers:
    async def test_task_changes_reindex_the_assignment_activity(
        self, mock_request, db, org, course, chapter, activity, admin_user, rag_dispatch, allow
    ):
        db.add(Assignment(
            id=1, title="Homework", description="", due_date=None, published=True,
            grading_type=GradingTypeEnum.NUMERIC, org_id=org.id, course_id=course.id,
            chapter_id=chapter.id, activity_id=activity.id, assignment_uuid="assignment_1",
            creation_date=str(datetime.now()), update_date=str(datetime.now()),
        ))
        await db.commit()

        task = await assignments_service.create_assignment_task(
            mock_request, "assignment_1",
            AssignmentTaskCreate(
                title="Q1", description="", hint="", assignment_type=AssignmentTaskTypeEnum.QUIZ, contents={},
            ),
            admin_user, db,
        )
        assert _scheduled(rag_dispatch) == {ContentRef.activity(activity.id)}

        rag_dispatch.reset_mock()
        await assignments_service.delete_assignment_task(
            mock_request, task.assignment_task_uuid, admin_user, db
        )
        assert _scheduled(rag_dispatch) == {ContentRef.activity(activity.id)}
