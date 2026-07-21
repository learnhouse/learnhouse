"""
Edge-case unit tests for ``_grade_quiz_task(contents, submission_data, task_max)``.

``_grade_quiz_task`` grades a quiz PER QUESTION (mirrored by the client
``gradeFC`` in ``TaskQuizObject.tsx``). Contract (from the implementation):

* A question is correct only when the student's selected option set EXACTLY
  matches the key: for every option, ``bool(student answer) ==
  bool(option.assigned_right_answer)`` (all correct options selected, no
  incorrect option selected). A missing submission entry counts as "not
  selected".
* ``grade = round(correct_questions / total_questions * task_max)``.
* Questions with no options are skipped (can't be answered).
* ``0`` is returned when ``total_questions == 0`` OR ``task_max <= 0``.

Per-question is the corrected model: the previous per-option scoring gave
phantom credit for non-answers (a blank 4-option question still "matched" its 3
unselected wrong options -> 75%), so a learner could leave most of an exam blank
and still clear a high pass bar. These tests pin the corrected behavior,
including the concrete miscounts reported from production data.

JSON shapes mirror the real client structures in ``TaskQuizObject.tsx``.
"""

from src.services.courses.activities.assignments import _grade_quiz_task


# --------------------------------------------------------------------------- #
# Builders
# --------------------------------------------------------------------------- #
def _question(q_uuid, options):
    """options: list of (optionUUID, assigned_right_answer)."""
    return {
        "questionUUID": q_uuid,
        "options": [
            {"optionUUID": o_uuid, "assigned_right_answer": right}
            for o_uuid, right in options
        ],
    }


def _contents(*questions):
    return {"questions": list(questions)}


def _sub(q_uuid, o_uuid, answer):
    return {"questionUUID": q_uuid, "optionUUID": o_uuid, "answer": answer}


def _submission(*entries):
    return {"submissions": list(entries)}


def _exam(num_q=12, opts_per_q=4, correct_idx=0):
    """An exam of `num_q` single-correct questions, each with `opts_per_q` options."""
    return _contents(*[
        _question(f"q{i}", [(f"q{i}o{j}", j == correct_idx) for j in range(opts_per_q)])
        for i in range(num_q)
    ])


def _pick(i, j):
    """A submission entry selecting option j of question i."""
    return _sub(f"q{i}", f"q{i}o{j}", True)


# --------------------------------------------------------------------------- #
# Production-reported miscounts (Brian) — per-question is the fix
# --------------------------------------------------------------------------- #
class TestReportedMiscounts:
    def test_one_option_off_on_12q_exam_is_11_of_12_not_98pct(self):
        """One question wrong on a 12-question, 4-option exam -> 11/12 = 92%.

        Old per-option scoring gave 47/48 = 98%.
        """
        contents = _exam(12, 4, 0)
        subs = [_pick(i, 0) for i in range(11)]  # 11 answered correctly
        subs += [_pick(11, 0), _pick(11, 1)]     # q11: correct + an extra wrong -> wrong
        assert _grade_quiz_task(contents, _submission(*subs), 100) == 92

    def test_eight_of_twelve_correct_fails_the_80_bar(self):
        """8/12 correct -> 67%, which must NOT clear an 80% pass bar.

        Old per-option scoring inflated this to ~83%.
        """
        contents = _exam(12, 4, 0)
        subs = [_pick(i, 0) for i in range(8)]        # 8 correct
        subs += [_pick(i, 1) for i in range(8, 12)]   # 4 wrong (picked a wrong option)
        assert _grade_quiz_task(contents, _submission(*subs), 100) == 67

    def test_nine_blank_of_twelve_scores_25_not_81pct(self):
        """3 answered, 9 left blank -> 3/12 = 25%. Old scoring gave ~81%."""
        contents = _exam(12, 4, 0)
        subs = [_pick(i, 0) for i in range(3)]  # only 3 answered; 9 blank
        assert _grade_quiz_task(contents, _submission(*subs), 100) == 25

    def test_fully_blank_exam_scores_zero(self):
        """No answers at all -> 0% (previously every blank question scored 3/4)."""
        contents = _exam(12, 4, 0)
        assert _grade_quiz_task(contents, _submission(), 100) == 0


# --------------------------------------------------------------------------- #
# Per-question correctness (exact option-set match)
# --------------------------------------------------------------------------- #
class TestPerQuestionMatch:
    def test_all_questions_exactly_right_is_full_marks(self):
        contents = _contents(
            _question("q1", [("a", True), ("b", False), ("c", True)]),
            _question("q2", [("d", False), ("e", True), ("f", False)]),
        )
        sub = _submission(
            _sub("q1", "a", True), _sub("q1", "b", False), _sub("q1", "c", True),
            _sub("q2", "d", False), _sub("q2", "e", True), _sub("q2", "f", False),
        )
        assert _grade_quiz_task(contents, sub, 100) == 100

    def test_one_of_two_questions_right_is_half(self):
        """q1 exactly right; q2 has all correct options left unchecked -> q2 wrong."""
        contents = _contents(
            _question("q1", [("a", True), ("b", False), ("c", True)]),
            _question("q2", [("d", True), ("e", True), ("f", True)]),
        )
        sub = _submission(
            _sub("q1", "a", True), _sub("q1", "b", False), _sub("q1", "c", True),
            _sub("q2", "d", False), _sub("q2", "e", False), _sub("q2", "f", False),
        )
        assert _grade_quiz_task(contents, sub, 100) == 50

    def test_missing_one_correct_option_makes_question_wrong(self):
        """Multi-correct question: selecting only one of two correct options -> wrong."""
        contents = _contents(_question("q1", [("a", True), ("b", True), ("c", False)]))
        sub = _submission(_sub("q1", "a", True))  # b (correct) left unchecked
        assert _grade_quiz_task(contents, sub, 100) == 0

    def test_selecting_an_extra_wrong_option_makes_question_wrong(self):
        contents = _contents(_question("q1", [("a", True), ("b", False)]))
        sub = _submission(_sub("q1", "a", True), _sub("q1", "b", True))  # b wrong
        assert _grade_quiz_task(contents, sub, 100) == 0

    def test_blank_single_question_is_wrong(self):
        contents = _contents(_question("q1", [("a", True), ("b", False), ("c", False)]))
        assert _grade_quiz_task(contents, _submission(), 100) == 0


# --------------------------------------------------------------------------- #
# Rounding — driven by number of correct QUESTIONS
# --------------------------------------------------------------------------- #
class TestRounding:
    def test_one_of_three_questions_rounds_to_33(self):
        assert _grade_quiz_task(_exam(3, 1, 0), _submission(_pick(0, 0)), 100) == 33

    def test_two_of_three_questions_rounds_to_67(self):
        subs = [_pick(0, 0), _pick(1, 0)]
        assert _grade_quiz_task(_exam(3, 1, 0), _submission(*subs), 100) == 67

    def test_half_uses_bankers_rounding_to_even(self):
        # 3 of 6 questions, task_max 3 -> 1.5 -> round-half-to-even -> 2
        subs = [_pick(i, 0) for i in range(3)]
        assert _grade_quiz_task(_exam(6, 1, 0), _submission(*subs), 3) == 2
        # 1 of 6 questions, task_max 3 -> 0.5 -> round-half-to-even -> 0
        assert _grade_quiz_task(_exam(6, 1, 0), _submission(_pick(0, 0)), 3) == 0


# --------------------------------------------------------------------------- #
# Odd / unusual task_max values
# --------------------------------------------------------------------------- #
class TestOddTaskMax:
    def _one_of_two(self):
        return _exam(2, 1, 0), _submission(_pick(0, 0))  # 1 of 2 questions -> 50%

    def test_task_max_50_at_fifty_percent(self):
        contents, sub = self._one_of_two()
        assert _grade_quiz_task(contents, sub, 50) == 25

    def test_task_max_7_at_fifty_percent_rounds(self):
        contents, sub = self._one_of_two()
        assert _grade_quiz_task(contents, sub, 7) == 4  # 3.5 -> even -> 4

    def test_task_max_one_at_one_third(self):
        assert _grade_quiz_task(_exam(3, 1, 0), _submission(_pick(0, 0)), 1) == 0

    def test_negative_task_max_returns_zero(self):
        contents, sub = self._one_of_two()
        assert _grade_quiz_task(contents, sub, -5) == 0


# --------------------------------------------------------------------------- #
# All-wrong / extra-selection extremes
# --------------------------------------------------------------------------- #
class TestCorrectnessExtremes:
    def test_all_wrong_every_checkbox_inverted(self):
        contents = _contents(
            _question("q1", [("a", True), ("b", False)]),
            _question("q2", [("c", True), ("d", False)]),
        )
        sub = _submission(
            _sub("q1", "a", False), _sub("q1", "b", True),
            _sub("q2", "c", False), _sub("q2", "d", True),
        )
        assert _grade_quiz_task(contents, sub, 100) == 0

    def test_checking_options_keyed_false_is_wrong_not_bonus(self):
        contents = _contents(_question("q1", [("a", False), ("b", False)]))
        sub = _submission(_sub("q1", "a", True), _sub("q1", "b", True))
        assert _grade_quiz_task(contents, sub, 100) == 0

    def test_question_with_no_correct_option_is_skipped(self):
        """A question whose key marks every option False can't be auto-scored, so
        it is skipped: only the well-formed q2 counts (answered right -> 100),
        NOT counted as a free 'blank is correct' point."""
        contents = _contents(
            _question("q1", [("a", False), ("b", False)]),  # malformed -> skipped
            _question("q2", [("c", True)]),                 # answered right
        )
        sub = _submission(_sub("q2", "c", True))
        assert _grade_quiz_task(contents, sub, 100) == 100

    def test_only_no_correct_question_scores_zero_not_free_credit(self):
        """M13: a quiz whose ONLY question has no correct option must NOT award a
        blank submission full marks. The malformed question is skipped, leaving
        no gradable questions -> grade 0 (fails closed, no free credit)."""
        contents = _contents(_question("q1", [("a", False), ("b", False)]))
        assert _grade_quiz_task(contents, _submission(), 100) == 0


# --------------------------------------------------------------------------- #
# Junk / duplicate / partial submission entries (q2 is always correct so the
# score reflects only whether the junked q1 was scored correctly)
# --------------------------------------------------------------------------- #
class TestSubmissionJunk:
    def _q1_junk_plus_correct_q2(self, *q1_entries):
        contents = _contents(
            _question("q1", [("a", True), ("b", False)]),
            _question("q2", [("c", True)]),
        )
        sub = _submission(*q1_entries, _sub("q2", "c", True))
        return contents, sub

    def test_unknown_uuids_are_ignored(self):
        """q1 answered correctly; bogus entries reference nothing -> both right -> 100."""
        contents, sub = self._q1_junk_plus_correct_q2(
            _sub("q1", "a", True),
            _sub("ghost_q", "ghost_o", True),
            _sub("q1", "ghost_o", True),
        )
        assert _grade_quiz_task(contents, sub, 100) == 100

    def test_duplicate_entries_last_wins(self):
        """q1/a keyed True; last entry sets it False -> q1 wrong, q2 right -> 50."""
        contents, sub = self._q1_junk_plus_correct_q2(
            _sub("q1", "a", True),
            _sub("q1", "a", False),
        )
        assert _grade_quiz_task(contents, sub, 100) == 50

    def test_entry_missing_question_uuid_is_skipped(self):
        """'a' never marked -> q1 wrong, q2 right -> 50."""
        contents, sub = self._q1_junk_plus_correct_q2(
            {"optionUUID": "a", "answer": True},
        )
        assert _grade_quiz_task(contents, sub, 100) == 50

    def test_entry_missing_option_uuid_is_skipped(self):
        contents, sub = self._q1_junk_plus_correct_q2(
            {"questionUUID": "q1", "answer": True},
        )
        assert _grade_quiz_task(contents, sub, 100) == 50

    def test_empty_string_uuids_are_skipped(self):
        contents, sub = self._q1_junk_plus_correct_q2(
            {"questionUUID": "", "optionUUID": "", "answer": True},
            {"questionUUID": "q1", "optionUUID": "", "answer": True},
        )
        assert _grade_quiz_task(contents, sub, 100) == 50

    def test_non_dict_submission_entries_are_skipped(self):
        """Only the real dict for q1/a is honored -> both questions right -> 100."""
        contents = _contents(
            _question("q1", [("a", True), ("b", False)]),
            _question("q2", [("c", True)]),
        )
        sub = {"submissions": ["nope", 42, None, ["q1", "a", True],
                               _sub("q1", "a", True), _sub("q2", "c", True)]}
        assert _grade_quiz_task(contents, sub, 100) == 100


# --------------------------------------------------------------------------- #
# Degenerate questions & options
# --------------------------------------------------------------------------- #
class TestQuestionJunk:
    def test_non_dict_questions_are_skipped(self):
        contents = {"questions": ["garbage", None, 123,
                                  _question("q1", [("a", True), ("b", False)])]}
        assert _grade_quiz_task(contents, _submission(_sub("q1", "a", True)), 100) == 100

    def test_non_dict_options_are_skipped(self):
        contents = {"questions": [{
            "questionUUID": "q1",
            "options": ["junk", {"optionUUID": "a", "assigned_right_answer": True},
                        None, {"optionUUID": "b", "assigned_right_answer": False}],
        }]}
        assert _grade_quiz_task(contents, _submission(_sub("q1", "a", True)), 100) == 100

    def test_question_with_empty_options_is_not_counted(self):
        """A question with options=[] is skipped; total comes only from real ones."""
        contents = _contents(
            _question("q1", []),
            _question("q2", [("a", True), ("b", False)]),
        )
        assert _grade_quiz_task(contents, _submission(_sub("q2", "a", True)), 100) == 100

    def test_all_questions_empty_returns_zero(self):
        contents = _contents(_question("q1", []), _question("q2", []))
        assert _grade_quiz_task(contents, _submission(), 100) == 0


# --------------------------------------------------------------------------- #
# Answer-key stripping (students must not receive the key in the task payload)
# --------------------------------------------------------------------------- #
from src.services.courses.activities.assignments import _strip_answer_key  # noqa: E402


class TestStripAnswerKey:
    def test_quiz_option_flags_removed(self):
        c = {"questions": [{"questionUUID": "q1", "options": [
            {"optionUUID": "a", "text": "A", "assigned_right_answer": True},
            {"optionUUID": "b", "text": "B", "assigned_right_answer": False},
        ]}]}
        s = _strip_answer_key(c)
        for o in s["questions"][0]["options"]:
            assert "assigned_right_answer" not in o
            assert "text" in o
        assert c["questions"][0]["options"][0]["assigned_right_answer"] is True

    def test_form_blank_answers_removed(self):
        c = {"questions": [{"questionUUID": "q1", "blanks": [
            {"blankUUID": "b1", "correctAnswer": "42"},
        ]}]}
        s = _strip_answer_key(c)
        assert "correctAnswer" not in s["questions"][0]["blanks"][0]

    def test_short_and_number_keys_removed(self):
        assert "correct_answers" not in _strip_answer_key({"correct_answers": ["x"], "match_mode": "exact"})
        assert _strip_answer_key({"correct_answers": ["x"], "match_mode": "exact"}).get("match_mode") == "exact"
        assert "correct_value" not in _strip_answer_key({"correct_value": 9.8, "tolerance": 0.1})

    def test_code_solution_and_hidden_tests_removed_visible_kept(self):
        c = {"solution_code": "print(42)", "starter_code": "# go", "test_cases": [
            {"id": "t1", "hidden": False, "stdin": "1", "expectedStdout": "2"},
            {"id": "t2", "hidden": True, "stdin": "3", "expectedStdout": "9"},
        ]}
        s = _strip_answer_key(c)
        assert "solution_code" not in s
        assert s["starter_code"] == "# go"
        assert s["test_cases"][0]["expectedStdout"] == "2"
        assert "expectedStdout" not in s["test_cases"][1]
        assert "stdin" not in s["test_cases"][1]

    def test_non_dict_is_returned_as_is(self):
        assert _strip_answer_key(None) is None
        assert _strip_answer_key("x") == "x"

    # ----- reveal mode (keep_answer_keys=True): graded student may see which
    # answers were right, but NEVER the CODE solution or hidden test I/O -----

    def test_reveal_keeps_quiz_and_answer_keys(self):
        c = {
            "correct_answers": ["x"],
            "correct_value": 9.8,
            "questions": [{"questionUUID": "q1", "options": [
                {"optionUUID": "a", "assigned_right_answer": True},
            ], "blanks": [{"blankUUID": "b1", "correctAnswer": "42"}]}],
        }
        s = _strip_answer_key(c, keep_answer_keys=True)
        assert s["correct_answers"] == ["x"]
        assert s["correct_value"] == 9.8
        assert s["questions"][0]["options"][0]["assigned_right_answer"] is True
        assert s["questions"][0]["blanks"][0]["correctAnswer"] == "42"

    def test_reveal_still_removes_solution_and_hidden_tests(self):
        c = {"solution_code": "print(42)", "starter_code": "# go", "test_cases": [
            {"id": "t1", "hidden": False, "stdin": "1", "expectedStdout": "2"},
            {"id": "t2", "hidden": True, "stdin": "3", "expectedStdout": "9"},
        ]}
        s = _strip_answer_key(c, keep_answer_keys=True)
        # Reference solution + hidden test I/O are removed even in reveal mode.
        assert "solution_code" not in s
        assert "expectedStdout" not in s["test_cases"][1]
        assert "stdin" not in s["test_cases"][1]
        # Visible test + starter code still available.
        assert s["starter_code"] == "# go"
        assert s["test_cases"][0]["expectedStdout"] == "2"
