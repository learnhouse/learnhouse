"""Formative assignments: no grading, and a model answer unlocked by submitting.

Covers the "dépôt d'un document qui débloque un corrigé, sans notation" flow:

- ``_student_may_see_solution`` — the reveal rule per ``solution_reveal`` mode,
  measured against the reader's own submission, including the retry guard and
  the anonymous reader.
- ``read_assignment`` / ``read_assignment_from_activity_uuid`` — the corrigé is
  stripped from the payload for a learner who has not unlocked it, and the
  ``has_solution`` flag still tells the UI one exists.
- ``create_assignment`` / ``update_assignment`` — formative mode forces
  auto-grading off.
- ``create_assignment_submission`` — a formative submission stays SUBMITTED and
  is never auto-graded.
- ``_apply_grade_and_finalize`` / ``grade_assignment_submission`` /
  ``get_grade_assignment_submission`` — grading a formative assignment, and
  reading a grade off one, are both refused.
- ``retry_assignment_submission`` — retries work from SUBMITTED when formative.
- ``are_course_assignments_passed`` — a handed-in formative assignment satisfies
  the certificate gate instead of blocking it forever.
- the solution-file upload / detach services.
"""

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.routers.courses.assignments import router as assignments_router
from src.security.auth import get_current_user

from src.db.courses.assignments import (
    Assignment,
    AssignmentCreate,
    AssignmentTask,
    AssignmentTaskTypeEnum,
    AssignmentUpdate,
    AssignmentUserSubmission,
    AssignmentUserSubmissionStatus,
    GradingTypeEnum,
    SolutionRevealEnum,
)
from src.db.trails import Trail
from src.services.courses.activities.assignments import (
    _apply_grade_and_finalize,
    _student_may_see_solution,
    create_assignment,
    create_assignment_submission,
    delete_assignment_solution_file,
    get_assignments_from_course,
    get_grade_assignment_submission,
    grade_assignment_submission,
    put_assignment_solution_file,
    read_assignment,
    read_assignment_from_activity_uuid,
    retry_assignment_submission,
    update_assignment,
)
from src.services.courses.activities.uploads.solution_files import (
    upload_solution_file,
)
from src.services.courses.certifications import are_course_assignments_passed

_RBAC = "src.services.courses.activities.assignments.check_resource_access"
_AUTHZ = "src.services.courses.activities.assignments.authorize_assignment_access"
_ROLES = (
    "src.services.courses.activities.assignments.authorization_verify_based_on_roles"
)
_LIMITS = "src.services.courses.activities.assignments.check_limits_with_usage"
_INCREASE = "src.services.courses.activities.assignments.increase_feature_usage"
_TRAIL = "src.services.courses.activities.assignments.check_trail_presence"
_CERT = (
    "src.services.courses.activities.assignments."
    "check_course_completion_and_create_certificate"
)
_COMPLETE = "src.services.courses.activities.assignments.is_course_fully_completed"
_TRACK = "src.services.courses.activities.assignments.track"
_DISPATCH = "src.services.courses.activities.assignments.dispatch_webhooks"
_AUDIT = "src.services.courses.activities.assignments.record_audit_event"
_REVOKE = "src.services.courses.activities.assignments.revoke_user_certificate"
_SYNC = "src.services.courses.activities.assignments.sync_trailrun_status"
_UPLOAD = "src.services.courses.activities.assignments.upload_solution_file"
_UPLOAD_FILE = "src.services.courses.activities.uploads.solution_files.upload_file"

SOLUTION_TEXT = "Step 1: restate the brief. Step 2: cite two sources."


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
async def _make_formative(
    db,
    org,
    course,
    chapter,
    activity,
    *,
    uuid="assignment_formative",
    ungraded=True,
    reveal=SolutionRevealEnum.ON_SUBMISSION,
    solution=SOLUTION_TEXT,
    solution_file=None,
    allow_retries=False,
    max_retries=0,
):
    a = Assignment(
        title="Essay",
        description="Upload your essay",
        due_date="2030-01-01",
        published=True,
        grading_type=GradingTypeEnum.NUMERIC,
        auto_grading=False,
        ungraded=ungraded,
        solution=solution,
        solution_file=solution_file,
        solution_reveal=reveal,
        allow_retries=allow_retries,
        max_retries=max_retries,
        org_id=org.id,
        course_id=course.id,
        chapter_id=chapter.id,
        activity_id=activity.id,
        assignment_uuid=uuid,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(a)
    await db.commit()
    await db.refresh(a)
    return a


async def _make_submission(db, assignment, user, status, *, attempt=1):
    sub = AssignmentUserSubmission(
        user_id=user.id,
        assignment_id=assignment.id,
        grade=0,
        submission_status=status,
        attempt_number=attempt,
        assignmentusersubmission_uuid=f"aus_formative_{assignment.id}_{user.id}",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(sub)
    await db.commit()
    await db.refresh(sub)
    return sub


async def _make_file_task(db, assignment, *, uuid="assignmenttask_formative"):
    t = AssignmentTask(
        title="Deposit",
        description="Upload the document",
        hint="",
        reference_file=None,
        assignment_type=AssignmentTaskTypeEnum.FILE_SUBMISSION,
        contents={},
        max_grade_value=100,
        assignment_id=assignment.id,
        org_id=assignment.org_id,
        course_id=assignment.course_id,
        chapter_id=assignment.chapter_id,
        activity_id=assignment.activity_id,
        assignment_task_uuid=uuid,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(t)
    await db.commit()
    await db.refresh(t)
    return t


# --------------------------------------------------------------------------- #
# _student_may_see_solution
# --------------------------------------------------------------------------- #
class TestStudentMaySeeSolution:
    async def test_never_mode_stays_locked_even_after_submitting(
        self, db, org, course, chapter, activity, regular_user
    ):
        a = await _make_formative(
            db, org, course, chapter, activity, reveal=SolutionRevealEnum.NEVER
        )
        await _make_submission(
            db, a, regular_user, AssignmentUserSubmissionStatus.SUBMITTED
        )
        assert await _student_may_see_solution(regular_user, a, db) is False

    async def test_on_submission_locked_until_the_learner_hands_in(
        self, db, org, course, chapter, activity, regular_user
    ):
        a = await _make_formative(db, org, course, chapter, activity)
        # No submission row at all yet.
        assert await _student_may_see_solution(regular_user, a, db) is False

        sub = await _make_submission(
            db, a, regular_user, AssignmentUserSubmissionStatus.PENDING
        )
        assert await _student_may_see_solution(regular_user, a, db) is False

        sub.submission_status = AssignmentUserSubmissionStatus.SUBMITTED
        db.add(sub)
        await db.commit()
        assert await _student_may_see_solution(regular_user, a, db) is True

    async def test_on_submission_also_unlocks_for_late_and_graded(
        self, db, org, course, chapter, activity, regular_user
    ):
        a = await _make_formative(db, org, course, chapter, activity)
        sub = await _make_submission(
            db, a, regular_user, AssignmentUserSubmissionStatus.LATE
        )
        assert await _student_may_see_solution(regular_user, a, db) is True

        sub.submission_status = AssignmentUserSubmissionStatus.GRADED
        db.add(sub)
        await db.commit()
        assert await _student_may_see_solution(regular_user, a, db) is True

    async def test_after_grading_mode_waits_for_the_grade(
        self, db, org, course, chapter, activity, regular_user
    ):
        a = await _make_formative(
            db,
            org,
            course,
            chapter,
            activity,
            ungraded=False,
            reveal=SolutionRevealEnum.AFTER_GRADING,
        )
        sub = await _make_submission(
            db, a, regular_user, AssignmentUserSubmissionStatus.SUBMITTED
        )
        assert await _student_may_see_solution(regular_user, a, db) is False

        sub.submission_status = AssignmentUserSubmissionStatus.GRADED
        db.add(sub)
        await db.commit()
        assert await _student_may_see_solution(regular_user, a, db) is True

    async def test_graded_assignment_withholds_while_a_retry_remains(
        self, db, org, course, chapter, activity, regular_user
    ):
        """Reading the corrigé then retrying would be a free full mark."""
        a = await _make_formative(
            db,
            org,
            course,
            chapter,
            activity,
            ungraded=False,
            reveal=SolutionRevealEnum.AFTER_GRADING,
            allow_retries=True,
            max_retries=2,
        )
        sub = await _make_submission(
            db, a, regular_user, AssignmentUserSubmissionStatus.GRADED, attempt=1
        )
        assert await _student_may_see_solution(regular_user, a, db) is False

        # Attempt cap reached — nothing left to game, so it unlocks.
        sub.attempt_number = 2
        db.add(sub)
        await db.commit()
        assert await _student_may_see_solution(regular_user, a, db) is True

    async def test_formative_assignment_ignores_the_retry_guard(
        self, db, org, course, chapter, activity, regular_user
    ):
        """Read the corrigé, try again — that IS the formative loop."""
        a = await _make_formative(
            db, org, course, chapter, activity, allow_retries=True, max_retries=0
        )
        await _make_submission(
            db, a, regular_user, AssignmentUserSubmissionStatus.SUBMITTED
        )
        assert await _student_may_see_solution(regular_user, a, db) is True

    async def test_anonymous_reader_never_unlocks(
        self, db, org, course, chapter, activity, anonymous_user
    ):
        a = await _make_formative(db, org, course, chapter, activity)
        assert await _student_may_see_solution(anonymous_user, a, db) is False


# --------------------------------------------------------------------------- #
# Read services strip the corrigé
# --------------------------------------------------------------------------- #
class TestSolutionVisibilityOnRead:
    async def test_student_without_submission_gets_no_solution_but_knows_it_exists(
        self, mock_request, db, org, course, chapter, activity, regular_user
    ):
        a = await _make_formative(
            db, org, course, chapter, activity, solution_file="solution_x.pdf"
        )
        with patch(_AUTHZ, new_callable=AsyncMock), patch(
            _ROLES, new_callable=AsyncMock, return_value=False
        ):
            result = await read_assignment(
                mock_request, a.assignment_uuid, regular_user, db
            )
        assert result.solution is None
        assert result.solution_file is None
        assert result.has_solution is True
        assert result.solution_unlocked is False

    async def test_student_gets_the_solution_once_submitted(
        self, mock_request, db, org, course, chapter, activity, regular_user
    ):
        a = await _make_formative(
            db, org, course, chapter, activity, solution_file="solution_x.pdf"
        )
        await _make_submission(
            db, a, regular_user, AssignmentUserSubmissionStatus.SUBMITTED
        )
        with patch(_AUTHZ, new_callable=AsyncMock), patch(
            _ROLES, new_callable=AsyncMock, return_value=False
        ):
            result = await read_assignment(
                mock_request, a.assignment_uuid, regular_user, db
            )
        assert result.solution == SOLUTION_TEXT
        assert result.solution_file == "solution_x.pdf"
        assert result.solution_unlocked is True

    async def test_instructor_always_sees_the_solution(
        self, mock_request, db, org, course, chapter, activity, admin_user
    ):
        a = await _make_formative(db, org, course, chapter, activity)
        with patch(_AUTHZ, new_callable=AsyncMock), patch(
            _ROLES, new_callable=AsyncMock, return_value=True
        ):
            result = await read_assignment(
                mock_request, a.assignment_uuid, admin_user, db
            )
        assert result.solution == SOLUTION_TEXT
        assert result.solution_unlocked is True

    async def test_activity_read_is_gated_too(
        self, mock_request, db, org, course, chapter, activity, regular_user
    ):
        """The learner's activity page reads through this endpoint, so a gap
        here would leak the corrigé to every student on page load."""
        await _make_formative(db, org, course, chapter, activity)
        with patch(_AUTHZ, new_callable=AsyncMock), patch(
            _ROLES, new_callable=AsyncMock, return_value=False
        ):
            result = await read_assignment_from_activity_uuid(
                mock_request, activity.activity_uuid, regular_user, db
            )
        assert result.solution is None
        assert result.has_solution is True
        assert result.solution_unlocked is False

    async def test_has_solution_is_false_when_none_was_authored(
        self, mock_request, db, org, course, chapter, activity, regular_user
    ):
        a = await _make_formative(
            db, org, course, chapter, activity, solution="   ", solution_file=None
        )
        with patch(_AUTHZ, new_callable=AsyncMock), patch(
            _ROLES, new_callable=AsyncMock, return_value=False
        ):
            result = await read_assignment(
                mock_request, a.assignment_uuid, regular_user, db
            )
        assert result.has_solution is False

    async def test_course_list_is_gated_per_assignment(
        self, mock_request, db, org, course, chapter, activity, regular_user
    ):
        # The course-wide list is reachable with plain course READ, so it has
        # to apply the same reveal rule as the single read — per assignment,
        # since the learner may have handed in one and not the other.
        handed_in = await _make_formative(
            db, org, course, chapter, activity, uuid="assignment_formative_a"
        )
        locked = await _make_formative(
            db,
            org,
            course,
            chapter,
            activity,
            uuid="assignment_formative_b",
            solution_file="solution_b.pdf",
        )
        await _make_submission(
            db, handed_in, regular_user, AssignmentUserSubmissionStatus.SUBMITTED
        )
        with patch(_AUTHZ, new_callable=AsyncMock), patch(
            _ROLES, new_callable=AsyncMock, return_value=False
        ):
            results = await get_assignments_from_course(
                mock_request, course.course_uuid, regular_user, db
            )
        by_uuid = {r.assignment_uuid: r for r in results}
        assert by_uuid[handed_in.assignment_uuid].solution == SOLUTION_TEXT
        assert by_uuid[handed_in.assignment_uuid].solution_unlocked is True
        assert by_uuid[locked.assignment_uuid].solution is None
        assert by_uuid[locked.assignment_uuid].solution_file is None
        assert by_uuid[locked.assignment_uuid].has_solution is True
        assert by_uuid[locked.assignment_uuid].solution_unlocked is False

    async def test_course_list_shows_instructor_everything(
        self, mock_request, db, org, course, chapter, activity, admin_user
    ):
        a = await _make_formative(
            db, org, course, chapter, activity, solution_file="solution_x.pdf"
        )
        with patch(_AUTHZ, new_callable=AsyncMock), patch(
            _ROLES, new_callable=AsyncMock, return_value=True
        ):
            results = await get_assignments_from_course(
                mock_request, course.course_uuid, admin_user, db
            )
        (result,) = [r for r in results if r.assignment_uuid == a.assignment_uuid]
        assert result.solution == SOLUTION_TEXT
        assert result.solution_file == "solution_x.pdf"
        assert result.solution_unlocked is True


# --------------------------------------------------------------------------- #
# Formative mode vs auto-grading
# --------------------------------------------------------------------------- #
class TestFormativeForcesAutoGradingOff:
    async def test_create_drops_auto_grading(
        self, mock_request, db, org, course, chapter, activity, admin_user
    ):
        obj = AssignmentCreate(
            title="T",
            description="D",
            due_date="2030-01-01",
            grading_type=GradingTypeEnum.NUMERIC,
            auto_grading=True,
            ungraded=True,
            org_id=org.id,
            course_id=course.id,
            chapter_id=chapter.id,
            activity_id=activity.id,
        )
        with patch(_AUTHZ, new_callable=AsyncMock), patch(
            _LIMITS, new_callable=AsyncMock
        ), patch(_INCREASE, new_callable=AsyncMock):
            result = await create_assignment(mock_request, obj, admin_user, db)
        assert result.ungraded is True
        assert result.auto_grading is False

    async def test_update_drops_auto_grading(
        self, mock_request, db, org, course, chapter, activity, admin_user
    ):
        a = await _make_formative(db, org, course, chapter, activity, ungraded=False)
        a.auto_grading = True
        db.add(a)
        await db.commit()

        with patch(_AUTHZ, new_callable=AsyncMock):
            result = await update_assignment(
                mock_request,
                a.assignment_uuid,
                AssignmentUpdate(ungraded=True),
                admin_user,
                db,
            )
        assert result.ungraded is True
        assert result.auto_grading is False


# --------------------------------------------------------------------------- #
# Submitting a formative assignment
# --------------------------------------------------------------------------- #
class TestFormativeSubmission:
    async def test_submission_stays_submitted_and_is_not_graded(
        self, mock_request, db, org, course, chapter, activity, regular_user
    ):
        a = await _make_formative(db, org, course, chapter, activity)
        await _make_file_task(db, a)
        # Even with the flag flipped on the row directly, formative wins.
        a.auto_grading = True
        db.add(a)
        await db.commit()

        trail = Trail(
            org_id=course.org_id,
            user_id=regular_user.id,
            trail_uuid="trail_formative",
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(trail)
        await db.commit()
        await db.refresh(trail)

        with patch(_RBAC, new_callable=AsyncMock), patch(
            _ROLES, new_callable=AsyncMock, return_value=False
        ), patch(_TRAIL, new_callable=AsyncMock, return_value=trail), patch(
            _CERT, new_callable=AsyncMock
        ), patch(_COMPLETE, new_callable=AsyncMock, return_value=False), patch(
            _TRACK, new_callable=AsyncMock
        ), patch(_DISPATCH, new_callable=AsyncMock), patch(
            _AUDIT, new_callable=AsyncMock
        ):
            result = await create_assignment_submission(
                mock_request, a.assignment_uuid, regular_user, db
            )

        assert result.submission_status == AssignmentUserSubmissionStatus.SUBMITTED
        assert result.grade == 0

    async def test_solution_unlocks_right_after_that_submission(
        self, mock_request, db, org, course, chapter, activity, regular_user
    ):
        """The whole point: hand the document in, get the corrigé back now."""
        a = await _make_formative(db, org, course, chapter, activity)
        await _make_file_task(db, a)
        trail = Trail(
            org_id=course.org_id,
            user_id=regular_user.id,
            trail_uuid="trail_formative_unlock",
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(trail)
        await db.commit()
        await db.refresh(trail)

        with patch(_AUTHZ, new_callable=AsyncMock), patch(
            _ROLES, new_callable=AsyncMock, return_value=False
        ):
            before = await read_assignment(
                mock_request, a.assignment_uuid, regular_user, db
            )
        assert before.solution is None

        with patch(_RBAC, new_callable=AsyncMock), patch(
            _ROLES, new_callable=AsyncMock, return_value=False
        ), patch(_TRAIL, new_callable=AsyncMock, return_value=trail), patch(
            _CERT, new_callable=AsyncMock
        ), patch(_COMPLETE, new_callable=AsyncMock, return_value=False), patch(
            _TRACK, new_callable=AsyncMock
        ), patch(_DISPATCH, new_callable=AsyncMock), patch(
            _AUDIT, new_callable=AsyncMock
        ):
            await create_assignment_submission(
                mock_request, a.assignment_uuid, regular_user, db
            )

        with patch(_AUTHZ, new_callable=AsyncMock), patch(
            _ROLES, new_callable=AsyncMock, return_value=False
        ):
            after = await read_assignment(
                mock_request, a.assignment_uuid, regular_user, db
            )
        assert after.solution == SOLUTION_TEXT
        assert after.solution_unlocked is True


# --------------------------------------------------------------------------- #
# Grading is refused
# --------------------------------------------------------------------------- #
class TestGradingRefused:
    async def test_apply_grade_and_finalize_raises(
        self, db, org, course, chapter, activity, regular_user
    ):
        a = await _make_formative(db, org, course, chapter, activity)
        sub = await _make_submission(
            db, a, regular_user, AssignmentUserSubmissionStatus.SUBMITTED
        )
        with pytest.raises(HTTPException) as exc:
            await _apply_grade_and_finalize(
                assignment=a,
                course=course,
                user_id=regular_user.id,
                assignment_user_submission=sub,
                db_session=db,
            )
        assert exc.value.status_code == 400
        assert "ungraded" in exc.value.detail

    async def test_grade_endpoint_raises_and_leaves_status_alone(
        self, mock_request, db, org, course, chapter, activity, regular_user, admin_user
    ):
        a = await _make_formative(db, org, course, chapter, activity)
        sub = await _make_submission(
            db, a, regular_user, AssignmentUserSubmissionStatus.SUBMITTED
        )
        with patch(_AUTHZ, new_callable=AsyncMock):
            with pytest.raises(HTTPException) as exc:
                await grade_assignment_submission(
                    mock_request, regular_user.id, a.assignment_uuid, admin_user, db
                )
        assert exc.value.status_code == 400
        await db.refresh(sub)
        assert sub.submission_status == AssignmentUserSubmissionStatus.SUBMITTED

    async def test_reading_the_grade_is_refused_rather_than_returning_zero(
        self, mock_request, db, org, course, chapter, activity, regular_user, admin_user
    ):
        """A computed 0 would render as "0/100 — not passed" for work that was
        never meant to be scored."""
        a = await _make_formative(db, org, course, chapter, activity)
        await _make_submission(
            db, a, regular_user, AssignmentUserSubmissionStatus.SUBMITTED
        )
        with patch(_AUTHZ, new_callable=AsyncMock), patch(
            _ROLES, new_callable=AsyncMock, return_value=True
        ):
            with pytest.raises(HTTPException) as exc:
                await get_grade_assignment_submission(
                    mock_request, regular_user.id, a.assignment_uuid, admin_user, db
                )
        assert exc.value.status_code == 400


# --------------------------------------------------------------------------- #
# Retry
# --------------------------------------------------------------------------- #
class TestFormativeRetry:
    async def test_formative_submission_can_be_retried_from_submitted(
        self, mock_request, db, org, course, chapter, activity, regular_user
    ):
        a = await _make_formative(
            db, org, course, chapter, activity, allow_retries=True, max_retries=0
        )
        await _make_submission(
            db, a, regular_user, AssignmentUserSubmissionStatus.SUBMITTED
        )
        with patch(_RBAC, new_callable=AsyncMock), patch(
            _ROLES, new_callable=AsyncMock, return_value=False
        ), patch(_REVOKE, new_callable=AsyncMock), patch(_SYNC, new_callable=AsyncMock):
            result = await retry_assignment_submission(
                mock_request, a.assignment_uuid, regular_user, db
            )
        assert result["attempt_number"] == 2

    async def test_graded_assignment_still_refuses_a_submitted_retry(
        self, mock_request, db, org, course, chapter, activity, regular_user
    ):
        a = await _make_formative(
            db,
            org,
            course,
            chapter,
            activity,
            ungraded=False,
            allow_retries=True,
            max_retries=0,
        )
        await _make_submission(
            db, a, regular_user, AssignmentUserSubmissionStatus.SUBMITTED
        )
        with patch(_RBAC, new_callable=AsyncMock), patch(
            _ROLES, new_callable=AsyncMock, return_value=False
        ):
            with pytest.raises(HTTPException) as exc:
                await retry_assignment_submission(
                    mock_request, a.assignment_uuid, regular_user, db
                )
        assert exc.value.status_code == 400


# --------------------------------------------------------------------------- #
# Certificate gate
# --------------------------------------------------------------------------- #
class TestCertificateGate:
    """The ``activity`` fixture already links itself into the chapter, so the
    assignment below is a real course assignment as far as the gate is
    concerned."""

    async def test_handed_in_formative_assignment_satisfies_the_gate(
        self, db, org, course, chapter, activity, regular_user
    ):
        a = await _make_formative(db, org, course, chapter, activity)
        await _make_file_task(db, a)
        await _make_submission(
            db, a, regular_user, AssignmentUserSubmissionStatus.SUBMITTED
        )
        assert await are_course_assignments_passed(regular_user.id, course.id, db) is True

    async def test_missing_formative_submission_still_blocks_the_gate(
        self, db, org, course, chapter, activity, regular_user
    ):
        a = await _make_formative(db, org, course, chapter, activity)
        await _make_file_task(db, a)
        assert (
            await are_course_assignments_passed(regular_user.id, course.id, db) is False
        )


# --------------------------------------------------------------------------- #
# Solution file upload / detach
# --------------------------------------------------------------------------- #
class TestSolutionFileServices:
    async def test_upload_stores_the_returned_disk_name(
        self, mock_request, db, org, course, chapter, activity, admin_user
    ):
        a = await _make_formative(db, org, course, chapter, activity, solution_file=None)

        class _Upload:
            filename = "corrige.pdf"

        with patch(_AUTHZ, new_callable=AsyncMock), patch(
            _UPLOAD, new_callable=AsyncMock, return_value="solution_abc.pdf"
        ):
            result = await put_assignment_solution_file(
                mock_request, db, a.assignment_uuid, admin_user, _Upload()
            )
        assert result.solution_file == "solution_abc.pdf"
        await db.refresh(a)
        assert a.solution_file == "solution_abc.pdf"

    async def test_upload_without_a_file_is_a_400(
        self, mock_request, db, org, course, chapter, activity, admin_user
    ):
        a = await _make_formative(db, org, course, chapter, activity)
        with patch(_AUTHZ, new_callable=AsyncMock):
            with pytest.raises(HTTPException) as exc:
                await put_assignment_solution_file(
                    mock_request, db, a.assignment_uuid, admin_user, None
                )
        assert exc.value.status_code == 400

    async def test_delete_detaches_the_file(
        self, mock_request, db, org, course, chapter, activity, admin_user
    ):
        a = await _make_formative(
            db, org, course, chapter, activity, solution_file="solution_abc.pdf"
        )
        with patch(_AUTHZ, new_callable=AsyncMock):
            result = await delete_assignment_solution_file(
                mock_request, db, a.assignment_uuid, admin_user
            )
        assert result.solution_file is None
        await db.refresh(a)
        assert a.solution_file is None

    async def test_upload_on_an_unknown_assignment_is_a_404(
        self, mock_request, db, admin_user
    ):
        with patch(_AUTHZ, new_callable=AsyncMock):
            with pytest.raises(HTTPException) as exc:
                await put_assignment_solution_file(
                    mock_request, db, "assignment_does_not_exist", admin_user, None
                )
        assert exc.value.status_code == 404

    async def test_upload_with_a_dangling_course_is_a_404(
        self, mock_request, db, org, course, chapter, activity, admin_user
    ):
        a = await _make_formative(db, org, course, chapter, activity)
        a.course_id = 999
        db.add(a)
        await db.commit()
        with patch(_AUTHZ, new_callable=AsyncMock):
            with pytest.raises(HTTPException) as exc:
                await put_assignment_solution_file(
                    mock_request, db, a.assignment_uuid, admin_user, None
                )
        assert exc.value.status_code == 404
        assert exc.value.detail == "Course not found"

    async def test_upload_with_a_dangling_activity_is_a_404(
        self, mock_request, db, org, course, chapter, activity, admin_user
    ):
        a = await _make_formative(db, org, course, chapter, activity)
        a.activity_id = 999
        db.add(a)
        await db.commit()

        class _Upload:
            filename = "corrige.pdf"

        with patch(_AUTHZ, new_callable=AsyncMock), patch(
            _UPLOAD, new_callable=AsyncMock
        ) as upload:
            with pytest.raises(HTTPException) as exc:
                await put_assignment_solution_file(
                    mock_request, db, a.assignment_uuid, admin_user, _Upload()
                )
        assert exc.value.status_code == 404
        assert exc.value.detail == "Activity not found"
        upload.assert_not_awaited()

    async def test_delete_on_an_unknown_assignment_is_a_404(
        self, mock_request, db, admin_user
    ):
        with patch(_AUTHZ, new_callable=AsyncMock):
            with pytest.raises(HTTPException) as exc:
                await delete_assignment_solution_file(
                    mock_request, db, "assignment_does_not_exist", admin_user
                )
        assert exc.value.status_code == 404

    async def test_delete_with_a_dangling_course_is_a_404(
        self, mock_request, db, org, course, chapter, activity, admin_user
    ):
        a = await _make_formative(
            db, org, course, chapter, activity, solution_file="solution_abc.pdf"
        )
        a.course_id = 999
        db.add(a)
        await db.commit()
        with patch(_AUTHZ, new_callable=AsyncMock):
            with pytest.raises(HTTPException) as exc:
                await delete_assignment_solution_file(
                    mock_request, db, a.assignment_uuid, admin_user
                )
        assert exc.value.status_code == 404
        assert exc.value.detail == "Course not found"

    async def test_upload_helper_stores_under_the_assignment_solution_dir(self):
        # The stored path is what the web client rebuilds to download the
        # corrige, so the directory layout is part of the contract.
        with patch(_UPLOAD_FILE, new_callable=AsyncMock, return_value="solution_x.pdf") as up:
            name = await upload_solution_file(
                object(), "activity_1", "org_1", "course_1", "assignment_1"
            )
        assert name == "solution_x.pdf"
        kwargs = up.await_args.kwargs
        assert kwargs["directory"] == (
            "courses/course_1/activities/activity_1/assignments/assignment_1/solution"
        )
        assert kwargs["type_of_dir"] == "orgs"
        assert kwargs["uuid"] == "org_1"
        assert kwargs["filename_prefix"] == "solution"


# --------------------------------------------------------------------------- #
# Solution file routes
# --------------------------------------------------------------------------- #
@pytest.fixture
def solution_app(db, admin_user):
    app = FastAPI()
    app.include_router(assignments_router, prefix="/api/v1/assignments")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: admin_user
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def solution_client(solution_app):
    async with AsyncClient(
        transport=ASGITransport(app=solution_app), base_url="http://test"
    ) as c:
        yield c


class TestSolutionFileRoutes:
    async def test_post_uploads_and_returns_the_unlocked_read(
        self, solution_client, db, org, course, chapter, activity
    ):
        a = await _make_formative(db, org, course, chapter, activity, solution_file=None)
        with patch(_AUTHZ, new_callable=AsyncMock), patch(
            _UPLOAD, new_callable=AsyncMock, return_value="solution_abc.pdf"
        ):
            res = await solution_client.post(
                f"/api/v1/assignments/{a.assignment_uuid}/solution_file",
                files={"solution_file": ("corrige.pdf", b"%PDF-1.4", "application/pdf")},
            )
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["solution_file"] == "solution_abc.pdf"
        assert body["has_solution"] is True
        assert body["solution_unlocked"] is True

    async def test_delete_detaches_and_returns_the_read(
        self, solution_client, db, org, course, chapter, activity
    ):
        a = await _make_formative(
            db, org, course, chapter, activity, solution_file="solution_abc.pdf"
        )
        with patch(_AUTHZ, new_callable=AsyncMock):
            res = await solution_client.delete(
                f"/api/v1/assignments/{a.assignment_uuid}/solution_file"
            )
        assert res.status_code == 200, res.text
        assert res.json()["solution_file"] is None
        await db.refresh(a)
        assert a.solution_file is None
