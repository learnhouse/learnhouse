"""
Edge-case tests for ``_server_verified_task_grade`` and the two grading
allow-lists (``AUTO_GRADABLE_TASK_TYPES`` / ``SERVER_VERIFIED_TASK_TYPES``).

These are NET-NEW cases that complement (do not duplicate) the happy-path
dispatch tests in ``test_assignment_grading.py::TestServerVerifiedTaskGrade``
and the DB-backed ``auto_graded`` re-verification tests in
``test_assignment_manual_grading.py``.

Focus here:
  * ``task_max`` other than the usual 100 (pass returns the task's own max,
    fail still returns 0) for SHORT_ANSWER and NUMBER_ANSWER.
  * ``task_max == 0`` for verified types (the dispatcher returns 0 directly
    for answer types; quiz/form short-circuit on a non-positive max).
  * QUIZ / FORM dispatch returning a PROPORTIONAL grade (not just full marks),
    scaled to the task's max.
  * Missing contents keys (e.g. SHORT_ANSWER with no ``correct_answers``,
    NUMBER_ANSWER with no ``correct_value``) → answer can't match → 0.
  * Both non-verified types (FILE_SUBMISSION *and* OTHER) → ``None`` so the
    caller falls back to the stored grade.
  * ``None`` submission → 0 for every verified, non-CODE type.
  * Set relationship between SERVER_VERIFIED_TASK_TYPES and
    AUTO_GRADABLE_TASK_TYPES.

These functions are ``async``; pytest-asyncio auto mode is on, so the tests
are plain ``async def`` and ``await`` the calls (no marker needed). CODE is
deliberately not exercised here — it delegates to the async Judge0 path, which
is integration-shaped and out of scope for these pure-dispatch edge cases.
"""

from types import SimpleNamespace

from src.db.courses.assignments import AssignmentTaskTypeEnum
from src.services.courses.activities.assignments import (
    AUTO_GRADABLE_TASK_TYPES,
    SERVER_VERIFIED_TASK_TYPES,
    _server_verified_task_grade,
)


def _task(assignment_type, contents, max_grade_value=100):
    return SimpleNamespace(
        assignment_type=assignment_type,
        contents=contents,
        max_grade_value=max_grade_value,
        assignment_task_uuid="task_uuid",
    )


def _ts(data):
    return SimpleNamespace(task_submission=data, grade=0)


def _quiz_contents():
    """One question, two options: 'a' correct (checked), 'b' wrong (unchecked)."""
    return {
        "questions": [
            {
                "questionUUID": "q1",
                "options": [
                    {"optionUUID": "a", "assigned_right_answer": True},
                    {"optionUUID": "b", "assigned_right_answer": False},
                ],
            }
        ]
    }


def _quiz_submission(answers: dict):
    return {
        "submissions": [
            {"questionUUID": "q1", "optionUUID": uuid, "answer": ans}
            for uuid, ans in answers.items()
        ]
    }


def _form_contents():
    return {
        "questions": [
            {
                "questionUUID": "q1",
                "blanks": [
                    {"blankUUID": "b1", "correctAnswer": "Paris"},
                    {"blankUUID": "b2", "correctAnswer": "France"},
                ],
            }
        ]
    }


def _form_submission(answers: dict):
    return {
        "submissions": [
            {"questionUUID": "q1", "blankUUID": uuid, "answer": ans}
            for uuid, ans in answers.items()
        ]
    }


# --------------------------------------------------------------------------- #
# SHORT_ANSWER — task_max other than 100
# --------------------------------------------------------------------------- #
class TestShortAnswerTaskMaxVariants:
    """A passing SHORT_ANSWER returns the task's own max (not a hard-coded 100);
    a failing one always returns 0 regardless of the max."""

    async def test_pass_returns_task_max_when_not_100(self):
        """Passing SHORT_ANSWER returns the task's own max_grade_value (40), not a hard-coded 100."""
        task = _task(
            AssignmentTaskTypeEnum.SHORT_ANSWER,
            {"correct_answers": ["Paris"], "match_mode": "case_insensitive"},
            max_grade_value=40,
        )
        assert await _server_verified_task_grade(task, _ts({"answer": "paris"})) == 40

    async def test_fail_returns_zero_even_with_large_max(self):
        """Failing SHORT_ANSWER returns 0 regardless of how large the task max (250) is."""
        task = _task(
            AssignmentTaskTypeEnum.SHORT_ANSWER,
            {"correct_answers": ["Paris"], "match_mode": "case_insensitive"},
            max_grade_value=250,
        )
        assert await _server_verified_task_grade(task, _ts({"answer": "London"})) == 0

    async def test_pass_returns_large_task_max(self):
        """Passing exact-match SHORT_ANSWER returns the full large task max (250)."""
        task = _task(
            AssignmentTaskTypeEnum.SHORT_ANSWER,
            {"correct_answers": ["Paris"], "match_mode": "exact"},
            max_grade_value=250,
        )
        assert await _server_verified_task_grade(task, _ts({"answer": "Paris"})) == 250


# --------------------------------------------------------------------------- #
# NUMBER_ANSWER — task_max variants, pass/fail
# --------------------------------------------------------------------------- #
class TestNumberAnswerTaskMaxVariants:
    """NUMBER_ANSWER pass returns the task's own max; fail returns 0."""

    async def test_pass_returns_task_max_when_not_100(self):
        """NUMBER_ANSWER within tolerance returns the task's own max (75), not a hard-coded 100."""
        task = _task(
            AssignmentTaskTypeEnum.NUMBER_ANSWER,
            {"correct_value": 42, "tolerance": 0.5},
            max_grade_value=75,
        )
        assert await _server_verified_task_grade(task, _ts({"answer": "41.6"})) == 75

    async def test_fail_returns_zero_when_not_100(self):
        """NUMBER_ANSWER outside tolerance returns 0 even when the task max is non-100 (75)."""
        task = _task(
            AssignmentTaskTypeEnum.NUMBER_ANSWER,
            {"correct_value": 42, "tolerance": 0.5},
            max_grade_value=75,
        )
        assert await _server_verified_task_grade(task, _ts({"answer": "50"})) == 0

    async def test_pass_with_zero_tolerance_exact_match(self):
        """NUMBER_ANSWER with zero tolerance passes on an exact match and returns the task max (20)."""
        task = _task(
            AssignmentTaskTypeEnum.NUMBER_ANSWER,
            {"correct_value": 7, "tolerance": 0},
            max_grade_value=20,
        )
        assert await _server_verified_task_grade(task, _ts({"answer": "7"})) == 20


# --------------------------------------------------------------------------- #
# QUIZ / FORM — proportional (not just full marks)
# --------------------------------------------------------------------------- #
class TestQuizFormProportionalDispatch:
    """QUIZ / FORM dispatch returns a proportional grade scaled to the task
    max, confirming the dispatcher passes ``task_max`` through to the graders."""

    async def test_quiz_half_correct_scaled_to_task_max(self):
        """QUIZ scoring half the options correct returns a proportional grade scaled to the task max (40 of 80)."""
        # 'b' wrongly checked → 1 of 2 options correct → half of max(80) = 40.
        task = _task(AssignmentTaskTypeEnum.QUIZ, _quiz_contents(), max_grade_value=80)
        ts = _ts(_quiz_submission({"a": True, "b": True}))
        assert await _server_verified_task_grade(task, ts) == 40

    async def test_form_half_correct_scaled_to_task_max(self):
        """FORM scoring half the blanks correct returns a proportional grade scaled to the task max (30 of 60)."""
        # b2 wrong → 1 of 2 blanks correct → half of max(60) = 30.
        task = _task(AssignmentTaskTypeEnum.FORM, _form_contents(), max_grade_value=60)
        ts = _ts(_form_submission({"b1": "Paris", "b2": "Germany"}))
        assert await _server_verified_task_grade(task, ts) == 30

    async def test_quiz_proportional_rounds(self):
        """QUIZ proportional grade rounds to the nearest integer (2 of 3 → round(2/3 * 100) = 67)."""
        # 3-option question, 2 correct → round(2/3 * 100) = 67.
        contents = {
            "questions": [
                {
                    "questionUUID": "q1",
                    "options": [
                        {"optionUUID": "a", "assigned_right_answer": True},
                        {"optionUUID": "b", "assigned_right_answer": True},
                        {"optionUUID": "c", "assigned_right_answer": False},
                    ],
                }
            ]
        }
        # a correct, b wrong (unchecked), c correct (unchecked) → 2 of 3 match.
        ts = _ts(_quiz_submission({"a": True, "b": False, "c": False}))
        task = _task(AssignmentTaskTypeEnum.QUIZ, contents, max_grade_value=100)
        assert await _server_verified_task_grade(task, ts) == 67


# --------------------------------------------------------------------------- #
# task_max == 0
# --------------------------------------------------------------------------- #
class TestZeroTaskMax:
    """A task worth 0 points can never award more than 0 for any verified type."""

    async def test_short_answer_pass_with_zero_max_is_zero(self):
        """A correct SHORT_ANSWER on a 0-point task still awards 0."""
        task = _task(
            AssignmentTaskTypeEnum.SHORT_ANSWER,
            {"correct_answers": ["x"], "match_mode": "exact"},
            max_grade_value=0,
        )
        assert await _server_verified_task_grade(task, _ts({"answer": "x"})) == 0

    async def test_number_answer_pass_with_zero_max_is_zero(self):
        """A correct NUMBER_ANSWER on a 0-point task still awards 0."""
        task = _task(
            AssignmentTaskTypeEnum.NUMBER_ANSWER,
            {"correct_value": 5, "tolerance": 0},
            max_grade_value=0,
        )
        assert await _server_verified_task_grade(task, _ts({"answer": "5"})) == 0

    async def test_quiz_all_correct_with_zero_max_is_zero(self):
        """A fully-correct QUIZ on a 0-point task still awards 0 (non-positive max short-circuits)."""
        task = _task(AssignmentTaskTypeEnum.QUIZ, _quiz_contents(), max_grade_value=0)
        ts = _ts(_quiz_submission({"a": True, "b": False}))
        assert await _server_verified_task_grade(task, ts) == 0

    async def test_form_all_correct_with_zero_max_is_zero(self):
        """A fully-correct FORM on a 0-point task still awards 0 (non-positive max short-circuits)."""
        task = _task(AssignmentTaskTypeEnum.FORM, _form_contents(), max_grade_value=0)
        ts = _ts(_form_submission({"b1": "Paris", "b2": "France"}))
        assert await _server_verified_task_grade(task, ts) == 0

    async def test_none_max_grade_value_treated_as_zero(self):
        """A None max_grade_value is coerced to 0, so even a passing answer awards 0."""
        # max_grade_value=None → int(... or 0) == 0 → no credit even on a pass.
        task = _task(
            AssignmentTaskTypeEnum.SHORT_ANSWER,
            {"correct_answers": ["x"], "match_mode": "exact"},
            max_grade_value=None,
        )
        assert await _server_verified_task_grade(task, _ts({"answer": "x"})) == 0


# --------------------------------------------------------------------------- #
# Missing / empty contents keys → cannot match → 0
# --------------------------------------------------------------------------- #
class TestMissingContentsKeys:
    """When the teacher's task contents lack the keys the grader needs, the
    student's answer can't match, so the verified grade is 0 (never an error)."""

    async def test_short_answer_no_correct_answers_key_fails(self):
        """SHORT_ANSWER with no correct_answers key defaults to [] so nothing can match → 0."""
        # Default correct_answers=[] → nothing to match → 0.
        task = _task(AssignmentTaskTypeEnum.SHORT_ANSWER, {})
        assert await _server_verified_task_grade(task, _ts({"answer": "anything"})) == 0

    async def test_short_answer_empty_contents_object(self):
        """SHORT_ANSWER with empty contents and a non-zero max still scores 0 (no correct answers to match)."""
        task = _task(AssignmentTaskTypeEnum.SHORT_ANSWER, {}, max_grade_value=50)
        assert await _server_verified_task_grade(task, _ts({"answer": "x"})) == 0

    async def test_short_answer_missing_answer_in_submission(self):
        """SHORT_ANSWER with no 'answer' key in the submission is treated as blank → 0."""
        # Submission has no 'answer' key → None answer → blank → 0.
        task = _task(
            AssignmentTaskTypeEnum.SHORT_ANSWER,
            {"correct_answers": ["x"], "match_mode": "exact"},
        )
        assert await _server_verified_task_grade(task, _ts({})) == 0

    async def test_number_answer_no_correct_value_defaults_to_zero(self):
        """NUMBER_ANSWER with no correct_value defaults to 0, so a '0' answer passes for full marks (100)."""
        # correct_value missing → grader compares against 0. A 0 answer with
        # default 0 tolerance therefore PASSES — pin this real behavior.
        task = _task(AssignmentTaskTypeEnum.NUMBER_ANSWER, {})
        assert await _server_verified_task_grade(task, _ts({"answer": "0"})) == 100

    async def test_number_answer_no_correct_value_nonzero_answer_fails(self):
        """NUMBER_ANSWER with no correct_value/tolerance (both →0) scores a non-zero answer as 0."""
        # correct_value missing (→0), tolerance missing (→0): a non-zero answer
        # is outside tolerance → 0.
        task = _task(AssignmentTaskTypeEnum.NUMBER_ANSWER, {})
        assert await _server_verified_task_grade(task, _ts({"answer": "5"})) == 0

    async def test_none_contents_does_not_raise(self):
        """SHORT_ANSWER with None contents is coerced to {} and scores 0 without raising."""
        # task.contents is None → coerced to {} → empty correct_answers → 0.
        task = _task(AssignmentTaskTypeEnum.SHORT_ANSWER, None)
        assert await _server_verified_task_grade(task, _ts({"answer": "x"})) == 0


# --------------------------------------------------------------------------- #
# Non-verified types → None (caller falls back to stored grade)
# --------------------------------------------------------------------------- #
class TestNonVerifiedTypesReturnNone:
    """FILE_SUBMISSION and OTHER are NOT server-verified: the dispatcher
    returns None so the caller keeps the stored grade. None is returned even
    when a (non-empty) submission exists."""

    async def test_file_submission_returns_none(self):
        """FILE_SUBMISSION is not server-verified, so the dispatcher returns None to keep the stored grade."""
        task = _task(AssignmentTaskTypeEnum.FILE_SUBMISSION, {})
        assert await _server_verified_task_grade(task, _ts({"file": "a.pdf"})) is None

    async def test_other_returns_none(self):
        """OTHER is not server-verified, so the dispatcher returns None to keep the stored grade."""
        task = _task(AssignmentTaskTypeEnum.OTHER, {})
        assert await _server_verified_task_grade(task, _ts({"answer": "x"})) is None

    async def test_non_verified_with_none_submission_still_none(self):
        """A non-verified type returns None even with a None submission (type check precedes the None check)."""
        # Type check happens BEFORE the None-submission check, so a non-verified
        # type returns None even with no submission (not 0).
        task = _task(AssignmentTaskTypeEnum.OTHER, {})
        assert await _server_verified_task_grade(task, None) is None


# --------------------------------------------------------------------------- #
# None submission → 0 for verified types
# --------------------------------------------------------------------------- #
class TestNoneSubmissionVerifiedTypes:
    """A None submission for a verified, non-CODE type scores 0 (a missing
    answer can't earn credit), short-circuiting before the per-type graders."""

    async def test_number_answer_none_submission_zero(self):
        """A None submission for NUMBER_ANSWER scores 0 (missing answer can't earn credit)."""
        task = _task(
            AssignmentTaskTypeEnum.NUMBER_ANSWER,
            {"correct_value": 5, "tolerance": 0},
        )
        assert await _server_verified_task_grade(task, None) == 0

    async def test_quiz_none_submission_zero(self):
        """A None submission for QUIZ scores 0 (missing answer can't earn credit)."""
        task = _task(AssignmentTaskTypeEnum.QUIZ, _quiz_contents())
        assert await _server_verified_task_grade(task, None) == 0

    async def test_form_none_submission_zero(self):
        """A None submission for FORM scores 0 (missing answers can't earn credit)."""
        task = _task(AssignmentTaskTypeEnum.FORM, _form_contents())
        assert await _server_verified_task_grade(task, None) == 0


# --------------------------------------------------------------------------- #
# Allow-list set relationships
# --------------------------------------------------------------------------- #
class TestAllowListSetRelationships:
    """Pin the relationship between the two allow-lists and which types each
    excludes."""

    async def test_all_server_verified_are_also_auto_gradable(self):
        """Every server-verified type is also auto-gradable (else re-verification could never run)."""
        assert SERVER_VERIFIED_TASK_TYPES.issubset(AUTO_GRADABLE_TASK_TYPES)

    async def test_two_lists_are_currently_identical(self):
        """The two allow-lists are exactly equal as configured today (CODE is in both)."""
        assert SERVER_VERIFIED_TASK_TYPES == AUTO_GRADABLE_TASK_TYPES

    async def test_code_is_in_both_lists(self):
        """CODE is both auto-gradable and server-verified."""
        assert AssignmentTaskTypeEnum.CODE in SERVER_VERIFIED_TASK_TYPES
        assert AssignmentTaskTypeEnum.CODE in AUTO_GRADABLE_TASK_TYPES

    async def test_file_and_other_in_neither_list(self):
        """FILE_SUBMISSION and OTHER are in neither allow-list (always require human grading)."""
        for t in (AssignmentTaskTypeEnum.FILE_SUBMISSION, AssignmentTaskTypeEnum.OTHER):
            assert t not in AUTO_GRADABLE_TASK_TYPES
            assert t not in SERVER_VERIFIED_TASK_TYPES
