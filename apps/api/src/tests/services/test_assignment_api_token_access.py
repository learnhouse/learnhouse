"""Tests for headless assignment access via org-scoped API tokens.

The assignment authoring + grading service functions used to hard-block every
API token (``_block_api_tokens``). They now route instructor-style access
through ``authorize_assignment_access``, which checks the single ``assignments``
rights bucket and enforces the org boundary via the parent course UUID. The
learner ``/me`` / self-submission / retry endpoints stay session-only.

These tests pin that contract end-to-end against the real test DB:
  - a token with the right ``assignments`` action can author / read / grade;
  - a token missing the action gets 403;
  - a token from another org gets 403 (org boundary);
  - session-only endpoints still 403 for any token, even a fully-privileged one.
"""

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from src.db.courses.assignments import (
    Assignment,
    AssignmentCreate,
    AssignmentRead,
    AssignmentTask,
    AssignmentTaskSubmission,
    AssignmentTaskTypeEnum,
    AssignmentUserSubmission,
    AssignmentUserSubmissionStatus,
    GradingTypeEnum,
)
from src.db.courses.assignments import AssignmentTaskSubmissionUpdate
from src.db.users import APITokenUser, User
from src.services.courses.activities.assignments import (
    create_assignment,
    grade_assignment_submission,
    handle_assignment_task_submission,
    read_assignment,
    read_assignment_submissions,
    retry_assignment_submission,
)
from sqlmodel import select

_PATCH_LIMITS = "src.services.courses.activities.assignments.check_limits_with_usage"
_PATCH_INCREASE = "src.services.courses.activities.assignments.increase_feature_usage"
_PATCH_DISPATCH = "src.services.courses.activities.assignments.dispatch_webhooks"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _assignments_rights(create=False, read=False, update=False, delete=False):
    return {
        "action_create": create,
        "action_read": read,
        "action_update": update,
        "action_delete": delete,
    }


def _token(org_id=1, **buckets):
    """Build an APITokenUser whose ``rights`` dict carries the given buckets."""
    return APITokenUser(
        id=1,
        user_uuid="apitoken_test",
        username="api_token",
        org_id=org_id,
        rights=dict(buckets),
        token_name="Test Token",
        created_by_user_id=1,
    )


async def _make_assignment(db, org, course, chapter, activity, *, auto_grading=False):
    a = Assignment(
        title="Headless",
        description="x",
        due_date="2030-01-01",
        published=True,
        grading_type=GradingTypeEnum.NUMERIC,
        auto_grading=auto_grading,
        org_id=org.id,
        course_id=course.id,
        chapter_id=chapter.id,
        activity_id=activity.id,
        assignment_uuid="assignment_token_test",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(a)
    await db.commit()
    await db.refresh(a)
    return a


def _assignment_create_obj(org, course, chapter, activity, title="New Assignment"):
    return AssignmentCreate(
        title=title,
        description="Desc",
        due_date="2030-01-01",
        grading_type=GradingTypeEnum.NUMERIC,
        org_id=org.id,
        course_id=course.id,
        chapter_id=chapter.id,
        activity_id=activity.id,
    )


# ---------------------------------------------------------------------------
# Authoring (assignments bucket)
# ---------------------------------------------------------------------------


class TestTokenAuthoring:
    async def test_token_with_create_can_create_assignment(
        self, mock_request, db, org, course, chapter, activity
    ):
        token = _token(assignments=_assignments_rights(create=True))
        obj = _assignment_create_obj(org, course, chapter, activity)
        with patch(_PATCH_LIMITS, new_callable=AsyncMock), \
             patch(_PATCH_INCREASE, new_callable=AsyncMock):
            result = await create_assignment(mock_request, obj, token, db)
        assert isinstance(result, AssignmentRead)
        assert result.title == "New Assignment"

    async def test_token_without_create_is_forbidden(
        self, mock_request, db, org, course, chapter, activity
    ):
        token = _token(assignments=_assignments_rights(read=True))  # no create
        obj = _assignment_create_obj(org, course, chapter, activity)
        with patch(_PATCH_LIMITS, new_callable=AsyncMock), \
             patch(_PATCH_INCREASE, new_callable=AsyncMock):
            with pytest.raises(HTTPException) as exc:
                await create_assignment(mock_request, obj, token, db)
        assert exc.value.status_code == 403

    async def test_token_with_no_assignments_bucket_is_forbidden(
        self, mock_request, db, org, course, chapter, activity
    ):
        # Token has other buckets but not `assignments` at all.
        token = _token(courses={"action_create": True})
        obj = _assignment_create_obj(org, course, chapter, activity)
        with patch(_PATCH_LIMITS, new_callable=AsyncMock), \
             patch(_PATCH_INCREASE, new_callable=AsyncMock):
            with pytest.raises(HTTPException) as exc:
                await create_assignment(mock_request, obj, token, db)
        assert exc.value.status_code == 403

    async def test_cross_org_token_is_forbidden(
        self, mock_request, db, org, other_org, course, chapter, activity
    ):
        # Token belongs to org 2; the course lives in org 1 -> org boundary 403.
        token = _token(org_id=other_org.id, assignments=_assignments_rights(create=True))
        obj = _assignment_create_obj(org, course, chapter, activity)
        with patch(_PATCH_LIMITS, new_callable=AsyncMock), \
             patch(_PATCH_INCREASE, new_callable=AsyncMock):
            with pytest.raises(HTTPException) as exc:
                await create_assignment(mock_request, obj, token, db)
        assert exc.value.status_code == 403


# ---------------------------------------------------------------------------
# Reading (assignments bucket, read action)
# ---------------------------------------------------------------------------


class TestTokenReading:
    async def test_token_with_read_can_read_assignment(
        self, mock_request, db, org, course, chapter, activity
    ):
        await _make_assignment(db, org, course, chapter, activity)
        token = _token(assignments=_assignments_rights(read=True))
        result = await read_assignment(mock_request, "assignment_token_test", token, db)
        assert isinstance(result, AssignmentRead)

    async def test_token_without_read_is_forbidden(
        self, mock_request, db, org, course, chapter, activity
    ):
        await _make_assignment(db, org, course, chapter, activity)
        token = _token(assignments=_assignments_rights(create=True))  # no read
        with pytest.raises(HTTPException) as exc:
            await read_assignment(mock_request, "assignment_token_test", token, db)
        assert exc.value.status_code == 403

    async def test_token_with_read_can_list_submissions(
        self, mock_request, db, org, course, chapter, activity
    ):
        await _make_assignment(db, org, course, chapter, activity)
        token = _token(assignments=_assignments_rights(read=True))
        result = await read_assignment_submissions(
            mock_request, "assignment_token_test", token, db
        )
        assert isinstance(result, list)


# ---------------------------------------------------------------------------
# Grading (assignments bucket, update action)
# ---------------------------------------------------------------------------


class TestTokenGrading:
    async def _seed_submission(self, db, org, course, chapter, activity, regular_user):
        assignment = await _make_assignment(db, org, course, chapter, activity)
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
            assignment_task_uuid="assignmenttask_token_test",
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
            assignmentusersubmission_uuid="aus_token_test",
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(user_submission)
        task_submission = AssignmentTaskSubmission(
            assignment_task_submission_uuid="ats_token_test",
            task_submission={"answer": "4"},  # correct
            grade=0,
            manually_graded=False,
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
        return assignment

    async def test_token_with_update_can_finalize_grade(
        self, mock_request, db, org, course, chapter, activity, regular_user
    ):
        await self._seed_submission(db, org, course, chapter, activity, regular_user)
        token = _token(assignments=_assignments_rights(update=True))
        with patch(_PATCH_DISPATCH, new_callable=AsyncMock):
            result = await grade_assignment_submission(
                mock_request, regular_user.id, "assignment_token_test", token, db,
                overall_feedback="Nice work",
            )
        # Correct short answer -> full marks, submission marked GRADED.
        assert result["grade"] == 100

    async def test_token_without_update_cannot_grade(
        self, mock_request, db, org, course, chapter, activity, regular_user
    ):
        await self._seed_submission(db, org, course, chapter, activity, regular_user)
        token = _token(assignments=_assignments_rights(read=True))  # no update
        with pytest.raises(HTTPException) as exc:
            await grade_assignment_submission(
                mock_request, regular_user.id, "assignment_token_test", token, db,
            )
        assert exc.value.status_code == 403


# ---------------------------------------------------------------------------
# Session-only endpoints stay blocked for tokens
# ---------------------------------------------------------------------------


class TestTokenSubmitOnBehalf:
    """A token with assignments.create may write a learner's answer by user_id."""

    async def _seed_task(self, db, org, course, chapter, activity):
        assignment = await _make_assignment(db, org, course, chapter, activity)
        task = AssignmentTask(
            title="Q1", description="d", hint="", reference_file=None,
            assignment_type=AssignmentTaskTypeEnum.CUSTOM, contents={"widget": "x"},
            max_grade_value=100, assignment_id=assignment.id, org_id=org.id,
            course_id=course.id, chapter_id=chapter.id, activity_id=activity.id,
            assignment_task_uuid="assignmenttask_obo_test",
            creation_date=str(datetime.now()), update_date=str(datetime.now()),
        )
        db.add(task)
        await db.commit()
        return assignment, task

    async def test_token_submits_task_answer_for_learner(
        self, mock_request, db, org, course, chapter, activity, regular_user
    ):
        await self._seed_task(db, org, course, chapter, activity)
        token = _token(assignments=_assignments_rights(create=True))
        body = AssignmentTaskSubmissionUpdate(task_submission={"answer": "my custom answer"})
        result = await handle_assignment_task_submission(
            mock_request, "assignmenttask_obo_test", body, token, db,
            on_behalf_of_user_id=regular_user.id,
        )
        # Persisted against the LEARNER, not the token.
        assert result.user_id == regular_user.id
        row = (await db.execute(
            select(AssignmentTaskSubmission).where(
                AssignmentTaskSubmission.user_id == regular_user.id
            )
        )).scalars().first()
        assert row is not None
        assert row.task_submission == {"answer": "my custom answer"}

    async def test_token_submit_requires_on_behalf_id(
        self, mock_request, db, org, course, chapter, activity
    ):
        await self._seed_task(db, org, course, chapter, activity)
        token = _token(assignments=_assignments_rights(create=True))
        body = AssignmentTaskSubmissionUpdate(task_submission={"answer": "x"})
        with pytest.raises(HTTPException) as exc:
            await handle_assignment_task_submission(
                mock_request, "assignmenttask_obo_test", body, token, db,
            )
        assert exc.value.status_code == 400

    async def test_token_submit_without_create_right_forbidden(
        self, mock_request, db, org, course, chapter, activity, regular_user
    ):
        await self._seed_task(db, org, course, chapter, activity)
        token = _token(assignments=_assignments_rights(read=True))  # no create
        body = AssignmentTaskSubmissionUpdate(task_submission={"answer": "x"})
        with pytest.raises(HTTPException) as exc:
            await handle_assignment_task_submission(
                mock_request, "assignmenttask_obo_test", body, token, db,
                on_behalf_of_user_id=regular_user.id,
            )
        assert exc.value.status_code == 403

    async def test_token_submit_for_non_member_forbidden(
        self, mock_request, db, org, course, chapter, activity
    ):
        await self._seed_task(db, org, course, chapter, activity)
        # A user with no membership in the token's org.
        outsider = User(
            id=999, username="outsider", first_name="O", last_name="O",
            email="outsider@x.com", password="x", user_uuid="user_outsider",
            creation_date=str(datetime.now()), update_date=str(datetime.now()),
        )
        db.add(outsider)
        await db.commit()
        token = _token(assignments=_assignments_rights(create=True))
        body = AssignmentTaskSubmissionUpdate(task_submission={"answer": "x"})
        with pytest.raises(HTTPException) as exc:
            await handle_assignment_task_submission(
                mock_request, "assignmenttask_obo_test", body, token, db,
                on_behalf_of_user_id=outsider.id,
            )
        assert exc.value.status_code == 403


class TestSessionOnlyEndpointsStillBlockTokens:
    async def test_retry_blocks_token(
        self, mock_request, db, org, course, chapter, activity
    ):
        # Retry stays session-only — even a full-rights token is rejected.
        await _make_assignment(db, org, course, chapter, activity)
        token = _token(
            assignments=_assignments_rights(create=True, read=True, update=True, delete=True)
        )
        with pytest.raises(HTTPException) as exc:
            await retry_assignment_submission(
                mock_request, "assignment_token_test", token, db
            )
        assert exc.value.status_code == 403
