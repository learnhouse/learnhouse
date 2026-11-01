"""
Blackboard Learn reader.

The synthetic packages below follow real Blackboard Learn course archives and
exports (Learn 9.1 / SaaS 3900+, Original and Ultra course views): an
``imsmanifest.xml`` with ``bb:file``/``bb:title`` resources and the course menu
as organization items, ``resNNNNN.dat`` records (COURSE, COURSETOC, CONTENT,
LINK, COURSEASSESSMENT, GRADEBOOK, STAFFINFO), Content Collection files under
``csfiles/home_dir`` named ``name__xid-NNN_1.ext`` with their ``.xml`` LOM
sidecar, and Blackboard's QTI 1.2 dialect (``bbmd_questiontype``,
``mat_formattedtext``, QUESTION_BLOCK / RESPONSE_BLOCK / RIGHT_MATCH_BLOCK
flows) as in the Blackboard fixtures shipped with Canvas' QTI importer.
"""

from __future__ import annotations

import json
import os
import zipfile
from html import escape

import pytest

from src.services.courses.lms_import import ir
from src.services.courses.lms_import.convert import convert, detect as detect_all
from src.services.courses.lms_import.package import ConvertOptions
from src.services.courses.lms_import.sources import blackboard as bb
from src.services.courses.lms_import.xmlutil import parse_bytes

PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
MP4 = b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 32
PACKAGE_INFO = (
    "#Bb PackageInfo Property File\n"
    "app.release.number=3900.0.0-rel.1+abc\n"
    "cx.config.operation=blackboard.apps.cx.CxConfig$Operation\\:ARCHIVE\n"
    "cx.package.info.version=6.0\n"
)


# ---------------------------------------------------------------------------
# Package builder
# ---------------------------------------------------------------------------


def write(root, rel: str, data) -> str:
    path = os.path.join(str(root), *rel.split("/"))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data.encode("utf-8") if isinstance(data, str) else data)
    return path


class Pkg:
    """Writes a Blackboard package: resources, Content Collection files, manifest."""

    def __init__(self, root):
        self.root = str(root)
        self.resources: list[tuple[str, str, str, tuple]] = []
        self.n = 0
        write(self.root, ".bb-package-info", PACKAGE_INFO)

    def res(self, rtype: str, xml: str, title: str = "", hrefs: tuple = ()) -> str:
        self.n += 1
        ident = f"res{self.n:05d}"
        write(self.root, f"{ident}.dat", '<?xml version="1.0" encoding="UTF-8"?>\n' + xml)
        self.resources.append((ident, rtype, title, hrefs))
        return ident

    def csfile(self, xid: str, name: str, data: bytes, folder: str = "", stem: str = "") -> str:
        ext = os.path.splitext(name)[1]
        rel = f"csfiles/home_dir/{folder + '/' if folder else ''}{stem}__xid-{xid}{ext}"
        write(self.root, rel, data)
        write(self.root, rel + ".xml",
              '<?xml version="1.0" encoding="UTF-8"?><lom xmlns="http://www.imsglobal.org/xsd/imsmd_rootv1p2p1">'
              f'<relation><resource><identifier>{xid}#/courses/BB101/{escape(name)}</identifier></resource>'
              '</relation></lom>')
        return rel

    def manifest(self, tree: list) -> None:
        def item(node, counter=[0]):
            ref, title, kids = node
            counter[0] += 1
            inner = "".join(item(k) for k in kids)
            return (f'<item identifier="itm{counter[0]:05d}" identifierref="{ref}"><title>{escape(title)}</title>'
                    f'{inner}</item>')

        orgs = "".join(item(n) for n in tree)
        resources = "".join(
            f'<resource bb:file="{i}.dat" bb:title="{escape(t)}" identifier="{i}" type="{rt}" xml:base="{i}">'
            + "".join(f'<file href="{escape(h)}"/>' for h in hrefs) + "</resource>"
            for i, rt, t, hrefs in self.resources
        )
        write(self.root, "imsmanifest.xml",
              '<?xml version="1.0" encoding="UTF-8"?>\n<manifest identifier="man00001" '
              'xmlns:bb="http://www.blackboard.com/content-packaging/"><organizations default="toc00001">'
              f'<organization identifier="toc00001">{orgs}</organization></organizations>'
              f'<resources>{resources}</resources></manifest>')


def course_xml(title="Biology 101", desc="<p>Cells &amp; <b>life</b>.</p>", banner="/xid-500_1", extra=""):
    return (f'<COURSE id="_35811_1"><COURSEID value="BIO101_F24"/><TITLE value="{escape(title)}"/>'
            f'<DESCRIPTION>{escape(desc)}</DESCRIPTION><FLAGS><ISAVAILABLE value="true"/></FLAGS>'
            f'<BANNER value="{banner}"/><LOCALE value="en_US"/>{extra}</COURSE>')


def toc_xml(label, target="CONTENT", url="", enabled=True, handle="content"):
    return (f'<COURSETOC id="_4421_1"><LABEL value="{escape(label)}"/><URL value="{escape(url)}"/>'
            f'<TARGETTYPE value="{target}"/><INTERNALHANDLE value="{handle}"/><FLAGS>'
            f'<LAUNCHINNEWWINDOW value="false"/><ISENABLED value="{str(enabled).lower()}"/></FLAGS></COURSETOC>')


def content_xml(cid, title, handler="resource/x-bb-document", body="", parent="_1_1", available=True, url="",
                files=(), folder_type="", description="", is_folder=False, extended=""):
    file_xml = "".join(
        f'<FILE id="_f{i}_1"><NAME>{escape(name)}</NAME><SIZE value="10"/><FILEACTION value="LINK"/>'
        f'<LINKNAME value="{escape(link)}"/><STORAGETYPE value="CS"/></FILE>'
        for i, (name, link) in enumerate(files)
    )
    text = f"<TEXT>{escape(body)}</TEXT>" if body else "<TEXT/>"
    return (f'<CONTENT id="{cid}"><TITLE value="{escape(title)}"/><TITLECOLOR value="#000000"/>'
            f'<DESCRIPTION value="{escape(description)}"/><BODY>{text}<TYPE value="H"/></BODY>'
            '<DATES><CREATED value="2023-01-31 09:17:06 AWST"/><START value=""/><END value=""/></DATES>'
            f'<FLAGS><ISAVAILABLE value="{str(available).lower()}"/><ISFOLDER value="{str(is_folder).lower()}"/>'
            f'</FLAGS><CONTENTHANDLER value="{handler}"/><RENDERTYPE value="REGULAR"/>'
            f'<FOLDERTYPE value="{folder_type}"/><URL value="{escape(url)}"/><LINKREF value=""/>'
            f'<PARENTID value="{parent}"/><EXTENDEDDATA>{extended}</EXTENDEDDATA><FILES>{file_xml}</FILES></CONTENT>')


def link_xml(referrer, to, to_type):
    return (f'<LINK id="_2739_1"><TITLE value=""/><FLAGS><ISAVAILABLE value="true"/></FLAGS>'
            f'<REFERRER id="{referrer}" type="CONTENT"/><REFERREDTO id="{to}" type="{to_type}"/></LINK>')


def course_assessment_xml(asmt, attempts="3", multiple=True, unlimited=False, time_limit="30", show=True,
                          randomize=True, access_code="", feedback=""):
    return (f'<COURSEASSESSMENT id="_127999_1"><ASMTID value="{asmt}"/><DELIVERYTYPE value="ALL_AT_ONCE"/>'
            f'<PASSWORD value="{access_code}"/><TIMELIMIT value="{time_limit}"/><ATTEMPTCOUNT value="{attempts}"/>'
            f'<FEEDBACKSETTINGS value="{feedback}"/><FLAGS>'
            f'<ALLOWMULTIPLEATTEMPTS value="{str(multiple).lower()}"/>'
            f'<ISUNLIMITEDATTEMPTS value="{str(unlimited).lower()}"/>'
            f'<SHOWCORRECTANSWER value="{str(show).lower()}"/>'
            f'<RANDOMIZEQUESTIONS value="{str(randomize).lower()}"/></FLAGS></COURSEASSESSMENT>')


def gradebook_xml(rows):
    defs = "".join(
        f'<OUTCOMEDEFINITION id="_43{i}_1"><CATEGORYID value="_1_1"/><CONTENTID value="{content}"/>'
        f'<ASIDATAID value="{asi}"/><DATES><CREATED value=""/><DUE value="{due}"/></DATES>'
        f'<TITLE value="Column {i}"/><POINTSPOSSIBLE value="{points}"/><OUTCOMES/></OUTCOMEDEFINITION>'
        for i, (content, asi, due, points) in enumerate(rows)
    )
    return f"<GRADEBOOK><CATEGORIES/><OUTCOMEDEFINITIONS>{defs}</OUTCOMEDEFINITIONS></GRADEBOOK>"


# ---------------------------------------------------------------------------
# QTI builders (Blackboard dialect)
# ---------------------------------------------------------------------------


def ftext(value: str, kind: str = "HTML") -> str:
    return (f'<flow class="FORMATTED_TEXT_BLOCK"><material><mat_extension>'
            f'<mat_formattedtext type="{kind}">{escape(value)}</mat_formattedtext></mat_extension></material></flow>')


def labels_xml(options, plain=False):
    out = ""
    for ident, value in options:
        if plain:
            inner = (f'<flow_mat class="Block"><material><mattext charset="us-ascii" texttype="text/plain">'
                     f'{escape(value)}</mattext></material></flow_mat>')
        else:
            inner = (f'<flow_mat class="FORMATTED_TEXT_BLOCK"><material><mat_extension><mat_formattedtext '
                     f'type="HTML">{escape(value)}</mat_formattedtext></mat_extension></material></flow_mat>')
        out += (f'<flow_label class="Block"><response_label ident="{ident}" rarea="Ellipse" rrange="Exact" '
                f'shuffle="Yes">{inner}</response_label></flow_label>')
    return out


def choice_response(options, cardinality="Single", ident="response", plain=False):
    return (f'<response_lid ident="{ident}" rcardinality="{cardinality}" rtiming="No">'
            f'<render_choice maxnumber="0" minnumber="0" shuffle="No">{labels_xml(options, plain)}</render_choice>'
            '</response_lid>')


def fib_response(ident="response", tag="response_str"):
    return (f'<{tag} ident="{ident}" rcardinality="Single" rtiming="No"><render_fib charset="us-ascii" '
            f'columns="0" encoding="UTF_8" fibtype="String" prompt="Box" rows="0"/></{tag}>')


def correct_cond(inner: str, title="correct", score="SCORE.max", feedback="correct") -> str:
    setvar = f'<setvar action="Set" variablename="SCORE">{score}</setvar>' if score is not None else ""
    return (f'<respcondition title="{title}"><conditionvar>{inner}</conditionvar>{setvar}'
            f'<displayfeedback feedbacktype="Response" linkrefid="{feedback}"/></respcondition>')


INCORRECT = ('<respcondition title="incorrect"><conditionvar><other/></conditionvar>'
             '<setvar action="Set" variablename="SCORE">0.0</setvar>'
             '<displayfeedback feedbacktype="Response" linkrefid="incorrect"/></respcondition>')


def veq(value, respident="response", case="No"):
    return f'<varequal case="{case}" respident="{respident}">{escape(value)}</varequal>'


def item_xml(qtype, question, response, conditions, oid="_154767_1", score="10.0", question_extra="", right="",
             feedback="", extension=""):
    return (
        f'<item maxattempts="0"><itemmetadata><bbmd_asi_object_id>{oid}</bbmd_asi_object_id>'
        f'<bbmd_asitype>Item</bbmd_asitype><bbmd_assessmenttype>Test</bbmd_assessmenttype>'
        f'<bbmd_questiontype>{escape(qtype)}</bbmd_questiontype><qmd_absolutescore_max>{score}'
        f'</qmd_absolutescore_max><qmd_weighting>0.0</qmd_weighting></itemmetadata>'
        f'<presentation><flow class="Block"><flow class="QUESTION_BLOCK">{ftext(question)}{question_extra}</flow>'
        f'<flow class="RESPONSE_BLOCK">{response}</flow>{right}</flow></presentation>'
        f'<resprocessing scoremodel="SumOfScores"><outcomes><decvar defaultval="0.0" maxvalue="{score}" '
        f'minvalue="0.0" varname="SCORE" vartype="Decimal"/></outcomes>{conditions}{INCORRECT}</resprocessing>'
        f'<itemfeedback ident="correct" view="All"><flow_mat class="Block">{ftext("right").replace("flow ", "flow_mat ").replace("</flow>", "</flow_mat>")}</flow_mat></itemfeedback>'
        f'{feedback}{extension}</item>'
    )


def mc_item(**kw):
    options = [("a1", "nose"), ("a2", "ear"), ("a3", "eye"), ("a4", "")]
    return item_xml("Multiple Choice", "The answer is nose.<br />", choice_response(options),
                    correct_cond(veq("a1")), **kw)


def assessment_xml(title, items, desc="<p>Read carefully.</p>", oid="_900_1", sections=""):
    return (f'<questestinterop><assessment title="{escape(title)}"><assessmentmetadata>'
            f'<bbmd_asi_object_id>{oid}</bbmd_asi_object_id><bbmd_asitype>Assessment</bbmd_asitype>'
            f'<bbmd_assessmenttype>Test</bbmd_assessmenttype><qmd_absolutescore_max>20.0</qmd_absolutescore_max>'
            f'</assessmentmetadata><rubric view="All"><flow_mat class="Block"><material><mat_extension>'
            f'<mat_formattedtext type="HTML"/></mat_extension></material></flow_mat></rubric>'
            f'<presentation_material><flow_mat class="Block"><material><mat_extension>'
            f'<mat_formattedtext type="HTML">{escape(desc)}</mat_formattedtext></mat_extension></material>'
            f'</flow_mat></presentation_material><section><sectionmetadata><bbmd_asitype>Section</bbmd_asitype>'
            f'</sectionmetadata>{"".join(items)}{sections}</section></assessment></questestinterop>')


def parse(item: str, warnings=None) -> ir.Question:
    sink = warnings if warnings is not None else []
    parser = bb._QtiParser(lambda h: h, sink.append)
    return parser.question(parse_bytes(item.encode("utf-8")), ir.no_resolver)


# ---------------------------------------------------------------------------
# Detection and dates
# ---------------------------------------------------------------------------


def test_detect_archive_with_package_info(tmp_path):
    pkg = Pkg(tmp_path)
    pkg.res("course/x-bb-coursesetting", course_xml())
    pkg.manifest([])
    assert bb.detect(str(tmp_path)) == 95
    assert detect_all(str(tmp_path))[0].key == "blackboard"


def test_detect_variants(tmp_path):
    assert bb.detect(str(tmp_path / "missing")) == 0
    assert bb.detect(str(tmp_path)) == 0
    write(tmp_path, "imsmanifest.xml", '<manifest><resources><resource type="resource/x-bb-document"/></resources>'
                                       '</manifest>')
    assert bb.detect(str(tmp_path)) == 95
    write(tmp_path, "imsmanifest.xml",
          '<manifest xmlns:bb="http://www.blackboard.com/content-packaging/"><resources/></manifest>')
    assert bb.detect(str(tmp_path)) == 80
    write(tmp_path, "imsmanifest.xml",
          '<manifest xmlns="http://www.imsglobal.org/xsd/imsccv1p1/imscp_v1p1"><resources/></manifest>')
    assert bb.detect(str(tmp_path)) == 0
    write(tmp_path, ".bb-package-info", PACKAGE_INFO)
    assert bb.detect(str(tmp_path)) == 20  # Blackboard-made Common Cartridge


@pytest.mark.parametrize("value,expected", [
    ("2024-01-22 11:57:58 AWST", "2024-01-22T11:57:58+08:00"),
    ("2016-10-26 15:04:37 CDT", "2016-10-26T15:04:37-05:00"),
    ("2026-08-28 14:37:23 BRT", "2026-08-28T14:37:23-03:00"),
    ("2024-03-01 08:00 -0430", "2024-03-01T08:00:00-04:30"),
    ("2024-03-01 08:00:00 +05:30", "2024-03-01T08:00:00+05:30"),
    ("2024-03-01 08:00:00 XYZ", "2024-03-01T08:00:00+00:00"),
    ("2024-03-01T08:00:00", "2024-03-01T08:00:00+00:00"),
    ("2024-03-01", "2024-03-01T00:00:00+00:00"),
    ("2024-13-45 99:00:00 EST", None),
    ("", None),
    (None, None),
    ("soon", None),
])
def test_bb_date(value, expected):
    assert bb.bb_date(value) == expected


# ---------------------------------------------------------------------------
# Questions
# ---------------------------------------------------------------------------


def test_multiple_choice_drops_empty_slots_and_uses_max_score():
    q = parse(mc_item())
    assert q.type == ir.QType.MULTICHOICE and not q.multiple
    assert [(c.text.html, c.correct) for c in q.choices] == [("nose", True), ("ear", False), ("eye", False)]
    assert q.points == 10.0 and q.source_type == "multiple choice" and q.id == "_154767_1"
    assert q.text.html == "The answer is nose.<br />"


def test_multiple_answer_and_partial_conditions():
    options = [("h", "house"), ("g", "garage"), ("b", "barn")]
    cond = correct_cond(f"<and>{veq('h')}{veq('g')}<not>{veq('b')}</not></and>")
    q = parse(item_xml("Multiple Answer", "Pick", choice_response(options, "Multiple"), cond))
    assert q.multiple and [c.correct for c in q.choices] == [True, True, False]


def test_ultra_relabelled_choices_map_by_position():
    options = [("new_1", "<p>No late policy</p>"), ("new_2", "<p>48 hours</p>")]
    cond = correct_cond(f"<and><not>{veq('orig1')}</not>{veq('orig2')}</and>")
    per_choice = "".join(
        f'<respcondition><conditionvar><varequal case="No" respident="{o}"/></conditionvar>'
        f'<setvar action="Set" variablename="SCORE">0</setvar></respcondition>' for o in ("orig1", "orig2"))
    q = parse(item_xml("Multiple Choice", "Late policy?", choice_response(options), cond + per_choice))
    assert [c.correct for c in q.choices] == [False, True]


def test_true_false_and_either_or_labels():
    tf = parse(item_xml("True/False", "Sky is blue", choice_response([("true", "true"), ("false", "false")],
                                                                     plain=True), correct_cond(veq("true"))))
    assert tf.type == ir.QType.TRUEFALSE
    assert [(c.text.html, c.correct) for c in tf.choices] == [("True", True), ("False", False)]
    eo = parse(item_xml("Either/Or", "Agree?", choice_response(
        [("agree_disagree.true", "agree_disagree.true"), ("agree_disagree.false", "agree_disagree.false")],
        plain=True), correct_cond(veq("agree_disagree.false"))))
    assert eo.type == ir.QType.MULTICHOICE
    assert [(c.text.html, c.correct) for c in eo.choices] == [("Agree", False), ("Disagree", True)]


def test_choice_question_without_choices_is_unsupported():
    q = parse(item_xml("Multiple Choice", "Nothing", "", ""))
    assert q.type == ir.QType.UNSUPPORTED and q.reason
    empty = parse(item_xml("Multiple Choice", "Blank", choice_response([("a", ""), ("b", "")]),
                           correct_cond(veq("a"))))
    assert empty.type == ir.QType.UNSUPPORTED


def test_opinion_scale_becomes_description():
    q = parse(item_xml("Opinion Scale", "You love Blackboard", choice_response(
        [("1", "Strongly Agree"), ("2", "Disagree")]), correct_cond(veq("1"))))
    assert q.type == ir.QType.DESCRIPTION and q.points == 0 and not q.choices
    assert "<li>Strongly Agree</li>" in q.text.html


def test_fill_in_the_blank_accepts_every_correct_condition():
    conds = (correct_cond(veq("purple"), title="d963", score=None)
             + correct_cond(veq("violet", case="Yes"), title="e1bd", score=None)
             + correct_cond('<varsubstring case="No" respident="response">lilac</varsubstring>', title="x",
                            score="5"))
    q = parse(item_xml("Fill in the Blank", "The answer is purple.", fib_response(), conds))
    assert q.type == ir.QType.SHORTANSWER
    assert q.answers == ["purple", "violet", "*lilac*"] and q.case_sensitive
    none = parse(item_xml("Fill in the Blank", "No key", fib_response(), ""))
    assert none.type == ir.QType.UNSUPPORTED


def test_quiz_bowl_keeps_phrases_only():
    cond = correct_cond('<and><or><varsubstring case="No">a yellow submarine</varsubstring></or>'
                        '<or><varsubstring case="No">What</varsubstring><varsubstring case="No">Who</varsubstring>'
                        '</or></and>')
    q = parse(item_xml("Quiz Bowl", "Where we all live", fib_response(), cond))
    assert q.type == ir.QType.SHORTANSWER and q.answers == ["*a yellow submarine*"]
    assert "form of a question" in q.text.html


def test_quiz_bowl_without_phrase_groups_has_no_answer():
    # The accepted phrases live in <or> groups; a key written as a plain varequal yields none
    q = parse(item_xml("Quiz Bowl", "Where we all live", fib_response(), correct_cond(veq("a yellow submarine"))))
    assert q.type == ir.QType.UNSUPPORTED and q.reason == "no accepted answer" and q.answers == []
    assert "form of a question" not in q.text.html


def test_scoring_conditions_that_do_not_mark_a_choice():
    options = [("a1", "nose"), ("a2", "ear"), ("a3", "eye")]
    conds = (
        # an empty varequal in the key is skipped
        correct_cond(veq("a1") + veq(""))
        # a non-SCORE counter is not a score
        + f'<respcondition><conditionvar>{veq("a2")}</conditionvar>'
          '<setvar action="Add" variablename="ATTEMPTS">1</setvar>'
          '<setvar action="Set" variablename="SCORE">0.0</setvar>'
          '<displayfeedback feedbacktype="Response" linkrefid="incorrect"/></respcondition>'
        # an untitled catch-all and a condition without a conditionvar never make an answer right
        + '<respcondition><conditionvar><other/></conditionvar>'
          '<setvar action="Set" variablename="SCORE">SCORE.max</setvar></respcondition>'
        + '<respcondition><setvar action="Set" variablename="SCORE">SCORE.max</setvar></respcondition>'
    )
    q = parse(item_xml("Multiple Choice", "Which?", choice_response(options), conds))
    assert q.type == ir.QType.MULTICHOICE and [c.correct for c in q.choices] == [True, False, False]


def test_fill_in_multiple_blanks_markers():
    responses = fib_response("1") + fib_response("kind of being") + fib_response("family")
    cond = correct_cond(f"<and><or>{veq('poor', '1')}{veq('sad', '1')}</or><or>{veq('boy', 'kind of being')}"
                        f"</or></and>")
    q = parse(item_xml("Fill in the Blank Plus", "I am just a [1] [kind of being] from a [family]", responses, cond))
    assert q.type == ir.QType.CLOZE
    assert q.text.html == "I am just a {{1}} {{2}} from a {{3}}"
    assert [b.answers for b in q.blanks] == [["poor", "sad"], ["boy"], []]


def test_cloze_without_markers_appends_blanks_and_handles_empty():
    q = parse(item_xml("Fill in the Blank Plus", "Name it", fib_response("x"), correct_cond(veq("y", "x", case="Yes"))))
    assert q.text.html.endswith(" {{1}}") and q.blanks[0].answers == ["y"]
    assert q.case_sensitive  # <varequal case="Yes"> applies to the gaps as it does to a single blank
    empty = parse(item_xml("Fill in the Blank Plus", "Nothing", "", ""))
    assert empty.type == ir.QType.UNSUPPORTED


def test_jumbled_sentence_dropdowns():
    words = [("w1", "brown"), ("w2", "jumped"), ("w3", "ditch")]
    responses = (choice_response(words, ident="brown", plain=True)
                 + choice_response(words, ident="jumped", plain=True))
    cond = correct_cond(f"<and>{veq('w2', 'jumped')}{veq('w1', 'brown')}</and>")
    q = parse(item_xml("Jumbled Sentence", "The quick [brown] fox [jumped].", responses, cond))
    assert q.text.html == "The quick {{1}} fox {{2}}."
    assert q.blanks[0].answers == ["brown"] and q.blanks[0].choices == ["brown", "jumped", "ditch"]
    assert not q.case_sensitive
    assert q.blanks[1].answers == ["jumped"]


def test_matching_uses_right_match_block():
    rows = ""
    for ident, prompt in (("r1", "left 1"), ("r2", "left 2")):
        rows += (f'<flow class="Block"><response_lid ident="{ident}" rcardinality="Single">'
                 f'<render_choice><flow_label class="Block"><response_label ident="{ident}-a"/>'
                 f'<response_label ident="{ident}-b"/><response_label ident="{ident}-c"/></flow_label>'
                 f'</render_choice></response_lid>{ftext(prompt)}</flow>')
    right = '<flow class="RIGHT_MATCH_BLOCK">' + "".join(
        f'<flow class="Block">{ftext(v)}</flow>' for v in ("right 1", "right 2", "DISTRACTION")) + "</flow>"
    conds = (correct_cond(veq("r1-b", "r1"), title="", score=None)
             + correct_cond(veq("r2-a", "r2"), title="", score=None))
    q = parse(item_xml("Matching", "Match these.", rows, conds, right=right))
    assert q.type == ir.QType.MATCHING and q.text.html == "Match these."
    assert [(p.prompt.html, p.answer) for p in q.pairs] == [("left 1", "right 2"), ("left 2", "right 1")]
    assert q.distractors == ["DISTRACTION"]


def test_matching_without_right_block_uses_label_text_and_fails_cleanly():
    rows = (f'<flow class="Block"><response_lid ident="r1"><render_choice>'
            f'{labels_xml([("x", "Paris"), ("y", "Rome")])}</render_choice></response_lid>{ftext("France")}</flow>')
    q = parse(item_xml("Matching", "Capitals", rows, correct_cond(veq("x", "r1"), title="", score=None)))
    assert [(p.prompt.html, p.answer) for p in q.pairs] == [("France", "Paris")]
    broken = parse(item_xml("Matching", "Nothing", rows, ""))
    assert broken.type == ir.QType.UNSUPPORTED and broken.reason
    nopres = parse('<item><itemmetadata><bbmd_questiontype>Matching</bbmd_questiontype></itemmetadata></item>')
    assert nopres.type == ir.QType.UNSUPPORTED


def test_ordering_question():
    options = [("b", "b"), ("a", "a"), ("c", "c")]
    cond = correct_cond(f"<and>{veq('a')}{veq('b')}{veq('c')}</and>")
    q = parse(item_xml("Ordering", "Alphabetical", choice_response(options, "Ordered"), cond))
    assert q.type == ir.QType.ORDERING and q.ordering == ["a", "b", "c"]


def test_numeric_ranges_and_exact():
    cond = correct_cond('<vargte respident="response">3.9</vargte><varlte respident="response">4.2</varlte>'
                        '<varequal case="No" respident="response">4</varequal>', title="0985", score=None)
    q = parse(item_xml("Numeric", "10 - 6?", fib_response(tag="response_num"), cond))
    assert q.type == ir.QType.NUMERICAL
    assert q.numeric[0].value == 4.0 and q.numeric[0].tolerance == pytest.approx(0.2)
    mid = parse(item_xml("Numeric", "?", fib_response(tag="response_num"), correct_cond(
        '<vargte respident="response">1</vargte><varlte respident="response">3</varlte>'
        '<varequal respident="response">abc</varequal>')))
    assert mid.numeric[0].value == 2.0 and mid.numeric[0].tolerance == 1.0
    exact = parse(item_xml("Numeric", "?", fib_response(tag="response_num"), correct_cond(veq("7"))))
    assert exact.numeric[0].value == 7.0 and exact.numeric[0].tolerance == 0
    none = parse(item_xml("Numeric", "?", fib_response(tag="response_num"), ""))
    assert none.type == ir.QType.UNSUPPORTED and none.reason == "no numeric answer"
    # "inf" and 1e999 parse as floats but cannot be written to the package
    inf = parse(item_xml("Numeric", "?", fib_response(tag="response_num"), correct_cond(veq("inf"))))
    assert inf.type == ir.QType.UNSUPPORTED and inf.reason == "no numeric answer"
    huge = parse(item_xml("Numeric", "?", fib_response(tag="response_num"), correct_cond(
        '<vargte respident="response">1</vargte><varlte respident="response">1e999</varlte>')))
    assert huge.type == ir.QType.UNSUPPORTED


def calculated_ext(var_sets=True, tol_type="numeric", tolerance="0.5"):
    sets = ('<var_sets><var_set ident="s1"><var name="x">2.0</var><var name="y">0.5</var><answer>8.5</answer>'
            '</var_set><var_set ident="s2"><var name="x">3.0</var><var name="y">1</var><answer>8</answer>'
            '</var_set></var_sets>') if var_sets else ""
    return (f'<itemproc_extension><calculated><formula>%3Cmath%3E%3C/math%3E</formula>'
            f'<answer_scale>1</answer_scale><answer_tolerance type="{tol_type}">{tolerance}</answer_tolerance>'
            f'<unit_value>cm</unit_value><vars><var name="x" scale="0"><min>1</min><max>9</max></var></vars>'
            f'{sets}</calculated></itemproc_extension>')


def test_calculated_uses_first_answer_set():
    warnings = []
    q = parse(item_xml("Calculated", "What is 10 - [x] - [y]?", fib_response(),
                       correct_cond("", score="SCORE.max"), extension=calculated_ext()), warnings)
    assert q.type == ir.QType.NUMERICAL and q.reason == ""
    assert q.text.html == "What is 10 - 2 - 0.5?"
    assert q.numeric[0].value == 8.5 and q.numeric[0].tolerance == 0.5 and q.unit == "cm"
    assert warnings == []  # a design difference the docs cover, not a warning
    pct = parse(item_xml("Calculated", "[x]", fib_response(), "", extension=calculated_ext(tol_type="percent",
                                                                                          tolerance="10")))
    assert pct.numeric[0].tolerance == pytest.approx(0.85)
    missing = parse(item_xml("Calculated", "[x]", fib_response(), "", extension=calculated_ext(var_sets=False)))
    assert missing.type == ir.QType.UNSUPPORTED and "answer sets" in missing.reason
    inf = parse(item_xml("Calculated", "[x]", fib_response(), "",
                         extension=calculated_ext().replace("<answer>8.5</answer>", "<answer>1e999</answer>")))
    assert inf.type == ir.QType.UNSUPPORTED
    huge_tol = parse(item_xml("Calculated", "[x]", fib_response(), "", extension=calculated_ext(tolerance="1e999")))
    assert huge_tol.type == ir.QType.NUMERICAL and huge_tol.numeric[0].tolerance == 0.0
    # A percentage of a huge answer overflows to infinity: no tolerance rather than an unstorable one
    overflow = parse(item_xml("Calculated", "[x]", fib_response(), "", extension=calculated_ext(
        tol_type="percent", tolerance="1e300").replace("<answer>8.5</answer>", "<answer>1e308</answer>")))
    assert overflow.type == ir.QType.NUMERICAL
    assert overflow.numeric[0].value == 1e308 and overflow.numeric[0].tolerance == 0.0


def test_essay_short_response_file_upload_hot_spot_presentation():
    solution = ('<itemfeedback ident="solution" view="All"><solution><solutionmaterial><flow_mat class="Block">'
                '<material><mat_extension><mat_formattedtext type="HTML">A yellow submarine.</mat_formattedtext>'
                '</mat_extension></material></flow_mat></solutionmaterial></solution></itemfeedback>')
    essay = parse(item_xml("Essay", "Who?", fib_response(), correct_cond(""), feedback=solution))
    assert essay.type == ir.QType.ESSAY and essay.general_feedback == "A yellow submarine."
    short = parse(item_xml("Short Response", "What?", fib_response(), ""))
    assert short.type == ir.QType.ESSAY
    upload = parse(item_xml("File Upload", "Send it", "", ""))
    assert upload.type == ir.QType.FILE_UPLOAD and upload.allow_attachments
    image = ('<flow class="FILE_BLOCK"><material><matapplication apptype="application/octet-stream" '
             'embedded="Inline" label="chipmunk.jpg" uri="4caf/chipmunk.jpg"/></material></flow>')
    hot = parse(item_xml("Hot Spot", "Where are the nuts?", '<response_xy ident="response"/>', "",
                         question_extra=image))
    assert hot.type == ir.QType.UNSUPPORTED and "hot spot" in hot.reason
    assert '<img src="4caf/chipmunk.jpg"' in hot.text.html
    text_only = parse(item_xml("Presentation Only", "Read this", "", "", score="0"))
    assert text_only.type == ir.QType.DESCRIPTION and text_only.points == 0


def test_material_variants():
    el = parse_bytes(
        b'<flow><material><mat_extension><mat_formattedtext type="PLAIN_TEXT">a &lt; b\nc</mat_formattedtext>'
        b'</mat_extension></material>'
        b'<material><mattext uri="https://example.org/x">Example</mattext></material>'
        b'<material><mattext texttype="text/plain">plain\ntext</mattext></material>'
        b'<material><mattext texttype="text/html">&lt;b&gt;bold&lt;/b&gt;</mattext></material>'
        b'<material><matapplication uri="files/notes.docx" label="notes.docx"/><matapplication uri=""/></material>'
        b'<material><matimage uri="img.bin"/><matbreak/></material></flow>')
    out = bb.bb_material_html(el)
    assert "a &lt; b<br>c" in out
    assert '<a href="https://example.org/x">Example</a>' in out
    assert "plain<br>text" in out and "<b>bold</b>" in out
    assert '<a href="files/notes.docx">notes.docx</a>' in out
    assert '<img src="img.bin"' in out and out.endswith("<br>")
    assert bb.bb_material_html(None) == ""


def test_item_without_question_block_and_label_falls_back_to_shared_parser():
    item = ('<item ident="q1"><presentation><material><mattext>2+2?</mattext></material>'
            '<response_lid ident="r"><render_choice><response_label ident="a"><material><mattext>4</mattext>'
            '</material></response_label><response_label ident="b"><material><mattext>5</mattext></material>'
            '</response_label></render_choice></response_lid></presentation><resprocessing><respcondition>'
            '<conditionvar><varequal respident="r">a</varequal></conditionvar><setvar action="Set">1</setvar>'
            '</respcondition></resprocessing></item>')
    q = parse(item)
    assert q.type == ir.QType.MULTICHOICE and [c.correct for c in q.choices] == [True, False]
    assert q.points == 1.0


# ---------------------------------------------------------------------------
# Original course package
# ---------------------------------------------------------------------------


def build_original(root) -> Pkg:
    p = Pkg(root)
    p.csfile("500_1", "banner.png", PNG)
    p.csfile("501_1", "cell.png", PNG, folder="__xid-499_1")
    write(root, "csfiles/home_dir/__xid-499_1.xml",
          '<lom><relation><resource><identifier>499_1#/courses/BB101/Images</identifier></resource></relation></lom>')
    p.csfile("502_1", "Syllabus.pdf", PDF)
    p.csfile("503_1", "Reading.docx", b"PK\x03\x04docx")
    p.csfile("504_1", "Lecture 1.mp4", MP4)
    p.csfile("505_1", "Handout.pdf", PDF)
    p.csfile("506_1", "brief.docx", b"PK\x03\x04", stem="brief")
    p.csfile("507_1", "chart.png", PNG)
    p.csfile("508_1", "clip.mp3", b"ID3audio")
    write(root, "csfiles/home_dir/orphan__xid-509_1.pdf", PDF)  # no sidecar: name from the file

    settings = p.res("course/x-bb-coursesetting", course_xml(
        extra='<REGISTRY><REGISTRYENTRY key="banner_thumbnail_url" value="/xid-999_1"/></REGISTRY>'),
        title="Biology 101")
    assert settings

    # Course menu
    info = p.res("course/x-bb-coursetoc", toc_xml("Information"), "Information")
    info_top = p.res("resource/x-bb-document", content_xml("_10_1", "--TOP--", "resource/x-bb-folder",
                                                           parent="{unset id}", is_folder=True))
    welcome = p.res("resource/x-bb-document", content_xml(
        "_11_1", "Welcome", body='<p><img src="@X@EmbeddedFile.requestUrlStub@X@bbcswebdav/xid-501_1" alt="">'
                                 'Hello <a href="@X@course.url@X@">here</a>.</p>'
                                 '<p><a href="https://bb.example.edu/bbcswebdav/xid-507_1">chart</a></p>',
        parent="_10_1", files=[("/xid-501_1", "cell.png"), ("/xid-503_1", "Reading.docx"),
                               ("/xid-505_1", "Handout.pdf"), ("/xid-777_1", "Gone.pdf"),
                               ("/xid-499_1/", "Images")]))
    syllabus = p.res("resource/x-bb-document", content_xml(
        "_12_1", "Syllabus", "resource/x-bb-file", parent="_10_1", files=[("/xid-502_1", "Syllabus.pdf")]))
    lecture = p.res("resource/x-bb-document", content_xml(
        "_13_1", "Lecture 1", "resource/x-bb-video", parent="_10_1", body="<p>Watch first.</p>",
        files=[("/xid-504_1", "Lecture 1.mp4")]))
    chart = p.res("resource/x-bb-document", content_xml(
        "_14_1", "Chart", "resource/x-bb-image", parent="_10_1", files=[("/xid-507_1", "chart.png")]))
    hidden = p.res("resource/x-bb-document", content_xml(
        "_15_1", "Draft notes", parent="_10_1", body="<p>Not ready</p>", available=False))
    staff_area = p.res("course/x-bb-coursetoc", toc_xml("Staff Contacts"), "Staff Contacts")
    staff_top = p.res("resource/x-bb-document", content_xml("_20_1", "--TOP--", "resource/x-bb-folder",
                                                            parent="{unset id}", is_folder=True))
    staff = p.res("resource/x-bb-staffinfo", (
        '<STAFFINFO id="_7786_1"><TITLE value=""/><BIOGRAPHY><TEXT>&lt;p&gt;Loves cells.&lt;/p&gt;</TEXT>'
        '</BIOGRAPHY><FLAGS><ISAVAILABLE value="true"/></FLAGS><CONTACT><NAME><FORMALTITLE value="Dr"/>'
        '<GIVEN value="Ada"/><FAMILY value="Lovelace"/></NAME><EMAIL value="ada@example.edu"/><PHONE value=""/>'
        '<OFFICE><HOURS value="Mon 9-11"/><ADDRESS value="Room 101"/></OFFICE></CONTACT><HOMEPAGE value=""/>'
        '</STAFFINFO>'), "Ada")
    empty_staff = p.res("resource/x-bb-staffinfo", '<STAFFINFO id="_7787_1"><TITLE value=""/></STAFFINFO>')

    content_area = p.res("course/x-bb-coursetoc", toc_xml("Learning Materials"), "Learning Materials")
    lm_top = p.res("resource/x-bb-document", content_xml("_30_1", "--TOP--", "resource/x-bb-folder",
                                                         parent="{unset id}", is_folder=True))
    week = p.res("resource/x-bb-document", content_xml(
        "_31_1", "Week 1", "resource/x-bb-folder", parent="_30_1", is_folder=True,
        body="<p>This week: cells. <img src=\"@X@EmbeddedFile.requestUrlStub@X@bbcswebdav/xid-501_1\"></p>"))
    yt = p.res("resource/x-bb-document", content_xml(
        "_32_1", "Intro video", "resource/x-bb-externallink", parent="_31_1",
        url="https://www.youtube.com/watch?v=dQw4w9WgXcQ"))
    site = p.res("resource/x-bb-document", content_xml(
        "_33_1", "NCBI", "resource/x-bb-externallink", parent="_31_1", url="www.ncbi.nlm.nih.gov",
        body="<p>Reference site</p>"))
    nourl = p.res("resource/x-bb-document", content_xml("_34_1", "Broken link", "resource/x-bb-externallink",
                                                        parent="_31_1"))
    sub = p.res("resource/x-bb-document", content_xml(
        "_35_1", "Extra reading", "resource/x-bb-lesson", parent="_31_1", is_folder=True,
        body="<p>Optional</p>", available=False))
    audio = p.res("resource/x-bb-document", content_xml(
        "_36_1", "Podcast", "resource/x-bb-audio", parent="_35_1", files=[("/xid-508_1", "clip.mp3")]))
    empty_sub = p.res("resource/x-bb-document", content_xml("_37_1", "Empty sub", "resource/x-bb-folder",
                                                            parent="_31_1", is_folder=True))
    legacy = p.res("resource/x-bb-document", content_xml(
        "_38_1", "Legacy page", parent="_37_1",
        body='<p><img src="@X@EmbeddedFile.location@X@diagram.png"></p>',
        files=[("notes.pdf", "notes.pdf")]))
    write(root, f"{legacy}/embedded/diagram.png", PNG)
    write(root, f"{legacy}/_9001_1/notes.pdf", PDF)
    p.resources[-1] = (legacy, "resource/x-bb-document", "Legacy page", ("_9001_1/notes.pdf",))

    assess_area = p.res("course/x-bb-coursetoc", toc_xml("Assessments"), "Assessments")
    as_top = p.res("resource/x-bb-document", content_xml("_40_1", "--TOP--", "resource/x-bb-folder",
                                                         parent="{unset id}", is_folder=True))
    assignment = p.res("resource/x-bb-document", content_xml(
        "_41_1", "Essay 1", "resource/x-bb-assignment", parent="_40_1", body="<p>Write 500 words.</p>",
        files=[("/xid-506_1", "brief.docx")]))
    test_link = p.res("resource/x-bb-document", content_xml(
        "_42_1", "Quiz 1", "resource/x-bb-asmt-test-link", parent="_40_1", body="<p>Good luck!</p>"))
    survey_link = p.res("resource/x-bb-document", content_xml(
        "_43_1", "Feedback survey", "resource/x-bb-asmt-survey-link", parent="_40_1"))
    forum_link = p.res("resource/x-bb-document", content_xml(
        "_44_1", "Discuss", "resource/x-bb-toollink", parent="_40_1"))
    course_link = p.res("resource/x-bb-document", content_xml(
        "_45_1", "Go to essay", "resource/x-bb-courselink", parent="_40_1", body="<p>Reminder</p>"))
    dangling = p.res("resource/x-bb-document", content_xml(
        "_46_1", "Dangling link", "resource/x-bb-courselink", parent="_40_1"))
    lti = p.res("resource/x-bb-document", content_xml(
        "_47_1", "Publisher", "resource/x-bb-bltiplacement-Pearson", parent="_40_1"))
    weird = p.res("resource/x-bb-document", content_xml(
        "_48_1", "Mashup", "resource/x-bb-mashup", parent="_40_1", body="<p>Some text</p>"))
    weird_empty = p.res("resource/x-bb-document", content_xml(
        "_49_1", "Nothing", "resource/x-bb-mystery", parent="_40_1"))
    missing_test = p.res("resource/x-bb-document", content_xml(
        "_50_1", "Lost quiz", "resource/x-bb-asmt-test-link", parent="_40_1"))

    tools_area = p.res("course/x-bb-coursetoc", toc_xml("Tools only"), "Tools only")
    tools_top = p.res("resource/x-bb-document", content_xml("_60_1", "--TOP--", "resource/x-bb-folder",
                                                            parent="{unset id}", is_folder=True))
    tool2 = p.res("resource/x-bb-document", content_xml("_61_1", "Blog", "resource/x-bb-blog-link",
                                                        parent="_60_1"))
    divider = p.res("course/x-bb-coursetoc", toc_xml("divider_1", "DIVIDER"))
    grades = p.res("course/x-bb-coursetoc", toc_xml("My Grades", "APPLICATION", handle="check_grade"))
    library = p.res("course/x-bb-coursetoc", toc_xml("Library", "URL", url="https://library.example.edu"))
    empty_area = p.res("course/x-bb-coursetoc", toc_xml("Empty area", enabled=False))
    empty_top = p.res("resource/x-bb-document", content_xml("_70_1", "--TOP--", "resource/x-bb-folder",
                                                            parent="{unset id}", is_folder=True))

    # Assessment machinery
    tf = item_xml("True/False", "Cells are alive", choice_response([("true", "true"), ("false", "false")],
                                                                    plain=True), correct_cond(veq("true")),
                  oid="_201_1")
    img_q = item_xml("Multiple Choice", 'Which? <img src="@X@EmbeddedFile.requestUrlStub@X@bbcswebdav/xid-507_1">',
                     choice_response([("a", "A"), ("b", "B")]), correct_cond(veq("b")), oid="_202_1")
    block = ('<section><sectionmetadata><bbmd_sectiontype>Random Block</bbmd_sectiontype>'
             '<qmd_weighting>2.0</qmd_weighting></sectionmetadata><selection_ordering><selection seltype="All">'
             '<selection_number>1</selection_number><or_selection>'
             '<selection_metadata mdoperator="EQ" mdname="bbmd_questionid">_301_1</selection_metadata>'
             '<selection_metadata mdoperator="EQ" mdname="bbmd_questionid">_302_1</selection_metadata>'
             '<selection_metadata mdoperator="EQ" mdname="bbmd_questionid">_399_1</selection_metadata>'
             '</or_selection></selection></selection_ordering></section>')
    qti_test = p.res("assessment/x-bb-qti-test", assessment_xml("Quiz 1", [tf, img_q], sections=block),
                     "Quiz 1")
    p.res("assessment/x-bb-qti-pool", assessment_xml(
        "Pool A", [mc_item(oid="_301_1"), item_xml("Essay", "Explain", fib_response(), "", oid="_302_1")]),
        "Pool A")
    p.res("assessment/x-bb-qti-test", assessment_xml("Old quiz", [mc_item()]), "Old quiz")
    p.res("assessment/x-bb-qti-survey", assessment_xml("Survey", [mc_item()]), "Survey")
    casmt = p.res("course/x-bb-courseassessment", course_assessment_xml(qti_test, access_code="secret"))
    p.res("resource/x-bb-link", link_xml(test_link, casmt, "COURSE_ASSESSMENT"))
    p.res("resource/x-bb-link", link_xml(course_link, assignment, "CONTENT"))
    p.res("resource/x-bb-link", link_xml(forum_link, "discussion_board", "TOOL"))
    p.res("resource/x-bb-link", "<LINK/>")
    p.res("course/x-bb-gradebook", gradebook_xml([
        (assignment, "", "2024-05-01 23:59:00 EDT", "25.000000000000000"),
        (test_link, qti_test, "2024-04-15 17:00:00 EDT", "20.0"),
        ("", "", "", "0E-15"),
    ]), "Gradebook")
    p.res("resource/x-bb-discussionboard", "<FORUM/>", "General discussion")
    p.res("resource/x-bb-announcement", "<ANNOUNCEMENT/>", "Welcome!")
    p.res("resource/x-plugin-scormengine", "<scormItem/>", "SCORM")
    p.res("course/x-bb-user", "<USERS/>", "Users")

    p.manifest([
        (info, "Information", [(info_top, "--TOP--", [
            (welcome, "Welcome", []), (syllabus, "Syllabus", []), (lecture, "Lecture 1", []),
            (chart, "Chart", []), (hidden, "Draft notes", []), ("res99999", "Ghost", [])])]),
        (staff_area, "Staff Contacts", [(staff_top, "--TOP--", [(staff, "Ada", []), (empty_staff, "", [])])]),
        (content_area, "Learning Materials", [(lm_top, "--TOP--", [
            (week, "Week 1", [(yt, "Intro video", []), (site, "NCBI", []), (nourl, "Broken link", []),
                              (sub, "Extra reading", [(audio, "Podcast", [])]),
                              (empty_sub, "Empty sub", [(legacy, "Legacy page", [])])])])]),
        (assess_area, "Assessments", [(as_top, "--TOP--", [
            (assignment, "Essay 1", []), (test_link, "Quiz 1", []), (survey_link, "Feedback survey", []),
            (forum_link, "Discuss", []), (course_link, "Go to essay", []), (dangling, "Dangling link", []),
            (lti, "Publisher", []), (weird, "Mashup", []), (weird_empty, "Nothing", []),
            (missing_test, "Lost quiz", [])])]),
        (tools_area, "Tools only", [(tools_top, "--TOP--", [(tool2, "Blog", [])])]),
        (divider, "divider_1", []), (grades, "My Grades", []), (library, "Library", []),
        (empty_area, "Empty area", [(empty_top, "--TOP--", [])]),
    ])
    return p


def by_title(items, title):
    return next(i for i in items if getattr(i, "title", "") == title)


def test_read_original_course(tmp_path):
    build_original(tmp_path)
    course = bb.read(str(tmp_path))
    assert course.source == "blackboard" and course.title == "Biology 101"
    assert course.short_name == "BIO101_F24" and course.id == "_35811_1" and course.language == "en_US"
    assert "Cells &amp; <b>life</b>" in course.summary.html
    assert course.thumbnail is not None and course.thumbnail.name == "banner.png"

    titles = [s.title for s in course.sections]
    assert titles == ["Information", "Staff Contacts", "Learning Materials › Week 1", "Assessments", "Links",
                      "Question pools"]
    info, staff, week, assess, links, pools = course.sections
    # A test nothing links to is kept, unpublished; the pool Quiz 1 draws from is not repeated
    assert not pools.visible and [(i.title, i.visible) for i in pools.items] == [("Old quiz", False)]

    welcome = by_title(info.items, "Welcome")
    assert isinstance(welcome, ir.Page)
    html_part = welcome.parts[0]
    assert isinstance(html_part, ir.HtmlPart)
    assert 'href="#"' in html_part.content.html  # template variable link neutralized
    assert 'href="bbcswebdav/xid-507_1"' in html_part.content.html  # absolute server link made local
    asset = html_part.content.resolve("@X@EmbeddedFile.requestUrlStub@X@bbcswebdav/xid-501_1")
    assert asset is not None and asset.name == "cell.png" and asset.exists()
    assert html_part.content.resolve("bbcswebdav/xid-507_1").name == "chart.png"
    assert html_part.content.resolve("/bbcswebdav/courses/BB101/Syllabus.pdf").name == "Syllabus.pdf"
    assert html_part.content.resolve("/bbcswebdav/courses/BB101/nothing.pdf") is None
    # cell.png is embedded in the body, so only the other attachments are added
    kinds = [type(pt).__name__ for pt in welcome.parts[1:]]
    assert kinds == ["FilePart", "MediaPart"]
    assert welcome.parts[1].asset.name == "Reading.docx"
    assert welcome.parts[2].kind == ir.MediaKind.PDF and welcome.parts[2].title == "Handout.pdf"

    syllabus = by_title(info.items, "Syllabus")
    assert isinstance(syllabus, ir.DocumentItem) and syllabus.asset.name == "Syllabus.pdf"
    lecture = by_title(info.items, "Lecture 1")
    assert isinstance(lecture, ir.VideoItem) and lecture.asset.name == "Lecture 1.mp4"
    assert "Watch first" in lecture.description.html
    chart = by_title(info.items, "Chart")
    assert isinstance(chart, ir.Page) and chart.parts[0].kind == ir.MediaKind.IMAGE
    assert by_title(info.items, "Draft notes").visible is False

    ada = staff.items[0]
    assert ada.title == "Dr Ada Lovelace" and len(staff.items) == 1
    staff_html = ada.parts[0].content.html
    assert "ada@example.edu" in staff_html and "Mon 9-11" in staff_html and "Loves cells" in staff_html

    assert "This week: cells" in week.summary.html
    names = [i.title for i in week.items]
    assert names == ["Intro video", "NCBI", "Broken link", "Extra reading", "Podcast", "Legacy page"]
    intro = week.items[0]
    assert isinstance(intro, ir.VideoItem) and intro.url.startswith("https://www.youtube.com/")
    ncbi = week.items[1]
    assert isinstance(ncbi.parts[-1], ir.LinkPart) and ncbi.parts[-1].url == "https://www.ncbi.nlm.nih.gov"
    assert week.items[2].parts == []
    extra, podcast = week.items[3], week.items[4]
    assert extra.visible is False and podcast.visible is False  # hidden learning module hides its content
    assert podcast.parts[0].kind == ir.MediaKind.AUDIO
    legacy = week.items[5]
    assert legacy.parts[0].content.resolve("@X@EmbeddedFile.location@X@diagram.png").name == "diagram.png"
    assert legacy.parts[1].asset.name == "notes.pdf" and legacy.parts[1].asset.exists()

    items = {i.title: i for i in assess.items}
    essay = items["Essay 1"]
    assert isinstance(essay, ir.AssignmentItem)
    assert essay.due_date == "2024-05-01T23:59:00-04:00" and essay.points == 25.0
    assert [a.name for a in essay.attachments] == ["brief.docx"] and "500 words" in essay.instructions.html

    quiz = items["Quiz 1"]
    assert isinstance(quiz, ir.Assessment)
    assert quiz.due_date == "2024-04-15T17:00:00-04:00"
    assert quiz.max_attempts == 3 and quiz.time_limit_minutes == 30 and quiz.show_correct_answers and quiz.shuffle
    assert "Good luck" in quiz.intro.html and "Read carefully" in quiz.intro.html
    assert [q.type for q in quiz.questions] == [ir.QType.TRUEFALSE, ir.QType.MULTICHOICE, ir.QType.MULTICHOICE,
                                                ir.QType.ESSAY]
    assert quiz.questions[2].points == 2.0  # random block weighting
    assert quiz.questions[1].text.resolve("@X@EmbeddedFile.requestUrlStub@X@bbcswebdav/xid-507_1") is not None

    unsupported = {i.title: i for i in assess.items if isinstance(i, ir.UnsupportedItem)}
    assert unsupported["Feedback survey"].kind == "survey"
    assert unsupported["Discuss"].kind == "tool link"
    assert unsupported["Publisher"].kind == "LTI tool"
    assert unsupported["Nothing"].kind == "x-bb-mystery"
    assert unsupported["Lost quiz"].kind == "quiz"
    go = items["Go to essay"]
    assert "See “Essay 1” in this course." in go.parts[-1].content.html
    assert items["Mashup"].parts[0].content.html == "<p>Some text</p>"

    assert links.items[0].parts[0].url == "https://library.example.edu"

    # Only genuine problems are warnings; everything left out is a skipped item
    assert course.warnings == ["1 pool question(s) used by “Quiz 1” are missing from the export"]
    assert unsupported["Lost quiz"].reason == "the test's questions are missing from the export"
    assert unsupported["Discuss"].reason == "not imported"
    assert ("Gone.pdf", "file", "missing from the export") in course.skipped
    assert ("Images", "link", "points to a Content Collection folder") in course.skipped
    assert ("Broken link", "link", "no address") in course.skipped
    assert ("Dangling link", "link", "target missing from the export") in course.skipped
    assert ("Blog", "blog", "not imported") in course.skipped  # the tool-only area is dropped
    assert ("General discussion", "discussion", "not imported") in course.skipped
    assert ("Welcome!", "announcement", "not imported") in course.skipped
    assert ("SCORM", "scorm", bb._SCORM_REASON) in course.skipped
    assert ("Ghost", "content", bb._UNREADABLE_REASON) in course.skipped  # a menu item whose resource is gone
    # Design differences the docs cover (menu tools, test password, random draw, unknown type
    # imported as a page, unused pools kept unpublished) are neither warned nor skipped
    assert not any("My Grades" in t or "Quiz 1" in t or "Mashup" in t or "Old quiz" in t
                   for t, _, _ in course.skipped)


def test_attempt_settings_variants(tmp_path):
    def quiz_with(**kw):
        root = tmp_path / str(len(os.listdir(tmp_path)))
        p = Pkg(root)
        toc = p.res("course/x-bb-coursetoc", toc_xml("Tests"))
        top = p.res("resource/x-bb-document", content_xml("_1_1", "--TOP--", "resource/x-bb-folder",
                                                          parent="{unset id}", is_folder=True))
        link = p.res("resource/x-bb-document", content_xml("_2_1", "Quiz", "resource/x-bb-asmt-test-link"))
        qti_id = p.res("assessment/x-bb-qti-test", assessment_xml("Quiz", [mc_item()], desc=""))
        casmt = p.res("course/x-bb-courseassessment", course_assessment_xml(qti_id, **kw))
        p.res("resource/x-bb-link", link_xml(link, casmt, "COURSE_ASSESSMENT"))
        p.manifest([(toc, "Tests", [(top, "--TOP--", [(link, "Quiz", [])])])])
        return bb.read(str(root)).sections[0].items[0]

    unlimited = quiz_with(unlimited=True, time_limit="", show=False, randomize=False, feedback="as:ca,f|ns:")
    assert unlimited.max_attempts == 0 and unlimited.time_limit_minutes is None
    assert unlimited.show_correct_answers and not unlimited.shuffle
    single = quiz_with(multiple=False, show=False, feedback="as:f")
    assert single.max_attempts == 1 and not single.show_correct_answers
    assert unlimited.intro.html == ""


def test_test_link_fallbacks(tmp_path):
    p = Pkg(tmp_path)
    toc = p.res("course/x-bb-coursetoc", toc_xml("Tests"))
    top = p.res("resource/x-bb-document", content_xml("_1_1", "--TOP--", "resource/x-bb-folder",
                                                      parent="{unset id}", is_folder=True))
    via_gradebook = p.res("resource/x-bb-document", content_xml("_2_1", "Midterm", "resource/x-bb-asmt-test-link"))
    via_object_id = p.res("resource/x-bb-document", content_xml("_3_1", "Final", "resource/x-bb-asmt-test-link"))
    via_title = p.res("resource/x-bb-document", content_xml("_4_1", "Pop quiz", "resource/x-bb-asmt-test-link"))
    via_direct = p.res("resource/x-bb-document", content_xml("_5_1", "Direct", "resource/x-bb-asmt-test-link"))
    ultra_assignment = p.res("resource/x-bb-document", content_xml(
        "_6_1", "Project", "resource/x-bb-asmt-test-link", body="<p>Upload your project.</p>"))
    midterm = p.res("assessment/x-bb-qti-test", assessment_xml("Midterm exam", [mc_item()]), "Midterm exam")
    p.res("assessment/x-bb-qti-test", assessment_xml("Final exam", [mc_item()], oid="_777_1"),
          "Final exam")
    p.res("assessment/x-bb-qti-test", assessment_xml("Pop quiz", [mc_item()]), "Pop quiz")
    direct = p.res("assessment/x-bb-qti-test", assessment_xml("Direct", [mc_item()]), "Direct")
    project = p.res("assessment/x-bb-qti-test", assessment_xml("Project", [], desc="<p>Rubric attached</p>"))
    p.res("resource/x-bb-link", link_xml("_5_1", direct, "ASSESSMENT"))  # content id instead of resource id
    p.res("resource/x-bb-link", link_xml(ultra_assignment, project, "ASSESSMENT"))
    p.res("course/x-bb-gradebook", gradebook_xml([
        (via_gradebook, midterm, "", "10"), ("_3_1", "_777_1", "", "5"),
        (ultra_assignment, project, "2024-06-01 12:00:00 UTC", "50")]))
    p.manifest([(toc, "Tests", [(top, "--TOP--", [
        (via_gradebook, "Midterm", []), (via_object_id, "Final", []), (via_title, "Pop quiz", []),
        (via_direct, "Direct", []), (ultra_assignment, "Project", [])])])])
    items = bb.read(str(tmp_path)).sections[0].items
    assert [type(i).__name__ for i in items] == ["Assessment"] * 4 + ["AssignmentItem"]
    project_item = items[4]
    assert "Upload your project" in project_item.instructions.html and "Rubric attached" in project_item.instructions.html
    assert project_item.due_date == "2024-06-01T12:00:00+00:00" and project_item.points == 50.0


def test_pool_drawn_by_sourcebank_ref(tmp_path):
    p = Pkg(tmp_path)
    toc = p.res("course/x-bb-coursetoc", toc_xml("Tests"))
    top = p.res("resource/x-bb-document", content_xml("_1_1", "--TOP--", "resource/x-bb-folder",
                                                      parent="{unset id}", is_folder=True))
    link = p.res("resource/x-bb-document", content_xml("_2_1", "Drawn", "resource/x-bb-asmt-test-link"))
    pool = p.res("assessment/x-bb-qti-pool", assessment_xml("Bank", [mc_item(oid="_1_9"), mc_item(oid="_2_9")]))
    sections = ('<section><sectionmetadata><qmd_weighting>0</qmd_weighting></sectionmetadata><selection_ordering>'
                f'<selection><sourcebank_ref>{pool}</sourcebank_ref><selection_number>1</selection_number>'
                '</selection></selection_ordering></section>'
                '<section><selection_ordering><selection><sourcebank_ref>res99999</sourcebank_ref></selection>'
                '</selection_ordering></section>'
                '<section><selection_ordering><selection><selection_number>2</selection_number></selection>'
                '</selection_ordering></section>')
    qti_id = p.res("assessment/x-bb-qti-test", assessment_xml("Drawn", [], sections=sections), "Drawn")
    p.res("resource/x-bb-link", link_xml(link, qti_id, "ASSESSMENT"))
    p.manifest([(toc, "Tests", [(top, "--TOP--", [(link, "Drawn", [])])])])
    course = bb.read(str(tmp_path))
    quiz = course.sections[0].items[0]
    assert len(quiz.questions) == 2 and quiz.questions[0].points == 10.0
    # The random draw is replaced by the full set silently; a missing pool is a warning
    assert course.warnings == ["Question pool used by “Drawn” is missing from the export"]
    assert course.skipped == []


# ---------------------------------------------------------------------------
# Ultra course package
# ---------------------------------------------------------------------------


def build_ultra(root) -> Pkg:
    p = Pkg(root)
    p.csfile("600_1", "photo.png", PNG)
    p.csfile("601_1", "talk.mp4", MP4)
    p.csfile("602_1", "UNSAFE_HTML_2026.html",
             b"<script>alert(1)</script><div><h2>Guide</h2><p>Inline HTML</p></div>")
    p.csfile("603_1", "notes.txt", b"plain notes")
    p.csfile("604_1", "big.html", b"x")
    p.res("course/x-bb-coursesetting", course_xml(title="Ultra Course", desc=" ", banner="")
          .replace("<LOCALE", '<ULTRASTATUS value="U"/><LOCALE'))
    root_toc = p.res("course/x-bb-coursetoc", toc_xml("ROOT", handle=""))
    top = p.res("resource/x-bb-document", content_xml("_1_1", "--TOP--", "resource/x-bb-folder",
                                                      parent="{unset id}", is_folder=True))
    module = p.res("resource/x-bb-document", content_xml(
        "_2_1", "Module 1", "resource/x-bb-lesson", parent="_1_1", is_folder=True, folder_type="BB_FOLDER",
        description="Start here & read"))
    doc = p.res("resource/x-bb-document", content_xml(
        "_3_1", "Overview", "resource/x-bb-folder", parent="_2_1", is_folder=True, folder_type="BB_PAGE"))
    bbfile = escape(json.dumps({"linkName": "photo.png", "mimeType": "image/png", "render": "inline",
                                "alternativeText": "A photo"}))
    video = escape(json.dumps({"linkName": "talk.mp4", "mimeType": "video/mp4"}))
    txt = escape(json.dumps({"linkName": "notes.txt", "mimeType": "text/plain"}))
    unsafe = escape(json.dumps({"linkName": "UNSAFE_HTML_2026.html",
                                "resourceUrl": "@X@EmbeddedFile.unsafeHtml@X@bbcswebdav/xid-602_1"}))
    gone = escape(json.dumps({"linkName": "x.html"}))
    body = (
        '<div data-layout-row="r1"><div data-layout-column="c1">'
        f'<p><a href="@X@EmbeddedFile.requestUrlStub@X@bbcswebdav/xid-600_1" data-bbfile="{bbfile}" '
        'data-bbtype="attachment">photo.png</a></p>'
        f'<p><a href="@X@EmbeddedFile.requestUrlStub@X@bbcswebdav/xid-601_1" data-bbfile="{video}"></a></p>'
        f'<p><a href="@X@EmbeddedFile.requestUrlStub@X@bbcswebdav/xid-603_1" data-bbfile="{txt}"></a></p>'
        '<p><a href="#" data-bbfile="not json">broken</a><a href="#" data-bbfile="[1]">list</a></p>'
        f'<p><a href="#" data-bbfile="{escape(json.dumps({"linkName": ["a"], "mimeType": 5, "resourceUrl": {"u": 1}}))}">'
        'odd</a></p>'
        f'<a data-bbfile="{unsafe}" data-bbtype="embedded-unsafe-html" '
        'href="@X@EmbeddedFile.unsafeHtml@X@bbcswebdav/xid-602_1"></a>'
        f'<a data-bbfile="{gone}" data-bbtype="embedded-unsafe-html" href="bbcswebdav/xid-404_1"></a>'
        '</div></div>')
    doc_body = p.res("resource/x-bb-document", content_xml("_4_1", "ultraDocumentBody", parent="_3_1", body=body))
    doc_extra = p.res("resource/x-bb-document", content_xml(
        "_5_1", "Inner link", "resource/x-bb-externallink", parent="_3_1", url="https://example.org"))
    link = p.res("resource/x-bb-document", content_xml(
        "_6_1", "Vimeo talk", "resource/x-bb-externallink", parent="_2_1", url="https://vimeo.com/123456",
        description="Short talk"))
    loose = p.res("resource/x-bb-document", content_xml("_7_1", "Course welcome", parent="_1_1",
                                                        body="<p>Hi all</p>"))
    mc = item_xml("Multiple Answer", "<p>Late policy?</p>", choice_response(
        [("new_a", "<p>None</p>"), ("new_b", "<p>48h</p>")], "Multiple"),
        correct_cond(f"<and><not>{veq('o1')}</not>{veq('o2')}</and>")
        + "".join(f'<respcondition><conditionvar><varequal case="No" respident="{o}"/></conditionvar>'
                  '<setvar action="Set" variablename="SCORE">0</setvar></respcondition>' for o in ("o1", "o2")))
    test = p.res("resource/x-bb-document", content_xml("_8_1", "Syllabus quiz", "resource/x-bb-asmt-test-link",
                                                       parent="_2_1"))
    qti_id = p.res("assessment/x-bb-qti-test", assessment_xml("Syllabus quiz", [mc]))
    p.res("resource/x-bb-link", link_xml(test, qti_id, "ASSESSMENT"))
    interactive = p.res("course/x-bb-coursetoc", toc_xml("INTERACTIVE", handle=""))
    i_top = p.res("resource/x-bb-document", content_xml("_9_1", "--TOP--", "resource/x-bb-folder",
                                                        parent="{unset id}", is_folder=True))
    indirect = p.res("course/x-bb-coursetoc", toc_xml("INDIRECT", handle=""))
    d_top = p.res("resource/x-bb-document", content_xml("_10_1", "--TOP--", "resource/x-bb-folder",
                                                        parent="{unset id}", is_folder=True))
    hidden_doc = p.res("resource/x-bb-document", content_xml("_11_1", "Linked only", parent="_10_1",
                                                             body="<p>Reached from a link</p>"))
    p.manifest([
        (root_toc, "ROOT", [(top, "--TOP--", [
            (module, "Module 1", [
                (doc, "Overview", [(doc_body, "ultraDocumentBody", []), (doc_extra, "Inner link", [])]),
                (link, "Vimeo talk", []), (test, "Syllabus quiz", [])]),
            (loose, "Course welcome", [])])]),
        (interactive, "INTERACTIVE", [(i_top, "--TOP--", [])]),
        (indirect, "INDIRECT", [(d_top, "--TOP--", [(hidden_doc, "Linked only", [])])]),
    ])
    return p


def test_read_ultra_course(tmp_path, monkeypatch):
    build_ultra(tmp_path)
    monkeypatch.setattr(bb, "_MAX_INLINE_HTML", 10)
    big = bb.read(str(tmp_path))
    overview = big.sections[1].items[0]
    assert "Inline HTML" not in overview.parts[0].content.html  # snippet over the size cap is dropped
    monkeypatch.undo()

    course = bb.read(str(tmp_path))
    assert course.title == "Ultra Course" and course.summary.is_empty() and course.thumbnail is None
    assert [s.title for s in course.sections] == ["Course content", "Module 1", "Other content"]
    welcome_sec, module, other = course.sections
    assert welcome_sec.items[0].title == "Course welcome"
    assert "Start here &amp; read" in module.summary.html
    assert other.visible is False and other.items[0].title == "Linked only"

    overview, inner, talk, quiz = module.items
    assert isinstance(overview, ir.Page) and overview.title == "Overview"
    html_out = overview.parts[0].content.html
    assert '<img alt="A photo" src="@X@EmbeddedFile.requestUrlStub@X@bbcswebdav/xid-600_1"/>' in html_out
    assert '<video src="@X@EmbeddedFile.requestUrlStub@X@bbcswebdav/xid-601_1" title="talk.mp4"></video>' in html_out
    assert ">notes.txt</a>" in html_out
    assert ">odd</a>" in html_out  # non-string JSON values are ignored, not a crash
    assert "<h2>Guide</h2>" in html_out and "alert(1)" not in html_out and "xid-404_1" not in html_out
    assert overview.parts[0].content.resolve("bbcswebdav/xid-601_1").name == "talk.mp4"
    assert isinstance(inner, ir.Page) and inner.parts[-1].url == "https://example.org"
    assert isinstance(talk, ir.VideoItem) and talk.url == "https://vimeo.com/123456"
    assert "Short talk" in talk.description.html
    assert isinstance(quiz, ir.Assessment) and [c.correct for c in quiz.questions[0].choices] == [False, True]


def test_single_area_uses_folder_titles_and_tree_fallback(tmp_path):
    p = Pkg(tmp_path)
    p.res("course/x-bb-coursesetting", '<COURSE id="_1_1"><TITLE value=""/></COURSE>', "Fallback title")
    top = p.res("resource/x-bb-document", content_xml("_1_1", "--TOP--", "resource/x-bb-folder",
                                                      parent="{unset id}", is_folder=True))
    unit = p.res("resource/x-bb-document", content_xml("_2_1", "Unit A", "resource/x-bb-folder", parent="_1_1",
                                                       is_folder=True))
    p.res("resource/x-bb-document", content_xml("_3_1", "Page A", parent="_2_1", body="<p>A</p>"))
    p.res("resource/x-bb-document", content_xml("_4_1", "Loose", parent="_1_1", body="<p>L</p>"))
    p.res("resource/x-bb-document", "<NOTCONTENT/>")
    p.manifest([])  # no organization: the tree comes from PARENTID
    course = bb.read(str(tmp_path))
    assert course.title == "Fallback title"
    assert [s.title for s in course.sections] == ["Course content", "Unit A"]
    assert course.sections[1].items[0].title == "Page A"
    assert top and unit


def test_top_level_content_without_toc(tmp_path):
    p = Pkg(tmp_path)
    page = p.res("resource/x-bb-document", content_xml("_1_1", "Lonely page", body="<p>x</p>"))
    board = p.res("resource/x-bb-discussionboard", "<FORUM/>", "Forum")
    p.manifest([(page, "Lonely page", []), (board, "Forum", []), ("res99999", "Ghost", [])])
    course = bb.read(str(tmp_path))
    assert [s.title for s in course.sections] == ["Lonely page"]
    assert course.warnings == []
    # the board was placed in the content, so it is reported once (not again as unused)
    assert course.skipped == [("Forum", "discussion", "not imported")]


def test_missing_manifest_and_unreadable_resources(tmp_path):
    with pytest.raises(ValueError):
        bb.read(str(tmp_path))
    p = Pkg(tmp_path)
    toc = p.res("course/x-bb-coursetoc", toc_xml("Area"))
    top = p.res("resource/x-bb-document", content_xml("_1_1", "--TOP--", "resource/x-bb-folder",
                                                      parent="{unset id}", is_folder=True))
    broken = p.res("resource/x-bb-document", "<CONTENT><unclosed></CONTENT>")
    p.res("course/x-bb-courseassessment", "<BROKEN")
    p.res("resource/x-bb-link", "<BROKEN")
    p.manifest([(toc, "Area", [(top, "--TOP--", [(broken, "Broken", [("res99999", "Ghost", [])])])])])
    course = bb.read(str(tmp_path))
    assert course.sections == []
    # Each unparsable .dat is reported once; the menu items that needed them are listed as skipped
    # (the broken one and, with it, the whole subtree under it)
    assert sorted(w.split(" could not be parsed:")[0] for w in course.warnings) == [
        "res00003.dat", "res00004.dat", "res00005.dat"]
    assert course.skipped == [("Broken", "content", bb._UNREADABLE_REASON)]


def test_xid_names_without_sidecar_and_local_asset_lookup(tmp_path):
    p = Pkg(tmp_path)
    write(tmp_path, "csfiles/home_dir/Lab sheet__xid-7_1.pdf", PDF)
    write(tmp_path, "csfiles/home_dir/__xid-8_1.png", PNG)
    write(tmp_path, "csfiles/home_dir/__xid-9_1.png", PNG)
    write(tmp_path, "csfiles/home_dir/__xid-9_1.png.xml", "<lom><identifier>no-hash</identifier></lom>")
    write(tmp_path, "csfiles/home_dir/__xid-10_1.jpg", PNG)
    write(tmp_path, "csfiles/home_dir/__xid-10_1.jpg.xml",
          "<lom><identifier>10_1#/courses/BB101/Folder/photo</identifier></lom>")
    write(tmp_path, "res00009/somewhere/deep.pdf", PDF)
    p.manifest([])
    pkg = bb._Package(str(tmp_path))
    assert pkg.xid_asset("7_1").name == "Lab sheet.pdf"
    assert pkg.xid_asset("8_1").name == "file.png"
    assert pkg.xid_asset("9_1").name == "file.png"
    assert pkg.xid_asset("10_1").name == "photo.jpg"
    assert pkg.xid_asset("404_1") is None
    assert pkg.local_asset("") is None
    assert pkg.local_asset("deep.pdf", ("res00001",)).name == "deep.pdf"
    assert pkg.local_asset("missing.pdf", ("res00001",)) is None
    assert pkg.dat("nope") is None
    assert pkg.resolve_url("https://example.org/a.png", ()) is None


def test_convert_end_to_end(tmp_path):
    src = tmp_path / "export"
    build_original(src)
    archive = tmp_path / "ExportFile_BIO101.zip"
    with zipfile.ZipFile(archive, "w") as zf:
        for dirpath, _dirs, files in os.walk(src):
            for f in files:
                full = os.path.join(dirpath, f)
                zf.write(full, os.path.relpath(full, src))
    out = tmp_path / "package"
    result = convert(str(archive), str(out), options=ConvertOptions(keep_past_due_dates=True))
    assert result.course.source == "blackboard"
    manifest = json.loads((out / "manifest.json").read_text())
    assert manifest["source"]["lms"] == "blackboard"
    course_dir = out / manifest["courses"][0]["path"]
    course_json = json.loads((course_dir / "course.json").read_text())
    assert course_json["name"] == "Biology 101" and course_json["thumbnail_image"]
    chapters = sorted((course_dir / "chapters").iterdir())
    names = sorted(json.loads((c / "chapter.json").read_text())["name"] for c in chapters)
    assert names == sorted(["Information", "Staff Contacts", "Learning Materials › Week 1", "Assessments",
                            "Links", "Question pools"])
    activities = [json.loads((a / "activity.json").read_text())
                  for c in chapters for a in (c / "activities").iterdir()]
    types = {a["activity_type"] for a in activities}
    assert {"TYPE_DYNAMIC", "TYPE_DOCUMENT", "TYPE_VIDEO", "TYPE_ASSIGNMENT"} <= types
    assignments = [json.loads(p.read_text()) for p in course_dir.rglob("assignment.json")]
    dues = {a["assignment"]["title"]: a["assignment"]["due_date"] for a in assignments}
    assert dues["Essay 1"] == "2024-05-01T23:59:00-04:00"
    assert dues["Quiz 1"] == "2024-04-15T17:00:00-04:00"
    quiz = next(a for a in assignments if a["assignment"]["title"] == "Quiz 1")
    assert quiz["assignment"]["max_retries"] == 3 and quiz["tasks"]
    assert any(p.suffix == ".pdf" for p in course_dir.rglob("*documentpdf*"))
    assert result.report is not None


def test_staff_information_placeholder_and_duplicate_test_copies(tmp_path):
    # Real archives list staff entries under a reference-less "placeholder/staff-info" item, while the
    # menu entry itself is an APPLICATION; archives can also carry a second unused copy of a linked test
    p = Pkg(tmp_path)
    staff_toc = p.res("course/x-bb-coursetoc", toc_xml("Staff Contacts", "APPLICATION", handle="staff_information"))
    person = p.res("resource/x-bb-staffinfo", (
        '<STAFFINFO id="_1_1"><TITLE value="Lecturer Jo"/><FLAGS><ISAVAILABLE value="true"/></FLAGS>'
        '<CONTACT><NAME><GIVEN value="Jo"/></NAME><EMAIL value="jo@example.edu"/></CONTACT></STAFFINFO>'))
    toc = p.res("course/x-bb-coursetoc", toc_xml("Tests"))
    top = p.res("resource/x-bb-document", content_xml("_1_1", "--TOP--", "resource/x-bb-folder",
                                                      parent="{unset id}", is_folder=True))
    link = p.res("resource/x-bb-document", content_xml("_2_1", "Exam", "resource/x-bb-asmt-test-link"))
    qti_id = p.res("assessment/x-bb-qti-test", assessment_xml("Exam", [mc_item()]), "Exam")
    p.res("assessment/x-bb-qti-test", assessment_xml("Exam", []), "Exam")
    p.res("resource/x-bb-link", link_xml(link, qti_id, "ASSESSMENT"))
    p.manifest([(staff_toc, "Staff Contacts", []), (toc, "Tests", [(top, "--TOP--", [(link, "Exam", [])])]),
                ("", "placeholder/staff-info", [(person, "Lecturer Jo", [])])])
    course = bb.read(str(tmp_path))
    assert [s.title for s in course.sections] == ["Tests", "Staff Contacts"]
    assert course.sections[1].items[0].title == "Lecturer Jo"
    assert course.warnings == [] and course.skipped == []


# ---------------------------------------------------------------------------
# Regressions found on real packages
# ---------------------------------------------------------------------------


def test_sidecar_of_missing_file_is_not_the_file(tmp_path):
    # "Links only" exports (and trimmed copies) keep the LOM sidecar but not the file: the
    # sidecar must not stand in for the PDF
    p = Pkg(tmp_path)
    write(tmp_path, "csfiles/home_dir/__xid-5_1.pdf.xml",
          "<lom><relation><resource><identifier>5_1#/courses/X/Slides.pdf</identifier></resource></relation></lom>")
    write(tmp_path, "csfiles/home_dir/notes__xid-6_1.xml", "<data/>")  # a real XML file, not a sidecar
    toc = p.res("course/x-bb-coursetoc", toc_xml("Area"))
    top = p.res("resource/x-bb-document", content_xml("_1_1", "--TOP--", "resource/x-bb-folder",
                                                      parent="{unset id}", is_folder=True))
    page = p.res("resource/x-bb-document", content_xml("_2_1", "Slides", body="<p>See slides</p>",
                                                       files=[("/xid-5_1", "Slides.pdf")]))
    p.manifest([(toc, "Area", [(top, "--TOP--", [(page, "Slides", [])])])])
    r = bb._Reader(str(tmp_path))
    assert r.pkg.xid_asset("5_1") is None and r.pkg.xid_asset("6_1").name == "notes.xml"
    course = r.read()
    assert [type(pt).__name__ for pt in course.sections[0].items[0].parts] == ["HtmlPart"]
    assert course.skipped == [("Slides.pdf", "file", "missing from the export")] and course.warnings == []


def test_banner_stored_next_to_resource_and_extensionless_files(tmp_path):
    p = Pkg(tmp_path)
    settings = p.res("course/x-bb-coursesetting", course_xml(banner="/xid-42_1", extra=(
        '<REGISTRY><REGISTRYENTRY key="banner_thumbnail_url" value="/xid-57_1"/></REGISTRY>')))
    write(tmp_path, f"{settings}/xid-42_1", b"\xff\xd8\xff\xe0JFIF")
    write(tmp_path, "csfiles/home_dir/__xid-57_1", b"GIF89a....")
    write(tmp_path, "csfiles/home_dir/__xid-58_1", b"\x00\x00\x00\x18ftypisom")
    write(tmp_path, "csfiles/home_dir/__xid-59_1", b"plain")
    p.manifest([])
    course = bb.read(str(tmp_path))
    assert course.thumbnail.name == "file.gif"
    pkg = bb._Package(str(tmp_path))
    assert pkg.xid_asset("42_1").name == "file.jpg"
    assert pkg.xid_asset("58_1").name == "file.mp4" and pkg.xid_asset("59_1").name == "file"
    # without the thumbnail entry the banner stored next to the course settings is used
    write(tmp_path, f"{settings}.dat", course_xml(banner="/xid-42_1"))
    assert bb.read(str(tmp_path)).thumbnail.name == "file.jpg"


def test_snapshot_pointer_and_internal_links(tmp_path):
    p = Pkg(tmp_path)
    toc = p.res("course/x-bb-coursetoc", toc_xml("Area"))
    top = p.res("resource/x-bb-document", content_xml("_1_1", "--TOP--", "resource/x-bb-folder",
                                                      parent="{unset id}", is_folder=True))
    body = ('<p><img src="@X@EmbeddedFile.location@X@zero.webp"></p><p><a href="@X@EmbeddedFile.requestUrlStub'
            '@X@webapps/blackboard/content/listContentEditable.jsp?content_id=_1_1&amp;course_id=_2_1">Week 2</a></p>')
    page = p.res("resource/x-bb-document", content_xml("_2_1", "Page", body=body))
    write(tmp_path, f"{page}/embedded/zero.webp", b"eyJzbmFwc2hvdFBhdGgiOiIvMmRhaWx5In0=")
    p.manifest([(toc, "Area", [(top, "--TOP--", [(page, "Page", [])])])])
    part = bb.read(str(tmp_path)).sections[0].items[0].parts[0]
    assert 'href="#"' in part.content.html and "listContentEditable" not in part.content.html
    assert part.content.resolve("@X@EmbeddedFile.location@X@zero.webp") is None


@pytest.mark.parametrize("raw,label", [
    ("COURSE_DEFAULT.CourseDocuments.CONTENT_LINK.label", "Course Documents"),
    ("content.Assignments.label", "Assignments"),
    ("course_tools_area.Tools.label", "Tools"),
    ("COURSE_DEFAULT.ALLCAPS.label", "COURSE_DEFAULT.ALLCAPS.label"),
    ("My Grades", "My Grades"),
])
def test_i18n_menu_labels(raw, label):
    assert bb._label(raw) == label


def test_object_players_become_media_tags():
    out = bb._object_params(
        '<object classid="x"><param name="URL" value="@X@EmbeddedFile.location@X@clock.avi"></object>'
        '<object><param name="FileName" value="talk.wma"></object>'
        '<object><param name="movie" value="anim.swf"></object>'
        '<object data="x.pdf"></object><object></object>')
    assert '<video src="@X@EmbeddedFile.location@X@clock.avi"></video>' in out
    assert '<audio src="talk.wma"></audio>' in out
    assert '<object data="anim.swf">' in out and '<object data="x.pdf">' in out


def test_object_param_in_page_and_display_names(tmp_path):
    p = Pkg(tmp_path)
    toc = p.res("course/x-bb-coursetoc", toc_xml("Area"))
    top = p.res("resource/x-bb-document", content_xml("_1_1", "--TOP--", "resource/x-bb-folder",
                                                      parent="{unset id}", is_folder=True))
    page = p.res("resource/x-bb-document", content_xml(
        "_2_1", "Demo", body='<OBJECT><PARAM name="URL" value="@X@EmbeddedFile.location@X@clock.avi"></OBJECT>',
        files=[("photo.jpg", "Graham is 2.")]))
    write(tmp_path, f"{page}/embedded/clock.avi", b"RIFF....AVI ")
    write(tmp_path, f"{page}/photo.jpg", PNG)
    p.manifest([(toc, "Area", [(top, "--TOP--", [(page, "Demo", [])])])])
    item = bb.read(str(tmp_path)).sections[0].items[0]
    assert "<video" in item.parts[0].content.html
    assert item.parts[0].content.resolve("@X@EmbeddedFile.location@X@clock.avi").name == "clock.avi"
    assert item.parts[1].asset.name == "Graham is 2.jpg"
    assert bb._display_name("Report.PDF", "pdf") == "Report.PDF" and bb._display_name("x", "") == "x"


def test_true_false_key_matches_choice_case_insensitively():
    q = parse(item_xml("True/False", "Sky?", choice_response([("true", "true"), ("false", "false")], plain=True),
                       correct_cond(veq("True"), title="")))
    assert [c.correct for c in q.choices] == [True, False]


def test_unlinked_tests_are_kept_unpublished_silently(tmp_path):
    p = Pkg(tmp_path)
    for i in range(12):
        p.res("assessment/x-bb-qti-test", assessment_xml(f"T{i}", [mc_item()]), f"T{i}")
    page = p.res("resource/x-bb-document", content_xml("_1_1", "Page", body="<p>x</p>"))
    p.manifest([(page, "Page", [])])
    course = bb.read(str(tmp_path))
    pools = course.sections[-1]
    assert pools.title == "Question pools" and not pools.visible
    assert [i.title for i in pools.items] == [f"T{i}" for i in range(12)]
    assert all(not i.visible and i.questions for i in pools.items)
    # Kept unpublished: a design difference the docs cover, so neither a warning nor a skipped item
    assert course.warnings == [] and course.skipped == []


def test_pool_export_becomes_unpublished_assessments(tmp_path):
    # Pool exports (Pool_ExportFile_*.zip) and publisher test banks have no course content
    p = Pkg(tmp_path)
    write(tmp_path, ".bb-package-info", PACKAGE_INFO + "cx.config.course.id=ENGR_102_F24\n# comment\nnoequals\n")
    p.res("assessment/x-bb-qti-pool", assessment_xml("Chapter 1 bank", [mc_item(), mc_item(oid="_2_1")]),
          "Chapter 1 bank")
    p.res("assessment/x-bb-qti-pool", assessment_xml("Empty bank", []), "Empty bank")
    p.res("assessment/x-bb-qti-pool", "<BROKEN")
    p.res("course/x-bb-coursetoc", toc_xml("Course Information"))
    p.manifest([])
    course = bb.read(str(tmp_path))
    assert course.title == "ENGR 102 F24" and course.short_name == "ENGR_102_F24"
    (section,) = course.sections
    assert section.title == "Question pools"
    (bank,) = section.items
    assert isinstance(bank, ir.Assessment) and bank.visible is False and len(bank.questions) == 2
    assert "Read carefully" in bank.intro.html
    # The pool file that does not parse is a genuine problem, reported once; nothing else is
    (warning,) = course.warnings
    assert warning.startswith("res00003.dat could not be parsed: ")
    assert course.skipped == []


def test_title_falls_back_to_single_content_area(tmp_path):
    p = Pkg(tmp_path)
    toc = p.res("course/x-bb-coursetoc", toc_xml("Astronomy"))
    top = p.res("resource/x-bb-document", content_xml("_1_1", "--TOP--", "resource/x-bb-folder",
                                                      parent="{unset id}", is_folder=True))
    page = p.res("resource/x-bb-document", content_xml("_2_1", "Preface", "resource/x-bb-externallink",
                                                       url="https://openstax.org/books/astronomy/pages/preface"))
    p.manifest([(toc, "Astronomy", [(top, "--TOP--", [(page, "Preface", [])])])])
    os.remove(os.path.join(str(tmp_path), ".bb-package-info"))
    course = bb.read(str(tmp_path))
    assert course.title == "Astronomy" and course.short_name == ""


def build_legacy(root):
    """Blackboard 5.5/6.0 export: <tableofcontents>, title attributes, baseurl, MAINDATA, FILEREF."""
    def res(ident, rtype, xml, hrefs=()):
        write(root, f"{ident}.dat", '<?xml version="1.0" encoding="UTF-8"?>\n' + xml)
        files = "".join(f'<file href="{h}"/>' for h in hrefs)
        return f'<resource baseurl="{ident}" file="{ident}.dat" identifier="{ident}" type="{rtype}">{files}</resource>'

    def content(title, text="", folder=False, files="", extra="", ishtml=True, available=True, lesson="n"):
        main = (f'<MAINDATA><TEXT>{escape(text)}</TEXT><FLAGS><ISHTML value="{str(ishtml).lower()}"/></FLAGS>'
                f'</MAINDATA>') if text else ""
        return (f'<CONTENT><CONTENTTYPE value="co2"/><TITLE>{escape(title)}</TITLE>{main}<FLAGS>'
                f'<ISAVAILABLE value="{str(available).lower()}"/><ISFOLDER value="{str(folder).lower()}"/>'
                f'<LESSONTYPE value="{lesson}"/></FLAGS><FILES>{files}{extra}</FILES></CONTENT>')

    def fileref(rel, link):
        return f'<FILEREF><RELFILE value="{rel}"/><LINKNAME value="{escape(link)}"/><FILEACTION value="link"/></FILEREF>'

    def start(kind, target):
        return (f'<STARTASSESSMENT id="1"><ATTRIB key="assessment_id" value="{target}"/>'
                f'<ATTRIB key="assessment_type" value="{kind}"/></STARTASSESSMENT>')

    resources = [
        res("res00001", "course/x-bb-coursesetting",
            '<COURSE><COURSEID value="archiveTemplate"/><TITLE value="Archive Template"/>'
            '<DESCRIPTION>A course with a little of everything.</DESCRIPTION><BANNER value="banner.jpg"/></COURSE>',
            ("banner.jpg",)),
        res("res00002", "resource/x-bb-document", content("Feedback", "<!-- @X@start(1)@X@ -->",
                                                          extra=start("survey", "res00013"))),
        res("res00004", "resource/x-bb-document", content("Field Trips", "Let's take a trip!", folder=True)),
        res("res00005", "resource/x-bb-document", content("Paris", "Line one\nLine <two>", ishtml=False)),
        res("res00006", "resource/x-bb-document", content("Photo", files=fileref("photo.jpg", "Graham is 2."),
                                                          available=False), ("photo.jpg",)),
        res("res00007", "resource/x-bb-document", content("Lesson", "Start here", folder=True, lesson="Y")),
        res("res00008", "resource/x-bb-document", content("Handout", "Read it",
                                                          files=fileref("sakai_charon.pdf", "sakai_charon.pdf"))),
        res("res00012", "resource/x-bb-document", content("Midterm", "<!-- @X@start(2)@X@ -->",
                                                          extra=start("quiz", "res00013"))),
        res("res00013", "assessment/x-bb-quiz", "<ASSESSMENT/>"),
        res("res00019", "resource/x-bb-staffinfo",
            '<STAFFINFO><BIOGRAPHY><TEXT/></BIOGRAPHY><FLAGS><ISAVAILABLE value="true"/><ISFOLDER value="true"/>'
            '</FLAGS><CONTACT><NAME><GIVEN value="Teaching assistants"/></NAME></CONTACT></STAFFINFO>'),
        res("res00020", "resource/x-bb-staffinfo",
            '<STAFFINFO><FLAGS><ISAVAILABLE value="true"/></FLAGS><CONTACT><PHONE>(512)245-1234</PHONE>'
            '<EMAIL>bugs@example.edu</EMAIL><NAME><FORMALTITLE value="Mr."/><FAMILY value="Bunny"/>'
            '<GIVEN value="Bugs"/></NAME></CONTACT></STAFFINFO>'),
        res("res00023", "resource/x-bb-document",
            '<EXTERNALLINK><TITLE value="Links folder"/><DESCRIPTION><TEXT>Some links</TEXT><FLAGS>'
            '<ISHTML value="false"/></FLAGS></DESCRIPTION><FLAGS><ISAVAILABLE value="true"/>'
            '<ISFOLDER value="true"/></FLAGS><URL value="http://"/></EXTERNALLINK>'),
        res("res00024", "resource/x-bb-document",
            '<EXTERNALLINK><TITLE value="Slashdot"/><DESCRIPTION><TEXT>News for nerds</TEXT></DESCRIPTION>'
            '<FLAGS><ISAVAILABLE value="true"/><ISFOLDER value="false"/></FLAGS>'
            '<URL value="http://slashdot.org"/></EXTERNALLINK>'),
        res("res00025", "assessment/x-bb-pool", "<POOL/>"),
    ]
    write(root, "res00001/banner.jpg", PNG)
    write(root, "res00006/photo.jpg", PNG)
    write(root, "res00008/sakai_charon.pdf", PDF)
    toc = (
        '<item identifier="i1" title="Course Information"><item identifier="i2" identifierref="res00002" '
        'title="Feedback"/></item>'
        '<item identifier="i3" title="Course Documents"><item identifier="i4" identifierref="res00004" '
        'title="Field Trips"><item identifier="i5" identifierref="res00005" title="Paris"/>'
        '<item identifier="i6" identifierref="res00006" title="Photo"/></item>'
        '<item identifier="i7" identifierref="res00007" title="Lesson"><item identifier="i8" '
        'identifierref="res00008" title="Handout"/></item></item>'
        '<item identifier="i9" title="Assignments"><item identifier="i10" identifierref="res00012" title="Midterm"/>'
        '</item>'
        '<item identifier="i11" title="Staff Information"><item identifier="i12" identifierref="res00019" '
        'title="Teaching assistants"><item identifier="i13" identifierref="res00020" title="Bunny, Bugs"/></item>'
        '</item>'
        '<item identifier="i14" title="External Links"><item identifier="i15" identifierref="res00023" '
        'title="Links folder"><item identifier="i16" identifierref="res00024" title="Slashdot"/></item></item>'
    )
    write(root, "imsmanifest.xml",
          '<?xml version="1.0" encoding="UTF-8"?>\n<manifest identifier="man00001"><organizations default="toc00001">'
          f'<tableofcontents identifier="toc00001">{toc}</tableofcontents></organizations>'
          f'<resources>{"".join(resources)}</resources></manifest>')


def test_read_legacy_blackboard_6_export(tmp_path):
    build_legacy(tmp_path)
    assert bb.detect(str(tmp_path)) == 95
    course = bb.read(str(tmp_path))
    assert course.title == "Archive Template" and course.short_name == "archiveTemplate"
    assert course.thumbnail.name == "banner.jpg"
    titles = [s.title for s in course.sections]
    # "Assignments" only holds the pre-QTI midterm, so it is reported instead of becoming an empty chapter
    assert titles == ["Course Documents › Field Trips", "Course Documents › Lesson", "Staff Information",
                      "External Links › Links folder"]
    trips, lesson, staff, links = course.sections
    assert "take a trip" in trips.summary.html
    paris, photo = trips.items
    assert paris.parts[0].content.html == "Line one<br>Line &lt;two&gt;"
    assert photo.visible is False and photo.parts[0].asset.name == "Graham is 2.jpg"
    assert lesson.items[0].parts[1].kind == ir.MediaKind.PDF
    assert [i.title for i in staff.items] == ["Teaching assistants", "Mr. Bugs Bunny"]
    assert "bugs@example.edu" in staff.items[1].parts[0].content.html
    assert "Some links" in links.summary.html
    slashdot = links.items[0]
    assert slashdot.parts[-1].url == "http://slashdot.org" and "News for nerds" in slashdot.parts[0].content.html
    assert course.warnings == []
    # Items of the dropped areas plus the pre-QTI resources themselves (untitled in a 6.0 manifest)
    assert ("Feedback", "survey", "not imported") in course.skipped
    assert ("Midterm", "quiz", bb._LEGACY_REASON) in course.skipped
    assert ("res00013", "quiz", bb._LEGACY_REASON) in course.skipped
    assert ("res00025", "question pool", bb._LEGACY_REASON) in course.skipped


def test_manifest_resource_without_identifier_is_skipped(tmp_path):
    p = Pkg(tmp_path)
    settings = p.res("course/x-bb-coursesetting", course_xml())
    p.manifest([])
    manifest = tmp_path / "imsmanifest.xml"
    manifest.write_text(manifest.read_text().replace(
        "<resources>", '<resources><resource type="resource/x-bb-document" bb:file="ghost.dat"/>'))
    pkg = bb._Package(str(tmp_path))
    assert pkg.order == [settings] and "" not in pkg.resources
    assert bb.read(str(tmp_path)).title == "Biology 101"


def test_dangling_links_and_plain_xml_in_the_content_collection(tmp_path):
    # Trimmed archives can keep symlinks whose targets are gone, and XML that is not a LOM sidecar
    p = Pkg(tmp_path)
    settings = p.res("course/x-bb-coursesetting", course_xml(banner="/xid-42_1"))
    write(tmp_path, "csfiles/home_dir/config.xml", "<settings/>")
    os.symlink("gone.pdf", str(tmp_path / "csfiles" / "home_dir" / "__xid-5_1.pdf.xml"))
    os.makedirs(tmp_path / settings)
    os.symlink("gone.jpg", str(tmp_path / settings / "xid-42_1"))
    p.manifest([])
    pkg = bb._Package(str(tmp_path))
    # neither XML file is read as a sidecar
    assert pkg.xid_names == {} and pkg.cs_paths == {}
    # the extension-less banner cannot be sniffed, so it is not an image
    assert pkg.xid_asset("42_1").name == "file"
    assert bb.read(str(tmp_path)).thumbnail is None


def test_folder_of_tool_links_keeps_its_summary(tmp_path):
    p = Pkg(tmp_path)
    toc = p.res("course/x-bb-coursetoc", toc_xml("Area"))
    top = p.res("resource/x-bb-document", content_xml("_1_1", "--TOP--", "resource/x-bb-folder",
                                                      parent="{unset id}", is_folder=True))
    folder = p.res("resource/x-bb-document", content_xml("_2_1", "Tools", "resource/x-bb-folder", parent="_1_1",
                                                         is_folder=True, body="<p>Use the discussion board.</p>"))
    forum = p.res("resource/x-bb-document", content_xml("_3_1", "Forum", "resource/x-bb-forumlink", parent="_2_1"))
    p.manifest([(toc, "Area", [(top, "--TOP--", [(folder, "Tools", [(forum, "Forum", [])])])])])
    course = bb.read(str(tmp_path))
    # The tool links are reported and dropped; the folder stays as a chapter for its summary
    assert [(s.title, s.items) for s in course.sections] == [("Tools", [])]
    assert "discussion board" in course.sections[0].summary.html
    assert course.skipped == [("Forum", "discussion", "not imported")]


def test_document_with_an_address_gets_a_link_part(tmp_path):
    p = Pkg(tmp_path)
    toc = p.res("course/x-bb-coursetoc", toc_xml("Area"))
    top = p.res("resource/x-bb-document", content_xml("_1_1", "--TOP--", "resource/x-bb-folder",
                                                      parent="{unset id}", is_folder=True))
    page = p.res("resource/x-bb-document", content_xml("_2_1", "Reading", body="<p>Read this</p>",
                                                       url="www.example.edu/reading"))
    p.manifest([(toc, "Area", [(top, "--TOP--", [(page, "Reading", [])])])])
    item = bb.read(str(tmp_path)).sections[0].items[0]
    assert [type(pt).__name__ for pt in item.parts] == ["HtmlPart", "LinkPart"]
    assert item.parts[1].url == "https://www.example.edu/reading" and item.parts[1].title == "Reading"


def test_ultra_document_with_its_own_body(tmp_path):
    p = Pkg(tmp_path)
    toc = p.res("course/x-bb-coursetoc", toc_xml("Area"))
    top = p.res("resource/x-bb-document", content_xml("_1_1", "--TOP--", "resource/x-bb-folder",
                                                      parent="{unset id}", is_folder=True))
    doc = p.res("resource/x-bb-document", content_xml(
        "_2_1", "Overview", "resource/x-bb-folder", parent="_1_1", is_folder=True, folder_type="BB_PAGE",
        body="<p>Summary first</p>"))
    doc_body = p.res("resource/x-bb-document", content_xml("_3_1", "ultraDocumentBody", parent="_2_1",
                                                           body="<p>Details</p>"))
    p.manifest([(toc, "Area", [(top, "--TOP--", [(doc, "Overview", [(doc_body, "ultraDocumentBody", [])])])])])
    page = bb.read(str(tmp_path)).sections[0].items[0]
    assert isinstance(page, ir.Page) and page.title == "Overview"
    assert [type(pt).__name__ for pt in page.parts] == ["HtmlPart", "HtmlPart"]
    assert "Summary first" in page.parts[0].content.html and "Details" in page.parts[1].content.html


def test_staff_entries_that_are_not_staff_records_are_dropped(tmp_path):
    p = Pkg(tmp_path)
    staff_toc = p.res("course/x-bb-coursetoc", toc_xml("Staff", "APPLICATION", handle="staff_information"))
    odd = p.res("resource/x-bb-staffinfo", content_xml("_1_1", "Not a person"))
    broken = p.res("resource/x-bb-staffinfo", "<STAFFINFO")
    person = p.res("resource/x-bb-staffinfo", (
        '<STAFFINFO id="_2_1"><TITLE value="Lecturer Jo"/><FLAGS><ISAVAILABLE value="true"/></FLAGS>'
        '<CONTACT><NAME><GIVEN value="Jo"/></NAME><EMAIL value="jo@example.edu"/></CONTACT></STAFFINFO>'))
    p.manifest([(staff_toc, "Staff", []), ("", "placeholder/staff-info", [
        (odd, "Odd", []), (broken, "Broken", []), (person, "Lecturer Jo", [])])])
    course = bb.read(str(tmp_path))
    assert [i.title for i in course.sections[0].items] == ["Lecturer Jo"]
    assert len(course.warnings) == 1 and course.warnings[0].startswith(f"{broken}.dat could not be parsed")


def test_gradebook_column_with_unknown_assessment_id_falls_back_to_the_title(tmp_path):
    p = Pkg(tmp_path)
    toc = p.res("course/x-bb-coursetoc", toc_xml("Tests"))
    top = p.res("resource/x-bb-document", content_xml("_1_1", "--TOP--", "resource/x-bb-folder",
                                                      parent="{unset id}", is_folder=True))
    link = p.res("resource/x-bb-document", content_xml("_2_1", "Pop quiz", "resource/x-bb-asmt-test-link"))
    p.res("assessment/x-bb-qti-test", assessment_xml("Pop quiz", [mc_item()], oid="_1_1"), "Pop quiz")
    # The column names an assessment id no resource, content item or QTI object carries
    p.res("course/x-bb-gradebook", gradebook_xml([(link, "_404_1", "", "10")]))
    p.manifest([(toc, "Tests", [(top, "--TOP--", [(link, "Pop quiz", [])])])])
    course = bb.read(str(tmp_path))
    quiz = course.sections[0].items[0]
    assert isinstance(quiz, ir.Assessment) and quiz.title == "Pop quiz" and len(quiz.questions) == 1
    assert course.warnings == [] and course.skipped == []
