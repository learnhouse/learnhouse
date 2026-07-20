"""
Tests for ``_student_may_see_answer_key`` — the gate that decides whether a
student receives the correct-answer key in the task GET payload.

Covers the base contract (opt-in + own submission GRADED + PublicUser) and the
M5 fix: while the student can still RETRY, revealing the key is a trivial 100%
bypass (read the answers, hit "Try again", resubmit for full marks). Reveal is
therefore suppressed until no retry attempt remains.
"""

from datetime import datetime

import pytest

from src.db.courses.assignments import (
    Assignment,
    AssignmentUserSubmission,
    AssignmentUserSubmissionStatus,
    GradingTypeEnum,
)
from src.db.users import AnonymousUser
from src.services.courses.activities.assignments import _student_may_see_answer_key


async def _make(
    db,
    org,
    course,
    chapter,
    activity,
    user,
    *,
    show_correct_answers=True,
    allow_retries=False,
    max_retries=0,
    status=AssignmentUserSubmissionStatus.GRADED,
    attempt_number=1,
    with_submission=True,
):
    assignment = Assignment(
        title="Reveal",
        description="x",
        due_date="2030-01-01",
        published=True,
        grading_type=GradingTypeEnum.NUMERIC,
        show_correct_answers=show_correct_answers,
        allow_retries=allow_retries,
        max_retries=max_retries,
        org_id=org.id,
        course_id=course.id,
        chapter_id=chapter.id,
        activity_id=activity.id,
        assignment_uuid=f"assignment_reveal_{show_correct_answers}_{allow_retries}_{max_retries}_{attempt_number}_{status}_{with_submission}",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(assignment)
    await db.commit()
    await db.refresh(assignment)

    if with_submission:
        db.add(
            AssignmentUserSubmission(
                user_id=user.id,
                assignment_id=assignment.id,
                grade=0,
                submission_status=status,
                attempt_number=attempt_number,
                assignmentusersubmission_uuid=f"aus_reveal_{assignment.id}",
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
        )
        await db.commit()
    return assignment


class TestStudentMaySeeAnswerKey:
    @pytest.mark.asyncio
    async def test_opt_out_never_reveals(self, db, org, course, chapter, activity, regular_user):
        a = await _make(db, org, course, chapter, activity, regular_user, show_correct_answers=False)
        assert await _student_may_see_answer_key(regular_user, a, db) is False

    @pytest.mark.asyncio
    async def test_anonymous_never_reveals(self, db, org, course, chapter, activity, regular_user):
        a = await _make(db, org, course, chapter, activity, regular_user)
        assert await _student_may_see_answer_key(AnonymousUser(), a, db) is False

    @pytest.mark.asyncio
    async def test_not_graded_does_not_reveal(self, db, org, course, chapter, activity, regular_user):
        a = await _make(
            db, org, course, chapter, activity, regular_user,
            status=AssignmentUserSubmissionStatus.SUBMITTED,
        )
        assert await _student_may_see_answer_key(regular_user, a, db) is False

    @pytest.mark.asyncio
    async def test_no_submission_does_not_reveal(self, db, org, course, chapter, activity, regular_user):
        a = await _make(db, org, course, chapter, activity, regular_user, with_submission=False)
        assert await _student_may_see_answer_key(regular_user, a, db) is False

    @pytest.mark.asyncio
    async def test_graded_no_retries_reveals(self, db, org, course, chapter, activity, regular_user):
        a = await _make(db, org, course, chapter, activity, regular_user, allow_retries=False)
        assert await _student_may_see_answer_key(regular_user, a, db) is True

    @pytest.mark.asyncio
    async def test_unlimited_retries_never_reveals(self, db, org, course, chapter, activity, regular_user):
        # max_retries=0 with allow_retries means unlimited attempts → always
        # another chance to resubmit → reveal must stay suppressed.
        a = await _make(
            db, org, course, chapter, activity, regular_user,
            allow_retries=True, max_retries=0,
        )
        assert await _student_may_see_answer_key(regular_user, a, db) is False

    @pytest.mark.asyncio
    async def test_bounded_retries_remaining_does_not_reveal(self, db, org, course, chapter, activity, regular_user):
        # attempt 1 of 3 → retries remain → suppressed.
        a = await _make(
            db, org, course, chapter, activity, regular_user,
            allow_retries=True, max_retries=3, attempt_number=1,
        )
        assert await _student_may_see_answer_key(regular_user, a, db) is False

    @pytest.mark.asyncio
    async def test_bounded_retries_exhausted_reveals(self, db, org, course, chapter, activity, regular_user):
        # attempt 3 of 3 → no retry remaining → safe to reveal.
        a = await _make(
            db, org, course, chapter, activity, regular_user,
            allow_retries=True, max_retries=3, attempt_number=3,
        )
        assert await _student_may_see_answer_key(regular_user, a, db) is True
