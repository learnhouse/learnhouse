"""
Edge-case unit tests for ``_grade_form_task`` (fill-in-the-blank form grading).

``_grade_form_task(contents, submission_data, task_max)`` is the server-side
mirror of ``TaskFormObject.tsx > gradeFC``. The real data shape (confirmed
against the frontend) is:

    contents = {
        "questions": [
            {"questionUUID": str,
             "blanks": [{"blankUUID": str, "correctAnswer": str}, ...]},
            ...
        ]
    }
    submission_data = {
        "submissions": [
            {"questionUUID": str, "blankUUID": str, "answer": str}, ...
        ]
    }

Contract (read straight from the implementation):
- Every dict-shaped blank counts toward ``total_blanks`` (the count happens
  *before* any skip logic).
- A blank scores 1 point when
  ``str(student).strip().lower() == str(correct).strip().lower()``.
- Missing student submission for a blank → student value defaults to ``""``.
- Missing ``correctAnswer`` key → correct value defaults to ``""``.
- If *either* the student answer or the correct answer is ``None`` → the blank
  is skipped (no point) but still counted in ``total_blanks``.
- ``grade = round(correct_blanks / total_blanks * task_max)``.
- Returns ``0`` when ``total_blanks == 0`` or ``task_max <= 0``.

These tests assert the REAL behavior (including a couple of surprising
edge cases) and intentionally do NOT duplicate the happy-path cases already
covered by ``test_assignment_grading.py::TestGradeFormTask``.
"""

import pytest

from src.services.courses.activities.assignments import _grade_form_task


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _q(question_uuid, blanks):
    """Build a single question dict from (question_uuid, list-of-blank-dicts)."""
    return {"questionUUID": question_uuid, "blanks": blanks}


def _blank(blank_uuid, correct):
    """Build a blank dict. Use the sentinel below to omit correctAnswer."""
    return {"blankUUID": blank_uuid, "correctAnswer": correct}


def _sub(question_uuid, blank_uuid, answer):
    return {"questionUUID": question_uuid, "blankUUID": blank_uuid, "answer": answer}


# --------------------------------------------------------------------------- #
# Multiple questions / multiple blanks
# --------------------------------------------------------------------------- #
class TestMultipleQuestionsAndBlanks:
    def test_two_questions_each_with_two_blanks_all_correct(self):
        """Blanks are pooled across all questions; all-correct → full marks."""
        contents = {
            "questions": [
                _q("q1", [_blank("b1", "a"), _blank("b2", "b")]),
                _q("q2", [_blank("b3", "c"), _blank("b4", "d")]),
            ]
        }
        sub = {
            "submissions": [
                _sub("q1", "b1", "a"),
                _sub("q1", "b2", "b"),
                _sub("q2", "b3", "c"),
                _sub("q2", "b4", "d"),
            ]
        }
        assert _grade_form_task(contents, sub, 100) == 100

    def test_score_is_pooled_across_questions_not_per_question(self):
        """3 of 4 blanks correct across two questions → round(3/4*100) == 75."""
        contents = {
            "questions": [
                _q("q1", [_blank("b1", "a"), _blank("b2", "b")]),
                _q("q2", [_blank("b3", "c"), _blank("b4", "d")]),
            ]
        }
        sub = {
            "submissions": [
                _sub("q1", "b1", "a"),
                _sub("q1", "b2", "WRONG"),
                _sub("q2", "b3", "c"),
                _sub("q2", "b4", "d"),
            ]
        }
        assert _grade_form_task(contents, sub, 100) == 75

    def test_same_blank_uuid_under_different_questions_are_distinct(self):
        """Keying is (questionUUID, blankUUID): reused blankUUID across
        questions does not collide."""
        contents = {
            "questions": [
                _q("q1", [_blank("shared", "alpha")]),
                _q("q2", [_blank("shared", "beta")]),
            ]
        }
        sub = {
            "submissions": [
                _sub("q1", "shared", "alpha"),
                _sub("q2", "shared", "beta"),
            ]
        }
        assert _grade_form_task(contents, sub, 100) == 100


# --------------------------------------------------------------------------- #
# Matching semantics (case / whitespace / unicode / numeric)
# --------------------------------------------------------------------------- #
class TestMatchingSemantics:
    def test_internal_whitespace_is_not_collapsed(self):
        """Only leading/trailing whitespace is trimmed; internal spaces matter.

        'New  York' (two spaces) != 'New York' (one space) → no match.
        """
        contents = {"questions": [_q("q1", [_blank("b1", "New York")])]}
        sub = {"submissions": [_sub("q1", "b1", "New  York")]}
        assert _grade_form_task(contents, sub, 100) == 0

    def test_tabs_and_newlines_are_trimmed(self):
        """str.strip() removes tabs/newlines at the edges, so they're ignored."""
        contents = {"questions": [_q("q1", [_blank("b1", "Paris")])]}
        sub = {"submissions": [_sub("q1", "b1", "\t\nParis \n")]}
        assert _grade_form_task(contents, sub, 100) == 100

    def test_unicode_answer_matches_case_insensitively(self):
        """Unicode letters compare with .lower() like ASCII (Ü == ü)."""
        contents = {"questions": [_q("q1", [_blank("b1", "Über")])]}
        sub = {"submissions": [_sub("q1", "b1", "  über ")]}
        assert _grade_form_task(contents, sub, 100) == 100

    def test_unicode_emoji_and_cjk_exact_match(self):
        """Emoji and CJK answers match exactly when student and correct values are identical."""
        contents = {"questions": [_q("q1", [_blank("b1", "café☕"), _blank("b2", "東京")])]}
        sub = {
            "submissions": [
                _sub("q1", "b1", "café☕"),
                _sub("q1", "b2", "東京"),
            ]
        }
        assert _grade_form_task(contents, sub, 100) == 100

    def test_numeric_correct_answer_matches_string_student_answer(self):
        """correctAnswer stored as int 42 vs student '42' → str() coerces both."""
        contents = {"questions": [_q("q1", [_blank("b1", 42)])]}
        sub = {"submissions": [_sub("q1", "b1", "42")]}
        assert _grade_form_task(contents, sub, 100) == 100

    def test_numeric_student_answer_matches_string_correct_answer(self):
        """An int 42 student answer is str()-coerced and matches a '42' string correctAnswer."""
        contents = {"questions": [_q("q1", [_blank("b1", "42")])]}
        sub = {"submissions": [_sub("q1", "b1", 42)]}
        assert _grade_form_task(contents, sub, 100) == 100

    def test_numeric_float_string_mismatch(self):
        """str(42) == '42' but str(42.0) == '42.0' → '42' student answer fails
        against a float 42.0 correctAnswer."""
        contents = {"questions": [_q("q1", [_blank("b1", 42.0)])]}
        sub = {"submissions": [_sub("q1", "b1", "42")]}
        assert _grade_form_task(contents, sub, 100) == 0

    def test_bool_correct_answer_stringifies_to_python_repr(self):
        """SURPRISING: a boolean True correctAnswer stringifies to 'true'
        after .lower() — so the literal student answer 'true' matches, but
        '1' or 'yes' would not."""
        contents = {"questions": [_q("q1", [_blank("b1", True)])]}
        match = {"submissions": [_sub("q1", "b1", "TRUE")]}
        nomatch = {"submissions": [_sub("q1", "b1", "1")]}
        assert _grade_form_task(contents, match, 100) == 100
        assert _grade_form_task(contents, nomatch, 100) == 0


# --------------------------------------------------------------------------- #
# None and empty-string handling
# --------------------------------------------------------------------------- #
class TestNoneAndEmpty:
    def test_none_correct_answer_is_skipped_but_still_counted(self):
        """SURPRISING: a blank with correctAnswer=None is impossible to earn
        (the None guard skips scoring) yet it still inflates total_blanks.

        Here 1 of 2 blanks is scorable+correct, the other is None → the student
        is capped at round(1/2*100) == 50, never 100.
        """
        contents = {
            "questions": [_q("q1", [_blank("b1", "x"), _blank("b2", None)])]
        }
        sub = {
            "submissions": [
                _sub("q1", "b1", "x"),
                _sub("q1", "b2", "anything"),
            ]
        }
        assert _grade_form_task(contents, sub, 100) == 50

    def test_none_student_answer_is_skipped_but_still_counted(self):
        """An explicit None answer is skipped (never scores) but still counts."""
        contents = {
            "questions": [_q("q1", [_blank("b1", "x"), _blank("b2", "y")])]
        }
        sub = {
            "submissions": [
                _sub("q1", "b1", "x"),
                _sub("q1", "b2", None),
            ]
        }
        assert _grade_form_task(contents, sub, 100) == 50

    def test_empty_string_correct_answer_matches_missing_submission(self):
        """SURPRISING: correctAnswer='' with no student submission both default
        to '' → they MATCH, so an empty blank is auto-awarded a point."""
        contents = {"questions": [_q("q1", [_blank("b1", "")])]}
        sub = {"submissions": []}
        assert _grade_form_task(contents, sub, 100) == 100

    def test_empty_string_correct_answer_matches_empty_student_answer(self):
        """A blank whose correctAnswer is '' is satisfied by a whitespace-only answer (both trim to '')."""
        contents = {"questions": [_q("q1", [_blank("b1", "")])]}
        sub = {"submissions": [_sub("q1", "b1", "   ")]}  # whitespace trims to ''
        assert _grade_form_task(contents, sub, 100) == 100

    def test_missing_correct_answer_key_defaults_to_empty_string(self):
        """A blank dict without a correctAnswer key behaves like ''."""
        contents = {"questions": [_q("q1", [{"blankUUID": "b1"}])]}
        sub = {"submissions": [_sub("q1", "b1", "")]}
        assert _grade_form_task(contents, sub, 100) == 100

    def test_missing_student_submission_defaults_to_empty_string(self):
        """No submission for a non-empty correctAnswer → '' != correct → 0."""
        contents = {"questions": [_q("q1", [_blank("b1", "Paris")])]}
        sub = {"submissions": []}
        assert _grade_form_task(contents, sub, 100) == 0


# --------------------------------------------------------------------------- #
# Partial credit + rounding
# --------------------------------------------------------------------------- #
class TestPartialCreditAndRounding:
    def test_one_of_three_rounds_to_nearest(self):
        """1/3 * 100 = 33.33… → round() → 33."""
        contents = {
            "questions": [
                _q("q1", [_blank("b1", "a"), _blank("b2", "b"), _blank("b3", "c")])
            ]
        }
        sub = {
            "submissions": [
                _sub("q1", "b1", "a"),
                _sub("q1", "b2", "wrong"),
                _sub("q1", "b3", "wrong"),
            ]
        }
        assert _grade_form_task(contents, sub, 100) == 33

    def test_two_of_three_rounds_to_67(self):
        """2/3 * 100 = 66.66… → round() → 67."""
        contents = {
            "questions": [
                _q("q1", [_blank("b1", "a"), _blank("b2", "b"), _blank("b3", "c")])
            ]
        }
        sub = {
            "submissions": [
                _sub("q1", "b1", "a"),
                _sub("q1", "b2", "b"),
                _sub("q1", "b3", "wrong"),
            ]
        }
        assert _grade_form_task(contents, sub, 100) == 67

    def test_bankers_rounding_half_rounds_to_even(self):
        """SURPRISING: Python's round() uses banker's rounding. 1/2*5 = 2.5
        rounds to 2 (nearest even), NOT 3 — differs from JS Math.round on the
        client, which would give 3."""
        contents = {
            "questions": [_q("q1", [_blank("b1", "a"), _blank("b2", "b")])]
        }
        sub = {
            "submissions": [
                _sub("q1", "b1", "a"),
                _sub("q1", "b2", "wrong"),
            ]
        }
        assert _grade_form_task(contents, sub, 5) == 2

    def test_bankers_rounding_three_point_five_rounds_to_four(self):
        """3.5 rounds to 4 (nearest even) — confirms banker's rounding direction."""
        # 7 blanks, 1 correct, max 24.5 isn't an int max; use 1/2 of 7 ~ build
        # a clean .5: 1/8 * 28 = 3.5
        blanks = [_blank(f"b{i}", str(i)) for i in range(8)]
        contents = {"questions": [_q("q1", blanks)]}
        sub = {"submissions": [_sub("q1", "b0", "0")]}  # only first correct
        assert _grade_form_task(contents, sub, 28) == 4  # round(3.5) -> 4

    def test_partial_with_custom_task_max(self):
        """Half correct, task_max=10 → 5."""
        contents = {
            "questions": [_q("q1", [_blank("b1", "a"), _blank("b2", "b")])]
        }
        sub = {"submissions": [_sub("q1", "b1", "a")]}
        assert _grade_form_task(contents, sub, 10) == 5


# --------------------------------------------------------------------------- #
# Unknown / extra / malformed submission entries
# --------------------------------------------------------------------------- #
class TestUnknownAndMalformedSubmissions:
    def test_submission_with_unknown_question_uuid_is_ignored(self):
        """A submission for a questionUUID not in contents is ignored and doesn't affect the grade."""
        contents = {"questions": [_q("q1", [_blank("b1", "Paris")])]}
        sub = {
            "submissions": [
                _sub("q1", "b1", "Paris"),
                _sub("UNKNOWN_Q", "b1", "garbage"),
            ]
        }
        assert _grade_form_task(contents, sub, 100) == 100

    def test_submission_with_unknown_blank_uuid_is_ignored(self):
        """A submission for a blankUUID not in contents is ignored and doesn't affect the grade."""
        contents = {"questions": [_q("q1", [_blank("b1", "Paris")])]}
        sub = {
            "submissions": [
                _sub("q1", "b1", "Paris"),
                _sub("q1", "UNKNOWN_B", "garbage"),
            ]
        }
        assert _grade_form_task(contents, sub, 100) == 100

    def test_non_dict_submission_entries_are_skipped(self):
        """Non-dict entries in the submissions list are skipped without error; valid ones still score."""
        contents = {"questions": [_q("q1", [_blank("b1", "Paris")])]}
        sub = {"submissions": ["a string", 42, None, ["list"], _sub("q1", "b1", "Paris")]}
        assert _grade_form_task(contents, sub, 100) == 100

    def test_submission_missing_question_uuid_is_not_indexed(self):
        """A submission lacking questionUUID is never indexed (needs both
        truthy q_uuid and b_uuid) → the blank defaults to '' → wrong."""
        contents = {"questions": [_q("q1", [_blank("b1", "Paris")])]}
        sub = {"submissions": [{"blankUUID": "b1", "answer": "Paris"}]}
        assert _grade_form_task(contents, sub, 100) == 0

    def test_submission_missing_blank_uuid_is_not_indexed(self):
        """A submission entry lacking blankUUID can't be matched to a blank, so the answer is ignored → 0."""
        contents = {"questions": [_q("q1", [_blank("b1", "Paris")])]}
        sub = {"submissions": [{"questionUUID": "q1", "answer": "Paris"}]}
        assert _grade_form_task(contents, sub, 100) == 0

    def test_submission_missing_answer_key_defaults_to_none_and_is_skipped(self):
        """A submission without an 'answer' key indexes answer=None → the None
        guard skips it → 0, but the blank is still counted."""
        contents = {"questions": [_q("q1", [_blank("b1", "Paris")])]}
        sub = {"submissions": [{"questionUUID": "q1", "blankUUID": "b1"}]}
        assert _grade_form_task(contents, sub, 100) == 0

    def test_duplicate_submissions_last_one_wins(self):
        """SURPRISING: duplicate (q,b) submissions overwrite; the LAST entry in
        the list determines the answer used."""
        contents = {"questions": [_q("q1", [_blank("b1", "Paris")])]}
        wrong_then_right = {
            "submissions": [_sub("q1", "b1", "WRONG"), _sub("q1", "b1", "Paris")]
        }
        right_then_wrong = {
            "submissions": [_sub("q1", "b1", "Paris"), _sub("q1", "b1", "WRONG")]
        }
        assert _grade_form_task(contents, wrong_then_right, 100) == 100
        assert _grade_form_task(contents, right_then_wrong, 100) == 0


# --------------------------------------------------------------------------- #
# Malformed questions / blanks
# --------------------------------------------------------------------------- #
class TestMalformedQuestionsAndBlanks:
    def test_non_dict_question_entries_are_skipped(self):
        """Non-dict entries in the questions list are skipped without error; valid ones still score."""
        contents = {
            "questions": ["junk", 7, None, _q("q1", [_blank("b1", "Paris")])]
        }
        sub = {"submissions": [_sub("q1", "b1", "Paris")]}
        assert _grade_form_task(contents, sub, 100) == 100

    def test_non_dict_blank_entries_are_skipped_not_counted(self):
        """Non-dict blanks are skipped via `continue` BEFORE total_blanks++,
        so they don't dilute the score."""
        contents = {
            "questions": [
                _q("q1", ["junk", None, 5, _blank("b1", "Paris")])
            ]
        }
        sub = {"submissions": [_sub("q1", "b1", "Paris")]}
        assert _grade_form_task(contents, sub, 100) == 100

    def test_blank_missing_blank_uuid_keys_on_none(self):
        """A blank with no blankUUID keys lookup on (q_uuid, None). Since no
        submission can be indexed with a None blankUUID, the student defaults
        to '' — so it only scores when correctAnswer is also ''."""
        contents = {"questions": [_q("q1", [{"correctAnswer": "Paris"}])]}
        sub = {"submissions": [_sub("q1", "b1", "Paris")]}
        # correctAnswer 'Paris' vs default '' → wrong, but counted → 0
        assert _grade_form_task(contents, sub, 100) == 0

    def test_blank_missing_blank_uuid_with_empty_correct_answer_scores(self):
        """The flip side: a blankUUID-less blank with correctAnswer='' matches
        the '' default and scores a point."""
        contents = {"questions": [_q("q1", [{"correctAnswer": ""}])]}
        sub = {"submissions": []}
        assert _grade_form_task(contents, sub, 100) == 100

    def test_question_with_empty_blanks_list_contributes_nothing(self):
        """A question with no blanks contributes 0 to total_blanks; if it's the
        only question, total_blanks==0 → grade 0."""
        contents = {"questions": [_q("q1", [])]}
        sub = {"submissions": []}
        assert _grade_form_task(contents, sub, 100) == 0

    def test_question_missing_blanks_key_defaults_to_empty(self):
        """A question without a blanks key contributes no blanks → total_blanks==0 → grade 0."""
        contents = {"questions": [{"questionUUID": "q1"}]}
        sub = {"submissions": []}
        assert _grade_form_task(contents, sub, 100) == 0


# --------------------------------------------------------------------------- #
# Whitespace-only / long answers
# --------------------------------------------------------------------------- #
class TestWhitespaceAndLongAnswers:
    def test_whitespace_only_answers_both_trim_to_empty_and_match(self):
        """Whitespace-only correct AND student both strip to '' → match."""
        contents = {"questions": [_q("q1", [_blank("b1", "   ")])]}
        sub = {"submissions": [_sub("q1", "b1", "\t  \n")]}
        assert _grade_form_task(contents, sub, 100) == 100

    def test_whitespace_only_correct_vs_real_answer_fails(self):
        """A whitespace-only correctAnswer (trims to '') doesn't match a real non-empty answer → 0."""
        contents = {"questions": [_q("q1", [_blank("b1", "   ")])]}
        sub = {"submissions": [_sub("q1", "b1", "Paris")]}
        assert _grade_form_task(contents, sub, 100) == 0

    def test_very_long_answer_exact_match(self):
        """A very long (~25k char) answer matches when trimmed edges aside it equals the correct value."""
        long = "word " * 5000  # ~25k chars
        contents = {"questions": [_q("q1", [_blank("b1", long.strip())])]}
        sub = {"submissions": [_sub("q1", "b1", "  " + long + "  ")]}
        assert _grade_form_task(contents, sub, 100) == 100

    def test_very_long_answer_single_char_diff_fails(self):
        """A single differing character in a 20k-char answer breaks the exact match → 0."""
        long_a = "a" * 20000
        long_b = "a" * 19999 + "b"
        contents = {"questions": [_q("q1", [_blank("b1", long_a)])]}
        sub = {"submissions": [_sub("q1", "b1", long_b)]}
        assert _grade_form_task(contents, sub, 100) == 0


# --------------------------------------------------------------------------- #
# Missing top-level keys / degenerate task_max
# --------------------------------------------------------------------------- #
class TestMissingTopLevelKeysAndTaskMax:
    def test_contents_missing_questions_key_returns_zero(self):
        """Contents without a questions key yields no blanks → grade 0."""
        assert _grade_form_task({}, {"submissions": []}, 100) == 0

    def test_contents_questions_is_none_returns_zero(self):
        """A None questions value yields no blanks → grade 0."""
        assert _grade_form_task({"questions": None}, {"submissions": []}, 100) == 0

    def test_submission_missing_submissions_key_treated_as_no_answers(self):
        """No 'submissions' key → all blanks default to '' → only empty-answer
        blanks score. Here the single non-empty blank → 0."""
        contents = {"questions": [_q("q1", [_blank("b1", "Paris")])]}
        assert _grade_form_task(contents, {}, 100) == 0

    def test_submission_submissions_is_none_treated_as_no_answers(self):
        """A None submissions value means all blanks default to '' → non-empty blank scores 0."""
        contents = {"questions": [_q("q1", [_blank("b1", "Paris")])]}
        assert _grade_form_task(contents, {"submissions": None}, 100) == 0

    def test_zero_task_max_returns_zero_even_when_all_correct(self):
        """task_max==0 short-circuits to grade 0 even when every blank is correct."""
        contents = {"questions": [_q("q1", [_blank("b1", "Paris")])]}
        sub = {"submissions": [_sub("q1", "b1", "Paris")]}
        assert _grade_form_task(contents, sub, 0) == 0

    def test_negative_task_max_returns_zero(self):
        """A negative task_max short-circuits to grade 0 even when every blank is correct."""
        contents = {"questions": [_q("q1", [_blank("b1", "Paris")])]}
        sub = {"submissions": [_sub("q1", "b1", "Paris")]}
        assert _grade_form_task(contents, sub, -50) == 0

    @pytest.mark.parametrize("task_max", [1, 7, 1000])
    def test_full_marks_scales_with_task_max(self, task_max):
        """An all-correct submission earns the full task_max for each parametrized max value."""
        contents = {"questions": [_q("q1", [_blank("b1", "Paris")])]}
        sub = {"submissions": [_sub("q1", "b1", "Paris")]}
        assert _grade_form_task(contents, sub, task_max) == task_max
