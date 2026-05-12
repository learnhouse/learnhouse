"""
Tests for the assignment retry feature.

Covers:
- retry_assignment_submission service function (success, forbidden, attempt
  limit, wrong status, missing rows, unlimited path).
- create_assignment_submission reuse-of-PENDING-row path triggered by a prior
  retry (and the still-erroring SUBMITTED/GRADED case).
- AssignmentRead / AssignmentUserSubmissionRead exposing the new fields
  ``allow_retries``, ``max_retries`` and ``attempt_number``.
"""

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient
from sqlmodel import select

from src.core.events.database import get_db_session
from src.db.courses.assignments import (
    Assignment,
    AssignmentRead,
    AssignmentTask,
    AssignmentTaskSubmission,
    AssignmentTaskTypeEnum,
    AssignmentUserSubmission,
    AssignmentUserSubmissionRead,
    AssignmentUserSubmissionStatus,
    GradingTypeEnum,
)
from src.db.courses.certifications import CertificateUser, Certifications
from src.db.trail_runs import TrailRun
from src.db.trail_steps import TrailStep
from src.db.trails import Trail
from src.routers.courses.assignments import router as assignments_router
from src.security.auth import get_current_user
from src.services.courses.activities.assignments import (
    create_assignment_submission,
    retry_assignment_submission,
)


# ---------------------------------------------------------------------------
# Helper fixtures local to this module
# ---------------------------------------------------------------------------


@pytest.fixture
def assignment(db, org, course, chapter, activity):
    """Assignment row with retries allowed by default."""
    a = Assignment(
        id=1,
        title="Retryable",
        description="Assignment used by retry tests",
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
        assignment_uuid="assignment_retry_test",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(a)
    db.commit()
    db.refresh(a)
    return a


@pytest.fixture
def assignment_task(db, org, course, chapter, activity, assignment):
    """One task hung off the assignment so retry has something to wipe."""
    t = AssignmentTask(
        id=1,
        title="Task 1",
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
        assignment_task_uuid="assignmenttask_1",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


def _make_user_submission(
    db,
    assignment_id,
    user_id,
    *,
    status=AssignmentUserSubmissionStatus.GRADED,
    grade=80,
    attempt_number=1,
    overall_feedback="Good job",
    uuid="aus_retry_test",
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
    db.commit()
    db.refresh(sub)
    return sub


def _make_task_submission(db, task, user_id, *, grade=50, uuid="ats_retry_test"):
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
    db.commit()
    db.refresh(ts)
    return ts


def _make_trail_artifacts(db, org_id, course_id, activity_id, user_id, *, complete=True):
    trail = Trail(
        org_id=org_id,
        user_id=user_id,
        trail_uuid="trail_retry",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(trail)
    db.commit()
    db.refresh(trail)
    trail_run = TrailRun(
        trail_id=trail.id,
        course_id=course_id,
        org_id=org_id,
        user_id=user_id,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(trail_run)
    db.commit()
    db.refresh(trail_run)
    step = TrailStep(
        complete=complete,
        teacher_verified=True,
        grade="A",
        trailrun_id=trail_run.id,
        trail_id=trail.id,
        activity_id=activity_id,
        course_id=course_id,
        org_id=org_id,
        user_id=user_id,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(step)
    db.commit()
    db.refresh(step)
    return trail, trail_run, step


def _make_certificate(db, course, user_id):
    cert = Certifications(
        certification_uuid="cert_retry",
        course_id=course.id,
        config={},
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(cert)
    db.commit()
    db.refresh(cert)
    cert_user = CertificateUser(
        user_id=user_id,
        certification_id=cert.id,
        user_certification_uuid="certuser_retry",
        created_at=str(datetime.now()),
        updated_at=str(datetime.now()),
    )
    db.add(cert_user)
    db.commit()
    db.refresh(cert_user)
    return cert, cert_user


# ---------------------------------------------------------------------------
# retry_assignment_submission service-level tests
# ---------------------------------------------------------------------------


class TestRetryAssignmentSubmissionService:
    async def test_retry_success_resets_submission_tasks_and_trailstep(
        self, db, regular_user, mock_request, org, course, activity, assignment, assignment_task
    ):
        user_id = regular_user.id
        submission = _make_user_submission(db, assignment.id, user_id)
        task_sub = _make_task_submission(db, assignment_task, user_id)
        _, _, step = _make_trail_artifacts(
            db, org.id, course.id, activity.id, user_id, complete=True
        )
        cert, cert_user = _make_certificate(db, course, user_id)

        with patch(
            "src.services.courses.activities.assignments.check_resource_access",
            new_callable=AsyncMock,
        ):
            result = await retry_assignment_submission(
                mock_request, assignment.assignment_uuid, regular_user, db
            )

        assert result["message"] == "Assignment User Submission reset for retry"
        assert result["attempt_number"] == 2
        assert result["max_retries"] == 3
        assert result["submission"]["submission_status"] == AssignmentUserSubmissionStatus.PENDING.value

        db.refresh(submission)
        assert submission.submission_status == AssignmentUserSubmissionStatus.PENDING
        assert submission.grade == 0
        assert submission.overall_feedback is None
        assert submission.attempt_number == 2

        leftover_task_sub = db.exec(
            select(AssignmentTaskSubmission).where(
                AssignmentTaskSubmission.id == task_sub.id
            )
        ).first()
        assert leftover_task_sub is None

        db.refresh(step)
        assert step.complete is False
        assert step.teacher_verified is False
        assert step.grade == ""

        leftover_cert = db.exec(
            select(CertificateUser).where(CertificateUser.id == cert_user.id)
        ).first()
        assert leftover_cert is None

    async def test_retry_forbidden_when_allow_retries_false(
        self, db, regular_user, mock_request, assignment
    ):
        assignment.allow_retries = False
        db.add(assignment)
        db.commit()
        _make_user_submission(db, assignment.id, regular_user.id)

        with patch(
            "src.services.courses.activities.assignments.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc_info:
                await retry_assignment_submission(
                    mock_request, assignment.assignment_uuid, regular_user, db
                )

        assert exc_info.value.status_code == 403
        assert "Retries are not enabled" in exc_info.value.detail

    async def test_retry_forbidden_when_attempt_limit_reached(
        self, db, regular_user, mock_request, assignment
    ):
        assignment.max_retries = 3
        db.add(assignment)
        db.commit()
        _make_user_submission(
            db,
            assignment.id,
            regular_user.id,
            attempt_number=3,
        )

        with patch(
            "src.services.courses.activities.assignments.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc_info:
                await retry_assignment_submission(
                    mock_request, assignment.assignment_uuid, regular_user, db
                )

        assert exc_info.value.status_code == 403
        assert "No retry attempts remaining" in exc_info.value.detail

    async def test_retry_rejects_non_graded_submission(
        self, db, regular_user, mock_request, assignment
    ):
        _make_user_submission(
            db,
            assignment.id,
            regular_user.id,
            status=AssignmentUserSubmissionStatus.SUBMITTED,
        )

        with patch(
            "src.services.courses.activities.assignments.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc_info:
                await retry_assignment_submission(
                    mock_request, assignment.assignment_uuid, regular_user, db
                )

        assert exc_info.value.status_code == 400
        assert "Only graded submissions" in exc_info.value.detail

    async def test_retry_returns_404_when_no_submission_exists(
        self, db, regular_user, mock_request, assignment
    ):
        with patch(
            "src.services.courses.activities.assignments.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc_info:
                await retry_assignment_submission(
                    mock_request, assignment.assignment_uuid, regular_user, db
                )

        assert exc_info.value.status_code == 404
        assert "Assignment User Submission not found" in exc_info.value.detail

    async def test_retry_returns_404_when_assignment_missing(
        self, db, regular_user, mock_request
    ):
        with patch(
            "src.services.courses.activities.assignments.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc_info:
                await retry_assignment_submission(
                    mock_request, "assignment_does_not_exist", regular_user, db
                )

        assert exc_info.value.status_code == 404
        assert "Assignment not found" in exc_info.value.detail

    async def test_retry_returns_404_when_course_missing(
        self, db, regular_user, mock_request, org, chapter, activity
    ):
        """Orphan assignment whose course_id points at a non-existent row.
        Exercises the defensive 'Course not found' 404 inside the retry
        service — unlikely in production but the branch should still be
        covered to keep patch coverage above the codecov target."""
        orphan = Assignment(
            id=999,
            title="Orphan",
            description="",
            due_date="2030-01-01",
            published=True,
            grading_type=GradingTypeEnum.NUMERIC,
            allow_retries=True,
            max_retries=0,
            org_id=org.id,
            course_id=4242,  # No course row with this id.
            chapter_id=chapter.id,
            activity_id=activity.id,
            assignment_uuid="assignment_orphan_course",
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(orphan)
        db.commit()

        with patch(
            "src.services.courses.activities.assignments.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc_info:
                await retry_assignment_submission(
                    mock_request, orphan.assignment_uuid, regular_user, db
                )

        assert exc_info.value.status_code == 404
        assert "Course not found" in exc_info.value.detail

    async def test_retry_unlimited_when_max_retries_zero(
        self, db, regular_user, mock_request, assignment
    ):
        assignment.max_retries = 0
        db.add(assignment)
        db.commit()
        submission = _make_user_submission(
            db,
            assignment.id,
            regular_user.id,
            attempt_number=42,
        )

        with patch(
            "src.services.courses.activities.assignments.check_resource_access",
            new_callable=AsyncMock,
        ):
            result = await retry_assignment_submission(
                mock_request, assignment.assignment_uuid, regular_user, db
            )

        assert result["attempt_number"] == 43
        assert result["max_retries"] == 0
        db.refresh(submission)
        assert submission.submission_status == AssignmentUserSubmissionStatus.PENDING
        assert submission.attempt_number == 43


# ---------------------------------------------------------------------------
# create_assignment_submission retry/reuse path
# ---------------------------------------------------------------------------


class TestCreateAssignmentSubmissionRetryPath:
    async def test_reuses_pending_row_after_retry(
        self,
        db,
        regular_user,
        mock_request,
        org,
        course,
        activity,
        assignment,
    ):
        original_uuid = "aus_reuse_after_retry"
        submission = _make_user_submission(
            db,
            assignment.id,
            regular_user.id,
            status=AssignmentUserSubmissionStatus.PENDING,
            grade=0,
            overall_feedback=None,
            attempt_number=2,
            uuid=original_uuid,
        )
        _, _, step = _make_trail_artifacts(
            db, org.id, course.id, activity.id, regular_user.id, complete=False
        )
        original_id = submission.id

        with patch(
            "src.services.courses.activities.assignments.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.activities.assignments.track",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.activities.assignments.dispatch_webhooks",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.activities.assignments."
            "check_course_completion_and_create_certificate",
            new_callable=AsyncMock,
        ):
            result = await create_assignment_submission(
                mock_request, assignment.assignment_uuid, regular_user, db
            )

        assert result.id == original_id
        assert result.submission_status == AssignmentUserSubmissionStatus.SUBMITTED
        assert result.grade == 0
        assert result.attempt_number == 2

        db.refresh(step)
        assert step.complete is True

        rows = db.exec(
            select(AssignmentUserSubmission).where(
                AssignmentUserSubmission.assignment_id == assignment.id,
                AssignmentUserSubmission.user_id == regular_user.id,
            )
        ).all()
        assert len(rows) == 1
        # Same row reused: original uuid preserved on the persisted record.
        assert rows[0].assignmentusersubmission_uuid == original_uuid

    async def test_rejects_when_existing_row_is_submitted(
        self, db, regular_user, mock_request, assignment
    ):
        _make_user_submission(
            db,
            assignment.id,
            regular_user.id,
            status=AssignmentUserSubmissionStatus.SUBMITTED,
        )

        with patch(
            "src.services.courses.activities.assignments.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc_info:
                await create_assignment_submission(
                    mock_request, assignment.assignment_uuid, regular_user, db
                )

        assert exc_info.value.status_code == 400
        assert "already exists" in exc_info.value.detail

    async def test_rejects_when_existing_row_is_graded(
        self, db, regular_user, mock_request, assignment
    ):
        _make_user_submission(
            db,
            assignment.id,
            regular_user.id,
            status=AssignmentUserSubmissionStatus.GRADED,
        )

        with patch(
            "src.services.courses.activities.assignments.check_resource_access",
            new_callable=AsyncMock,
        ):
            with pytest.raises(HTTPException) as exc_info:
                await create_assignment_submission(
                    mock_request, assignment.assignment_uuid, regular_user, db
                )

        assert exc_info.value.status_code == 400

    async def test_creates_fresh_row_on_first_submission(
        self,
        db,
        regular_user,
        mock_request,
        org,
        course,
        activity,
        assignment,
    ):
        """When no AssignmentUserSubmission row exists yet, the service hits
        the else branch and creates a fresh row with attempt_number=1. The
        first-submission path also marks the (existing) trail step complete
        via the new else branch that keeps the reuse path consistent."""
        _, _, step = _make_trail_artifacts(
            db, org.id, course.id, activity.id, regular_user.id, complete=False
        )

        with patch(
            "src.services.courses.activities.assignments.check_resource_access",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.activities.assignments.track",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.activities.assignments.dispatch_webhooks",
            new_callable=AsyncMock,
        ), patch(
            "src.services.courses.activities.assignments."
            "check_course_completion_and_create_certificate",
            new_callable=AsyncMock,
        ):
            result = await create_assignment_submission(
                mock_request, assignment.assignment_uuid, regular_user, db
            )

        assert result.submission_status == AssignmentUserSubmissionStatus.SUBMITTED
        assert result.grade == 0
        assert result.attempt_number == 1

        db.refresh(step)
        assert step.complete is True

        rows = db.exec(
            select(AssignmentUserSubmission).where(
                AssignmentUserSubmission.assignment_id == assignment.id,
                AssignmentUserSubmission.user_id == regular_user.id,
            )
        ).all()
        assert len(rows) == 1
        # A brand-new uuid was generated (not the reuse path).
        assert rows[0].assignmentusersubmission_uuid.startswith(
            "assignmentusersubmission_"
        )


# ---------------------------------------------------------------------------
# Schema field coverage
# ---------------------------------------------------------------------------


class TestRetrySchemaFields:
    def test_assignment_read_exposes_retry_fields(self):
        read = AssignmentRead(
            id=10,
            assignment_uuid="a_uuid",
            title="T",
            description="D",
            due_date="2030-01-01",
            grading_type=GradingTypeEnum.NUMERIC,
            allow_retries=True,
            max_retries=5,
            org_id=1,
            course_id=1,
            chapter_id=1,
            activity_id=1,
        )

        dumped = read.model_dump()
        assert dumped["allow_retries"] is True
        assert dumped["max_retries"] == 5

    def test_assignment_user_submission_read_exposes_attempt_number(self):
        read = AssignmentUserSubmissionRead(
            id=1,
            user_id=1,
            assignment_id=1,
            grade=0,
            submission_status=AssignmentUserSubmissionStatus.PENDING,
            attempt_number=4,
            creation_date="2024-01-01",
            update_date="2024-01-01",
        )
        dumped = read.model_dump()
        assert dumped["attempt_number"] == 4
        assert dumped["submission_status"] == AssignmentUserSubmissionStatus.PENDING.value


# ---------------------------------------------------------------------------
# Router-level test for the new endpoint
# ---------------------------------------------------------------------------


@pytest.fixture
def app(db, regular_user):
    app = FastAPI()
    app.include_router(assignments_router, prefix="/api/v1/assignments")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: regular_user
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


class TestRetryAssignmentRouter:
    async def test_retry_endpoint_returns_200_and_new_attempt(self, client):
        expected = {
            "message": "Assignment User Submission reset for retry",
            "attempt_number": 2,
            "max_retries": 3,
            "submission": {"submission_status": "PENDING"},
        }
        with patch(
            "src.routers.courses.assignments.retry_assignment_submission",
            new_callable=AsyncMock,
            return_value=expected,
        ) as mock_retry:
            response = await client.post(
                "/api/v1/assignments/assignment_retry_test/submissions/me/retry"
            )

        assert response.status_code == 200
        assert response.json() == expected
        mock_retry.assert_awaited_once()
