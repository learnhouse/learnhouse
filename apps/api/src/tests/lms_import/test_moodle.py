"""Moodle reader: synthetic 4.x, 3.x/2.x and 1.9 backups, plus an end-to-end conversion."""

from __future__ import annotations

import io
import json
import os
import tarfile
import zipfile

import pytest

from src.services.courses.lms_import import ir
from src.services.courses.lms_import.sources import moodle
from src.services.courses.lms_import.sources.moodle import (
    _filter_category,
    _format_html,
    _php_option,
    cloze_blank,
    eval_formula,
    parse_cloze_text,
)

from .moodle_builders import (
    MP4_BYTES,
    PDF_BYTES,
    Mbz,
    answers,
    category3,
    category4,
    course_xml,
    entry,
    esc,
    png_bytes,
    question,
)

QCTX = "23"  # question categories live in the course context


def items_by_id(course: ir.Course) -> dict:
    out = {}
    for s in course.sections:
        for it in s.items:
            out.setdefault(it.id, it)
    return out


def html_parts(page: ir.Page) -> list[ir.HtmlPart]:
    return [p for p in page.parts if isinstance(p, ir.HtmlPart)]


# ---------------------------------------------------------------------------
# Moodle 4.x backup
# ---------------------------------------------------------------------------


def _questions_4x(b: Mbz) -> str:
    b.add_file(png_bytes(), QCTX, "question", "questiontext", "101", "diagram.png")
    mc_single = question(101, "multichoice", '<p>Pick one <img src="@@PLUGINFILE@@/diagram.png"></p>', plugin=(
        answers((1, "<p>Right</p>", "1.0000000", "Yes!"), (2, "Half", "0.5000000"), (3, "Wrong", "0.0000000"))
        + '<multichoice id="1"><layout>0</layout><single>1</single><shuffleanswers>1</shuffleanswers></multichoice>'
    ), feedback="<p>Because.</p>")
    mc_multi = question(102, "multichoice", "Pick two", plugin=(
        answers((4, "A", "0.5"), (5, "B", "0.5"), (6, "C", "-1.0"))
        + "<multichoice><single>0</single></multichoice>"
    ))
    tf = question(103, "truefalse", "Sky is blue", plugin=(
        answers((7, "True", "1"), (8, "False", "0"))
        + "<truefalse><trueanswer>7</trueanswer><falseanswer>8</falseanswer></truefalse>"
    ))
    sa = question(104, "shortanswer", "Capital of France?", plugin=(
        answers((9, "Paris", "1"), (10, "paris*", "1"), (11, "Lyon", "0.2"))
        + "<shortanswer><usecase>1</usecase></shortanswer>"
    ))
    num = question(105, "numerical", "g?", plugin=(
        answers((12, "9.81", "1"), (13, "*", "0"))
        + '<numerical_answers><numerical_answer id="1"><answer>12</answer><tolerance>0.05</tolerance>'
          "</numerical_answer></numerical_answers>"
        + "<numerical_units><numerical_unit><multiplier>1</multiplier><unit>m/s2</unit></numerical_unit>"
          "</numerical_units>"
    ))
    essay = question(106, "essay", "Discuss", plugin=(
        "<essay><responseformat>noinline</responseformat><attachments>1</attachments></essay>"
    ))
    match = question(107, "match", "Match capitals", plugin=(
        "<matchoptions><shuffleanswers>1</shuffleanswers></matchoptions><matches>"
        '<match id="1"><questiontext>France</questiontext><questiontextformat>1</questiontextformat>'
        "<answertext>Paris</answertext></match>"
        '<match id="2"><questiontext>Italy</questiontext><answertext>Rome</answertext></match>'
        '<match id="3"><questiontext></questiontext><answertext>Berlin</answertext></match>'
        "</matches>"
    ))
    ddwtos = question(108, "ddwtos", "The [[1]] sat on the [[2]].", plugin=answers(
        (20, "cat", "0", 'O:8:"stdClass":2:{s:9:"draggroup";s:1:"1";s:8:"infinite";i:0;}'),
        (21, "mat", "0", 'O:8:"stdClass":2:{s:9:"draggroup";s:1:"2";s:8:"infinite";i:0;}'),
        (22, "dog", "0", 'O:8:"stdClass":2:{s:9:"draggroup";s:1:"1";s:8:"infinite";i:0;}'),
    ))
    gapselect = question(109, "gapselect", "Water is [[2]].", plugin=answers(
        (23, "dry", "0", "1"), (24, "wet", "0", "1"), (25, "blue", "0", "2"),
    ))
    multi = question(110, "multianswer", "Paris is in {#1}; 2+2={#2}; colour {#3}", plugin=(
        '<multianswer id="1"><question>110</question><sequence>111,112,113</sequence></multianswer>'
    ))
    sub_sa = question(111, "shortanswer", "{1:SHORTANSWER:=France}", parent="110",
                      plugin=answers((30, "France", "1")) + "<shortanswer><usecase>0</usecase></shortanswer>")
    sub_nm = question(112, "numerical", "{1:NUMERICAL:=4:0}", parent="110", plugin=(
        answers((31, "4", "1")) + "<numerical_answers><numerical_answer><answer>31</answer>"
                                  "<tolerance>0.5</tolerance></numerical_answer></numerical_answers>"))
    sub_mc = question(113, "multichoice", "{1:MC:=red~blue}", parent="110", plugin=(
        answers((32, "red", "1"), (33, "blue", "0")) + "<multichoice><single>1</single></multichoice>"))
    ordering = question(114, "ordering", "Order these", plugin=answers(
        (40, "Third", "3"), (41, "First", "1"), (42, "Second", "2")))
    desc = question(115, "description", "<p>Read carefully.</p>")
    calc = question(116, "calculated", "What is {a} + {b}?", plugin=(
        answers((50, "{a} + {b}", "1"))
        + '<calculated_records><calculated_record><answer>50</answer><tolerance>0.01</tolerance>'
          "<tolerancetype>2</tolerancetype><correctanswerlength>2</correctanswerlength>"
          "<correctanswerformat>1</correctanswerformat></calculated_record></calculated_records>"
        + "<dataset_definitions>"
          '<dataset_definition id="1"><category>0</category><name>a</name><type>1</type><itemcount>2</itemcount>'
          "<dataset_items><dataset_item><number>2</number><value>9</value></dataset_item>"
          "<dataset_item><number>1</number><value>1.5</value></dataset_item></dataset_items></dataset_definition>"
          '<dataset_definition id="2"><name>b</name><dataset_items><dataset_item><number>1</number>'
          "<value>2</value></dataset_item></dataset_items></dataset_definition></dataset_definitions>"
    ))
    calc_none = question(117, "calculatedsimple", "No data {x}", plugin=answers((51, "{x}*2", "1")))
    calcmulti = question(118, "calculatedmulti", "{a} squared?", plugin=(
        answers((52, "{={a}*{a}}", "1"), (53, "{={a}+1}", "0"))
        + "<calculated_options><single>1</single></calculated_options>"
        + "<dataset_definitions><dataset_definition><name>a</name><dataset_items><dataset_item>"
          "<number>1</number><value>3</value></dataset_item></dataset_items></dataset_definition>"
          "</dataset_definitions>"
    ))
    ddimage = question(119, "ddimageortext", "Drag onto the map")
    unknown = question(120, "weirdplugin", "Strange")
    gapfill = question(121, "gapfill", "The [cat|kitten] sat on the [mat].", plugin=(
        answers((60, "cat|kitten", "1"), (61, "mat", "1"), (62, "dog", "0"))
        + "<gapfill><answerdisplay>dropdown</answerdisplay><delimitchars>[]</delimitchars>"
          "<casesensitive>0</casesensitive><wronganswers>rug, sofa</wronganswers></gapfill>"
    ))
    rsam = question(122, "randomsamatch", "Match them", plugin=(
        "<randomsamatch><choose>2</choose><subcats>0</subcats></randomsamatch>"))
    # Short answers in the random-matching category
    sa_pool1 = question(130, "shortanswer", "Two?", plugin=answers((70, "2", "1")))
    sa_pool2 = question(131, "shortanswer", "Three?", plugin=answers((71, "3", "1")))
    sa_pool3 = question(132, "shortanswer", "Four?", plugin=answers((72, "4", "1")))
    # Random pool (category 6): one ready, one hidden, an old version
    pool_a_v1 = question(140, "truefalse", "Old version", plugin=answers((80, "True", "1"), (81, "False", "0")))
    pool_a_v2 = question(141, "truefalse", "Pool A", plugin=answers((82, "True", "0"), (83, "False", "1")))
    pool_b = question(142, "shortanswer", "Pool B hidden", plugin=answers((84, "x", "1")))
    pool_c = question(150, "shortanswer", "Subcat C", plugin=answers((85, "c", "1")))
    broken = question(160, "multichoice", "Broken", plugin=answers((90, "A", "not-a-number")))

    main = category4(5, "Default for course", QCTX, "".join([
        entry(1, 5, (1, "ready", mc_single)), entry(2, 5, (1, "ready", mc_multi)), entry(3, 5, (1, "ready", tf)),
        entry(4, 5, (1, "ready", sa)), entry(5, 5, (1, "ready", num)), entry(6, 5, (1, "ready", essay)),
        entry(7, 5, (1, "ready", match)), entry(8, 5, (1, "ready", ddwtos)), entry(9, 5, (1, "ready", gapselect)),
        entry(10, 5, (1, "ready", multi)), entry(11, 5, (1, "ready", sub_sa)), entry(12, 5, (1, "ready", sub_nm)),
        entry(13, 5, (1, "ready", sub_mc)), entry(14, 5, (1, "ready", ordering)), entry(15, 5, (1, "ready", desc)),
        entry(16, 5, (1, "ready", calc)), entry(17, 5, (1, "ready", calc_none)),
        entry(18, 5, (1, "ready", calcmulti)), entry(19, 5, (1, "ready", ddimage)),
        entry(20, 5, (1, "ready", unknown)), entry(21, 5, (1, "ready", gapfill)), entry(22, 5, (1, "ready", rsam)),
        entry(23, 5, (1, "ready", sa_pool1)), entry(24, 5, (1, "ready", sa_pool2)),
        entry(25, 5, (1, "ready", sa_pool3)), entry(26, 5, (1, "ready", broken)),
    ]))
    pool = category4(6, "Random pool", QCTX, entry(40, 6, (1, "ready", pool_a_v1), (2, "ready", pool_a_v2))
                     + entry(41, 6, (1, "hidden", pool_b)))
    subcat = category4(7, "Sub pool", QCTX, entry(42, 7, (1, "ready", pool_c)), parent="6")
    return main + pool + subcat


def _slot(slot: int, entry_id: int = 0, maxmark: str = "1.0000000", setref: str = "", version: str = "$@NULL@$"):
    ref = ""
    if entry_id:
        ref = (f'<question_reference id="{slot}"><usingcontextid>40</usingcontextid><component>mod_quiz</component>'
               f"<questionarea>slot</questionarea><questionbankentryid>{entry_id}</questionbankentryid>"
               f"<version>{version}</version></question_reference>")
    if setref:
        ref = (f'<question_set_reference id="{slot}"><usingcontextid>40</usingcontextid>'
               f"<component>mod_quiz</component><questionarea>slot</questionarea>"
               f"<questionscontextid>{QCTX}</questionscontextid><filtercondition>{esc(setref)}</filtercondition>"
               f"</question_set_reference>")
    return (f'<question_instance id="{slot}"><quizid>1</quizid><slot>{slot}</slot><page>1</page>'
            f"<requireprevious>0</requireprevious><maxmark>{maxmark}</maxmark>{ref}</question_instance>")


@pytest.fixture
def moodle4(tmp_path):
    b = Mbz(tmp_path / "m4")
    ctx = 23
    # Course: summary image, overview image
    b.add_file(png_bytes(), str(ctx), "course", "summary", 0, "banner.png")
    b.add_file(png_bytes(), str(ctx), "course", "overviewfiles", 0, "cover.png")
    b.add_file(png_bytes(), str(ctx), "course", "section", 11, "sec.png")

    # Section 0: page, two labels, page (label merge), hidden page, stealth page
    b.add_file(png_bytes(), "40", "mod_page", "content", 0, "img one.png", filepath="/pics/")
    b.add_file(PDF_BYTES, "40", "mod_page", "content", 0, "other.pdf")
    page_content = ('<p>Hello <img src="@@PLUGINFILE@@/pics/img%20one.png"></p>'
                    '<a href="$@PAGEVIEWBYID*12@$">next</a> <a href="@@PLUGINFILE@@/other.pdf?forcedownload=1">pdf</a>')
    b.activity("page", 1, 10, f"<name>Welcome</name><intro>&lt;p&gt;Page intro&lt;/p&gt;</intro>"
               f"<introformat>1</introformat><content>{esc(page_content)}</content><contentformat>1</contentformat>"
               f'<display>5</display><displayoptions>{esc(chr(97) + ":2:{s:12:\"printheading\";s:1:\"1\";s:10:\"printintro\";s:1:\"1\";}")}</displayoptions>',
               40)
    b.activity("label", 2, 10, "<name>Week one…</name><intro>&lt;h3&gt;Week one&lt;/h3&gt;</intro>"
               "<introformat>1</introformat>", 41)
    b.activity("label", 3, 10, "<name>more</name><intro>&lt;p&gt;Second label&lt;/p&gt;</intro>"
               "<introformat>1</introformat>", 42)
    b.activity("label", 4, 10, "<name>empty</name><intro></intro><introformat>1</introformat>", 43)
    b.activity("page", 5, 10, "<name>Hidden page</name><intro></intro><content>plain text\n\nsecond</content>"
               "<contentformat>2</contentformat>", 44, visible=0)
    b.activity("page", 6, 10, "<name>Stealth</name><intro></intro><content>x</content>", 45, visibleoncoursepage=0)
    b.activity("page", 7, 10, "<name>Excluded</name><content>x</content>", 46)
    b.exclude("page_7")
    b.activity("page", 8, 10, "<name>No folder</name>", 47, write_dir=False)
    b.section(10, 0, summary="<p>General summary</p>", sequence=[3, 2, 1, 4, 5, 6, 7, 8])

    # Section 1 (unnamed): resources, folder, urls, book, imscp
    b.add_file(PDF_BYTES, "50", "mod_resource", "content", 0, "Syllabus.pdf", sortorder=1)
    b.add_file(b"extra", "50", "mod_resource", "content", 0, "unused.txt")
    b.activity("resource", 20, 11, "<name>Syllabus</name><intro></intro><introformat>1</introformat>", 50)
    b.add_file(MP4_BYTES, "51", "mod_resource", "content", 0, "lecture.mp4")
    b.activity("resource", 21, 11, '<name>Lecture</name><intro>&lt;p&gt;Watch&lt;/p&gt;</intro>'
               '<displayoptions>a:1:{s:10:"printintro";i:1;}</displayoptions>', 51)
    b.add_file(png_bytes(), "52", "mod_resource", "content", 0, "chart.png")
    b.activity("resource", 22, 11, "<name>Chart</name><intro>&lt;p&gt;See&lt;/p&gt;</intro>", 52, showdescription=1)
    b.add_file(b"PK\x03\x04docx", "53", "mod_resource", "content", 0, "notes.docx")
    b.activity("resource", 23, 11, "<name>Notes</name><intro></intro>", 53)
    b.add_file(b'<html><body><p>Mini site <img src="img/a.png"></p></body></html>', "54", "mod_resource",
               "content", 0, "index.html", filepath="/site/", sortorder=1)
    b.add_file(png_bytes(), "54", "mod_resource", "content", 0, "a.png", filepath="/site/img/")
    b.activity("resource", 24, 11, "<name>Mini site</name><intro></intro>", 54)
    b.activity("resource", 25, 11, "<name>Lost file</name><intro></intro>", 55)
    b.add_file(PDF_BYTES, "56", "mod_resource", "content", 0, "Handout.pdf")
    b.activity("resource", 26, 11, "<name>Handout</name><intro>&lt;p&gt;Read it&lt;/p&gt;</intro>", 56,
               showdescription=1)
    b.add_file(png_bytes(), "60", "mod_folder", "content", 0, "photo.png")
    b.add_file(b"zip", "60", "mod_folder", "content", 0, "data.zip", filepath="/raw/")
    b.activity("folder", 30, 11, "<name>Materials</name><intro>&lt;p&gt;All files&lt;/p&gt;</intro>", 60)
    b.activity("folder", 31, 11, "<name>Empty folder</name><intro></intro>", 61)
    b.activity("url", 32, 11, "<name>Talk</name><intro>&lt;p&gt;A talk&lt;/p&gt;</intro>"
               "<externalurl>https://www.youtube.com/watch?v=dQw4w9WgXcQ</externalurl>"
               '<displayoptions>a:1:{s:10:"printintro";i:1;}</displayoptions>', 62)
    b.activity("url", 33, 11, "<name>Docs</name><intro></intro><externalurl>https://docs.example.org</externalurl>",
               63)
    b.activity("url", 34, 11, "<name>Empty link</name><externalurl></externalurl>", 64)
    b.activity("url", 35, 11, "<name>Proto relative</name><externalurl>//cdn.example.org/clip.mp4</externalurl>",
               65)
    b.add_file(png_bytes(), "70", "mod_book", "chapter", 2, "fig.png")
    book_chapters = (
        '<chapters><chapter id="1"><pagenum>1</pagenum><subchapter>0</subchapter><title>Basics</title>'
        "<content>&lt;p&gt;Basics body&lt;/p&gt;</content><contentformat>1</contentformat><hidden>0</hidden>"
        '</chapter><chapter id="2"><pagenum>2</pagenum><subchapter>1</subchapter><title>Detail</title>'
        '<content>&lt;img src="@@PLUGINFILE@@/fig.png"&gt;</content><contentformat>1</contentformat>'
        '<hidden>0</hidden></chapter><chapter id="3"><pagenum>3</pagenum><subchapter>1</subchapter>'
        "<title>Secret</title><content>hidden sub</content><hidden>1</hidden></chapter>"
        '<chapter id="4"><pagenum>4</pagenum><subchapter>0</subchapter><title>Advanced</title>'
        "<content>&lt;p&gt;Adv&lt;/p&gt;</content><hidden>1</hidden></chapter></chapters>"
    )
    b.activity("book", 36, 11, f"<name>Handbook</name><intro>&lt;p&gt;Book intro&lt;/p&gt;</intro>{book_chapters}",
               70, showdescription=1)
    b.activity("book", 37, 11, "<name>Empty book</name><intro>&lt;p&gt;i&lt;/p&gt;</intro><chapters></chapters>", 71)
    b.activity("book", 38, 11, "<name>One chapter</name><intro></intro><chapters><chapter id=\"9\"><pagenum>1"
               "</pagenum><subchapter>0</subchapter><title>Only</title><content>x</content><hidden>0</hidden>"
               "</chapter></chapters>", 72)
    manifest = (
        '<manifest identifier="m"><organizations default="o"><organization identifier="o"><title>Pkg</title>'
        '<item identifier="i1" identifierref="r1"><title>Part one</title></item>'
        '<item identifier="i2" identifierref="r2"><title>Part two</title></item>'
        '<item identifier="i3" identifierref="missing"><title>Ghost</title></item></organization></organizations>'
        '<resources><resource identifier="r1" type="webcontent" href="one.html"/>'
        '<resource identifier="r2" type="webcontent" href="sub/two.html"/></resources></manifest>'
    )
    b.add_file(manifest.encode(), "73", "mod_imscp", "content", 1, "imsmanifest.xml")
    b.add_file(b"<p>One</p>", "73", "mod_imscp", "content", 1, "one.html")
    b.add_file(b'<p>Two <img src="../one.png"></p>', "73", "mod_imscp", "content", 1, "two.html", filepath="/sub/")
    b.add_file(png_bytes(), "73", "mod_imscp", "content", 1, "one.png")
    b.add_file(b"<p>old</p>", "73", "mod_imscp", "content", 0, "old.html")
    b.activity("imscp", 39, 11, "<name>Package</name><intro></intro><revision>1</revision>", 73)
    b.add_file(b"<p>Solo</p>", "74", "mod_imscp", "content", 1, "solo.html")
    b.activity("imscp", 40, 11, "<name>No manifest</name><intro></intro><revision>1</revision>", 74)
    b.activity("imscp", 41, 11, "<name>Empty package</name><intro></intro><revision>1</revision>", 75)
    b.section(11, 1, sequence=[20, 21, 22, 23, 24, 25, 26, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41])

    # Section 2 (named, hidden): quiz, lesson, glossary, assign, workshop, scorm, others
    filter43 = json.dumps({"cat": "6,23", "filter": {"category": {"jointype": 1, "values": ["6"],
                                                                  "filteroptions": {"includesubcategories": True}}}})
    filter40 = json.dumps({"questioncategoryid": "6", "includingsubcategories": "0"})
    slots = "".join([
        _slot(1, 1, "2.0000000"), _slot(2, 2), _slot(3, 3), _slot(4, 4), _slot(5, 5), _slot(6, 6), _slot(7, 7),
        _slot(8, 8), _slot(9, 9), _slot(10, 10), _slot(11, 14), _slot(12, 15), _slot(13, 16), _slot(14, 17),
        _slot(15, 18), _slot(16, 19), _slot(17, 20), _slot(18, 21), _slot(19, 22), _slot(20, 99),
        _slot(21, setref=filter43), _slot(22, setref=filter40), _slot(23, setref="not json"),
        _slot(24, setref=json.dumps({"questioncategoryid": "404"})), _slot(25, 26), _slot(26, 1),
    ])
    quiz_inner = (
        "<name>Final quiz</name><intro>&lt;p&gt;Good luck&lt;/p&gt;</intro><introformat>1</introformat>"
        "<timeopen>0</timeopen><timeclose>1735689600</timeclose><timelimit>1830</timelimit>"
        "<attempts_number>3</attempts_number><grademethod>1</grademethod><reviewrightanswer>4352</reviewrightanswer>"
        "<shuffleanswers>1</shuffleanswers><sumgrades>20</sumgrades><grade>10.00000</grade>"
        f"<question_instances>{slots}</question_instances>"
        '<sections><section id="1"><firstslot>1</firstslot><heading></heading><shufflequestions>1</shufflequestions>'
        "</section></sections><feedbacks></feedbacks>"
    )
    grade_item = ('<grade_item id="5"><itemtype>mod</itemtype><itemmodule>quiz</itemmodule><iteminstance>1'
                  "</iteminstance><itemnumber>0</itemnumber><grademax>10.00000</grademax><grademin>0</grademin>"
                  "<gradepass>6.00000</gradepass></grade_item>")
    b.activity("quiz", 50, 12, quiz_inner, 80, grades=grade_item)
    b.activity("quiz", 51, 12, "<name>Practice</name><intro></intro><grade>0</grade><reviewrightanswer>0"
               "</reviewrightanswer><question_instances></question_instances>", 81)

    lesson_pages = (
        '<pages><page id="3"><prevpageid>2</prevpageid><nextpageid>4</nextpageid><qtype>3</qtype><qoption>1</qoption>'
        "<title>Pick</title><contents>Choose primes</contents><contentsformat>1</contentsformat><answers>"
        '<answer id="1"><jumpto>-1</jumpto><score>1</score><answer_text>2</answer_text><response>yes</response>'
        '</answer><answer id="2"><jumpto>-1</jumpto><score>1</score><answer_text>3</answer_text></answer>'
        '<answer id="3"><jumpto>0</jumpto><score>0</score><answer_text>4</answer_text></answer></answers></page>'
        '<page id="1"><prevpageid>0</prevpageid><nextpageid>2</nextpageid><qtype>20</qtype><title>Intro</title>'
        "<contents>&lt;p&gt;Welcome to the lesson&lt;/p&gt;</contents><contentsformat>1</contentsformat>"
        '<answers><answer id="9"><jumpto>-1</jumpto><answer_text>Next</answer_text></answer></answers></page>'
        '<page id="2"><prevpageid>1</prevpageid><nextpageid>3</nextpageid><qtype>2</qtype><title>TF</title>'
        "<contents>Is it?</contents><answers><answer id=\"4\"><jumpto>-1</jumpto><score>1</score>"
        '<answer_text>True</answer_text></answer><answer id="5"><jumpto>0</jumpto><score>0</score>'
        "<answer_text>False</answer_text></answer></answers></page>"
        '<page id="4"><prevpageid>3</prevpageid><nextpageid>5</nextpageid><qtype>1</qtype><qoption>0</qoption>'
        "<title>SA</title><contents>Name it</contents><answers><answer id=\"6\"><jumpto>-1</jumpto><score>1</score>"
        '<answer_text>Moodle</answer_text></answer></answers></page>'
        '<page id="5"><prevpageid>4</prevpageid><nextpageid>6</nextpageid><qtype>8</qtype><title>Num</title>'
        '<contents>Range</contents><answers><answer id="7"><jumpto>-1</jumpto><score>1</score>'
        '<answer_text>4:6</answer_text></answer><answer id="8"><jumpto>-1</jumpto><score>1</score>'
        '<answer_text>10</answer_text></answer><answer id="18"><jumpto>-1</jumpto><score>1</score>'
        "<answer_text>abc</answer_text></answer></answers></page>"
        '<page id="6"><prevpageid>5</prevpageid><nextpageid>7</nextpageid><qtype>5</qtype><title>Match</title>'
        '<contents>Pair</contents><answers><answer id="10"><jumpto>-1</jumpto><answer_text>ok</answer_text></answer>'
        '<answer id="11"><jumpto>0</jumpto><answer_text>no</answer_text></answer>'
        '<answer id="12"><jumpto>0</jumpto><answer_text>One</answer_text><response>1</response></answer>'
        '<answer id="13"><jumpto>0</jumpto><answer_text></answer_text><response>2</response></answer>'
        "</answers></page>"
        '<page id="7"><prevpageid>6</prevpageid><nextpageid>8</nextpageid><qtype>10</qtype><title>Essay</title>'
        "<contents>Write</contents><answers></answers></page>"
        '<page id="8"><prevpageid>7</prevpageid><nextpageid>9</nextpageid><qtype>21</qtype><title>End</title>'
        "</page>"
        '<page id="9"><prevpageid>8</prevpageid><nextpageid>1</nextpageid><qtype>99</qtype><title>Odd</title>'
        "</page>"
        '<page id="10"><prevpageid>99</prevpageid><nextpageid>0</nextpageid><qtype>20</qtype><title>Orphan</title>'
        "<contents></contents></page></pages>"
    )
    b.activity("lesson", 52, 12, f"<name>Lesson one</name><intro>&lt;p&gt;Lesson intro&lt;/p&gt;</intro>"
               f"<custom>1</custom>{lesson_pages}", 82, showdescription=1)
    b.activity("glossary", 53, 12, "<name>Terms</name><intro></intro><entries>"
               '<entry id="1"><concept>Zebra</concept><definition>&lt;p&gt;Striped&lt;/p&gt;</definition>'
               "<definitionformat>1</definitionformat><approved>1</approved></entry>"
               '<entry id="2"><concept>Apple</concept><definition>Fruit</definition><definitionformat>2'
               "</definitionformat><approved>1</approved></entry>"
               '<entry id="3"><concept>Draft</concept><definition>x</definition><approved>0</approved></entry>'
               "</entries>", 83)
    b.activity("glossary", 54, 12, "<name>Empty glossary</name><intro>&lt;p&gt;i&lt;/p&gt;</intro><entries/>", 84)
    b.add_file(PDF_BYTES, "85", "mod_assign", "introattachment", 0, "brief.pdf")
    assign_configs = (
        "<plugin_configs>"
        "<plugin_config><plugin>file</plugin><subtype>assignsubmission</subtype><name>enabled</name>"
        "<value>1</value></plugin_config>"
        "<plugin_config><plugin>onlinetext</plugin><subtype>assignsubmission</subtype><name>enabled</name>"
        "<value>1</value></plugin_config>"
        "<plugin_config><plugin>comments</plugin><subtype>assignfeedback</subtype><name>enabled</name>"
        "<value>1</value></plugin_config></plugin_configs>"
    )
    b.activity("assign", 55, 12, "<name>Essay task</name><intro>&lt;p&gt;Write an essay&lt;/p&gt;</intro>"
               "<introformat>1</introformat><activity>&lt;p&gt;Steps&lt;/p&gt;</activity><activityformat>1"
               f"</activityformat><duedate>1735689600</duedate><grade>50</grade>{assign_configs}", 85,
               grades='<grade_item id="6"><itemnumber>0</itemnumber><grademax>50</grademax><gradepass>25</gradepass>'
                      "</grade_item>")
    b.activity("assign", 56, 12, "<name>Offline</name><intro></intro><duedate>0</duedate><grade>-1</grade>"
               "<plugin_configs></plugin_configs>", 86)
    b.activity("workshop", 57, 12, "<name>Peer review</name><intro>&lt;p&gt;Review&lt;/p&gt;</intro>"
               "<instructauthors>&lt;p&gt;Submit a draft&lt;/p&gt;</instructauthors><instructauthorsformat>1"
               "</instructauthorsformat><grade>80</grade><submissionend>1735689600</submissionend>"
               "<submissiontypetext>0</submissiontypetext><submissiontypefile>2</submissiontypefile>", 87)
    b.add_file(b"PK fake scorm", "88", "mod_scorm", "package", 0, "course.zip")
    b.activity("scorm", 58, 12, "<name>SCORM</name><scormtype>local</scormtype><reference>course.zip</reference>",
               88)
    b.activity("scorm", 59, 12, "<name>Remote SCORM</name><scormtype>external</scormtype>", 89)
    b.activity("scorm", 60, 12, "<name>Lost SCORM</name><scormtype>local</scormtype>", 90)
    b.activity("h5pactivity", 61, 12, "<name>Interactive</name>", 91)
    b.activity("forum", 62, 12, "<name>Announcements</name><type>news</type>", 92)
    b.activity("mysteryplugin", 63, 12, "<name>Mystery</name>", 93)
    b.activity("choice", 64, 12, "<name>Vote</name><intro>&lt;p&gt;Which?&lt;/p&gt;</intro><options>"
               '<option id="1"><text>Yes</text></option><option id="2"><text>No</text></option></options>', 94)
    b.activity("feedback", 65, 12, "<name>Course feedback</name><intro></intro><items>"
               '<item id="2"><name>Rate it</name><presentation>r&gt;&gt;&gt;&gt;&gt;Good\n|Bad&lt;&lt;&lt;&lt;&lt;1'
               "</presentation><typ>multichoice</typ><position>2</position></item>"
               '<item id="1"><name></name><presentation>&lt;p&gt;Please answer&lt;/p&gt;</presentation>'
               "<typ>label</typ><position>1</position></item>"
               '<item id="3"><name>Why?</name><presentation>30|5</presentation><typ>textarea</typ>'
               "<position>3</position></item>"
               '<item id="4"><name></name><presentation></presentation><typ>pagebreak</typ><position>4</position>'
               "</item>"
               '<item id="5"><name>Score</name><presentation>r&gt;&gt;&gt;&gt;&gt;0####Low|1####High</presentation>'
               "<typ>multichoicerated</typ><position>5</position></item></items>", 95)
    b.activity("survey", 66, 12, "<name>COLLES</name><intro>&lt;p&gt;Survey&lt;/p&gt;</intro><template>1"
               "</template>", 96)
    b.activity("questionnaire", 67, 12, "<name>Poll</name><intro></intro><surveys><survey><questions>"
               "<question><name>q1</name><content>&lt;p&gt;Favourite?&lt;/p&gt;</content><deleted>n</deleted>"
               "<quest_choices><quest_choice><content>Red</content></quest_choice><quest_choice><content>Blue"
               "</content></quest_choice></quest_choices></question>"
               "<question><content>gone</content><deleted>y</deleted></question></questions></survey></surveys>",
               97)
    b.activity("wiki", 68, 12, "<name>Wiki</name><intro>&lt;p&gt;Wiki intro&lt;/p&gt;</intro>"
               "<firstpagetitle>Home</firstpagetitle><subwikis><subwiki id=\"3\"><pages>"
               '<page id="2"><title>Other</title><cachedcontent></cachedcontent><versions>'
               '<version id="1"><content>v1</content><version>1</version></version>'
               '<version id="2"><content>v2</content><version>2</version></version></versions></page>'
               '<page id="1"><title>Home</title><cachedcontent>&lt;p&gt;Home page&lt;/p&gt;</cachedcontent></page>'
               "</pages></subwiki></subwikis>", 98)
    b.activity("wiki", 69, 12, "<name>Empty wiki</name><intro></intro><subwikis></subwikis>", 99)
    b.activity("subsection", 70, 12, "<name>Deep dive</name>", 100, instance=7)
    b.activity("page", 71, 14, "<name>Inside subsection</name><content>&lt;p&gt;Nested&lt;/p&gt;</content>", 101)
    b.activity("subsection", 72, 12, "<name>Dangling</name>", 102, instance=8)
    b.activity("forum", 73, 12, "", 103, write_module=False)
    # A broken activity (module XML unreadable) is reported, not fatal
    b.activity("page", 74, 12, "<name>Broken</name>", 104, title="Broken")
    with open(os.path.join(b.root, "activities", "page_74", "page.xml"), "w") as f:
        f.write("<activity><page><name>broken</")
    b.activity("lti", 75, 12, "", 105)
    os.remove(os.path.join(b.root, "activities", "lti_75", "lti.xml"))
    b.activity("oddity", 76, 12, "", 106)
    os.remove(os.path.join(b.root, "activities", "oddity_76", "oddity.xml"))
    b.section(12, 2, name="Assessments", sequence=[50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64,
                                                   65, 66, 67, 68, 69, 70, 72, 73, 74, 75, 76], visible=0)
    b.section(14, 3, name="Delegated", sequence=[71], component="mod_subsection", itemid="7")
    b.section(13, 4, summary='<p><img src="@@PLUGINFILE@@/sec.png"></p>', sequence=[])

    summary = '<p>About <img src="@@PLUGINFILE@@/banner.png"></p>'
    b.write(course_xml(summary=summary), _questions_4x(b))
    return b


@pytest.fixture
def course4(moodle4) -> ir.Course:
    return moodle.read(moodle4.root)


def test_detect(tmp_path, moodle4):
    assert moodle.detect(moodle4.root) == 100
    legacy = tmp_path / "legacy"
    legacy.mkdir()
    (legacy / "moodle.xml").write_text('<?xml version="1.0"?>\n<MOODLE_BACKUP><INFO/></MOODLE_BACKUP>')
    assert moodle.detect(str(legacy)) == 90
    other = tmp_path / "other"
    other.mkdir()
    (other / "moodle.xml").write_text("<something/>")
    assert moodle.detect(str(other)) == 0
    assert moodle.detect(str(tmp_path)) == 0
    with pytest.raises(ValueError):
        moodle.read(str(tmp_path))


def test_course_metadata(course4):
    c = course4
    assert c.title == "Intro to Testing"
    assert c.short_name == "TEST101"
    assert c.language == "fr"
    assert c.tags == ["Python", "Testing"]
    assert c.id == "0123456789ab:2"
    assert c.thumbnail is not None and c.thumbnail.name == "cover.png" and c.thumbnail.exists()
    banner = c.summary.resolve("@@PLUGINFILE@@/banner.png")
    assert banner is not None and banner.name == "banner.png" and banner.exists()


def test_sections(course4):
    titles = [s.title for s in course4.sections]
    # The delegated section (subsection) is not a chapter of its own
    assert titles == ["General", "Topic 1", "Assessments", "Topic 4"]
    general, topic1, assessments, topic4 = course4.sections
    assert general.summary.html == "<p>General summary</p>"
    assert assessments.visible is False and general.visible is True
    assert topic4.summary.resolve("@@PLUGINFILE@@/sec.png").name == "sec.png"
    assert general.id == "section_10"


def test_section_zero_order_labels_and_visibility(course4):
    items = course4.sections[0].items
    # Sequence 3,2,1,...: the two consecutive labels merge into one page
    assert [type(i).__name__ for i in items] == ["Page", "Page", "Page", "Page"]
    labels = items[0]
    assert labels.title == "Second label"
    assert len(labels.parts) == 2
    welcome = items[1]
    assert welcome.title == "Welcome"
    hidden, stealth = items[2], items[3]
    assert hidden.title == "Hidden page" and hidden.visible is False
    assert html_parts(hidden)[0].content.html == "<p>plain text</p><p>second</p>"
    assert stealth.visible is False
    assert all(i.title != "Excluded" for i in items)
    assert ("page", "page", "missing from the backup") in course4.skipped


def test_page_content_and_resolver(course4):
    page = items_by_id(course4)["page_1"]
    intro, content = html_parts(page)
    assert "Page intro" in intro.content.html
    assert "$@PAGEVIEWBYID" not in content.content.html and 'href="#"' in content.content.html
    img = content.content.resolve("@@PLUGINFILE@@/pics/img%20one.png")
    assert img is not None and img.name == "img one.png" and img.exists()
    pdf = content.content.resolve("@@PLUGINFILE@@/other.pdf?forcedownload=1")
    assert pdf.name == "other.pdf"
    # Unique basename fallback inside the area, and in the context
    assert content.content.resolve("@@PLUGINFILE@@/wrong/dir/other.pdf").name == "other.pdf"
    assert content.content.resolve("https://example.org/x.png") is None
    assert content.content.resolve("@@PLUGINFILE@@/nothing.png") is None
    assert content.content.resolve("http://[bad") is None


def test_resources(course4):
    by = items_by_id(course4)
    syllabus = by["resource_20"]
    assert isinstance(syllabus, ir.DocumentItem) and syllabus.asset.name == "Syllabus.pdf"
    lecture = by["resource_21"]
    assert isinstance(lecture, ir.VideoItem) and lecture.asset.name == "lecture.mp4"
    assert "Watch" in lecture.description.html
    chart = by["resource_22"]
    assert isinstance(chart, ir.Page)
    assert isinstance(chart.parts[0], ir.HtmlPart) and isinstance(chart.parts[1], ir.MediaPart)
    assert chart.parts[1].kind == ir.MediaKind.IMAGE
    notes = by["resource_23"]
    assert isinstance(notes.parts[0], ir.FilePart) and notes.parts[0].asset.name == "notes.docx"
    assert not any("kept as a download" in w for w in course4.warnings)  # the package writer reports it
    site = by["resource_24"]
    body = html_parts(site)[0].content
    assert "Mini site" in body.html
    assert body.resolve("img/a.png").name == "a.png"
    lost = by["resource_25"]
    assert isinstance(lost, ir.UnsupportedItem)
    handout = by["resource_26"]
    assert isinstance(handout, ir.Page) and handout.parts[1].kind == ir.MediaKind.PDF


def test_folder_and_urls(course4):
    by = items_by_id(course4)
    folder = by["folder_30"]
    kinds = [type(p).__name__ for p in folder.parts]
    assert kinds == ["HtmlPart", "MediaPart", "HeadingPart", "FilePart"]
    assert folder.parts[2].text == "raw"
    assert ("Empty folder", "folder", "empty in the backup") in course4.skipped
    talk = by["url_32"]
    assert isinstance(talk, ir.VideoItem) and "youtube" in talk.url and "A talk" in talk.description.html
    docs = by["url_33"]
    assert isinstance(docs, ir.Page) and docs.parts[-1].url == "https://docs.example.org"
    assert isinstance(by["url_34"], ir.UnsupportedItem)
    clip = by["url_35"]
    assert isinstance(clip, ir.VideoItem) and clip.url == "https://cdn.example.org/clip.mp4"


def test_book(course4):
    pages = [i for i in course4.sections[1].items if i.id.startswith("book_36")]
    assert [p.title for p in pages] == ["Handbook: Basics", "Handbook: Advanced"]
    first, second = pages
    assert "Book intro" in first.parts[0].content.html
    assert [type(p).__name__ for p in first.parts] == ["HtmlPart", "HtmlPart", "HeadingPart", "HtmlPart"]
    assert first.parts[2].text == "Detail"
    assert first.parts[3].content.resolve("@@PLUGINFILE@@/fig.png").name == "fig.png"
    assert all(getattr(p, "text", "") != "Secret" for p in first.parts)
    assert second.visible is False
    empty = items_by_id(course4)["book_37"]
    assert isinstance(empty, ir.Page) and ("Empty book", "book", "empty in the backup") in course4.skipped
    single = items_by_id(course4)["book_38:chapter_9"]
    assert single.title == "One chapter"


def test_imscp(course4):
    by = items_by_id(course4)
    one, two = by["imscp_39:0"], by["imscp_39:1"]
    assert one.title == "Part one" and two.title == "Part two"
    body = html_parts(two)[0].content
    assert body.resolve("../one.png").name == "one.png"
    solo = by["imscp_40:0"]
    assert solo.title == "No manifest"
    assert isinstance(by["imscp_41"], ir.UnsupportedItem)


def test_quiz_settings(course4):
    quiz = items_by_id(course4)["quiz_50"]
    assert isinstance(quiz, ir.Assessment)
    assert quiz.due_date == "2025-01-01T00:00:00+00:00"
    assert quiz.max_attempts == 3
    assert quiz.time_limit_minutes == 31
    assert quiz.pass_percent == 60.0
    assert quiz.show_correct_answers is True
    assert quiz.shuffle is True
    assert quiz.graded is True
    assert quiz.visible is False  # hidden section
    assert "Good luck" in quiz.intro.html
    practice = items_by_id(course4)["quiz_51"]
    assert practice.graded is False and practice.show_correct_answers is False and practice.max_attempts == 0


def _quiz_questions(course4) -> dict:
    quiz = items_by_id(course4)["quiz_50"]
    return {q.title: q for q in quiz.questions}, quiz


def test_quiz_choice_questions(course4):
    qs, quiz = _quiz_questions(course4)
    mc = qs["Q101"]
    assert mc.type == ir.QType.MULTICHOICE and not mc.multiple
    assert [c.correct for c in mc.choices] == [True, False, False]
    assert mc.choices[0].feedback == "Yes!"
    assert mc.points == 2.0
    assert mc.general_feedback == "<p>Because.</p>"
    assert mc.text.resolve("@@PLUGINFILE@@/diagram.png").name == "diagram.png"
    multi = qs["Q102"]
    assert multi.multiple and [c.correct for c in multi.choices] == [True, True, False] and multi.partial_credit
    tf = qs["Q103"]
    assert tf.type == ir.QType.TRUEFALSE and [c.correct for c in tf.choices] == [True, False]
    match = qs["Q107"]
    assert match.type == ir.QType.MATCHING
    assert [(p.prompt.html, p.answer) for p in match.pairs] == [("France", "Paris"), ("Italy", "Rome")]
    assert match.distractors == ["Berlin"]
    ordering = qs["Q114"]
    assert ordering.ordering == ["First", "Second", "Third"]
    # Slot 26 repeats entry 1: kept once
    assert sum(1 for q in quiz.questions if q.title == "Q101") == 1


def test_quiz_text_questions(course4):
    qs, _quiz = _quiz_questions(course4)
    sa = qs["Q104"]
    assert sa.type == ir.QType.SHORTANSWER and sa.answers == ["Paris", "paris*"] and sa.case_sensitive
    num = qs["Q105"]
    assert num.type == ir.QType.NUMERICAL
    assert [(n.value, n.tolerance) for n in num.numeric] == [(9.81, 0.05)] and num.unit == "m/s2"
    essay = qs["Q106"]
    assert essay.type == ir.QType.ESSAY and essay.allow_attachments and not essay.allow_text
    assert qs["Q115"].type == ir.QType.DESCRIPTION


def test_quiz_cloze_questions(course4):
    qs, _quiz = _quiz_questions(course4)
    dd = qs["Q108"]
    assert dd.type == ir.QType.CLOZE
    assert dd.text.html == "The {{1}} sat on the {{2}}."
    assert dd.blanks[0].answers == ["cat"] and dd.blanks[0].choices == ["cat", "dog"]
    assert dd.blanks[1].answers == ["mat"] and dd.blanks[1].choices == ["mat"]
    gs = qs["Q109"]
    assert gs.text.html == "Water is {{1}}." and gs.blanks[0].answers == ["wet"]
    assert gs.blanks[0].choices == ["dry", "wet"]
    ma = qs["Q110"]
    assert ma.text.html == "Paris is in {{1}}; 2+2={{2}}; colour {{3}}"
    assert ma.blanks[0].answers == ["France"]
    assert ma.blanks[1].numeric.value == 4.0 and ma.blanks[1].numeric.tolerance == 0.5
    assert ma.blanks[2].answers == ["red"] and ma.blanks[2].choices == ["red", "blue"]
    gf = qs["Q121"]
    assert gf.text.html == "The {{1}} sat on the {{2}}."
    assert gf.blanks[0].answers == ["cat", "kitten"]
    assert gf.blanks[0].choices == ["cat", "mat", "dog", "rug", "sofa"]


def test_quiz_calculated_and_unsupported(course4):
    qs, quiz = _quiz_questions(course4)
    calc = qs["Q116"]
    assert calc.type == ir.QType.NUMERICAL
    assert calc.text.html == "What is 1.5 + 2?"
    assert calc.numeric[0].value == 3.5 and calc.numeric[0].tolerance == 0.01
    assert qs["Q117"].type == ir.QType.UNSUPPORTED
    cm = qs["Q118"]
    assert cm.type == ir.QType.MULTICHOICE and cm.text.html == "3 squared?"
    assert [c.text.html for c in cm.choices] == ["9", "4"] and cm.choices[0].correct
    dd = qs["Q119"]
    assert dd.type == ir.QType.UNSUPPORTED and "image" in dd.reason
    weird = qs["Q120"]
    assert weird.type == ir.QType.UNSUPPORTED and weird.source_type == "weirdplugin"
    broken = qs["Q160"]
    assert broken.type == ir.QType.MULTICHOICE  # bad fraction reads as 0
    rsam = qs["Q122"]
    assert rsam.type == ir.QType.MATCHING
    assert [(p.prompt.html, p.answer) for p in rsam.pairs] == [("Capital of France?", "Paris"), ("Two?", "2")]
    assert any("missing from the question bank" in w for w in course4.warnings)


def test_quiz_random_slots(course4):
    _qs, quiz = _quiz_questions(course4)
    titles = [q.title for q in quiz.questions]
    # Random from category 6 with subcategories: latest version of entry 40, not the hidden one, plus subcat
    assert "Q141" in titles and "Q150" in titles
    assert "Q140" not in titles and "Q142" not in titles
    pool_a = next(q for q in quiz.questions if q.title == "Q141")
    assert [c.correct for c in pool_a.choices] == [False, True]
    # Expanding a random slot to its category is a documented difference, not a warning
    assert not any("replaced" in w for w in course4.warnings)
    assert any("unreadable filter" in w for w in course4.warnings)
    assert any(t == "Final quiz" and k == "random question" and "missing from the backup or empty" in r
               for t, k, r in course4.skipped)


def test_lesson(course4):
    lesson = items_by_id(course4)["lesson_52"]
    kinds = [type(p).__name__ for p in lesson.parts]
    assert kinds[:3] == ["HtmlPart", "HeadingPart", "HtmlPart"]
    assert lesson.parts[1].text == "Intro"
    quiz = lesson.parts[3]
    assert isinstance(quiz, ir.InlineQuizPart)
    types = [q.type for q in quiz.questions]
    assert types == [ir.QType.TRUEFALSE, ir.QType.MULTICHOICE, ir.QType.SHORTANSWER, ir.QType.NUMERICAL,
                     ir.QType.MATCHING, ir.QType.ESSAY]
    tf, mc, sa, num, match, _essay = quiz.questions
    assert [c.correct for c in tf.choices] == [True, False]
    assert mc.multiple and [c.correct for c in mc.choices] == [True, True, False]
    assert sa.answers == ["Moodle"]
    assert [(n.value, n.tolerance) for n in num.numeric] == [(5.0, 1.0), (10.0, 0.0)]
    assert [p.answer for p in match.pairs] == ["1"] and match.distractors == ["2"]
    assert lesson.parts[-1].text == "Orphan"
    assert ("Odd", "lesson page", "its question type cannot be converted") in course4.skipped


def test_glossary(course4):
    by = items_by_id(course4)
    terms = by["glossary_53"]
    cards = terms.parts[0].cards
    assert [c[0] for c in cards] == ["Apple", "Zebra"]
    assert cards[0][1] == "<p>Fruit</p>"
    assert any(t == "Empty glossary" and k == "glossary" for t, k, _r in course4.skipped)


def test_assign_and_workshop(course4):
    by = items_by_id(course4)
    a = by["assign_55"]
    assert isinstance(a, ir.AssignmentItem)
    assert "Write an essay" in a.instructions.html and "Steps" in a.instructions.html
    assert a.allow_file and a.allow_text and a.points == 50 and a.pass_percent == 50.0
    assert a.due_date == "2025-01-01T00:00:00+00:00"
    assert [x.name for x in a.attachments] == ["brief.pdf"]
    off = by["assign_56"]
    assert off.points is None and off.allow_file and not off.allow_text
    # Scale grading, offline submission and peer assessment are documented differences: silent
    assert not any("scale" in w or "no online submission" in w or "peer assessment" in w for w in course4.warnings)
    w = by["workshop_57"]
    assert isinstance(w, ir.AssignmentItem) and "Submit a draft" in w.instructions.html
    assert w.allow_file and not w.allow_text and w.points == 80


def test_scorm_and_unsupported(course4):
    by = items_by_id(course4)
    scorm = by["scorm_58"]
    assert isinstance(scorm, ir.ScormItem) and scorm.package.name == "course.zip" and scorm.package.exists()
    assert isinstance(by["scorm_59"], ir.UnsupportedItem)
    assert isinstance(by["scorm_60"], ir.UnsupportedItem)
    h5p = by["h5pactivity_61"]
    assert isinstance(h5p, ir.UnsupportedItem) and "H5P" in h5p.reason
    assert by["forum_62"].kind == "forum"
    assert "mysteryplugin" in by["mysteryplugin_63"].reason
    assert isinstance(by["forum_73"], ir.UnsupportedItem)
    assert isinstance(by["lti_75"], ir.UnsupportedItem)
    assert "oddity_76" not in by
    assert ("oddity", "oddity", "no data in the backup") in course4.skipped
    # Unreadable XML stays a warning; the activity itself is listed as skipped
    assert any("page_74/page.xml is not well-formed XML and could not be read" in w for w in course4.warnings)
    assert ("Broken", "page", "no data in the backup") in course4.skipped


def test_polls(course4):
    by = items_by_id(course4)
    vote = by["choice_64"]
    html = "".join(p.content.html for p in html_parts(vote))
    assert "<li>Yes</li>" in html and "Which?" in html
    fb = by["feedback_65"]
    fb_html = html_parts(fb)[-1].content.html
    assert fb_html.index("Please answer") < fb_html.index("Rate it")
    assert "<li>Good</li><li>Bad</li>" in fb_html and "<li>High</li>" in fb_html and "Why?" in fb_html
    survey = by["survey_66"]
    assert isinstance(survey, ir.Page)
    poll = by["questionnaire_67"]
    poll_html = html_parts(poll)[-1].content.html
    assert "Favourite?" in poll_html and "<li>Blue</li>" in poll_html and "gone" not in poll_html
    assert not any("read-only page" in w for w in course4.warnings)
    assert ("COLLES", "survey", "its built-in questions are not in the backup") in course4.skipped


def test_wiki_and_subsection(course4):
    by = items_by_id(course4)
    wiki = by["wiki_68"]
    headings = [p.text for p in wiki.parts if isinstance(p, ir.HeadingPart)]
    assert headings == ["Home", "Other"]
    assert html_parts(wiki)[-1].content.html == "v2"
    assert isinstance(by["wiki_69"], ir.UnsupportedItem)
    nested = by["page_71"]
    assert nested.title == "Inside subsection" and nested.visible is False
    assert isinstance(by["subsection_72"], ir.UnsupportedItem)


def test_broken_handlers_are_reported(moodle4, monkeypatch):
    def boom(*_a, **_k):
        raise RuntimeError("kaput")

    monkeypatch.setattr(moodle._Questions, "_q_truefalse", boom)
    monkeypatch.setattr(moodle._Moodle2Reader, "_mod_url", boom)
    c = moodle.read(moodle4.root)
    qs, _quiz = _quiz_questions(c)
    assert qs["Q103"].type == ir.QType.UNSUPPORTED and qs["Q103"].reason == "could not be read (kaput)"
    assert not any(k.startswith("url_") for k in items_by_id(c))
    assert any(w.startswith('Could not read url "url"') and "kaput" in w for w in c.warnings)


def _quiz_backup(tmp_path, questions_xml: str, slots: str) -> ir.Course:
    b = Mbz(tmp_path / "quiz")
    b.activity("quiz", 1, 1, f"<name>Quiz</name><intro></intro><grade>10</grade>"
               f"<question_instances>{slots}</question_instances>", 40)
    b.section(1, 1, sequence=[1])
    b.write(course_xml(), questions_xml)
    return moodle.read(b.root)


def test_question_bank_edge_cases(tmp_path):
    v1 = question(202, "shortanswer", "First version", plugin=answers((1, "one", "1")))
    v2 = question(203, "shortanswer", "Second version", plugin=answers((2, "two", "1")))
    no_id = question(204, "truefalse", "No id", plugin=answers((3, "True", "1"))).replace(
        '<question id="204">', "<question>")
    no_cat_id = category4(6, "No id", QCTX, entry(3, 6, (1, "ready", question(205, "truefalse", "Lost")))).replace(
        '<question_category id="6">', "<question_category>")
    bank = category4(5, "Default", QCTX, entry(1, 5, (1, "ready", v1), (2, "ready", v2))
                     + entry(2, 5, (1, "ready", no_id))) + no_cat_id
    # Slot 1 is pinned to version 1, slot 4 takes the latest ready version of the same entry
    c = _quiz_backup(tmp_path, bank, _slot(1, 1, version="1") + _slot(2, 2) + _slot(3, 3) + _slot(4, 1))
    assert [q.title for q in c.sections[0].items[0].questions] == ["Q202", "Q203"]
    assert any("missing from the question bank" in w for w in c.warnings)  # identical warnings are reported once


def test_question_answer_edge_cases(tmp_path):
    partial = question(301, "shortanswer", "Close?", plugin=answers((1, "close", "0.5"), (2, "far", "0.2")))
    nothing = question(302, "shortanswer", "None right", plugin=answers((3, "x", "0")))
    wildcard = question(303, "numerical", "Pi?", plugin=answers((4, "*", "1"), (5, "3.14", "1")))
    stray = question(304, "gapselect", "Fill [[1]] and [[9]].", plugin=answers((6, "one", "0", "1")))
    unknown_child = question(305, "multianswer", "A {#1}",
                             plugin="<multianswer><sequence>999</sequence></multianswer>")
    star_child = question(306, "multianswer", "B {#1}", plugin="<multianswer><sequence>307</sequence></multianswer>")
    child = question(307, "numerical", "{1:NUMERICAL:=*}", parent="306", plugin=answers((7, "*", "1")))
    gapless = question(308, "multianswer", "No gaps here", plugin="<multianswer><sequence></sequence></multianswer>")
    bank = category4(5, "Default", QCTX, "".join(
        entry(i, 5, (1, "ready", q)) for i, q in enumerate(
            [partial, nothing, wildcard, stray, unknown_child, star_child, child, gapless], start=1)))
    c = _quiz_backup(tmp_path, bank, "".join(_slot(i, i) for i in range(1, 7)) + _slot(7, 8))
    qs = {q.title: q for q in c.sections[0].items[0].questions}
    assert qs["Q301"].answers == ["close"]  # best partial credit when nothing scores fully
    assert qs["Q302"].answers == []
    assert [n.value for n in qs["Q303"].numeric] == [3.14]  # "*" accepts anything, so it is not a value
    assert qs["Q304"].text.html == "Fill {{1}} and [[9]]." and len(qs["Q304"].blanks) == 1
    assert qs["Q305"].type == ir.QType.CLOZE and qs["Q305"].blanks == [ir.Blank()]
    assert qs["Q306"].blanks == [ir.Blank()]
    assert qs["Q308"].type == ir.QType.UNSUPPORTED
    assert qs["Q308"].reason == "embedded answers question without any gap"


def test_calculated_edge_cases(tmp_path):
    datasets = (
        "<dataset_definitions>"
        '<dataset_definition id="1"><name>a</name><dataset_items><dataset_item><number>1</number>'
        "<value>3.14159</value></dataset_item></dataset_items></dataset_definition>"
        '<dataset_definition id="2"><name>empty</name><dataset_items></dataset_items></dataset_definition>'
        "</dataset_definitions>"
    )
    sig = question(401, "calculated", "Round {a}", plugin=(
        answers((1, "{a}", "1"))
        + "<calculated_records><calculated_record><answer>1</answer><tolerance>0.1</tolerance>"
          "<tolerancetype>1</tolerancetype><correctanswerlength>3</correctanswerlength>"
          "<correctanswerformat>2</correctanswerformat></calculated_record></calculated_records>" + datasets))
    bare = question(402, "calculated", "Raw {a}", plugin=answers((2, "{a}", "1")) + datasets)
    unknown = question(403, "calculated", "{a} + {b}", plugin=answers((3, "{a} + {b}", "1")) + datasets)
    multi_none = question(404, "calculatedmulti", "{a}?", plugin=answers((4, "{={a}}", "1")))
    multi_old = question(405, "calculatedmulti", "{a}?", plugin=(
        answers((5, "{={a}}", "0.5"), (6, "{={a}+1}", "0.5"))
        + "<calculated_options><calculated_option><single>0</single></calculated_option></calculated_options>"
        + datasets))
    bank = category4(5, "Default", QCTX, "".join(
        entry(i, 5, (1, "ready", q)) for i, q in enumerate([sig, bare, unknown, multi_none, multi_old], start=1)))
    c = _quiz_backup(tmp_path, bank, "".join(_slot(i, i) for i in range(1, 6)))
    qs = {q.title: q for q in c.sections[0].items[0].questions}
    # Three significant figures with a relative tolerance
    assert qs["Q401"].numeric[0].value == 3.14 and qs["Q401"].numeric[0].tolerance == pytest.approx(0.314)
    # No answer record: the value is kept as computed, with no tolerance
    assert qs["Q402"].numeric[0].value == 3.14159 and qs["Q402"].numeric[0].tolerance == 0.0
    assert qs["Q402"].text.html == "Raw 3.14159"
    assert qs["Q403"].type == ir.QType.UNSUPPORTED
    assert qs["Q403"].reason == "calculated question formula could not be evaluated"
    assert qs["Q404"].type == ir.QType.UNSUPPORTED
    assert qs["Q404"].reason == "calculated question without dataset values"
    assert qs["Q405"].multiple is True and [c.correct for c in qs["Q405"].choices] == [True, True]
    assert [c.text.html for c in qs["Q405"].choices] == ["3.14159", "4.14159"]


def test_random_short_answer_matching_edge_cases(tmp_path):
    opts = "<randomsamatch><choose>0</choose><subcats>0</subcats></randomsamatch>"
    rsam = question(501, "randomsamatch", "Match", plugin=opts)
    no_right = question(502, "shortanswer", "Nothing right", plugin=answers((1, "x", "0")))
    ok = question(503, "shortanswer", "Two?", plugin=answers((2, "2", "1")))
    alone = question(504, "randomsamatch", "Alone", plugin=opts)
    bank = (category4(5, "Pool", QCTX, entry(1, 5, (1, "ready", rsam)) + entry(2, 5, (1, "ready", no_right))
                      + entry(3, 5, (1, "ready", ok)))
            + category4(6, "Empty", QCTX, entry(4, 6, (1, "ready", alone))))
    c = _quiz_backup(tmp_path, bank, _slot(1, 1) + _slot(2, 4))
    qs = {q.title: q for q in c.sections[0].items[0].questions}
    assert [(p.prompt.html, p.answer) for p in qs["Q501"].pairs] == [("Two?", "2")]
    assert qs["Q504"].type == ir.QType.UNSUPPORTED
    assert qs["Q504"].reason == "random short-answer matching found no short-answer questions in its category"


def test_lesson_numerical_skips_wrong_answers(tmp_path):
    b = Mbz(tmp_path / "lesson")
    pages = ('<pages><page id="1"><prevpageid>0</prevpageid><nextpageid>0</nextpageid><qtype>8</qtype>'
             "<title>Num</title><contents>Guess</contents><answers>"
             '<answer id="1"><jumpto>-1</jumpto><score>1</score><answer_text>4</answer_text></answer>'
             '<answer id="2"><jumpto>0</jumpto><score>0</score><answer_text>99</answer_text></answer>'
             "</answers></page></pages>")
    b.activity("lesson", 1, 1, f"<name>L</name><intro></intro><custom>1</custom>{pages}", 40)
    b.section(1, 1, sequence=[1])
    b.write(course_xml())
    lesson = moodle.read(b.root).sections[0].items[0]
    quiz = next(p for p in lesson.parts if isinstance(p, ir.InlineQuizPart))
    assert [(n.value, n.tolerance) for n in quiz.questions[0].numeric] == [(4.0, 0.0)]


def test_module_and_section_edge_cases(tmp_path):
    b = Mbz(tmp_path / "mods")
    # A module whose deletion was in progress is dropped without a report
    b.activity("page", 1, 1, "<name>Deleting</name><content>x</content>", 40)
    module_xml = os.path.join(b.root, "activities", "page_1", "module.xml")
    with open(module_xml) as f:
        xml = f.read()
    with open(module_xml, "w") as f:
        f.write(xml.replace("</module>", "<deletioninprogress>1</deletioninprogress></module>"))
    # A grade item without a pass grade gives no pass percentage
    b.activity("quiz", 2, 1, "<name>No pass</name><intro></intro><grade>10</grade><question_instances/>", 41,
               grades='<grade_item id="1"><itemnumber>0</itemnumber><grademax>10</grademax><gradepass>0</gradepass>'
                      "</grade_item>")
    # An HTML resource whose blob is missing from the archive is kept as a plain file
    digest = b.add_file(b"<p>gone</p>", "42", "mod_resource", "content", 0, "index.html")
    os.remove(os.path.join(b.root, "files", digest[:2], digest))
    b.activity("resource", 3, 1, "<name>Lost page</name><intro></intro>", 42)
    # cp1252 pages still render
    b.add_file(b"<p>caf\xe9</p>", "43", "mod_resource", "content", 0, "latin.html")
    b.activity("resource", 4, 1, "<name>Latin</name><intro></intro>", 43)
    # IMS package with no HTML page
    b.add_file(png_bytes(), "44", "mod_imscp", "content", 1, "only.png")
    b.activity("imscp", 5, 1, "<name>Pictures</name><intro></intro><revision>1</revision>", 44)
    # Delegated section with a summary of its own
    b.activity("subsection", 6, 1, "<name>Deep</name>", 45, instance=9)
    b.activity("page", 7, 3, "<name>Nested</name><content>n</content>", 46)
    b.section(1, 1, sequence=[1, 2, 3, 4, 5, 6])
    b.section(3, 2, name="Delegated", summary="<p>Deep summary</p>", sequence=[7], component="mod_subsection",
              itemid="9")
    # An excluded section and one whose directory escapes the backup are both left out
    b.section(2, 3, name="Excluded")
    b.exclude("section_2")
    b.sections.append("<section><sectionid>8</sectionid><title>8</title><directory>../outside</directory></section>")
    b.write(course_xml())
    c = moodle.read(b.root)
    assert [s.title for s in c.sections] == ["Topic 1"]
    by = items_by_id(c)
    assert "page_1" not in by and not any(t == "Deleting" for t, _k, _r in c.skipped)
    assert by["quiz_2"].pass_percent is None
    assert isinstance(by["resource_3"].parts[0], ir.FilePart)
    assert html_parts(by["resource_4"])[0].content.html == "<p>café</p>"
    assert isinstance(by["imscp_5"], ir.UnsupportedItem)
    assert by["imscp_5"].reason == "no page to show in the content package"
    assert html_parts(by["subsection_6:summary"])[0].content.html == "<p>Deep summary</p>"
    assert by["page_7"].title == "Nested"


def test_detect_and_text_file_fallbacks(tmp_path, monkeypatch):
    legacy = tmp_path / "legacy"
    legacy.mkdir()
    (legacy / "moodle.xml").write_text("<MOODLE_BACKUP/>")
    real_open = open

    def deny(path, *args, **kwargs):
        if str(path).endswith("moodle.xml"):
            raise PermissionError("denied")
        return real_open(path, *args, **kwargs)

    monkeypatch.setattr("builtins.open", deny)
    assert moodle.detect(str(legacy)) == 0  # unreadable: not claimed
    monkeypatch.undo()
    assert moodle.detect(str(legacy)) == 90
    assert moodle._read_text_file(str(tmp_path / "missing.html")) == ""


# ---------------------------------------------------------------------------
# Moodle 3.x / 2.x backups (question_instances without references)
# ---------------------------------------------------------------------------


def _write_3x(tmp_path, fmt="weeks", with_course=True):
    b = Mbz(tmp_path / "m3")
    hidden = question(13, "shortanswer", "Hidden one", plugin=answers((3, "h", "1"))).replace(
        "<qtype>", "<hidden>1</hidden><qtype>")
    questions = category3(1, "Top", QCTX, "".join([
        question(10, "truefalse", "Is 3.x?", plugin=answers((1, "True", "1"), (2, "False", "0"))),
        question(11, "random", "1", name="Random (Top)"),
        question(12, "shortanswer", "Name?", plugin=answers((4, "Bob", "1")) + "<shortanswer><usecase>0</usecase>"
                                                                               "</shortanswer>"),
        hidden,
        question(14, "multianswer", "Inline {1:SA:=yes} and {1:MCV:no~=maybe}", plugin=""),
    ])) + category3(2, "Child", QCTX, question(20, "essay", "Write", plugin=(
        "<essay><responseformat>editorfilepicker</responseformat><attachments>0</attachments></essay>")), parent="1")
    old_quiz = (
        "<name>Old quiz</name><intro></intro><timeclose>0</timeclose><timelimit>0</timelimit>"
        "<attempts_number>1</attempts_number><grade>10</grade><questions>14,0,12,10,0</questions>"
        "<question_instances>"
        '<question_instance id="1"><question>10</question><grade>3</grade></question_instance>'
        '<question_instance id="2"><question>12</question><grade>1</grade></question_instance>'
        '<question_instance id="3"><question>14</question><grade>2</grade></question_instance>'
        "</question_instances>"
    )
    new_quiz = (
        "<name>Quiz 3x</name><intro></intro><shufflequestions>1</shufflequestions><grade>10</grade>"
        "<question_instances>"
        '<question_instance id="5"><slot>2</slot><questionid>11</questionid><maxmark>1</maxmark></question_instance>'
        '<question_instance id="4"><slot>1</slot><questionid>10</questionid><maxmark>1</maxmark></question_instance>'
        '<question_instance id="6"><slot>3</slot><questionid>999</questionid><maxmark>1</maxmark>'
        "</question_instance></question_instances>"
    )
    b.activity("quiz", 1, 1, old_quiz, 30)
    b.activity("quiz", 2, 1, new_quiz, 31)
    b.section(1, 1, sequence=[2, 1])
    b.section(2, 0)
    b.write(course_xml(fmt=fmt) if with_course else None, questions)
    return b


def test_moodle3_quizzes(tmp_path):
    b = _write_3x(tmp_path)
    c = moodle.read(b.root)
    assert [s.title for s in c.sections] == ["General", "15 November - 21 November"]
    new_quiz, old_quiz = c.sections[1].items
    assert new_quiz.title == "Quiz 3x" and new_quiz.shuffle
    titles = [q.title for q in new_quiz.questions]
    # Slot 1 (Q10), then the random slot expands Top + Child (subcategories), skipping Q10 and the hidden Q13
    assert titles == ["Q10", "Q12", "Q14", "Q20"]
    assert any("question 999 is missing" in w for w in c.warnings)
    essay = new_quiz.questions[-1]
    assert essay.allow_attachments and essay.allow_text
    cloze = new_quiz.questions[2]
    assert cloze.text.html == "Inline {{1}} and {{2}}"
    assert cloze.blanks[1].answers == ["maybe"] and cloze.blanks[1].choices == ["no", "maybe"]
    assert [q.title for q in old_quiz.questions] == ["Q14", "Q12", "Q10"]
    assert [q.points for q in old_quiz.questions] == [2.0, 1.0, 3.0]


def test_moodle2_without_course_xml_and_sections_dir(tmp_path):
    b = _write_3x(tmp_path, with_course=False)
    # Section listing missing from moodle_backup.xml: fall back to the sections folder
    b.sections.clear()
    b.write(None)
    c = moodle.read(b.root)
    assert c.title == "Backup name" and c.short_name == "BK"
    assert [s.title for s in c.sections] == ["General", "Topic 1"]
    assert any("course.xml is missing" in w for w in c.warnings)


def test_unreadable_backup(tmp_path):
    (tmp_path / "moodle_backup.xml").write_text("<moodle_backup><information>")
    with pytest.raises(ValueError):
        moodle.read(str(tmp_path))
    legacy = tmp_path / "legacy"
    legacy.mkdir()
    (legacy / "moodle.xml").write_text("<MOODLE_BACKUP><broken>")
    with pytest.raises(ValueError):
        moodle.read(str(legacy))


def test_files_xml_hardening(tmp_path):
    b = Mbz(tmp_path / "h")
    b.add_file(b"<p>x</p>", "40", "mod_page", "content", 0, "a.html")
    # Duplicate listing and a path-traversal hash are ignored
    b.files.append(b.files[0])
    b.files.append('<file id="99"><contenthash>../../etc/passwd</contenthash><contextid>40</contextid>'
                   "<component>mod_page</component><filearea>content</filearea><itemid>0</itemid>"
                   "<filepath>/</filepath><filename>evil.png</filename></file>")
    b.files.append('<file id="98"><contenthash>' + "a" * 40 + "</contenthash><contextid>40</contextid>"
                   "<component>mod_page</component><filearea>content</filearea><itemid>0</itemid>"
                   "<filepath>sub</filepath><filename>rel.png</filename></file>")
    b.activity("page", 1, 1, '<name>P</name><content>&lt;img src="@@PLUGINFILE@@/evil.png"&gt;</content>', 40)
    b.section(1, 0, sequence=[1])
    b.write(course_xml())
    c = moodle.read(b.root)
    page = c.sections[0].items[0]
    rich = html_parts(page)[0].content
    assert rich.resolve("@@PLUGINFILE@@/evil.png") is None
    assert rich.resolve("@@PLUGINFILE@@/sub/rel.png").name == "rel.png"
    store = moodle._FileStore(b.root, moodle.FileIndex(b.root))
    assert len(store.area("mod_page", "content", "0", "40")) == 2


# ---------------------------------------------------------------------------
# Moodle 1.9
# ---------------------------------------------------------------------------


def _legacy_backup(tmp_path) -> str:
    root = tmp_path / "m19"
    (root / "course_files" / "docs" / "sub").mkdir(parents=True)
    (root / "course_files" / "docs" / "syllabus.pdf").write_bytes(PDF_BYTES)
    (root / "course_files" / "docs" / "sub" / "pic.png").write_bytes(png_bytes())
    (root / "course_files" / "logo.png").write_bytes(png_bytes())
    (root / "course_files" / "page.html").write_text('<p>Static <img src="logo.png"></p>')
    (root / "course_files" / "pkg.zip").write_bytes(b"PK")
    (root / "course_files" / "notes.odt").write_bytes(b"odt")

    def q(qid, qtype, text, extra="", parent="0", grade="1"):
        return (f"<QUESTION><ID>{qid}</ID><PARENT>{parent}</PARENT><NAME>L{qid}</NAME>"
                f"<QUESTIONTEXT>{esc(text)}</QUESTIONTEXT><QUESTIONTEXTFORMAT>1</QUESTIONTEXTFORMAT>"
                f"<GENERALFEEDBACK></GENERALFEEDBACK><DEFAULTGRADE>{grade}</DEFAULTGRADE><PENALTY>0.1</PENALTY>"
                f"<QTYPE>{qtype}</QTYPE><LENGTH>1</LENGTH><STAMP>x</STAMP><HIDDEN>0</HIDDEN>{extra}</QUESTION>")

    def ans(*items):
        return "<ANSWERS>" + "".join(
            f"<ANSWER><ID>{i}</ID><ANSWER_TEXT>{esc(t)}</ANSWER_TEXT><FRACTION>{f}</FRACTION>"
            f"<FEEDBACK></FEEDBACK></ANSWER>" for i, t, f in items) + "</ANSWERS>"

    questions = "".join([
        q(1, "multichoice", '<p>Pick <img src="$@FILEPHP@$$@SLASH@$logo.png"></p>',
          ans((1, "A", "1"), (2, "B", "0")) + "<MULTICHOICE><LAYOUT>0</LAYOUT><ANSWERS>1,2</ANSWERS>"
                                               "<SINGLE>1</SINGLE></MULTICHOICE>"),
        q(2, "truefalse", "TF", ans((3, "True", "0"), (4, "False", "1"))
          + "<TRUEFALSE><TRUEANSWER>3</TRUEANSWER><FALSEANSWER>4</FALSEANSWER></TRUEFALSE>"),
        q(3, "numerical", "Pi?", ans((5, "3.14", "1")) + "<NUMERICAL><ANSWER>5</ANSWER><TOLERANCE>0.01</TOLERANCE>"
                                                         "</NUMERICAL>"),
        q(4, "match", "Match", "<MATCHOPTIONS><SHUFFLEANSWERS>1</SHUFFLEANSWERS></MATCHOPTIONS><MATCHS>"
          "<MATCH><ID>1</ID><CODE>1</CODE><QUESTIONTEXT>Dog</QUESTIONTEXT><ANSWERTEXT>Bark</ANSWERTEXT></MATCH>"
          "<MATCH><ID>2</ID><CODE>2</CODE><QUESTIONTEXT>Cat</QUESTIONTEXT><ANSWERTEXT>Meow</ANSWERTEXT></MATCH>"
          "</MATCHS>"),
        q(5, "multianswer", "Say {#1}", "<MULTIANSWERS><MULTIANSWER><ID>1</ID><QUESTION>5</QUESTION>"
          "<SEQUENCE>6</SEQUENCE></MULTIANSWER></MULTIANSWERS>"),
        q(6, "shortanswer", "{1:SHORTANSWER:=hello}", parent="5"),
        q(7, "random", "0"),
        q(8, "shortanswer", "Spell", ans((8, "word", "1")) + "<SHORTANSWER><USECASE>1</USECASE></SHORTANSWER>"),
    ])
    xml = f"""<?xml version="1.0" encoding="UTF-8" ?>
<MOODLE_BACKUP>
  <INFO><NAME>backup.zip</NAME><MOODLE_VERSION>2007101509</MOODLE_VERSION><MOODLE_RELEASE>1.9.9</MOODLE_RELEASE></INFO>
  <COURSE>
    <HEADER><ID>7</ID><FULLNAME>Legacy course</FULLNAME><SHORTNAME>LEG</SHORTNAME>
      <SUMMARY>{esc('<p>Old <img src="$@FILEPHP@$/logo.png"></p>')}</SUMMARY><FORMAT>weeks</FORMAT><LANG>de_utf8</LANG></HEADER>
    <SECTIONS>
      <SECTION><ID>2</ID><NUMBER>1</NUMBER><SUMMARY></SUMMARY><VISIBLE>0</VISIBLE><MODS>
        <MOD><ID>20</ID><TYPE>quiz</TYPE><INSTANCE>1</INSTANCE><VISIBLE>1</VISIBLE></MOD>
        <MOD><ID>21</ID><TYPE>assignment</TYPE><INSTANCE>1</INSTANCE><VISIBLE>1</VISIBLE></MOD>
        <MOD><ID>22</ID><TYPE>glossary</TYPE><INSTANCE>1</INSTANCE><VISIBLE>1</VISIBLE></MOD>
        <MOD><ID>23</ID><TYPE>book</TYPE><INSTANCE>1</INSTANCE><VISIBLE>1</VISIBLE></MOD>
        <MOD><ID>24</ID><TYPE>lesson</TYPE><INSTANCE>1</INSTANCE><VISIBLE>1</VISIBLE></MOD>
        <MOD><ID>25</ID><TYPE>scorm</TYPE><INSTANCE>1</INSTANCE><VISIBLE>1</VISIBLE></MOD>
        <MOD><ID>26</ID><TYPE>scorm</TYPE><INSTANCE>2</INSTANCE><VISIBLE>1</VISIBLE></MOD>
        <MOD><ID>27</ID><TYPE>choice</TYPE><INSTANCE>1</INSTANCE><VISIBLE>1</VISIBLE></MOD>
        <MOD><ID>28</ID><TYPE>forum</TYPE><INSTANCE>1</INSTANCE><VISIBLE>1</VISIBLE></MOD>
        <MOD><ID>29</ID><TYPE>quiz</TYPE><INSTANCE>2</INSTANCE><VISIBLE>1</VISIBLE></MOD>
      </MODS></SECTION>
      <SECTION><ID>1</ID><NUMBER>0</NUMBER><SUMMARY>Intro</SUMMARY><VISIBLE>1</VISIBLE><MODS>
        <MOD><ID>10</ID><TYPE>label</TYPE><INSTANCE>1</INSTANCE><VISIBLE>1</VISIBLE></MOD>
        <MOD><ID>11</ID><TYPE>label</TYPE><INSTANCE>2</INSTANCE><VISIBLE>1</VISIBLE></MOD>
        <MOD><ID>12</ID><TYPE>label</TYPE><INSTANCE>3</INSTANCE><VISIBLE>1</VISIBLE></MOD>
        <MOD><ID>13</ID><TYPE>resource</TYPE><INSTANCE>1</INSTANCE><VISIBLE>1</VISIBLE></MOD>
        <MOD><ID>14</ID><TYPE>resource</TYPE><INSTANCE>2</INSTANCE><VISIBLE>0</VISIBLE></MOD>
        <MOD><ID>15</ID><TYPE>resource</TYPE><INSTANCE>3</INSTANCE><VISIBLE>1</VISIBLE></MOD>
        <MOD><ID>16</ID><TYPE>resource</TYPE><INSTANCE>4</INSTANCE><VISIBLE>1</VISIBLE></MOD>
        <MOD><ID>17</ID><TYPE>resource</TYPE><INSTANCE>5</INSTANCE><VISIBLE>1</VISIBLE></MOD>
        <MOD><ID>18</ID><TYPE>resource</TYPE><INSTANCE>6</INSTANCE><VISIBLE>1</VISIBLE></MOD>
        <MOD><ID>19</ID><TYPE>resource</TYPE><INSTANCE>7</INSTANCE><VISIBLE>1</VISIBLE></MOD>
        <MOD><ID>30</ID><TYPE>resource</TYPE><INSTANCE>8</INSTANCE><VISIBLE>1</VISIBLE></MOD>
        <MOD><ID>31</ID><TYPE>resource</TYPE><INSTANCE>9</INSTANCE><VISIBLE>1</VISIBLE></MOD>
        <MOD><ID>32</ID><TYPE>resource</TYPE><INSTANCE>10</INSTANCE><VISIBLE>1</VISIBLE></MOD>
        <MOD><ID>33</ID><TYPE>resource</TYPE><INSTANCE>404</INSTANCE><VISIBLE>1</VISIBLE></MOD>
      </MODS></SECTION>
    </SECTIONS>
    <QUESTION_CATEGORIES>
      <QUESTION_CATEGORY><ID>1</ID><NAME>Default</NAME><INFO></INFO><PARENT>0</PARENT>
        <QUESTIONS>{questions}</QUESTIONS></QUESTION_CATEGORY>
    </QUESTION_CATEGORIES>
    <MODULES>
      <MOD><ID>1</ID><MODTYPE>label</MODTYPE><NAME>First</NAME><CONTENT>{esc('<p>Label one</p>')}</CONTENT></MOD>
      <MOD><ID>2</ID><MODTYPE>label</MODTYPE><NAME>Second</NAME><CONTENT>{esc('<p>Label two</p>')}</CONTENT></MOD>
      <MOD><ID>3</ID><MODTYPE>label</MODTYPE><NAME>Blank</NAME><CONTENT></CONTENT></MOD>
      <MOD><ID>1</ID><MODTYPE>resource</MODTYPE><NAME>Syllabus</NAME><TYPE>file</TYPE><REFERENCE>docs/syllabus.pdf</REFERENCE><SUMMARY></SUMMARY></MOD>
      <MOD><ID>2</ID><MODTYPE>resource</MODTYPE><NAME>Web page</NAME><TYPE>html</TYPE><SUMMARY>{esc('<p>sum</p>')}</SUMMARY><ALLTEXT>{esc('<p>Body <img src="$@FILEPHP@$$@SLASH@$docs$@SLASH@$sub$@SLASH@$pic.png"></p>')}</ALLTEXT></MOD>
      <MOD><ID>3</ID><MODTYPE>resource</MODTYPE><NAME>Plain</NAME><TYPE>text</TYPE><ALLTEXT>line one
line two</ALLTEXT></MOD>
      <MOD><ID>4</ID><MODTYPE>resource</MODTYPE><NAME>Docs folder</NAME><TYPE>directory</TYPE><REFERENCE>docs</REFERENCE></MOD>
      <MOD><ID>5</ID><MODTYPE>resource</MODTYPE><NAME>Link</NAME><TYPE>file</TYPE><REFERENCE>http://example.org/page</REFERENCE></MOD>
      <MOD><ID>6</ID><MODTYPE>resource</MODTYPE><NAME>Static</NAME><TYPE>file</TYPE><REFERENCE>page.html</REFERENCE></MOD>
      <MOD><ID>7</ID><MODTYPE>resource</MODTYPE><NAME>Missing</NAME><TYPE>file</TYPE><REFERENCE>nope.pdf</REFERENCE></MOD>
      <MOD><ID>8</ID><MODTYPE>resource</MODTYPE><NAME>IMS</NAME><TYPE>ims</TYPE><REFERENCE>x</REFERENCE></MOD>
      <MOD><ID>9</ID><MODTYPE>resource</MODTYPE><NAME>Empty dir</NAME><TYPE>directory</TYPE><REFERENCE>none</REFERENCE></MOD>
      <MOD><ID>10</ID><MODTYPE>resource</MODTYPE><NAME>Notes</NAME><TYPE>file</TYPE><REFERENCE>notes.odt</REFERENCE></MOD>
      <MOD><ID>1</ID><MODTYPE>quiz</MODTYPE><NAME>Legacy quiz</NAME><INTRO>{esc('<p>Old intro</p>')}</INTRO>
        <TIMECLOSE>1735689600</TIMECLOSE><ATTEMPTS_NUMBER>2</ATTEMPTS_NUMBER><TIMELIMIT>20</TIMELIMIT>
        <SHUFFLEQUESTIONS>1</SHUFFLEQUESTIONS><QUESTIONS>1,2,0,3,4,5,7,404</QUESTIONS><GRADE>10</GRADE>
        <QUESTION_INSTANCES><QUESTION_INSTANCE><ID>1</ID><QUESTION>1</QUESTION><GRADE>2</GRADE></QUESTION_INSTANCE>
        <QUESTION_INSTANCE><ID>2</ID><QUESTION>7</QUESTION><GRADE>1</GRADE></QUESTION_INSTANCE></QUESTION_INSTANCES></MOD>
      <MOD><ID>2</ID><MODTYPE>quiz</MODTYPE><NAME>Ungraded</NAME><GRADE>0</GRADE>
        <QUESTION_INSTANCES><QUESTION_INSTANCE><ID>3</ID><QUESTION>8</QUESTION><GRADE>1</GRADE></QUESTION_INSTANCE></QUESTION_INSTANCES></MOD>
      <MOD><ID>1</ID><MODTYPE>assignment</MODTYPE><NAME>Upload it</NAME><DESCRIPTION>Do it</DESCRIPTION><FORMAT>0</FORMAT>
        <ASSIGNMENTTYPE>online</ASSIGNMENTTYPE><TIMEDUE>1735689600</TIMEDUE><GRADE>20</GRADE></MOD>
      <MOD><ID>1</ID><MODTYPE>glossary</MODTYPE><NAME>Words</NAME><INTRO></INTRO><ENTRIES>
        <ENTRY><ID>1</ID><CONCEPT>Term</CONCEPT><DEFINITION>Meaning</DEFINITION><APPROVED>1</APPROVED></ENTRY></ENTRIES></MOD>
      <MOD><ID>1</ID><MODTYPE>book</MODTYPE><NAME>Old book</NAME><CHAPTERS>
        <CHAPTER><ID>1</ID><PAGENUM>2</PAGENUM><SUBCHAPTER>1</SUBCHAPTER><TITLE>Sub</TITLE><CONTENT>s</CONTENT><HIDDEN>0</HIDDEN></CHAPTER>
        <CHAPTER><ID>2</ID><PAGENUM>1</PAGENUM><SUBCHAPTER>0</SUBCHAPTER><TITLE>Main</TITLE><CONTENT>m</CONTENT><HIDDEN>0</HIDDEN></CHAPTER>
        <CHAPTER><ID>3</ID><PAGENUM>3</PAGENUM><SUBCHAPTER>0</SUBCHAPTER><TITLE>Hidden</TITLE><CONTENT>h</CONTENT><HIDDEN>1</HIDDEN></CHAPTER>
      </CHAPTERS></MOD>
      <MOD><ID>1</ID><MODTYPE>lesson</MODTYPE><NAME>Old lesson</NAME><CUSTOM>0</CUSTOM><PAGES>
        <PAGE><PAGEID>1</PAGEID><PREVPAGEID>0</PREVPAGEID><NEXTPAGEID>2</NEXTPAGEID><QTYPE>20</QTYPE><TITLE>Start</TITLE><CONTENTS>Hi</CONTENTS></PAGE>
        <PAGE><PAGEID>2</PAGEID><PREVPAGEID>1</PREVPAGEID><NEXTPAGEID>0</NEXTPAGEID><QTYPE>3</QTYPE><TITLE>Q</TITLE><CONTENTS>Pick</CONTENTS>
          <ANSWERS><ANSWER><ID>1</ID><JUMPTO>-1</JUMPTO><SCORE>0</SCORE><ANSWERTEXT>Right</ANSWERTEXT></ANSWER>
          <ANSWER><ID>2</ID><JUMPTO>0</JUMPTO><SCORE>0</SCORE><ANSWERTEXT>Wrong</ANSWERTEXT></ANSWER></ANSWERS></PAGE>
      </PAGES></MOD>
      <MOD><ID>1</ID><MODTYPE>scorm</MODTYPE><NAME>Old SCORM</NAME><REFERENCE>pkg.zip</REFERENCE></MOD>
      <MOD><ID>2</ID><MODTYPE>scorm</MODTYPE><NAME>Gone SCORM</NAME><REFERENCE>gone.zip</REFERENCE></MOD>
      <MOD><ID>1</ID><MODTYPE>choice</MODTYPE><NAME>Pick one</NAME><TEXT>Which</TEXT><OPTIONS>
        <OPTION><ID>1</ID><TEXT>Left</TEXT></OPTION><OPTION><ID>2</ID><TEXT>Right</TEXT></OPTION></OPTIONS></MOD>
      <MOD><ID>1</ID><MODTYPE>forum</MODTYPE><NAME>News</NAME></MOD>
    </MODULES>
  </COURSE>
</MOODLE_BACKUP>
"""
    (root / "moodle.xml").write_text(xml, encoding="utf-8")
    return str(root)


def test_moodle19(tmp_path):
    root = _legacy_backup(tmp_path)
    assert moodle.detect(root) == 90
    c = moodle.read(root)
    assert c.title == "Legacy course" and c.short_name == "LEG" and c.language == "de_utf8" and c.id == "7"
    assert c.summary.resolve("$@FILEPHP@$/logo.png").name == "logo.png"
    assert [s.title for s in c.sections] == ["General", "Week 1"]
    general, week = c.sections
    assert general.summary.html == "Intro"
    assert week.visible is False
    by = items_by_id(c)

    labels = by["label_10"]
    assert labels.title == "Label one" and len(labels.parts) == 2
    assert isinstance(by["resource_13"], ir.DocumentItem) and by["resource_13"].asset.name == "syllabus.pdf"
    web = by["resource_14"]
    assert web.visible is False and len(web.parts) == 2
    pic = web.parts[1].content.resolve("$@FILEPHP@$$@SLASH@$docs$@SLASH@$sub$@SLASH@$pic.png")
    assert pic is not None and pic.name == "pic.png"
    plain = by["resource_15"]
    assert plain.parts[0].content.html == "<p>line one<br>line two</p>"
    folder = by["resource_16"]
    assert [type(p).__name__ for p in folder.parts] == ["MediaPart", "HeadingPart", "MediaPart"]
    link = by["resource_17"]
    assert isinstance(link, ir.Page) and link.parts[-1].url == "http://example.org/page"
    static = by["resource_18"]
    assert static.parts[0].content.resolve("logo.png").name == "logo.png"
    assert isinstance(by["resource_19"], ir.UnsupportedItem)
    assert isinstance(by["resource_30"], ir.UnsupportedItem)
    assert ("Empty dir", "folder", "empty in the backup") in c.skipped
    assert isinstance(by["resource_32"].parts[0], ir.FilePart)

    quiz = by["quiz_20"]
    assert quiz.due_date == "2025-01-01T00:00:00+00:00" and quiz.max_attempts == 2
    assert quiz.time_limit_minutes == 20 and quiz.shuffle and quiz.visible is False
    types = [q.type for q in quiz.questions]
    assert types[:5] == [ir.QType.MULTICHOICE, ir.QType.TRUEFALSE, ir.QType.NUMERICAL, ir.QType.MATCHING,
                         ir.QType.CLOZE]
    mc, tf, num, match, cloze = quiz.questions[:5]
    assert mc.points == 2.0 and [ch.correct for ch in mc.choices] == [True, False]
    assert mc.text.resolve('$@FILEPHP@$$@SLASH@$logo.png').name == "logo.png"
    assert [ch.correct for ch in tf.choices] == [False, True]
    assert num.numeric[0].tolerance == 0.01
    assert [p.answer for p in match.pairs] == ["Bark", "Meow"]
    assert cloze.text.html == "Say {{1}}" and cloze.blanks[0].answers == ["hello"]
    # The random question pulled the remaining short answer of the category
    assert quiz.questions[-1].title == "L8" and quiz.questions[-1].case_sensitive
    assert any("404 is missing" in w for w in c.warnings)
    assert by["quiz_29"].graded is False and by["quiz_29"].questions[0].title == "L8"

    assign = by["assignment_21"]
    assert assign.allow_text and not assign.allow_file and assign.points == 20
    assert by["glossary_22"].parts[0].cards == [("Term", "Meaning")]
    book = by["book_23"]
    assert [p.text for p in book.parts if isinstance(p, ir.HeadingPart)] == ["Main", "Sub"]
    assert book.parts[2].level == 3
    lesson = by["lesson_24"]
    quiz_part = lesson.parts[-1]
    assert [ch.correct for ch in quiz_part.questions[0].choices] == [True, False]
    assert isinstance(by["scorm_25"], ir.ScormItem)
    assert isinstance(by["scorm_26"], ir.UnsupportedItem)
    assert "<li>Left</li>" in html_parts(by["choice_27"])[-1].content.html
    assert isinstance(by["forum_28"], ir.UnsupportedItem)
    # The only warning is the missing question; the 1.9 coverage note is gone
    assert c.warnings and all("404 is missing" in w for w in c.warnings)


def test_moodle19_broken_module(tmp_path, monkeypatch):
    root = _legacy_backup(tmp_path)

    def boom(*_a, **_k):
        raise RuntimeError("kaput")

    monkeypatch.setattr(moodle._LegacyReader, "_quiz", boom)
    c = moodle.read(root)
    assert any("kaput" in w for w in c.warnings)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def test_cloze_parser():
    text, blanks = parse_cloze_text(
        r"A {1:SHORTANSWER:=Paris#Good~%50%paris~*#Nope} B {2:NM:=3.5:0.1~%50%3:1} "
        r"C {1:MCH:~=Yes~No} D {1:MR:%50%a~%50%b~%-100%c} E {1:SAC:=Case} F {1:FOO:x} G {1:NUMERICAL:=abc}"
        r" H {1:MC:=a\~b~c} I {:SA:%80%close}"
    )
    assert text.startswith("A {{1}} B {{2}} C {{3}} D {{4}} E {{5}} F {1:FOO:x} G {{6}} H {{7}} I {{8}}")
    sa, nm, mch, mr, sac, bad_nm, esc_mc, partial = blanks
    assert sa.answers == ["Paris"]
    assert nm.numeric.value == 3.5 and nm.numeric.tolerance == 0.1 and nm.answers == ["3.5"]
    assert mch.answers == ["Yes"] and mch.choices == ["Yes", "No"]
    assert mr.answers == ["a", "b"] and mr.choices == ["a", "b", "c"]
    assert sac.answers == ["Case"]
    assert bad_nm.numeric is None and bad_nm.answers == []
    assert esc_mc.answers == ["a~b"] and esc_mc.choices == ["a~b", "c"]
    assert partial.answers == ["close"]
    assert cloze_blank("NM", "%50%2") .numeric.value == 2.0
    assert cloze_blank("unknown", "=x") is None


def test_eval_formula():
    assert eval_formula("1.5 + 2") == 3.5
    assert eval_formula("sqrt(16) * pi()") == pytest.approx(4 * 3.141592653589793)
    assert eval_formula("pow(2, 3) + 2**2 - -1 + +1 % 1") == 13.0
    assert eval_formula("10 % 4") == 2.0
    assert eval_formula("abs(-2) / 4") == 0.5
    for bad in ("", "1/0", "__import__('os')", "a + 1", "2 ** 100000", "pow(10, 5000)", "1 <<", "1 << 2",
                "x.y()", "log(-1)", "[1]", "True", "1e308 * 10", "x" * 600, "sqrt(a=1)", "round(1.5, 1.0)"):
        assert eval_formula(bad) is None, bad


def test_filter_category_and_formats():
    assert _filter_category('{"questioncategoryid": "5", "includingsubcategories": "1"}') == ("5", True)
    assert _filter_category('{"filter": {"category": {"values": [8], "filteroptions": '
                            '{"includesubcategories": true}}}}') == ("8", True)
    assert _filter_category('{"cat": "9,23"}') == ("9", False)
    # Odd shapes in the filter JSON must not blow up the quiz
    assert _filter_category('{"filter": {"category": {"values": 5}}}') == ("", False)
    assert _filter_category('{"filter": {"category": {"values": []}}}') == ("", False)
    assert _filter_category('{"filter": {"category": {"values": [{"id": 8}]}}}') == ("", False)
    assert _filter_category('{"filter": {"category": {"values": [8], "filteroptions": 3}}}') == ("8", False)
    assert _filter_category('{"filter": {"category": 7}}') == ("", False)
    assert _filter_category("[]") == ("", False)
    assert _filter_category("{}") == ("", False)
    assert _filter_category("{bad") == ("", False)
    assert _format_html("a < b", "0") == "<p>a &lt; b</p>"
    assert _format_html("<b>x</b>", "0") == "<b>x</b>"
    assert _format_html("# Title", "4") == "<p># Title</p>"
    assert _php_option('a:1:{s:10:"printintro";b:1;}', "printintro") == "1"
    assert _php_option("", "printintro") is None


def test_weeks_and_section_names(tmp_path):
    b = Mbz(tmp_path / "w")
    b.section(1, 1)
    b.section(2, 2, name="Named")
    b.write(course_xml(fmt="singleactivity"))
    c = moodle.read(b.root)
    assert [s.title for s in c.sections] == ["Section 1", "Named"]


# ---------------------------------------------------------------------------
# End to end: archive -> package
# ---------------------------------------------------------------------------


def _scorm_zip() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("imsmanifest.xml", (
            '<manifest identifier="m"><metadata><schemaversion>1.2</schemaversion></metadata>'
            '<organizations default="o"><organization identifier="o"><item identifier="i" identifierref="r">'
            '<title>Lesson</title></item></organization></organizations><resources>'
            '<resource identifier="r" type="webcontent" adlcp:scormtype="sco" href="index.html" '
            'xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"/></resources></manifest>'))
        zf.writestr("index.html", "<p>SCO</p>")
    return buf.getvalue()


def test_convert_end_to_end(tmp_path):
    from src.services.courses.lms_import.convert import convert

    b = Mbz(tmp_path / "src" / "backup")
    b.add_file(png_bytes(), "40", "mod_page", "content", 0, "photo.png")
    b.activity("page", 1, 1, '<name>Welcome</name><content>&lt;p&gt;Hi &lt;img src="@@PLUGINFILE@@/photo.png"&gt;'
               "&lt;/p&gt;</content>", 40)
    b.add_file(PDF_BYTES, "41", "mod_resource", "content", 0, "guide.pdf", sortorder=1)
    b.activity("resource", 2, 1, "<name>Guide</name><intro></intro>", 41)
    b.activity("url", 3, 1, "<name>Video</name><externalurl>https://youtu.be/dQw4w9WgXcQ</externalurl>", 42)
    b.add_file(_scorm_zip(), "43", "mod_scorm", "package", 0, "sco.zip")
    b.activity("scorm", 4, 1, "<name>Package</name><scormtype>local</scormtype><reference>sco.zip</reference>", 43)
    b.activity("forum", 5, 1, "<name>Forum</name>", 44)
    tf = question(1, "truefalse", "Is this converted?", plugin=answers((1, "True", "1"), (2, "False", "0")))
    sa = question(2, "shortanswer", "Say yes", plugin=answers((3, "yes", "1")))
    qxml = category4(1, "Default", "23", entry(1, 1, (1, "ready", tf)) + entry(2, 1, (1, "ready", sa)))
    b.activity("quiz", 6, 1, "<name>Check</name><intro>&lt;p&gt;Quiz&lt;/p&gt;</intro><grade>10</grade>"
               f"<attempts_number>0</attempts_number><question_instances>{_slot(1, 1)}{_slot(2, 2)}"
               "</question_instances>", 45)
    b.activity("assign", 7, 1, "<name>Hand in</name><intro>&lt;p&gt;Upload&lt;/p&gt;</intro><grade>100</grade>"
               "<plugin_configs><plugin_config><plugin>file</plugin><subtype>assignsubmission</subtype>"
               "<name>enabled</name><value>1</value></plugin_config></plugin_configs>", 46)
    b.section(1, 1, name="Week A", sequence=[1, 2, 3, 4, 5, 6, 7])
    b.write(course_xml(fullname="E2E course"), qxml)

    archive = tmp_path / "course.mbz"
    with tarfile.open(archive, "w:gz") as tf_out:
        tf_out.add(b.root, arcname=".")
    out = tmp_path / "package"
    result = convert(str(archive), str(out))
    assert result.course.source == "moodle" and result.course.title == "E2E course"

    activities = []
    for dirpath, _dirs, files in os.walk(out):
        if "activity.json" in files:
            with open(os.path.join(dirpath, "activity.json")) as f:
                data = json.load(f)
            activities.append((data["order"], data["name"], data["activity_type"], dirpath))
    activities.sort()
    names = [(n, t) for _o, n, t, _d in activities]
    assert names == [
        ("Welcome", "TYPE_DYNAMIC"),
        ("Guide", "TYPE_DOCUMENT"),
        ("Video", "TYPE_VIDEO"),
        ("Package", "TYPE_SCORM"),
        ("Check", "TYPE_ASSIGNMENT"),
        ("Hand in", "TYPE_ASSIGNMENT"),
    ]
    welcome_dir = activities[0][3]
    with open(os.path.join(welcome_dir, "activity.json")) as f:
        doc = json.load(f)["content"]
    assert any(n["type"] == "blockImage" for n in doc["content"])
    with open(os.path.join(activities[4][3], "assignment.json")) as f:
        quiz = json.load(f)
    assert quiz["assignment"]["allow_retries"] is True
    task_types = [t["assignment_type"] for t in quiz["tasks"]]
    assert task_types == ["QUIZ", "SHORT_ANSWER"]
    assert any(s.kind == "forum" for s in result.report.skipped)
    with open(os.path.join(out, "manifest.json")) as f:
        assert json.load(f)["source"]["lms"] == "moodle"
