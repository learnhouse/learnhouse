"""Small edge branches in course cloning and quiz scoring.

- Cloning a course whose organization row is gone must 404 before any file
  or row is copied.
- A quiz question whose answer key marks nothing correct scores 0 (the caller
  drops it from the denominator) instead of dividing by zero.
"""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.courses.courses import Course
from src.services.courses.activities.quiz_modes import (
    GRADING_MODE_PARTIAL_CREDIT,
    RESPONSE_TYPE_MULTIPLE,
    score_question,
)
from src.services.courses.courses import clone_course

COURSES_MODULE = "src.services.courses.courses"


class TestCloneCourseMissingOrg:
    async def test_course_whose_org_is_gone_is_404_and_nothing_is_cloned(
        self, db, course, admin_user, mock_request
    ):
        course.org_id = 999
        db.add(course)
        await db.commit()

        with patch(
            f"{COURSES_MODULE}.check_resource_access", new_callable=AsyncMock
        ), patch(
            f"{COURSES_MODULE}.require_org_create_permission", new_callable=AsyncMock
        ), patch(f"{COURSES_MODULE}.check_limits_with_usage") as limits, patch(
            f"{COURSES_MODULE}._copy_storage_directory"
        ) as copy_dir:
            with pytest.raises(HTTPException) as exc:
                await clone_course(mock_request, course.course_uuid, admin_user, db)

        assert exc.value.status_code == 404
        assert exc.value.detail == "Organization not found"
        limits.assert_called_once_with("courses", 999, db)
        copy_dir.assert_not_called()
        courses = (await db.execute(select(Course))).scalars().all()
        assert [c.course_uuid for c in courses] == [course.course_uuid]


class TestScoreQuestionWithoutKey:
    @pytest.mark.parametrize(
        "answers",
        [[(False, True), (False, False)], []],
        ids=["no-correct-option", "no-options"],
    )
    def test_question_with_no_correct_option_scores_zero(self, answers):
        assert score_question(answers, RESPONSE_TYPE_MULTIPLE, GRADING_MODE_PARTIAL_CREDIT) == 0.0
