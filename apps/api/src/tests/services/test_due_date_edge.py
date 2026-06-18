"""Net-new edge-case tests for due-date / late-submission logic.

Targets two pieces of behavior in
``src/services/courses/activities/assignments.py``:

  * ``_is_assignment_past_due`` — the defensive parser that decides whether an
    assignment's free-form ``due_date`` string is in the past.
  * the deadline gate inside ``create_assignment_submission`` — for a
    non-instructor, a past-due assignment is REJECTED with HTTP 403
    ("deadline has passed"); otherwise the submission is recorded as SUBMITTED.

IMPORTANT — pinned real behavior (verified against the source, not assumed):

  * ``submission_status`` is NEVER set to ``LATE`` by ``create_assignment_submission``.
    The ``LATE`` enum value exists (``AssignmentUserSubmissionStatus.LATE``) but is
    not used on the create path. A late (past-due) student submission is rejected
    with a 403 rather than being stored as LATE; an on-time / no-deadline
    submission is stored as ``SUBMITTED``. These tests assert that real behavior.
  * A date-only deadline (no ``T`` and no ``:``) is shifted to the FOLLOWING
    midnight, so the whole due day counts as on-time.
  * ``due_date`` is ``str()``-ified then ``.strip()``-ed before parsing, so
    surrounding whitespace is tolerated and non-string values degrade to a
    ValueError -> treated as "no deadline" (returns False) rather than crashing.
  * ``datetime.fromisoformat`` is used; on this Python it accepts a ``Z`` suffix
    and space-separated datetimes, and rejects an impossible calendar date
    (e.g. Feb 29 of a non-leap year).

These cases are deliberately distinct from the existing
``TestIsAssignmentPastDue`` and ``TestDueDateEnforcement`` classes in
``test_assignments_service.py`` (which already cover: empty/None/whitespace-only/
missing-attr/garbage strings, plain past & future date-only, past datetime,
tz-aware past, due-today date-only, due-yesterday date-only, due-today
earlier-time, and the create-path past-due-403 / instructor-bypass / no-due-date
allow paths). We only add what those miss.
"""

from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from src.db.courses.assignments import (
    Assignment,
    AssignmentUserSubmissionStatus,
    GradingTypeEnum,
)
from src.db.trails import Trail
from src.services.courses.activities.assignments import (
    _is_assignment_past_due,
    create_assignment_submission,
)


@pytest.fixture
async def assignment(db, org, course, chapter, activity):
    """Published assignment with a far-future due_date.

    Mirrors the fixture in test_assignments_service.py; individual tests below
    overwrite due_date as needed. Uses distinct ids/uuid to avoid collisions.
    """
    a = Assignment(
        id=110,
        title="Due-date Edge Assignment",
        description="An assignment for due-date edge tests",
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
        assignment_uuid="assignment_duedge_test",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(a)
    await db.commit()
    await db.refresh(a)
    return a

# Reuse the same patch targets as test_assignments_service.py.
_PATCH_RBAC = "src.services.courses.activities.assignments.check_resource_access"
_PATCH_AUTH_ROLES = (
    "src.services.courses.activities.assignments.authorization_verify_based_on_roles"
)
_PATCH_DISPATCH = "src.services.courses.activities.assignments.dispatch_webhooks"
_PATCH_TRACK = "src.services.courses.activities.assignments.track"
_PATCH_CERT = (
    "src.services.courses.activities.assignments."
    "check_course_completion_and_create_certificate"
)
_PATCH_TRAIL_PRESENCE = (
    "src.services.courses.activities.assignments.check_trail_presence"
)
_PATCH_CERT_CHECK = (
    "src.services.courses.activities.assignments."
    "check_course_completion_and_create_certificate"
)


# ---------------------------------------------------------------------------
# _is_assignment_past_due — net-new parsing edge cases
# ---------------------------------------------------------------------------


class TestIsAssignmentPastDueEdge:
    """Edge cases for the defensive due_date parser not covered elsewhere."""

    def test_far_future_datetime_with_time_returns_false(self):
        """A datetime far in the future (with explicit time) is not past due."""
        a = SimpleNamespace(due_date="2999-12-31T23:59:59")
        assert _is_assignment_past_due(a) is False

    def test_far_past_datetime_with_time_returns_true(self):
        """A datetime far in the past (with explicit time) is past due."""
        a = SimpleNamespace(due_date="1970-01-01T00:00:00")
        assert _is_assignment_past_due(a) is True

    def test_leading_trailing_whitespace_around_future_date(self):
        """Surrounding whitespace is stripped; a future date stays not-past-due."""
        a = SimpleNamespace(due_date="   2999-01-01   ")
        assert _is_assignment_past_due(a) is False

    def test_leading_trailing_whitespace_around_past_date(self):
        """Surrounding whitespace is stripped; a past date is still past due."""
        a = SimpleNamespace(due_date="\t2000-01-01\n")
        assert _is_assignment_past_due(a) is True

    def test_valid_leap_day_in_past_returns_true(self):
        """A real leap day (2024-02-29) parses and is correctly past due."""
        a = SimpleNamespace(due_date="2024-02-29")
        assert _is_assignment_past_due(a) is True

    def test_valid_leap_day_in_future_returns_false(self):
        """A real future leap day (2028-02-29) parses and is not past due."""
        a = SimpleNamespace(due_date="2028-02-29")
        assert _is_assignment_past_due(a) is False

    def test_impossible_leap_day_is_graceful_returns_false(self):
        """Feb 29 of a non-leap year is an impossible date.

        fromisoformat raises ValueError; the parser swallows it and treats the
        deadline as unset (False) rather than crashing or locking students out.
        """
        a = SimpleNamespace(due_date="2030-02-29")
        assert _is_assignment_past_due(a) is False

    def test_z_suffix_utc_datetime_in_past_returns_true(self):
        """A 'Z'-suffixed UTC datetime in the past is stripped to naive -> past."""
        a = SimpleNamespace(due_date="2000-12-31T23:59:59Z")
        assert _is_assignment_past_due(a) is True

    def test_z_suffix_utc_datetime_in_future_returns_false(self):
        """A 'Z'-suffixed UTC datetime in the future is not past due."""
        a = SimpleNamespace(due_date="2999-12-31T23:59:59Z")
        assert _is_assignment_past_due(a) is False

    def test_tz_aware_future_datetime_returns_false(self):
        """tz-aware future datetime: tzinfo stripped, still in the future."""
        a = SimpleNamespace(due_date="2999-01-01T00:00:00+00:00")
        assert _is_assignment_past_due(a) is False

    def test_space_separated_datetime_in_past_returns_true(self):
        """A space-separated (not 'T') datetime parses and the time component
        means it is NOT shifted to end-of-day; a past value is past due."""
        a = SimpleNamespace(due_date="2000-01-01 12:00:00")
        assert _is_assignment_past_due(a) is True

    def test_microseconds_future_datetime_returns_false(self):
        """A datetime with microseconds in the future is not past due."""
        a = SimpleNamespace(due_date="2999-01-01T00:00:00.123456")
        assert _is_assignment_past_due(a) is False

    def test_date_only_vs_datetime_equivalence_at_end_of_day(self):
        """A date-only deadline behaves like end-of-that-day.

        A bare date "2000-01-01" (shifted to 2000-01-02T00:00:00) and an explicit
        "2000-01-01T23:59:59" are both in the past today, so both report past due.
        Pins the +1-day end-of-day shift for date-only values.
        """
        date_only = SimpleNamespace(due_date="2000-01-01")
        explicit_eod = SimpleNamespace(due_date="2000-01-01T23:59:59")
        assert _is_assignment_past_due(date_only) is True
        assert _is_assignment_past_due(explicit_eod) is True

    def test_non_string_int_due_date_is_graceful(self):
        """A non-string due_date (int) is str()-ified, fails to parse, and is
        treated as no deadline (False) rather than raising."""
        a = SimpleNamespace(due_date=12345)
        assert _is_assignment_past_due(a) is False

    def test_non_string_list_due_date_is_graceful(self):
        """A list due_date stringifies to something unparseable -> False, no crash."""
        a = SimpleNamespace(due_date=["2000-01-01"])
        assert _is_assignment_past_due(a) is False

    def test_due_tomorrow_date_only_returns_false(self):
        """A date-only deadline of tomorrow is clearly not past due."""
        tomorrow = (datetime.now() + timedelta(days=1)).date().isoformat()
        a = SimpleNamespace(due_date=tomorrow)
        assert _is_assignment_past_due(a) is False


# ---------------------------------------------------------------------------
# create_assignment_submission — deadline gate (SUBMITTED vs 403)
# ---------------------------------------------------------------------------


class TestCreateSubmissionDeadlineGate:
    """The create path: on-time / no-deadline -> SUBMITTED; past-due -> 403.

    NOTE: there is no 'LATE' status outcome on this path. A past-due student
    submission is rejected with HTTP 403, not recorded with status LATE.
    """

    async def _set_due(self, db, assignment, due_date):
        assignment.due_date = due_date
        db.add(assignment)
        await db.commit()
        await db.refresh(assignment)

    async def _make_trail(self, db, course, user):
        trail = Trail(
            org_id=course.org_id,
            user_id=user.id,
            trail_uuid=f"trail_duedge_{user.id}",
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(trail)
        await db.commit()
        await db.refresh(trail)
        return trail

    async def test_student_before_far_future_due_is_submitted(
        self, mock_request, db, assignment, course, activity, regular_user
    ):
        """Student submitting well before a far-future due date -> SUBMITTED."""
        await self._set_due(db, assignment, "2999-01-01")
        trail = await self._make_trail(db, course, regular_user)
        with patch(_PATCH_RBAC, new_callable=AsyncMock), \
             patch(_PATCH_TRAIL_PRESENCE, new_callable=AsyncMock, return_value=trail), \
             patch(_PATCH_AUTH_ROLES, new_callable=AsyncMock, return_value=False), \
             patch(_PATCH_CERT, new_callable=AsyncMock), \
             patch(_PATCH_CERT_CHECK, new_callable=AsyncMock), \
             patch(_PATCH_TRACK, new_callable=AsyncMock), \
             patch(_PATCH_DISPATCH, new_callable=AsyncMock):
            result = await create_assignment_submission(
                mock_request, assignment.assignment_uuid, regular_user, db
            )
        assert result.submission_status == AssignmentUserSubmissionStatus.SUBMITTED

    async def test_student_on_due_date_today_is_submitted_not_late(
        self, mock_request, db, assignment, course, activity, regular_user
    ):
        """Boundary: a date-only deadline of TODAY keeps the whole day open.

        The student submitting on the due day is accepted as SUBMITTED (not
        rejected and not flagged LATE) because the cutoff is shifted to the
        following midnight.
        """
        today = datetime.now().date().isoformat()
        await self._set_due(db, assignment, today)
        trail = await self._make_trail(db, course, regular_user)
        with patch(_PATCH_RBAC, new_callable=AsyncMock), \
             patch(_PATCH_TRAIL_PRESENCE, new_callable=AsyncMock, return_value=trail), \
             patch(_PATCH_AUTH_ROLES, new_callable=AsyncMock, return_value=False), \
             patch(_PATCH_CERT, new_callable=AsyncMock), \
             patch(_PATCH_CERT_CHECK, new_callable=AsyncMock), \
             patch(_PATCH_TRACK, new_callable=AsyncMock), \
             patch(_PATCH_DISPATCH, new_callable=AsyncMock):
            result = await create_assignment_submission(
                mock_request, assignment.assignment_uuid, regular_user, db
            )
        assert result.submission_status == AssignmentUserSubmissionStatus.SUBMITTED

    async def test_student_after_due_with_datetime_is_rejected_403(
        self, mock_request, db, assignment, course, activity, regular_user
    ):
        """Student submitting after a past datetime deadline -> 403, not LATE.

        Confirms the gate fires for a datetime (with time component) deadline,
        and that the outcome is rejection rather than a stored LATE submission.
        """
        await self._set_due(db, assignment, "2000-06-15T12:00:00")
        with patch(_PATCH_RBAC, new_callable=AsyncMock), \
             patch(_PATCH_AUTH_ROLES, new_callable=AsyncMock, return_value=False), \
             patch(_PATCH_TRACK, new_callable=AsyncMock), \
             patch(_PATCH_DISPATCH, new_callable=AsyncMock):
            with pytest.raises(HTTPException) as exc:
                await create_assignment_submission(
                    mock_request, assignment.assignment_uuid, regular_user, db
                )
        assert exc.value.status_code == 403
        assert "deadline has passed" in exc.value.detail

    async def test_student_after_yesterday_date_only_is_rejected_403(
        self, mock_request, db, assignment, course, activity, regular_user
    ):
        """A date-only deadline of yesterday is past (cutoff = today midnight),
        so a student submission today is rejected with 403."""
        yesterday = (datetime.now() - timedelta(days=1)).date().isoformat()
        await self._set_due(db, assignment, yesterday)
        with patch(_PATCH_RBAC, new_callable=AsyncMock), \
             patch(_PATCH_AUTH_ROLES, new_callable=AsyncMock, return_value=False), \
             patch(_PATCH_TRACK, new_callable=AsyncMock), \
             patch(_PATCH_DISPATCH, new_callable=AsyncMock):
            with pytest.raises(HTTPException) as exc:
                await create_assignment_submission(
                    mock_request, assignment.assignment_uuid, regular_user, db
                )
        assert exc.value.status_code == 403
        assert "deadline has passed" in exc.value.detail

    async def test_student_with_whitespace_only_due_date_is_submitted(
        self, mock_request, db, assignment, course, activity, regular_user
    ):
        """A whitespace-only due_date is treated as no deadline -> SUBMITTED.

        Existing tests cover the empty-string variant on the create path; this
        pins the whitespace-only variant. (NB: the due_date column is NOT NULL,
        so a literal None cannot be persisted on a real assignment row — the
        None case is exercised at the unit level instead.)
        """
        await self._set_due(db, assignment, "   ")
        trail = await self._make_trail(db, course, regular_user)
        with patch(_PATCH_RBAC, new_callable=AsyncMock), \
             patch(_PATCH_TRAIL_PRESENCE, new_callable=AsyncMock, return_value=trail), \
             patch(_PATCH_AUTH_ROLES, new_callable=AsyncMock, return_value=False), \
             patch(_PATCH_CERT, new_callable=AsyncMock), \
             patch(_PATCH_CERT_CHECK, new_callable=AsyncMock), \
             patch(_PATCH_TRACK, new_callable=AsyncMock), \
             patch(_PATCH_DISPATCH, new_callable=AsyncMock):
            result = await create_assignment_submission(
                mock_request, assignment.assignment_uuid, regular_user, db
            )
        assert result.submission_status == AssignmentUserSubmissionStatus.SUBMITTED

    async def test_student_with_malformed_due_date_is_submitted(
        self, mock_request, db, assignment, course, activity, regular_user
    ):
        """A malformed due_date must not lock students out.

        The parser returns False for an unparseable string, so the deadline gate
        is skipped and the submission succeeds as SUBMITTED (graceful, no crash).
        """
        await self._set_due(db, assignment, "not-a-real-date")
        trail = await self._make_trail(db, course, regular_user)
        with patch(_PATCH_RBAC, new_callable=AsyncMock), \
             patch(_PATCH_TRAIL_PRESENCE, new_callable=AsyncMock, return_value=trail), \
             patch(_PATCH_AUTH_ROLES, new_callable=AsyncMock, return_value=False), \
             patch(_PATCH_CERT, new_callable=AsyncMock), \
             patch(_PATCH_CERT_CHECK, new_callable=AsyncMock), \
             patch(_PATCH_TRACK, new_callable=AsyncMock), \
             patch(_PATCH_DISPATCH, new_callable=AsyncMock):
            result = await create_assignment_submission(
                mock_request, assignment.assignment_uuid, regular_user, db
            )
        assert result.submission_status == AssignmentUserSubmissionStatus.SUBMITTED
