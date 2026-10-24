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
    assignment_settings,
    eq,
    fib,
    item,
    labels,
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
    reader = canvas.CanvasReader(root)
    course = reader.read()
    files = next(s for s in course.sections if s.title == "Files")
    assert [(type(i).__name__, i.title) for i in files.items] == [("Page", "Meow"), ("Page", "Notes")]
    assert files.items[1].parts[0].content.html == "<p>Bring a pencil</p>"
    assert reader._sections_by_type() == []  # a second pass places nothing twice


def test_missing_course_card_image_is_skipped(tmp_path):
    """course_settings.xml names a card image whose file left the export."""
    root = str(tmp_path)
    _export(root, '<resource identifier="f_card" type="webcontent" href="web_resources/card.png"/>')
    write(root, "course_settings/course_settings.xml",
          f'<course identifier="c" xmlns="{CANVAS_NS}"><title>Real course</title>'
          "<image_identifier_ref>f_card</image_identifier_ref></course>")
    course = canvas.read(root)
    assert course.thumbnail is None and course.sections == []
    assert course.skipped == [("Course card image", "image", "not in the export")]


def test_topic_meta_behind_a_missing_dependency(tmp_path):
    """A dependency that left the manifest is passed over on the way to the topicMeta."""
    root = str(tmp_path)
    write(root, "d1.xml", '<topic xmlns="http://www.imsglobal.org/xsd/imsccv1p1/imsdt_v1p1"><title>Hi</title>'
                          "<text texttype=\"text/html\">&lt;p&gt;Say hi&lt;/p&gt;</text></topic>")
    write(root, "d1_meta.xml", f'<topicMeta xmlns="{CANVAS_NS}"><topic_id>d1</topic_id><type>topic</type>'
                               "<workflow_state>unpublished</workflow_state></topicMeta>")
    _export(root, f"""<resource identifier="d1" type="imsdt_xmlv1p1"><file href="d1.xml"/>
              <dependency identifierref="ghost"/><dependency identifierref="d1_meta"/></resource>
              <resource identifier="d1_meta" type="{LAR}" href="d1_meta.xml"/>""",
            _module(module_item("i1", "DiscussionTopic", "Hi", "d1")))
    (topic,) = canvas.read(root).sections[0].items
    assert isinstance(topic, ir.Page) and topic.visible is False


def test_external_tool_assignment_with_exported_questions(tmp_path):
    """New Quizzes are external-tool assignments; an export that still carries
    their QTI imports them as a quiz, not as an unsupported tool."""
    root = str(tmp_path)
    write(root, "a1/a1.html", "<html><body><p>Take the quiz.</p></body></html>")
    write(root, "a1/assignment_settings.xml", assignment_settings("a1", "Unit quiz", submission="external_tool"))
    write(root, "non_cc_assessments/a1.xml.qti", f"""<questestinterop><assessment ident="a1" title="Unit quiz">
      <section ident="root_section">{TF}</section></assessment></questestinterop>""")
    _export(root, f"""<resource identifier="a1" type="{LAR}" href="a1/a1.html">
              <file href="a1/a1.html"/><file href="a1/assignment_settings.xml"/></resource>""",
            _module(module_item("i1", "Assignment", "Unit quiz", "a1")))
    (quiz,) = canvas.read(root).sections[0].items
    assert isinstance(quiz, ir.Assessment) and [q.type for q in quiz.questions] == [ir.QType.TRUEFALSE]


def test_quiz_item_without_a_reference_is_skipped(tmp_path):
    root = str(tmp_path)
    _export(root, "", _module(module_item("i1", "Quizzes::Quiz", "Ghost quiz", "")))
    course = canvas.read(root)
    assert [s.items for s in course.sections] == [[]]
    assert course.skipped == [("Ghost quiz", "quiz", "missing from the export")]


def test_qti_listed_beside_the_meta_file(tmp_path):
    """QTI-only exports keep the questions in the quiz folder, not under non_cc_assessments/."""
    root = str(tmp_path)
    write(root, "q1/assessment_meta.xml", f'<quiz identifier="q1" xmlns="{CANVAS_NS}"><title>Folder quiz</title>'
                                          "<quiz_type>assignment</quiz_type></quiz>")
    write(root, "q1/assessment_qti.xml", f"""<questestinterop><assessment ident="q1" title="Folder quiz">
      <section ident="root_section">{TF}</section></assessment></questestinterop>""")
    _export(root, f"""<resource identifier="q1" type="{QUIZ_TYPE}"><file href="q1/assessment_meta.xml"/>
              <file href="q1/assessment_qti.xml"/></resource>""",
            _module(module_item("i1", "Quizzes::Quiz", "", "q1")))
    (quiz,) = canvas.read(root).sections[0].items
    assert isinstance(quiz, ir.Assessment) and quiz.title == "Folder quiz" and len(quiz.questions) == 1


def test_image_only_choices_are_kept(tmp_path):
    """Canvas pads answer lists with blank options; an option that is only a picture is a real answer."""
    root = str(tmp_path)
    picture = ('<response_label ident="1"><material><mattext texttype="text/html">'
               '&lt;img src="$IMS-CC-FILEBASE$/pic.png"&gt;</mattext></material></response_label>')
    mc = item("mc", "multiple_choice_question", "<p>Which diagram?</p>",
              f'<response_lid ident="response1" rcardinality="Single"><render_choice>{picture}'
              f'{labels([("2", "The text one"), ("3", "")])}</render_choice></response_lid>',
              set_score(eq("response1", "2")))
    _quiz(root, "q1", "", mc)
    _export(root, f'<resource identifier="q1" type="{QUIZ_TYPE}"/>',
            _module(module_item("i1", "Quizzes::Quiz", "Pictures", "q1")))
    (quiz,) = canvas.read(root).sections[0].items
    (q,) = quiz.questions
    assert len(q.choices) == 2 and "<img" in q.choices[0].text.html
    assert [c.correct for c in q.choices] == [False, True]
