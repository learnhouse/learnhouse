"""
D2L Brightspace reader.

The synthetic exports below follow real Brightspace "Export Components"
packages: an IMS CP manifest with ``d2l_2p0:material_type`` resources,
quickLinks from content topics to tools, ``quiz_d2l_*.xml`` in D2L's QTI 1.2
dialect (``qti_metadatafield``, answers keyed on response labels,
``D2L_Correct``/``D2L_Incorrect`` counters), ``questiondb.xml``,
``dropbox_d2l.xml`` and the discussion/news/survey files.
"""

from __future__ import annotations

import io
import json
import os
import zipfile
from html import escape

from urllib.parse import urlparse

import pytest

from src.services.courses.lms_import import ir
from src.services.courses.lms_import.convert import convert, detect as detect_all
from src.services.courses.lms_import.sources import brightspace as bs
from src.services.courses.lms_import.xmlutil import parse_bytes

D2L_NS = 'xmlns:d2l_2p0="http://desire2learn.com/xsd/d2lcp_v2p0"'
PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


# ---------------------------------------------------------------------------
# Builders
# ---------------------------------------------------------------------------


def write(root, rel: str, data) -> str:
    path = os.path.join(str(root), *rel.split("/"))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data.encode("utf-8") if isinstance(data, str) else data)
    return path


def meta(qtype: str = "", weight: str = "1.000000000") -> str:
    fields = '<qti_metadatafield><fieldlabel>qmd_computerscored</fieldlabel><fieldentry>yes</fieldentry></qti_metadatafield>'
    if qtype:
        fields += (f'<qti_metadatafield><fieldlabel>qmd_questiontype</fieldlabel><fieldentry>{qtype}</fieldentry>'
                   '</qti_metadatafield>')
    if weight:
        fields += (f'<qti_metadatafield><fieldlabel>qmd_weighting</fieldlabel><fieldentry>{weight}</fieldentry>'
                   '</qti_metadatafield>')
    return f"<itemmetadata><qtimetadata>{fields}</qtimetadata></itemmetadata>"


def mat(text: str, html_type: bool = True) -> str:
    tt = "text/html" if html_type else "text/plain"
    return f'<material><mattext texttype="{tt}">{escape(text)}</mattext></material>'


def rlabel(ident: str, text: str) -> str:
    return f'<response_label ident="{ident}"><flow_mat>{mat(text)}</flow_mat></response_label>'


def item(label: str, qtype: str, body: str, resproc: str = "", extra: str = "", weight="1.000000000",
         title: str = "") -> str:
    t = f' title="{title}"' if title else ""
    return (f'<item ident="OBJ_{label}" label="{label}" d2l_2p0:page="1"{t}>{meta(qtype, weight)}'
            f'<presentation><flow>{body}</flow></presentation>'
            f'{"<resprocessing>" + resproc + "</resprocessing>" if resproc else ""}{extra}</item>')


def cond(respident: str, value: str, score: str = "100.000000000", title: str = "", varname: str = "",
         action: str = "Set", feedback: str = "") -> str:
    t = f' title="{title}"' if title else ""
    v = f' varname="{varname}"' if varname else ""
    fb = f'<displayfeedback feedbacktype="Response" linkrefid="{feedback}"/>' if feedback else ""
    return (f'<respcondition{t}><conditionvar><varequal respident="{respident}">{value}</varequal></conditionvar>'
            f'<setvar{v} action="{action}">{score}</setvar>{fb}</respcondition>')


def lid(ident: str, labels: list[tuple[str, str]], card: str = "Single") -> str:
    inner = "".join(f'<flow_label class="Block">{rlabel(i, t)}</flow_label>' for i, t in labels)
    return f'<response_lid ident="{ident}" rcardinality="{card}"><render_choice shuffle="no">{inner}</render_choice></response_lid>'


def rstr(ident: str, label: str, boxes: int = 0) -> str:
    b = f' d2l_2p0:input_boxes="{boxes}"' if boxes else ""
    return (f'<response_str ident="{ident}" rcardinality="Single"><render_fib{b} rows="1" columns="30" prompt="Box" '
            f'fibtype="String"><response_label ident="{label}"/></render_fib></response_str>')


def tf_item(label="Q_TF") -> str:
    body = mat("Is the sky blue?", False) + lid(f"{label}_LID", [(f"{label}_A1", "True"), (f"{label}_A2", "False")])
    rp = (cond(f"{label}_LID", f"{label}_A1", feedback=f"{label}_IF1")
          + cond(f"{label}_LID", f"{label}_A2", "0.000000000", feedback=f"{label}_IF2"))
    fb = (f'<itemfeedback ident="{label}_IF1">{mat("Right!")}</itemfeedback>'
          f'<itemfeedback ident="{label}_IF2">{mat("Nope")}</itemfeedback>'
          f'<itemfeedback ident="{label}">{mat("<p>General notes</p>")}</itemfeedback>')
    return item(label, "True/False", body, rp, fb, weight="2.000000000")


def mc_item(label="Q_MC", img: str = "quizzing\\fig.png") -> str:
    body = (f'<material><mattext texttype="text/html">{escape("<p>Pick alpha</p>")}</mattext>'
            f'<matimage uri="{img}">fig.png</matimage></material>'
            + lid(f"{label}_LID", [(f"{label}_A", "alpha"), (f"{label}_B", "beta"), (f"{label}_C", "gamma")]))
    rp = "".join(cond(f"{label}_LID", f"{label}_{x}", s) for x, s in (("A", "100"), ("B", "0"), ("C", "0")))
    return item(label, "Multiple Choice", body, rp)


def ms_item(label="Q_MS") -> str:
    body = mat("<p>Even numbers?</p>") + lid(f"{label}_LID", [(f"{label}_1", "1"), (f"{label}_2", "2"),
                                                              (f"{label}_3", "3"), (f"{label}_4", "4")], "Multiple")
    r = f"{label}_LID"
    rp = (f'<respcondition title="Scoring for the correct answers" continue="yes"><conditionvar>'
          f'<varequal respident="{r}">\n {label}_2 \n</varequal><varequal respident="{r}">{label}_4</varequal>'
          f'<not><varequal respident="{r}">{label}_1</varequal><varequal respident="{r}">{label}_3</varequal></not>'
          f'</conditionvar><setvar action="Add">1</setvar></respcondition>'
          f'<respcondition title="Scoring for the incorrect answers" continue="no"><conditionvar><and><not>'
          f'<varequal respident="{r}">{label}_2</varequal></not></and></conditionvar>'
          f'<setvar action="Add">0</setvar></respcondition>')
    return item(label, "Multi-Select", body, rp)


def bank_xml() -> str:
    return (f'<?xml version="1.0" encoding="UTF-8"?><questestinterop><objectbank ident="QLIB_1" {D2L_NS}>'
            f'<section ident="SECT_A" title="Pool A">{mc_item("QB_1")}{tf_item("QB_2")}</section>'
            f'<section ident="SECT_B" title="Pool B">{ms_item("QB_3")}</section>'
            f'</objectbank></questestinterop>')


def timestamp(tag: str, y, mo, d, h=0, mi=0) -> str:
    return (f"<d2l_2p0:{tag}><d2l_2p0:timestamp><d2l_2p0:month>{mo}</d2l_2p0:month><d2l_2p0:day>{d}</d2l_2p0:day>"
            f"<d2l_2p0:year>{y}</d2l_2p0:year><d2l_2p0:hour>{h}</d2l_2p0:hour><d2l_2p0:minutes>{mi}</d2l_2p0:minutes>"
            f"<d2l_2p0:seconds>0</d2l_2p0:seconds></d2l_2p0:timestamp></d2l_2p0:{tag}>")


def quiz_xml(ident: str, title: str, code: str = "", proc: str = "", body: str = "", rubric: str = "",
             feedback: str = "", extra: str = "") -> str:
    rc = f' d2l_2p0:resource_code="{code}"' if code else ""
    rub = rubric or ('<rubric><flow_mat><material><mattext d2l_2p0:isdisplayed="no" texttype="text/html"/>'
                     '</material></flow_mat></rubric>')
    return (f'<?xml version="1.0" encoding="UTF-8"?><questestinterop {D2L_NS}>'
            f'<assessment d2l_2p0:id="1" title="{title}" ident="{ident}"{rc}>{rub}'
            f'<assessmentcontrol hintswitch="no" solutionswitch="yes" feedbackswitch="no"/>'
            f'<assess_procextension>{proc}</assess_procextension>{feedback}{extra}'
            f'<section ident="CONTAINER_SECTION">{body}</section></assessment></questestinterop>')


def manifest(items: str, resources: str, metadata: str = "", org_title: str = "") -> str:
    md = metadata or (
        '<metadata><imsmd:lom><imsmd:general><imsmd:title><imsmd:langstring xml:lang="en-us">Biology 101'
        '</imsmd:langstring></imsmd:title><imsmd:keyword><imsmd:langstring xml:lang="en-us">BIO101</imsmd:langstring>'
        '</imsmd:keyword><imsmd:language>en-us</imsmd:language><imsmd:description><imsmd:langstring>All about cells.'
        '</imsmd:langstring></imsmd:description></imsmd:general></imsmd:lom></metadata>')
    ot = f"<title>{org_title}</title>" if org_title else ""
    return (f'<?xml version="1.0" encoding="UTF-8"?><manifest identifier="D2L_6606" {D2L_NS} '
            f'xmlns:imsmd="http://www.imsglobal.org/xsd/imsmd_rootv1p2p1" '
            f'xmlns="http://www.imsglobal.org/xsd/imscp_v1p1">{md}<organizations default="d2l_orgs">'
            f'<organization identifier="d2l_org">{ot}{items}</organization></organizations>'
            f'<resources>{resources}</resources></manifest>')


def res(ident: str, mtype: str, href: str = "", title: str = "") -> str:
    return (f'<resource identifier="{ident}" type="webcontent" d2l_2p0:material_type="{mtype}" '
            f'd2l_2p0:link_target="" href="{escape(href)}" title="{title}" />')


def topic(ident: str, title: str, ref: str, attrs: str = "", desc: str = "") -> str:
    return (f'<item identifier="{ident}" identifierref="{ref}" d2l_2p0:id="{ident}" description="{escape(desc)}" '
            f'completion_type="2"{attrs}><title>{title}</title></item>')


def module(ident: str, title: str, inner: str, attrs: str = "", desc: str = "") -> str:
    return (f'<item identifier="{ident}" identifierref="RES_CONTENT_{ident}" d2l_2p0:id="{ident}" '
            f'description="{escape(desc)}" completion_type="2"{attrs}><title>{title}</title>{inner}</item>')


def ql(kind: str, code: str, key: str = "rCode") -> str:
    return f"/d2l/common/dialogs/quickLink/quickLink.d2l?ou={{orgUnitId}}&type={kind}&{key}={code}"


def scorm_zip() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("imsmanifest.xml", "<manifest/>")
        z.writestr("index.html", "<p>sco</p>")
    return buf.getvalue()


def plain_zip() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("notes/readme.txt", "hello")
    return buf.getvalue()


def build_full(root) -> str:
    root = str(root)
    # ---- content files
    write(root, "Week 1/welcome.html",
          '<html><head><title>x</title></head><body><p>Welcome!</p><img src="pic.png">'
          '<img src="/content/enforced/6606-ABC101/shared/logo.png"></body></html>')
    write(root, "Week 1/pic.png", PNG)
    write(root, "shared/logo.png", PNG)
    write(root, "images/banner.png", PNG)
    write(root, "files/syllabus.pdf", PDF)
    write(root, "files/lecture.mp4", b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 16)
    write(root, "files/podcast.mp3", b"ID3" + b"\x00" * 16)
    write(root, "files/diagram.png", PNG)
    write(root, "files/handout.docx", b"PK\x03\x04docx")
    write(root, "files/package.zip", scorm_zip())
    write(root, "files/archive.zip", plain_zip())
    write(root, "files/hidden.html", "<p>secret</p>")
    write(root, "files/brief.pdf", PDF)
    write(root, "intro.html", "<p>Start here</p>")
    write(root, "course.png", PNG)
    write(root, "quizzing/fig.png", PNG)
    write(root, "Essay/embedded/x.png", PNG)
    # ---- tool files
    write(root, "orgunitconfig/orgunitconfig.xml", '<?xml version="1.0"?><orgunit identifier="oc" code="BIO-X"/>')
    write(root, "courseimage_d2l.xml", "<course_appearance><course_image><picLocation>course.png</picLocation>"
                                       "</course_image></course_appearance>")
    random_section = (
        '<section title="Random" d2l_2p0:page="1" ident="RAND_1"><qtimetadata><qti_metadatafield><fieldlabel>'
        'qmd_numberofitems</fieldlabel><fieldentry>1</fieldentry></qti_metadatafield></qtimetadata>'
        '<itemref linkrefid="QB_1"><d2l_2p0:file href="questiondb.xml"/><d2l_2p0:points>4.0</d2l_2p0:points>'
        '</itemref><itemref linkrefid="QB_2"><d2l_2p0:points>0</d2l_2p0:points></itemref></section>')
    write(root, "quiz_d2l_1.xml", quiz_xml(
        "res_quiz_1", "Cell quiz", code="QUIZ-1",
        proc=('<d2l_2p0:intro_message d2l_2p0:isdisplayed="no" texttype="text/html"/>'
              '<d2l_2p0:password>secret</d2l_2p0:password><is_active>yes</is_active>'
              + timestamp("date_end", 2026, 3, 15, 23, 59)
              + '<d2l_2p0:time_limit>30</d2l_2p0:time_limit><d2l_2p0:enforce_time_limit>yes'
                '</d2l_2p0:enforce_time_limit><d2l_2p0:attempts_allowed>3</d2l_2p0:attempts_allowed>'),
        feedback=('<assessfeedback title="Default"><d2l_2p0:show_correct_answers>yes</d2l_2p0:show_correct_answers>'
                  '</assessfeedback>'),
        extra='<selection_ordering><order order_type="Random"/></selection_ordering>',
        body=(tf_item() + mc_item() + '<itemref linkrefid="QB_3"/><itemref linkrefid="MISSING"/>'
              '<sectionref linkrefid="SECT_A"/><sectionref linkrefid="SECT_NOPE"/>' + random_section)))
    write(root, "quiz_d2l_2.xml", quiz_xml(
        "res_quiz_2", "Direct quiz",
        rubric=('<rubric><flow_mat><material><mattext d2l_2p0:isdisplayed="yes" texttype="text/plain">Read first.'
                '</mattext></material></flow_mat></rubric>'),
        proc="<d2l_2p0:attempts_allowed>unlimited</d2l_2p0:attempts_allowed><is_active>no</is_active>",
        body=ms_item()))
    write(root, "quiz_d2l_3.xml", quiz_xml(
        "res_quiz_3", "Unlinked quiz", code="QUIZ-3",
        rubric=('<rubric><flow_mat><material><mattext d2l_2p0:isdisplayed="yes" texttype="text/html">'
                + escape("<p>Rules</p>") + '</mattext></material></flow_mat></rubric>'),
        proc=(timestamp("date_end", 2026, 13, 40) + "<d2l_2p0:due_date>2026-05-01T10:00:00</d2l_2p0:due_date>"
              '<d2l_2p0:intro_message d2l_2p0:isdisplayed="yes" texttype="text/html">'
              + escape("<p>Intro</p>") + "</d2l_2p0:intro_message>"),
        body=tf_item("Q3")))
    write(root, "quiz_d2l_4.xml", "<questestinterop><assessment")
    write(root, "questiondb.xml", bank_xml())
    write(root, "survey_d2l_9.xml", quiz_xml(
        "res_survey_9", "Course feedback",
        rubric=('<rubric><flow_mat><material><mattext d2l_2p0:isdisplayed="yes" texttype="text/html">'
                + escape("<p>Tell us</p>") + "</mattext></material></flow_mat></rubric>"),
        body=(item("S1", "Likert", mat("How was it?") + lid("S1_LID", [("S1_a", "Good"), ("S1_b", "Bad")]))
              + item("S2", "Long Answer", mat("Comments?")))))
    write(root, "survey_d2l_10.xml", quiz_xml("res_survey_10", "Empty survey"))
    write(root, "dropbox_d2l.xml", (
        f'<dropbox {D2L_NS}><category name="Unit 1" sort_order="1" id="5">'
        '<folder name="Essay" id="10" submission_type="0" out_of="20.000000000" grade_item="g1" '
        'resource_code="DROP-1" is_hidden="false"><instructions text_type="text/html"><text>'
        + escape('<p>Write it. <img src="Essay/embedded/x.png"></p>') + "</text></instructions>"
        "<date_due>2026-04-01T12:00:00</date_due><attachment_set><links>"
        '<link name="Template" url="https://docs.example.com/t" /></links><files>'
        '<file name="brief.pdf" path="files/brief.pdf"/><file name="gone.pdf" path="files/gone.pdf"/></files>'
        "</attachment_set></folder>"
        '<folder name="Paper" id="12" submission_type="2" resource_code="DROP-3"><instructions text_type="text/html">'
        "<text /></instructions></folder></category>"
        '<folder name="Journal" id="11" submission_type="1" allow_text_submission="True" is_hidden="true" '
        'resource_code="DROP-2"><instructions text_type="text/plain"><text>Line one\nLine two</text></instructions>'
        "<availability_end><availability_date>2026-06-01T00:00:00</availability_date></availability_end></folder>"
        "</dropbox>"))
    write(root, "discussion_d2l_1.xml", (
        '<discussion><forum id="1"><content><title>General</title></content><topics>'
        '<topic id="2" resource_code="TOPIC-1"><content><title>Introduce yourself</title></content></topic>'
        '<topic id="3"><content><title>Other</title></content></topic></topics></forum></discussion>'))
    write(root, "news_d2l.xml", '<news><item id="1"><headline>Hi</headline></item><item id="2"/></news>')
    write(root, "checklist_d2l.xml", "<checklist/>")

    week1 = module("100", "Week 1", "".join([
        topic("101", "Welcome", "R_WELCOME"),
        topic("102", "Syllabus", "R_PDF"),
        topic("103", "Lecture", "R_MP4", desc="<p>Watch this</p>"),
        topic("104", "Podcast", "R_MP3"),
        topic("105", "Diagram", "R_PNG", desc="<p>Look</p>"),
        topic("106", "Handout", "R_DOCX"),
        topic("107", "Package", "R_SCORM"),
        topic("108", "Archive", "R_ZIP"),
        topic("109", "Hidden notes", "R_HIDDEN", attrs=' isvisible="False"'),
        topic("110", "Missing", "R_MISSING"),
        module("120", "Readings", "".join([
            topic("121", "YouTube", "R_YT"),
            topic("122", "Vimeo", "R_VIMEO", desc="<p>Short film</p>"),
            topic("123", "Website", "R_WEB", desc="<p>Read <b>this</b></p>"),
            module("130", "Extra", topic("131", "Deep", "R_WEB2"), attrs=' isvisible="False"'),
        ])),
    ]), desc='<p><img src="images/banner.png"></p>')
    assess = module("200", "Assessments", "".join([
        topic("201", "Quiz 1", "R_QL_QUIZ", desc="<p>Topic intro</p>"),
        topic("202", "Quiz 1 again", "R_QL_QUIZ"),
        topic("203", "Essay topic", "R_QL_DROP"),
        topic("204", "Survey", "R_QL_SURVEY"),
        topic("205", "Discuss", "R_QL_DISCUSS"),
        topic("206", "Checklist", "R_QL_CHECK"),
        topic("207", "Missing quiz", "R_QL_NOPE"),
        topic("208", "Quiz 2 direct", "res_quiz_2", attrs=' due_date="2026-02-02T08:00:00"'),
        topic("209", "LTI", "RES_LTI"),
        topic("210", "Calendar", "R_D2LPAGE"),
        topic("211", "Enforced file", "R_ENFORCED"),
        topic("212", "No resource", "R_NOPE"),
        topic("213", "Bad link", "R_BAD"),
        topic("214", "Other kind", "R_QL_WEIRD"),
        topic("215", "Survey direct", "res_survey_10"),
        topic("216", "Rubric", "res_rubrics"),
    ]))
    loose = topic("300", "Course intro", "R_INTRO")
    resources = "".join([
        res("oc", "orgunitconfig", "orgunitconfig\\orgunitconfig.xml"),
        res("res_courseimage", "d2lcourseimage", "courseimage_d2l.xml"),
        res("RES_CONTENT_100", "contentmodule"), res("RES_CONTENT_120", "contentmodule"),
        res("RES_CONTENT_130", "contentmodule"), res("RES_CONTENT_200", "contentmodule"),
        res("R_WELCOME", "content", "Week 1\\welcome.html"),
        res("R_PDF", "content", "files/syllabus.pdf"),
        res("R_MP4", "content", "files/lecture.mp4"),
        res("R_MP3", "content", "files/podcast.mp3"),
        res("R_PNG", "content", "files/diagram.png"),
        res("R_DOCX", "content", "files/handout.docx"),
        res("R_SCORM", "content", "files/package.zip"),
        res("R_ZIP", "content", "files/archive.zip"),
        res("R_HIDDEN", "content", "files/hidden.html"),
        res("R_MISSING", "content", "files/missing.html"),
        res("R_INTRO", "content", "intro.html"),
        res("R_YT", "contentlink", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
        res("R_VIMEO", "contentlink", "https://vimeo.com/123456"),
        res("R_WEB", "contentlink", "https://example.com/page"),
        res("R_WEB2", "contentlink", "https://example.com/deep"),
        res("R_QL_QUIZ", "contentlink", ql("quiz", "QUIZ-1")),
        res("R_QL_DROP", "contentlink", ql("dropbox", "drop-1", key="rcode")),
        res("R_QL_SURVEY", "contentlink", ql("survey", "res_survey_9")),
        res("R_QL_DISCUSS", "contentlink", ql("discuss", "TOPIC-1")),
        res("R_QL_CHECK", "contentlink", ql("checklist", "C-1")),
        res("R_QL_NOPE", "contentlink", ql("quiz", "NOPE")),
        res("R_QL_WEIRD", "contentlink", ql("", "X")),
        res("R_D2LPAGE", "contentlink", "/d2l/le/calendar/6606"),
        res("R_ENFORCED", "contentlink", "/content/enforced/6606-ABC101/files/syllabus.pdf"),
        res("R_BAD", "contentlink", "//[bad/quickLink.d2l?type=quiz"),
        res("res_quiz_1", "d2lquiz", "quiz_d2l_1.xml", "Cell quiz"),
        res("res_quiz_2", "d2lquiz", "quiz_d2l_2.xml", "Direct quiz"),
        res("res_quiz_3", "d2lquiz", "quiz_d2l_3.xml", "Unlinked quiz"),
        res("res_quiz_4", "d2lquiz", "quiz_d2l_4.xml", "Broken quiz"),
        res("res_quiz_99", "d2lquiz", "quiz_d2l_99.xml", "Lost quiz"),
        res("res_question_library", "d2lquestionlibrary", "questiondb.xml"),
        res("res_survey_9", "d2lsurvey", "survey_d2l_9.xml"),
        res("res_survey_10", "d2lsurvey", "survey_d2l_10.xml"),
        res("res_dropbox", "d2ldropbox", "dropbox_d2l.xml"),
        res("res_discuss_1", "d2ldiscussion", "discussion_d2l_1.xml"),
        res("res_news", "d2lnews", "news_d2l.xml"),
        res("res_checklist", "d2lchecklist", "checklist_d2l.xml"),
        res("res_rubrics", "d2lrubrics", "rubrics_d2l.xml"),
        res("RES_LTI", "imsbasiclti_xmlv1p0", "basic_lti_link_1.xml"),
        res("res_fancy", "d2lfancy", "fancy.xml"),
        res("res_syllabus", "d2lsyllabus", "syllabus_d2l.xml"),
    ])
    write(root, "rubrics_d2l.xml", "<rubrics/>")
    write(root, "basic_lti_link_1.xml", "<cartridge_basiclti_link/>")
    write(root, "fancy.xml", "<x/>")
    write(root, "syllabus_d2l.xml", "<syllabus/>")
    write(root, "imsmanifest.xml", manifest(week1 + assess + loose, resources))
    return root


@pytest.fixture
def full(tmp_path):
    root = build_full(tmp_path / "export")
    return bs.read(root)


def section(course: ir.Course, title: str) -> ir.Section:
    return next(s for s in course.sections if s.title == title)


def by_title(sec: ir.Section, title: str):
    return next(i for i in sec.items if i.title == title)


def q_from(xml: str, resolve=ir.no_resolver) -> ir.Question:
    root = parse_bytes(f"<questestinterop {D2L_NS}>{xml}</questestinterop>".encode())
    return bs._ItemParser(resolve).parse(root.find("item"))


# ---------------------------------------------------------------------------
# detect
# ---------------------------------------------------------------------------


def test_detect_d2l_manifest(tmp_path):
    write(tmp_path, "imsmanifest.xml", manifest("", ""))
    assert bs.detect(str(tmp_path)) == 97  # outranks a stale Canvas course_settings/ folder


def test_detect_tool_files_without_manifest(tmp_path):
    write(tmp_path, "quiz_d2l_12.xml", "<x/>")
    assert bs.detect(str(tmp_path)) == 95


def test_detect_generic_package_is_not_d2l(tmp_path):
    write(tmp_path, "imsmanifest.xml", '<manifest xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"/>')
    write(tmp_path, "page.html", "<p/>")
    assert bs.detect(str(tmp_path)) == 0


def test_detect_unreadable(tmp_path):
    assert bs.detect(str(tmp_path / "nope")) == 0
    os.makedirs(tmp_path / "imsmanifest.xml")  # a directory: open() fails
    assert bs.detect(str(tmp_path)) == 0


def test_convert_detect_picks_brightspace(tmp_path):
    root = build_full(tmp_path / "export")
    assert detect_all(root)[0].key == "brightspace"


# ---------------------------------------------------------------------------
# Full export
# ---------------------------------------------------------------------------


def test_course_metadata(full):
    assert full.title == "Biology 101"
    assert full.short_name == "BIO101"
    assert full.language == "en-us"
    assert full.id == "D2L_6606"
    assert full.source == "brightspace"
    assert "All about cells" in full.summary.html
    assert full.thumbnail is not None and full.thumbnail.path.endswith("course.png")


def test_section_layout(full):
    titles = [s.title for s in full.sections]
    assert titles[:5] == ["Week 1", "Week 1 › Readings", "Week 1 › Readings › Extra", "Assessments", "Biology 101"]
    assert titles[5:] == ["Quizzes", "Assignments: Unit 1", "Assignments"]
    week1 = section(full, "Week 1")
    assert week1.id == "100"
    assert week1.summary.resolve("images/banner.png") is not None
    extra = section(full, "Week 1 › Readings › Extra")
    assert extra.visible is False
    assert extra.items[0].visible is False
    loose = section(full, "Biology 101")
    assert [i.title for i in loose.items] == ["Course intro"]


def test_file_topics(full):
    week1 = section(full, "Week 1")
    welcome = by_title(week1, "Welcome")
    assert isinstance(welcome, ir.Page)
    html_part = welcome.parts[-1]
    assert "Welcome!" in html_part.content.html
    assert html_part.content.resolve("pic.png").path.endswith(os.path.join("Week 1", "pic.png"))
    logo = html_part.content.resolve("/content/enforced/6606-ABC101/shared/logo.png")
    assert logo is not None and logo.path.endswith(os.path.join("shared", "logo.png"))
    assert html_part.content.resolve("/content/enforced/6606-ABC101/nowhere.png") is None
    assert html_part.content.resolve("/content/enforced/6606-ABC101/nowhere.png") is None  # cached
    assert html_part.content.resolve("http://[bad") is None

    assert isinstance(by_title(week1, "Syllabus"), ir.DocumentItem)
    lecture = by_title(week1, "Lecture")
    assert isinstance(lecture, ir.VideoItem) and lecture.asset.name == "lecture.mp4"
    assert "Watch this" in lecture.description.html
    podcast = by_title(week1, "Podcast")
    assert isinstance(podcast, ir.Page) and podcast.parts[0].kind == ir.MediaKind.AUDIO
    diagram = by_title(week1, "Diagram")
    assert isinstance(diagram.parts[0], ir.HtmlPart) and diagram.parts[1].kind == ir.MediaKind.IMAGE
    handout = by_title(week1, "Handout")
    assert isinstance(handout.parts[0], ir.FilePart) and handout.parts[0].asset.name == "handout.docx"
    assert isinstance(by_title(week1, "Package"), ir.ScormItem)
    archive = by_title(week1, "Archive")
    assert isinstance(archive, ir.Page) and isinstance(archive.parts[0], ir.FilePart)
    assert by_title(week1, "Hidden notes").visible is False
    missing = by_title(week1, "Missing")
    assert isinstance(missing, ir.UnsupportedItem) and missing.kind == "file"
    assert missing.reason == "missing from the export"  # the writer reports it; no warning
    assert not any("missing.html" in w for w in full.warnings)


def test_link_topics(full):
    readings = section(full, "Week 1 › Readings")
    yt = by_title(readings, "YouTube")
    assert isinstance(yt, ir.VideoItem) and urlparse(yt.url).hostname == "www.youtube.com"
    assert yt.description is None
    vimeo = by_title(readings, "Vimeo")
    assert isinstance(vimeo, ir.VideoItem) and "Short film" in vimeo.description.html
    web = by_title(readings, "Website")
    link = web.parts[0]
    assert isinstance(link, ir.LinkPart) and link.url == "https://example.com/page"
    assert link.description == "Read this"


def test_tool_links(full):
    sec = section(full, "Assessments")
    quiz = by_title(sec, "Cell quiz")
    assert isinstance(quiz, ir.Assessment)
    assert quiz.intro.html == "<p>Topic intro</p>"  # quiz had no intro: topic description used
    assert not any(i.title == "Quiz 1 again" for i in sec.items)  # linked twice: imported once, silently

    essay = by_title(sec, "Essay")
    assert isinstance(essay, ir.AssignmentItem)
    survey = by_title(sec, "Course feedback")
    assert isinstance(survey, ir.Page)

    discuss = by_title(sec, "Discuss")
    assert isinstance(discuss, ir.UnsupportedItem) and "Introduce yourself" in discuss.reason
    checklist = by_title(sec, "Checklist")
    assert checklist.kind == "checklist"
    assert by_title(sec, "Missing quiz").reason.startswith("the linked quiz is not in the export")
    direct = by_title(sec, "Direct quiz")
    assert isinstance(direct, ir.Assessment) and direct.due_date == "2026-02-02T08:00:00+00:00"
    lti = by_title(sec, "LTI")
    assert isinstance(lti, ir.UnsupportedItem) and lti.kind == "LTI tool"
    assert by_title(sec, "Calendar").kind == "link"
    assert isinstance(by_title(sec, "Enforced file"), ir.DocumentItem)
    assert not any(i.title == "No resource" for i in sec.items)
    assert ("No resource", "topic", "missing from the export") in full.skipped
    assert by_title(sec, "Bad link").kind == "link"
    assert by_title(sec, "Other kind").kind == "tool"
    assert isinstance(by_title(sec, "Empty survey"), ir.Page)
    rubric = by_title(sec, "Rubric")
    assert rubric.kind == "rubric" and rubric.reason == "a Brightspace rubric cannot be imported"


def test_quiz_settings_and_questions(full):
    quiz = by_title(section(full, "Assessments"), "Cell quiz")
    assert quiz.id == "res_quiz_1"
    assert quiz.max_attempts == 3
    assert quiz.time_limit_minutes == 30
    assert quiz.due_date == "2026-03-15T23:59:00+00:00"
    assert quiz.show_correct_answers is True
    assert quiz.shuffle is True
    assert quiz.visible is True
    ids = [q.id for q in quiz.questions]
    # inline items, bank itemref, bank sectionref, random section refs
    assert ids == ["Q_TF", "Q_MC", "QB_3", "QB_1", "QB_2", "QB_1", "QB_2"]
    assert quiz.questions[-2].points == 4.0  # itemref points override
    assert quiz.questions[-1].points == 2.0  # zero override ignored
    mc = quiz.questions[1]
    assert mc.text.resolve("quizzing\\fig.png").path.endswith(os.path.join("quizzing", "fig.png"))
    w = "\n".join(full.warnings)
    assert "a question from the question library is missing" in w
    assert "a question library section is missing" in w
    # Design differences (password, random draw) are not warnings
    assert "password" not in w and "draws" not in w


def test_other_quizzes(full):
    direct = by_title(section(full, "Assessments"), "Direct quiz")
    assert direct.max_attempts == 0
    assert direct.visible is False  # is_active = no
    assert direct.intro.html == "<p>Read first.</p>"
    assert direct.time_limit_minutes is None
    unlinked = section(full, "Quizzes").items
    assert [q.title for q in unlinked] == ["Unlinked quiz"]
    assert unlinked[0].due_date == "2026-05-01T10:00:00+00:00"
    assert unlinked[0].intro.html == "<p>Rules</p><p>Intro</p>"
    assert unlinked[0].max_attempts == 1
    w = "\n".join(full.warnings)
    assert "quiz_d2l_4.xml could not be parsed" in w
    assert "quiz_d2l_99.xml is listed in the manifest but missing" in w


def test_assignments(full):
    essay = by_title(section(full, "Assessments"), "Essay")
    assert essay.id == "DROP-1"
    assert essay.points == 20.0 and essay.graded is True
    assert essay.due_date == "2026-04-01T12:00:00+00:00"
    assert essay.allow_file is True and essay.allow_text is False
    assert '<a href="https://docs.example.com/t">Template</a>' in essay.instructions.html
    assert essay.instructions.resolve("Essay/embedded/x.png") is not None
    assert [a.name for a in essay.attachments] == ["brief.pdf"]
    assert ("Essay: gone.pdf", "file", "missing from the export") in full.skipped

    rest = {i.title: i for s in full.sections if s.title.startswith("Assignments") for i in s.items}
    journal = rest["Journal"]
    assert journal.allow_text is True and journal.allow_file is False
    assert journal.visible is False and journal.graded is False and journal.points is None
    assert journal.instructions.html == "<p>Line one</p><p>Line two</p>"
    assert journal.due_date == "2026-06-01T00:00:00+00:00"
    paper = rest["Paper"]
    assert paper.allow_file is True
    assert section(full, "Assignments: Unit 1").items == [paper]


def test_surveys(full):
    survey = by_title(section(full, "Assessments"), "Course feedback")
    html_all = "".join(p.content.html for p in survey.parts)
    assert "Tell us" in html_all and "How was it?" in html_all
    assert "<li>Good</li><li>Bad</li>" in html_all and "Comments?" in html_all
    empty = by_title(section(full, "Assessments"), "Empty survey")
    assert "no questions" in empty.parts[0].content.html
    assert not any("Survey" in w for w in full.warnings)  # a survey becoming a page is by design


def test_skipped_tools(full):
    skipped = full.skipped
    assert ("General", "discussion", "discussions are not migrated (2 topics)") in skipped
    assert ("Announcements", "announcement", "2 announcements are not migrated") in skipped
    assert ("Checklists", "checklist", "not migrated") in skipped
    assert ("Rubrics", "rubric", "not migrated") in skipped
    assert ("LTI tool links", "LTI tool", "not migrated") in skipped
    assert ("d2lfancy", "d2lfancy", "Brightspace component not supported") in skipped
    kinds = {k for _t, k, _r in skipped}
    assert "d2lsyllabus" not in kinds and "orgunitconfig" not in kinds
    assert len(skipped) == len(set(skipped))  # no duplicates


def test_only_genuine_problems_are_warnings(full):
    """Everything else in the full export is a skipped item or a design difference."""
    assert sorted(full.warnings) == [
        '"Cell quiz": a question from the question library is missing from the export',
        '"Cell quiz": a question library section is missing from the export',
        "File quiz_d2l_99.xml is listed in the manifest but missing from the export",
        "quiz_d2l_4.xml could not be parsed and was skipped",
    ]


# ---------------------------------------------------------------------------
# Package variants
# ---------------------------------------------------------------------------


def test_tool_files_without_manifest(tmp_path):
    write(tmp_path, "quiz_d2l_5.xml", quiz_xml("res_quiz_5", "Solo", body=tf_item()))
    write(tmp_path, "questiondb.xml", bank_xml())
    write(tmp_path, "dropbox_d2l.xml", '<dropbox><folder name="Upload" id="1"/></dropbox>')
    write(tmp_path, "survey_d2l_6.xml", quiz_xml("res_survey_6", "Poll", body=item("P1", "Long Answer", mat("?"))))
    course = bs.read(str(tmp_path))
    assert course.title == "Imported course"
    assert [s.title for s in course.sections] == ["Quizzes", "Assignments", "Surveys", "Question library"]
    library = course.sections[-1]
    # No quiz uses the library: every folder is kept as an unpublished assessment
    assert not library.visible
    assert [(a.title, len(a.questions), a.visible) for a in library.items] == [("Pool A", 2, False),
                                                                             ("Pool B", 1, False)]
    assert course.warnings == [] and course.skipped == []  # a clean export reports nothing
    assert course.sections[1].items[0].title == "Upload"


def test_broken_manifest_and_tool_files(tmp_path):
    write(tmp_path, "imsmanifest.xml", "<manifest")
    write(tmp_path, "questiondb.xml", "<broken")
    write(tmp_path, "dropbox_d2l.xml", "<broken")
    write(tmp_path, "discussion_d2l_1.xml", "<broken")
    write(tmp_path, "news_d2l.xml", "<broken")
    course = bs.read(str(tmp_path))
    w = "\n".join(course.warnings)
    assert "imsmanifest.xml could not be parsed" in w
    assert "question library questiondb.xml could not be parsed" in w
    assert "dropbox_d2l.xml could not be parsed" in w
    assert course.sections == []


def test_manifest_without_organizations(tmp_path):
    write(tmp_path, "a.html", "<p>A</p>")
    write(tmp_path, "imsmanifest.xml", (
        f'<manifest identifier="D2L_1" {D2L_NS}><resources>'
        + res("R1", "content", "a.html", "Page A") + res("R2", "contentlink", "https://example.com")
        + res("R3", "content", "nothing.html") + res("R4", "contentmodule") + "</resources></manifest>"))
    write(tmp_path, "orgunitconfig/orgunitconfig.xml", '<orgunit name="Chemistry" code="CHEM1"/>')
    course = bs.read(str(tmp_path))
    assert course.title == "Chemistry" and course.short_name == "CHEM1"
    sec = course.sections[0]
    assert sec.title == "Course content"
    assert [i.title for i in sec.items] == ["Page A", "Example", "Nothing"]


def test_title_from_organization_and_module_by_children(tmp_path):
    write(tmp_path, "p.html", "<p>x</p>")
    items = ('<item identifier="m1"><title>Unit</title>'
             + topic("t1", "Page", "R1") + "</item>")
    write(tmp_path, "imsmanifest.xml", manifest(items, res("R1", "content", "p.html"), metadata="<metadata/>",
                                                org_title="Org title"))
    course = bs.read(str(tmp_path))
    assert course.title == "Org title"
    assert course.sections[0].title == "Unit" and course.sections[0].items[0].title == "Page"


def test_empty_export(tmp_path):
    write(tmp_path, "imsmanifest.xml", manifest("", "", metadata="<metadata/>"))
    course = bs.read(str(tmp_path))
    assert course.title == "Imported course" and course.sections == []


def test_html_decoding(tmp_path):
    write(tmp_path, "cp.html", b"<p>\x93quoted\x94</p>")
    write(tmp_path, "latin.html", b"<p>\x81x</p>")
    assert bs._read_text_file(str(tmp_path / "cp.html")) == "<p>“quoted”</p>"
    assert bs._read_text_file(str(tmp_path / "latin.html")) == "<p>\x81x</p>"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def test_timestamp_helper():
    assert bs._timestamp(None) is None
    el = parse_bytes(b"<d><timestamp><year>2020</year><month>2</month><day>30</day></timestamp></d>")
    assert bs._timestamp(el) is None
    # A year too large for datetime raises OverflowError, not ValueError
    huge = parse_bytes(b"<d><timestamp><year>99999999999999999999</year><month>1</month><day>1</day></timestamp></d>")
    assert bs._timestamp(huge) is None
    assert bs._timestamp(parse_bytes(b"<d>2021-01-02T03:04:05</d>")) == "2021-01-02T03:04:05+00:00"


def test_quicklink_helper():
    assert bs._quicklink("https://example.com") is None
    assert bs._quicklink(ql("quiz", "AbC")) == ("quiz", "abc")
    assert bs._quicklink("//[bad/quickLink.d2l?type=quiz") is None


def test_visible_helper():
    assert bs._visible(None) is True
    assert bs._visible(parse_bytes(b'<i isvisible="False"/>')) is False
    assert bs._visible(parse_bytes(b'<i is_hidden="true"/>')) is False
    assert bs._visible(parse_bytes(b'<i isdraft="1"/>')) is False
    assert bs._visible(parse_bytes(b'<i isvisible="True"/>')) is True


def test_eval_formula():
    assert bs.eval_formula("2 * {x} + {y} - {z}", {"x": 10, "y": 0.1, "z": 100}) == pytest.approx(-79.9)
    assert bs.eval_formula("{x}^2 + sqrt(16) + pi - PI", {"x": 3}) == pytest.approx(13)
    assert bs.eval_formula("-{x} % 4 + +1", {"x": 5}) == pytest.approx(4)
    assert bs.eval_formula("ln(e) + log(100)", {}) == pytest.approx(3)
    assert bs.eval_formula("{w}", {}) is None  # unknown variable
    assert bs.eval_formula("2 +", {}) is None
    assert bs.eval_formula("1/0", {}) is None
    assert bs.eval_formula("2^1000", {}) is None
    assert bs.eval_formula("10^200", {}) is None  # overflow
    assert bs.eval_formula("x" * 600, {}) is None
    assert bs.eval_formula("", {}) is None
    assert bs.eval_formula("__import__('os')", {}) is None
    assert bs.eval_formula("round(1.5, ndigits=1)", {}) is None
    assert bs.eval_formula("True + 1", {}) is None
    assert bs.eval_formula("sqrt(-1)", {}) is None
    assert bs.eval_formula("exp(1000)", {}) is None


# ---------------------------------------------------------------------------
# Question types
# ---------------------------------------------------------------------------


def test_true_false_with_feedback():
    q = q_from(tf_item())
    assert q.type == ir.QType.TRUEFALSE and q.points == 2.0
    assert [(c.correct, c.feedback) for c in q.choices] == [(True, "Right!"), (False, "Nope")]
    assert q.general_feedback == "<p>General notes</p>"
    assert q.source_type == "True/False"


def test_multiple_choice():
    q = q_from(mc_item())
    assert q.type == ir.QType.MULTICHOICE and not q.multiple
    assert [c.correct for c in q.choices] == [True, False, False]
    assert '<img src="quizzing\\fig.png"' in q.text.html


def test_partial_credit_option_is_not_a_second_right_answer():
    r = "P_LID"
    body = mat("Capital of France?") + lid(r, [("P_A", "Paris"), ("P_B", "Lyon"), ("P_C", "Rome")])
    rp = cond(r, "P_A", "100") + cond(r, "P_B", "25") + cond(r, "P_C", "0")
    q = q_from(item("P", "Multiple Choice", body, rp))
    assert q.type == ir.QType.MULTICHOICE and not q.multiple
    assert [c.correct for c in q.choices] == [True, False, False]


def test_multi_select_with_not_branches():
    q = q_from(ms_item())
    assert q.type == ir.QType.MULTICHOICE and q.multiple
    assert [c.correct for c in q.choices] == [False, True, False, True]


def test_multi_select_counter_variables():
    """D2L_Correct/D2L_Incorrect counters (no Set score) mark the right options."""
    r = "N_LID"
    body = mat("Pick") + lid(r, [("N_1", "a"), ("N_2", "b"), ("N_3", "c")], "Multiple")
    rp = (cond(r, "N_1", "1", varname="D2L_Correct", action="Add")
          + cond(r, "N_2", "1", varname="D2L_Incorrect", action="Add")
          + cond(r, "N_3", "1", varname="D2L_Correct", action="Add")
          + '<respcondition><setvar varname="que_score" action="Set">D2L_Correct</setvar></respcondition>')
    q = q_from(item("N", "Multi-Select", body, rp))
    assert [c.correct for c in q.choices] == [True, False, True]


def test_choice_without_choices():
    q = q_from(item("E", "Multiple Choice", mat("Q?")))
    assert q.type == ir.QType.UNSUPPORTED and q.reason == "choices could not be read"


def test_short_answer():
    body = mat("Who?", False) + rstr("S_STR", "S_ANS")
    rp = ('<respcondition><conditionvar><varequal respident="S_ANS" case="yes">Nydam</varequal></conditionvar>'
          '<setvar action="Set">100</setvar></respcondition>' + cond("S_ANS", "nydam", "50"))
    q = q_from(item("S", "Short Answer", body, rp))
    assert q.type == ir.QType.SHORTANSWER
    assert q.answers == ["Nydam", "nydam"] and q.case_sensitive


def test_short_answer_without_key_is_essay():
    q = q_from(item("S", "Short Answer", mat("Why?") + rstr("S_STR", "S_ANS")))
    assert q.type == ir.QType.ESSAY


def test_short_answer_with_several_boxes():
    body = mat("Name two") + rstr("A_STR", "A_ANS") + rstr("B_STR", "B_ANS")
    q = q_from(item("S", "Short Answer", body, cond("A_ANS", "x") + cond("B_ANS", "y")))
    assert q.type == ir.QType.CLOZE
    assert [b.answers for b in q.blanks] == [["x"], ["y"]]
    assert q.text.html.endswith("{{1}} {{2}}")


def test_multi_short_answer():
    body = mat("<p>Three colours</p>") + rstr("M_STR", "M_ANS", boxes=3)
    rp = "".join(cond("M_ANS", v, "33.33") for v in ("red", "green", "blue"))
    q = q_from(item("M", "Multi-Short Answer", body, rp, weight="6.2"))
    assert q.type == ir.QType.CLOZE and q.points == 6.2
    assert len(q.blanks) == 3 and q.blanks[0].answers == ["red", "green", "blue"]
    assert "{{3}}" in q.text.html


def test_multi_short_answer_single_box_and_no_key():
    body = mat("One colour") + rstr("M_STR", "M_ANS")
    q = q_from(item("M", "Multi-Short Answer", body, cond("M_ANS", "red")))
    assert q.type == ir.QType.SHORTANSWER and q.answers == ["red"]
    bare = '<response_str ident="X_STR"/>'
    q = q_from(item("M", "Multi-Short Answer", mat("?") + bare))
    assert q.type == ir.QType.ESSAY


def test_fill_in_the_blanks():
    body = (mat("<p>Positive numbers are to the</p>") + rstr("F1_STR", "F1_ANS")
            + mat("<p>of zero, negative to the</p>") + rstr("F2_STR", "F2_ANS"))
    rp = cond("F1_ANS", "right") + cond("F1_ANS", "guess", "50") + cond("F2_ANS", "left")
    hint = f"<hint><hintmaterial><flow_mat>{mat('<p>Think</p>')}</flow_mat></hintmaterial></hint>"
    q = q_from(item("F", "Fill in the Blanks", body, rp, hint))
    assert q.type == ir.QType.CLOZE
    assert q.text.html == "<p>Positive numbers are to the {{1}} of zero, negative to the {{2}}</p>"
    assert [b.answers for b in q.blanks] == [["right", "guess"], ["left"]]
    assert q.blanks[0].hint == "Think"


def test_fill_in_the_blanks_block_text_and_no_gaps():
    body = mat("<ul><li>a</li></ul>") + rstr("F1_STR", "F1_ANS")
    q = q_from(item("F", "Fill in the Blanks", body, cond("F1_ANS", "x")))
    assert q.text.html.startswith("<ul>")
    q = q_from(item("F", "Fill in the Blanks", mat("no gaps")))
    assert q.type == ir.QType.UNSUPPORTED and q.reason == "the blanks could not be read"


def test_long_answer_and_text_types():
    assert q_from(item("L", "Long Answer", mat("Essay"))).type == ir.QType.ESSAY
    assert q_from(item("T", "Text Information", mat("Read"))).type == ir.QType.DESCRIPTION
    img = '<material><matimage uri="quizzing\\a.png">a.png</matimage></material>'
    assert q_from(item("I", "Image", img)).type == ir.QType.DESCRIPTION


def grp(respident: str, prompt: str, labels: list[tuple[str, str]]) -> str:
    inner = "".join(rlabel(i, t) for i, t in labels)
    return (f'<response_grp respident="{respident}" rcardinality="Single">{mat(prompt)}'
            f'<render_choice shuffle="yes"><flow_label class="Block">{inner}</flow_label></render_choice></response_grp>')


def test_matching():
    labels = [("M_1", "<p><strong>1</strong></p>"), ("M_2", "2"), ("M_3", "3")]
    body = mat("letter to number") + grp("C_A", "<p>A</p>", labels) + grp("C_B", "b", labels)
    rp = (cond("C_A", "M_1", "1", varname="D2L_Correct", action="Add")
          + cond("C_A", "M_2", "1", varname="D2L_Incorrect", action="Add")
          + cond("C_B", "M_2", "1", varname="D2L_Correct", action="Add")
          + '<respcondition><conditionvar><vargte respident="D2L_Incorrect">0</vargte></conditionvar>'
            '<setvar varname="que_score" action="Set">0</setvar></respcondition>')
    q = q_from(item("MA", "Matching", body, rp, weight="5"))
    assert q.type == ir.QType.MATCHING
    assert [(p.prompt.html, p.answer) for p in q.pairs] == [("<p>A</p>", "1"), ("b", "2")]
    assert q.distractors == ["3"]


def test_matching_without_key():
    body = mat("m") + grp("C_A", "A", [("M_1", "1")])
    q = q_from(item("MA", "Matching", body))
    assert q.type == ir.QType.UNSUPPORTED and "pairs" in q.reason


def ordering_body(card="Ordered") -> str:
    labels = "".join(rlabel(i, t) for i, t in (("O_1", "c"), ("O_2", "a"), ("O_3", "b")))
    return (mat("Sort") + f'<response_grp respident="O" rcardinality="{card}"><render_choice shuffle="yes">'
            f'<flow_label class="Block">{labels}</flow_label></render_choice></response_grp>')


def test_ordering():
    rp = ""
    for ident, pos in (("O_1", 3), ("O_2", 1), ("O_3", 2)):
        rp += cond(ident, str(pos), "1", title="Correct Condition", varname="D2L_Correct", action="Add")
        rp += (f'<respcondition title="Incorrect Condition"><conditionvar><not><varequal respident="{ident}">{pos}'
               f'</varequal></not></conditionvar><setvar varname="D2L_Incorrect" action="Add">1</setvar>'
               '</respcondition>')
    q = q_from(item("O", "Ordering", ordering_body(), rp))
    assert q.type == ir.QType.ORDERING and q.ordering == ["a", "b", "c"]


def test_ordering_fallbacks():
    q = q_from(item("O", "Ordering", ordering_body(), cond("O_1", "first", "1")))
    assert q.ordering == ["c", "a", "b"]  # no numeric positions: source order
    q = q_from(item("O", "Ordering", mat("nothing")))
    assert q.type == ir.QType.UNSUPPORTED
    empty = '<response_grp respident="O"><render_choice/></response_grp>'
    q = q_from(item("O", "Ordering", mat("x") + empty))
    assert q.type == ir.QType.UNSUPPORTED and q.reason == "ordering items could not be read"


def arithmetic(formula: str, tolerance: str = '<tolerance type="units">2</tolerance>',
               precision: str = '<precision type="decimalplaces">2</precision>', units: str = "",
               qtype: str = "Arithmetic", text_html: str = "<p>Solve {x} and {y}</p>", varequal: str = "") -> str:
    variables = ('<variable name="x"><minvalue>10</minvalue><maxvalue>15</maxvalue><decimalplaces>0'
                 '</decimalplaces></variable><variable name="y"><minvalue>0.123</minvalue><maxvalue>0.9</maxvalue>'
                 '<decimalplaces>1</decimalplaces></variable><variable><minvalue>1</minvalue></variable>')
    body = (f'<material><mattext texttype="text/html">{escape(text_html)}</mattext><mat_extension>{variables}'
            f'<formula>{formula}</formula></mat_extension></material>'
            '<response_num ident="N_NUM" rcardinality="Single"><render_fib fibtype="Decimal"/></response_num>')
    ext = f"<respcond_extension><formula>{formula}</formula>{precision}{tolerance}{units}</respcond_extension>" \
        if formula else ""
    cv = varequal or "<other/>"
    rp = f'<respcondition title="Single Condition">{ext}<conditionvar>{cv}</conditionvar><setvar action="Set">100</setvar></respcondition>'
    return item("AR", qtype, body, rp, weight="3")


def test_arithmetic():
    q = q_from(arithmetic("2 * {x} + {y}", units='<units casesensitive="no">cm</units>'))
    assert q.type == ir.QType.NUMERICAL
    assert q.numeric[0].value == pytest.approx(20.1) and q.numeric[0].tolerance == 2
    assert q.unit == "cm"
    assert q.text.html == "<p>Solve 10 and 0.1</p>"
    assert "x = 10, y = 0.1" in q.general_feedback


def test_arithmetic_percent_tolerance_and_sig_figs():
    q = q_from(arithmetic("{x} / 3", tolerance='<tolerance type="percent">10</tolerance>',
                          precision='<precision type="sigfigs">3</precision>', qtype="Significant Figures"))
    assert q.numeric[0].value == pytest.approx(3.33)
    assert q.numeric[0].tolerance == pytest.approx(0.333)


def test_arithmetic_fallbacks():
    q = q_from(arithmetic("{w} + 1"))
    assert q.type == ir.QType.UNSUPPORTED and "formula could not be evaluated" in q.reason
    q = q_from(arithmetic("", varequal='<varequal respident="N_NUM">42</varequal>', text_html="<p>{z}</p>"))
    assert q.type == ir.QType.NUMERICAL and q.numeric[0].value == 42 and q.text.html == "<p>{z}</p>"
    q = q_from(arithmetic("", varequal='<varequal respident="N_NUM">abc</varequal>'))
    assert q.type == ir.QType.UNSUPPORTED and q.reason == "no numeric answer"
    q = q_from(arithmetic("", varequal='<varequal respident="N_NUM">inf</varequal>'))
    assert q.type == ir.QType.UNSUPPORTED and q.reason == "no numeric answer"
    no_vars = item("AR", "Arithmetic", mat("1+1") + '<response_num ident="N"/>',
                   '<respcondition><respcond_extension><formula>1 + 1</formula></respcond_extension>'
                   '<conditionvar><other/></conditionvar><setvar action="Set">100</setvar></respcondition>')
    q = q_from(no_vars)
    assert q.numeric[0].value == 2 and q.general_feedback == ""


def test_likert_and_unknown_types():
    q = q_from(item("LK", "Likert", mat("Agree?") + lid("LK_LID", [("a", "Yes")])))
    assert q.type == ir.QType.UNSUPPORTED and "Likert" in q.reason
    q = q_from(item("HS", "Hot Spot", mat("Click")))
    assert q.type == ir.QType.UNSUPPORTED and "Hot Spot" in q.reason


def test_unlabelled_items_are_inferred():
    tf = mat("Sky?") + lid("L", [("L1", "True"), ("L2", "False")])
    q = q_from(item("U", "", tf, cond("L", "L1"), weight=""))
    assert q.type == ir.QType.TRUEFALSE and q.points == 1.0
    q = q_from(item("U", "", mat("Name") + rstr("S", "SA"), cond("SA", "Bob"), weight=""))
    assert q.type == ir.QType.SHORTANSWER
    q = q_from(item("U", "", mat("Just text"), weight=""))
    assert q.type == ir.QType.DESCRIPTION
    q = q_from(item("U", "", mat("n") + '<response_num ident="N"/>', weight=""))
    assert q.type == ir.QType.UNSUPPORTED and q.reason == "question structure not recognized"
    q = parse_bytes(b"<item ident='x'/>")
    assert bs._ItemParser(ir.no_resolver).parse(q).type == ir.QType.DESCRIPTION


def test_metadata_without_wrappers():
    xml = ('<item ident="x" label="X"><itemmetadata><qtimetadata><fieldlabel>qmd_questiontype</fieldlabel>'
           '<fieldentry>Long Answer</fieldentry><fieldlabel></fieldlabel><fieldentry>ignored</fieldentry>'
           '<fieldlabel>qmd_weighting</fieldlabel><fieldentry>5</fieldentry></qtimetadata></itemmetadata></item>')
    q = bs._ItemParser(ir.no_resolver).parse(parse_bytes(xml.encode()))
    assert q.type == ir.QType.ESSAY and q.points == 5.0


# ---------------------------------------------------------------------------
# End to end
# ---------------------------------------------------------------------------


def test_convert_end_to_end(tmp_path):
    src = tmp_path / "src"
    write(src, "Unit/page.html", '<p>Hello <img src="dot.png"></p>')
    write(src, "Unit/dot.png", PNG)
    write(src, "files/notes.pdf", PDF)
    write(src, "quiz_d2l_1.xml", quiz_xml("res_quiz_1", "Check", code="Q1", body=tf_item() + mc_item()))
    write(src, "quizzing/fig.png", PNG)
    write(src, "dropbox_d2l.xml", (
        '<dropbox><folder name="Report" id="1" resource_code="D1" out_of="10"><instructions text_type="text/html">'
        "<text>" + escape("<p>Upload</p>") + "</text></instructions></folder></dropbox>"))
    items = module("1", "Unit 1", topic("2", "Hello", "R_PAGE") + topic("3", "Notes", "R_PDF")
                   + topic("4", "Check", "R_QUIZ") + topic("5", "Report", "R_DROP"))
    resources = (res("RES_CONTENT_1", "contentmodule") + res("R_PAGE", "content", "Unit/page.html")
                 + res("R_PDF", "content", "files/notes.pdf") + res("R_QUIZ", "contentlink", ql("quiz", "Q1"))
                 + res("R_DROP", "contentlink", ql("dropbox", "D1"))
                 + res("res_quiz_1", "d2lquiz", "quiz_d2l_1.xml") + res("res_dropbox", "d2ldropbox", "dropbox_d2l.xml"))
    write(src, "imsmanifest.xml", manifest(items, resources))
    archive = tmp_path / "export.zip"
    with zipfile.ZipFile(archive, "w") as z:
        for dirpath, _dirs, files in os.walk(src):
            for f in files:
                full = os.path.join(dirpath, f)
                z.write(full, os.path.relpath(full, src))

    out = tmp_path / "package"
    result = convert(str(archive), str(out))
    assert result.course.source == "brightspace"
    assert result.course.title == "Biology 101"
    with open(out / "manifest.json") as f:
        pkg = json.load(f)
    assert pkg["source"]["lms"] == "brightspace"
    counts = result.report.counts
    assert counts["chapters"] == 1
    assert counts["TYPE_DYNAMIC"] == 1
    assert counts["TYPE_DOCUMENT"] == 1
    assert counts["TYPE_ASSIGNMENT"] == 2
    assert counts["questions"] == 2


def test_small_edges(tmp_path):
    write(tmp_path, "broken.zip", b"not a zip")
    write(tmp_path, "dropbox_d2l.xml", '<dropbox><folder name="Lab" id="7" resource_code="LAB"/></dropbox>')
    items = (topic("1", "Lab topic", "R_LAB", desc="<p>Bring goggles</p>") + topic("2", "Broken", "R_ZIP")
             + topic("3", "Empty", "R_EMPTY") + topic("4", "No href", "R_NOHREF"))
    resources = (res("R_LAB", "contentlink", ql("dropbox", "LAB")) + res("R_ZIP", "content", "broken.zip")
                 + res("R_EMPTY", "contentlink", "") + res("R_NOHREF", "content", "") + res("res_dropbox", "d2ldropbox", "dropbox_d2l.xml"))
    write(tmp_path, "imsmanifest.xml", manifest(items, resources))
    course = bs.read(str(tmp_path))
    loose = course.sections[0]
    lab = by_title(loose, "Lab")
    assert lab.instructions.html == "<p>Bring goggles</p>"
    broken = by_title(loose, "Broken")
    assert isinstance(broken, ir.Page) and isinstance(broken.parts[0], ir.FilePart)
    assert by_title(loose, "Empty").kind == "link"
    assert by_title(loose, "No href").kind == "file"


def test_oversized_page_is_reported_not_fatal(tmp_path, monkeypatch):
    monkeypatch.setattr(bs, "MAX_TEXT_BYTES", 40)
    write(tmp_path, "big.html", "<p>" + "x" * 100 + "</p>")
    write(tmp_path, "small.html", "<p>ok</p>")
    items = (topic("1", "Big", "R_BIG") + topic("2", "Small", "R_SMALL") + topic("3", "Package", "R_SCO"))
    resources = (res("R_BIG", "content", "big.html") + res("R_SMALL", "content", "small.html")
                 + res("R_SCO", "contentlink", ql("scorm", "SC1")))
    write(tmp_path, "imsmanifest.xml", manifest(items, resources))
    course = bs.read(str(tmp_path))
    loose = course.sections[0]
    big = by_title(loose, "Big")
    assert isinstance(big, ir.UnsupportedItem) and big.kind == "file" and big.reason.startswith("unreadable file")
    assert isinstance(by_title(loose, "Small"), ir.Page)
    assert course.warnings == ["Could not read 'Big': big.html is larger than 0 MB"]
    assert by_title(loose, "Package").kind == "scorm"  # the same kind label as the other readers


def test_empty_answer_values_are_ignored():
    body = mat("Who?") + rstr("S_STR", "S_ANS")
    rp = cond("S_ANS", "") + cond("S_ANS", "Ada")
    q = q_from(item("S", "Short Answer", body, rp))
    assert q.answers == ["Ada"]


# ---------------------------------------------------------------------------
# Regressions found on real exports
# ---------------------------------------------------------------------------


def test_html_encodings(tmp_path):
    """CBE courses store every page as UTF-16 LE with a BOM; others use legacy code pages."""
    page = "<!DOCTYPE html><html><body><p>Caf\u00e9 \u2014 \u03b1</p></body></html>"
    assert bs.decode_html(page.encode("utf-16")) == page  # BOM
    assert bs.decode_html(page.encode("utf-16-le")) == page  # no BOM
    assert bs.decode_html(page.encode("utf-16-be")) == page
    assert bs.decode_html(b"\xef\xbb\xbf" + page.encode()) == page
    assert bs.decode_html(page.encode("utf-32")) == page
    cyr = '<meta charset="windows-1251"><p>\u041f\u0440\u0438\u0432\u0435\u0442</p>'
    assert bs.decode_html(cyr.encode("cp1251")) == cyr
    bogus = '<meta http-equiv="Content-Type" content="text/html; charset=x-nope"><p>\u201cq\u201d</p>'
    assert bs.decode_html(bogus.encode("cp1252")) == bogus


def test_utf16_page_and_doctype(tmp_path):
    write(tmp_path, "Lesson/l1.html", ('<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0//EN" "x.dtd">'
                                       '<html><body><p>Hamlet <img src="a.png"></p></body></html>').encode("utf-16"))
    write(tmp_path, "Lesson/a.png", PNG)
    write(tmp_path, "imsmanifest.xml", manifest(topic("1", "Lesson 1", "R1"), res("R1", "content", "Lesson\\l1.html")))
    page = bs.read(str(tmp_path)).sections[0].items[0]
    body = page.parts[0].content
    assert "DOCTYPE" not in body.html and "\x00" not in body.html
    assert "<p>Hamlet" in body.html and body.resolve("a.png") is not None


def test_survey_questions_from_library(tmp_path):
    write(tmp_path, "questiondb.xml", bank_xml())
    write(tmp_path, "survey_d2l_1.xml", quiz_xml(
        "res_survey_1", "Mid-term survey",
        body='<section title="S"><itemref linkrefid="QB_1"><d2l_2p0:file href="questiondb.xml"/></itemref></section>'))
    page = bs.read(str(tmp_path)).sections[0].items[0]
    listing = "".join(p.content.html for p in page.parts)
    assert "Pick alpha" in listing and "<li>alpha</li><li>beta</li><li>gamma</li>" in listing


def test_itemref_into_another_quiz_file(tmp_path):
    """Questions shared between quizzes point at the quiz file that holds them."""
    write(tmp_path, "quiz_d2l_1.xml", quiz_xml("res_quiz_1", "Unit 3", body=tf_item("SHARED") + mc_item("OWN")))
    write(tmp_path, "quiz_d2l_2.xml", quiz_xml("res_quiz_2", "Unit 6", body=(
        '<section title="Reused"><itemref linkrefid="SHARED"><d2l_2p0:file href="quiz_d2l_1.xml"/>'
        '<d2l_2p0:points>3</d2l_2p0:points></itemref><itemref linkrefid="OWN"/></section>')))
    quizzes = {q.title: q for q in bs.read(str(tmp_path)).sections[0].items}
    reused = quizzes["Unit 6"].questions
    assert [q.id for q in reused] == ["SHARED", "OWN"]
    assert reused[0].type == ir.QType.TRUEFALSE and reused[0].points == 3.0


def test_topic_date_due_and_brightspace_urls(tmp_path):
    write(tmp_path, "quiz_d2l_1.xml", quiz_xml("res_quiz_1", "Weekly quiz", code="QW", body=tf_item()))
    items = (topic("1", "Weekly quiz", "R_Q", attrs=' date_due="2017-04-20T05:55:00" date_start="2017-04-01T00:00:00"')
             + topic("2", "Group quiz", "R_LTI") + topic("3", "Grades", "R_PAGE") + topic("4", "Unit", "R_MOD"))
    resources = (res("R_Q", "contentlink", ql("quiz", "QW"))
                 + res("R_LTI", "contentlink", "https://school.brightspace.com/d2l/le/lti/210930/toolLaunch/4112/7")
                 + res("R_PAGE", "contentlink", "https://school.brightspace.com/d2l/lms/grades/my_grades/main.d2l")
                 + res("R_MOD", "webcontent") + res("res_quiz_1", "d2lquiz", "quiz_d2l_1.xml")
                 + res("res_cr", "d2lconditionalrelease", "conditionalrelease_d2l.xml"))
    write(tmp_path, "imsmanifest.xml", manifest(items, resources))
    course = bs.read(str(tmp_path))
    sec = course.sections[0]
    assert by_title(sec, "Weekly quiz").due_date == "2017-04-20T05:55:00+00:00"
    lti = by_title(sec, "Group quiz")
    assert isinstance(lti, ir.UnsupportedItem) and lti.kind == "LTI tool"
    assert by_title(sec, "Grades").kind == "link"
    assert [x.title for x in course.sections] == ["Biology 101", "Unit"]
    assert course.warnings == []
    assert course.skipped == [("Release conditions", "release condition", "not migrated")]


def test_arithmetic_fixed_variable_has_no_note():
    xml = arithmetic("{x} + 2").replace("<maxvalue>15</maxvalue>", "<maxvalue>10</maxvalue>") \
        .replace("<maxvalue>0.9</maxvalue>", "<maxvalue>0.123</maxvalue>")
    q = q_from(xml)
    assert q.numeric[0].value == 12 and "Variables fixed" not in q.general_feedback


def test_library_questions_a_quiz_uses_are_not_repeated(tmp_path):
    write(tmp_path, "questiondb.xml", bank_xml())
    write(tmp_path, "quiz_d2l_5.xml", quiz_xml("res_quiz_5", "Uses one", body='<itemref linkrefid="QB_1"/>'))
    course = bs.read(str(tmp_path))
    library = course.sections[-1]
    assert [(a.title, len(a.questions)) for a in library.items] == [("Pool A", 1), ("Pool B", 1)]


def test_nested_library_folders_and_loose_items(tmp_path):
    write(tmp_path, "questiondb.xml", (
        f'<?xml version="1.0" encoding="UTF-8"?><objectbank ident="QLIB_9" {D2L_NS}>{tf_item("QL_0")}'
        f'<section ident="S1" title="Unit 1"><section ident="S2" title="Week 2">{mc_item("QL_1")}</section>'
        f'</section></objectbank>'))
    course = bs.read(str(tmp_path))
    assert [a.title for a in course.sections[-1].items] == ["Question library", "Unit 1 › Week 2"]


def test_untitled_course_wrapped_in_one_module_is_named_after_it(tmp_path):
    write(tmp_path, "p.html", "<p>x</p>")
    items = module("m1", "Calculus, Volume 1", topic("t0", "Intro", "R1")
                   + module("m2", "Chapter 2", topic("t1", "Limits", "R1")))
    write(tmp_path, "imsmanifest.xml", manifest(items, res("R1", "content", "p.html"), metadata="<metadata/>"))
    course = bs.read(str(tmp_path))
    assert course.title == "Calculus, Volume 1"
    assert [s.title for s in course.sections] == ["Calculus, Volume 1", "Chapter 2"]
