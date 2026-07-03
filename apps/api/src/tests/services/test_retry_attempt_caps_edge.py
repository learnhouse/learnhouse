"""
NET-NEW edge-case tests for the assignment RETRY + attempt-cap +
submission-status-transition logic.

Targets two service functions in
``src/services/courses/activities/assignments.py``:

- ``retry_assignment_submission`` — resets a GRADED submission for another
  attempt. Requires ``allow_retries``; only GRADED rows are retryable; the
  attempt cap (``max_retries=0`` is unlimited, else ``current_attempt`` must
  be strictly < ``max_retries``) is enforced; on success it wipes per-task
  submissions, flips the row to PENDING/grade 0, resets the TrailStep, and
  revokes any issued certificate.
- ``create_assignment_submission`` — transitions a reusable PENDING /
  NOT_SUBMITTED row (left behind by a prior retry) to SUBMITTED, or errors if
  the existing row is already SUBMITTED / GRADED.

These cases are deliberately complementary to
``src/tests/routers/test_assignments_retry.py``. That file already covers:
retry success, allow_retries=False 403, attempt-limit-reached (attempt ==
max) 403, retry of a SUBMITTED row 400, 404s (no submission / missing
assignment / missing course), single unlimited retry, reuse of a
directly-seeded PENDING row, and the SUBMITTED/GRADED create rejections.

What is NEW here and NOT duplicated:
- retry of a PENDING (not SUBMITTED, not GRADED) row -> 400.
- attempt cap WITH ROOM: current_attempt < max_retries -> succeeds and the
  attempt counter increments.
- attempt cap when current_attempt is ABOVE the limit (data drift) -> 403.
- max_retries=0 unlimited across MULTIPLE sequential retries.
- retry deletes MULTIPLE per-task submissions (focused assertion).
- retry resets TrailStep.complete back to False (focused assertion).
- a true END-TO-END chain: GRADED -> retry -> PENDING -> create -> SUBMITTED
  reusing the same row (the existing test seeds PENDING directly; here the
  PENDING state is produced by the real retry function).
- create reuses a NOT_SUBMITTED row (the other reusable state).
- both functions block APITokenUser callers (_block_api_tokens, 403).

All tests are async. ``check_resource_access``, webhooks/track, and the
certificate-completion helper are patched to keep these unit-level.
"""

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.courses.assignments import (
    Assignment,
    AssignmentTask,
    AssignmentTaskSubmission,
    AssignmentTaskTypeEnum,
    AssignmentUserSubmission,
    AssignmentUserSubmissionStatus,
    GradingTypeEnum,
)
from src.db.trail_steps import TrailStep
from src.db.users import APITokenUser
from src.services.courses.activities.assignments import (
    create_assignment_submission,
    retry_assignment_submission,
)

# Patch targets (mirrors test_assignments_service.py constants).
_PATCH_RBAC = "src.services.courses.activities.assignments.check_resource_access"
_PATCH_TRACK = "src.services.courses.activities.assignments.track"
_PATCH_DISPATCH = "src.services.courses.activities.assignments.dispatch_webhooks"
_PATCH_CERT = (
    "src.services.courses.activities.assignments."
    "check_course_completion_and_create_certificate"
)


# ---------------------------------------------------------------------------
# Local fixtures / builders
# ---------------------------------------------------------------------------


@pytest.fixture
async def assignment(db, org, course, chapter, activity):
    """Retryable assignment: allow_retries=True, max_retries=3."""
    a = Assignment(
        id=70,
        title="Retry Edge",
        description="Assignment for retry edge-case tests",
        due_date="2030-01-01",
        published=True,
        grading_type=GradingTypeEnum.NUMERIC,
        auto_grading=False,
        anti_copy_paste=False,
        show_correct_answers=False,
        allow_retries=True,
        max_retries=3,
        org_id=org.id,
        course_id=course.id,
        chapter_id=chapter.id,
        activity_id=activity.id,
        assignment_uuid="assignment_retry_edge",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(a)
    await db.commit()
    await db.refresh(a)
    return a


async def _make_task(db, org, course, chapter, activity, assignment, *, task_id, uuid):
    t = AssignmentTask(
        id=task_id,
        title=f"Task {task_id}",
        description="A task",
        hint="",
        reference_file=None,
        assignment_type=AssignmentTaskTypeEnum.SHORT_ANSWER,
        contents={"prompt": "x"},
        max_grade_value=100,
        assignment_id=assignment.id,
        org_id=org.id,
        course_id=course.id,
        chapter_id=chapter.id,
        activity_id=activity.id,
        assignment_task_uuid=uuid,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(t)
    await db.commit()
    await db.refresh(t)
    return t


async def _make_user_submission(
    db,
    assignment_id,
    user_id,
    *,
    status=AssignmentUserSubmissionStatus.GRADED,
    grade=80,
    attempt_number=1,
    overall_feedback="Good job",
    uuid="aus_edge_test",
):
    sub = AssignmentUserSubmission(
        user_id=user_id,
        assignment_id=assignment_id,
        grade=grade,
        submission_status=status,
        overall_feedback=overall_feedback,
        attempt_number=attempt_number,
        assignmentusersubmission_uuid=uuid,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(sub)
    await db.commit()
    await db.refresh(sub)
    return sub


async def _make_task_submission(db, task, user_id, *, grade=50, uuid):
    ts = AssignmentTaskSubmission(
        assignment_task_submission_uuid=uuid,
        task_submission={"answer": "x"},
        grade=grade,
        task_submission_grade_feedback="ok",
        assignment_type=task.assignment_type,
        user_id=user_id,
        activity_id=task.activity_id,
        course_id=task.course_id,
        chapter_id=task.chapter_id,
        assignment_task_id=task.id,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(ts)
    await db.commit()
    await db.refresh(ts)
    return ts


async def _make_trailstep(db, org_id, course_id, activity_id, user_id, *, complete):
    """Minimal standalone TrailStep (no Trail/TrailRun parent needed for the
    retry reset path, which queries TrailStep by activity_id + user_id)."""
    step = TrailStep(
        complete=complete,
        teacher_verified=True,
        grade="A",
        trailrun_id=0,
        trail_id=0,
        activity_id=activity_id,
        course_id=course_id,
        org_id=org_id,
        user_id=user_id,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(step)
    await db.commit()
    await db.refresh(step)
    return step


def _api_token_user(org_id):
    return APITokenUser(id=1, org_id=org_id, token_name="t")


# ---------------------------------------------------------------------------
# retry_assignment_submission — status gating edge cases
# ---------------------------------------------------------------------------


class TestRetryStatusGatingEdge:
    async def test_retry_rejects_pending_submission(
        self, db, regular_user, mock_request, assignment
    ):
        """A PENDING row (mid-retry, not yet resubmitted) is not GRADED, so
        retry must reject it with 400 — same gate as SUBMITTED but exercising
        the PENDING value specifically."""
        await _make_user_submission(
            db,
            assignment.id,
            regular_user.id,
            status=AssignmentUserSubmissionStatus.PENDING,
            grade=0,
            overall_feedback=None,
        )

        with patch(_PATCH_RBAC, new_callable=AsyncMock):
            with pytest.raises(HTTPException) as exc:
                await retry_assignment_submission(
                    mock_request, assignment.assignment_uuid, regular_user, db
                )

        assert exc.value.status_code == 400
        assert "Only graded submissions" in exc.value.detail


# ---------------------------------------------------------------------------
# retry_assignment_submission — attempt cap arithmetic
# ---------------------------------------------------------------------------


class TestRetryAttemptCapEdge:
    async def test_retry_succeeds_with_room_under_cap(
        self, db, regular_user, mock_request, assignment
    ):
        """current_attempt (2) < max_retries (3): the retry is allowed and the
        attempt counter increments to 3. Complements the existing test that
        only covers current == max (which is blocked)."""
        assignment.max_retries = 3
        db.add(assignment)
        await db.commit()
        submission = await _make_user_submission(
            db, assignment.id, regular_user.id, attempt_number=2
        )

        with patch(_PATCH_RBAC, new_callable=AsyncMock):
            result = await retry_assignment_submission(
                mock_request, assignment.assignment_uuid, regular_user, db
            )

        assert result["attempt_number"] == 3
        assert result["max_retries"] == 3
        await db.refresh(submission)
        assert submission.submission_status == AssignmentUserSubmissionStatus.PENDING
        assert submission.attempt_number == 3

    async def test_retry_blocked_when_attempt_above_cap(
        self, db, regular_user, mock_request, assignment
    ):
        """Data drift: attempt_number (5) is already past max_retries (3). The
        cap check uses >= so this is still blocked with 403."""
        assignment.max_retries = 3
        db.add(assignment)
        await db.commit()
        await _make_user_submission(
            db, assignment.id, regular_user.id, attempt_number=5
        )

        with patch(_PATCH_RBAC, new_callable=AsyncMock):
            with pytest.raises(HTTPException) as exc:
                await retry_assignment_submission(
                    mock_request, assignment.assignment_uuid, regular_user, db
                )

        assert exc.value.status_code == 403
        assert "No retry attempts remaining" in exc.value.detail

    async def test_unlimited_retries_increment_across_multiple_calls(
        self, db, regular_user, mock_request, assignment
    ):
        """max_retries=0 is unlimited. The existing suite does a single
        unlimited retry; here we chain three retries, re-grading the row
        between each, and assert the counter keeps climbing past where a
        finite cap would have blocked it."""
        assignment.max_retries = 0
        db.add(assignment)
        await db.commit()
        submission = await _make_user_submission(
            db, assignment.id, regular_user.id, attempt_number=1
        )

        with patch(_PATCH_RBAC, new_callable=AsyncMock):
            for expected_attempt in (2, 3, 4):
                result = await retry_assignment_submission(
                    mock_request, assignment.assignment_uuid, regular_user, db
                )
                assert result["attempt_number"] == expected_attempt
                assert result["max_retries"] == 0
                # Re-grade so the next retry passes the GRADED gate again.
                submission.submission_status = (
                    AssignmentUserSubmissionStatus.GRADED
                )
                db.add(submission)
                await db.commit()

        await db.refresh(submission)
        assert submission.attempt_number == 4


# ---------------------------------------------------------------------------
# retry_assignment_submission — side-effect wiping
# ---------------------------------------------------------------------------


class TestRetrySideEffectsEdge:
    async def test_retry_deletes_all_per_task_submissions(
        self, db, regular_user, mock_request, org, course, chapter, activity, assignment
    ):
        """Retry must wipe EVERY per-task submission for the user, not just
        one. Seed two tasks each with a submission and assert both are gone
        after the retry."""
        t1 = await _make_task(
            db, org, course, chapter, activity, assignment,
            task_id=701, uuid="assignmenttask_edge_1",
        )
        t2 = await _make_task(
            db, org, course, chapter, activity, assignment,
            task_id=702, uuid="assignmenttask_edge_2",
        )
        await _make_user_submission(db, assignment.id, regular_user.id)
        ts1 = await _make_task_submission(
            db, t1, regular_user.id, uuid="ats_edge_1"
        )
        ts2 = await _make_task_submission(
            db, t2, regular_user.id, uuid="ats_edge_2"
        )

        with patch(_PATCH_RBAC, new_callable=AsyncMock):
            await retry_assignment_submission(
                mock_request, assignment.assignment_uuid, regular_user, db
            )

        remaining = (await db.execute(
            select(AssignmentTaskSubmission).where(
                AssignmentTaskSubmission.id.in_([ts1.id, ts2.id])  # type: ignore
            )
        )).scalars().all()
        assert remaining == []

    async def test_retry_resets_trailstep_complete_to_false(
        self, db, regular_user, mock_request, org, course, activity, assignment
    ):
        """A completed TrailStep is flipped back to incomplete on retry so the
        student's progress reflects the in-flight attempt."""
        step = await _make_trailstep(
            db, org.id, course.id, activity.id, regular_user.id, complete=True
        )
        await _make_user_submission(db, assignment.id, regular_user.id)

        with patch(_PATCH_RBAC, new_callable=AsyncMock):
            await retry_assignment_submission(
                mock_request, assignment.assignment_uuid, regular_user, db
            )

        await db.refresh(step)
        assert step.complete is False
        assert step.teacher_verified is False
        assert step.grade == ""


# ---------------------------------------------------------------------------
# End-to-end: GRADED -> retry -> PENDING -> create -> SUBMITTED (same row)
# ---------------------------------------------------------------------------


class TestRetryThenResubmitChain:
    async def test_real_retry_then_create_reuses_same_row(
        self, db, regular_user, mock_request, org, course, activity, assignment
    ):
        """The existing suite seeds a PENDING row directly to test create's
        reuse path. Here the PENDING state is produced by the REAL retry
        function, then create_assignment_submission transitions that same row
        to SUBMITTED — proving the two functions hand off correctly and no
        duplicate submission row is created."""
        original_uuid = "aus_chain_test"
        submission = await _make_user_submission(
            db, assignment.id, regular_user.id,
            attempt_number=1, uuid=original_uuid,
        )
        original_id = submission.id
        await _make_trailstep(
            db, org.id, course.id, activity.id, regular_user.id, complete=True
        )

        with patch(_PATCH_RBAC, new_callable=AsyncMock), patch(
            _PATCH_TRACK, new_callable=AsyncMock
        ), patch(_PATCH_DISPATCH, new_callable=AsyncMock), patch(
            _PATCH_CERT, new_callable=AsyncMock
        ):
            retry_result = await retry_assignment_submission(
                mock_request, assignment.assignment_uuid, regular_user, db
            )
            assert retry_result["attempt_number"] == 2

            created = await create_assignment_submission(
                mock_request, assignment.assignment_uuid, regular_user, db
            )

        # Same row reused, now SUBMITTED, attempt counter preserved from retry.
        assert created.id == original_id
        assert created.submission_status == AssignmentUserSubmissionStatus.SUBMITTED
        assert created.attempt_number == 2
        assert created.grade == 0

        rows = (await db.execute(
            select(AssignmentUserSubmission).where(
                AssignmentUserSubmission.assignment_id == assignment.id,
                AssignmentUserSubmission.user_id == regular_user.id,
            )
        )).scalars().all()
        assert len(rows) == 1
        assert rows[0].assignmentusersubmission_uuid == original_uuid


# ---------------------------------------------------------------------------
# create_assignment_submission — NOT_SUBMITTED reuse state
# ---------------------------------------------------------------------------


class TestCreateReusesNotSubmittedRow:
    async def test_create_reuses_not_submitted_row(
        self, db, regular_user, mock_request, org, course, activity, assignment
    ):
        """NOT_SUBMITTED is the other reusable state (besides PENDING). The
        existing suite only covers the PENDING reuse, so this pins the
        NOT_SUBMITTED branch."""
        original_uuid = "aus_not_submitted_test"
        submission = await _make_user_submission(
            db, assignment.id, regular_user.id,
            status=AssignmentUserSubmissionStatus.NOT_SUBMITTED,
            grade=0, overall_feedback=None, attempt_number=2,
            uuid=original_uuid,
        )
        original_id = submission.id
        await _make_trailstep(
            db, org.id, course.id, activity.id, regular_user.id, complete=False
        )

        with patch(_PATCH_RBAC, new_callable=AsyncMock), patch(
            _PATCH_TRACK, new_callable=AsyncMock
        ), patch(_PATCH_DISPATCH, new_callable=AsyncMock), patch(
            _PATCH_CERT, new_callable=AsyncMock
        ):
            result = await create_assignment_submission(
                mock_request, assignment.assignment_uuid, regular_user, db
            )

        assert result.id == original_id
        assert result.submission_status == AssignmentUserSubmissionStatus.SUBMITTED
        assert result.attempt_number == 2

        rows = (await db.execute(
            select(AssignmentUserSubmission).where(
                AssignmentUserSubmission.assignment_id == assignment.id,
                AssignmentUserSubmission.user_id == regular_user.id,
            )
        )).scalars().all()
        assert len(rows) == 1


# ---------------------------------------------------------------------------
# API-token blocking (_block_api_tokens) — not covered by the existing suite
# ---------------------------------------------------------------------------


class TestApiTokenBlocked:
    async def test_retry_blocked_for_api_token_user(
        self, db, mock_request, org, assignment
    ):
        """API tokens cannot touch submission data — retry must 403 before any
        DB work."""
        token_user = _api_token_user(org.id)
        with patch(_PATCH_RBAC, new_callable=AsyncMock):
            with pytest.raises(HTTPException) as exc:
                await retry_assignment_submission(
                    mock_request, assignment.assignment_uuid, token_user, db
                )
        assert exc.value.status_code == 403
        assert "API tokens cannot access assignments" in exc.value.detail

    async def test_create_blocked_for_api_token_user(
        self, db, mock_request, org, assignment
    ):
        """Create-on-behalf requires the assignments.create right; a token with
        no rights is rejected with 403 before any DB work."""
        token_user = _api_token_user(org.id)
        with patch(_PATCH_RBAC, new_callable=AsyncMock):
            with pytest.raises(HTTPException) as exc:
                await create_assignment_submission(
                    mock_request, assignment.assignment_uuid, token_user, db,
                    on_behalf_of_user_id=1,
                )
        assert exc.value.status_code == 403
        assert "API token" in exc.value.detail
