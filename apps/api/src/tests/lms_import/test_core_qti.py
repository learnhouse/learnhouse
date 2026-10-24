"""qti: generic IMS QTI 1.2 item and assessment parsing."""

from __future__ import annotations

from src.services.courses.lms_import import qti
from src.services.courses.lms_import.ir import Asset, QType
from src.services.courses.lms_import.qti import (
    TYPE_LABELS,
    QtiItem,
    correct_values,
    material_html,
    material_text,
    parse_assessment,
    parse_item,
    qti_metadata,
)
from src.services.courses.lms_import.xmlutil import parse_bytes


def meta(**fields) -> str:
    rows = "".join(f"<qtimetadatafield><fieldlabel>{k}</fieldlabel><fieldentry>{v}</fieldentry></qtimetadatafield>"
                   for k, v in fields.items())
    return f"<itemmetadata><qtimetadata>{rows}</qtimetadata></itemmetadata>"


def mat(text: str, texttype: str = "text/plain") -> str:
    return f'<material><mattext texttype="{texttype}"><![CDATA[{text}]]></mattext></material>'


def labels(*pairs) -> str:
    return "".join(f'<response_label ident="{i}">{mat(t)}</response_label>' for i, t in pairs)


def cond(*equals, score="100", title="", wrap="") -> str:
    inner = "".join(f'<varequal respident="{r}">{v}</varequal>' for r, v in equals)
    if wrap:
        inner = f"<{wrap}>{inner}</{wrap}>"
    t = f' title="{title}"' if title else ""
    return (f"<respcondition{t}><conditionvar>{inner}</conditionvar>"
            f'<setvar action="Set" varname="SCORE">{score}</setvar></respcondition>')


def item(body: str, *, metadata: str = "", rp: str = "", extra: str = "", ident="i1", title="Item 1") -> str:
    return (f'<item ident="{ident}" title="{title}">{metadata}<presentation>{body}</presentation>'
            f"<resprocessing>{rp}</resprocessing>{extra}</item>")


def parse(xml: str, **kw):
    return parse_item(parse_bytes(xml.encode()), **kw)


# ---------------------------------------------------------------------------
# Material
# ---------------------------------------------------------------------------


def test_material_html_variants():
    el = parse_bytes(b"""<material>
      <mattext texttype="text/html">&lt;p&gt;Rich&lt;/p&gt;</mattext>
      <mattext>a &lt; b
second line</mattext>
      <mattext>has <![CDATA[<b>tags</b>]]></mattext>
      <mat_formattedtext>&lt;i&gt;fmt&lt;/i&gt;</mat_formattedtext>
      <matemtext>emph</matemtext>
      <matimage uri="img/a.png" label="Alt &quot;q&quot;"/>
      <matimage label="no uri"/>
      <matbreak/>
    </material>""")
    out = material_html(el)
    assert "<p>Rich</p>" in out
    assert "a &lt; b<br>second line" in out
    assert "has <b>tags</b>" in out
    assert "<i>fmt</i>" in out
    assert "<em>emph</em>" in out
    assert '<img src="img/a.png" alt="Alt &quot;q&quot;">' in out
    assert out.endswith("<br>")
    assert out.count("<img") == 1


def test_material_html_none_and_hook():
    assert material_html(None) == ""
    el = parse_bytes(b"<material><mattext>x</mattext></material>")
    assert material_html(el, lambda _e: "<p>custom</p>") == "<p>custom</p>"
    assert material_html(el, lambda _e: None) == "x"
    assert material_text(el) == "x"


# ---------------------------------------------------------------------------
# Metadata
# ---------------------------------------------------------------------------


def test_qti_metadata_fields_and_bb_leaves():
    fields = meta(question_type="essay_question", Points_Possible="3").replace("<itemmetadata>", "").replace(
        "</itemmetadata>", "")
    el = parse_bytes(f"""<item><itemmetadata>{fields}
      <bbmd_questiontype>Essay</bbmd_questiontype><qmd_weighting>2</qmd_weighting>
        <bbmd_nested><x>1</x></bbmd_nested><other>o</other><bbmd_empty/></itemmetadata></item>""".encode())
    m = qti_metadata(el)
    assert m["question_type"] == "essay_question"
    assert m["points_possible"] == "3"
    assert m["bbmd_questiontype"] == "Essay"
    assert m["qmd_weighting"] == "2"
    assert "other" not in m and "bbmd_empty" not in m
    assert qti_metadata(None) == {}


def test_assessment_metadata_does_not_include_item_fields():
    root = parse_bytes(f"""<questestinterop><assessment ident="A" title="Quiz">
      <qtimetadata><qtimetadatafield><fieldlabel>cc_maxattempts</fieldlabel><fieldentry>2</fieldentry>
      </qtimetadatafield></qtimetadata>
      <section ident="s">{item(mat("Q"), metadata=meta(question_type="essay_question"))}</section>
    </assessment></questestinterop>""".encode())
    a = parse_assessment(root)[0]
    assert a.meta == {"cc_maxattempts": "2"}
    assert a.questions[0].type == QType.ESSAY


def test_type_labels_cover_dialects():
    assert TYPE_LABELS["multiple_answers_question"] == QType.MULTICHOICE
    assert TYPE_LABELS["cc.fib.v0p1"] == QType.SHORTANSWER
    assert TYPE_LABELS["hot spot"] == QType.UNSUPPORTED


# ---------------------------------------------------------------------------
# Choice questions
# ---------------------------------------------------------------------------


def test_single_choice_with_metadata_and_points():
    q = parse(item(mat("<p>Capital of France?</p>", "text/html") + '<response_lid ident="r1" rcardinality="Single">'
                   f"<render_choice>{labels(('a', 'Paris'), ('b', 'Rome'))}</render_choice></response_lid>",
                   metadata=meta(question_type="multiple_choice_question", points_possible="2.5"),
                   rp=cond(("r1", "a"))))
    assert q.type == QType.MULTICHOICE and not q.multiple
    assert q.text.html == "<p>Capital of France?</p>"
    assert [(c.text.html, c.correct) for c in q.choices] == [("Paris", True), ("Rome", False)]
    assert q.points == 2.5 and q.id == "i1" and q.title == "Item 1"
    assert q.source_type == "multiple_choice_question"


def test_multiple_response_with_and_not():
    rp = ('<respcondition><conditionvar><and><varequal respident="r">a</varequal>'
          '<not><varequal respident="r">b</varequal></not><varequal respident="r">c</varequal></and>'
          '</conditionvar><setvar action="Set">100</setvar></respcondition>')
    q = parse(item(mat("Pick") + '<response_lid ident="r" rcardinality="Multiple"><render_choice>'
                   f"{labels(('a', 'A'), ('b', 'B'), ('c', 'C'))}</render_choice></response_lid>", rp=rp))
    assert q.type == QType.MULTICHOICE and q.multiple
    assert [c.correct for c in q.choices] == [True, False, True]


def test_multiple_label_sets_multiple():
    q = parse(item(mat("Pick") + f'<response_lid ident="r">{labels(("a", "A"), ("b", "B"))}</response_lid>',
                   metadata=meta(question_type="multiple_answers_question"), rp=cond(("r", "a"))))
    assert q.multiple


def test_correct_values_scoring_rules():
    root = parse_bytes(f"""<item><resprocessing>
      {cond(("r", "a"))}
      {cond(("r", "b"), score="0")}
      {cond(("r", "c"), score="0", title="correct")}
      {cond(("r", "d"), score="100", title="incorrect")}
      {cond(("r", "e"), score="SCORE.max")}
      <respcondition><conditionvar><or><varequal respident="r">f</varequal><varsubstring respident="r">g</varsubstring>
      </or></conditionvar><setvar action="Add">1</setvar></respcondition>
      <respcondition><conditionvar><varequal respident="r">a</varequal></conditionvar>
      <setvar action="Add">5</setvar></respcondition>
      <respcondition><setvar>1</setvar></respcondition>
      <respcondition><conditionvar><varequal respident="r">h</varequal></conditionvar>
      <setvar action="Subtract">5</setvar></respcondition>
    </resprocessing></item>""".encode())
    assert correct_values(root) == {"r": ["a", "c", "e", "f", "g"]}


def test_true_false_inferred_from_labels():
    q = parse(item(mat("Sky is blue") + f'<response_lid ident="r">{labels(("t", "True"), ("f", "False"))}'
                   "</response_lid>", rp=cond(("r", "t"))))
    assert q.type == QType.TRUEFALSE
    assert [c.correct for c in q.choices] == [True, False]


def test_true_false_label_with_wrong_choice_count_becomes_multichoice():
    q = parse(item(mat("?") + f'<response_lid ident="r">{labels(("a", "A"), ("b", "B"), ("c", "C"))}'
                   "</response_lid>", metadata=meta(question_type="true_false_question"), rp=cond(("r", "a"))))
    assert q.type == QType.MULTICHOICE


def test_unscoped_respident_counts_for_choices():
    rp = '<respcondition><conditionvar><varequal>b</varequal></conditionvar><setvar>1</setvar></respcondition>'
    q = parse(item(mat("?") + f'<response_lid ident="r">{labels(("a", "Yes"), ("b", "Maybe"))}</response_lid>',
                   rp=rp))
    assert [c.correct for c in q.choices] == [False, True]


def test_opinion_scale_without_correct_answer_is_description():
    body = mat("Rate") + f'<response_lid ident="r">{labels(("1", "Low"), ("2", "High"))}</response_lid>'
    q = parse(item(body, metadata="<itemmetadata><bbmd_questiontype>Opinion Scale</bbmd_questiontype></itemmetadata>"))
    assert q.type == QType.DESCRIPTION
    q = parse(item(body, metadata=meta(qmd_questiontype="Likert"), rp=cond(("r", "1"))))
    assert q.type == QType.MULTICHOICE


def test_label_without_material_uses_text():
    q = parse(item(mat("?") + '<response_lid ident="r"><response_label ident="a">plain &amp; text</response_label>'
                   '<response_label ident="b">B</response_label></response_lid>', rp=cond(("r", "a"))))
    assert q.choices[0].text.html == "plain &amp; text"


# ---------------------------------------------------------------------------
# Matching / ordering
# ---------------------------------------------------------------------------


def test_matching_via_multiple_response_lids():
    pool = labels(("p", "Paris"), ("m", "Madrid"), ("r", "Rome"))
    body = (mat("Match capitals") + f'<response_lid ident="fr">{mat("France")}<render_choice>{pool}</render_choice>'
            f'</response_lid><response_lid ident="es">{mat("Spain")}<render_choice>{pool}</render_choice>'
            '</response_lid>')
    q = parse(item(body, rp=cond(("fr", "p")) + cond(("es", "m"))))
    assert q.type == QType.MATCHING
    assert [(p.prompt.html, p.answer) for p in q.pairs] == [("France", "Paris"), ("Spain", "Madrid")]
    assert q.distractors == ["Rome"]
    assert q.text.html == "Match capitals"


def test_matching_via_response_grp_and_unreadable():
    body = mat("M") + f'<response_grp ident="g">{mat("Left")}{labels(("x", "X"))}</response_grp>'
    q = parse(item(body, metadata=meta(question_type="matching_question"), rp=cond(("g", "x"))))
    assert q.type == QType.MATCHING and q.pairs[0].answer == "X"
    q = parse(item(body, metadata=meta(question_type="matching_question")))
    assert q.type == QType.UNSUPPORTED and q.reason == "matching pairs could not be read"


def test_ordering():
    body = mat("Sort") + f'<response_lid ident="o">{labels(("1", "First"), ("2", "Second"), ("3", "Third"))}</response_lid>'
    q = parse(item(body, metadata=meta(question_type="ordering_question"),
                   rp=cond(("o", "2"), ("o", "1"), ("o", "3"), ("o", "zz"))))
    assert q.type == QType.ORDERING and q.ordering == ["Second", "First", "Third"]
    q = parse(item(body, metadata=meta(question_type="ordering_question")))
    assert q.ordering == ["First", "Second", "Third"]


# ---------------------------------------------------------------------------
# Text answers
# ---------------------------------------------------------------------------


def test_short_answer_and_case():
    body = mat("Name?") + '<response_str ident="s"><render_fib/></response_str>'
    rp = ('<respcondition><conditionvar><varequal respident="s" case="Yes">Ada</varequal>'
          '<varequal respident="s">ada</varequal><varequal respident="s">Ada</varequal>'
          '<varequal respident="s"></varequal></conditionvar><setvar>100</setvar></respcondition>')
    q = parse(item(body, rp=rp))
    assert q.type == QType.SHORTANSWER
    assert q.answers == ["Ada", "ada"] and q.case_sensitive
    q = parse(item(body, rp=cond(("s", "x"))))
    assert not q.case_sensitive


def test_short_answer_label_with_several_strings_becomes_cloze():
    body = mat("[a] and [b]") + '<response_str ident="a"/><response_str ident="b"/>'
    q = parse(item(body, metadata=meta(question_type="short_answer_question"), rp=cond(("a", "1")) + cond(("b", "2"))))
    assert q.type == QType.CLOZE
    assert [b.answers for b in q.blanks] == [["1"], ["2"]]
    assert q.text.html == "{{1}} and {{2}}"


def test_fill_in_multiple_blanks_with_names_hides_accepted_answers():
    body = (mat("<p>Roses are [color1], violets are [color2]. [sic]</p>", "text/html")
            + f'<response_lid ident="response_color2">{mat("color2")}<render_choice>'
            f"{labels(('b1', 'blue'), ('b2', 'Blue'))}</render_choice></response_lid>"
            f'<response_lid ident="response_color1">{mat("color1")}<render_choice>'
            f"{labels(('r1', 'red'))}</render_choice></response_lid>")
    rp = cond(("response_color2", "b1")) + cond(("response_color2", "b2")) + cond(("response_color1", "r1"))
    q = parse(item(body, metadata=meta(question_type="fill_in_multiple_blanks_question"), rp=rp))
    assert q.type == QType.CLOZE
    assert q.text.html == "<p>Roses are {{1}}, violets are {{2}}. [sic]</p>"
    assert [b.answers for b in q.blanks] == [["red"], ["blue", "Blue"]]
    assert [b.choices for b in q.blanks] == [[], []]


def test_dropdowns_keep_choices():
    body = (mat("Pick [d1]") + f'<response_lid ident="response_d1">{mat("d1")}'
            f"{labels(('x', 'yes'), ('y', 'no'))}</response_lid>")
    q = parse(item(body, metadata=meta(question_type="multiple_dropdowns_question"), rp=cond(("response_d1", "x"))))
    assert q.blanks[0].answers == ["yes"] and q.blanks[0].choices == ["yes", "no"]
    assert q.text.html == "Pick {{1}}"


def test_cloze_names_without_material_use_ident_and_extra_blanks():
    body = (mat("A [one]") + '<response_lid ident="response_one"><response_label ident="1">x</response_label>'
            '<response_label ident="2">z</response_label></response_lid>'
            '<response_lid ident="two"><response_label ident="3">y</response_label>'
            '<response_label ident="4">w</response_label></response_lid>')
    q = parse(item(body, metadata=meta(question_type="multiple_dropdowns_question"),
                   rp=cond(("response_one", "1")) + cond(("two", "3"))))
    assert q.text.html == "A {{1}} {{2}}"
    assert [b.answers for b in q.blanks] == [["x"], ["y"]]


def test_cloze_unknown_names_fall_back_to_text_order():
    body = mat("[p] then [q]") + '<response_str ident="s1"/><response_str ident="s2"/>'
    q = parse(item(body, rp=cond(("s1", "a")) + cond(("s2", "b"))))
    assert q.type == QType.CLOZE and q.text.html == "{{1}} then {{2}}"


def test_cloze_markers_appended_or_kept():
    body = mat("No markers") + '<response_str ident="s1"/><response_str ident="s2"/>'
    q = parse(item(body, rp=cond(("s1", "a"))))
    assert q.text.html == "No markers {{1}} {{2}}"
    body = mat("Has {{1}} and {{2}}") + '<response_str ident="s1"/><response_str ident="s2"/>'
    assert parse(item(body)).text.html == "Has {{1}} and {{2}}"


def test_cloze_label_without_responses_is_unsupported():
    q = parse(item(mat("Gap"), metadata=meta(question_type="fill_in_multiple_blanks_question")))
    assert q.type == QType.UNSUPPORTED


# ---------------------------------------------------------------------------
# Numeric
# ---------------------------------------------------------------------------


def test_numeric_exact_and_range():
    body = mat("g?") + '<response_num ident="n"><render_fib fibtype="Decimal"/></response_num>'
    rp = (cond(("n", "9.81"))
          + '<respcondition><conditionvar><or><varequal respident="n">5</varequal><and>'
            '<vargte respident="n">4.5</vargte><varlte respident="n">5.5</varlte></and></or></conditionvar>'
            '<setvar>100</setvar></respcondition>'
          + cond(("n", "abc"))
          + cond(("n", "1"), score="0")
          + '<respcondition><setvar>100</setvar></respcondition>'
          + '<respcondition><conditionvar><varequal respident="n"> </varequal></conditionvar>'
            '<setvar>100</setvar></respcondition>')
    q = parse(item(body, rp=rp))
    assert q.type == QType.NUMERICAL
    assert [(a.value, a.tolerance) for a in q.numeric] == [(9.81, 0.0), (5.0, 0.5)]


def test_numeric_without_answer_is_unsupported():
    q = parse(item(mat("?") + '<response_num ident="n"/>'))
    assert q.type == QType.UNSUPPORTED and q.reason == "no numeric answer"


def test_numerical_label_with_score_max():
    body = mat("?") + '<response_str ident="n"/>'
    rp = ('<respcondition title="correct"><conditionvar><varequal respident="n">42</varequal></conditionvar>'
          '<setvar variablename="SCORE" action="Set">SCORE.max</setvar></respcondition>')
    q = parse(item(body, metadata="<itemmetadata><bbmd_questiontype>Numeric</bbmd_questiontype></itemmetadata>",
                   rp=rp))
    assert q.type == QType.NUMERICAL and q.numeric[0].value == 42.0


# ---------------------------------------------------------------------------
# Essay, upload, text only, unknown
# ---------------------------------------------------------------------------


def test_essay_file_upload_text_only():
    essay = parse(item(mat("Discuss") + '<response_str ident="e"/>', metadata=meta(question_type="essay_question")))
    assert essay.type == QType.ESSAY and essay.allow_text
    up = parse(item(mat("Upload"), metadata=meta(question_type="file_upload_question")))
    assert up.type == QType.FILE_UPLOAD and up.allow_attachments and not up.allow_text
    text_only = parse(item(mat("Read me"), metadata=meta(question_type="text_only_question")))
    assert text_only.type == QType.DESCRIPTION
    bare = parse(item(mat("No responses")))
    assert bare.type == QType.DESCRIPTION


def test_unknown_types_are_unsupported():
    q = parse(item(mat("?"), metadata=meta(question_type="hot_spot_question")))
    assert q.type == QType.UNSUPPORTED and q.reason == "question structure not recognized"
    assert q.source_type == "hot_spot_question"
    q = parse(item(mat("?"), metadata="<itemmetadata><bbmd_questiontype>Hot Spot</bbmd_questiontype></itemmetadata>"))
    assert q.type == QType.UNSUPPORTED


def test_choice_label_without_responses_is_unsupported():
    q = parse(item(mat("?"), metadata=meta(question_type="multiple_choice_question")))
    assert q.type == QType.UNSUPPORTED


def test_item_without_presentation():
    q = parse_item(parse_bytes(b'<item ident="x"><resprocessing/></item>'))
    assert q.text.html == "" and q.type == QType.DESCRIPTION


def test_presentation_flow_nesting():
    xml = item('<flow><flow>' + mat("<p>Deep</p>", "text/html") + '</flow><response_lid ident="r">'
               + mat("NOT QUESTION TEXT") + labels(("a", "A"), ("b", "B")) + "</response_lid></flow>",
               rp=cond(("r", "a")))
    q = parse(xml)
    assert q.text.html == "<p>Deep</p>"


def test_points_fallbacks():
    assert parse(item(mat("?"), metadata=meta(cc_weighting="4"))).points == 4.0
    # An explicit 0 is a real value (an ungraded Canvas question), not a missing one
    assert parse(item(mat("?"), metadata=meta(points_possible="0"))).points == 0.0
    assert parse(item(mat("?"), metadata=meta(points_possible="0", qmd_weighting="5"))).points == 0.0
    assert parse(item(mat("?"), metadata=meta(cc_weighting="0.0"))).points == 0.0
    # Unparsable, negative or non-finite explicit values fall back
    assert parse(item(mat("?"), metadata=meta(points_possible="abc"))).points == 1.0
    assert parse(item(mat("?"), metadata=meta(points_possible="-2", bbmd_points="3"))).points == 3.0
    assert parse(item(mat("?"), metadata=meta(points_possible="1e999"))).points == 1.0
    # Blackboard writes qmd_weighting as 0.0 next to the real points: first positive fallback wins
    assert parse(item(mat("?"), metadata=meta(qmd_weighting="0.0", qmd_absolutescore_max="10"))).points == 10.0
    assert parse(item(mat("?"), metadata=meta(qmd_weighting="inf"))).points == 1.0


def test_non_finite_numeric_answers_are_dropped():
    body = mat("?") + '<response_num ident="n" rcardinality="Single"><render_fib/></response_num>'
    md = meta(question_type="numerical_question")
    inf = parse(item(body, metadata=md, rp=cond(("n", "1e999"))))
    assert inf.type == QType.UNSUPPORTED and inf.reason == "no numeric answer"
    rng = ('<respcondition><conditionvar><vargte respident="n">inf</vargte><varlte respident="n">5</varlte>'
           '</conditionvar><setvar action="Set" varname="SCORE">100</setvar></respcondition>')
    q = parse(item(body, metadata=md, rp=rng + cond(("n", "4"))))
    assert q.type == QType.NUMERICAL and [(a.value, a.tolerance) for a in q.numeric] == [(4.0, 0.0)]


def test_formula_question_rejects_non_finite_values():
    def calc(answer: str, tolerance: str) -> str:
        return (f"<itemproc_extension><calculated><answer_tolerance>{tolerance}</answer_tolerance><var_sets>"
                f'<var_set ident="1"><var name="x">4</var><answer>{answer}</answer></var_set></var_sets>'
                "</calculated></itemproc_extension>")

    body = mat("5 plus [x]?") + '<response_str ident="r"><render_fib fibtype="Decimal"/></response_str>'
    md = meta(question_type="calculated_question")
    bad = parse(item(body, metadata=md, extra=calc("inf", "5%")))
    assert bad.type == QType.UNSUPPORTED and bad.reason == "formula question without a numeric answer"
    tol = parse(item(body, metadata=md, extra=calc("9", "1e999")))
    assert tol.type == QType.NUMERICAL and (tol.numeric[0].value, tol.numeric[0].tolerance) == (9.0, 0.0)
    # A percentage of a huge answer overflows to infinity: no tolerance rather than an unstorable one
    big = parse(item(body, metadata=md, extra=calc("1e308", "1e300%")))
    assert big.type == QType.NUMERICAL and (big.numeric[0].value, big.numeric[0].tolerance) == (1e308, 0.0)


# ---------------------------------------------------------------------------
# Feedback
# ---------------------------------------------------------------------------


def test_general_feedback_only():
    extra = (f'<itemfeedback ident="general_fb">{mat("General")}</itemfeedback>'
             f'<itemfeedback ident="correct_fb">{mat("Right")}</itemfeedback>'
             f'<itemfeedback ident="general_incorrect_fb">{mat("Wrong")}</itemfeedback>'
             f'<itemfeedback ident="a_fb">{mat("Per answer")}</itemfeedback>'
             f"<itemfeedback>{mat('No ident')}</itemfeedback>"
             f'<itemfeedback ident="solution"><solution><solutionmaterial>{mat("Sol")}</solutionmaterial>'
             "</solution></itemfeedback>"
             f'<itemfeedback ident="x"><solution>{mat("Standalone")}</solution></itemfeedback>')
    q = parse(item(mat("?"), extra=extra))
    assert q.general_feedback == "GeneralNo identSolStandalone"


# ---------------------------------------------------------------------------
# Hooks
# ---------------------------------------------------------------------------


def test_type_hook_and_material_hook():
    seen: list[QtiItem] = []

    def type_hook(raw: QtiItem):
        seen.append(raw)
        return QType.ESSAY if raw.ident == "i1" else None

    q = parse(item(mat("x") + '<response_str ident="s"/>', metadata=meta(question_type="short_answer_question")),
              type_hook=type_hook)
    assert q.type == QType.ESSAY and q.source_type == "short_answer_question"
    assert seen[0].title == "Item 1" and seen[0].meta["question_type"] == "short_answer_question"
    q = parse(item(mat("x") + '<response_str ident="s"/>', ident="i2"), type_hook=type_hook)
    assert q.type == QType.SHORTANSWER

    q = parse(item(mat("orig")), material_hook=lambda el: "<p>hooked</p>")
    assert q.text.html == "<p>hooked</p>"


def test_resolver_is_attached_to_question_and_choices():
    def resolve(url):
        return Asset(path="/x", name=url)

    q = parse(item(mat("?") + f'<response_lid ident="r">{labels(("a", "A"), ("b", "B"))}</response_lid>',
                   rp=cond(("r", "a"))), resolve=resolve)
    assert q.text.resolve is resolve and q.choices[0].text.resolve is resolve


# ---------------------------------------------------------------------------
# Assessments and banks
# ---------------------------------------------------------------------------


def test_parse_assessment_with_rubric_and_sections():
    root = parse_bytes(f"""<questestinterop>
      <assessment ident="A1" title="Midterm">
        <rubric>{mat("<p>Read carefully</p>", "text/html")}</rubric>
        <presentation_material><flow_mat>{mat("Good luck")}</flow_mat></presentation_material>
        <section ident="root"><section ident="s2">{item(mat("Q1"), ident="q1")}</section>
          {item(mat("Q2"), ident="q2")}</section>
      </assessment>
      <assessment ident="A2" title="Second">{item(mat("Q3"), ident="q3")}</assessment>
    </questestinterop>""".encode())
    a1, a2 = parse_assessment(root)
    assert (a1.ident, a1.title) == ("A1", "Midterm")
    assert a1.intro_html == "<p>Read carefully</p>Good luck"
    assert [q.id for q in a1.questions] == ["q1", "q2"]
    assert a2.intro_html == "" and [q.id for q in a2.questions] == ["q3"]


def test_parse_assessment_presentation_material_only():
    root = parse_bytes(f"""<questestinterop><assessment ident="A"><presentation_material>{mat("Intro")}
      </presentation_material></assessment></questestinterop>""".encode())
    assert parse_assessment(root)[0].intro_html == "Intro"


def test_item_bank_without_assessment():
    root = parse_bytes(f"""<questestinterop><objectbank ident="bank1" title="Bank">
      {item(mat("B1"), ident="b1")}{item(mat("B2"), ident="b2")}</objectbank></questestinterop>""".encode())
    banks = parse_assessment(root)
    assert len(banks) == 1
    assert [q.id for q in banks[0].questions] == ["b1", "b2"]
    bank_root = parse_bytes(f'<objectbank ident="b" title="T">{item(mat("x"))}</objectbank>'.encode())
    assert parse_assessment(bank_root)[0].title == "T"


def test_empty_document():
    assert parse_assessment(parse_bytes(b"<questestinterop/>")) == []


def test_infer_type_branches():
    assert qti._infer_type([], [], [], [], "") == QType.DESCRIPTION
    assert qti._infer_type([], [], [], [], "text_only") == QType.DESCRIPTION
    assert qti._infer_type([], [], [], [], "weird") == QType.UNSUPPORTED
    assert qti._infer_type([], [], [], [object()], "") == QType.MATCHING


def test_looks_html():
    assert qti._looks_html("a <b>bold</b>")
    assert not qti._looks_html("x < y and y > z")
    assert not qti._looks_html("if x < b then")
    assert qti._looks_html("line</p>")
    assert not qti._looks_html("")


def test_strip_names_image_only_answers():
    assert qti._strip("<p>Paris</p>") == "Paris"
    assert qti._strip('<img src="x/cat.png" alt="A cat">') == "A cat"
    # An image the text pass drops (icon-font class) is still named after its alt
    assert qti._strip('<img class="fa" src="x/paw.png" alt="A paw">') == "A paw"
    assert qti._strip('<img src="https://h/files/dog.png?verifier=1">') == "Image: dog.png"
    assert qti._strip("") == ""
