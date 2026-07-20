"""DB-level uniqueness for assignment submission rows (concurrent-submit races).

A learner has exactly one AssignmentUserSubmission per (user, assignment) and one
AssignmentTaskSubmission per (user, task). These constraints back the
IntegrityError-recovery paths in create_assignment_submission /
handle_assignment_task_submission that turn a lost race into a reuse/update.
"""

from datetime import datetime

import pytest
from sqlalchemy.exc import IntegrityError

from src.db.courses.assignments import (
    Assignment,
    AssignmentTask,
    AssignmentTaskSubmission,
    AssignmentTaskTypeEnum,
    AssignmentUserSubmission,
    AssignmentUserSubmissionStatus,
    GradingTypeEnum,
)


async def _assignment(db, org, course, chapter, activity):
    a = Assignment(
        title="A", description="d", due_date="2030-01-01", published=True,
        grading_type=GradingTypeEnum.NUMERIC, org_id=org.id, course_id=course.id,
        chapter_id=chapter.id, activity_id=activity.id,
        assignment_uuid="assignment_uniq_test",
        creation_date=str(datetime.now()), update_date=str(datetime.now()),
    )
    db.add(a)
    await db.commit()
    await db.refresh(a)
    return a


def _user_sub(assignment_id, user_id, uuid):
    return AssignmentUserSubmission(
        user_id=user_id, assignment_id=assignment_id, grade=0,
        submission_status=AssignmentUserSubmissionStatus.SUBMITTED, attempt_number=1,
        assignmentusersubmission_uuid=uuid,
        creation_date=str(datetime.now()), update_date=str(datetime.now()),
    )


@pytest.mark.asyncio
async def test_duplicate_user_submission_rejected(db, org, course, chapter, activity, regular_user):
    a = await _assignment(db, org, course, chapter, activity)
    db.add(_user_sub(a.id, regular_user.id, "aus_uniq_1"))
    await db.commit()
    db.add(_user_sub(a.id, regular_user.id, "aus_uniq_2"))
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()


@pytest.mark.asyncio
async def test_duplicate_task_submission_rejected(db, org, course, chapter, activity, regular_user):
    a = await _assignment(db, org, course, chapter, activity)
    task = AssignmentTask(
        title="t", description="d", hint="", reference_file=None,
        assignment_type=AssignmentTaskTypeEnum.SHORT_ANSWER, contents={},
        max_grade_value=100, assignment_id=a.id, org_id=org.id, course_id=course.id,
        chapter_id=chapter.id, activity_id=activity.id,
        assignment_task_uuid="assignmenttask_uniq_test",
        creation_date=str(datetime.now()), update_date=str(datetime.now()),
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)

    def _ts(uuid):
        return AssignmentTaskSubmission(
            assignment_task_submission_uuid=uuid, task_submission={}, grade=0,
            manually_graded=False, task_submission_grade_feedback="",
            assignment_type=AssignmentTaskTypeEnum.SHORT_ANSWER, user_id=regular_user.id,
            activity_id=activity.id, course_id=course.id, chapter_id=chapter.id,
            assignment_task_id=task.id,
            creation_date=str(datetime.now()), update_date=str(datetime.now()),
        )

    db.add(_ts("ats_uniq_1"))
    await db.commit()
    db.add(_ts("ats_uniq_2"))
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()
