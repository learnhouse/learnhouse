"""Assignment content gates: the course assignment list applies the activity
reader gate, create_assignment derives chapter_id from the activity, and the
model-answer file under /content follows the assignment's reveal rule.
"""

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from src.db.courses.activities import Activity, ActivitySubTypeEnum, ActivityTypeEnum
from src.db.courses.assignments import (
    Assignment,
    AssignmentCreate,
    AssignmentUserSubmission,
    AssignmentUserSubmissionStatus,
    GradingTypeEnum,
    SolutionRevealEnum,
)
from src.routers import content_files, local_content
from src.services.courses.activities.assignments import (
    create_assignment,
    get_assignments_from_course,
)


def _now():
    return str(datetime.now())


def _assignment(org, course, chapter, activity, uuid, **kw):
    return Assignment(
        title=uuid, description="", published=True, grading_type=GradingTypeEnum.NUMERIC,
        org_id=org.id, course_id=course.id, chapter_id=chapter.id, activity_id=activity.id,
        assignment_uuid=uuid, creation_date=_now(), update_date=_now(), **kw,
    )


@pytest.mark.asyncio
async def test_course_assignment_list_hides_draft_activities_from_learners(
    db, org, course, chapter, activity, admin_user, regular_user, mock_request
):
    draft = Activity(
        id=2, name="Draft", activity_type=ActivityTypeEnum.TYPE_ASSIGNMENT,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_ASSIGNMENT_ANY, content={},
        published=False, org_id=org.id, course_id=course.id, activity_uuid="activity_draft",
        creation_date=_now(), update_date=_now(),
    )
    db.add(draft)
    await db.commit()
    db.add(_assignment(org, course, chapter, activity, "assignment_live"))
    db.add(_assignment(org, course, chapter, draft, "assignment_next_week"))
    await db.commit()

    learner = await get_assignments_from_course(mock_request, course.course_uuid, regular_user, db)
    teacher = await get_assignments_from_course(mock_request, course.course_uuid, admin_user, db)

    assert [a.assignment_uuid for a in learner] == ["assignment_live"]
    assert {a.assignment_uuid for a in teacher} == {"assignment_live", "assignment_next_week"}


@pytest.mark.asyncio
async def test_create_assignment_takes_chapter_from_activity(
    db, org, course, chapter, activity, admin_user, mock_request
):
    body = AssignmentCreate(
        title="t", description="", grading_type=GradingTypeEnum.NUMERIC,
        org_id=org.id, course_id=course.id, chapter_id=9999, activity_id=activity.id,
    )
    with patch(
        "src.services.courses.activities.assignments.check_limits_with_usage", new_callable=AsyncMock
    ), patch(
        "src.services.courses.activities.assignments.increase_feature_usage", new_callable=AsyncMock
    ):
        created = await create_assignment(mock_request, body, admin_user, db)

    row = await db.get(Assignment, created.id)
    assert row.chapter_id == chapter.id


SOLUTION_PATH = (
    "orgs/org_test/courses/course_test/activities/activity_test/"
    "assignments/assignment_corrige/solution/solution_abc.pdf"
)


@pytest.mark.asyncio
@pytest.mark.parametrize("router", [content_files, local_content])
async def test_solution_file_follows_reveal_rule(
    router, db, org, course, chapter, activity, admin_user, regular_user, mock_request
):
    assignment = _assignment(
        org, course, chapter, activity, "assignment_corrige",
        solution_file="solution_abc.pdf", solution_reveal=SolutionRevealEnum.ON_SUBMISSION,
    )
    db.add(assignment)
    await db.commit()
    await db.refresh(assignment)

    # No submission yet: the learner can open the activity but not the corrige
    with pytest.raises(HTTPException) as exc:
        await router._check_content_access(SOLUTION_PATH, regular_user, db, request=mock_request)
    assert exc.value.status_code == 403

    # Instructors always can; it's a gated (not shared-cacheable) file
    assert await router._check_content_access(
        SOLUTION_PATH, admin_user, db, request=mock_request
    ) is False

    db.add(AssignmentUserSubmission(
        user_id=regular_user.id, assignment_id=assignment.id, grade=0,
        submission_status=AssignmentUserSubmissionStatus.SUBMITTED,
        assignmentusersubmission_uuid="aus_corrige", creation_date=_now(), update_date=_now(),
    ))
    await db.commit()
    assert await router._check_content_access(
        SOLUTION_PATH, regular_user, db, request=mock_request
    ) is False


@pytest.mark.asyncio
@pytest.mark.parametrize("router", [content_files, local_content])
async def test_only_public_by_design_paths_are_shared_cacheable(router, db, org, anonymous_user):
    assert await router._check_content_access("orgs/org_test/logos/logo.png", anonymous_user, db) is True
    assert await router._check_content_access("users/user_x/avatars/a.png", anonymous_user, db) is True
    assert router.content_cache_control(False).startswith("private")
