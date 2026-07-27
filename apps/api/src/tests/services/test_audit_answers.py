"""Tests for the audit answer humanizer.

Pure functions — no db, no client. The cases that matter most are the tri-state
verdict rules: a missing answer key must produce "no verdict", never "wrong", and the
questions the graders refuse to auto-score must be excluded from the score rather than
counted as failures.
"""
from src.services.audit.answers import (
    MAX_ITEMS,
    MAX_TEXT,
    answer_digest,
    humanize_task_answer,
    judge0_language_name,
    task_type_label,
)
from src.services.courses.activities.assignments import (
    _check_number_answer,
    _check_short_answer,
)


def _quiz_contents(right="option_b", key=True):
    option_a = {"optionUUID": "option_a", "text": "Three"}
    option_b = {"optionUUID": "option_b", "text": "Four"}
    if key:
        option_a["assigned_right_answer"] = right == "option_a"
        option_b["assigned_right_answer"] = right == "option_b"
    return {"questions": [{
        "questionUUID": "q1",
        "questionText": "What is 2 + 2?",
        "options": [option_a, option_b],
    }]}


def _quiz_submission(selected):
    return {"questions": [], "submissions": [
        {"questionUUID": "q1", "optionUUID": "option_a", "answer": selected == "option_a"},
        {"questionUUID": "q1", "optionUUID": "option_b", "answer": selected == "option_b"},
    ]}


class TestQuiz:
    def test_all_correct(self):
        out = humanize_task_answer("QUIZ", _quiz_contents(), _quiz_submission("option_b"))
        assert out["kind"] == "quiz"
        assert out["correct_count"] == 1 and out["total_count"] == 1
        assert out["summary"] == "1/1 questions correct"
        item = out["items"][0]
        assert item["prompt"] == "What is 2 + 2?"
        assert item["answer_text"] == "B. Four"
        assert item["expected_text"] == "B. Four"
        assert item["correct"] is True
        assert [o["letter"] for o in item["options"]] == ["A", "B"]
        assert item["options"][1]["selected"] is True

    def test_wrong_answer_names_the_expected_option(self):
        out = humanize_task_answer("QUIZ", _quiz_contents(), _quiz_submission("option_a"))
        item = out["items"][0]
        assert item["correct"] is False
        assert item["answer_text"] == "A. Three"
        assert item["expected_text"] == "B. Four"
        assert out["correct_count"] == 0 and out["total_count"] == 1

    def test_missing_answer_key_yields_no_verdict(self):
        """A stripped key must not turn a perfect submission into all-wrong."""
        out = humanize_task_answer(
            "QUIZ", _quiz_contents(key=False), _quiz_submission("option_b")
        )
        item = out["items"][0]
        assert item["correct"] is None
        assert item["expected_text"] is None
        assert all(o["is_correct"] is None for o in item["options"])
        assert out["correct_count"] is None and out["total_count"] is None

    def test_question_with_no_correct_option_is_not_scored(self):
        """Mirrors the grader, which skips these rather than crediting a blank."""
        contents = {"questions": [{
            "questionUUID": "q1", "questionText": "Broken?",
            "options": [
                {"optionUUID": "o1", "text": "A", "assigned_right_answer": False},
                {"optionUUID": "o2", "text": "B", "assigned_right_answer": False},
            ],
        }]}
        out = humanize_task_answer("QUIZ", contents, {"submissions": []})
        assert out["items"][0]["correct"] is None
        assert out["total_count"] is None

    def test_falls_back_to_the_submission_snapshot(self):
        """Deleted task rows still render, from the snapshot stored on submit."""
        submission = _quiz_submission("option_b")
        submission["questions"] = _quiz_contents()["questions"]
        out = humanize_task_answer("QUIZ", {}, submission)
        assert out["items"][0]["prompt"] == "What is 2 + 2?"
        assert out["items"][0]["answer_text"] == "B. Four"

    def test_unanswered_question_reads_as_empty_not_missing(self):
        out = humanize_task_answer("QUIZ", _quiz_contents(), {"submissions": []})
        assert out["items"][0]["answer_text"] == ""
        assert out["items"][0]["correct"] is False


class TestForm:
    def _contents(self, correct="paris"):
        return {"questions": [{
            "questionUUID": "q1",
            "questionText": "Capital of France",
            "blanks": [
                {"blankUUID": "b1", "placeholder": "city", "correctAnswer": correct},
                {"blankUUID": "b2", "placeholder": "unconfigured", "correctAnswer": ""},
            ],
        }]}

    def test_case_insensitive_match(self):
        out = humanize_task_answer("FORM", self._contents(), {"submissions": [
            {"questionUUID": "q1", "blankUUID": "b1", "answer": "  Paris "},
        ]})
        assert out["kind"] == "form"
        first = out["items"][0]
        assert first["prompt"] == "Capital of France — city"
        assert first["correct"] is True
        assert out["correct_count"] == 1 and out["total_count"] == 1

    def test_wrong_blank(self):
        out = humanize_task_answer("FORM", self._contents(), {"submissions": [
            {"questionUUID": "q1", "blankUUID": "b1", "answer": "Lyon"},
        ]})
        assert out["items"][0]["correct"] is False
        assert out["items"][0]["expected_text"] == "paris"

    def test_blank_without_a_configured_answer_is_not_scored(self):
        out = humanize_task_answer("FORM", self._contents(), {"submissions": []})
        assert out["items"][1]["correct"] is None
        assert out["items"][1]["expected_text"] is None
        assert out["total_count"] == 1

    def test_blank_count_is_capped_across_questions(self):
        """The cap is on rendered rows, not per question — two full questions hit it."""
        contents = {"questions": [
            {
                "questionUUID": f"q{q}", "questionText": f"Question {q}",
                "blanks": [
                    {"blankUUID": f"b{q}_{i}", "placeholder": f"p{i}", "correctAnswer": "x"}
                    for i in range(MAX_ITEMS)
                ],
            }
            for q in range(2)
        ]}
        out = humanize_task_answer("FORM", contents, {"submissions": []})
        assert len(out["items"]) == MAX_ITEMS


class TestShortAnswer:
    def test_agrees_with_the_grader(self):
        contents = {"prompt": "Name the capital", "correct_answers": ["Paris"],
                    "match_mode": "case_insensitive", "explanation": "It is Paris."}
        for given in ("paris", "PARIS", "Lyon", ""):
            out = humanize_task_answer("SHORT_ANSWER", contents, {"answer": given})
            assert out["items"][0]["correct"] == _check_short_answer(
                given, contents["correct_answers"], contents["match_mode"]
            )
        assert out["explanation"] == "It is Paris."

    def test_regex_mode_is_labelled(self):
        contents = {"prompt": "p", "correct_answers": ["ab+c"], "match_mode": "regex"}
        out = humanize_task_answer("SHORT_ANSWER", contents, {"answer": "abbbc"})
        assert out["items"][0]["correct"] is True
        assert out["items"][0]["expected_text"] == "matches /ab+c/"

    def test_no_configured_answers_means_no_verdict(self):
        out = humanize_task_answer("SHORT_ANSWER", {"prompt": "p"}, {"answer": "x"})
        assert out["items"][0]["correct"] is None
        assert out["total_count"] is None


class TestNumberAnswer:
    def test_agrees_with_the_grader_on_tricky_separators(self):
        contents = {"prompt": "How much?", "correct_value": 1000, "tolerance": 0.5}
        for given in ("1,000", "1000", "999.6", "3,14", "abc"):
            out = humanize_task_answer("NUMBER_ANSWER", contents, {"answer": given})
            assert out["items"][0]["correct"] == _check_number_answer(given, 1000, 0.5)

    def test_expected_text_carries_tolerance_and_unit(self):
        contents = {"prompt": "p", "correct_value": 3.14, "tolerance": 0.01, "unit": "m"}
        out = humanize_task_answer("NUMBER_ANSWER", contents, {"answer": "3.14"})
        assert out["items"][0]["expected_text"] == "3.14 ± 0.01 m"
        assert out["items"][0]["answer_text"] == "3.14 m"

    def test_missing_correct_value_means_no_verdict(self):
        out = humanize_task_answer("NUMBER_ANSWER", {"prompt": "p"}, {"answer": "1"})
        assert out["items"][0]["correct"] is None


class TestFileSubmission:
    def test_all_key_spellings_yield_a_readable_name(self):
        for payload in (
            {"fileUUID": "f_abc", "file_name": "essay.pdf"},
            {"file_uuid": "f_abc", "fileName": "essay.pdf"},
        ):
            out = humanize_task_answer("FILE_SUBMISSION", {}, payload, fallback_prompt="Essay")
            assert out["kind"] == "file"
            assert out["items"][0]["answer_text"] == "essay.pdf"
            assert out["items"][0]["prompt"] == "Essay"
            assert out["file"]["file_uuid"] == "f_abc"

    def test_uuid_only_is_shortened_not_dumped(self):
        out = humanize_task_answer(
            "FILE_SUBMISSION", {}, {"fileUUID": "file_0123456789abcdef0123"}
        )
        assert out["items"][0]["answer_text"] == "Uploaded file (file_012…0123)"

    def test_no_file_reads_as_no_file(self):
        out = humanize_task_answer("FILE_SUBMISSION", {}, {})
        assert out["summary"] == "No file uploaded"
        assert out["file"] is None


class TestCode:
    def _contents(self):
        return {
            "language_id": 71,
            "grading_mode": "equal_weight",
            "solution_code": "print('the answer')",
            "test_cases": [
                {"stdin": "1", "expectedStdout": "2", "hidden": False},
                {"stdin": "secret", "expectedStdout": "shh", "hidden": True},
            ],
        }

    def test_reference_solution_never_leaks(self):
        out = humanize_task_answer("CODE", self._contents(), {
            "source_code": "print(2)", "language_id": 71,
            "results": [{"passed": True}, {"passed": False}],
        })
        assert "the answer" not in str(out)
        assert out["code"]["language"] == "Python 3"
        assert out["code"]["source_code"] == "print(2)"
        assert out["summary"] == "1/2 tests passed"

    def test_hidden_test_io_is_withheld(self):
        out = humanize_task_answer("CODE", self._contents(), {
            "source_code": "x", "results": [{"passed": True}, {"passed": True}],
        })
        visible, hidden = out["code"]["test_results"]
        assert visible["stdin"] == "1" and visible["expected"] == "2"
        assert hidden["name"] == "Hidden test 2"
        assert hidden["stdin"] is None and hidden["expected"] is None
        assert hidden["actual"] is None
        assert hidden["passed"] is True

    def test_missing_result_leaves_the_verdict_unknown(self):
        out = humanize_task_answer("CODE", self._contents(), {"source_code": "x"})
        assert out["code"]["test_results"][0]["passed"] is None
        assert out["code"]["passed_tests"] == 0


class TestRawFallback:
    def test_custom_task_flattens_into_labelled_rows(self):
        out = humanize_task_answer("CUSTOM", {}, {"outer": {"inner": "value"}})
        assert out["kind"] == "raw" and out["unreadable"] is True
        assert out["items"][0]["prompt"] == "outer.inner"
        assert out["items"][0]["answer_text"] == "value"

    def test_item_count_is_capped(self):
        out = humanize_task_answer("OTHER", {}, {str(i): i for i in range(MAX_ITEMS + 50)})
        assert len(out["items"]) == MAX_ITEMS

    def test_malformed_contents_degrades_instead_of_raising(self):
        out = humanize_task_answer("QUIZ", {"questions": "not-a-list"}, {"submissions": 5})
        assert out["kind"] in ("quiz", "raw")

    def test_an_exception_inside_a_builder_falls_back_to_raw(self):
        class Exploding(dict):
            def get(self, *args, **kwargs):
                raise RuntimeError("unreadable contents")

        out = humanize_task_answer("QUIZ", Exploding(), {"submissions": [{"a": 1}]})
        assert out["kind"] == "raw" and out["unreadable"] is True

    def test_lists_are_walked_with_indexed_paths(self):
        out = humanize_task_answer("CUSTOM", {}, {"answers": ["first", "second"]})
        assert [i["prompt"] for i in out["items"]] == ["answers.0", "answers.1"]
        assert out["items"][1]["answer_text"] == "second"

    def test_none_inputs_are_tolerated(self):
        out = humanize_task_answer("QUIZ", None, None)
        assert out["items"] == []


class TestHelpers:
    def test_text_is_truncated(self):
        out = humanize_task_answer(
            "SHORT_ANSWER", {"prompt": "p"}, {"answer": "x" * (MAX_TEXT + 500)}
        )
        assert len(out["items"][0]["answer_text"]) == MAX_TEXT + 1  # + the ellipsis

    def test_digest_is_order_independent_and_content_sensitive(self):
        assert answer_digest({"a": 1, "b": 2}) == answer_digest({"b": 2, "a": 1})
        assert answer_digest({"a": 1}) != answer_digest({"a": 2})
        assert answer_digest({"a": 1}).startswith("sha256:")
        assert answer_digest(None) is None

    def test_digest_survives_unserializable_payloads(self):
        """A digest is an attestation — it must never be the thing that 500s."""
        circular: dict = {}
        circular["self"] = circular
        assert answer_digest(circular).startswith("sha256:")

    def test_type_labels(self):
        assert task_type_label("QUIZ") == "Quiz"
        assert task_type_label("FILE_SUBMISSION") == "File upload"
        assert task_type_label("SOMETHING_NEW") == "Something New"

    def test_language_names(self):
        assert judge0_language_name(71) == "Python 3"
        assert judge0_language_name(9999) == "Language 9999"
        assert judge0_language_name(None) is None
        assert judge0_language_name("nope") is None
