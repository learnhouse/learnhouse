"""Net-new access-control / permission edge-case tests for the assignment service.

Target: src/services/courses/activities/assignments.py

These tests focus on the *wiring* of the two authorization guards, NOT on
re-implementing RBAC:

  1. ``_block_api_tokens`` — an early guard that rejects ``APITokenUser`` with
     HTTP 403 on every sensitive action. We assert it fires BEFORE any RBAC /
     DB work, so an API token is rejected even when ``check_resource_access``
     is patched to pass (proving the block is the thing doing the rejecting).

  2. ``check_resource_access`` — the per-course RBAC gate. We patch it to raise
     ``HTTPException(403)`` and assert each mutating action propagates that
     denial (a student with no instructor rights cannot grade, create, update,
     delete, or submit). When patched to pass, the happy path proceeds.

  3. Ownership checks layered on top of RBAC in ``get_grade_assignment_submission``
     (a non-instructor can only read THEIR OWN grade) and the past-due gate in
     ``create_assignment_submission`` (a non-instructor student is blocked after
     the deadline even when RBAC passes).

Existing coverage we deliberately do NOT duplicate:
  * ``test_assignments_service.py::TestBlockApiTokens`` — tests the helper in
    isolation only (raises for token user, passes for public user).
  * ``test_api_token_access.py`` — asserts the *router* is in the protected
    list; it does not exercise the service functions' inline guard.
"""

from datetime import datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from src.db.courses.assignments import (
    AssignmentCreate,
    AssignmentUpdate,
    GradingTypeEnum,
)
from src.db.users import APITokenUser
from src.services.courses.activities.assignments import (
    create_assignment,
    create_assignment_submission,
    delete_assignment,
    get_grade_assignment_submission,
    grade_assignment_submission,
    mark_activity_as_done_for_user,
    retry_assignment_submission,
    update_assignment,
)

# The assignment / submission / task fixtures come from the services-level
# conftest.py (auto-discovered) — no cross-module import needed.

_PATCH_RBAC = "src.services.courses.activities.assignments.check_resource_access"
_PATCH_LIMITS = "src.services.courses.activities.assignments.check_limits_with_usage"
_PATCH_INCREASE = "src.services.courses.activities.assignments.increase_feature_usage"
_PATCH_DECREASE = "src.services.courses.activities.assignments.decrease_feature_usage"
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


@pytest.fixture
def api_token_user():
    """An APITokenUser scoped to the test org (id mirrors the org fixture)."""
    return APITokenUser(id=999, org_id=1)


def _rbac_denied():
    """A check_resource_access mock that simulates an RBAC denial (403)."""
    return AsyncMock(
        side_effect=HTTPException(status_code=403, detail="Access denied")
    )


# ===========================================================================
# 1. _block_api_tokens fires on every sensitive action — BEFORE RBAC
# ===========================================================================


class TestApiTokensBlockedOnSensitiveActions:
    """An APITokenUser must be rejected with 403 on each action that calls
    ``_block_api_tokens``. RBAC is patched to PASS so the only thing that can
    raise is the token guard — proving the guard is wired in and runs first.
    """

    async def test_create_assignment_blocks_api_token(
        self, mock_request, db, org, course, chapter, activity, api_token_user
    ):
        """create_assignment rejects an APITokenUser with 403 (the _block_api_tokens guard) even when RBAC passes."""
        obj = AssignmentCreate(
            title="T",
            description="D",
            due_date="2030-01-01",
            grading_type=GradingTypeEnum.NUMERIC,
            org_id=org.id,
            course_id=course.id,
            chapter_id=chapter.id,
            activity_id=activity.id,
        )
        with patch(_PATCH_RBAC, new_callable=AsyncMock), \
             patch(_PATCH_LIMITS, new_callable=AsyncMock), \
             patch(_PATCH_INCREASE, new_callable=AsyncMock):
            with pytest.raises(HTTPException) as exc:
                await create_assignment(mock_request, obj, api_token_user, db)
        assert exc.value.status_code == 403
        assert "API tokens" in exc.value.detail

    async def test_update_assignment_blocks_api_token(
        self, mock_request, db, assignment, api_token_user
    ):
        """update_assignment rejects an APITokenUser with 403 (the _block_api_tokens guard)."""
        with patch(_PATCH_RBAC, new_callable=AsyncMock):
            with pytest.raises(HTTPException) as exc:
                await update_assignment(
                    mock_request,
                    assignment.assignment_uuid,
                    AssignmentUpdate(title="X"),
                    api_token_user,
                    db,
                )
        assert exc.value.status_code == 403

    async def test_delete_assignment_blocks_api_token(
        self, mock_request, db, assignment, api_token_user
    ):
        """delete_assignment rejects an APITokenUser with 403 (the _block_api_tokens guard)."""
        with patch(_PATCH_RBAC, new_callable=AsyncMock), \
             patch(_PATCH_DECREASE, new_callable=AsyncMock):
            with pytest.raises(HTTPException) as exc:
                await delete_assignment(
                    mock_request, assignment.assignment_uuid, api_token_user, db
                )
        assert exc.value.status_code == 403

    async def test_grade_assignment_submission_blocks_api_token(
        self, mock_request, db, assignment, user_submission, api_token_user, regular_user
    ):
        """grade_assignment_submission rejects an APITokenUser with 403 (the _block_api_tokens guard)."""
        with patch(_PATCH_RBAC, new_callable=AsyncMock):
            with pytest.raises(HTTPException) as exc:
                await grade_assignment_submission(
                    mock_request,
                    regular_user.id,
                    assignment.assignment_uuid,
                    api_token_user,
                    db,
                )
        assert exc.value.status_code == 403

    async def test_get_grade_blocks_api_token(
        self, mock_request, db, assignment, graded_submission, api_token_user, regular_user
    ):
        """get_grade_assignment_submission rejects an APITokenUser with 403 (the _block_api_tokens guard)."""
        with patch(_PATCH_RBAC, new_callable=AsyncMock), \
             patch(_PATCH_AUTH_ROLES, new_callable=AsyncMock, return_value=True):
            with pytest.raises(HTTPException) as exc:
                await get_grade_assignment_submission(
                    mock_request,
                    regular_user.id,
                    assignment.assignment_uuid,
                    api_token_user,
                    db,
                )
        assert exc.value.status_code == 403

    async def test_create_submission_blocks_api_token(
        self, mock_request, db, assignment, api_token_user
    ):
        """create_assignment_submission rejects an APITokenUser with 403 (the _block_api_tokens guard)."""
        with patch(_PATCH_RBAC, new_callable=AsyncMock), \
             patch(_PATCH_AUTH_ROLES, new_callable=AsyncMock, return_value=False):
            with pytest.raises(HTTPException) as exc:
                await create_assignment_submission(
                    mock_request, assignment.assignment_uuid, api_token_user, db
                )
        assert exc.value.status_code == 403

    async def test_retry_submission_blocks_api_token(
        self, mock_request, db, assignment, api_token_user
    ):
        """retry_assignment_submission rejects an APITokenUser with 403 (the _block_api_tokens guard)."""
        with patch(_PATCH_RBAC, new_callable=AsyncMock):
            with pytest.raises(HTTPException) as exc:
                await retry_assignment_submission(
                    mock_request, assignment.assignment_uuid, api_token_user, db
                )
        assert exc.value.status_code == 403

    async def test_mark_done_blocks_api_token(
        self, mock_request, db, assignment, api_token_user, regular_user
    ):
        """mark_activity_as_done_for_user rejects an APITokenUser with 403 (the _block_api_tokens guard)."""
        with patch(_PATCH_RBAC, new_callable=AsyncMock):
            with pytest.raises(HTTPException) as exc:
                await mark_activity_as_done_for_user(
                    mock_request,
                    regular_user.id,
                    assignment.assignment_uuid,
                    api_token_user,
                    db,
                )
        assert exc.value.status_code == 403

    async def test_block_runs_before_rbac(
        self, mock_request, db, assignment, api_token_user
    ):
        """The token guard must fire even when RBAC would have *denied* too:
        ``check_resource_access`` is set to raise, but we never reach it, so the
        recorded 403 is the API-token one, and the RBAC mock is never awaited.
        """
        rbac = _rbac_denied()
        with patch(_PATCH_RBAC, rbac):
            with pytest.raises(HTTPException) as exc:
                await update_assignment(
                    mock_request,
                    assignment.assignment_uuid,
                    AssignmentUpdate(title="X"),
                    api_token_user,
                    db,
                )
        assert exc.value.status_code == 403
        assert "API tokens" in exc.value.detail
        rbac.assert_not_awaited()


# ===========================================================================
# 2. check_resource_access denial propagates (student lacks permission)
# ===========================================================================


class TestRbacDenialPropagates:
    """When ``check_resource_access`` raises 403 (no permission), each mutating
    action must propagate that denial rather than proceeding. We use a real
    ``regular_user`` (a student) so this models a student attempting a
    teacher-only operation.
    """

    async def test_create_assignment_propagates_denial(
        self, mock_request, db, org, course, chapter, activity, regular_user
    ):
        """create_assignment propagates a check_resource_access 403 denial (a student cannot create)."""
        obj = AssignmentCreate(
            title="T",
            description="D",
            due_date="2030-01-01",
            grading_type=GradingTypeEnum.NUMERIC,
            org_id=org.id,
            course_id=course.id,
            chapter_id=chapter.id,
            activity_id=activity.id,
        )
        with patch(_PATCH_RBAC, _rbac_denied()), \
             patch(_PATCH_LIMITS, new_callable=AsyncMock), \
             patch(_PATCH_INCREASE, new_callable=AsyncMock):
            with pytest.raises(HTTPException) as exc:
                await create_assignment(mock_request, obj, regular_user, db)
        assert exc.value.status_code == 403

    async def test_update_assignment_propagates_denial(
        self, mock_request, db, assignment, regular_user
    ):
        """update_assignment propagates a check_resource_access 403 denial (a student cannot update)."""
        with patch(_PATCH_RBAC, _rbac_denied()):
            with pytest.raises(HTTPException) as exc:
                await update_assignment(
                    mock_request,
                    assignment.assignment_uuid,
                    AssignmentUpdate(title="X"),
                    regular_user,
                    db,
                )
        assert exc.value.status_code == 403

    async def test_delete_assignment_propagates_denial(
        self, mock_request, db, assignment, regular_user
    ):
        """delete_assignment propagates a check_resource_access 403 denial (a student cannot delete)."""
        with patch(_PATCH_RBAC, _rbac_denied()), \
             patch(_PATCH_DECREASE, new_callable=AsyncMock):
            with pytest.raises(HTTPException) as exc:
                await delete_assignment(
                    mock_request, assignment.assignment_uuid, regular_user, db
                )
        assert exc.value.status_code == 403

    async def test_student_cannot_grade(
        self, mock_request, db, assignment, user_submission, regular_user
    ):
        """Grading requires AccessAction.UPDATE. A student fails that gate, so
        ``grade_assignment_submission`` must raise 403 — proving grading is
        teacher-only at the service layer."""
        with patch(_PATCH_RBAC, _rbac_denied()):
            with pytest.raises(HTTPException) as exc:
                await grade_assignment_submission(
                    mock_request,
                    regular_user.id,
                    assignment.assignment_uuid,
                    regular_user,
                    db,
                )
        assert exc.value.status_code == 403

    async def test_mark_done_propagates_denial(
        self, mock_request, db, assignment, regular_user
    ):
        """Marking an activity done for a user requires UPDATE access."""
        with patch(_PATCH_RBAC, _rbac_denied()):
            with pytest.raises(HTTPException) as exc:
                await mark_activity_as_done_for_user(
                    mock_request,
                    regular_user.id,
                    assignment.assignment_uuid,
                    regular_user,
                    db,
                )
        assert exc.value.status_code == 403


# ===========================================================================
# 3. Grading allowed when RBAC passes (instructor happy path)
# ===========================================================================


class TestGradingAllowedWhenAccessPasses:
    async def test_instructor_can_grade(
        self,
        mock_request,
        db,
        assignment,
        assignment_task,
        user_submission,
        task_submission,
        admin_user,
        regular_user,
    ):
        """With ``check_resource_access`` passing (instructor), grading runs to
        completion and returns a computed grade payload."""
        with patch(_PATCH_RBAC, new_callable=AsyncMock), \
             patch(_PATCH_DISPATCH, new_callable=AsyncMock), \
             patch(_PATCH_TRACK, new_callable=AsyncMock), \
             patch(_PATCH_CERT, new_callable=AsyncMock):
            result = await grade_assignment_submission(
                mock_request,
                regular_user.id,
                assignment.assignment_uuid,
                admin_user,
                db,
            )
        assert "display_grade" in result


# ===========================================================================
# 4. get_grade ownership gate (RBAC READ passes, but non-instructor scoping)
# ===========================================================================


class TestGetGradeOwnershipGate:
    """``get_grade_assignment_submission`` layers an ownership check on top of
    the RBAC READ gate: a non-instructor may only view their OWN grade. RBAC is
    patched to pass so we isolate the ownership logic.
    """

    async def test_non_instructor_cannot_read_other_users_grade(
        self, mock_request, db, assignment, graded_submission, admin_user, regular_user
    ):
        """regular_user (id 2) tries to read admin_user's (id 1) grade while
        not an instructor → 403 "You can only view your own grade"."""
        with patch(_PATCH_RBAC, new_callable=AsyncMock), \
             patch(_PATCH_AUTH_ROLES, new_callable=AsyncMock, return_value=False):
            with pytest.raises(HTTPException) as exc:
                await get_grade_assignment_submission(
                    mock_request,
                    admin_user.id,  # someone else's grade
                    assignment.assignment_uuid,
                    regular_user,
                    db,
                )
        assert exc.value.status_code == 403
        assert "your own grade" in exc.value.detail

    async def test_non_instructor_can_read_own_grade(
        self, mock_request, db, assignment, assignment_task, graded_submission, task_submission, regular_user
    ):
        """Same student reading their OWN grade is allowed even when not an
        instructor."""
        with patch(_PATCH_RBAC, new_callable=AsyncMock), \
             patch(_PATCH_AUTH_ROLES, new_callable=AsyncMock, return_value=False):
            result = await get_grade_assignment_submission(
                mock_request,
                regular_user.id,  # their own grade
                assignment.assignment_uuid,
                regular_user,
                db,
            )
        assert "display_grade" in result

    async def test_instructor_can_read_any_grade(
        self, mock_request, db, assignment, assignment_task, graded_submission, task_submission, admin_user, regular_user
    ):
        """An instructor (authorization role 'update' → True) may read another
        user's grade regardless of ownership."""
        with patch(_PATCH_RBAC, new_callable=AsyncMock), \
             patch(_PATCH_AUTH_ROLES, new_callable=AsyncMock, return_value=True):
            result = await get_grade_assignment_submission(
                mock_request,
                regular_user.id,
                assignment.assignment_uuid,
                admin_user,
                db,
            )
        assert "display_grade" in result


# ===========================================================================
# 5. create_assignment_submission past-due gate (RBAC READ passes)
# ===========================================================================


class TestSubmissionPastDueGate:
    """A student submitting after the deadline is blocked (403) even though the
    RBAC READ gate passes — the deadline is enforced only for non-instructors.
    """

    async def test_student_blocked_after_due_date(
        self, mock_request, db, org, course, chapter, activity, regular_user
    ):
        """create_assignment_submission blocks a non-instructor student after the due date with 403, even when RBAC passes."""
        from src.db.courses.assignments import Assignment

        past = (datetime.now() - timedelta(days=2)).isoformat()
        a = Assignment(
            id=77,
            title="Past Due",
            description="d",
            due_date=past,
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
            assignment_uuid="assignment_pastdue",
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(a)
        await db.commit()
        await db.refresh(a)

        # RBAC READ passes; non-instructor → past-due check fires.
        with patch(_PATCH_RBAC, new_callable=AsyncMock), \
             patch(_PATCH_AUTH_ROLES, new_callable=AsyncMock, return_value=False), \
             patch(_PATCH_TRAIL_PRESENCE, new_callable=AsyncMock), \
             patch(_PATCH_CERT, new_callable=AsyncMock), \
             patch(_PATCH_TRACK, new_callable=AsyncMock), \
             patch(_PATCH_DISPATCH, new_callable=AsyncMock):
            with pytest.raises(HTTPException) as exc:
                await create_assignment_submission(
                    mock_request, a.assignment_uuid, regular_user, db
                )
        assert exc.value.status_code == 403
