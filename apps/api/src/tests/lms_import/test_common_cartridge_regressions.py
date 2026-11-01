"""Regressions found by converting real cartridges (Moodle, D2L, Canvas CC 1.3,
generated OER cartridges). Each test rebuilds the shape that broke, minimally."""

from __future__ import annotations

import pytest

from src.services.courses.lms_import import ir
from src.services.courses.lms_import.sources import common_cartridge as cc
from src.services.courses.lms_import.xmlutil import XmlError

from .test_common_cartridge import (
    PDF,
    choice_lid,
    correct,
    manifest_xml,
    png_bytes,
    qti_item,
    write,
)


def _module(*items: str, title: str = "Module") -> str:
    return f'<item identifier="mod"><title>{title}</title>{"".join(items)}</item>'


def _item(ident: str, ref: str, title: str = "") -> str:
    return f'<item identifier="{ident}" identifierref="{ref}"><title>{title}</title></item>'


def _qti(*items: str, title: str = "Quiz", rubric: str = "") -> str:
    intro = f'<rubric><material><mattext texttype="text/html">{rubric}</mattext></material></rubric>' if rubric \
        else ""
    return f"""<questestinterop><assessment ident="A" title="{title}">{intro}
      <section ident="S">{''.join(items)}</section></assessment></questestinterop>"""


def test_html_entities_in_xml_moodle(tmp_path):
    """Moodle CC exports write &nbsp; into the manifest and resource XML."""
    write(tmp_path, "wl.xml", '<webLink><title>Read&nbsp;this</title><url href="https://example.com"/></webLink>')
    manifest = manifest_xml('<resource identifier="W" type="imswl_xmlv1p1"><file href="wl.xml"/></resource>',
                            _module(_item("w", "W")), title="TITLE")
    write(tmp_path, "imsmanifest.xml", manifest.replace("TITLE", "Caf&eacute; &amp; more&nbsp;"))
    course = cc.read(str(tmp_path))
    assert course.title == "Café & more"
    assert course.sections[0].items[0].title == "Read\xa0this"
    assert cc.try_parse_xml_file(str(tmp_path / "missing.xml")) is None
    assert cc.try_parse_xml_file("") is None
    # An entity nobody knows survives the numeric rewrite: the retry fails too and the file is unreadable
    write(tmp_path, "bad.xml", "<a>&nbsp;&bogus;</a>")
    with pytest.raises(XmlError):
        cc.parse_xml_file(str(tmp_path / "bad.xml"))
    assert cc.try_parse_xml_file(str(tmp_path / "bad.xml")) is None
    assert cc._numeric_entities(b"&nbsp;&amp;&bogus;") == b"&#160;&amp;&bogus;"


def test_module_with_its_own_page_and_children(tmp_path):
    """Some exporters point the module item itself at an overview page and nest the rest under it."""
    write(tmp_path, "overview.html", "<p>Overview</p>")
    write(tmp_path, "p1.html", "<p>One</p>")
    write(tmp_path, "imsmanifest.xml", manifest_xml("""
      <resource identifier="O" type="webcontent" href="overview.html"/>
      <resource identifier="P" type="webcontent" href="p1.html"/>
    """, '<item identifier="M" identifierref="O"><title>Week 1</title>' + _item("p", "P", "Lesson one") + "</item>"))
    (section,) = cc.read(str(tmp_path)).sections
    assert section.title == "Week 1"
    assert [i.title for i in section.items] == ["Week 1", "Lesson one"]
    assert "Overview" in section.items[0].parts[0].content.html


def test_discussions_without_text_or_file(tmp_path):
    """A topic may carry only a title; a topic file may be missing altogether."""
    write(tmp_path, "d/topic.xml", '<topic xmlns="http://www.imsglobal.org/xsd/imsccv1p1/imsdt_v1p1">'
                                   "<title>Say hi</title></topic>")
    write(tmp_path, "imsmanifest.xml", manifest_xml("""
      <resource identifier="D" type="imsdt_xmlv1p1"><file href="d/topic.xml"/></resource>
      <resource identifier="G" type="imsdt_xmlv1p1"><file href="d/gone.xml"/></resource>
    """, _module(_item("d", "D"), _item("g", "G", "Lost topic"))))
    course = cc.read(str(tmp_path))
    (topic,) = course.sections[0].items
    assert isinstance(topic, ir.Page) and topic.title == "Say hi" and topic.parts == []
    assert course.skipped == [("Lost topic", "discussion", "missing from the export")] and course.warnings == []


def test_moodle_item_titles_and_lms_links(tmp_path):
    """Moodle titles carry inline HTML; its links point back into Moodle."""
    write(tmp_path, "p/page.html", """<p><a href="$@COURSEVIEWBYID*60@$">course home</a>
      <a href="/mod/quiz/view.php?id=3691">the quiz</a> <a href="\\mod/forum/view.php?id=1">forum</a>
      <a href="/d2l/common/dialogs/quickLink/quickLink.d2l?ou=1">D2L link</a>
      <a href="/syllabus">syllabus</a> <a href="/files/notes.pdf">notes</a>
      <a href="//cdn.example.com/x">cdn</a></p>""")
    write(tmp_path, "files/notes.pdf", PDF)
    write(tmp_path, "imsmanifest.xml", manifest_xml(
        '<resource identifier="P" type="webcontent" href="p/page.html"><file href="p/page.html"/></resource>',
        _module(_item("p", "P", "&lt;em&gt;The New York Times&lt;/em&gt;: &quot;Puzzles&quot;"))))
    page = cc.read(str(tmp_path)).sections[0].items[0]
    assert page.title == 'The New York Times: "Puzzles"'
    html = page.parts[0].content.html
    for gone in ("COURSEVIEWBYID", "/mod/quiz", "mod/forum", "/d2l/", 'href="/syllabus"'):
        assert gone not in html
    for kept in ("course home", "the quiz", "forum", "D2L link", "syllabus"):
        assert kept in html
    assert 'href="/files/notes.pdf"' in html and 'href="//cdn.example.com/x"' in html
    assert cc.clean_title("  a <b>bold</b>\n title ") == "a bold title"
    assert cc.clean_title("x < y") == "x < y"


def test_organization_title_fallback(tmp_path):
    """Generated cartridges leave the LOM empty and title the organization."""
    write(tmp_path, "home.html", "<p>Home</p>")
    write(tmp_path, "imsmanifest.xml", """<manifest xmlns="http://www.imsglobal.org/xsd/imsccv1p1/imscp_v1p1">
      <metadata><schema>IMS Common Cartridge</schema>
      <lom/></metadata>
      <organizations><organization identifier="O"><title>AIN 2001 &#8212; AI</title>
        <item identifier="root"><item identifier="h" identifierref="H"><title>Home</title></item></item>
      </organization></organizations>
      <resources><resource identifier="H" type="webcontent" href="home.html"/></resources></manifest>""")
    course = cc.read(str(tmp_path))
    assert course.title == "AIN 2001 — AI"
    # Without an organization title, the root item's title is used
    write(tmp_path, "imsmanifest.xml", """<manifest xmlns="http://www.imsglobal.org/xsd/imsccv1p1/imscp_v1p1">
      <organizations><organization identifier="O"><item identifier="root"><title>Root title</title>
        <item identifier="m"><title>M</title><item identifier="h" identifierref="H"><title>Home</title></item>
        </item></item></organization></organizations>
      <resources><resource identifier="H" type="webcontent" href="home.html"/></resources></manifest>""")
    assert cc.read(str(tmp_path)).title == "Root title"


def test_variant_fallback_and_href_without_extension(tmp_path):
    """Canvas CC 1.3 adds <cpx:variant> fallbacks; some exporters drop the
    extension from href while <file> has it."""
    write(tmp_path, "a/fallback.html", "<p>Fallback page</p>")
    write(tmp_path, "wiki/retrieve.html", "<p>Retrieved</p>")
    write(tmp_path, "imsmanifest.xml", manifest_xml("""
      <resource identifier="F" type="webcontent">
        <cpx:variant xmlns:cpx="http://www.imsglobal.org/xsd/imsccv1p2/imscp_extensionv1p2"
          identifier="v" identifierref="X"><cpx:metadata/></cpx:variant>
        <file href="a/fallback.html"/></resource>
      <resource identifier="R" type="webcontent" href="wiki/retrieve"><file href="wiki/retrieve.html"/></resource>
    """, _module(_item("f", "F", "Fallback"), _item("r", "R", "Retrieve"))))
    fallback, retrieved = cc.read(str(tmp_path)).sections[0].items
    assert "Fallback page" in fallback.parts[0].content.html
    assert "Retrieved" in retrieved.parts[0].content.html


def test_text_files_become_pages(tmp_path):
    write(tmp_path, "notes.txt", "Line one\nline two <b>\n\nSecond paragraph")
    write(tmp_path, "big.txt", "x" * (600 * 1024))
    write(tmp_path, "imsmanifest.xml", manifest_xml("""
      <resource identifier="T" type="webcontent" href="notes.txt"/>
      <resource identifier="B" type="webcontent" href="big.txt"/>
    """, _module(_item("t", "T", "Notes"), _item("b", "B", "Big"))))
    notes, big = cc.read(str(tmp_path)).sections[0].items
    assert notes.parts[0].content.html == "<p>Line one<br>line two &lt;b&gt;</p><p>Second paragraph</p>"
    assert isinstance(big.parts[0], ir.FilePart)


def test_assignment_points_attribute_and_missing_document(tmp_path):
    """Canvas CC 1.3 puts points on <gradable>; D2L assignment XML can be missing."""
    write(tmp_path, "a/assignment.xml", """<assignment><title>Essay</title>
      <text texttype="text/html">&lt;p&gt;Write&lt;/p&gt;</text><gradable points_possible="12.5">true</gradable>
      </assignment>""")
    write(tmp_path, "d/Content/brief.png", png_bytes())
    write(tmp_path, "imsmanifest.xml", manifest_xml("""
      <resource identifier="A" type="assignment_xmlv1p0" href="a/assignment.xml"/>
      <resource identifier="D" type="assignment_xmlv1p0"><file href="d/gone.xml"/><dependency identifierref="DC"/>
      </resource>
      <resource identifier="DC" type="webcontent"><file href="d/Content/brief.png"/></resource>
    """, _module(_item("a", "A"), _item("d", "D", "Research task"))))
    course = cc.read(str(tmp_path))
    essay, missing = course.sections[0].items
    assert essay.points == 12.5
    assert isinstance(missing, ir.AssignmentItem) and missing.title == "Research task"
    assert [a.name for a in missing.attachments] == ["brief.png"]


def test_survey_without_answer_key(tmp_path):
    """D2L surveys export as cc.exam QTI with no correct answers."""
    unkeyed = [
        qti_item("y", "cc.multiple_choice.v0p1", "What year are you?",
                 choice_lid("y_rl", [("1", "First"), ("2", "Second")]), ""),
        qti_item("m", "cc.fib.v0p1", "Your major?",
                 '<response_str ident="m_rs"><render_fib><response_label ident="x"/></render_fib></response_str>', ""),
        qti_item("e", "cc.essay.v0p1", "Anything else?",
                 '<response_str ident="e_rs"><render_fib><response_label ident="x"/></render_fib></response_str>', ""),
    ]
    write(tmp_path, "q/survey.xml", _qti(*unkeyed, title="About you"))
    write(tmp_path, "survey/s1/qti.xml", _qti(qti_item("k", "cc.true_false.v0p1", "Like it?",
                                                       choice_lid("k_rl", [("t", "True"), ("f", "False")]),
                                                       correct("k_rl", "t")), title="D2L survey"))
    write(tmp_path, "imsmanifest.xml", manifest_xml("""
      <resource identifier="Q" type="imsqti_xmlv1p2/imscc_xmlv1p3/assessment"><file href="q/survey.xml"/></resource>
      <resource identifier="S" type="imsqti_xmlv1p2/imscc_xmlv1p3/assessment"><file href="survey/s1/qti.xml"/>
      </resource>
    """, _module(_item("q", "Q"), _item("s", "S"))))
    course = cc.read(str(tmp_path))
    survey, d2l = course.sections[0].items
    assert survey.graded is False
    year, major, essay = survey.questions
    assert year.type == ir.QType.DESCRIPTION and "<li>First</li><li>Second</li>" in year.text.html
    assert major.type == ir.QType.DESCRIPTION and major.text.html == "Your major?"
    assert essay.type == ir.QType.ESSAY
    assert course.warnings == [] and course.skipped == []  # imported, so nothing to report
    # D2L files surveys under survey/: ungraded even with a keyed question, which keeps its key
    assert d2l.graded is False and d2l.questions[0].type == ir.QType.TRUEFALSE
    assert cc.has_answer_key(ir.Question(ir.QType.ESSAY)) is False
    assert cc.has_answer_key(ir.Question(ir.QType.NUMERICAL, numeric=[ir.NumericAnswer(1)])) is True
    assert cc.has_answer_key(ir.Question(ir.QType.ORDERING, ordering=["a"])) is True
    assert cc.has_answer_key(ir.Question(ir.QType.CLOZE, blanks=[ir.Blank(answers=["x"])])) is True
    matching = ir.Question(ir.QType.MATCHING, pairs=[ir.MatchPair(ir.RichText("a"), "b")])
    assert cc.has_answer_key(matching) is True
    assert "<li>b</li>" in cc.survey_prompt(ir.Question(ir.QType.MATCHING, pairs=matching.pairs)).text.html


def test_empty_quizzes(tmp_path):
    write(tmp_path, "q1.xml", _qti(title="Shell", rubric="&lt;p&gt;Read chapter 2 first&lt;/p&gt;"))
    write(tmp_path, "q2.xml", _qti(title="Bare"))
    write(tmp_path, "q3.xml", "<questestinterop><objectbank ident='B'/></questestinterop>")
    write(tmp_path, "imsmanifest.xml", manifest_xml("""
      <resource identifier="Q1" type="imsqti_xmlv1p2"><file href="q1.xml"/></resource>
      <resource identifier="Q2" type="imsqti_xmlv1p2"><file href="q2.xml"/></resource>
      <resource identifier="Q3" type="imsqti_xmlv1p2"><file href="q3.xml"/></resource>
    """, _module(_item("a", "Q1"), _item("b", "Q2"), _item("c", "Q3", "Bank file"))))
    course = cc.read(str(tmp_path))
    shell, bare, bank_file = course.sections[0].items
    assert isinstance(shell, ir.Page) and "Read chapter 2" in shell.parts[0].content.html
    assert isinstance(bare, ir.UnsupportedItem) and bare.reason == "the quiz has no questions in the export"
    # A bank placed as a quiz holds no <assessment> at all
    assert isinstance(bank_file, ir.UnsupportedItem) and bank_file.reason == "no QTI assessment in the file"
    assert course.skipped == [("Shell", "quiz", "no questions in the export")] and course.warnings == []


def test_oversized_syllabus_is_reported_not_fatal(tmp_path, monkeypatch):
    """The syllabus is read outside the per-item guard: a file over the size cap
    must become a warning and a skipped entry, not end the import."""
    monkeypatch.setattr(cc, "MAX_TEXT_BYTES", 60)
    write(tmp_path, "syllabus.html", "<p>" + "x" * 100 + "</p>")
    write(tmp_path, "page.html", "<p>Hi</p>")
    write(tmp_path, "imsmanifest.xml", manifest_xml("""
      <resource identifier="S" type="webcontent" href="syllabus.html" intendeduse="syllabus">
        <file href="syllabus.html"/></resource>
      <resource identifier="P" type="webcontent" href="page.html"><file href="page.html"/></resource>
    """, _module(_item("a", "P", "Page"))))
    course = cc.read(str(tmp_path))
    assert [s.title for s in course.sections] == ["Module"]
    assert isinstance(course.sections[0].items[0], ir.Page)
    assert course.warnings == ["Could not read 'Syllabus': syllabus.html is larger than 0 MB"]
    assert course.skipped == [("Syllabus", "page", "unreadable resource: syllabus.html is larger than 0 MB")]


def test_bank_only_cartridge(tmp_path):
    write(tmp_path, "bank.xml", """<questestinterop><objectbank ident="B1">
      <qtimetadata><qtimetadatafield><fieldlabel>bank_title</fieldlabel><fieldentry>Chapter 1 bank</fieldentry>
      </qtimetadatafield></qtimetadata>""" + qti_item(
        "b1", "cc.true_false.v0p1", "Sky is blue?", choice_lid("b1_rl", [("t", "True"), ("f", "False")]),
        correct("b1_rl", "t")) + "</objectbank></questestinterop>")
    write(tmp_path, "empty_bank.xml", "<questestinterop><objectbank ident='B2'/></questestinterop>")
    write(tmp_path, "broken_bank.xml", "<questestinterop><objectbank")
    write(tmp_path, "imsmanifest.xml", manifest_xml("""
      <resource identifier="B" type="imsqti_xmlv1p2/imscc_xmlv1p1/question-bank"><file href="bank.xml"/></resource>
      <resource identifier="E" type="imsqti_xmlv1p2/imscc_xmlv1p1/question-bank"><file href="empty_bank.xml"/>
      </resource>
      <resource identifier="G" type="imsqti_xmlv1p2/imscc_xmlv1p1/question-bank"><file href="gone.xml"/></resource>
      <resource identifier="X" type="imsqti_xmlv1p2/imscc_xmlv1p1/question-bank"><file href="broken_bank.xml"/>
      </resource>
    """))
    course = cc.read(str(tmp_path))
    section = course.sections[-1]
    assert section.title == "Question banks" and section.visible is False
    (bank,) = section.items
    assert bank.title == "Chapter 1 bank" and bank.visible is False and len(bank.questions) == 1
    assert course.warnings == [] and course.skipped == []  # hidden quizzes are imported, not reported
