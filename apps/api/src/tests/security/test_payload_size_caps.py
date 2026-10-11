"""Serialized-size caps on free-form JSON fields users can write."""

import pytest
from pydantic import ValidationError

from src.db.courses.assignments import (
    MAX_TASK_SUBMISSION_BYTES,
    AssignmentTaskSubmissionCreate,
    AssignmentTaskSubmissionUpdate,
)
from src.db.users import MAX_PROFILE_FIELD_BYTES, UserCreate, UserUpdate

_OVER_PROFILE = "x" * (MAX_PROFILE_FIELD_BYTES + 1)


class TestUserProfileCaps:
    @pytest.mark.parametrize(
        "field,value",
        [
            ("bio", _OVER_PROFILE),
            ("details", {"k": _OVER_PROFILE}),
            ("profile", {"sections": [{"text": _OVER_PROFILE}]}),
        ],
    )
    def test_update_rejects_oversized_field(self, field, value):
        with pytest.raises(ValidationError):
            UserUpdate(username="u", email="u@example.com", **{field: value})

    @pytest.mark.parametrize(
        "field,value",
        [("bio", _OVER_PROFILE), ("details", {"k": _OVER_PROFILE})],
    )
    def test_create_rejects_oversized_field(self, field, value):
        with pytest.raises(ValidationError):
            UserCreate(username="u", email="u@example.com", password="pw", **{field: value})

    def test_normal_profile_accepted(self):
        user = UserUpdate(
            username="u",
            email="u@example.com",
            bio="Hello",
            details={"title": "Teacher"},
            profile={"sections": [{"type": "text", "text": "x" * 10_000}]},
        )
        assert user.profile["sections"][0]["text"] == "x" * 10_000

    def test_null_fields_accepted(self):
        user = UserUpdate(username="u", email="u@example.com", bio=None, details=None)
        assert user.details is None


class TestTaskSubmissionCap:
    def test_update_rejects_oversized_submission(self):
        with pytest.raises(ValidationError):
            AssignmentTaskSubmissionUpdate(
                task_submission={"answer": "x" * (MAX_TASK_SUBMISSION_BYTES + 1)}
            )

    def test_create_rejects_oversized_submission(self):
        with pytest.raises(ValidationError):
            AssignmentTaskSubmissionCreate(
                assignment_task_submission_uuid="s",
                task_submission={"answer": "x" * (MAX_TASK_SUBMISSION_BYTES + 1)},
                task_submission_grade_feedback="",
                assignment_type="CUSTOM",
                user_id=1,
                activity_id=1,
                course_id=1,
                chapter_id=1,
                assignment_task_id=1,
            )

    def test_code_submission_with_max_results_accepted(self):
        # The code submission endpoint allows up to 1 MB of results.
        sub = AssignmentTaskSubmissionUpdate(
            task_submission={
                "source_code": "print(1)\n" * 5_000,
                "language_id": 71,
                "results": [{"stdout": "y" * 990_000}],
            }
        )
        assert sub.task_submission["language_id"] == 71

    def test_partial_update_without_submission_accepted(self):
        assert AssignmentTaskSubmissionUpdate(grade=5).task_submission is None
