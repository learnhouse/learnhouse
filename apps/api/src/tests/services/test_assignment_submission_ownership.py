"""Ownership gates on assignment submission and grade reads.

A course READ is granted to any reader of a public/published course, so the
per-user submission and grade reads must also check that the caller either owns
the submission or has instructor (grading) rights on the course. Listing every
submission for a task is instructor-only.
"""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from src.security.rbac.types import AccessAction
from src.services.courses.activities.assignments import (
    get_grade_assignment_submission,
    read_assignment_task_submissions,
    read_user_assignment_submissions,
    read_user_assignment_task_submissions,
)

_PATCH_RBAC = "src.services.courses.activities.assignments.check_resource_access"
_PATCH_AUTH_ROLES = (
    "src.services.courses.activities.assignments.authorization_verify_based_on_roles"
)


class TestGetGradeOwnership:
    async def test_non_instructor_cannot_read_other_users_grade(
        self, mock_request, db, assignment, graded_submission, admin_user, regular_user
    ):
        rbac = AsyncMock()
        with patch(_PATCH_RBAC, rbac), \
             patch(_PATCH_AUTH_ROLES, new_callable=AsyncMock, return_value=False):
            with pytest.raises(HTTPException) as exc:
                await get_grade_assignment_submission(
                    mock_request, regular_user.id, assignment.assignment_uuid, admin_user, db
                )
        assert exc.value.status_code == 403
        rbac.assert_awaited()

    async def test_owner_can_read_own_grade(
        self, mock_request, db, assignment, graded_submission, regular_user
    ):
        with patch(_PATCH_RBAC, new_callable=AsyncMock), \
             patch(_PATCH_AUTH_ROLES, new_callable=AsyncMock, return_value=False):
            result = await get_grade_assignment_submission(
                mock_request, regular_user.id, assignment.assignment_uuid, regular_user, db
            )
        assert "display_grade" in result

    async def test_course_read_denial_propagates(
        self, mock_request, db, assignment, graded_submission, regular_user
    ):
        denied = AsyncMock(side_effect=HTTPException(status_code=403, detail="denied"))
        with patch(_PATCH_RBAC, denied), \
             patch(_PATCH_AUTH_ROLES, new_callable=AsyncMock, return_value=False):
            with pytest.raises(HTTPException) as exc:
                await get_grade_assignment_submission(
                    mock_request, regular_user.id, assignment.assignment_uuid, regular_user, db
                )
        assert exc.value.status_code == 403


class TestReadUserAssignmentSubmissionsOwnership:
    async def test_non_instructor_cannot_read_other_users_submissions(
        self, mock_request, db, assignment, user_submission, admin_user, regular_user
    ):
        with patch(_PATCH_RBAC, new_callable=AsyncMock), \
             patch(_PATCH_AUTH_ROLES, new_callable=AsyncMock, return_value=False):
            with pytest.raises(HTTPException) as exc:
                await read_user_assignment_submissions(
                    mock_request, assignment.assignment_uuid, regular_user.id, admin_user, db
                )
        assert exc.value.status_code == 403

    async def test_owner_can_read_own_submissions(
        self, mock_request, db, assignment, user_submission, regular_user
    ):
        with patch(_PATCH_RBAC, new_callable=AsyncMock), \
             patch(_PATCH_AUTH_ROLES, new_callable=AsyncMock, return_value=False):
            result = await read_user_assignment_submissions(
                mock_request, assignment.assignment_uuid, regular_user.id, regular_user, db
            )
        assert len(result) == 1


class TestReadUserAssignmentTaskSubmissionsOwnership:
    async def test_non_instructor_cannot_read_other_users_task_submission(
        self, mock_request, db, assignment_task, task_submission, admin_user, regular_user
    ):
        with patch(_PATCH_RBAC, new_callable=AsyncMock), \
             patch(_PATCH_AUTH_ROLES, new_callable=AsyncMock, return_value=False):
            with pytest.raises(HTTPException) as exc:
                await read_user_assignment_task_submissions(
                    mock_request,
                    assignment_task.assignment_task_uuid,
                    regular_user.id,
                    admin_user,
                    db,
                )
        assert exc.value.status_code == 403

    async def test_owner_can_read_own_task_submission(
        self, mock_request, db, assignment_task, task_submission, regular_user
    ):
        with patch(_PATCH_RBAC, new_callable=AsyncMock), \
             patch(_PATCH_AUTH_ROLES, new_callable=AsyncMock, return_value=False):
            result = await read_user_assignment_task_submissions(
                mock_request,
                assignment_task.assignment_task_uuid,
                regular_user.id,
                regular_user,
                db,
            )
        assert result.assignment_task_submission_uuid == task_submission.assignment_task_submission_uuid


class TestReadAssignmentTaskSubmissionsInstructorOnly:
    async def test_requires_course_update(
        self, mock_request, db, assignment_task, task_submission, regular_user
    ):
        rbac = AsyncMock()
        with patch(_PATCH_RBAC, rbac):
            await read_assignment_task_submissions(
                mock_request, assignment_task.assignment_task_uuid, regular_user, db
            )
        assert rbac.await_args.args[4] == AccessAction.UPDATE

    async def test_reader_without_update_is_denied(
        self, mock_request, db, assignment_task, task_submission, regular_user
    ):
        denied = AsyncMock(side_effect=HTTPException(status_code=403, detail="denied"))
        with patch(_PATCH_RBAC, denied):
            with pytest.raises(HTTPException) as exc:
                await read_assignment_task_submissions(
                    mock_request, assignment_task.assignment_task_uuid, regular_user, db
                )
        assert exc.value.status_code == 403
