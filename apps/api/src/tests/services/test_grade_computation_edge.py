"""
Edge-case unit tests for grade computation/formatting helpers in
``src.services.courses.activities.assignments``.

These are net-new edge cases that complement (do NOT duplicate) the happy-path
coverage in ``test_assignment_grading.py`` (classes TestLetterAndGpaMapping and
TestComputeAssignmentGrade). They pin down exact boundary behavior so a refactor
of the rounding / clamping / threshold logic can't silently shift a grade.

Functions under test:
- ``_percentage_to_letter_grade`` — every A/B/C/D/F cut line, including the
  fractional 89.99-vs-90 / 59.99-vs-60 boundaries.
- ``_percentage_to_gpa`` — every 4.0 → 0.0 cut line and just-below variants.
- ``compute_assignment_grade`` — clamping (raw>max, negative, max<=0), the
  2-decimal percentage rounding, per-grading-type display strings, the
  mode-aware pass/fail threshold (50% default, 60% ALPHABET/GPA), grading_type
  as enum/string/None/unknown, overall_feedback variants, and the always-present
  secondary fields (letter_grade / points_summary / percentage_display).
- ``_build_tasks_breakdown`` — row shape, percentage clamp, div-by-zero guard on
  a zero-max task, submitted flag, points_summary, and the per-row passed flag
  relative to the supplied threshold.

All assertions are pinned to REAL observed behavior of the product code; nothing
here changes the product. Any surprising results are noted in the suite report,
not "fixed" by loosening an assertion.
"""

from types import SimpleNamespace

import pytest

from src.db.courses.assignments import AssignmentTaskTypeEnum, GradingTypeEnum
from src.services.courses.activities.assignments import (
    DEFAULT_PASSING_THRESHOLD_PERCENTAGE,
    LETTER_PASSING_THRESHOLD_PERCENTAGE,
    _build_tasks_breakdown,
    _percentage_to_gpa,
    _percentage_to_letter_grade,
    compute_assignment_grade,
)


# --------------------------------------------------------------------------- #
# _percentage_to_letter_grade — every cut line + fractional boundaries
# --------------------------------------------------------------------------- #
class TestLetterGradeBoundaries:
    """Pin every A/B/C/D/F threshold including the fractional just-below cases."""

    @pytest.mark.parametrize(
        "pct,letter",
        [
            # Just-below vs at-threshold for each cut line
            (89.99, "B"),
            (90.0, "A"),
            (79.99, "C"),
            (80.0, "B"),
            (69.99, "D"),
            (70.0, "C"),
            (59.99, "F"),
            (60.0, "D"),
            # Extremes
            (100.0, "A"),
            (0.0, "F"),
        ],
    )
    def test_letter_cut_lines(self, pct, letter):
        """Boundary/parametrized: each A/B/C/D/F cut line maps a percentage to the correct letter grade."""
        assert _percentage_to_letter_grade(pct) == letter


# --------------------------------------------------------------------------- #
# _percentage_to_gpa — every cut line + just-below variants
# --------------------------------------------------------------------------- #
class TestGpaBoundaries:
    """Pin every GPA cut line (4.0 down to 0.0) and the just-below boundary."""

    @pytest.mark.parametrize(
        "pct,gpa",
        [
            (93.0, "4.0"),
            (92.99, "3.7"),
            (90.0, "3.7"),
            (89.99, "3.3"),
            (87.0, "3.3"),
            (86.99, "3.0"),
            (83.0, "3.0"),
            (82.99, "2.7"),
            (80.0, "2.7"),
            (79.99, "2.3"),
            (77.0, "2.3"),
            (76.99, "2.0"),
            (73.0, "2.0"),
            (72.99, "1.7"),
            (70.0, "1.7"),
            (69.99, "1.3"),
            (67.0, "1.3"),
            (66.99, "1.0"),
            (63.0, "1.0"),
            (62.99, "0.7"),
            (60.0, "0.7"),
            (59.99, "0.0"),
            (0.0, "0.0"),
            (100.0, "4.0"),
        ],
    )
    def test_gpa_cut_lines(self, pct, gpa):
        """Boundary/parametrized: each GPA cut line (4.0 down to 0.0) maps a percentage to the correct GPA string."""
        assert _percentage_to_gpa(pct) == gpa


# --------------------------------------------------------------------------- #
# compute_assignment_grade — clamping edge cases
# --------------------------------------------------------------------------- #
class TestComputeClamping:
    """Clamp raw to [0, max]; guard max<=0; never divide by zero."""

    def test_raw_far_above_max_clamps_to_max(self):
        """A raw grade far above max clamps to the max grade (100%, no over-100%)."""
        r = compute_assignment_grade(9999, 100, GradingTypeEnum.NUMERIC)
        assert r["grade"] == 100
        assert r["percentage"] == 100.0
        assert r["display_grade"] == "100/100"

    def test_negative_max_treated_as_zero(self):
        """A negative max is clamped to 0, yielding grade 0 and 0% with no divide-by-zero."""
        # max<=0 → clamped_max 0 → 0% (not divide-by-zero, not negative)
        r = compute_assignment_grade(50, -10, GradingTypeEnum.NUMERIC)
        assert r["max_grade"] == 0
        assert r["grade"] == 0  # clamped against clamped_max=0
        assert r["percentage"] == 0.0
        assert r["points_summary"] == "0/0 pts"

    def test_raw_zero_max_zero(self):
        """Zero raw and zero max yields 0%, not passed, and a "0/100" numeric display without dividing by zero."""
        r = compute_assignment_grade(0, 0, GradingTypeEnum.NUMERIC)
        assert r["grade"] == 0
        assert r["max_grade"] == 0
        assert r["percentage"] == 0.0
        assert r["passed"] is False
        assert r["display_grade"] == "0/100"

    def test_negative_raw_with_positive_max(self):
        """A negative raw grade clamps to 0, giving 0% and a "0.00%" percentage display."""
        r = compute_assignment_grade(-5, 200, GradingTypeEnum.PERCENTAGE)
        assert r["grade"] == 0
        assert r["percentage"] == 0.0
        assert r["display_grade"] == "0.00%"

    def test_very_large_max(self):
        """A large max computes the exact percentage (750/1000 = 75%) and reports raw points in points_summary."""
        # 750/1000 = 75% exactly
        r = compute_assignment_grade(750, 1000, GradingTypeEnum.NUMERIC)
        assert r["percentage"] == 75.0
        assert r["display_grade"] == "75/100"
        assert r["points_summary"] == "750/1000 pts"


# --------------------------------------------------------------------------- #
# compute_assignment_grade — percentage rounding edge cases
# --------------------------------------------------------------------------- #
class TestComputeRounding:
    """Percentage is rounded to 2dp; NUMERIC display rounds pct to an int."""

    def test_two_thirds_rounds_to_two_decimals(self):
        """2/3 rounds the percentage to 2 decimals (66.67%) in percentage and percentage_display."""
        # 2/3 = 66.666... → 66.67
        r = compute_assignment_grade(2, 3, GradingTypeEnum.PERCENTAGE)
        assert r["percentage"] == 66.67
        assert r["display_grade"] == "66.67%"
        assert r["percentage_display"] == "66.67%"

    def test_one_third_rounds_to_two_decimals(self):
        """1/3 rounds the percentage to 2 decimals (33.33%) with a "33.33%" display."""
        # 1/3 = 33.333... → 33.33
        r = compute_assignment_grade(1, 3, GradingTypeEnum.PERCENTAGE)
        assert r["percentage"] == 33.33
        assert r["display_grade"] == "33.33%"

    def test_numeric_display_rounds_percentage_to_int(self):
        """NUMERIC display rounds the 2dp percentage to an integer (66.67% shows "67/100")."""
        # 2/3 → 66.67% → NUMERIC shows round(66.67) = 67 (banker's rounding N/A here)
        r = compute_assignment_grade(2, 3, GradingTypeEnum.NUMERIC)
        assert r["percentage"] == 66.67
        assert r["display_grade"] == "67/100"

    def test_numeric_display_banker_rounding_half(self):
        """NUMERIC display uses banker's (half-to-even) rounding: 12.5% rounds down to "12/100"."""
        # 1/8 = 12.5% exactly → round() uses banker's rounding → 12 (round-half-to-even)
        r = compute_assignment_grade(1, 8, GradingTypeEnum.NUMERIC)
        assert r["percentage"] == 12.5
        assert r["display_grade"] == "12/100"

    def test_numeric_display_banker_rounding_half_to_even_up(self):
        """NUMERIC display banker's rounding rounds 17.5% up to the nearest even integer ("18/100")."""
        # 7/40 = 17.5% → round(17.5) → 18 (nearest even)
        r = compute_assignment_grade(7, 40, GradingTypeEnum.NUMERIC)
        assert r["percentage"] == 17.5
        assert r["display_grade"] == "18/100"


# --------------------------------------------------------------------------- #
# compute_assignment_grade — pass/fail threshold per grading type at boundary
# --------------------------------------------------------------------------- #
class TestComputePassThresholdBoundaries:
    """Exercise the exact threshold line for each grading type.

    DEFAULT (NUMERIC/PERCENTAGE/PASS_FAIL/unknown) passes at 50%.
    ALPHABET / GPA_SCALE pass at 60%. We use raw/max combos that land just
    below and exactly on the line.
    """

    # -- 50% default threshold (use max=10000 to express 49.99 vs 50.00) --
    def test_default_just_below_50_fails(self):
        """Default-threshold type just below 50% (49.99%) does not pass."""
        # 4999/10000 = 49.99%
        r = compute_assignment_grade(4999, 10000, GradingTypeEnum.NUMERIC)
        assert r["percentage"] == 49.99
        assert r["passed"] is False

    def test_default_exactly_50_passes(self):
        """Default-threshold type exactly at 50% passes (threshold is inclusive)."""
        r = compute_assignment_grade(5000, 10000, GradingTypeEnum.NUMERIC)
        assert r["percentage"] == 50.0
        assert r["passed"] is True

    def test_percentage_type_threshold_is_also_50(self):
        """PERCENTAGE grading type also passes at 50% and fails just below it."""
        assert compute_assignment_grade(50, 100, GradingTypeEnum.PERCENTAGE)["passed"] is True
        assert compute_assignment_grade(49, 100, GradingTypeEnum.PERCENTAGE)["passed"] is False

    def test_pass_fail_threshold_is_50(self):
        """PASS_FAIL type passes/shows "Pass" at exactly 50% and fails/shows "Fail" just below."""
        # Boundary: exactly 50% should read "Pass"
        on = compute_assignment_grade(5000, 10000, GradingTypeEnum.PASS_FAIL)
        assert on["passed"] is True
        assert on["display_grade"] == "Pass"
        below = compute_assignment_grade(4999, 10000, GradingTypeEnum.PASS_FAIL)
        assert below["passed"] is False
        assert below["display_grade"] == "Fail"

    # -- 60% letter threshold for ALPHABET / GPA_SCALE --
    def test_alphabet_just_below_60_fails(self):
        """ALPHABET type just below its 60% threshold (59.99%) fails and displays "F"."""
        # 5999/10000 = 59.99%
        r = compute_assignment_grade(5999, 10000, GradingTypeEnum.ALPHABET)
        assert r["percentage"] == 59.99
        assert r["passed"] is False
        # Display: 59.99% maps to "F"
        assert r["display_grade"] == "F"

    def test_alphabet_exactly_60_passes(self):
        """ALPHABET type at exactly 60% passes and displays "D"."""
        r = compute_assignment_grade(6000, 10000, GradingTypeEnum.ALPHABET)
        assert r["percentage"] == 60.0
        assert r["passed"] is True
        assert r["display_grade"] == "D"

    def test_gpa_just_below_60_fails(self):
        """GPA_SCALE type just below its 60% threshold (59.99%) fails and displays "0.0"."""
        r = compute_assignment_grade(5999, 10000, GradingTypeEnum.GPA_SCALE)
        assert r["percentage"] == 59.99
        assert r["passed"] is False
        assert r["display_grade"] == "0.0"

    def test_gpa_exactly_60_passes(self):
        """GPA_SCALE type at exactly 60% passes and displays "0.7"."""
        r = compute_assignment_grade(6000, 10000, GradingTypeEnum.GPA_SCALE)
        assert r["percentage"] == 60.0
        assert r["passed"] is True
        assert r["display_grade"] == "0.7"

    def test_alphabet_below_50_still_uses_60_threshold(self):
        """ALPHABET at 55% (above 50% default but below its 60%) fails, confirming it uses the 60% threshold."""
        # ALPHABET at 55% (above the 50% default but below its own 60%) → fail
        r = compute_assignment_grade(55, 100, GradingTypeEnum.ALPHABET)
        assert r["passed"] is False

    def test_threshold_constants_are_reported_in_result(self):
        """Result's passing_threshold equals the 50% default for NUMERIC and the 60% letter constant for ALPHABET."""
        num = compute_assignment_grade(50, 100, GradingTypeEnum.NUMERIC)
        assert num["passing_threshold"] == DEFAULT_PASSING_THRESHOLD_PERCENTAGE == 50.0
        alpha = compute_assignment_grade(50, 100, GradingTypeEnum.ALPHABET)
        assert alpha["passing_threshold"] == LETTER_PASSING_THRESHOLD_PERCENTAGE == 60.0


# --------------------------------------------------------------------------- #
# compute_assignment_grade — grading_type as enum / string / None / unknown
# --------------------------------------------------------------------------- #
class TestComputeGradingTypeForms:
    """grading_type accepts enum, plain string, None, or an unknown string."""

    def test_unknown_string_defaults_to_numeric_display(self):
        """An unknown grading_type string uses NUMERIC display and 50% threshold while preserving the raw value."""
        # Unknown type falls into the else branch → "X/100" + 50% threshold
        r = compute_assignment_grade(85, 100, "SOMETHING_WEIRD")
        assert r["display_grade"] == "85/100"
        assert r["grading_type"] == "SOMETHING_WEIRD"  # value preserved verbatim
        assert r["passing_threshold"] == 50.0

    def test_empty_string_defaults_to_numeric(self):
        """An empty grading_type string (falsy) defaults to "NUMERIC" with numeric display."""
        # Empty string is falsy → "" or "NUMERIC" → "NUMERIC"
        r = compute_assignment_grade(85, 100, "")
        assert r["grading_type"] == "NUMERIC"
        assert r["display_grade"] == "85/100"

    def test_none_grading_type_records_numeric_value(self):
        """A None grading_type defaults to "NUMERIC" with numeric display."""
        r = compute_assignment_grade(85, 100, None)
        assert r["grading_type"] == "NUMERIC"
        assert r["display_grade"] == "85/100"

    def test_lowercase_string_does_not_match_uppercase_branches(self):
        """A lowercase "alphabet" string fails the case-sensitive match and falls back to NUMERIC display and 50% threshold."""
        # Branch comparison is case-sensitive against "ALPHABET" etc.
        # "alphabet" won't match → falls to NUMERIC default display + 50% threshold.
        r = compute_assignment_grade(85, 100, "alphabet")
        assert r["display_grade"] == "85/100"
        assert r["passing_threshold"] == 50.0
        assert r["grading_type"] == "alphabet"

    def test_enum_and_equivalent_string_agree(self):
        """Passing the ALPHABET enum and its equivalent "ALPHABET" string yield identical display and threshold."""
        enum_r = compute_assignment_grade(85, 100, GradingTypeEnum.ALPHABET)
        str_r = compute_assignment_grade(85, 100, "ALPHABET")
        assert enum_r["display_grade"] == str_r["display_grade"] == "B"
        assert enum_r["passing_threshold"] == str_r["passing_threshold"] == 60.0


# --------------------------------------------------------------------------- #
# compute_assignment_grade — overall_feedback variants & secondary fields
# --------------------------------------------------------------------------- #
class TestComputeFeedbackAndSecondaryFields:
    """overall_feedback passes through unchanged; secondary fields always present."""

    def test_feedback_default_is_none(self):
        """When no feedback is passed, overall_feedback defaults to None."""
        r = compute_assignment_grade(85, 100, GradingTypeEnum.NUMERIC)
        assert r["overall_feedback"] is None

    def test_feedback_empty_string_preserved(self):
        """An empty feedback string is preserved verbatim, not coerced to None."""
        # Empty string is NOT coerced to None — passed through verbatim
        r = compute_assignment_grade(85, 100, GradingTypeEnum.NUMERIC, "")
        assert r["overall_feedback"] == ""

    def test_feedback_text_preserved(self):
        """Non-empty feedback text passes through unchanged into overall_feedback."""
        r = compute_assignment_grade(85, 100, GradingTypeEnum.NUMERIC, "Great job!")
        assert r["overall_feedback"] == "Great job!"

    def test_secondary_fields_present_for_every_grading_type(self):
        """Secondary fields (letter/points/percentage) + the full key set are present for every grading type."""
        # letter_grade / points_summary / percentage_display always present,
        # independent of display_grade's grading-type-specific format.
        for gt in GradingTypeEnum:
            r = compute_assignment_grade(85, 100, gt)
            assert r["letter_grade"] == "B"
            assert r["points_summary"] == "85/100 pts"
            assert r["percentage_display"] == "85.00%"
            # display_grade is type-specific but secondary fields are stable
            assert set(r) >= {
                "grade",
                "max_grade",
                "percentage",
                "display_grade",
                "letter_grade",
                "points_summary",
                "percentage_display",
                "passed",
                "passing_threshold",
                "grading_type",
                "overall_feedback",
            }


# --------------------------------------------------------------------------- #
# _build_tasks_breakdown
# --------------------------------------------------------------------------- #
def _bt_task(id, max_grade_value, title="T", description="D",
             assignment_type=AssignmentTaskTypeEnum.QUIZ):
    """Lightweight stand-in for an AssignmentTask row used by _build_tasks_breakdown."""
    return SimpleNamespace(
        id=id,
        assignment_task_uuid=f"task_{id}",
        title=title,
        description=description,
        assignment_type=assignment_type,
        max_grade_value=max_grade_value,
    )


def _bt_submission(grade, feedback="ok", manually_graded=False):
    return SimpleNamespace(
        grade=grade,
        task_submission_grade_feedback=feedback,
        manually_graded=manually_graded,
    )


class TestBuildTasksBreakdown:
    """Per-task breakdown rows: clamp, div-by-zero guard, submitted flag, passed."""

    def test_single_task_full_row_shape(self):
        """A single submitted task produces a breakdown row with all expected fields and values."""
        task = _bt_task(1, 100, title="Quiz 1", description="desc")
        subs = {1: _bt_submission(80, "good")}
        rows = _build_tasks_breakdown([task], subs, passing_threshold=50.0)
        assert len(rows) == 1
        row = rows[0]
        assert row["index"] == 1
        assert row["assignment_task_uuid"] == "task_1"
        assert row["title"] == "Quiz 1"
        assert row["description"] == "desc"
        assert row["assignment_type"] == AssignmentTaskTypeEnum.QUIZ
        assert row["submitted"] is True
        assert row["grade"] == 80
        assert row["max_grade"] == 100
        assert row["percentage"] == 80.0
        assert row["percentage_display"] == "80%"
        assert row["points_summary"] == "80/100"
        assert row["passed"] is True
        assert row["feedback"] == "good"
        assert row["manually_graded"] is False

    def test_no_submission_marks_unsubmitted_zero_grade(self):
        """A task with no submission yields submitted=False, grade 0, no feedback, and failed."""
        # Task present, no submission in the map → submitted False, grade 0,
        # feedback None, passed determined against 0%.
        task = _bt_task(1, 100)
        rows = _build_tasks_breakdown([task], {}, passing_threshold=50.0)
        row = rows[0]
        assert row["submitted"] is False
        assert row["grade"] == 0
        assert row["percentage"] == 0.0
        assert row["points_summary"] == "0/100"
        assert row["passed"] is False
        assert row["feedback"] is None

    def test_zero_max_task_no_divide_by_zero(self):
        """A task with max_grade_value 0 yields 0% (guarded against divide-by-zero)."""
        # max_grade_value 0 → percentage 0.0, not a ZeroDivisionError
        task = _bt_task(1, 0)
        subs = {1: _bt_submission(5)}
        rows = _build_tasks_breakdown([task], subs, passing_threshold=50.0)
        row = rows[0]
        assert row["max_grade"] == 0
        assert row["percentage"] == 0.0
        assert row["points_summary"] == "5/0"
        assert row["passed"] is False

    def test_percentage_clamped_to_100(self):
        """A grade above the task max clamps the row percentage to 100 while the raw grade is shown as-is."""
        # Buggy submission grade above the task max → percentage capped at 100,
        # but the raw grade itself is reported as-is (breakdown does not clamp grade).
        task = _bt_task(1, 50)
        subs = {1: _bt_submission(75)}  # 150% raw
        rows = _build_tasks_breakdown([task], subs, passing_threshold=50.0)
        row = rows[0]
        assert row["grade"] == 75  # raw grade unchanged
        assert row["percentage"] == 100.0  # clamped
        assert row["percentage_display"] == "100%"
        assert row["points_summary"] == "75/50"
        assert row["passed"] is True

    def test_passed_flag_relative_to_threshold(self):
        """A row's passed flag is computed >= the supplied passing threshold (60% passes at 60, fails at 70)."""
        # 60% task percentage against a 60% threshold → passed True (>=).
        task = _bt_task(1, 100)
        rows = _build_tasks_breakdown([task], {1: _bt_submission(60)}, passing_threshold=60.0)
        assert rows[0]["passed"] is True
        # Same percentage against a higher 70% threshold → failed.
        rows2 = _build_tasks_breakdown([task], {1: _bt_submission(60)}, passing_threshold=70.0)
        assert rows2[0]["passed"] is False

    def test_percentage_rounded_to_two_decimals(self):
        """A row's percentage is rounded to 2 decimals (33.33%) while its display string shows no decimals (33%)."""
        # 1/3 of a 3-point task → 33.33%
        task = _bt_task(1, 3)
        rows = _build_tasks_breakdown([task], {1: _bt_submission(1)}, passing_threshold=50.0)
        assert rows[0]["percentage"] == 33.33
        # percentage_display formats with NO decimals (:.0f)
        assert rows[0]["percentage_display"] == "33%"

    def test_many_tasks_sorted_by_id_and_indexed(self):
        """Tasks given out of order are sorted by id and 1-based-indexed in the breakdown rows."""
        # Tasks supplied out of order are sorted by id; index is 1-based in sorted order.
        t3 = _bt_task(3, 100, title="third")
        t1 = _bt_task(1, 100, title="first")
        t2 = _bt_task(2, 100, title="second")
        subs = {
            1: _bt_submission(100),
            2: _bt_submission(40),
            # task 3 has no submission
        }
        rows = _build_tasks_breakdown([t3, t1, t2], subs, passing_threshold=50.0)
        assert [r["title"] for r in rows] == ["first", "second", "third"]
        assert [r["index"] for r in rows] == [1, 2, 3]
        assert [r["submitted"] for r in rows] == [True, True, False]
        assert [r["passed"] for r in rows] == [True, False, False]

    def test_none_id_sorts_as_zero(self):
        """A task with a None id sorts as 0 (ahead of positive ids) in the breakdown ordering."""
        # sort key uses (t.id or 0); a None id sorts ahead of positive ids.
        t_none = _bt_task(None, 100, title="no_id")
        t1 = _bt_task(1, 100, title="one")
        rows = _build_tasks_breakdown([t1, t_none], {}, passing_threshold=50.0)
        assert [r["title"] for r in rows] == ["no_id", "one"]

    def test_grade_none_treated_as_zero(self):
        """A submission with grade=None is treated as 0 but still counts as submitted."""
        # A submission with grade=None → int(ts.grade or 0) → 0
        task = _bt_task(1, 100)
        rows = _build_tasks_breakdown([task], {1: _bt_submission(None)}, passing_threshold=50.0)
        assert rows[0]["grade"] == 0
        assert rows[0]["submitted"] is True  # present in map even with None grade
        assert rows[0]["percentage"] == 0.0
