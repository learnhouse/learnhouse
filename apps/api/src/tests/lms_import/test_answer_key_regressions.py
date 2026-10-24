"""Answer keys and visibility read from real export structures."""

from __future__ import annotations

from src.services.courses.lms_import import ir, qti
from src.services.courses.lms_import.questions import IdFactory, build_tasks
from src.services.courses.lms_import.sources import brightspace, moodle, openedx
from src.services.courses.lms_import.xmlutil import parse_bytes

from .test_openedx import Olx, items

# ---------------------------------------------------------------------------
# Moodle
# ---------------------------------------------------------------------------


def _moodle_questions() -> moodle._Questions:
    return moodle._Questions(moodle._Bank([]), lambda html, *_a: ir.RichText(html))


def _answers_xml(*items) -> str:
    return "<answers>" + "".join(
        f'<answer id="{aid}"><answertext>{text}</answertext><answerformat>1</answerformat>'
        f"<fraction>{fraction}</fraction><feedback></feedback></answer>" for aid, text, fraction in items
    ) + "</answers>"


def test_moodle_numerical_records_keep_their_tolerance():
    # Moodle 2.x+ backups: <numerical_records><numerical_record>, the answer by id
    plug = parse_bytes(("<plugin_qtype_numerical_question>" + _answers_xml((7, "112", "1.0000000"), (8, "*", "0"))
                        + "<numerical_records><numerical_record id=\"1\"><answer>7</answer>"
                          "<tolerance>2.5</tolerance></numerical_record></numerical_records>"
                          "</plugin_qtype_numerical_question>").encode())
    out = ir.Question(type=ir.QType.UNSUPPORTED, text=ir.RichText("Speed?"))
    _moodle_questions()._q_numerical(None, out, plug, "")
    assert out.numeric == [ir.NumericAnswer(112.0, 2.5)]


def test_moodle_calculated_multi_reads_the_nested_single_flag():
    plug = parse_bytes(("<plugin_qtype_calculatedmulti_question>"
                        + _answers_xml((1, "{={a}*2}", "0.6000000"), (2, "{={a}+2}", "0.4000000"),
                                       (3, "{={a}}", "0"))
                        + "<dataset_definitions><dataset_definition><name>a</name><dataset_items><dataset_item>"
                          "<number>1</number><value>3</value></dataset_item></dataset_items></dataset_definition>"
                          "</dataset_definitions>"
                          "<calculated_options><calculated_option id=\"1\"><single>0</single>"
                          "</calculated_option></calculated_options></plugin_qtype_calculatedmulti_question>"
                        ).encode())
    out = ir.Question(type=ir.QType.UNSUPPORTED, text=ir.RichText("a = {a}"))
    _moodle_questions()._q_calculatedmulti(None, out, plug, "")
    assert out.multiple is True
    assert [c.correct for c in out.choices] == [True, True, False]


def test_moodle_escaped_asterisk_is_literal():
    q = ir.Question(type=ir.QType.SHORTANSWER, text=ir.RichText("2 times 3, as typed"), answers=["2\\*3"])
    task = build_tasks([q], IdFactory("t")).tasks[0]
    assert task.contents["correct_answers"] == ["2*3"] and task.contents["match_mode"] == "case_insensitive"
    mixed = ir.Question(type=ir.QType.SHORTANSWER, text=ir.RichText("x"), answers=["a\\*b*"])
    task = build_tasks([mixed], IdFactory("t")).tasks[0]
    assert task.contents["correct_answers"] == ["a\\*b.*"] and task.contents["match_mode"] == "regex"


# ---------------------------------------------------------------------------
# QTI (Canvas, Common Cartridge, Blackboard, Brightspace)
# ---------------------------------------------------------------------------

_PARTIAL_MC = """<item ident="q1" title="Capital">
<presentation><material><mattext texttype="text/html">Capital of France?</mattext></material>
<response_lid ident="r1" rcardinality="Single"><render_choice>
<response_label ident="a"><material><mattext>Paris</mattext></material></response_label>
<response_label ident="b"><material><mattext>Lyon</mattext></material></response_label>
<response_label ident="c"><material><mattext>Rome</mattext></material></response_label>
</render_choice></response_lid></presentation>
<resprocessing><outcomes><decvar varname="SCORE"/></outcomes>
<respcondition><conditionvar><varequal respident="r1">a</varequal></conditionvar>
<setvar action="Set" varname="SCORE">100</setvar></respcondition>
<respcondition><conditionvar><varequal respident="r1">b</varequal></conditionvar>
<setvar action="Set" varname="SCORE">25</setvar></respcondition>
</resprocessing></item>"""


def test_qti_partial_credit_option_is_not_a_second_right_answer():
    q = qti.parse_item(parse_bytes(_PARTIAL_MC.encode()))
    assert [c.correct for c in q.choices] == [True, False, False] and not q.multiple
    # Equally scored options of a single-answer question both stay right
    q = qti.parse_item(parse_bytes(_PARTIAL_MC.replace(">25<", ">100<").encode()))
    assert [c.correct for c in q.choices] == [True, True, False]
    # Multiple answer questions keep every option that earns points
    q = qti.parse_item(parse_bytes(_PARTIAL_MC.replace('"Single"', '"Multiple"').encode()))
    assert [c.correct for c in q.choices] == [True, True, False] and q.multiple


def _fib(*conditions: str) -> str:
    return ("""<item ident="f1" title="Blank"><itemmetadata><qtimetadata><qtimetadatafield>
<fieldlabel>cc_profile</fieldlabel><fieldentry>cc.fib.v0p1</fieldentry></qtimetadatafield></qtimetadata>
</itemmetadata><presentation><material><mattext>Which city?</mattext></material>
<response_str ident="r1" rcardinality="Single"><render_fib/></response_str></presentation>
<resprocessing><outcomes><decvar varname="SCORE"/></outcomes>""" + "".join(
        f'<respcondition><conditionvar>{c}</conditionvar><setvar action="Set" varname="SCORE">100</setvar>'
        f"</respcondition>" for c in conditions) + "</resprocessing></item>")


def test_qti_substring_answers_match_as_contains():
    q = qti.parse_item(parse_bytes(_fib('<varsubstring respident="r1">Z[uü]rich</varsubstring>',
                                        '<varequal respident="r1">Geneva (GE)</varequal>').encode()))
    assert q.type == ir.QType.SHORTANSWER and q.regex
    assert q.answers == [".*(?:Z[uü]rich).*", r"Geneva\ \(GE\)"]
    task = build_tasks([q], IdFactory("t")).tasks[0]
    assert task.contents["match_mode"] == "regex"
    # Not a valid pattern: matched literally
    q = qti.parse_item(parse_bytes(_fib('<varsubstring respident="r1">photo(synth</varsubstring>').encode()))
    assert q.answers == [r".*(?:photo\(synth).*"]
    # Exact answers only: unchanged
    q = qti.parse_item(parse_bytes(_fib('<varequal respident="r1">Bern</varequal>').encode()))
    assert q.answers == ["Bern"] and not q.regex


def test_brightspace_partial_credit_option_is_not_a_second_right_answer():
    item = parse_bytes(_PARTIAL_MC.encode())
    resp = next(item.iter("response_lid"))
    assert brightspace._top_scored(item, resp, {"a", "b"}) == {"a"}
    assert brightspace._top_scored(item, resp, {"a"}) == {"a"}


# ---------------------------------------------------------------------------
# Open edX
# ---------------------------------------------------------------------------


def test_edx_staff_only_unit_stays_out_of_the_published_assignment(tmp_path):
    olx = Olx(tmp_path)
    olx.course(["ch1"])
    olx.chapter("ch1", "Week 1", ["seq1"])
    olx.sequential("seq1", "Homework 1", ["v1", "v2"], 'graded="true" format="Homework"')
    olx.vertical("v1", "Public", olx.problem("p1", (
        '<problem><multiplechoiceresponse><choicegroup type="MultipleChoice">'
        '<choice correct="true">Yes</choice><choice correct="false">No</choice>'
        "</choicegroup></multiplechoiceresponse></problem>")))
    olx.vertical("v2", "Answer key", olx.problem("p2", (
        '<problem><stringresponse answer="secret"><textline/></stringresponse></problem>')),
        'visible_to_staff_only="true"')
    found = [i for i in items(openedx.read(str(tmp_path))) if isinstance(i, ir.Assessment)]
    assert [(a.title, a.visible, len(a.questions)) for a in found] == [
        ("Homework 1", True, 1), ("Answer key", False, 1)]
    assert found[1].questions[0].answers == ["secret"]


def test_edx_pattern_answers_are_not_turned_into_blanks(tmp_path):
    olx = Olx(tmp_path)
    olx.course(["ch1"])
    olx.chapter("ch1", "Week 1", ["seq1"])
    olx.sequential("seq1", "Practice", ["v1"])
    olx.vertical("v1", "Unit", olx.problem("p1", (
        "<problem><p>Spell it: <stringresponse answer=\"colou?r\" type=\"regexp ci\"><textline/></stringresponse>"
        " and <stringresponse answer=\"grey\"><textline/></stringresponse></p></problem>")))
    page = items(openedx.read(str(tmp_path)))[0]
    questions = [q for p in page.parts if isinstance(p, ir.InlineQuizPart) for q in p.questions]
    assert [q.type for q in questions] == [ir.QType.SHORTANSWER, ir.QType.SHORTANSWER]
    assert questions[0].regex and questions[0].answers == ["colou?r"]


def test_blackboard_cognero_pool_scores_a_differently_named_response():
    from .test_blackboard import choice_response, correct_cond, item_xml, parse, veq

    # The choice block is "RESPONSE_I57_R0" but scoring names it "response"
    q = parse(item_xml("Multiple Choice", "Which?",
                       choice_response([("I57_C1", "A"), ("I57_C2", "B"), ("I57_C3", "C")], ident="RESPONSE_I57_R0"),
                       correct_cond(veq("I57_C2"))))
    assert [c.correct for c in q.choices] == [False, True, False]
    # A scored value that is not one of the choices is not taken as the key
    q = parse(item_xml("Multiple Choice", "Which?",
                       choice_response([("a", "A"), ("b", "B")], ident="RESPONSE_X"), correct_cond(veq("zzz"))))
    assert [c.correct for c in q.choices] == [False, False]


def test_bare_ampersands_in_xml_are_repaired():
    doc = parse_bytes(b"<manifest><title>Hospitality & Tourism &amp; Events &#38; &nbsp;more</title></manifest>")
    assert doc.find("title").text == "Hospitality & Tourism & Events & \xa0more"


def test_edx_numeric_answers_written_as_arithmetic():
    assert openedx._number("2*0.3259") == 0.6518
    assert openedx._number("8*80*60") == 38400.0
    assert abs(openedx._number("1-0.1-0.21") - 0.69) < 1e-9
    assert openedx._number("2^10") == 1024.0
    assert openedx._number("1/0") is None and openedx._number("x*2") is None and openedx._number("") is None


def test_canvas_formula_question_in_a_plain_qti_export():
    item = parse_bytes("""<item ident="c1" title="Add"><itemmetadata><qtimetadata><qtimetadatafield>
<fieldlabel>question_type</fieldlabel><fieldentry>calculated_question</fieldentry></qtimetadatafield>
</qtimetadata></itemmetadata><presentation><material><mattext texttype="text/html">What is 5 plus [x]?</mattext>
</material><response_str ident="r" rcardinality="Single"><render_fib fibtype="Decimal"/></response_str>
</presentation><itemproc_extension><calculated><answer_tolerance>5%</answer_tolerance><var_sets>
<var_set ident="1"><var name="x">4</var><answer>9</answer></var_set></var_sets></calculated></itemproc_extension>
</item>""".encode())
    q = qti.parse_item(item)
    assert q.type == ir.QType.NUMERICAL and q.text.html == "What is 5 plus 4?"
    assert q.numeric == [ir.NumericAnswer(9.0, 0.45)]


def test_edx_content_library(tmp_path):
    olx = Olx(tmp_path / "library")
    olx.write("library.xml", '<library url_name="library" display_name="Respiratory bank" org="Org" '
              'library="Resp1"><problem url_name="p1"/><html url_name="h1"/></library>')
    olx.problem("p1", ('<problem><multiplechoiceresponse><choicegroup type="MultipleChoice">'
                       '<choice correct="true">Lungs</choice><choice correct="false">Liver</choice>'
                       "</choicegroup></multiplechoiceresponse></problem>"))
    olx.html("h1", "<p>Read first</p>")
    assert openedx.detect(str(tmp_path)) == 100
    course = openedx.read(str(tmp_path))
    assert course.title == "Respiratory bank" and course.id == "Org+Resp1"
    section = course.sections[0]
    assert not section.visible and all(not i.visible for i in section.items)
    quiz = next(i for i in section.items if isinstance(i, ir.Assessment))
    mc = next(q for q in quiz.questions if q.type == ir.QType.MULTICHOICE)
    assert [c.correct for c in mc.choices] == [True, False]
    assert course.warnings == []
    # library.xml that is not a library is not detected
    other = tmp_path / "other"
    other.mkdir()
    (other / "library.xml").write_text("<catalog/>")
    assert openedx.detect(str(other)) == 0


def test_empty_edx_content_library(tmp_path):
    (tmp_path / "library.xml").write_text('<library display_name="Empty"/>')
    course = openedx.read(str(tmp_path))
    assert course.title == "Empty" and course.sections == []
