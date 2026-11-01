"""questions: IR questions -> assignment tasks and in-page quiz/flipcard nodes."""

from __future__ import annotations

import re

import pytest

from src.services.courses.lms_import.ir import (
    Asset,
    Blank,
    Choice,
    CodeSpec,
    MatchPair,
    NumericAnswer,
    Question,
    QType,
    RichText,
)
from src.services.courses.lms_import.questions import (
    JUDGE0_LANGUAGES,
    MAX_BLOCK_QUIZ_ANSWERS,
    IdFactory,
    block_quiz_nodes,
    build_tasks,
    plain,
)
from src.tests.lms_import.test_core_html_to_tiptap import assert_valid_blocks


def rt(html: str, resolve=None) -> RichText:
    return RichText(html, resolve) if resolve else RichText(html)


def mc(text="Pick one", correct=(1,), n=3, multiple=False, **kw) -> Question:
    return Question(type=QType.MULTICHOICE, text=rt(f"<p>{text}</p>"),
                    choices=[Choice(rt(f"<p>opt {i}</p>"), correct=i in correct) for i in range(n)],
                    multiple=multiple, **kw)


def ids() -> IdFactory:
    return IdFactory("seed")


# ---------------------------------------------------------------------------
# IdFactory
# ---------------------------------------------------------------------------


def test_id_factory_is_deterministic_and_unique():
    a, b = IdFactory("x"), IdFactory("x")
    seq_a = [a("q") for _ in range(5)] + [a.uuid()]
    seq_b = [b("q") for _ in range(5)] + [b.uuid()]
    assert seq_a == seq_b
    assert len(set(seq_a)) == 6
    assert seq_a[0].startswith("q_")
    assert IdFactory("y")("q") != IdFactory("x")("q")


def test_plain_accepts_question_or_html():
    assert plain(mc("Hello <b>you</b>")) == "Hello you"
    assert plain("<p>x</p>") == "x"
    assert plain(None) == ""


# ---------------------------------------------------------------------------
# Choice questions -> one QUIZ task
# ---------------------------------------------------------------------------


def test_consecutive_choice_questions_are_grouped():
    tf = Question(type=QType.TRUEFALSE, text=rt("Sky is blue"),
                  choices=[Choice(rt("True"), True), Choice(rt("False"))])
    build = build_tasks([mc("Q1", title="First"), tf, mc("Q3", correct=(0, 2), title="Third")], ids())
    assert len(build.tasks) == 1
    task = build.tasks[0]
    assert task.assignment_type == "QUIZ" and task.title == "Quiz"
    qs = task.contents["questions"]
    assert [q["questionText"] for q in qs] == ["Q1", "Sky is blue", "Q3"]
    assert qs[0]["response_type"] == "single" and qs[2]["response_type"] == "multiple"
    opt = qs[0]["options"][1]
    assert set(opt) == {"optionUUID", "text", "fileID", "type", "assigned_right_answer"}
    assert opt == {**opt, "text": "opt 1", "fileID": "", "type": "text", "assigned_right_answer": True}
    assert task.contents["grading_mode"] == "all_or_nothing"
    assert not build.has_manual


def test_single_choice_question_keeps_its_title():
    build = build_tasks([mc(title="  Capital cities ")], ids())
    assert build.tasks[0].title == "Capital cities"
    assert build_tasks([mc()], ids()).tasks[0].title == "Quiz"


def test_partial_credit_mode():
    build = build_tasks([mc(correct=(0, 1), multiple=True, partial_credit=True)], ids())
    assert build.tasks[0].contents["grading_mode"] == "partial_credit"
    build = build_tasks([mc(correct=(0, 1), multiple=True, partial_credit=False)], ids())
    assert build.tasks[0].contents["grading_mode"] == "all_or_nothing"


def test_choice_question_without_correct_answer_is_hand_graded():
    build = build_tasks([mc(correct=())], ids())
    assert build.tasks and build.has_manual


def test_choice_question_without_options_is_skipped():
    empty_tf = Question(type=QType.TRUEFALSE, text=rt("tf"))
    build = build_tasks([Question(type=QType.MULTICHOICE, text=rt("none")), empty_tf], ids())
    assert build.tasks == []
    assert [s[1:] for s in build.skipped] == [("question", "fewer than two answer options")] * 2
    one = Question(type=QType.MULTICHOICE, text=rt("only"), choices=[Choice(rt("yes"), True)])
    assert build_tasks([one], ids()).tasks == []


def test_matching_with_picture_answers_is_skipped():
    q = Question(type=QType.MATCHING, text=rt("Match the shapes"),
                 pairs=[MatchPair(rt("cocci"), ""), MatchPair(rt("bacilli"), "")])
    build = build_tasks([q], ids())
    assert build.tasks == []
    assert build.skipped == [("Match the shapes", "matching question", "its answers are pictures or missing")]


def test_image_only_choice_text():
    q = mc(n=4)
    q.choices[0] = Choice(rt('<img src="a.png">'), True)
    q.choices[1] = Choice(rt('<img alt=" Graph B " src="b.png">'), False)
    q.choices[2] = Choice(rt('<img src="https://x.test/f/my%20chart.gif?v=2">'), False)
    q.choices[3] = Choice(rt('<img src="">'), False)
    build = build_tasks([q], ids())
    assert [o["text"] for o in build.tasks[0].contents["questions"][0]["options"]] == [
        "Image: a.png", "Graph B", "Image: my chart.gif", "(image)"]


def test_matching_expands_to_one_question_per_prompt():
    q = Question(type=QType.MATCHING, text=rt("Match capitals"),
                 pairs=[MatchPair(rt("France"), "Paris"), MatchPair(rt("Spain"), "Madrid"),
                        MatchPair(rt(""), "Paris")],
                 distractors=["Rome", "Paris"])
    build = build_tasks([q], ids())
    qs = build.tasks[0].contents["questions"]
    assert len(qs) == 3
    assert qs[0]["questionText"] == "Match capitals\n→ France"
    assert qs[2]["questionText"].endswith("→ …")
    assert [o["text"] for o in qs[0]["options"]] == ["Paris", "Madrid", "Rome"]
    assert [o["assigned_right_answer"] for o in qs[1]["options"]] == [False, True, False]


def test_ordering_expands_to_positions():
    q = Question(type=QType.ORDERING, text=rt("Sort"), ordering=["a", "b", "c"])
    qs = build_tasks([q], ids()).tasks[0].contents["questions"]
    assert [x["questionText"] for x in qs] == ["Sort\n→ #1", "Sort\n→ #2", "Sort\n→ #3"]
    assert [[o["assigned_right_answer"] for o in x["options"]] for x in qs] == [
        [True, False, False], [False, True, False], [False, False, True]]


def test_ordering_with_repeated_steps_marks_one_option_per_position():
    q = Question(type=QType.ORDERING, text=rt("Steps"), ordering=["Mix", "Bake", "Mix"])
    qs = build_tasks([q], ids()).tasks[0].contents["questions"]
    assert [x["response_type"] for x in qs] == ["single"] * 3
    assert [[o["assigned_right_answer"] for o in x["options"]] for x in qs] == [
        [True, False, False], [False, True, False], [False, False, True]]


def test_empty_matching_and_ordering_leave_no_task():
    build = build_tasks([Question(type=QType.MATCHING), Question(type=QType.ORDERING)], ids())
    assert build.tasks == []


def test_choice_label_falls_back_to_title():
    q = mc("", title="T")
    q.text = rt("")
    assert build_tasks([q], ids()).tasks[0].contents["questions"][0]["questionText"] == "T"
    q.title = ""
    assert build_tasks([q], ids()).tasks[0].contents["questions"][0]["questionText"] == "Question"


# ---------------------------------------------------------------------------
# Cloze -> FORM
# ---------------------------------------------------------------------------


def test_cloze_questions_grouped_into_form():
    q1 = Question(type=QType.CLOZE, text=rt("The {{1}} is {{2}}."), title="Colors",
                  blanks=[Blank(answers=["sky"], hint="up"), Blank(answers=["blue", "azure"], choices=["red", "blue"])])
    q2 = Question(type=QType.CLOZE, text=rt("Pi is {{1}}"),
                  blanks=[Blank(numeric=NumericAnswer(3.14, 0.01))])
    q3 = Question(type=QType.CLOZE, text=rt("{{1}} and {{2}}"),
                  blanks=[Blank(numeric=NumericAnswer(2.0)), Blank()])
    build = build_tasks([q1, q2, q3], ids())
    assert len(build.tasks) == 1
    form = build.tasks[0]
    assert form.assignment_type == "FORM" and form.title == "Fill in the blanks"
    fq = form.contents["questions"]
    assert fq[0]["questionText"] == "The ____ (1) is ____ (2)."
    b1, b2 = fq[0]["blanks"]
    assert b1["placeholder"] == "(1)" and b1["correctAnswer"] == "sky" and b1["hint"] == "up"
    assert b2["placeholder"] == "red / blue" and b2["correctAnswer"] == "blue" and "hint" not in b2
    assert fq[1]["blanks"][0]["correctAnswer"] == "3.14"
    assert fq[2]["blanks"][0]["correctAnswer"] == "2" and fq[2]["blanks"][1]["correctAnswer"] == ""


def test_single_gap_with_several_answers_becomes_a_short_answer():
    q = Question(type=QType.CLOZE, text=rt("The capital is {{1}}."), blanks=[Blank(answers=["Paris", "paris"])])
    build = build_tasks([q], ids())
    t = build.tasks[0]
    assert t.assignment_type == "SHORT_ANSWER" and t.contents["prompt"] == "The capital is ____."
    assert t.contents["correct_answers"] == ["Paris", "paris"]


def test_single_cloze_keeps_title():
    q = Question(type=QType.CLOZE, text=rt("{{1}}"), title="Gap", blanks=[Blank(answers=["x"])])
    assert build_tasks([q], ids()).tasks[0].title == "Gap"


def test_cloze_without_blanks_keeps_its_text():
    q = Question(type=QType.CLOZE, text=rt("nothing"))
    build = build_tasks([q], ids())
    assert len(build.tasks) == 1 and build.tasks[0].contents["questions"][0]["blanks"] == []


# ---------------------------------------------------------------------------
# Single-question task types
# ---------------------------------------------------------------------------


def test_short_answer_modes():
    exact = Question(type=QType.SHORTANSWER, text=rt("Name?"), answers=["Ada", " ", ""], case_sensitive=True)
    loose = Question(type=QType.SHORTANSWER, text=rt("Name?"), answers=["ada"], general_feedback="<p>It is Ada</p>")
    build = build_tasks([exact, loose], ids())
    a, b = build.tasks
    assert a.assignment_type == "SHORT_ANSWER" and a.title == "Question 1"
    assert a.contents == {"prompt": "Name?", "correct_answers": ["Ada"], "match_mode": "exact", "explanation": ""}
    assert b.contents["match_mode"] == "case_insensitive" and b.contents["explanation"] == "It is Ada"
    assert build.solution_notes == ["2. It is Ada"]


def test_short_answer_wildcards_become_escaped_regex():
    q = Question(type=QType.SHORTANSWER, text=rt("?"), answers=["colo*r", "a.b (c)", "*"])
    task = build_tasks([q], ids()).tasks[0]
    patterns = task.contents["correct_answers"]
    assert task.contents["match_mode"] == "regex"
    assert patterns == ["colo.*r", re.escape("a.b (c)"), ".*"]
    assert re.fullmatch(patterns[0], "colour") and not re.fullmatch(patterns[1], "aXb (c)")
    assert re.fullmatch(patterns[1], "a.b (c)")


def test_short_answer_without_answers_is_hand_graded():
    build = build_tasks([Question(type=QType.SHORTANSWER, text=rt("?"))], ids())
    assert build.tasks[0].contents["correct_answers"] == []
    assert build.has_manual


def test_numerical():
    q = Question(type=QType.NUMERICAL, text=rt("g?"), unit="m/s²",
                 numeric=[NumericAnswer(9.81, -0.05), NumericAnswer(10.0)])
    build = build_tasks([q], ids())
    t = build.tasks[0]
    assert t.assignment_type == "NUMBER_ANSWER"
    assert t.contents == {"prompt": "g?", "correct_value": 9.81, "tolerance": 0.05, "unit": "m/s²",
                          "explanation": ""}


def test_numerical_without_answer_is_skipped_and_intro_carries():
    intro = Question(type=QType.DESCRIPTION, text=rt("Read this"))
    build = build_tasks([intro, Question(type=QType.NUMERICAL, text=rt("?")), mc("Next")], ids())
    assert [t.assignment_type for t in build.tasks] == ["QUIZ"]
    assert build.tasks[0].description == "Read this"
    assert build.skipped == [("?", "numerical question", "no answer")]


def test_numerical_tolerance_none():
    q = Question(type=QType.NUMERICAL, text=rt("?"), numeric=[NumericAnswer(1.0, None)])
    assert build_tasks([q], ids()).tasks[0].contents["tolerance"] == 0.0


def test_essay_and_file_upload_are_manual_file_submissions():
    essay = Question(type=QType.ESSAY, text=rt("<p>Discuss</p>"), title="Essay")
    upload = Question(type=QType.FILE_UPLOAD, text=rt("Upload"))
    build = build_tasks([essay, upload], ids())
    assert build.has_manual
    e, u = build.tasks
    assert e.assignment_type == u.assignment_type == "FILE_SUBMISSION"
    assert e.contents == {} and e.description == "Discuss" and e.title == "Essay"
    assert e.hint == "Upload your answer as a document." and u.hint == ""


def test_code_task():
    spec = CodeSpec(language="JavaScript", starter_code="// start", solution_code="x()",
                    test_cases=[("1", "2"), ("", "ok")])
    build = build_tasks([Question(type=QType.CODE, text=rt("Write it"), code=spec)], ids())
    c = build.tasks[0].contents
    assert build.tasks[0].assignment_type == "CODE"
    assert c["language_id"] == JUDGE0_LANGUAGES["javascript"] == 63
    assert c["starter_code"] == "// start" and c["solution_code"] == "x()"
    assert [(t["label"], t["stdin"], t["expectedStdout"], t["weight"], t["hidden"]) for t in c["test_cases"]] == [
        ("Test 1", "1", "2", 1, False), ("Test 2", "", "ok", 1, False)]
    assert c["grading_mode"] == "equal_weight"


@pytest.mark.parametrize("lang,expected", [("c++", 54), ("golang", 60), ("SQL", 82), ("bash", 46)])
def test_code_language_mapping(lang, expected):
    q = Question(type=QType.CODE, text=rt("x"), code=CodeSpec(language=lang))
    assert build_tasks([q], ids()).tasks[0].contents["language_id"] == expected


def test_code_task_unknown_language_and_no_spec():
    build = build_tasks([Question(type=QType.CODE, text=rt("x"), code=CodeSpec(language="cobol")),
                         Question(type=QType.CODE, text=rt("y")),
                         Question(type=QType.CODE, text=rt("z"), code=CodeSpec(language=""))], ids())
    assert [t.contents["language_id"] for t in build.tasks] == [71, 71, 71]
    assert build.tasks[1].contents["test_cases"] == [] and build.tasks[1].contents["starter_code"] == ""
    assert "Written for cobol in the source" in build.tasks[0].description
    assert "Written for" not in build.tasks[1].description


# ---------------------------------------------------------------------------
# Descriptions, unsupported, warnings, references
# ---------------------------------------------------------------------------


def test_description_carried_into_next_task_and_trailing():
    d1 = Question(type=QType.DESCRIPTION, text=rt("Intro A"))
    d2 = Question(type=QType.DESCRIPTION, text=rt("Intro B"))
    mid = Question(type=QType.DESCRIPTION, text=rt("Between"))
    empty = Question(type=QType.DESCRIPTION, text=rt("<p> </p>"))
    tail = Question(type=QType.DESCRIPTION, text=rt("The end"))
    sa = Question(type=QType.SHORTANSWER, text=rt("SA"), answers=["x"])
    build = build_tasks([d1, d2, empty, mc("Q1"), mid, mc("Q2"), sa, tail], ids())
    quiz, short = build.tasks
    assert quiz.description == "Intro A\n\nIntro B\n\nBetween"
    assert short.description == "The end"


def test_description_between_cloze_questions_joins_form():
    c1 = Question(type=QType.CLOZE, text=rt("{{1}}"), blanks=[Blank(answers=["a"])])
    c2 = Question(type=QType.CLOZE, text=rt("{{1}}"), blanks=[Blank(answers=["b"])])
    d = Question(type=QType.DESCRIPTION, text=rt("Part 2"))
    build = build_tasks([c1, d, c2, mc("next")], ids())
    form, quiz = build.tasks
    assert form.description == "Part 2" and quiz.description == ""


def test_description_with_no_task_is_dropped():
    build = build_tasks([Question(type=QType.DESCRIPTION, text=rt("Only text"))], ids())
    assert build.tasks == []


def test_essay_description_combines_intro_and_prompt():
    d = Question(type=QType.DESCRIPTION, text=rt("Context"))
    build = build_tasks([d, Question(type=QType.ESSAY, text=rt("Prompt"))], ids())
    assert build.tasks[0].description == "Context\n\nPrompt"


def test_unsupported_questions_are_skipped():
    build = build_tasks([
        Question(type=QType.UNSUPPORTED, text=rt("Click the map"), source_type="hotspot", reason="needs image"),
        Question(type=QType.UNSUPPORTED, title="Untitled"),
        Question(type=QType.UNSUPPORTED, text=rt("A"), source_type="stack"),
        Question(type=QType.UNSUPPORTED, text=rt("B"), source_type="stack"),
    ], ids())
    assert build.tasks == []
    assert build.skipped == [
        ("Click the map", "hotspot question", "needs image"),
        ("Untitled", "unknown question", "no LearnHouse equivalent"),
        ("2 questions: A; B", "stack question", "no LearnHouse equivalent"),
    ]


def test_point_values_become_task_weights():
    same = build_tasks([mc(points=2), mc(points=2), Question(type=QType.DESCRIPTION, text=rt("x"), points=9)], ids())
    assert [t.max_grade_value for t in same.tasks] == [100]  # one quiz task of two equal questions
    diff = build_tasks([mc(points=1), mc(points=2), mc(points=2)], ids())
    assert [(t.assignment_type, len(t.contents["questions"]), t.max_grade_value) for t in diff.tasks] == [
        ("QUIZ", 1, 25), ("QUIZ", 2, 100)]  # grouped only while the weight is the same
    none = build_tasks([mc(points=0), Question(type=QType.SHORTANSWER, text=rt("?"), answers=["a"], points=0)], ids())
    assert [t.max_grade_value for t in none.tasks] == [100, 100]


def test_non_finite_points_and_values_are_dropped():
    import json

    nan, inf = float("nan"), float("inf")
    build = build_tasks([
        mc("A", points=nan), mc("B", points=inf),
        Question(type=QType.SHORTANSWER, text=rt("S"), answers=["a"], points=-5),
        Question(type=QType.NUMERICAL, text=rt("N1"), numeric=[NumericAnswer(nan), NumericAnswer(2.0, inf)], points=3),
        Question(type=QType.NUMERICAL, text=rt("N2"), numeric=[NumericAnswer(inf)]),
        Question(type=QType.CLOZE, text=rt("C {{1}}"), blanks=[Blank(numeric=NumericAnswer(nan))]),
    ], ids())
    # NaN/inf/negative weights count as 0; the 3-point number question is the heaviest (the cloze keeps its default 1)
    assert [(t.assignment_type, t.max_grade_value) for t in build.tasks] == [
        ("QUIZ", 1), ("SHORT_ANSWER", 1), ("NUMBER_ANSWER", 100), ("FORM", 33)]
    assert len(build.tasks[0].contents["questions"]) == 2  # same (zeroed) weight: one quiz
    number = build.tasks[2].contents
    assert number["correct_value"] == 2.0 and number["tolerance"] == 0.0  # first finite value, inf tolerance dropped
    assert ("N2", "numerical question", "no answer") in build.skipped
    assert build.tasks[3].contents["questions"][0]["blanks"][0]["correctAnswer"] == ""
    assert build.has_manual  # a gap without a usable key needs a grader
    for t in build.tasks:  # what the package writes must be strict JSON
        json.dumps(t.contents, allow_nan=False)
    assert block_quiz_nodes([Question(type=QType.NUMERICAL, text=rt("N"), numeric=[NumericAnswer(nan)])],
                            ids(), lambda _m: None) == []


def test_task_type_switches_close_groups():
    c = Question(type=QType.CLOZE, text=rt("{{1}}"), blanks=[Blank(answers=["a"])])
    build = build_tasks([mc("a"), c, mc("b"), c], ids())
    assert [t.assignment_type for t in build.tasks] == ["QUIZ", "FORM", "QUIZ", "FORM"]


def test_solution_notes_skip_empty_feedback():
    build = build_tasks([mc(general_feedback="<p> </p>"), mc(general_feedback="<b>Because</b>")], ids())
    assert build.solution_notes == ["2. Because"]


def _resolve(url):
    return Asset(path=f"/x/{url}", name=url) if url.endswith(".png") else None


def test_single_image_becomes_reference():
    q = Question(type=QType.SHORTANSWER, text=rt('<p>See <img src="fig.png"></p>', _resolve), answers=["a"])
    assert build_tasks([q], ids()).tasks[0].reference.name == "fig.png"


def test_group_reference_from_images():
    q1 = mc()
    q1.text = rt('<p>Q <img src="one.png"></p>', _resolve)
    q2 = mc()
    q2.text = rt('<p>Q <img src="two.png"></p>', _resolve)
    single = build_tasks([q1, mc()], ids())
    assert single.tasks[0].reference.name == "one.png"
    several = build_tasks([q1, q2], ids())
    assert several.tasks[0].reference.name == "one.png"
    c = Question(type=QType.CLOZE, text=rt('{{1}} <img src="gap.png">', _resolve), blanks=[Blank(answers=["a"])])
    assert build_tasks([c], ids()).tasks[0].reference.name == "gap.png"


def test_build_tasks_is_deterministic():
    qs = [mc("a"), Question(type=QType.SHORTANSWER, text=rt("b"), answers=["x"])]
    a = build_tasks(qs, IdFactory("k"))
    b = build_tasks(qs, IdFactory("k"))
    assert [t.contents for t in a.tasks] == [t.contents for t in b.tasks]


# ---------------------------------------------------------------------------
# block_quiz_nodes
# ---------------------------------------------------------------------------


def _bq(questions):
    warnings: list[str] = []
    nodes = block_quiz_nodes(questions, IdFactory("bq"), warnings.append)
    assert_valid_blocks(nodes)
    return nodes, warnings


def test_block_quiz_groups_consecutive_choice_questions():
    tf = Question(type=QType.TRUEFALSE, text=rt("tf"), choices=[Choice(rt("True"), True), Choice(rt("False"))])
    nodes, w = _bq([mc("a"), tf, mc("m", correct=(0, 1))])
    assert len(nodes) == 1 and nodes[0]["type"] == "blockQuiz"
    qs = nodes[0]["attrs"]["questions"]
    assert [q["question"] for q in qs] == ["a", "tf", "m"]
    assert [q["response_type"] for q in qs] == ["single", "single", "multiple"]
    assert set(qs[0]["answers"][0]) == {"answer_id", "answer", "correct"}
    assert w == []


def test_block_quiz_with_too_many_options_becomes_a_flipcard():
    # A quiz block shows at most MAX_BLOCK_QUIZ_ANSWERS options: nothing is trimmed away
    q = mc("big", correct=(6, 7), n=MAX_BLOCK_QUIZ_ANSWERS + 3)
    nodes, w = _bq([mc("small"), q])
    assert [n["type"] for n in nodes] == ["blockQuiz", "flipcardGrid"]
    card = nodes[1]["content"][0]["attrs"]
    assert card["question"] == "big" and card["answer"] == "opt 6, opt 7"
    assert w == []


def test_flipcard_fallbacks():
    qs = [
        Question(type=QType.SHORTANSWER, text=rt("Capital?"), answers=["Paris", "", "paris"]),
        Question(type=QType.NUMERICAL, text=rt("g"), numeric=[NumericAnswer(9.8, 0.1)], unit="m/s²"),
        Question(type=QType.NUMERICAL, text=rt("n"), numeric=[NumericAnswer(3.0)]),
        Question(type=QType.MATCHING, text=rt("Match"), pairs=[MatchPair(rt("A"), "1"), MatchPair(rt("B"), "2")]),
        Question(type=QType.ORDERING, text=rt("Order"), ordering=["x", "y"]),
        Question(type=QType.CLOZE, text=rt("A {{1}} B {{2}} C {{3}}"),
                 blanks=[Blank(answers=["a"]), Blank(numeric=NumericAnswer(2.5)), Blank()]),
        Question(type=QType.ESSAY, text=rt("Essay"), general_feedback="<p>Model answer</p>"),
    ]
    nodes, _ = _bq(qs)
    assert len(nodes) == 1 and nodes[0]["type"] == "flipcardGrid" and nodes[0]["attrs"]["columns"] == 2
    answers = [c["attrs"]["answer"] for c in nodes[0]["content"]]
    assert answers == ["Paris, paris", "9.8 m/s² (± 0.1)", "3", "A → 1; B → 2", "x → y",
                       "(1) a; (2) 2.5; (3) ", "Model answer"]
    assert nodes[0]["content"][5]["attrs"]["question"] == "A ____ B ____ C ____"


def test_flipcards_and_quiz_interleave():
    sa = Question(type=QType.SHORTANSWER, text=rt("s"), answers=["x"])
    nodes, _ = _bq([mc("a"), sa, mc("b")])
    assert [n["type"] for n in nodes] == ["blockQuiz", "flipcardGrid", "blockQuiz"]
    assert nodes[1]["attrs"]["columns"] == 1


def test_block_quiz_skips_unanswerable_questions():
    qs = [
        Question(type=QType.DESCRIPTION, text=rt("intro")),
        Question(type=QType.ESSAY, text=rt("no model answer")),
        Question(type=QType.SHORTANSWER, text=rt("no answers")),
        Question(type=QType.MULTICHOICE, text=rt("no choices")),
        Question(type=QType.TRUEFALSE, text=rt("tf no correct"), choices=[]),
        Question(type=QType.UNSUPPORTED, text=rt("hotspot"), source_type="hotspot"),
        Question(type=QType.FILE_UPLOAD, title="upload"),
    ]
    nodes, w = _bq(qs)
    assert nodes == [] and w == []  # unsupported questions are reported by the page writer


def test_flipcard_texts_are_truncated_and_label_fallback():
    long = "x" * 900
    q = Question(type=QType.SHORTANSWER, title="Titled", answers=[long])
    nodes, _ = _bq([q])
    card = nodes[0]["content"][0]["attrs"]
    assert card["question"] == "Titled" and len(card["answer"]) == 500
    assert card == {**card, "color": "blue", "alignment": "center", "size": "medium"}


def test_answer_summary_choice_types_via_internal():
    from src.services.courses.lms_import.questions import _answer_summary

    assert _answer_summary(mc(correct=(0, 2))) == "opt 0, opt 2"
    assert _answer_summary(mc(correct=())) is None
    assert _answer_summary(Question(type=QType.UNSUPPORTED)) is None
    assert _answer_summary(Question(type=QType.DESCRIPTION)) is None


def test_quiz_questions_for_non_choice_type_is_empty():
    from src.services.courses.lms_import.questions import _quiz_questions_for

    assert _quiz_questions_for(Question(type=QType.ESSAY), ids(), lambda _m: None) == []
