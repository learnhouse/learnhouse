"""Regressions found by converting real Canvas course exports."""

from __future__ import annotations

from src.services.courses.lms_import import ir
from src.services.courses.lms_import.sources import canvas
from src.services.courses.lms_import.sources import common_cartridge as cc

from .test_canvas import (
    CANVAS_NS,
    CC_NS,
    LAR,
    QUIZ_TYPE,
    eq,
    fib,
    item,
    lid,
    module_item,
    png_bytes,
    set_score,
    write,
)


def _export(root, resources: str, modules: str = "", org: str = "") -> str:
    root = str(root)
    write(root, "course_settings/canvas_export.txt", "panda")
    write(root, "course_settings/course_settings.xml",
          f'<course identifier="c" xmlns="{CANVAS_NS}"><title>Real course</title></course>')
    if modules:
        write(root, "course_settings/module_meta.xml", f'<modules xmlns="{CANVAS_NS}">{modules}</modules>')
    write(root, "imsmanifest.xml", f"""<manifest identifier="m" xmlns="{CC_NS}">
      <metadata><schema>IMS Common Cartridge</schema></metadata>
      <organizations><organization identifier="o"><item identifier="LearningModules">{org}</item>
      </organization></organizations><resources>{resources}</resources></manifest>""")
    return root


def _module(*items: str, title: str = "Week 1") -> str:
    return (f'<module identifier="mod1"><title>{title}</title><workflow_state>active</workflow_state>'
            f'<position>1</position><items>{"".join(items)}</items></module>')


def _quiz(root, ident: str, meta_extra: str, items: str, assessment_attrs: str = "") -> None:
    write(root, f"{ident}/assessment_meta.xml", f"""<quiz identifier="{ident}" xmlns="{CANVAS_NS}">
      <title>{ident}</title><quiz_type>assignment</quiz_type>{meta_extra}</quiz>""")
    write(root, f"non_cc_assessments/{ident}.xml.qti", f"""<questestinterop>
      <assessment ident="{ident}" title="{ident}"{assessment_attrs}><section ident="root_section">{items}</section>
      </assessment></questestinterop>""")


TF = item("tf", "true_false_question", "Sky is blue?", lid("response1", [("t", "True"), ("f", "False")]),
          set_score(eq("response1", "t")))


def test_quiz_published_by_its_assignment(tmp_path):
    """A graded quiz with <available>false</available> but a published
    assignment is published (Canvas syncs the two)."""
    root = str(tmp_path)
    _quiz(root, "q1", "<available>false</available><assignment identifier='a1'>"
                      "<workflow_state>published</workflow_state></assignment>", TF)
    _quiz(root, "q2", "<available>false</available><assignment identifier='a2'>"
                      "<workflow_state>unpublished</workflow_state></assignment>", TF)
    _export(root, f"""<resource identifier="q1" type="{QUIZ_TYPE}"/><resource identifier="q2" type="{QUIZ_TYPE}"/>""",
            _module(module_item("i1", "Quizzes::Quiz", "Quiz 1", "q1", position=1),
                    module_item("i2", "Quizzes::Quiz", "Quiz 2", "q2", position=2)))
    q1, q2 = canvas.read(root).sections[0].items
    assert q1.visible is True and q2.visible is False


def test_module_item_without_identifierref_uses_manifest(tmp_path):
    root = str(tmp_path)
    write(root, "wiki_content/p.html", "<html><head><title>P</title></head><body><p>Page</p></body></html>")
    _export(root, '<resource identifier="w1" type="webcontent" href="wiki_content/p.html"/>',
            _module(module_item("i1", "WikiPage", "The page", "")),
            org='<item identifier="mod1"><title>Week 1</title>'
                '<item identifier="i1" identifierref="w1"><title>The page</title></item></item>')
    (page,) = canvas.read(root).sections[0].items
    assert page.title == "The page" and "Page" in page.parts[0].content.html


def test_new_quizzes_and_broken_questions(tmp_path):
    """New Quizzes export empty; Canvas marks broken questions 'Error'."""
    root = str(tmp_path)
    _quiz(root, "nq", "", "", ' external_assignment_id="4788"')
    broken = """<item ident="err"><itemmetadata><qtimetadata><qtimetadatafield><fieldlabel>question_type</fieldlabel>
      <fieldentry>Error</fieldentry></qtimetadatafield></qtimetadata></itemmetadata>
      <presentation><material><mattext>Which are true?</mattext></material></presentation></item>"""
    _quiz(root, "qe", "", TF + broken)
    _export(root, f'<resource identifier="nq" type="{QUIZ_TYPE}"/><resource identifier="qe" type="{QUIZ_TYPE}"/>',
            _module(module_item("i1", "Quizzes::Quiz", "New quiz", "nq", position=1),
                    module_item("i2", "Quizzes::Quiz", "With error", "qe", position=2)))
    new_quiz, with_error = canvas.read(root).sections[0].items
    assert isinstance(new_quiz, ir.UnsupportedItem)
    assert new_quiz.reason == "the quiz has no questions in the export (New Quizzes are exported without their questions)"
    err = with_error.questions[1]
    assert err.type == ir.QType.UNSUPPORTED and "'Error'" in err.reason


def test_bank_only_export(tmp_path):
    """An export holding only question banks keeps them, hidden."""
    root = str(tmp_path)
    write(root, "non_cc_assessments/bank1.xml.qti", f"""<questestinterop><objectbank ident="bank1">
      <qtimetadata><qtimetadatafield><fieldlabel>bank_title</fieldlabel><fieldentry>Chapter 17</fieldentry>
      </qtimetadatafield></qtimetadata>{TF}{item("es", "essay_question", "Explain", fib(), "")}
      </objectbank></questestinterop>""")
    _export(root, f'<resource identifier="bank1" type="{LAR}" href="non_cc_assessments/bank1.xml.qti"/>')
    course = canvas.read(root)
    (section,) = course.sections
    assert section.title == "Question banks" and section.visible is False
    (bank,) = section.items
    assert bank.title == "Chapter 17" and [q.type for q in bank.questions] == [ir.QType.TRUEFALSE, ir.QType.ESSAY]
    assert course.warnings == [] and course.skipped == []


def test_corrupt_sidecars_are_reported(tmp_path):
    """A corrupt metadata file degrades the item as before (the assignment
    becomes a page) but is now a warning naming the file, unlike a missing one."""
    root = str(tmp_path)
    write(root, "a1/a1.html", "<html><body><p>Do the thing.</p></body></html>")
    write(root, "a1/assignment_settings.xml", "<assignment identifier='a1'><title>Broken")
    _export(root, f"""<resource identifier="a1" type="{LAR}" href="a1/a1.html">
              <file href="a1/a1.html"/><file href="a1/assignment_settings.xml"/></resource>""",
            _module(module_item("i1", "Assignment", "Homework", "a1")))
    write(root, "course_settings/course_settings.xml", "<course")
    course = canvas.read(root)
    assert course.title == "Imported course"  # the corrupt settings count as absent
    (section,) = course.sections
    (homework,) = section.items
    assert isinstance(homework, ir.Page) and homework.title == "Homework"
    assert [w.split(":")[0] for w in course.warnings] == [
        "Could not read 'course_settings/course_settings.xml'", "Could not read 'a1/assignment_settings.xml'"]


def test_oversized_pages_are_reported_not_fatal(tmp_path, monkeypatch):
    """The syllabus and front-page probe read HTML outside the per-item guard."""
    root = str(tmp_path)
    monkeypatch.setattr(cc, "MAX_TEXT_BYTES", 300)
    write(root, "course_settings/syllabus.html", "<html><body><p>" + "x" * 400 + "</p></body></html>")
    write(root, "wiki_content/front.html",
          '<html><head><meta name="front_page" content="true"/></head><body><p>Hi</p></body></html>')
    write(root, "wiki_content/huge.html", "<html><body><p>" + "y" * 400 + "</p></body></html>")
    _export(root, """<resource identifier="w1" type="webcontent" href="wiki_content/front.html"/>
      <resource identifier="w2" type="webcontent" href="wiki_content/huge.html"/>""")
    course = canvas.read(root)
    overview, pages = course.sections
    assert overview.title == "Course overview" and isinstance(overview.items[0], ir.Page)
    (huge,) = pages.items
    assert isinstance(huge, ir.UnsupportedItem) and "unreadable" in huge.reason
    assert ("Syllabus", "page", "unreadable in the export") in course.skipped
    # One warning per unreadable file: the front-page probe stays silent and leaves the report to the page read
    assert sorted(w.split(":")[0] for w in course.warnings) == ["Could not read 'Syllabus'", "Could not read 'w2'"]


def test_files_without_modules(tmp_path):
    """A course with no modules still brings its files, minus the linked ones."""
    root = str(tmp_path)
    write(root, "web_resources/meow.jpg", b"\xff\xd8\xff" + b"0" * 32)
    write(root, "web_resources/inline.png", png_bytes())
    write(root, "web_resources/notes.txt", "Bring a pencil")
    write(root, "wiki_content/p.html", '<html><body><img src="$IMS-CC-FILEBASE$/inline.png"></body></html>')
    _export(root, """
      <resource identifier="f1" type="webcontent" href="web_resources/meow.jpg"/>
      <resource identifier="f2" type="webcontent" href="web_resources/inline.png"/>
      <resource identifier="f3" type="webcontent" href="web_resources/notes.txt"/>
      <resource identifier="w1" type="webcontent" href="wiki_content/p.html"/>""")
    course = canvas.read(root)
    files = next(s for s in course.sections if s.title == "Files")
    assert [(type(i).__name__, i.title) for i in files.items] == [("Page", "Meow"), ("Page", "Notes")]
    assert files.items[1].parts[0].content.html == "<p>Bring a pencil</p>"
