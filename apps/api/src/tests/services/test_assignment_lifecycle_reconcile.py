"""Regrade + certificate reconciliation when a task or task submission changes.

Editing a task's scoring definition, or deleting a per-task submission, changes
the aggregate grade already stored for a GRADED assignment submission. These
paths must re-grade (and reconcile certificates), the same way deleting a whole
task already did.
"""

from datetime import datetime
from unittest.mock import AsyncMock, patch

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
from src.db.courses.assignments import AssignmentTaskUpdate
from src.services.courses.activities.assignments import (
    _apply_grade_and_finalize,
    delete_assignment_task_submission,
    update_assignment_task,
)

_AUTHZ = "src.services.courses.activities.assignments.authorize_assignment_access"
_RBAC = "src.services.courses.activities.assignments.check_resource_access"


async def _seed_graded(db, org, course, chapter, activity, user, *, answer="4", correct="4"):
    a = Assignment(
        title="A", description="x", due_date="2030-01-01", published=True,
        grading_type=GradingTypeEnum.NUMERIC, auto_grading=True,
        org_id=org.id, course_id=course.id, chapter_id=chapter.id, activity_id=activity.id,
        assignment_uuid="assignment_recon", creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(a)
    await db.commit()
    await db.refresh(a)
    task = AssignmentTask(
        title="Q", description="d", hint="", reference_file=None,
        assignment_type=AssignmentTaskTypeEnum.SHORT_ANSWER,
        contents={"correct_answers": [correct], "match_mode": "exact"},
        max_grade_value=100, assignment_id=a.id, org_id=org.id, course_id=course.id,
        chapter_id=chapter.id, activity_id=activity.id,
        assignment_task_uuid="assignmenttask_recon",
        creation_date=str(datetime.now()), update_date=str(datetime.now()),
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)
    us = AssignmentUserSubmission(
        user_id=user.id, assignment_id=a.id, grade=0,
        submission_status=AssignmentUserSubmissionStatus.SUBMITTED, attempt_number=1,
        assignmentusersubmission_uuid="aus_recon",
        creation_date=str(datetime.now()), update_date=str(datetime.now()),
    )
    db.add(us)
    ts = AssignmentTaskSubmission(
        assignment_task_submission_uuid="ats_recon",
        task_submission={"answer": answer}, grade=0, manually_graded=False,
        task_submission_grade_feedback="",
        assignment_type=AssignmentTaskTypeEnum.SHORT_ANSWER,
        user_id=user.id, activity_id=task.activity_id, course_id=task.course_id,
        chapter_id=task.chapter_id, assignment_task_id=task.id,
        creation_date=str(datetime.now()), update_date=str(datetime.now()),
    )
    db.add(ts)
    await db.commit()
    await db.refresh(us)
    await db.refresh(task)
    await db.refresh(ts)
    # Grade it now (answer matches -> 100).
    with patch("src.services.courses.activities.assignments.dispatch_webhooks", new_callable=AsyncMock):
        await _apply_grade_and_finalize(
            assignment=a, course=course, user_id=user.id,
            assignment_user_submission=us, db_session=db, auto_graded=True,
        )
    await db.refresh(us)
    return a, task, us, ts


class TestUpdateTaskRegrades:
    @pytest.mark.asyncio
    async def test_changing_answer_key_regrades_graded_submission(
        self, mock_request, db, org, course, chapter, activity, regular_user, admin_user
    ):
        a, task, us, ts = await _seed_graded(db, org, course, chapter, activity, regular_user)
        assert us.grade == 100  # answered correctly

        # Move the correct answer so the same student answer is now wrong.
        with patch(_AUTHZ, new_callable=AsyncMock):
            await update_assignment_task(
                mock_request, task.assignment_task_uuid,
                AssignmentTaskUpdate(contents={"correct_answers": ["5"], "match_mode": "exact"}),
                admin_user, db,
            )
        await db.refresh(us)
        assert us.grade == 0  # re-graded against the new key

    @pytest.mark.asyncio
    async def test_non_scoring_edit_does_not_regrade(
        self, mock_request, db, org, course, chapter, activity, regular_user, admin_user
    ):
        a, task, us, ts = await _seed_graded(db, org, course, chapter, activity, regular_user)
        assert us.grade == 100
        with patch(_AUTHZ, new_callable=AsyncMock), patch(
            "src.services.courses.activities.assignments._regrade_graded_submissions",
            new_callable=AsyncMock,
        ) as regrade:
            await update_assignment_task(
                mock_request, task.assignment_task_uuid,
                AssignmentTaskUpdate(title="Renamed", description="new"),
                admin_user, db,
            )
        regrade.assert_not_called()


class TestDeleteTaskSubmissionReconciles:
    @pytest.mark.asyncio
    async def test_deleting_task_submission_recomputes_aggregate(
        self, mock_request, db, org, course, chapter, activity, regular_user, admin_user
    ):
        a, task, us, ts = await _seed_graded(db, org, course, chapter, activity, regular_user)
        assert us.grade == 100

        with patch(_RBAC, new_callable=AsyncMock):
            await delete_assignment_task_submission(
                mock_request, ts.assignment_task_submission_uuid, admin_user, db,
            )
        await db.refresh(us)
        # The graded aggregate no longer counts the deleted answer.
        assert us.grade == 0


class TestReconcileCertificateAfterGradeChange:
    """The reconcile helper revokes when a regrade drops a learner below the
    threshold and reissues when it lifts them above."""

    @pytest.mark.asyncio
    async def test_revokes_when_no_longer_passing(self, mock_request, db, org, course):
        from src.services.courses.activities import assignments as ag
        with patch.object(ag, "are_course_assignments_passed", new=AsyncMock(return_value=False)), \
             patch.object(ag, "revoke_user_certificate", new_callable=AsyncMock) as revoke, \
             patch.object(ag, "sync_trailrun_status", new_callable=AsyncMock) as sync, \
             patch.object(ag, "check_course_completion_and_create_certificate", new_callable=AsyncMock) as issue:
            await ag._reconcile_certificate_after_grade_change(mock_request, 7, course, db)
        revoke.assert_awaited_once()
        sync.assert_awaited_once()
        issue.assert_not_called()

    @pytest.mark.asyncio
    async def test_reissues_when_now_passing(self, mock_request, db, org, course):
        from src.services.courses.activities import assignments as ag
        with patch.object(ag, "are_course_assignments_passed", new=AsyncMock(return_value=True)), \
             patch.object(ag, "revoke_user_certificate", new_callable=AsyncMock) as revoke, \
             patch.object(ag, "check_course_completion_and_create_certificate", new_callable=AsyncMock) as issue:
            await ag._reconcile_certificate_after_grade_change(mock_request, 7, course, db)
        issue.assert_awaited_once()
        revoke.assert_not_called()

    @pytest.mark.asyncio
    async def test_swallows_errors(self, mock_request, db, org, course):
        # Best-effort: a failure in the eligibility check must not propagate.
        from src.services.courses.activities import assignments as ag
        with patch.object(ag, "are_course_assignments_passed",
                          new=AsyncMock(side_effect=RuntimeError("boom"))):
            await ag._reconcile_certificate_after_grade_change(mock_request, 7, course, db)


class TestRegradeIsBestEffort:
    @pytest.mark.asyncio
    async def test_one_learner_failure_does_not_abort_the_rest(
        self, mock_request, db, org, course, chapter, activity, regular_user
    ):
        # A regrade that throws for one submission is logged and skipped, never
        # aborting the teacher's edit or the remaining learners.
        from src.services.courses.activities import assignments as ag
        a, task, us, ts = await _seed_graded(db, org, course, chapter, activity, regular_user)
        with patch.object(ag, "_apply_grade_and_finalize",
                          new=AsyncMock(side_effect=RuntimeError("boom"))), \
             patch.object(ag, "_reconcile_certificate_after_grade_change",
                          new_callable=AsyncMock) as reconcile:
            await ag._regrade_graded_submissions(
                assignment=a, course=course, db_session=db, request=mock_request
            )
        # Reconcile is skipped for the failed learner (the `continue` path).
        reconcile.assert_not_called()
