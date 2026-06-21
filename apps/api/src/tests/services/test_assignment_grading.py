"""
Unit tests for assignment auto-grading correctness.

These exercise the pure grading helpers in
``src.services.courses.activities.assignments`` directly — no DB, no HTTP — so
they assert the actual behavioral contract of the feature: a right answer earns
full marks, a wrong answer earns zero, and partial answers earn a proportional
score. The companion E2E suite (apps/e2e) covers the same logic through the UI;
these give a fast, deterministic safety net that runs in api-tests CI.

Covered:
- ``_check_short_answer`` — all four match modes (exact / case_insensitive /
  contains / regex), plus blank-answer and invalid-regex guards.
- ``_check_number_answer`` — exact, within-tolerance, outside-tolerance, comma
  decimals, blank / non-numeric / non-finite guards.
- ``_grade_quiz_task`` — all-correct / partial / all-wrong / empty.
- ``_grade_form_task`` — all-correct / partial / case + whitespace insensitivity.
- ``_server_verified_task_grade`` — dispatch per task type returns full/zero.
- ``compute_assignment_grade`` — clamping, percentage, per-grading-type display
  and ``passed`` threshold.
- ``_percentage_to_letter_grade`` / ``_percentage_to_gpa`` — boundary mapping.
- ``AUTO_GRADABLE_TASK_TYPES`` — FILE_SUBMISSION / OTHER excluded.
"""

from types import SimpleNamespace

import pytest

from src.db.courses.assignments import AssignmentTaskTypeEnum, GradingTypeEnum
from src.services.courses.activities.assignments import (
    AUTO_GRADABLE_TASK_TYPES,
    _check_number_answer,
    _check_short_answer,
    _grade_form_task,
    _grade_quiz_task,
    _percentage_to_gpa,
    _percentage_to_letter_grade,
    _server_verified_task_grade,
    compute_assignment_grade,
)


# --------------------------------------------------------------------------- #
# Short answer
# --------------------------------------------------------------------------- #
class TestCheckShortAnswer:
    def test_exact_mode_matches_only_identical(self):
        assert _check_short_answer("Paris", ["Paris"], "exact") is True
        assert _check_short_answer("paris", ["Paris"], "exact") is False

    def test_exact_mode_trims_whitespace(self):
        assert _check_short_answer("  Paris  ", ["Paris"], "exact") is True

    def test_case_insensitive_ignores_case(self):
        assert _check_short_answer("paris", ["Paris"], "case_insensitive") is True
        assert _check_short_answer("PARIS", ["Paris"], "case_insensitive") is True
        assert _check_short_answer("London", ["Paris"], "case_insensitive") is False

    def test_case_insensitive_is_the_default_mode(self):
        # mode=None falls back to case_insensitive
        assert _check_short_answer("paris", ["Paris"], None) is True

    def test_contains_matches_substring(self):
        assert _check_short_answer("the city of Paris", ["paris"], "contains") is True
        assert _check_short_answer("Berlin", ["paris"], "contains") is False

    def test_regex_is_anchored_with_fullmatch(self):
        # `hello` must not match `hello world` — fullmatch anchoring
        assert _check_short_answer("hello", ["hello"], "regex") is True
        assert _check_short_answer("hello world", ["hello"], "regex") is False

    def test_regex_pattern_matches(self):
        assert _check_short_answer("cat", ["c.t"], "regex") is True
        assert _check_short_answer("dog", ["c.t"], "regex") is False

    def test_invalid_regex_is_treated_as_no_match(self):
        # Unbalanced bracket — must not raise, just fail to match
        assert _check_short_answer("anything", ["[unclosed"], "regex") is False

    def test_any_accepted_answer_can_match(self):
        accepted = ["Paris", "Lyon", "Marseille"]
        assert _check_short_answer("Lyon", accepted, "case_insensitive") is True

    def test_blank_answer_never_matches(self):
        assert _check_short_answer("", ["Paris"], "exact") is False
        assert _check_short_answer("   ", ["Paris"], "exact") is False
        assert _check_short_answer(None, ["Paris"], "exact") is False

    def test_non_list_accepted_returns_false(self):
        assert _check_short_answer("Paris", "Paris", "exact") is False


# --------------------------------------------------------------------------- #
# Number answer
# --------------------------------------------------------------------------- #
class TestCheckNumberAnswer:
    def test_exact_value_passes(self):
        assert _check_number_answer("42", 42, 0) is True

    def test_within_tolerance_passes(self):
        assert _check_number_answer("41.5", 42, 0.5) is True
        assert _check_number_answer("42.5", 42, 0.5) is True

    def test_outside_tolerance_fails(self):
        assert _check_number_answer("43", 42, 0.5) is False

    def test_negative_tolerance_is_absolute(self):
        # tolerance is abs()'d, so -0.5 behaves like 0.5
        assert _check_number_answer("41.5", 42, -0.5) is True

    def test_comma_decimal_is_accepted(self):
        assert _check_number_answer("41,5", 42, 0.5) is True

    def test_blank_and_non_numeric_fail(self):
        assert _check_number_answer("", 42, 0.5) is False
        assert _check_number_answer("   ", 42, 0.5) is False
        assert _check_number_answer(None, 42, 0.5) is False
        assert _check_number_answer("abc", 42, 0.5) is False

    def test_non_finite_fails(self):
        assert _check_number_answer("inf", 42, 0.5) is False
        assert _check_number_answer("nan", 42, 0.5) is False


# --------------------------------------------------------------------------- #
# Quiz grading
# --------------------------------------------------------------------------- #
def _quiz_contents():
    """One question, two options: opt-a is correct (checked), opt-b is wrong (unchecked)."""
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
    """answers: {optionUUID: bool checkbox state}."""
    return {
        "submissions": [
            {"questionUUID": "q1", "optionUUID": uuid, "answer": ans}
            for uuid, ans in answers.items()
        ]
    }


class TestGradeQuizTask:
    def test_all_correct_earns_full_marks(self):
        # Correct = check 'a' (right) and leave 'b' unchecked → both options match
        sub = _quiz_submission({"a": True, "b": False})
        assert _grade_quiz_task(_quiz_contents(), sub, 100) == 100

    def test_partial_earns_proportional(self):
        # 'a' correct, 'b' wrongly checked → 1 of 2 options correct → 50
        sub = _quiz_submission({"a": True, "b": True})
        assert _grade_quiz_task(_quiz_contents(), sub, 100) == 50

    def test_all_wrong_earns_zero(self):
        # 'a' unchecked (wrong), 'b' checked (wrong) → 0 of 2 correct
        sub = _quiz_submission({"a": False, "b": True})
        assert _grade_quiz_task(_quiz_contents(), sub, 100) == 0

    def test_missing_submission_treated_as_unchecked(self):
        # No submissions at all: 'a' should be checked but isn't (wrong),
        # 'b' should be unchecked and is (correct) → 1 of 2 → 50
        assert _grade_quiz_task(_quiz_contents(), {"submissions": []}, 100) == 50

    def test_zero_options_returns_zero(self):
        assert _grade_quiz_task({"questions": []}, {"submissions": []}, 100) == 0

    def test_zero_task_max_returns_zero(self):
        sub = _quiz_submission({"a": True, "b": False})
        assert _grade_quiz_task(_quiz_contents(), sub, 0) == 0

    def test_respects_task_max_value(self):
        sub = _quiz_submission({"a": True, "b": False})
        assert _grade_quiz_task(_quiz_contents(), sub, 50) == 50


# --------------------------------------------------------------------------- #
# Form grading
# --------------------------------------------------------------------------- #
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


class TestGradeFormTask:
    def test_all_correct_earns_full_marks(self):
        sub = _form_submission({"b1": "Paris", "b2": "France"})
        assert _grade_form_task(_form_contents(), sub, 100) == 100

    def test_partial_earns_proportional(self):
        sub = _form_submission({"b1": "Paris", "b2": "Germany"})
        assert _grade_form_task(_form_contents(), sub, 100) == 50

    def test_all_wrong_earns_zero(self):
        sub = _form_submission({"b1": "London", "b2": "Germany"})
        assert _grade_form_task(_form_contents(), sub, 100) == 0

    def test_case_and_whitespace_insensitive(self):
        sub = _form_submission({"b1": "  paris ", "b2": "FRANCE"})
        assert _grade_form_task(_form_contents(), sub, 100) == 100

    def test_zero_blanks_returns_zero(self):
        assert _grade_form_task({"questions": []}, {"submissions": []}, 100) == 0


# --------------------------------------------------------------------------- #
# Server-verified dispatch
# --------------------------------------------------------------------------- #
def _task(assignment_type, contents, max_grade_value=100):
    return SimpleNamespace(
        assignment_type=assignment_type,
        contents=contents,
        max_grade_value=max_grade_value,
        assignment_task_uuid="task_uuid",
    )


def _task_submission(data):
    return SimpleNamespace(task_submission=data, grade=0)


class TestServerVerifiedTaskGrade:
    @pytest.mark.asyncio
    async def test_short_answer_correct_full_marks(self):
        task = _task(
            AssignmentTaskTypeEnum.SHORT_ANSWER,
            {"correct_answers": ["Paris"], "match_mode": "case_insensitive"},
        )
        ts = _task_submission({"answer": "paris"})
        assert await _server_verified_task_grade(task, ts) == 100

    @pytest.mark.asyncio
    async def test_short_answer_wrong_zero(self):
        task = _task(
            AssignmentTaskTypeEnum.SHORT_ANSWER,
            {"correct_answers": ["Paris"], "match_mode": "case_insensitive"},
        )
        ts = _task_submission({"answer": "London"})
        assert await _server_verified_task_grade(task, ts) == 0

    @pytest.mark.asyncio
    async def test_number_answer_within_tolerance_full_marks(self):
        task = _task(
            AssignmentTaskTypeEnum.NUMBER_ANSWER,
            {"correct_value": 42, "tolerance": 0.5},
        )
        ts = _task_submission({"answer": "41.6"})
        assert await _server_verified_task_grade(task, ts) == 100

    @pytest.mark.asyncio
    async def test_number_answer_outside_tolerance_zero(self):
        task = _task(
            AssignmentTaskTypeEnum.NUMBER_ANSWER,
            {"correct_value": 42, "tolerance": 0.5},
        )
        ts = _task_submission({"answer": "50"})
        assert await _server_verified_task_grade(task, ts) == 0

    @pytest.mark.asyncio
    async def test_quiz_dispatch(self):
        task = _task(AssignmentTaskTypeEnum.QUIZ, _quiz_contents())
        ts = _task_submission(_quiz_submission({"a": True, "b": False}))
        assert await _server_verified_task_grade(task, ts) == 100

    @pytest.mark.asyncio
    async def test_form_dispatch(self):
        task = _task(AssignmentTaskTypeEnum.FORM, _form_contents())
        ts = _task_submission(_form_submission({"b1": "Paris", "b2": "France"}))
        assert await _server_verified_task_grade(task, ts) == 100

    @pytest.mark.asyncio
    async def test_non_verified_type_returns_none(self):
        # FILE_SUBMISSION isn't server-verified → caller falls back to stored grade
        task = _task(AssignmentTaskTypeEnum.FILE_SUBMISSION, {})
        ts = _task_submission({})
        assert await _server_verified_task_grade(task, ts) is None

    @pytest.mark.asyncio
    async def test_none_submission_returns_zero(self):
        task = _task(AssignmentTaskTypeEnum.SHORT_ANSWER, {"correct_answers": ["x"]})
        assert await _server_verified_task_grade(task, None) == 0


# --------------------------------------------------------------------------- #
# Auto-gradable allow-list
# --------------------------------------------------------------------------- #
class TestAutoGradableTaskTypes:
    def test_core_types_are_auto_gradable(self):
        for t in (
            AssignmentTaskTypeEnum.QUIZ,
            AssignmentTaskTypeEnum.FORM,
            AssignmentTaskTypeEnum.SHORT_ANSWER,
            AssignmentTaskTypeEnum.NUMBER_ANSWER,
        ):
            assert t in AUTO_GRADABLE_TASK_TYPES

    def test_file_and_other_require_human_review(self):
        assert AssignmentTaskTypeEnum.FILE_SUBMISSION not in AUTO_GRADABLE_TASK_TYPES
        assert AssignmentTaskTypeEnum.OTHER not in AUTO_GRADABLE_TASK_TYPES


# --------------------------------------------------------------------------- #
# Letter / GPA mapping
# --------------------------------------------------------------------------- #
class TestLetterAndGpaMapping:
    @pytest.mark.parametrize(
        "pct,letter",
        [(95, "A"), (90, "A"), (85, "B"), (75, "C"), (65, "D"), (60, "D"), (59, "F"), (0, "F")],
    )
    def test_letter_boundaries(self, pct, letter):
        assert _percentage_to_letter_grade(pct) == letter

    @pytest.mark.parametrize(
        "pct,gpa",
        [(95, "4.0"), (90, "3.7"), (83, "3.0"), (60, "0.7"), (59, "0.0")],
    )
    def test_gpa_boundaries(self, pct, gpa):
        assert _percentage_to_gpa(pct) == gpa


# --------------------------------------------------------------------------- #
# compute_assignment_grade
# --------------------------------------------------------------------------- #
class TestComputeAssignmentGrade:
    def test_percentage_and_clamping(self):
        result = compute_assignment_grade(85, 100, GradingTypeEnum.NUMERIC)
        assert result["grade"] == 85
        assert result["max_grade"] == 100
        assert result["percentage"] == 85.0
        assert result["passed"] is True

    def test_grade_clamped_to_max(self):
        # A buggy task sum of 120/100 must report 100, not 120
        result = compute_assignment_grade(120, 100, GradingTypeEnum.NUMERIC)
        assert result["grade"] == 100
        assert result["percentage"] == 100.0

    def test_negative_grade_clamped_to_zero(self):
        result = compute_assignment_grade(-10, 100, GradingTypeEnum.NUMERIC)
        assert result["grade"] == 0
        assert result["percentage"] == 0.0

    def test_zero_max_grade_is_safe(self):
        # No divide-by-zero; yields 0%
        result = compute_assignment_grade(0, 0, GradingTypeEnum.NUMERIC)
        assert result["percentage"] == 0.0
        assert result["passed"] is False

    def test_numeric_display_is_out_of_100(self):
        result = compute_assignment_grade(45, 90, GradingTypeEnum.NUMERIC)
        assert result["percentage"] == 50.0
        assert result["display_grade"] == "50/100"

    def test_percentage_type_display(self):
        result = compute_assignment_grade(85, 100, GradingTypeEnum.PERCENTAGE)
        assert result["display_grade"] == "85.00%"

    def test_alphabet_type_display(self):
        result = compute_assignment_grade(85, 100, GradingTypeEnum.ALPHABET)
        assert result["display_grade"] == "B"

    def test_pass_fail_display(self):
        passing = compute_assignment_grade(60, 100, GradingTypeEnum.PASS_FAIL)
        assert passing["display_grade"] == "Pass"
        failing = compute_assignment_grade(40, 100, GradingTypeEnum.PASS_FAIL)
        assert failing["display_grade"] == "Fail"

    def test_gpa_scale_display(self):
        result = compute_assignment_grade(95, 100, GradingTypeEnum.GPA_SCALE)
        assert result["display_grade"] == "4.0"

    def test_default_passing_threshold_is_50_percent(self):
        # NUMERIC passes at 50%
        assert compute_assignment_grade(50, 100, GradingTypeEnum.NUMERIC)["passed"] is True
        assert compute_assignment_grade(49, 100, GradingTypeEnum.NUMERIC)["passed"] is False

    def test_letter_passing_threshold_is_60_percent(self):
        # ALPHABET / GPA_SCALE pass at 60%
        assert compute_assignment_grade(60, 100, GradingTypeEnum.ALPHABET)["passed"] is True
        assert compute_assignment_grade(59, 100, GradingTypeEnum.ALPHABET)["passed"] is False
        assert compute_assignment_grade(60, 100, GradingTypeEnum.GPA_SCALE)["passed"] is True
        assert compute_assignment_grade(59, 100, GradingTypeEnum.GPA_SCALE)["passed"] is False

    def test_string_grading_type_accepted(self):
        # grading_type passed as a plain string still works
        result = compute_assignment_grade(85, 100, "PERCENTAGE")
        assert result["display_grade"] == "85.00%"

    def test_none_grading_type_defaults_to_numeric(self):
        result = compute_assignment_grade(85, 100, None)
        assert result["display_grade"] == "85/100"

    def test_overall_feedback_passed_through(self):
        result = compute_assignment_grade(85, 100, GradingTypeEnum.NUMERIC, "Nice work")
        assert result["overall_feedback"] == "Nice work"
