"""Shared assignment fixtures for service-layer tests.

Moved here from test_assignments_service.py so multiple test modules (e.g.
test_permissions_edge.py) can reuse them via pytest's conftest auto-discovery
instead of importing fixtures across modules (which trips ruff F811).
"""
from datetime import datetime

import pytest

from src.db.courses.assignments import (
    Assignment,
    AssignmentTask,
    AssignmentTaskSubmission,
    AssignmentTaskTypeEnum,
    AssignmentUserSubmission,
    AssignmentUserSubmissionStatus,
    GradingTypeEnum,
)

@pytest.fixture
async def assignment(db, org, course, chapter, activity):
    a = Assignment(
        id=10,
        title="Test Assignment",
        description="An assignment for testing",
        due_date="2030-01-01",
        published=True,
        grading_type=GradingTypeEnum.NUMERIC,
        auto_grading=False,
        anti_copy_paste=False,
        show_correct_answers=False,
        allow_retries=False,
        max_retries=0,
        org_id=org.id,
        course_id=course.id,
        chapter_id=chapter.id,
        activity_id=activity.id,
        assignment_uuid="assignment_test",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(a)
    await db.commit()
    await db.refresh(a)
    return a


@pytest.fixture
async def assignment_task(db, org, course, chapter, activity, assignment):
    t = AssignmentTask(
        id=20,
        title="Test Task",
        description="A task for testing",
        hint="",
        reference_file=None,
        assignment_type=AssignmentTaskTypeEnum.SHORT_ANSWER,
        contents={"prompt": "What is 2+2?", "correct_answers": ["4"], "match_mode": "exact"},
        max_grade_value=100,
        assignment_id=assignment.id,
        org_id=org.id,
        course_id=course.id,
        chapter_id=chapter.id,
        activity_id=activity.id,
        assignment_task_uuid="assignmenttask_test",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(t)
    await db.commit()
    await db.refresh(t)
    return t


@pytest.fixture
async def user_submission(db, assignment, regular_user):
    sub = AssignmentUserSubmission(
        id=30,
        user_id=regular_user.id,
        assignment_id=assignment.id,
        grade=80,
        submission_status=AssignmentUserSubmissionStatus.SUBMITTED,
        attempt_number=1,
        assignmentusersubmission_uuid="aus_test",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(sub)
    await db.commit()
    await db.refresh(sub)
    return sub


@pytest.fixture
async def graded_submission(db, assignment, regular_user):
    sub = AssignmentUserSubmission(
        id=31,
        user_id=regular_user.id,
        assignment_id=assignment.id,
        grade=85,
        submission_status=AssignmentUserSubmissionStatus.GRADED,
        overall_feedback="Good work",
        attempt_number=1,
        assignmentusersubmission_uuid="aus_graded_test",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(sub)
    await db.commit()
    await db.refresh(sub)
    return sub


@pytest.fixture
async def task_submission(db, assignment_task, regular_user):
    ts = AssignmentTaskSubmission(
        id=40,
        assignment_task_submission_uuid="ats_test",
        task_submission={"answer": "4"},
        grade=100,
        task_submission_grade_feedback="Correct",
        assignment_type=AssignmentTaskTypeEnum.SHORT_ANSWER,
        user_id=regular_user.id,
        activity_id=assignment_task.activity_id,
        course_id=assignment_task.course_id,
        chapter_id=assignment_task.chapter_id,
        assignment_task_id=assignment_task.id,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(ts)
    await db.commit()
    await db.refresh(ts)
    return ts
