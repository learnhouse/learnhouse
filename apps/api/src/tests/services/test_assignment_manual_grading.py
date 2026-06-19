"""
Regression tests for teacher MANUAL grading vs. server-side re-verification.

Bug: ``_apply_grade_and_finalize`` re-verified server-gradable task types
(SHORT_ANSWER, NUMBER_ANSWER, QUIZ, FORM, CODE) on EVERY grading flow. On the
teacher's manual grading path that silently overwrote the instructor's
explicit per-task grade with a grade re-derived from the student's answer — so
a teacher could never award credit the exact-matcher would mark wrong, and the
dashboard "Full/Half/Zero" grade controls had no effect on submit.

Fix: only re-verify on the auto-grade path (``auto_graded=True``). These tests
pin both halves of that contract.
"""

from datetime import datetime

from unittest.mock import AsyncMock, patch

from src.db.courses.assignments import (
    Assignment,
    AssignmentTask,
    AssignmentTaskSubmission,
    AssignmentTaskTypeEnum,
    AssignmentUserSubmission,
    AssignmentUserSubmissionStatus,
    GradingTypeEnum,
)
from src.services.courses.activities.assignments import _apply_grade_and_finalize

_PATCH_DISPATCH = "src.services.courses.activities.assignments.dispatch_webhooks"


async def _setup(db, org, course, chapter, activity, regular_user, *, student_answer, stored_grade):
    """Create an assignment + one SHORT_ANSWER task (correct answer '4', exact)
    plus a student submission whose stored answer / grade we control."""
    assignment = Assignment(
        title="Manual Grade",
        description="x",
        due_date="2030-01-01",
        published=True,
        grading_type=GradingTypeEnum.NUMERIC,
        auto_grading=False,
        org_id=org.id,
        course_id=course.id,
        chapter_id=chapter.id,
        activity_id=activity.id,
        assignment_uuid="assignment_manual_test",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(assignment)
    await db.commit()
    await db.refresh(assignment)

    task = AssignmentTask(
        title="Q1",
        description="What is 2+2?",
        hint="",
        reference_file=None,
        assignment_type=AssignmentTaskTypeEnum.SHORT_ANSWER,
        contents={"correct_answers": ["4"], "match_mode": "exact"},
        max_grade_value=100,
        assignment_id=assignment.id,
        org_id=org.id,
        course_id=course.id,
        chapter_id=chapter.id,
        activity_id=activity.id,
        assignment_task_uuid="assignmenttask_manual_test",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)

    user_submission = AssignmentUserSubmission(
        user_id=regular_user.id,
        assignment_id=assignment.id,
        grade=0,
        submission_status=AssignmentUserSubmissionStatus.SUBMITTED,
        attempt_number=1,
        assignmentusersubmission_uuid="aus_manual_test",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(user_submission)

    task_submission = AssignmentTaskSubmission(
        assignment_task_submission_uuid="ats_manual_test",
        task_submission={"answer": student_answer},
        grade=stored_grade,
        task_submission_grade_feedback="",
        assignment_type=AssignmentTaskTypeEnum.SHORT_ANSWER,
        user_id=regular_user.id,
        activity_id=task.activity_id,
        course_id=task.course_id,
        chapter_id=task.chapter_id,
        assignment_task_id=task.id,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(task_submission)
    await db.commit()
    await db.refresh(user_submission)
    await db.refresh(task_submission)
    return assignment, user_submission


class TestManualGradeOverridePreserved:
    async def test_manual_grade_is_not_overwritten_by_reverification(
        self, db, org, course, chapter, activity, regular_user
    ):
        # Student answered WRONG ("5"), but the teacher manually set the task
        # grade to 100. Manual grading (auto_graded=False) must keep the 100.
        assignment, submission = await _setup(
            db, org, course, chapter, activity, regular_user,
            student_answer="5", stored_grade=100,
        )
        with patch(_PATCH_DISPATCH, new_callable=AsyncMock):
            computed = await _apply_grade_and_finalize(
                assignment=assignment,
                course=course,
                user_id=regular_user.id,
                assignment_user_submission=submission,
                db_session=db,
                overall_feedback="Credit for reasoning",
                auto_graded=False,
            )
        # Teacher's 100 survives (would be 0 if re-verification clobbered it).
        assert computed["grade"] == 100
        assert computed["percentage"] == 100.0
        assert submission.submission_status == AssignmentUserSubmissionStatus.GRADED
        assert submission.overall_feedback == "Credit for reasoning"


class TestAutoGradeStillReverifies:
    async def test_auto_grade_overwrites_tampered_grade(
        self, db, org, course, chapter, activity, regular_user
    ):
        # Same WRONG answer ("5") with a tampered stored grade of 100. On the
        # auto-grade path the server must re-verify and award 0.
        assignment, submission = await _setup(
            db, org, course, chapter, activity, regular_user,
            student_answer="5", stored_grade=100,
        )
        with patch(_PATCH_DISPATCH, new_callable=AsyncMock):
            computed = await _apply_grade_and_finalize(
                assignment=assignment,
                course=course,
                user_id=regular_user.id,
                assignment_user_submission=submission,
                db_session=db,
                auto_graded=True,
            )
        assert computed["grade"] == 0
        assert computed["percentage"] == 0.0

    async def test_auto_grade_awards_correct_answer(
        self, db, org, course, chapter, activity, regular_user
    ):
        # Correct answer ("4") with stored grade 0 (client saves 0): auto-grade
        # re-verification must compute the real 100.
        assignment, submission = await _setup(
            db, org, course, chapter, activity, regular_user,
            student_answer="4", stored_grade=0,
        )
        with patch(_PATCH_DISPATCH, new_callable=AsyncMock):
            computed = await _apply_grade_and_finalize(
                assignment=assignment,
                course=course,
                user_id=regular_user.id,
                assignment_user_submission=submission,
                db_session=db,
                auto_graded=True,
            )
        assert computed["grade"] == 100
        assert computed["percentage"] == 100.0
