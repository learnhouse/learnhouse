"""Tests for assignment submission-file access control (M3 IDOR fix).

Submission files sit under a course-content path, so the generic activity grant
would let any org member (or anyone on a public course) download another
learner's work. ``enforce_submission_file_access`` restricts them to the owner
or a course instructor.
"""

from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.courses.assignments import (
    Assignment,
    AssignmentTask,
    AssignmentTaskSubmission,
    AssignmentTaskTypeEnum,
    GradingTypeEnum,
)
from src.db.users import AnonymousUser, PublicUser, APITokenUser
from src.security.submission_file_access import (
    is_submission_file,
    enforce_submission_file_access,
)

TASK_UUID = "assignmenttask_subs_test"
FILE = "submission_abc123.pdf"


def _parts(course_uuid):
    return [
        "orgs", "org_x", "courses", course_uuid, "activities", "act_x",
        "assignments", "asgn_x", "tasks", TASK_UUID, "subs", FILE,
    ]


class TestIsSubmissionFile:
    def test_matches_submission_path(self):
        assert is_submission_file(_parts("course_1")) is True

    def test_rejects_regular_activity_path(self):
        assert is_submission_file(
            ["orgs", "o", "courses", "c", "activities", "a", "video.mp4"]
        ) is False

    def test_rejects_short_path(self):
        assert is_submission_file(["orgs", "o", "courses", "c"]) is False


async def _seed(db, org, course, chapter, activity, user, *, filename=FILE):
    assignment = Assignment(
        title="A", description="d", due_date="2030-01-01", published=True,
        grading_type=GradingTypeEnum.NUMERIC, org_id=org.id, course_id=course.id,
        chapter_id=chapter.id, activity_id=activity.id,
        assignment_uuid="assignment_subs_test",
        creation_date=str(datetime.now()), update_date=str(datetime.now()),
    )
    db.add(assignment)
    await db.commit()
    await db.refresh(assignment)

    task = AssignmentTask(
        title="t", description="d", hint="", reference_file=None,
        assignment_type=AssignmentTaskTypeEnum.FILE_SUBMISSION, contents={},
        max_grade_value=100, assignment_id=assignment.id, org_id=org.id,
        course_id=course.id, chapter_id=chapter.id, activity_id=activity.id,
        assignment_task_uuid=TASK_UUID,
        creation_date=str(datetime.now()), update_date=str(datetime.now()),
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)

    sub = AssignmentTaskSubmission(
        assignment_task_submission_uuid="ats_subs_test",
        task_submission={"fileUUID": filename},
        grade=0, manually_graded=False, task_submission_grade_feedback="",
        assignment_type=AssignmentTaskTypeEnum.FILE_SUBMISSION,
        user_id=user.id, activity_id=activity.id, course_id=course.id,
        chapter_id=chapter.id, assignment_task_id=task.id,
        creation_date=str(datetime.now()), update_date=str(datetime.now()),
    )
    db.add(sub)
    await db.commit()
    return task


class TestEnforceSubmissionFileAccess:
    @pytest.mark.asyncio
    async def test_anonymous_rejected(self, db, org, course, chapter, activity, regular_user):
        await _seed(db, org, course, chapter, activity, regular_user)
        with pytest.raises(HTTPException) as exc:
            await enforce_submission_file_access(
                _parts(course.course_uuid), AnonymousUser(), db, request=None
            )
        assert exc.value.status_code == 401

    @pytest.mark.asyncio
    async def test_owner_allowed(self, db, org, course, chapter, activity, regular_user):
        await _seed(db, org, course, chapter, activity, regular_user)
        # request=None → skip instructor check, exercise the owner path.
        await enforce_submission_file_access(
            _parts(course.course_uuid), regular_user, db, request=None
        )  # no raise

    @pytest.mark.asyncio
    async def test_other_learner_rejected(self, db, org, course, chapter, activity, regular_user):
        await _seed(db, org, course, chapter, activity, regular_user)
        # A different learner with no submission for this task must be denied,
        # even though they belong to the org.
        stranger = PublicUser(
            id=98765, username="stranger", first_name="S", last_name="T",
            email="stranger@test.com", user_uuid="user_stranger",
        )
        with pytest.raises(HTTPException) as exc:
            await enforce_submission_file_access(
                _parts(course.course_uuid), stranger, db, request=None
            )
        assert exc.value.status_code == 403

    @pytest.mark.asyncio
    async def test_instructor_allowed(self, db, org, course, chapter, activity, regular_user):
        await _seed(db, org, course, chapter, activity, regular_user)
        stranger = PublicUser(
            id=98766, username="teacher", first_name="Te", last_name="A",
            email="teacher@test.com", user_uuid="user_teacher",
        )
        # Instructor RBAC (course UPDATE) grants access to any submission.
        with patch(
            "src.security.rbac.authorization_verify_based_on_roles",
            new=AsyncMock(return_value=True),
        ):
            await enforce_submission_file_access(
                _parts(course.course_uuid), stranger, db, request=MagicMock()
            )  # no raise

    @pytest.mark.asyncio
    async def test_substring_in_other_field_does_not_grant_access(
        self, db, org, course, chapter, activity, regular_user
    ):
        # The requester's OWN submission stores an unrelated text answer that
        # happens to contain the victim's filename as a substring. Equality on
        # the filename field (not substring on the JSON) must still deny access.
        task = await _seed(
            db, org, course, chapter, activity, regular_user, filename="other.pdf"
        )
        sub = (await db.execute(
            select(AssignmentTaskSubmission).where(
                AssignmentTaskSubmission.assignment_task_id == task.id
            )
        )).scalars().first()
        sub.task_submission = {"answer": f"see file {FILE} for details", "fileUUID": "other.pdf"}
        db.add(sub)
        await db.commit()
        with pytest.raises(HTTPException) as exc:
            await enforce_submission_file_access(
                _parts(course.course_uuid), regular_user, db, request=None
            )
        assert exc.value.status_code == 403

    @pytest.mark.asyncio
    async def test_course_not_found_rejected(self, db, org, course, chapter, activity, regular_user):
        await _seed(db, org, course, chapter, activity, regular_user)
        with pytest.raises(HTTPException) as exc:
            await enforce_submission_file_access(
                _parts("course_does_not_exist"), regular_user, db, request=None
            )
        assert exc.value.status_code == 403

    @pytest.mark.asyncio
    async def test_api_token_is_denied(self, db, org, course, chapter, activity, regular_user):
        # An API token's id is a token PK, not a user id. If it were used as a
        # learner identity, a token whose id equals a learner's id could read
        # that learner's submission file (cross-org). Tokens are denied outright.
        await _seed(db, org, course, chapter, activity, regular_user, filename=FILE)
        token = APITokenUser(id=regular_user.id, org_id=org.id, created_by_user_id=1)
        with pytest.raises(HTTPException) as exc:
            await enforce_submission_file_access(
                _parts(course.course_uuid), token, db, request=MagicMock()
            )
        assert exc.value.status_code == 403
