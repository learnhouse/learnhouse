"""Moodle reader regressions found by converting real course backups.

Each test rebuilds, synthetically, the exact shape that broke on a real export.
"""

from __future__ import annotations

import os

from src.services.courses.lms_import import ir
from src.services.courses.lms_import.sources import moodle
from src.services.courses.lms_import.sources.moodle import _repair_xml, filter_multilang

from .moodle_builders import Mbz, answers, category3, course_xml, esc, png_bytes, question


def _items(course: ir.Course) -> dict:
    return {it.id: it for s in course.sections for it in s.items}


def test_fields_missing_from_old_backups_keep_their_defaults(tmp_path):
    # Moodle < 3.3 has no visibleoncoursepage; old multichoice options can lack <single>
    b = Mbz(tmp_path / "old")
    b.activity("page", 1, 1, "<name>Old page</name><content>x</content>", 40, visibleoncoursepage=None)
    b.activity("page", 2, 1, "<name>Hidden</name><content>x</content>", 41, visible=0, visibleoncoursepage=None)
    qxml = category3(1, "Top", "23", question(5, "multichoice", "Pick", plugin=(
        answers((1, "A", "1"), (2, "B", "0")) + "<multichoice><layout>0</layout></multichoice>")))
    b.activity("quiz", 3, 1, "<name>Q</name><question_instances><question_instance id=\"1\"><slot>1</slot>"
               "<questionid>5</questionid><maxmark>1</maxmark></question_instance></question_instances>", 42)
    b.section(1, 1, sequence=[1, 2, 3])
    with open(os.path.join(b.root, "sections", "section_1", "section.xml")) as f:
        xml = f.read()
    with open(os.path.join(b.root, "sections", "section_1", "section.xml"), "w") as f:
        f.write(xml.replace("<visible>1</visible>", ""))  # no <visible> at all: visible
    b.write(course_xml(), qxml)
    c = moodle.read(b.root)
    by = _items(c)
    assert c.sections[0].visible is True
    assert by["page_1"].visible is True and by["page_2"].visible is False
    mc = by["quiz_3"].questions[0]
    assert mc.multiple is False and [ch.correct for ch in mc.choices] == [True, False]


def test_damaged_xml_is_repaired(tmp_path):
    # Hand-edited exports: HTML entities in XML, a doubled declaration, bare ampersands
    b = Mbz(tmp_path / "bad")
    b.activity("page", 1, 1, "<name>Broken</name><content>x</content>", 40)
    b.section(1, 1, sequence=[1])
    b.write('<?xml version="1.0" encoding="UTF-8"?>\n' + course_xml(fullname="Fish & Chips"))
    with open(os.path.join(b.root, "activities", "page_1", "page.xml"), "w", encoding="utf-8") as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n<activity id="1" moduleid="1" modulename="page" '
                'contextid="40"><page id="1"><name>Caf&eacute; R&D</name><content>&lt;p&gt;a&nbsp;b&lt;/p&gt;'
                "&#160;&amp;&unknownent;</content></page></activity>")
    c = moodle.read(b.root)
    assert c.title == "Fish & Chips"
    page = c.sections[0].items[0]
    assert page.title == "Café R&D"
    assert page.parts[0].content.html.startswith("<p>a\xa0b</p>")
    assert any("page_1/page.xml was not well-formed XML and was repaired" in w for w in c.warnings)
    assert _repair_xml(b"<a>&amp;&lt;&#x41;&apos;</a>") == b"<a>&amp;&lt;&#x41;&apos;</a>"
    # Beyond repair: still reported as unreadable
    with open(os.path.join(b.root, "activities", "page_1", "page.xml"), "w") as f:
        f.write("<activity><page>")
    c = moodle.read(b.root)
    assert any("page_1/page.xml is not well-formed XML and could not be read" in w for w in c.warnings)
    assert ("page", "page", "no data in the backup") in c.skipped


def test_multilang_filters():
    two = "{mlang en}Data{mlang}{mlang fr,de}Données{mlang}"
    assert filter_multilang(two, "fr") == "Données"
    assert filter_multilang(two, "") == "Data"
    assert filter_multilang("Intro: " + two + " end", "de_ch") == "Intro: Données end"
    assert filter_multilang("{mlang other}Fallback{mlang}{mlang fr}FR{mlang}", "es") == "Fallback"
    assert filter_multilang("{mlang de}DE{mlang}{mlang fr}FR{mlang}", "es") == "DE"
    spans = '<p><span lang="en" class="multilang">Hello</span> <span class="multilang" lang="fr-ca">Salut</span></p>'
    assert filter_multilang(spans, "fr") == "<p>Salut</p>"
    assert filter_multilang('<lang lang="en">A</lang><lang lang="es">B</lang>', "es_mx") == "B"
    # Two separate groups are filtered independently; ordinary spans are untouched
    sep = "{mlang en}A{mlang}{mlang fr}B{mlang} and {mlang en}C{mlang}{mlang fr}D{mlang}"
    assert filter_multilang(sep, "fr") == "B and D"
    plain = '<span lang="en">kept</span>'
    assert filter_multilang(plain, "fr") == plain
    assert filter_multilang("", "fr") == ""


def test_multilang_titles_and_content_follow_course_language(tmp_path):
    b = Mbz(tmp_path / "ml")
    b.activity("page", 1, 1, f"<name>{esc('{mlang en}Intro{mlang}{mlang fr}Accueil{mlang}')}</name>"
               f"<content>{esc('<p><span lang=\"en\" class=\"multilang\">Hi</span><span lang=\"fr\" class=\"multilang\">Salut</span></p>')}"
               "</content>", 40)
    b.section(1, 1, name="{mlang en}Week{mlang}{mlang fr}Semaine{mlang}", sequence=[1])
    b.write(course_xml(fullname="{mlang en}Course{mlang}{mlang fr}Cours{mlang}", lang="fr"))
    c = moodle.read(b.root)
    assert c.title == "Cours" and c.sections[0].title == "Semaine"
    page = c.sections[0].items[0]
    assert page.title == "Accueil" and page.parts[0].content.html == "<p>Salut</p>"


def test_cross_context_file_links(tmp_path):
    # $@PLUGINFILEBYCONTEXT*<ctx>@$ points at another activity's files (a folder here)
    b = Mbz(tmp_path / "ctx")
    b.add_file(png_bytes(), "77", "mod_folder", "content", 0, "shot one.png", filepath="/Images/")
    b.add_file(b"zip", "77", "mod_folder", "content", 0, "kit.zip")
    html = ('<img src="$@PLUGINFILEBYCONTEXT*77@$/mod_folder/content/0/Images/shot%20one.png">'
            '<a href="$@PLUGINFILEBYCONTEXTURLENCODED*77@$%2Fmod_folder%2Fcontent%2F3%2Fkit.zip">kit</a>'
            '<iframe src="$@HVPEMBEDBYID*12@$"></iframe>')
    b.activity("page", 1, 1, f"<name>P</name><content>{esc(html)}</content>", 40)
    b.section(1, 1, sequence=[1])
    b.write(course_xml())
    c = moodle.read(b.root)
    rich = c.sections[0].items[0].parts[0].content
    assert "$@PLUGINFILEBYCONTEXT*77@$" in rich.html and "$@HVPEMBEDBYID" not in rich.html
    shot = rich.resolve("$@PLUGINFILEBYCONTEXT*77@$/mod_folder/content/0/Images/shot%20one.png")
    assert shot is not None and shot.name == "shot one.png"
    kit = rich.resolve("$@PLUGINFILEBYCONTEXTURLENCODED*77@$%2Fmod_folder%2Fcontent%2F3%2Fkit.zip")
    assert kit is not None and kit.name == "kit.zip"
    assert rich.resolve("$@PLUGINFILEBYCONTEXT*77@$/mod_folder/content/0/elsewhere/shot%20one.png").name == \
        "shot one.png"
    assert rich.resolve("$@PLUGINFILEBYCONTEXT*77@$/mod_folder") is None
    assert rich.resolve("$@PLUGINFILEBYCONTEXT*99@$/mod_folder/content/0/x.png") is None
    assert ("P", "H5P", "embedded H5P content is not migrated") in c.skipped
    assert c.warnings == []


def test_activities_outside_known_sections_are_kept(tmp_path):
    b = Mbz(tmp_path / "orph")
    b.activity("page", 1, 1, "<name>Listed</name><content>x</content>", 40)
    b.activity("page", 2, 999, "<name>Orphan</name><content>y</content>", 41)
    b.section(1, 1, sequence=[1])
    b.write(course_xml())
    c = moodle.read(b.root)
    assert [s.title for s in c.sections] == ["Topic 1", "Other activities"]
    assert c.sections[1].items[0].title == "Orphan"
    assert c.warnings == [] and c.skipped == []  # placed in a chapter silently


def test_single_activity_backup(tmp_path):
    # "Backup this activity": no course.xml, no section, details/type = activity
    b = Mbz(tmp_path / "act")
    b.activity("quiz", 7, 55, "<name>Weekly quiz</name><question_instances></question_instances>", 40,
               title="Weekly quiz")
    b.write(None, backup_type="activity")
    c = moodle.read(b.root)
    assert c.title == "Weekly quiz"
    assert [s.title for s in c.sections] == ["Weekly quiz"]
    assert isinstance(c.sections[0].items[0], ir.Assessment)
    assert not any("course.xml is missing" in w or "section missing" in w for w in c.warnings)


def test_legacy_assignment_module_in_moodle2(tmp_path):
    b = Mbz(tmp_path / "asg")
    b.activity("assignment", 1, 1, "<name>Old upload</name><intro>&lt;p&gt;Send it&lt;/p&gt;</intro>"
               "<assignmenttype>upload</assignmenttype><timedue>1735689600</timedue><grade>20</grade>", 40)
    b.activity("assignment", 2, 1, "<name>Online text</name><intro></intro><assignmenttype>online</assignmenttype>"
               "<grade>0</grade>", 41)
    b.activity("assignment", 3, 1, "<name>Offline</name><intro></intro><assignmenttype>offline</assignmenttype>",
               42)
    b.activity("hsuforum", 4, 1, "<name>Open forum</name>", 43)
    b.section(1, 1, sequence=[1, 2, 3, 4])
    b.write(course_xml())
    c = moodle.read(b.root)
    by = _items(c)
    up = by["assignment_1"]
    assert isinstance(up, ir.AssignmentItem) and up.allow_file and not up.allow_text and up.points == 20
    assert up.due_date == "2025-01-01T00:00:00+00:00" and "Send it" in up.instructions.html
    online = by["assignment_2"]
    assert online.allow_text and not online.allow_file and online.graded is False
    offline = by["assignment_3"]
    assert offline.allow_file and not offline.allow_text
    assert c.warnings == []  # offline submission is a documented difference
    assert by["hsuforum_4"].reason == "forum discussions are not migrated"


def test_random_slot_when_category_already_used(tmp_path):
    b = Mbz(tmp_path / "rnd")
    qxml = category3(1, "Pool", "23", question(5, "truefalse", "TF", plugin=answers((1, "True", "1"),
                                                                                (2, "False", "0")))
                     + question(6, "random", "0", name="Random"))
    b.activity("quiz", 1, 1, "<name>Q</name><question_instances>"
               '<question_instance id="1"><slot>1</slot><questionid>6</questionid></question_instance>'
               '<question_instance id="2"><slot>2</slot><questionid>6</questionid></question_instance>'
               "</question_instances>", 40)
    b.section(1, 1, sequence=[1])
    b.write(course_xml(), qxml)
    c = moodle.read(b.root)
    assert [q.title for q in c.sections[0].items[0].questions] == ["Q5"]
    assert c.warnings == [] and c.skipped == []


def test_stack_question_reason(tmp_path):
    b = Mbz(tmp_path / "stack")
    qxml = category3(1, "Pool", "23", question(5, "stack", "Find [[input:ans1]] [[validation:ans1]]"))
    b.activity("quiz", 1, 1, '<name>Q</name><question_instances><question_instance id="1"><slot>1</slot>'
               "<questionid>5</questionid></question_instance></question_instances>", 40)
    b.section(1, 1, sequence=[1])
    b.write(course_xml(), qxml)
    q = moodle.read(b.root).sections[0].items[0].questions[0]
    assert q.type == ir.QType.UNSUPPORTED and "computer algebra" in q.reason


def test_moodle19_quiz_listing_instance_ids(tmp_path):
    # Some 1.9 exports list question_instance ids in <QUESTIONS> instead of question ids
    root = tmp_path / "m19"
    root.mkdir()
    (root / "moodle.xml").write_text(
        "<MOODLE_BACKUP><COURSE><HEADER><FULLNAME>{mlang en}Old{mlang}{mlang de}Alt{mlang}</FULLNAME>"
        "<LANG>de_utf8</LANG></HEADER>"
        "<SECTIONS><SECTION><ID>1</ID><NUMBER>1</NUMBER><VISIBLE>1</VISIBLE><MODS>"
        "<MOD><ID>9</ID><TYPE>quiz</TYPE><INSTANCE>1</INSTANCE><VISIBLE>1</VISIBLE></MOD></MODS></SECTION></SECTIONS>"
        "<QUESTION_CATEGORIES><QUESTION_CATEGORY><ID>1</ID><NAME>C</NAME><QUESTIONS>"
        "<QUESTION><ID>434</ID><PARENT>0</PARENT><NAME>TF</NAME><QUESTIONTEXT>Yes?</QUESTIONTEXT>"
        "<QTYPE>truefalse</QTYPE><ANSWERS><ANSWER><ID>1</ID><ANSWER_TEXT>True</ANSWER_TEXT><FRACTION>1</FRACTION>"
        "</ANSWER><ANSWER><ID>2</ID><ANSWER_TEXT>False</ANSWER_TEXT><FRACTION>0</FRACTION></ANSWER></ANSWERS>"
        "</QUESTION></QUESTIONS></QUESTION_CATEGORY></QUESTION_CATEGORIES>"
        "<MODULES><MOD><ID>1</ID><MODTYPE>quiz</MODTYPE><NAME>Quiz</NAME><QUESTIONS>1111,0</QUESTIONS>"
        "<QUESTION_INSTANCES><QUESTION_INSTANCE><ID>1111</ID><QUESTION>434</QUESTION><GRADE>3</GRADE>"
        "</QUESTION_INSTANCE></QUESTION_INSTANCES></MOD></MODULES></COURSE></MOODLE_BACKUP>"
    )
    c = moodle.read(str(root))
    assert c.title == "Alt"
    quiz = c.sections[0].items[0]
    assert [q.title for q in quiz.questions] == ["TF"] and quiz.questions[0].points == 3.0


def test_random_slot_after_fixed_questions_of_its_category(tmp_path):
    b = Mbz(tmp_path / "rnd2")
    qxml = category3(1, "Pool", "23", question(5, "truefalse", "TF", plugin=answers((1, "True", "1"),
                                                                                (2, "False", "0")))
                     + question(6, "random", "0", name="Random"))
    b.activity("quiz", 1, 1, "<name>Q</name><question_instances>"
               '<question_instance id="1"><slot>1</slot><questionid>5</questionid></question_instance>'
               '<question_instance id="2"><slot>2</slot><questionid>6</questionid></question_instance>'
               "</question_instances>", 40)
    b.section(1, 1, sequence=[1])
    b.write(course_xml(), qxml)
    c = moodle.read(b.root)
    assert [q.title for q in c.sections[0].items[0].questions] == ["Q5"]
    assert c.warnings == [] and c.skipped == []  # the pool was already in the quiz: nothing lost


def _coderunner(qid, crtype, tests, answer="print(input())", preload="", prototype="0", language="$@NULL@$"):
    cases = "".join(
        f"<coderunner_testcase><testcode>{esc(code)}</testcode><testtype>{ttype}</testtype>"
        f"<expected>{esc(expected)}</expected><useasexample>{example}</useasexample><display>SHOW</display>"
        f"<mark>1.000</mark><stdin>{esc(stdin)}</stdin><extra></extra></coderunner_testcase>"
        for code, stdin, expected, example, ttype in tests)
    return question(qid, "coderunner", f"Write {crtype}", name=f"CR {crtype}", plugin=(
        f"<coderunner_options><coderunner_option><coderunnertype>{crtype}</coderunnertype>"
        f"<prototypetype>{prototype}</prototypetype><answerpreload>{esc(preload)}</answerpreload>"
        f"<answer>{esc(answer)}</answer><language>{language}</language></coderunner_option></coderunner_options>"
        f"<coderunner_testcases>{cases}</coderunner_testcases>"))


def test_coderunner_questions_become_code_tasks(tmp_path):
    # Shapes from qtype_coderunner's own backup fixtures (3.1 to 5.0)
    b = Mbz(tmp_path / "cr")
    qxml = category3(1, "CR", "23", "".join([
        _coderunner(1, "python3", [("", "Ann", "Hello Ann", 0, 0), ("", "Bob", "Hello Bob", 1, 2),
                                   ("", "x", "pre", 0, 1)], preload="name = input()\n"),
        _coderunner(2, "c_function", [('printf("%d", sqr(3));', "", "9", 1, 0), ("sqr(1);", "", "1", 0, 0)],
                    answer="int sqr(int n) { return n * n; }"),
        _coderunner(3, "matlab_function", [("disp(1)", "", "1", 0, 0)]),
        _coderunner(4, "python3_custom", [], prototype="2"),
        _coderunner(5, "my_custom_type", [("", "1", "1", 0, 0)], language="java"),
    ]))
    slots = "".join(f'<question_instance id="{i}"><slot>{i}</slot><questionid>{i}</questionid>'
                    f"</question_instance>" for i in range(1, 6))
    b.activity("quiz", 1, 1, f"<name>Code</name><question_instances>{slots}</question_instances>", 40)
    b.activity("qbank", 2, 1, "<name>Shared bank</name>", 41)
    b.section(1, 1, sequence=[1, 2])
    b.write(course_xml(), qxml)
    c = moodle.read(b.root)
    items = c.sections[0].items
    assert [type(i).__name__ for i in items] == ["Assessment"]  # the qbank module adds nothing
    py, cfun, matlab, proto, custom = items[0].questions
    assert py.type == ir.QType.CODE and py.code.language == "python3"
    assert py.code.starter_code == "name = input()\n" and py.code.solution_code == "print(input())"
    assert py.code.test_cases == [("Ann", "Hello Ann"), ("Bob", "Hello Bob")]  # precheck-only test dropped
    assert cfun.type == ir.QType.CODE and cfun.code.language == "c" and cfun.code.test_cases == []
    assert "sqr(3)" in cfun.text.html and "Expected output" in cfun.text.html and "sqr(1);" not in cfun.text.html
    assert c.warnings == []  # harnessed tests are dropped silently (documented)
    assert matlab.type == ir.QType.UNSUPPORTED and "language" in matlab.reason
    assert proto.type == ir.QType.UNSUPPORTED and "prototype" in proto.reason
    assert custom.type == ir.QType.CODE and custom.code.language == "java"


def test_bad_start_date_or_section_number_keeps_plain_week_names(tmp_path):
    # A millisecond start date (or a huge section number) is out of range for datetime
    b = Mbz(tmp_path / "weeks")
    b.section(1, 1)
    b.section(2, 99999999999)
    b.write(course_xml(fmt="weeks", startdate=1700000000000))
    c = moodle.read(b.root)
    assert [s.title for s in c.sections] == ["Section 1", "Section 99999999999"]
    b2 = Mbz(tmp_path / "weeks2")
    b2.section(1, 1)
    b2.section(2, 99999999999)
    b2.write(course_xml(fmt="weeks", startdate=1700000000))
    c = moodle.read(b2.root)
    assert c.sections[0].title == "15 November - 21 November"
    assert c.sections[1].title == "Section 99999999999"


def test_non_finite_section_number_does_not_crash_the_sort(tmp_path):
    b = Mbz(tmp_path / "inf")
    b.section(1, "1e999")
    b.section(2, 1, name="Named")
    b.write(course_xml())
    c = moodle.read(b.root)
    assert [s.title for s in c.sections] == ["General", "Named"]


def test_lesson_jumps_decide_correctness_without_custom_scoring(tmp_path):
    # lesson::jumpto_is_correct(): forward jumps and later pages are right; this page, previous page
    # and earlier pages are wrong, whatever <score> says
    pages = (
        '<pages><page id="1"><prevpageid>0</prevpageid><nextpageid>2</nextpageid><qtype>20</qtype>'
        "<title>Start</title><contents>Hi</contents><answers></answers></page>"
        '<page id="2"><prevpageid>1</prevpageid><nextpageid>3</nextpageid><qtype>3</qtype><qoption>1</qoption>'
        "<title>Pick</title><contents>Choose</contents><answers>"
        '<answer id="1"><jumpto>-1</jumpto><score>0</score><answer_text>next</answer_text></answer>'
        '<answer id="2"><jumpto>0</jumpto><score>1</score><answer_text>this page</answer_text></answer>'
        '<answer id="3"><jumpto>-40</jumpto><score>0</score><answer_text>previous page</answer_text></answer>'
        '<answer id="4"><jumpto>3</jumpto><score>0</score><answer_text>later page</answer_text></answer>'
        '<answer id="5"><jumpto>1</jumpto><score>0</score><answer_text>earlier page</answer_text></answer>'
        '<answer id="6"><jumpto>-9</jumpto><score>0</score><answer_text>end of lesson</answer_text></answer>'
        '<answer id="7"><jumpto>2</jumpto><score>0</score><answer_text>itself</answer_text></answer>'
        "</answers></page>"
        '<page id="3"><prevpageid>2</prevpageid><nextpageid>0</nextpageid><qtype>20</qtype>'
        "<title>Later</title><contents>Bye</contents><answers></answers></page></pages>"
    )
    b = Mbz(tmp_path / "jumps")
    b.activity("lesson", 1, 1, f"<name>L</name><intro></intro><custom>0</custom>{pages}", 40)
    b.section(1, 1, sequence=[1])
    b.write(course_xml())
    c = moodle.read(b.root)
    quiz = next(p for p in c.sections[0].items[0].parts if isinstance(p, ir.InlineQuizPart))
    assert [ch.correct for ch in quiz.questions[0].choices] == [True, False, False, True, False, True, False]


def test_moodle19_lesson_jumps_and_missing_modules(tmp_path):
    root = tmp_path / "m19"
    root.mkdir()
    (root / "moodle.xml").write_text(
        "<MOODLE_BACKUP><COURSE><HEADER><FULLNAME>Old</FULLNAME><LANG>en</LANG></HEADER>"
        "<SECTIONS><SECTION><ID>1</ID><NUMBER>1</NUMBER><VISIBLE>1</VISIBLE><MODS>"
        "<MOD><ID>9</ID><TYPE>lesson</TYPE><INSTANCE>1</INSTANCE><VISIBLE>1</VISIBLE></MOD>"
        "<MOD><ID>10</ID><TYPE>resource</TYPE><INSTANCE>77</INSTANCE><VISIBLE>1</VISIBLE></MOD>"
        "</MODS></SECTION></SECTIONS>"
        "<MODULES><MOD><ID>1</ID><MODTYPE>lesson</MODTYPE><NAME>Old lesson</NAME><CUSTOM>0</CUSTOM><PAGES>"
        "<PAGE><PAGEID>5</PAGEID><PREVPAGEID>0</PREVPAGEID><NEXTPAGEID>6</NEXTPAGEID><QTYPE>3</QTYPE>"
        "<TITLE>Q</TITLE><CONTENTS>Pick</CONTENTS><ANSWERS>"
        "<ANSWER><ID>1</ID><JUMPTO>6</JUMPTO><SCORE>0</SCORE><ANSWERTEXT>later</ANSWERTEXT></ANSWER>"
        "<ANSWER><ID>2</ID><JUMPTO>-40</JUMPTO><SCORE>0</SCORE><ANSWERTEXT>back</ANSWERTEXT></ANSWER>"
        "<ANSWER><ID>3</ID><JUMPTO>5</JUMPTO><SCORE>0</SCORE><ANSWERTEXT>same</ANSWERTEXT></ANSWER>"
        "<ANSWER><ID>4</ID><JUMPTO>-1</JUMPTO><SCORE>0</SCORE><ANSWERTEXT>next</ANSWERTEXT></ANSWER>"
        "</ANSWERS></PAGE>"
        "<PAGE><PAGEID>6</PAGEID><PREVPAGEID>5</PREVPAGEID><NEXTPAGEID>0</NEXTPAGEID><QTYPE>20</QTYPE>"
        "<TITLE>End</TITLE><CONTENTS>Bye</CONTENTS></PAGE>"
        "</PAGES></MOD></MODULES></COURSE></MOODLE_BACKUP>"
    )
    c = moodle.read(str(root))
    lesson = c.sections[0].items[0]
    quiz = next(p for p in lesson.parts if isinstance(p, ir.InlineQuizPart))
    assert [ch.correct for ch in quiz.questions[0].choices] == [True, False, False, True]
    # A section entry whose module record is gone is listed, not dropped silently
    assert ("resource", "resource", "missing from the backup") in c.skipped


def test_unreadable_files_xml_is_reported_once(tmp_path):
    b = Mbz(tmp_path / "files")
    b.add_file(png_bytes(), "40", "mod_resource", "content", 0, "pic.png")
    b.activity("resource", 1, 1, "<name>Pic</name><intro></intro>", 40)
    b.section(1, 1, sequence=[1])
    b.write(course_xml())
    with open(os.path.join(b.root, "files.xml"), "w") as f:
        f.write("<files><file>")
    c = moodle.read(b.root)
    hits = [w for w in c.warnings if "files.xml is not well-formed XML and could not be read" in w]
    assert len(hits) == 1


def test_module_name_is_validated_before_it_becomes_a_path(tmp_path):
    b = Mbz(tmp_path / "modname")
    b.activity("page", 1, 1, "<name>Fine</name><content>x</content>", 40)
    os.makedirs(os.path.join(b.root, "activities", "evil_2"))
    b.activities.append("<activity><moduleid>2</moduleid><sectionid>1</sectionid>"
                        "<modulename>../../evil</modulename><title>Evil</title>"
                        "<directory>activities/evil_2</directory></activity>")
    with open(os.path.join(b.root, "evil.xml"), "w") as f:
        f.write("<activity><page><name>Escaped</name><content>y</content></page></activity>")
    b.section(1, 1, sequence=[1, 2])
    b.write(course_xml())
    c = moodle.read(b.root)
    assert [it.title for it in c.sections[0].items] == ["Fine"]
    assert ("Evil", "activity", "unknown module type") in c.skipped
    assert c.warnings == []


def test_oversized_backup_xml_is_a_warning(tmp_path, monkeypatch):
    from src.services.courses.lms_import.xmlutil import FileTooLarge

    path = tmp_path / "questions.xml"
    path.write_text("<q/>")
    monkeypatch.setattr(moodle, "read_limited", lambda _p: (_ for _ in ()).throw(FileTooLarge("questions.xml is 300 MB")))
    warnings: list[str] = []
    assert moodle._parse(str(path), warnings.append) is None
    assert warnings == ["Skipped questions.xml is 300 MB"]
    assert moodle._parse(str(path)) is None  # without a warn callback: silently None
