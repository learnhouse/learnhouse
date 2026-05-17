"""Tests for src/services/courses/activities/assignments.py (CRUD operations).

Covers the newly-async CRUD functions that were migrated from sync SQLModel
Session to AsyncSession in this PR:
  create_assignment, read_assignment, read_assignment_from_activity_uuid,
  update_assignment, delete_assignment, delete_assignment_from_activity_uuid,
  create_assignment_task, read_assignment_tasks, read_assignment_task,
  update_assignment_task, delete_assignment_task,
  handle_assignment_task_submission, read_assignment_submissions,
  read_user_assignment_submissions, read_user_assignment_submissions_me,
  update_assignment_submission, delete_assignment_submission,
  grade_assignment_submission, get_grade_assignment_submission,
  mark_activity_as_done_for_user, get_assignments_from_course,
  _block_api_tokens.
"""

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.courses.assignments import (
    Assignment,
    AssignmentCreate,
    AssignmentRead,
    AssignmentTask,
    AssignmentTaskCreate,
    AssignmentTaskRead,
    AssignmentTaskSubmission,
    AssignmentTaskSubmissionRead,
    AssignmentTaskSubmissionUpdate,
    AssignmentTaskTypeEnum,
    AssignmentUpdate,
    AssignmentUserSubmission,
    AssignmentUserSubmissionCreate,
    AssignmentUserSubmissionRead,
    AssignmentUserSubmissionStatus,
    GradingTypeEnum,
)
from src.db.courses.certifications import CertificateUser, Certifications
from src.db.trail_runs import TrailRun
from src.db.trail_steps import TrailStep
from src.db.trails import Trail
from src.db.users import APITokenUser
from src.services.courses.activities.assignments import (
    _block_api_tokens,
    create_assignment,
    create_assignment_submission,
    create_assignment_task,
    delete_assignment,
    delete_assignment_from_activity_uuid,
    delete_assignment_submission,
    delete_assignment_task,
    delete_assignment_task_submission,
    get_assignments_from_course,
    get_grade_assignment_submission,
    grade_assignment_submission,
    handle_assignment_task_submission,
    mark_activity_as_done_for_user,
    put_assignment_task_reference_file,
    put_assignment_task_submission_file,
    read_assignment,
    read_assignment_from_activity_uuid,
    read_assignment_submissions,
    read_assignment_task,
    read_assignment_task_submissions,
    read_assignment_tasks,
    read_user_assignment_submissions,
    read_user_assignment_submissions_me,
    read_user_assignment_task_submissions,
    read_user_assignment_task_submissions_me,
    read_user_assignment_task_submissions_me_batch,
    update_assignment,
    update_assignment_submission,
    update_assignment_task,
    update_assignment_task_submission,
)

# ---------------------------------------------------------------------------
# Module-level patches applied to all tests
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------


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


async def _make_trail(db, org_id, course_id, activity_id, user_id):
    trail = Trail(
        org_id=org_id,
        user_id=user_id,
        trail_uuid="trail_assign_test",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(trail)
    await db.commit()
    await db.refresh(trail)
    run = TrailRun(
        trail_id=trail.id,
        course_id=course_id,
        org_id=org_id,
        user_id=user_id,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)
    step = TrailStep(
        complete=False,
        teacher_verified=False,
        grade="",
        trailrun_id=run.id,
        trail_id=trail.id,
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
    return trail, run, step


# ---------------------------------------------------------------------------
# _block_api_tokens
# ---------------------------------------------------------------------------


class TestBlockApiTokens:
    def test_raises_403_for_api_token_user(self):
        token_user = APITokenUser(id=1, org_id=1)
        with pytest.raises(HTTPException) as exc:
            _block_api_tokens(token_user)
        assert exc.value.status_code == 403

    def test_passes_for_public_user(self, regular_user):
        _block_api_tokens(regular_user)  # should not raise


# ---------------------------------------------------------------------------
# create_assignment
# ---------------------------------------------------------------------------


class TestCreateAssignment:
    async def test_raises_404_when_course_not_found(
        self, mock_request, db, org, chapter, activity, admin_user
    ):
        obj = AssignmentCreate(
            title="T",
            description="D",
            due_date="2030-01-01",
            grading_type=GradingTypeEnum.NUMERIC,
            org_id=org.id,
            course_id=9999,
            chapter_id=chapter.id,
            activity_id=activity.id,
        )
        with patch(_PATCH_RBAC, new_callable=AsyncMock), \
             patch(_PATCH_LIMITS, new_callable=AsyncMock), \
             patch(_PATCH_INCREASE, new_callable=AsyncMock):
            with pytest.raises(HTTPException) as exc:
                await create_assignment(mock_request, obj, admin_user, db)
        assert exc.value.status_code == 404

    async def test_creates_assignment_successfully(
        self, mock_request, db, org, course, chapter, activity, admin_user
    ):
        obj = AssignmentCreate(
            title="New Assignment",
            description="Desc",
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
            result = await create_assignment(mock_request, obj, admin_user, db)
        assert isinstance(result, AssignmentRead)
        assert result.title == "New Assignment"


# ---------------------------------------------------------------------------
# read_assignment
# ---------------------------------------------------------------------------


class TestReadAssignment:
    async def test_raises_404_when_not_found(
        self, mock_request, db, admin_user
    ):
        with patch(_PATCH_RBAC, new_callable=AsyncMock):
            with pytest.raises(HTTPException) as exc:
                await read_assignment(mock_request, "nonexistent", admin_user, db)
        assert exc.value.status_code == 404

    async def test_returns_assignment_read(
        self, mock_request, db, assignment, admin_user
    ):
        with patch(_PATCH_RBAC, new_callable=AsyncMock):
            result = await read_assignment(
                mock_request, assignment.assignment_uuid, admin_user, db
            )
        assert isinstance(result, AssignmentRead)
        assert result.assignment_uuid == assignment.assignment_uuid


# ---------------------------------------------------------------------------
# read_assignment_from_activity_uuid
# ---------------------------------------------------------------------------


class TestReadAssignmentFromActivityUuid:
    async def test_raises_404_when_not_found(
        self, mock_request, db, admin_user
    ):
        with patch(_PATCH_RBAC, new_callable=AsyncMock):
            with pytest.raises(HTTPException) as exc:
                await read_assignment_from_activity_uuid(
                    mock_request, "bad-uuid", admin_user, db
                )
        assert exc.value.status_code == 404

    async def test_returns_assignment_for_activity(
        self, mock_request, db, assignment, activity, admin_user
    ):
        with patch(_PATCH_RBAC, new_callable=AsyncMock):
            result = await read_assignment_from_activity_uuid(
                mock_request, activity.activity_uuid, admin_user, db
            )
        assert isinstance(result, AssignmentRead)
        assert result.activity_uuid == activity.activity_uuid


# ---------------------------------------------------------------------------
# update_assignment
# ---------------------------------------------------------------------------


class TestUpdateAssignment:
    async def test_raises_404_when_not_found(
        self, mock_request, db, admin_user
    ):
        with patch(_PATCH_RBAC, new_callable=AsyncMock):
            with pytest.raises(HTTPException) as exc:
                await update_assignment(
                    mock_request, "nonexistent", AssignmentUpdate(title="X"), admin_user, db
                )
        assert exc.value.status_code == 404

    async def test_updates_assignment_title(
        self, mock_request, db, assignment, admin_user
    ):
        with patch(_PATCH_RBAC, new_callable=AsyncMock):
            result = await update_assignment(
                mock_request,
                assignment.assignment_uuid,
                AssignmentUpdate(title="Updated Title"),
                admin_user,
                db,
            )
        assert result.title == "Updated Title"


# ---------------------------------------------------------------------------
# delete_assignment
# ---------------------------------------------------------------------------


class TestDeleteAssignment:
    async def test_raises_404_when_not_found(
        self, mock_request, db, admin_user
    ):
        with patch(_PATCH_RBAC, new_callable=AsyncMock), \
             patch(_PATCH_DECREASE, new_callable=AsyncMock):
            with pytest.raises(HTTPException) as exc:
                await delete_assignment(mock_request, "nonexistent", admin_user, db)
        assert exc.value.status_code == 404

    async def test_deletes_assignment(
        self, mock_request, db, assignment, admin_user
    ):
        with patch(_PATCH_RBAC, new_callable=AsyncMock), \
             patch(_PATCH_DECREASE, new_callable=AsyncMock):
            result = await delete_assignment(
                mock_request, assignment.assignment_uuid, admin_user, db
            )
        assert result["message"] == "Assignment deleted"
        remaining = (await db.execute(
            select(Assignment).where(Assignment.id == assignment.id)
        )).scalars().first()
        assert remaining is None


# ---------------------------------------------------------------------------
# delete_assignment_from_activity_uuid
# ---------------------------------------------------------------------------


class TestDeleteAssignmentFromActivityUuid:
    async def test_raises_404_when_activity_not_found(
        self, mock_request, db, admin_user
    ):
        with patch(_PATCH_RBAC, new_callable=AsyncMock), \
             patch(_PATCH_DECREASE, new_callable=AsyncMock):
            with pytest.raises(HTTPException) as exc:
                await delete_assignment_from_activity_uuid(
                    mock_request, "nonexistent-activity", admin_user, db
                )
        assert exc.value.status_code == 404

    async def test_raises_404_when_assignment_not_found(
        self, mock_request, db, activity, admin_user
    ):
        with patch(_PATCH_RBAC, new_callable=AsyncMock), \
             patch(_PATCH_DECREASE, new_callable=AsyncMock):
            with pytest.raises(HTTPException) as exc:
                await delete_assignment_from_activity_uuid(
                    mock_request, activity.activity_uuid, admin_user, db
                )
        assert exc.value.status_code == 404

    async def test_deletes_assignment_by_activity_uuid(
        self, mock_request, db, assignment, activity, admin_user
    ):
        with patch(_PATCH_RBAC, new_callable=AsyncMock), \
             patch(_PATCH_DECREASE, new_callable=AsyncMock):
            result = await delete_assignment_from_activity_uuid(
                mock_request, activity.activity_uuid, admin_user, db
            )
        assert result["message"] == "Assignment deleted"


# ---------------------------------------------------------------------------
# create_assignment_task
# ---------------------------------------------------------------------------


class TestCreateAssignmentTask:
    async def test_raises_404_when_assignment_not_found(
        self, mock_request, db, admin_user
    ):
        obj = AssignmentTaskCreate(
            title="T",
            description="D",
            hint="",
            assignment_type=AssignmentTaskTypeEnum.SHORT_ANSWER,
            contents={},
            max_grade_value=10,
        )
        with patch(_PATCH_RBAC, new_callable=AsyncMock):
            with pytest.raises(HTTPException) as exc:
                await create_assignment_task(mock_request, "nonexistent", obj, admin_user, db)
        assert exc.value.status_code == 404

    async def test_creates_task_successfully(
        self, mock_request, db, assignment, admin_user
    ):
        obj = AssignmentTaskCreate(
            title="New Task",
            description="Desc",
            hint="",
            assignment_type=AssignmentTaskTypeEnum.SHORT_ANSWER,
            contents={"prompt": "x"},
            max_grade_value=50,
        )
        with patch(_PATCH_RBAC, new_callable=AsyncMock):
            result = await create_assignment_task(
                mock_request, assignment.assignment_uuid, obj, admin_user, db
            )
        assert isinstance(result, AssignmentTaskRead)
        assert result.title == "New Task"


# ---------------------------------------------------------------------------
# read_assignment_tasks
# ---------------------------------------------------------------------------


class TestReadAssignmentTasks:
    async def test_raises_404_when_assignment_not_found(
        self, mock_request, db, admin_user
    ):
        with patch(_PATCH_RBAC, new_callable=AsyncMock):
            with pytest.raises(HTTPException) as exc:
                await read_assignment_tasks(mock_request, "nonexistent", admin_user, db)
        assert exc.value.status_code == 404

    async def test_returns_task_list(
        self, mock_request, db, assignment, assignment_task, admin_user
    ):
        with patch(_PATCH_RBAC, new_callable=AsyncMock):
            result = await read_assignment_tasks(
                mock_request, assignment.assignment_uuid, admin_user, db
            )
        assert isinstance(result, list)
        assert len(result) == 1
        assert result[0].assignment_task_uuid == assignment_task.assignment_task_uuid


# ---------------------------------------------------------------------------
# read_assignment_task
# ---------------------------------------------------------------------------


class TestReadAssignmentTask:
    async def test_raises_404_when_task_not_found(
        self, mock_request, db, admin_user
    ):
        with patch(_PATCH_RBAC, new_callable=AsyncMock):
            with pytest.raises(HTTPException) as exc:
                await read_assignment_task(mock_request, "nonexistent", admin_user, db)
        assert exc.value.status_code == 404

    async def test_returns_task(
        self, mock_request, db, assignment_task, admin_user
    ):
        with patch(_PATCH_RBAC, new_callable=AsyncMock):
            result = await read_assignment_task(
                mock_request, assignment_task.assignment_task_uuid, admin_user, db
            )
        assert isinstance(result, AssignmentTaskRead)
        assert result.assignment_task_uuid == assignment_task.assignment_task_uuid


# ---------------------------------------------------------------------------
# update_assignment_task
# ---------------------------------------------------------------------------


class TestUpdateAssignmentTask:
    async def test_raises_404_when_task_not_found(
        self, mock_request, db, admin_user
    ):
        from src.db.courses.assignments import AssignmentTaskUpdate
        with patch(_PATCH_RBAC, new_callable=AsyncMock):
            with pytest.raises(HTTPException) as exc:
                await update_assignment_task(
                    mock_request, "nonexistent", AssignmentTaskUpdate(title="X"), admin_user, db
                )
        assert exc.value.status_code == 404

    async def test_updates_task_title(
        self, mock_request, db, assignment_task, admin_user
    ):
        from src.db.courses.assignments import AssignmentTaskUpdate
        with patch(_PATCH_RBAC, new_callable=AsyncMock):
            result = await update_assignment_task(
                mock_request,
                assignment_task.assignment_task_uuid,
                AssignmentTaskUpdate(title="Updated Task"),
                admin_user,
                db,
            )
        assert result.title == "Updated Task"


# ---------------------------------------------------------------------------
# delete_assignment_task
# ---------------------------------------------------------------------------


class TestDeleteAssignmentTask:
    async def test_raises_404_when_task_not_found(
        self, mock_request, db, admin_user
    ):
        with patch(_PATCH_RBAC, new_callable=AsyncMock):
            with pytest.raises(HTTPException) as exc:
                await delete_assignment_task(mock_request, "nonexistent", admin_user, db)
        assert exc.value.status_code == 404

    async def test_deletes_task(
        self, mock_request, db, assignment_task, admin_user
    ):
        with patch(_PATCH_RBAC, new_callable=AsyncMock):
            result = await delete_assignment_task(
                mock_request, assignment_task.assignment_task_uuid, admin_user, db
            )
        assert result["message"] == "Assignment Task deleted"


# ---------------------------------------------------------------------------
# handle_assignment_task_submission
# ---------------------------------------------------------------------------


class TestHandleAssignmentTaskSubmission:
    async def test_raises_404_when_task_not_found(
        self, mock_request, db, regular_user
    ):
        obj = AssignmentTaskSubmissionUpdate(
            task_submission={"answer": "x"},
        )
        with patch(_PATCH_RBAC, new_callable=AsyncMock), \
             patch(_PATCH_AUTH_ROLES, new_callable=AsyncMock, return_value=True):
            with pytest.raises(HTTPException) as exc:
                await handle_assignment_task_submission(
                    mock_request, "nonexistent", obj, regular_user, db
                )
        assert exc.value.status_code == 404

    async def test_creates_new_submission(
        self, mock_request, db, assignment_task, regular_user
    ):
        obj = AssignmentTaskSubmissionUpdate(
            task_submission={"answer": "hello"},
        )
        # First call: is_instructor check → False
        # Second call: enrollment check → True (user is enrolled)
        with patch(_PATCH_RBAC, new_callable=AsyncMock), \
             patch(_PATCH_AUTH_ROLES, new_callable=AsyncMock, side_effect=[False, True]):
            result = await handle_assignment_task_submission(
                mock_request, assignment_task.assignment_task_uuid, obj, regular_user, db
            )
        assert isinstance(result, AssignmentTaskSubmissionRead)

    async def test_updates_existing_submission(
        self, mock_request, db, assignment_task, task_submission, regular_user
    ):
        obj = AssignmentTaskSubmissionUpdate(
            task_submission={"answer": "updated"},
        )
        # is_instructor → False, enrollment → True
        with patch(_PATCH_RBAC, new_callable=AsyncMock), \
             patch(_PATCH_AUTH_ROLES, new_callable=AsyncMock, side_effect=[False, True]):
            result = await handle_assignment_task_submission(
                mock_request, assignment_task.assignment_task_uuid, obj, regular_user, db
            )
        assert isinstance(result, AssignmentTaskSubmissionRead)


# ---------------------------------------------------------------------------
# read_assignment_submissions
# ---------------------------------------------------------------------------


class TestReadAssignmentSubmissions:
    async def test_raises_404_when_assignment_not_found(
        self, mock_request, db, admin_user
    ):
        with patch(_PATCH_RBAC, new_callable=AsyncMock), \
             patch(_PATCH_AUTH_ROLES, new_callable=AsyncMock, return_value=True):
            with pytest.raises(HTTPException) as exc:
                await read_assignment_submissions(mock_request, "nonexistent", admin_user, db)
        assert exc.value.status_code == 404

    async def test_returns_submissions_list(
        self, mock_request, db, assignment, user_submission, admin_user
    ):
        with patch(_PATCH_RBAC, new_callable=AsyncMock), \
             patch(_PATCH_AUTH_ROLES, new_callable=AsyncMock, return_value=True):
            result = await read_assignment_submissions(
                mock_request, assignment.assignment_uuid, admin_user, db
            )
        assert isinstance(result, list)
        assert len(result) == 1


# ---------------------------------------------------------------------------
# read_user_assignment_submissions
# ---------------------------------------------------------------------------


class TestReadUserAssignmentSubmissions:
    async def test_raises_404_when_assignment_not_found(
        self, mock_request, db, admin_user
    ):
        with patch(_PATCH_RBAC, new_callable=AsyncMock), \
             patch(_PATCH_AUTH_ROLES, new_callable=AsyncMock, return_value=True):
            with pytest.raises(HTTPException) as exc:
                await read_user_assignment_submissions(
                    mock_request, "nonexistent", 1, admin_user, db
                )
        assert exc.value.status_code == 404

    async def test_returns_user_submissions(
        self, mock_request, db, assignment, user_submission, admin_user, regular_user
    ):
        with patch(_PATCH_RBAC, new_callable=AsyncMock), \
             patch(_PATCH_AUTH_ROLES, new_callable=AsyncMock, return_value=True):
            result = await read_user_assignment_submissions(
                mock_request, assignment.assignment_uuid, regular_user.id, admin_user, db
            )
        assert isinstance(result, list)
        assert len(result) == 1


# ---------------------------------------------------------------------------
# read_user_assignment_submissions_me
# ---------------------------------------------------------------------------


class TestReadUserAssignmentSubmissionsMe:
    async def test_delegates_to_read_user_submissions(
        self, mock_request, db, assignment, user_submission, regular_user
    ):
        with patch(_PATCH_RBAC, new_callable=AsyncMock), \
             patch(_PATCH_AUTH_ROLES, new_callable=AsyncMock, return_value=False):
            result = await read_user_assignment_submissions_me(
                mock_request, assignment.assignment_uuid, regular_user, db
            )
        assert isinstance(result, list)


# ---------------------------------------------------------------------------
# update_assignment_submission
# ---------------------------------------------------------------------------


class TestUpdateAssignmentSubmission:
    async def test_raises_404_when_assignment_not_found(
        self, mock_request, db, admin_user, regular_user
    ):
        obj = AssignmentUserSubmissionCreate(
            user_id=regular_user.id,
            assignment_id=9999,
            grade=0,
            submission_status=AssignmentUserSubmissionStatus.SUBMITTED,
            attempt_number=1,
        )
        with patch(_PATCH_RBAC, new_callable=AsyncMock), \
             patch(_PATCH_AUTH_ROLES, new_callable=AsyncMock, return_value=True):
            with pytest.raises(HTTPException) as exc:
                await update_assignment_submission(
                    mock_request, regular_user.id, "nonexistent", obj, admin_user, db
                )
        assert exc.value.status_code == 404

    async def test_raises_404_when_submission_not_found(
        self, mock_request, db, assignment, admin_user, regular_user
    ):
        obj = AssignmentUserSubmissionCreate(
            user_id=regular_user.id,
            assignment_id=assignment.id,
            grade=0,
            submission_status=AssignmentUserSubmissionStatus.SUBMITTED,
            attempt_number=1,
        )
        with patch(_PATCH_RBAC, new_callable=AsyncMock), \
             patch(_PATCH_AUTH_ROLES, new_callable=AsyncMock, return_value=True):
            with pytest.raises(HTTPException) as exc:
                await update_assignment_submission(
                    mock_request,
                    regular_user.id,
                    assignment.assignment_uuid,
                    obj,
                    admin_user,
                    db,
                )
        assert exc.value.status_code == 404

    async def test_updates_submission(
        self, mock_request, db, assignment, user_submission, admin_user, regular_user
    ):
        obj = AssignmentUserSubmissionCreate(
            user_id=regular_user.id,
            assignment_id=assignment.id,
            grade=90,
            submission_status=AssignmentUserSubmissionStatus.GRADED,
            attempt_number=1,
        )
        with patch(_PATCH_RBAC, new_callable=AsyncMock), \
             patch(_PATCH_AUTH_ROLES, new_callable=AsyncMock, return_value=True):
            result = await update_assignment_submission(
                mock_request,
                regular_user.id,
                assignment.assignment_uuid,
                obj,
                admin_user,
                db,
            )
        assert isinstance(result, AssignmentUserSubmissionRead)


# ---------------------------------------------------------------------------
# delete_assignment_submission
# ---------------------------------------------------------------------------


class TestDeleteAssignmentSubmission:
    async def test_raises_404_when_assignment_not_found(
        self, mock_request, db, admin_user, regular_user
    ):
        with patch(_PATCH_RBAC, new_callable=AsyncMock):
            with pytest.raises(HTTPException) as exc:
                await delete_assignment_submission(
                    mock_request, regular_user.id, "nonexistent", admin_user, db
                )
        assert exc.value.status_code == 404

    async def test_raises_404_when_submission_not_found(
        self, mock_request, db, assignment, admin_user, regular_user
    ):
        with patch(_PATCH_RBAC, new_callable=AsyncMock):
            with pytest.raises(HTTPException) as exc:
                await delete_assignment_submission(
                    mock_request,
                    regular_user.id,
                    assignment.assignment_uuid,
                    admin_user,
                    db,
                )
        assert exc.value.status_code == 404

    async def test_deletes_submission(
        self, mock_request, db, assignment, user_submission, admin_user, regular_user
    ):
        with patch(_PATCH_RBAC, new_callable=AsyncMock), \
             patch(_PATCH_AUTH_ROLES, new_callable=AsyncMock, return_value=True):
            result = await delete_assignment_submission(
                mock_request,
                regular_user.id,
                assignment.assignment_uuid,
                admin_user,
                db,
            )
        assert result["message"] == "Assignment User Submission deleted"


# ---------------------------------------------------------------------------
# grade_assignment_submission
# ---------------------------------------------------------------------------


class TestGradeAssignmentSubmission:
    async def test_raises_404_when_assignment_not_found(
        self, mock_request, db, admin_user, regular_user
    ):
        with patch(_PATCH_RBAC, new_callable=AsyncMock):
            with pytest.raises(HTTPException) as exc:
                await grade_assignment_submission(
                    mock_request, regular_user.id, "nonexistent", admin_user, db
                )
        assert exc.value.status_code == 404

    async def test_raises_404_when_submission_not_found(
        self, mock_request, db, assignment, admin_user, regular_user
    ):
        with patch(_PATCH_RBAC, new_callable=AsyncMock):
            with pytest.raises(HTTPException) as exc:
                await grade_assignment_submission(
                    mock_request,
                    regular_user.id,
                    assignment.assignment_uuid,
                    admin_user,
                    db,
                )
        assert exc.value.status_code == 404

    async def test_grades_submission(
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
        assert "message" in result
        assert "display_grade" in result


# ---------------------------------------------------------------------------
# get_grade_assignment_submission
# ---------------------------------------------------------------------------


class TestGetGradeAssignmentSubmission:
    async def test_raises_404_when_assignment_not_found(
        self, mock_request, db, admin_user, regular_user
    ):
        with patch(_PATCH_RBAC, new_callable=AsyncMock), \
             patch(_PATCH_AUTH_ROLES, new_callable=AsyncMock, return_value=True):
            with pytest.raises(HTTPException) as exc:
                await get_grade_assignment_submission(
                    mock_request, regular_user.id, "nonexistent", admin_user, db
                )
        assert exc.value.status_code == 404

    async def test_raises_404_when_submission_not_found(
        self, mock_request, db, assignment, admin_user, regular_user
    ):
        with patch(_PATCH_RBAC, new_callable=AsyncMock), \
             patch(_PATCH_AUTH_ROLES, new_callable=AsyncMock, return_value=True):
            with pytest.raises(HTTPException) as exc:
                await get_grade_assignment_submission(
                    mock_request,
                    regular_user.id,
                    assignment.assignment_uuid,
                    admin_user,
                    db,
                )
        assert exc.value.status_code == 404

    async def test_returns_grade_object(
        self,
        mock_request,
        db,
        assignment,
        assignment_task,
        graded_submission,
        task_submission,
        admin_user,
        regular_user,
    ):
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
        assert "tasks" in result


# ---------------------------------------------------------------------------
# mark_activity_as_done_for_user
# ---------------------------------------------------------------------------


class TestMarkActivityAsDoneForUser:
    async def test_raises_404_when_assignment_not_found(
        self, mock_request, db, admin_user, regular_user
    ):
        with patch(_PATCH_RBAC, new_callable=AsyncMock):
            with pytest.raises(HTTPException) as exc:
                await mark_activity_as_done_for_user(
                    mock_request, regular_user.id, "nonexistent", admin_user, db
                )
        assert exc.value.status_code == 404

    async def test_raises_404_when_user_not_enrolled(
        self, mock_request, db, assignment, admin_user, regular_user
    ):
        with patch(_PATCH_RBAC, new_callable=AsyncMock):
            with pytest.raises(HTTPException) as exc:
                await mark_activity_as_done_for_user(
                    mock_request,
                    regular_user.id,
                    assignment.assignment_uuid,
                    admin_user,
                    db,
                )
        assert exc.value.status_code == 404

    async def test_marks_activity_done(
        self,
        mock_request,
        db,
        org,
        course,
        assignment,
        activity,
        admin_user,
        regular_user,
    ):
        _, _, step = await _make_trail(
            db, org.id, course.id, activity.id, regular_user.id
        )
        with patch(_PATCH_RBAC, new_callable=AsyncMock), \
             patch(_PATCH_CERT, new_callable=AsyncMock):
            result = await mark_activity_as_done_for_user(
                mock_request,
                regular_user.id,
                assignment.assignment_uuid,
                admin_user,
                db,
            )
        assert result["message"] == "Activity marked as done for user"
        await db.refresh(step)
        assert step.complete is True


# ---------------------------------------------------------------------------
# get_assignments_from_course
# ---------------------------------------------------------------------------


class TestGetAssignmentsFromCourse:
    async def test_raises_404_when_course_not_found(
        self, mock_request, db, admin_user
    ):
        with patch(_PATCH_RBAC, new_callable=AsyncMock):
            with pytest.raises(HTTPException) as exc:
                await get_assignments_from_course(mock_request, "nonexistent", admin_user, db)
        assert exc.value.status_code == 404

    async def test_returns_assignments_for_course(
        self, mock_request, db, course, assignment, admin_user
    ):
        with patch(_PATCH_RBAC, new_callable=AsyncMock):
            result = await get_assignments_from_course(
                mock_request, course.course_uuid, admin_user, db
            )
        assert isinstance(result, list)
        assert len(result) == 1
        assert result[0].assignment_uuid == assignment.assignment_uuid


# ---------------------------------------------------------------------------
# put_assignment_task_reference_file
# ---------------------------------------------------------------------------


class TestPutAssignmentTaskReferenceFile:
    async def test_raises_404_when_task_not_found(self, mock_request, db, admin_user):
        with patch(_PATCH_RBAC, new_callable=AsyncMock):
            with pytest.raises(HTTPException) as exc:
                await put_assignment_task_reference_file(
                    mock_request, db, "nonexistent_task", admin_user, None
                )
        assert exc.value.status_code == 404

    async def test_updates_task_without_file(
        self, mock_request, db, admin_user, assignment_task
    ):
        with patch(_PATCH_RBAC, new_callable=AsyncMock):
            result = await put_assignment_task_reference_file(
                mock_request,
                db,
                assignment_task.assignment_task_uuid,
                admin_user,
                None,
            )
        assert result.assignment_task_uuid == assignment_task.assignment_task_uuid


# ---------------------------------------------------------------------------
# put_assignment_task_submission_file
# ---------------------------------------------------------------------------


class TestPutAssignmentTaskSubmissionFile:
    async def test_raises_404_when_task_not_found(self, mock_request, db, admin_user):
        with patch(_PATCH_RBAC, new_callable=AsyncMock), \
             patch(_PATCH_AUTH_ROLES, new_callable=AsyncMock, return_value=True):
            with pytest.raises(HTTPException) as exc:
                await put_assignment_task_submission_file(
                    mock_request, db, "nonexistent_task", admin_user, None
                )
        assert exc.value.status_code == 404

    async def test_returns_none_when_no_file(
        self, mock_request, db, admin_user, assignment_task
    ):
        with patch(_PATCH_RBAC, new_callable=AsyncMock), \
             patch(_PATCH_AUTH_ROLES, new_callable=AsyncMock, return_value=True):
            result = await put_assignment_task_submission_file(
                mock_request,
                db,
                assignment_task.assignment_task_uuid,
                admin_user,
                None,
            )
        assert result is None


# ---------------------------------------------------------------------------
# handle_assignment_task_submission — UUID fallback branch (line 1342)
# ---------------------------------------------------------------------------


class TestHandleAssignmentTaskSubmissionUuidBranch:
    async def test_finds_submission_by_uuid_when_user_task_not_found(
        self, mock_request, db, admin_user, assignment_task, task_submission
    ):
        """Covers line 1342: submission not found by (user, task), found by UUID.

        `task_submission` belongs to `regular_user` (id=2). Calling as `admin_user`
        (id=1) means the first lookup returns None; the UUID fallback finds it."""
        payload = AssignmentTaskSubmissionUpdate(
            assignment_task_submission_uuid=task_submission.assignment_task_submission_uuid,
            task_submission={"answer": "updated"},
        )
        with patch(_PATCH_RBAC, new_callable=AsyncMock), \
             patch(_PATCH_AUTH_ROLES, new_callable=AsyncMock, return_value=True):
            result = await handle_assignment_task_submission(
                mock_request,
                assignment_task.assignment_task_uuid,
                payload,
                admin_user,
                db,
            )
        assert result is not None


# ---------------------------------------------------------------------------
# read_user_assignment_task_submissions
# ---------------------------------------------------------------------------


class TestReadUserAssignmentTaskSubmissions:
    async def test_raises_404_when_task_not_found(
        self, mock_request, db, admin_user, regular_user
    ):
        with patch(_PATCH_RBAC, new_callable=AsyncMock), \
             patch(_PATCH_AUTH_ROLES, new_callable=AsyncMock, return_value=True):
            with pytest.raises(HTTPException) as exc:
                await read_user_assignment_task_submissions(
                    mock_request, "nonexistent", regular_user.id, admin_user, db
                )
        assert exc.value.status_code == 404

    async def test_raises_404_when_submission_not_found(
        self, mock_request, db, admin_user, regular_user, assignment_task
    ):
        with patch(_PATCH_RBAC, new_callable=AsyncMock), \
             patch(_PATCH_AUTH_ROLES, new_callable=AsyncMock, return_value=True):
            with pytest.raises(HTTPException) as exc:
                await read_user_assignment_task_submissions(
                    mock_request,
                    assignment_task.assignment_task_uuid,
                    regular_user.id,
                    admin_user,
                    db,
                )
        assert exc.value.status_code == 404

    async def test_returns_submission(
        self, mock_request, db, admin_user, regular_user, assignment_task, task_submission
    ):
        with patch(_PATCH_RBAC, new_callable=AsyncMock), \
             patch(_PATCH_AUTH_ROLES, new_callable=AsyncMock, return_value=True):
            result = await read_user_assignment_task_submissions(
                mock_request,
                assignment_task.assignment_task_uuid,
                regular_user.id,
                admin_user,
                db,
            )
        assert result.assignment_task_submission_uuid == task_submission.assignment_task_submission_uuid


# ---------------------------------------------------------------------------
# read_user_assignment_task_submissions_me_batch
# ---------------------------------------------------------------------------


class TestReadUserAssignmentTaskSubmissionsMeBatch:
    async def test_raises_404_when_assignment_not_found(
        self, mock_request, db, admin_user
    ):
        with patch(_PATCH_RBAC, new_callable=AsyncMock):
            with pytest.raises(HTTPException) as exc:
                await read_user_assignment_task_submissions_me_batch(
                    mock_request, "nonexistent", admin_user, db
                )
        assert exc.value.status_code == 404

    async def test_returns_batch_map(
        self, mock_request, db, admin_user, assignment, assignment_task
    ):
        with patch(_PATCH_RBAC, new_callable=AsyncMock):
            result = await read_user_assignment_task_submissions_me_batch(
                mock_request, assignment.assignment_uuid, admin_user, db
            )
        assert isinstance(result, dict)
        assert assignment_task.assignment_task_uuid in result


# ---------------------------------------------------------------------------
# read_user_assignment_task_submissions_me
# ---------------------------------------------------------------------------


class TestReadUserAssignmentTaskSubmissionsMe:
    async def test_raises_404_when_task_not_found(self, mock_request, db, admin_user):
        with patch(_PATCH_RBAC, new_callable=AsyncMock):
            with pytest.raises(HTTPException) as exc:
                await read_user_assignment_task_submissions_me(
                    mock_request, "nonexistent", admin_user, db
                )
        assert exc.value.status_code == 404

    async def test_returns_none_when_no_submission(
        self, mock_request, db, admin_user, assignment_task
    ):
        with patch(_PATCH_RBAC, new_callable=AsyncMock):
            result = await read_user_assignment_task_submissions_me(
                mock_request, assignment_task.assignment_task_uuid, admin_user, db
            )
        assert result is None

    async def test_returns_submission(
        self, mock_request, db, admin_user, regular_user, assignment_task, task_submission
    ):
        with patch(_PATCH_RBAC, new_callable=AsyncMock):
            result = await read_user_assignment_task_submissions_me(
                mock_request, assignment_task.assignment_task_uuid, regular_user, db
            )
        assert result is not None
        assert result.assignment_task_submission_uuid == task_submission.assignment_task_submission_uuid


# ---------------------------------------------------------------------------
# read_assignment_task_submissions
# ---------------------------------------------------------------------------


class TestReadAssignmentTaskSubmissions:
    async def test_raises_404_when_task_not_found(self, mock_request, db, admin_user):
        with patch(_PATCH_RBAC, new_callable=AsyncMock):
            with pytest.raises(HTTPException) as exc:
                await read_assignment_task_submissions(
                    mock_request, "nonexistent", admin_user, db
                )
        assert exc.value.status_code == 404

    async def test_returns_submissions_list(
        self, mock_request, db, admin_user, assignment_task, task_submission
    ):
        with patch(_PATCH_RBAC, new_callable=AsyncMock):
            result = await read_assignment_task_submissions(
                mock_request, assignment_task.assignment_task_uuid, admin_user, db
            )
        assert isinstance(result, list)
        assert len(result) == 1
        assert result[0].assignment_task_submission_uuid == task_submission.assignment_task_submission_uuid


# ---------------------------------------------------------------------------
# update_assignment_task_submission
# ---------------------------------------------------------------------------


class TestUpdateAssignmentTaskSubmission:
    async def test_raises_404_when_submission_not_found(
        self, mock_request, db, admin_user
    ):
        payload = AssignmentTaskSubmissionUpdate(task_submission={"answer": "x"})
        with patch(_PATCH_RBAC, new_callable=AsyncMock):
            with pytest.raises(HTTPException) as exc:
                await update_assignment_task_submission(
                    mock_request, "nonexistent_uuid", payload, admin_user, db
                )
        assert exc.value.status_code == 404

    async def test_updates_submission(
        self, mock_request, db, admin_user, assignment_task, task_submission
    ):
        payload = AssignmentTaskSubmissionUpdate(task_submission={"answer": "new_answer"})
        with patch(_PATCH_RBAC, new_callable=AsyncMock):
            result = await update_assignment_task_submission(
                mock_request,
                task_submission.assignment_task_submission_uuid,
                payload,
                admin_user,
                db,
            )
        assert result.assignment_task_submission_uuid == task_submission.assignment_task_submission_uuid


# ---------------------------------------------------------------------------
# delete_assignment_task_submission
# ---------------------------------------------------------------------------


class TestDeleteAssignmentTaskSubmission:
    async def test_raises_404_when_submission_not_found(
        self, mock_request, db, admin_user
    ):
        with patch(_PATCH_RBAC, new_callable=AsyncMock):
            with pytest.raises(HTTPException) as exc:
                await delete_assignment_task_submission(
                    mock_request, "nonexistent", admin_user, db
                )
        assert exc.value.status_code == 404

    async def test_deletes_submission(
        self, mock_request, db, admin_user, task_submission
    ):
        with patch(_PATCH_RBAC, new_callable=AsyncMock):
            result = await delete_assignment_task_submission(
                mock_request,
                task_submission.assignment_task_submission_uuid,
                admin_user,
                db,
            )
        assert result["message"] == "Assignment Task Submission deleted"


# ---------------------------------------------------------------------------
# create_assignment_submission — new TrailRun / TrailStep branches + auto_grading
# ---------------------------------------------------------------------------

_PATCH_TRAIL_PRESENCE = "src.services.courses.activities.assignments.check_trail_presence"
_PATCH_CERT_CHECK = (
    "src.services.courses.activities.assignments."
    "check_course_completion_and_create_certificate"
)
_PATCH_GRADE_FINALIZE = (
    "src.services.courses.activities.assignments._apply_grade_and_finalize"
)


class TestCreateAssignmentSubmission:
    async def test_creates_trailrun_and_trailstep_when_missing(
        self, mock_request, db, admin_user, assignment, course, activity
    ):
        """Covers lines 1915-1916 (new TrailRun) and 1940-1941 (new TrailStep)."""
        trail = Trail(
            org_id=course.org_id,
            user_id=admin_user.id,
            trail_uuid="trail_submit_test",
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(trail)
        await db.commit()
        await db.refresh(trail)

        with patch(_PATCH_RBAC, new_callable=AsyncMock), \
             patch(_PATCH_TRAIL_PRESENCE, new_callable=AsyncMock, return_value=trail), \
             patch(_PATCH_CERT, new_callable=AsyncMock), \
             patch(_PATCH_CERT_CHECK, new_callable=AsyncMock), \
             patch(_PATCH_TRACK, new_callable=AsyncMock), \
             patch(_PATCH_DISPATCH, new_callable=AsyncMock):
            result = await create_assignment_submission(
                mock_request,
                assignment.assignment_uuid,
                admin_user,
                db,
            )
        assert result.submission_status == AssignmentUserSubmissionStatus.SUBMITTED

    async def test_auto_grading_path(
        self, mock_request, db, admin_user, assignment, course, activity, assignment_task
    ):
        """Covers the auto_grading branch (lines 1967-1989)."""
        assignment.auto_grading = True
        db.add(assignment)
        await db.commit()

        trail = Trail(
            org_id=course.org_id,
            user_id=admin_user.id,
            trail_uuid="trail_autograding",
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(trail)
        await db.commit()
        await db.refresh(trail)

        with patch(_PATCH_RBAC, new_callable=AsyncMock), \
             patch(_PATCH_TRAIL_PRESENCE, new_callable=AsyncMock, return_value=trail), \
             patch(_PATCH_CERT, new_callable=AsyncMock), \
             patch(_PATCH_CERT_CHECK, new_callable=AsyncMock), \
             patch(_PATCH_TRACK, new_callable=AsyncMock), \
             patch(_PATCH_DISPATCH, new_callable=AsyncMock), \
             patch(_PATCH_GRADE_FINALIZE, new_callable=AsyncMock):
            result = await create_assignment_submission(
                mock_request,
                assignment.assignment_uuid,
                admin_user,
                db,
            )
        assert result.submission_status == AssignmentUserSubmissionStatus.SUBMITTED


# ---------------------------------------------------------------------------
# delete_assignment_submission — certification revocation branch (lines 2292-2297)
# ---------------------------------------------------------------------------


class TestDeleteAssignmentSubmissionCertRevocation:
    async def test_revokes_certificate_when_present(
        self, mock_request, db, assignment, user_submission, admin_user, regular_user, course
    ):
        """Covers the certification revocation path in delete_assignment_submission."""
        cert = Certifications(
            certification_uuid="cert_test_uuid",
            course_id=course.id,
            config={},
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(cert)
        await db.commit()
        await db.refresh(cert)

        cert_user = CertificateUser(
            user_id=regular_user.id,
            certification_id=cert.id,
            user_certification_uuid="certuser_test_uuid",
            created_at=str(datetime.now()),
            updated_at=str(datetime.now()),
        )
        db.add(cert_user)
        await db.commit()

        with patch(_PATCH_RBAC, new_callable=AsyncMock), \
             patch(_PATCH_AUTH_ROLES, new_callable=AsyncMock, return_value=True):
            result = await delete_assignment_submission(
                mock_request,
                regular_user.id,
                assignment.assignment_uuid,
                admin_user,
                db,
            )
        assert result["message"] == "Assignment User Submission deleted"
