"""Edge cases of assignment submission-file access control.

Complements test_submission_file_access.py with the two fallback paths of
``enforce_submission_file_access``: an RBAC lookup that errors must fall
through to the owner check (not grant, not 500), and a submission whose stored
JSON is not an object must never be read as referencing the file.
"""

from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from src.db.courses.assignments import (
    Assignment,
    AssignmentTask,
    AssignmentTaskSubmission,
    AssignmentTaskTypeEnum,
    GradingTypeEnum,
)
from src.db.users import PublicUser
from src.security.submission_file_access import (
    _submission_references_file,
    enforce_submission_file_access,
)

TASK_UUID = "assignmenttask_subs_fallback"
FILE = "submission_fallback.pdf"


def _parts(course_uuid):
    return [
        "orgs", "org_x", "courses", course_uuid, "activities", "act_x",
        "assignments", "asgn_x", "tasks", TASK_UUID, "subs", FILE,
    ]


async def _seed(db, org, course, chapter, activity, user, *, task_submission):
    now = str(datetime.now())
    assignment = Assignment(
        title="A", description="d", due_date="2030-01-01", published=True,
        grading_type=GradingTypeEnum.NUMERIC, org_id=org.id, course_id=course.id,
        chapter_id=chapter.id, activity_id=activity.id,
        assignment_uuid="assignment_subs_fallback",
        creation_date=now, update_date=now,
    )
    db.add(assignment)
    await db.commit()
    await db.refresh(assignment)

    task = AssignmentTask(
        title="t", description="d", hint="", reference_file=None,
        assignment_type=AssignmentTaskTypeEnum.FILE_SUBMISSION, contents={},
        max_grade_value=100, assignment_id=assignment.id, org_id=org.id,
        course_id=course.id, chapter_id=chapter.id, activity_id=activity.id,
        assignment_task_uuid=TASK_UUID, creation_date=now, update_date=now,
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)

    db.add(AssignmentTaskSubmission(
        assignment_task_submission_uuid="ats_subs_fallback",
        task_submission=task_submission,
        grade=0, manually_graded=False, task_submission_grade_feedback="",
        assignment_type=AssignmentTaskTypeEnum.FILE_SUBMISSION,
        user_id=user.id, activity_id=activity.id, course_id=course.id,
        chapter_id=chapter.id, assignment_task_id=task.id,
        creation_date=now, update_date=now,
    ))
    await db.commit()


class TestSubmissionReferencesFile:
    @pytest.mark.parametrize("value", [None, [FILE], FILE, 42])
    def test_non_dict_submission_never_matches(self, value):
        """Only an object with a filename key can reference a file."""
        assert _submission_references_file(value, FILE) is False

    def test_dict_with_matching_key_matches(self):
        assert _submission_references_file({"file_uuid": FILE}, FILE) is True


class TestRbacErrorFallsBackToOwnerCheck:
    async def test_owner_still_allowed_when_rbac_lookup_errors(
        self, db, org, course, chapter, activity, regular_user
    ):
        """A failing instructor lookup must not lock the owner out of their own file."""
        await _seed(
            db, org, course, chapter, activity, regular_user,
            task_submission={"fileUUID": FILE},
        )
        rbac = AsyncMock(side_effect=RuntimeError("rbac backend down"))
        with patch("src.security.rbac.authorization_verify_based_on_roles", new=rbac):
            await enforce_submission_file_access(
                _parts(course.course_uuid), regular_user, db, request=MagicMock()
            )  # no raise
        rbac.assert_awaited_once()

    async def test_non_owner_denied_when_rbac_lookup_errors(
        self, db, org, course, chapter, activity, regular_user
    ):
        """An RBAC error is never treated as an instructor grant."""
        await _seed(
            db, org, course, chapter, activity, regular_user,
            task_submission={"fileUUID": FILE},
        )
        stranger = PublicUser(
            id=55501, username="stranger", first_name="S", last_name="T",
            email="stranger-fb@test.com", user_uuid="user_stranger_fb",
        )
        with patch(
            "src.security.rbac.authorization_verify_based_on_roles",
            new=AsyncMock(side_effect=RuntimeError("boom")),
        ):
            with pytest.raises(HTTPException) as exc:
                await enforce_submission_file_access(
                    _parts(course.course_uuid), stranger, db, request=MagicMock()
                )
        assert exc.value.status_code == 403


async def test_owner_with_non_object_submission_is_denied(
    db, org, course, chapter, activity, regular_user
):
    """A submission stored as a JSON list (not an object) does not grant the file."""
    await _seed(
        db, org, course, chapter, activity, regular_user,
        task_submission=[FILE],
    )
    with pytest.raises(HTTPException) as exc:
        await enforce_submission_file_access(
            _parts(course.course_uuid), regular_user, db, request=None
        )
    assert exc.value.status_code == 403
