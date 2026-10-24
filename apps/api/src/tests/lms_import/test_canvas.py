"""Canvas reader.

The synthetic export follows what Canvas writes on "Export course content":
course_settings/ (course_settings.xml, module_meta.xml, syllabus.html,
canvas_export.txt), wiki_content/, web_resources/ (with media_objects/),
<id>/assignment_settings.xml + <id>/<slug>.html, <id>/assessment_meta.xml +
non_cc_assessments/<id>.xml.qti in Canvas's QTI dialect, and question banks.
"""

from __future__ import annotations

import json
import os
import struct
import zipfile
import zlib
from html import escape

import pytest

from src.services.courses.lms_import import ir
from src.services.courses.lms_import.convert import convert, detect
from src.services.courses.lms_import.package import ConvertOptions
from src.services.courses.lms_import.sources import canvas

CANVAS_NS = "http://canvas.instructure.com/xsd/cccv1p0"
CC_NS = "http://www.imsglobal.org/xsd/imsccv1p1/imscp_v1p1"
LAR = "associatedcontent/imscc_xmlv1p1/learning-application-resource"
QUIZ_TYPE = "imsqti_xmlv1p2/imscc_xmlv1p1/assessment"


# ---------------------------------------------------------------------------
# Builders
# ---------------------------------------------------------------------------


def write(root, rel: str, content) -> str:
    path = os.path.join(str(root), *rel.split("/"))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if isinstance(content, bytes):
        with open(path, "wb") as f:
            f.write(content)
    else:
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
    return path


def png_bytes() -> bytes:
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", 3, 2, 8, 2, 0, 0, 0)
    raw = b"".join(b"\x00" + b"\xff\x00\x00" * 3 for _ in range(2))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


PDF = b"%PDF-1.4\n%%EOF\n"
MP4 = b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 64
MEDIA_ID = "m-5JxJzd136Gk3nSPn9G5e5b46s4xRXz2m"
MISSING_MEDIA_ID = "m-2QH6J7TBsCt3fPcxqc6Usrh5bbxKtZyB"


def wiki_page(title: str, body: str, *, state: str = "active", front: bool = False) -> str:
    front_meta = '<meta name="front_page" content="true"/>' if front else ""
    return f"""<html>
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>
<title>{escape(title)}</title>
<meta name="identifier" content="g{abs(hash(title)) % 10**8}"/>
<meta name="editing_roles" content="teachers"/>
<meta name="workflow_state" content="{state}"/>
{front_meta}
</head>
<body>
{body}
</body>
</html>"""


def assignment_settings(ident: str, title: str, *, submission: str, points: str = "10", grading: str = "points",
                        state: str = "published", due: str = "2026-05-01T23:59:00", extra: str = "") -> str:
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<assignment identifier="{ident}" xmlns="{CANVAS_NS}">
  <title>{escape(title)}</title>
  <due_at>{due}</due_at>
  <workflow_state>{state}</workflow_state>
  <points_possible>{points}</points_possible>
  <grading_type>{grading}</grading_type>
  <submission_types>{submission}</submission_types>
  <position>1</position>
  {extra}
</assignment>"""


def quiz_meta(ident: str, title: str, *, quiz_type: str = "assignment", attempts: str = "-1", extra: str = "",
              assignment: bool = True) -> str:
    block = f"""<assignment identifier="a_{ident}">
    <title>{escape(title)}</title>
    <workflow_state>published</workflow_state>
    <submission_types>online_quiz</submission_types>
  </assignment>""" if assignment else ""
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<quiz identifier="{ident}" xmlns="{CANVAS_NS}">
  <title>{escape(title)}</title>
  <description>&lt;p&gt;Read carefully. &lt;img src="$IMS-CC-FILEBASE$/images/diagram.png"&gt;&lt;/p&gt;</description>
  <due_at>2026-06-01T12:00:00</due_at>
  <shuffle_answers>true</shuffle_answers>
  <scoring_policy>keep_highest</scoring_policy>
  <quiz_type>{quiz_type}</quiz_type>
  <points_possible>20</points_possible>
  <show_correct_answers>true</show_correct_answers>
  <allowed_attempts>{attempts}</allowed_attempts>
  <time_limit>30</time_limit>
  {extra}
  {block}
</quiz>"""


def item(ident: str, qtype: str, body: str, presentation: str = "", processing: str = "", *, points: str = "1",
         extra: str = "") -> str:
    return f"""<item ident="{ident}" title="Question">
  <itemmetadata><qtimetadata>
    <qtimetadatafield><fieldlabel>question_type</fieldlabel><fieldentry>{qtype}</fieldentry></qtimetadatafield>
    <qtimetadatafield><fieldlabel>points_possible</fieldlabel><fieldentry>{points}</fieldentry></qtimetadatafield>
    <qtimetadatafield><fieldlabel>original_answer_ids</fieldlabel><fieldentry>1,2</fieldentry></qtimetadatafield>
  </qtimetadata></itemmetadata>
  <presentation>
    <material><mattext texttype="text/html">{escape(body)}</mattext></material>
    {presentation}
  </presentation>
  <resprocessing>
    <outcomes><decvar maxvalue="100" minvalue="0" varname="SCORE" vartype="Decimal"/></outcomes>
    <respcondition continue="Yes"><conditionvar><other/></conditionvar>
      <displayfeedback feedbacktype="Response" linkrefid="general_fb"/></respcondition>
    {processing}
  </resprocessing>
  {extra}
</item>"""


def labels(pairs: list[tuple[str, str]]) -> str:
    return "".join(f'<response_label ident="{i}"><material><mattext texttype="text/plain">{escape(t)}</mattext>'
                   f"</material></response_label>" for i, t in pairs)


def lid(ident: str, pairs, cardinality: str = "Single", prompt: str = "") -> str:
    material = f'<material><mattext texttype="text/plain">{escape(prompt)}</mattext></material>' if prompt else ""
    return (f'<response_lid ident="{ident}" rcardinality="{cardinality}">{material}'
            f"<render_choice>{labels(pairs)}</render_choice></response_lid>")


def fib(ident: str = "response1", fibtype: str = "") -> str:
    ft = f' fibtype="{fibtype}"' if fibtype else ""
    return (f'<response_str ident="{ident}" rcardinality="Single"><render_fib{ft}>'
            f'<response_label ident="answer1" rshuffle="No"/></render_fib></response_str>')


def set_score(cond: str, score: str = "100", action: str = "Set", title: str = "") -> str:
    t = f' title="{title}"' if title else ""
    return (f'<respcondition continue="No"{t}><conditionvar>{cond}</conditionvar>'
            f'<setvar action="{action}" varname="SCORE">{score}</setvar></respcondition>')


def eq(resp: str, value: str) -> str:
    return f'<varequal respident="{resp}">{value}</varequal>'


def classic_quiz_qti(ident: str) -> str:
    items = [
        item("mc", "multiple_choice_question", "<p>Pick 4</p>",
             lid("response1", [("1", "3"), ("2", "4"), ("3", "No answer text provided."), ("4", "")]),
             set_score(eq("response1", "2")),
             extra='<itemfeedback ident="general_fb"><flow_mat><material><mattext texttype="text/html">'
                   "&lt;p&gt;Two and two&lt;/p&gt;</mattext></material></flow_mat></itemfeedback>"),
        item("tf", "true_false_question", "<p>Water is wet</p>",
             lid("response1", [("t", "True"), ("f", "False")]), set_score(eq("response1", "t"))),
        item("ma", "multiple_answers_question", "<p>Primes?</p>",
             lid("response1", [("a", "2"), ("b", "4"), ("c", "5")], "Multiple"),
             set_score(f"<and>{eq('response1', 'a')}<not>{eq('response1', 'b')}</not>{eq('response1', 'c')}</and>"),
             points="2"),
        item("sa", "short_answer_question", "<p>Capital of France?</p>", fib(),
             set_score(eq("response1", "Paris") + eq("response1", "paris"))),
        item("fimb", "fill_in_multiple_blanks_question", "<p>Roses are [color1], violets are [color2].</p>",
             lid("response_color2", [("r2", "blue")], prompt="color2")
             + lid("response_color1", [("r1", "red"), ("r1b", "crimson")], prompt="color1"),
             set_score(eq("response_color1", "r1"), "50", "Add") + set_score(eq("response_color1", "r1b"), "50", "Add")
             + set_score(eq("response_color2", "r2"), "50", "Add")),
        item("dd", "multiple_dropdowns_question", "<p>The sky is [c] and grass is [g].</p>",
             lid("response_c", [("c1", "blue"), ("c2", "green")], prompt="c")
             + lid("response_g", [("g1", "blue"), ("g2", "green")], prompt="g"),
             set_score(eq("response_c", "c1"), "50", "Add") + set_score(eq("response_g", "g2"), "50", "Add")),
        item("match", "matching_question", "<p>Match capitals</p>",
             lid("response_1", [("10", "Paris"), ("11", "Rome"), ("12", "Madrid")], prompt="France")
             + lid("response_2", [("10", "Paris"), ("11", "Rome"), ("12", "Madrid")], prompt="Italy"),
             set_score(eq("response_1", "10"), "50", "Add") + set_score(eq("response_2", "11"), "50", "Add")),
        item("num", "numerical_question", "<p>Pi to two decimals, or anything in 20-30</p>", fib(fibtype="Decimal"),
             set_score(f"<or>{eq('response1', '3.14')}<and><vargte respident=\"response1\">3.13</vargte>"
                       f"<varlte respident=\"response1\">3.15</varlte></and></or>")
             + set_score('<vargte respident="response1">20</vargte><varlte respident="response1">30</varlte>')),
        item("calc", "calculated_question", "<p>What is [x] + [y]?</p>", fib(fibtype="Decimal"),
             set_score("<other/>", title="correct") + set_score("<not><other/></not>", "0", title="incorrect"),
             extra="""<itemproc_extension><calculated>
               <answer_tolerance>10%</answer_tolerance>
               <formulas decimal_places="0"><formula>x + y</formula></formulas>
               <vars><var name="x" scale="0"><min>1</min><max>9</max></var>
                     <var name="y" scale="0"><min>1</min><max>9</max></var></vars>
               <var_sets><var_set ident="1"><var name="x">3</var><var name="y">4</var><answer>7</answer></var_set>
                         <var_set ident="2"><var name="x">1</var><var name="y">1</var><answer>2</answer></var_set>
               </var_sets></calculated></itemproc_extension>"""),
        item("calc_abs", "calculated_question", "<p>Double [z]</p>", fib(), "",
             extra="""<itemproc_extension><calculated><answer_tolerance>0.5</answer_tolerance>
               <var_sets><var_set ident="1"><var name="z">2</var><answer>4</answer></var_set></var_sets>
               </calculated></itemproc_extension>"""),
        item("calc_none", "calculated_question", "<p>No sets</p>", fib(), "",
             extra="<itemproc_extension><calculated><var_sets/></calculated></itemproc_extension>"),
        item("calc_nan", "calculated_question", "<p>Bad answer</p>", fib(), "",
             extra="""<itemproc_extension><calculated><var_sets><var_set ident="1"><answer>x</answer></var_set>
               </var_sets></calculated></itemproc_extension>"""),
        item("essay", "essay_question", "<p>Explain gravity</p>", fib(), "", points="5"),
        item("upload", "file_upload_question", "<p>Upload your lab report</p>", points="5"),
        item("text", "text_only_question", "<p>Part 2 starts here</p>", points="0"),
        item("cat", "categorization_question", "<p>Sort animals</p>",
             lid("response1", [("x", "Cat"), ("y", "Dog")])),
        item("ord", "ordering_question", "<p>Order the steps of mitosis</p>",
             lid("response1", [("s1", "Metaphase"), ("s2", "Prophase"), ("s3", "Anaphase")], "Ordered"),
             set_score(eq("response1", "s2") + eq("response1", "s1") + eq("response1", "s3"))),
        item("num_exact", "numerical_question", "<p>The answer to everything</p>", fib(fibtype="Decimal"),
             set_score(eq("response1", "42")) + set_score(eq("response1", "n/a"))),
        item("formula", "formula_question", "<p>[a] times 2</p>", fib(), "",
             extra="""<itemproc_extension><calculated><var_sets><var_set ident="1"><var name="a">5</var>
               <answer>10</answer></var_set></var_sets></calculated></itemproc_extension>"""),
    ]
    group = f"""<section ident="grp1" title="Pick one">
      <selection_ordering><selection><selection_number>1</selection_number>
        <selection_extension><points_per_item>3</points_per_item></selection_extension></selection></selection_ordering>
      {item("g1", "true_false_question", "G1", lid("response1", [("t", "True"), ("f", "False")]),
            set_score(eq("response1", "t")))}
      {item("g2", "true_false_question", "G2", lid("response1", [("t", "True"), ("f", "False")]),
            set_score(eq("response1", "f")))}
    </section>
    <section ident="grp2" title="From bank">
      <selection_ordering><selection><sourcebank_ref>bank_1</sourcebank_ref><selection_number>2</selection_number>
        <selection_extension><points_per_item>0</points_per_item></selection_extension></selection></selection_ordering>
    </section>
    <section ident="grp3" title="Missing bank">
      <selection_ordering><selection><sourcebank_ref>bank_gone</sourcebank_ref><selection_number>1</selection_number>
      </selection></selection_ordering>
    </section>"""
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<questestinterop xmlns="http://www.imsglobal.org/xsd/ims_qtiasiv1p2">
  <assessment ident="{ident}" title="Unit quiz">
    <qtimetadata>
      <qtimetadatafield><fieldlabel>qmd_timelimit</fieldlabel><fieldentry>30</fieldentry></qtimetadatafield>
      <qtimetadatafield><fieldlabel>cc_maxattempts</fieldlabel><fieldentry>unlimited</fieldentry></qtimetadatafield>
    </qtimetadata>
    <section ident="root_section">
      {''.join(items)}
      {group}
    </section>
  </assessment>
</questestinterop>"""


def simple_quiz_qti(ident: str, title: str = "Practice") -> str:
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<questestinterop xmlns="http://www.imsglobal.org/xsd/ims_qtiasiv1p2">
  <assessment ident="{ident}" title="{title}">
    <qtimetadata><qtimetadatafield><fieldlabel>cc_maxattempts</fieldlabel><fieldentry>3</fieldentry>
    </qtimetadatafield></qtimetadata>
    <section ident="root_section">
      {item("p1", "true_false_question", "Easy?", lid("response1", [("t", "True"), ("f", "False")]),
            set_score(eq("response1", "t")))}
    </section>
  </assessment>
</questestinterop>"""


def bank_qti(ident: str, title: str) -> str:
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<questestinterop xmlns="http://www.imsglobal.org/xsd/ims_qtiasiv1p2">
  <objectbank ident="{ident}">
    <qtimetadata><qtimetadatafield><fieldlabel>bank_title</fieldlabel><fieldentry>{title}</fieldentry>
    </qtimetadatafield></qtimetadata>
    {item(f"{ident}_q1", "essay_question", "Bank essay 1", fib(), "")}
    {item(f"{ident}_q2", "essay_question", "Bank essay 2", fib(), "")}
    {item(f"{ident}_q3", "short_answer_question", "Bank short", fib(), set_score(eq("response1", "yes")))}
  </objectbank>
</questestinterop>"""


def module_item(ident: str, ctype: str, title: str, ref: str = "", *, state: str = "active", url: str = "",
                position: int = 1, indent: int = 0) -> str:
    return f"""<item identifier="{ident}">
      <content_type>{ctype}</content_type>
      <workflow_state>{state}</workflow_state>
      <title>{escape(title)}</title>
      <identifierref>{ref}</identifierref>
      <url>{escape(url)}</url>
      <position>{position}</position>
      <new_tab/>
      <indent>{indent}</indent>
      <link_settings_json>null</link_settings_json>
    </item>"""


def build_canvas(root, *, modules: bool = True, image: bool = True) -> str:
    root = str(root)
    write(root, "course_settings/canvas_export.txt", "Q: What did the panda say when he was forced out of his "
                                                     "natural habitat?\nA: This is un-BEAR-able\n")
    image_ref = "<image_identifier_ref>f_banner</image_identifier_ref>" if image else \
        "<image_url>https://example.com/card.png</image_url>"
    write(root, "course_settings/course_settings.xml", f"""<?xml version="1.0" encoding="UTF-8"?>
<course identifier="g_course" xmlns="{CANVAS_NS}">
  <title>Biology 101</title>
  <course_code>BIO101</course_code>
  <start_at/>
  <is_public>false</is_public>
  <license>private</license>
  {image_ref}
  <locale>en</locale>
  <public_description>Cells, genes and ecosystems.</public_description>
  <default_view>modules</default_view>
</course>""")
    write(root, "course_settings/syllabus.html", wiki_page("Syllabus", "<p>Grading: 50% exams.</p>"))
    write(root, "course_settings/files_meta.xml", f'<fileMeta xmlns="{CANVAS_NS}"/>')
    write(root, "web_resources/images/diagram.png", png_bytes())
    write(root, "web_resources/images/banner.png", png_bytes())
    write(root, "web_resources/docs/lab manual.pdf", PDF)
    write(root, "web_resources/Uploaded Media/lecture.mp4", MP4)
    write(root, "web_resources/Uploaded Media/cell.png", png_bytes())
    write(root, f"web_resources/media_objects/{MEDIA_ID}.mp4", MP4)
    write(root, "web_resources/unlinked.pdf", PDF)

    write(root, "wiki_content/welcome.html", wiki_page("Welcome", f"""
<p>Start with the <a href="$WIKI_REFERENCE$/pages/cell-structure">cell structure page</a> and
<a href="$CANVAS_OBJECT_REFERENCE$/assignments/g_asg_upload">the lab report</a>.</p>
<p><img src="$IMS-CC-FILEBASE$/images/diagram.png" alt="diagram"></p>
<p><a class="instructure_file_link" href="%24IMS-CC-FILEBASE%24/docs/lab%20manual.pdf?canvas_download=1">Lab manual</a></p>
<p><a href="$CANVAS_COURSE_REFERENCE$/file_ref/f_banner">Banner</a></p>
<p><img class="equation_image" title="x^2" src="/equation_images/x%255E2" data-equation-content="x^2" alt="x^2"></p>
<p><iframe style="width: 320px; height: 240px;" title="Lecture" data-media-type="video"
  src="/media_objects_iframe/{MEDIA_ID}?type=video" data-media-id="{MEDIA_ID}" allowfullscreen></iframe></p>
<p><iframe src="/media_objects_iframe/{MISSING_MEDIA_ID}?type=video"></iframe></p>
<p><iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" width="560" height="315"></iframe></p>
<p><iframe src="$IMS-CC-FILEBASE$/Uploaded Media/lecture.mp4?canvas_=1&amp;canvas_qs_type=video&amp;media_attachment=true"></iframe></p>
<p><iframe src="$IMS-CC-FILEBASE$/Uploaded Media/cell.png"></iframe></p>
<p><a id="media_comment_{MEDIA_ID}" class="instructure_inline_media_comment video_comment"
  href="/media_objects/{MEDIA_ID}">media</a></p>
"""))
    write(root, "wiki_content/cell-structure.html", wiki_page("Cell structure", "<p>Cells have membranes.</p>"))
    write(root, "wiki_content/draft.html", wiki_page("Draft page", "<p>WIP</p>", state="unpublished"))
    write(root, "wiki_content/home.html", wiki_page("Course home", "<p>Home page</p>", front=True))
    write(root, "wiki_content/orphan.html", wiki_page("Orphan", "<p>Not in a module</p>"))

    write(root, "g_asg_upload/lab-report.html", wiki_page("Assignment: Lab report",
                                                          '<p>Submit your report. <img src="$IMS-CC-FILEBASE$/images/diagram.png"></p>'))
    write(root, "g_asg_upload/assignment_settings.xml",
          assignment_settings("g_asg_upload", "Lab report", submission="online_upload", points="25"))
    write(root, "g_asg_text/reflection.html", wiki_page("Assignment: Reflection", "<p>Reflect.</p>"))
    write(root, "g_asg_text/assignment_settings.xml",
          assignment_settings("g_asg_text", "Reflection", submission="online_text_entry,online_url,media_recording",
                              grading="pass_fail", due=""))
    write(root, "g_asg_none/read.html", wiki_page("Assignment: Read chapter", "<p>Read chapter 1.</p>"))
    write(root, "g_asg_none/assignment_settings.xml",
          assignment_settings("g_asg_none", "Read chapter", submission="none", points="0"))
    write(root, "g_asg_paper/paper.html", wiki_page("Assignment: Poster", "<p>Bring a poster.</p>"))
    write(root, "g_asg_paper/assignment_settings.xml",
          assignment_settings("g_asg_paper", "Poster", submission="on_paper", points="10", state="unpublished"))
    write(root, "g_asg_ng/ng.html", wiki_page("Assignment: Survey", "<p>Tell us.</p>"))
    write(root, "g_asg_ng/assignment_settings.xml",
          assignment_settings("g_asg_ng", "Survey", submission="online_upload", grading="not_graded"))
    write(root, "g_asg_lti/tool.html", wiki_page("Assignment: Tool", "<p>Tool</p>"))
    write(root, "g_asg_lti/assignment_settings.xml",
          assignment_settings("g_asg_lti", "Publisher homework", submission="external_tool",
                              extra="<external_tool_url>https://tool.example.com/launch</external_tool_url>"))
    write(root, "g_asg_quiz/q.html", wiki_page("Assignment: Quiz", "<p>Quiz</p>"))
    write(root, "g_asg_quiz/assignment_settings.xml",
          assignment_settings("g_asg_quiz", "Quiz assignment", submission="online_quiz",
                              extra="<quiz_identifierref>g_quiz_practice</quiz_identifierref>"))
    write(root, "g_cc_asg.xml", f"""<assignment xmlns="http://www.imsglobal.org/xsd/imscc_extensions/assignment">
  <title>ignored</title>
  <text texttype="text/plain">Plain &lt;instructions&gt;</text>
  <submission_formats><format type="file"/><format type="url"/></submission_formats>
  <extensions><assignment identifier="g_cc_asg" xmlns="{CANVAS_NS}">
    <title>Extension assignment</title><points_possible>5</points_possible><grading_type>points</grading_type>
  </assignment></extensions>
</assignment>""")
    write(root, "g_cc_plain.xml", """<assignment xmlns="http://www.imsglobal.org/xsd/imscc_extensions/assignment">
  <title>Plain CC assignment</title><text texttype="text/html">&lt;p&gt;Do it&lt;/p&gt;</text>
  <submission_formats><format type="text"/></submission_formats></assignment>""")

    write(root, "g_quiz_classic/assessment_meta.xml", quiz_meta("g_quiz_classic", "Unit quiz"))
    write(root, "g_quiz_classic/assessment_qti.xml", "<questestinterop/>")
    write(root, "non_cc_assessments/g_quiz_classic.xml.qti", classic_quiz_qti("g_quiz_classic"))
    write(root, "g_quiz_practice/assessment_meta.xml",
          quiz_meta("g_quiz_practice", "Practice quiz", quiz_type="practice_quiz", attempts="3"))
    write(root, "non_cc_assessments/g_quiz_practice.xml.qti", simple_quiz_qti("g_quiz_practice"))
    write(root, "g_quiz_survey/assessment_meta.xml",
          quiz_meta("g_quiz_survey", "Course survey", quiz_type="survey", attempts="1",
                    extra="<available>false</available>", assignment=False))
    write(root, "non_cc_assessments/g_quiz_survey.xml.qti", simple_quiz_qti("g_quiz_survey", "Survey"))
    write(root, "g_quiz_empty/assessment_meta.xml", quiz_meta("g_quiz_empty", "Empty file"))
    write(root, "non_cc_assessments/g_quiz_empty.xml.qti", "<questestinterop/>")
    write(root, "g_quiz_nofile/assessment_meta.xml", quiz_meta("g_quiz_nofile", "No questions file"))
    write(root, "non_cc_assessments/bank_1.xml.qti", bank_qti("bank_1", "Unit bank"))
    write(root, "non_cc_assessments/bank_unused.xml.qti", bank_qti("bank_unused", "Unused bank"))

    write(root, "g_topic.xml", """<?xml version="1.0" encoding="UTF-8"?>
<topic xmlns="http://www.imsglobal.org/xsd/imsccv1p1/imsdt_v1p1">
  <title>Introduce yourself</title>
  <text texttype="text/html">&lt;p&gt;Say hi. &lt;img src="$IMS-CC-FILEBASE$/images/diagram.png"&gt;&lt;/p&gt;</text>
</topic>""")
    write(root, "g_topic_meta.xml", f"""<topicMeta identifier="g_topic_meta" xmlns="{CANVAS_NS}">
  <topic_id>g_topic</topic_id><title>Introduce yourself</title><type>topic</type>
  <workflow_state>unpublished</workflow_state>
  <assignment identifier="g_topic_asg"><title>Introduce yourself</title><points_possible>5</points_possible>
  </assignment>
</topicMeta>""")
    write(root, "g_news.xml", """<topic xmlns="http://www.imsglobal.org/xsd/imsccv1p1/imsdt_v1p1">
  <title>Welcome announcement</title><text texttype="text/html">&lt;p&gt;News&lt;/p&gt;</text></topic>""")
    write(root, "g_news_meta.xml", f"""<topicMeta identifier="g_news_meta" xmlns="{CANVAS_NS}">
  <topic_id>g_news</topic_id><title>Welcome announcement</title><type>announcement</type></topicMeta>""")
    write(root, "g_topic2.xml", """<topic xmlns="http://www.imsglobal.org/xsd/imsccv1p1/imsdt_v1p1">
  <title>Open forum</title><text texttype="text/html">&lt;p&gt;Ask anything&lt;/p&gt;</text></topic>""")

    resources = f"""
    <resource identifier="g_settings" type="{LAR}" href="course_settings/canvas_export.txt">
      <file href="course_settings/course_settings.xml"/><file href="course_settings/module_meta.xml"/>
      <file href="course_settings/files_meta.xml"/><file href="course_settings/canvas_export.txt"/></resource>
    <resource identifier="g_syllabus" type="{LAR}" href="course_settings/syllabus.html" intendeduse="syllabus">
      <file href="course_settings/syllabus.html"/></resource>
    <resource identifier="w_welcome" type="webcontent" href="wiki_content/welcome.html">
      <file href="wiki_content/welcome.html"/></resource>
    <resource identifier="w_cells" type="webcontent" href="wiki_content/cell-structure.html">
      <file href="wiki_content/cell-structure.html"/></resource>
    <resource identifier="w_draft" type="webcontent" href="wiki_content/draft.html">
      <file href="wiki_content/draft.html"/></resource>
    <resource identifier="w_home" type="webcontent" href="wiki_content/home.html">
      <file href="wiki_content/home.html"/></resource>
    <resource identifier="w_orphan" type="webcontent" href="wiki_content/orphan.html">
      <file href="wiki_content/orphan.html"/></resource>
    <resource identifier="w_gone" type="webcontent" href="wiki_content/gone.html">
      <file href="wiki_content/gone.html"/></resource>
    <resource identifier="f_banner" type="webcontent" href="web_resources/images/banner.png">
      <file href="web_resources/images/banner.png"/></resource>
    <resource identifier="f_diagram" type="webcontent" href="web_resources/images/diagram.png">
      <file href="web_resources/images/diagram.png"/></resource>
    <resource identifier="f_manual" type="webcontent" href="web_resources/docs/lab manual.pdf">
      <file href="web_resources/docs/lab manual.pdf"/></resource>
    <resource identifier="f_lecture" type="webcontent" href="web_resources/Uploaded Media/lecture.mp4">
      <file href="web_resources/Uploaded Media/lecture.mp4"/></resource>
    <resource identifier="f_media" type="webcontent" href="web_resources/media_objects/{MEDIA_ID}.mp4">
      <file href="web_resources/media_objects/{MEDIA_ID}.mp4"/></resource>
    <resource identifier="f_unlinked" type="webcontent" href="web_resources/unlinked.pdf">
      <file href="web_resources/unlinked.pdf"/></resource>
    <resource identifier="g_asg_upload" type="{LAR}" href="g_asg_upload/lab-report.html">
      <file href="g_asg_upload/lab-report.html"/><file href="g_asg_upload/assignment_settings.xml"/></resource>
    <resource identifier="g_asg_text" type="{LAR}" href="g_asg_text/reflection.html">
      <file href="g_asg_text/reflection.html"/><file href="g_asg_text/assignment_settings.xml"/></resource>
    <resource identifier="g_asg_none" type="{LAR}" href="g_asg_none/read.html">
      <file href="g_asg_none/read.html"/><file href="g_asg_none/assignment_settings.xml"/></resource>
    <resource identifier="g_asg_paper" type="{LAR}" href="g_asg_paper/paper.html">
      <file href="g_asg_paper/paper.html"/><file href="g_asg_paper/assignment_settings.xml"/></resource>
    <resource identifier="g_asg_ng" type="{LAR}" href="g_asg_ng/ng.html">
      <file href="g_asg_ng/ng.html"/><file href="g_asg_ng/assignment_settings.xml"/></resource>
    <resource identifier="g_asg_lti" type="{LAR}" href="g_asg_lti/tool.html">
      <file href="g_asg_lti/tool.html"/><file href="g_asg_lti/assignment_settings.xml"/></resource>
    <resource identifier="g_asg_quiz" type="{LAR}" href="g_asg_quiz/q.html">
      <file href="g_asg_quiz/q.html"/><file href="g_asg_quiz/assignment_settings.xml"/></resource>
    <resource identifier="g_cc_asg" type="assignment_xmlv1p0" href="g_cc_asg.xml"><file href="g_cc_asg.xml"/></resource>
    <resource identifier="g_cc_plain" type="assignment_xmlv1p0"><file href="g_cc_plain.xml"/></resource>
    <resource identifier="g_quiz_classic" type="{QUIZ_TYPE}">
      <file href="g_quiz_classic/assessment_qti.xml"/><dependency identifierref="g_quiz_classic_meta"/></resource>
    <resource identifier="g_quiz_classic_meta" type="{LAR}" href="g_quiz_classic/assessment_meta.xml">
      <file href="g_quiz_classic/assessment_meta.xml"/><file href="non_cc_assessments/g_quiz_classic.xml.qti"/>
    </resource>
    <resource identifier="g_quiz_practice" type="{QUIZ_TYPE}">
      <dependency identifierref="g_quiz_practice_meta"/></resource>
    <resource identifier="g_quiz_practice_meta" type="{LAR}" href="g_quiz_practice/assessment_meta.xml">
      <file href="g_quiz_practice/assessment_meta.xml"/><file href="non_cc_assessments/g_quiz_practice.xml.qti"/>
    </resource>
    <resource identifier="g_quiz_survey" type="{QUIZ_TYPE}"><dependency identifierref="g_quiz_survey_meta"/></resource>
    <resource identifier="g_quiz_survey_meta" type="{LAR}" href="g_quiz_survey/assessment_meta.xml">
      <file href="g_quiz_survey/assessment_meta.xml"/><file href="non_cc_assessments/g_quiz_survey.xml.qti"/>
    </resource>
    <resource identifier="g_quiz_empty" type="{QUIZ_TYPE}"><file href="non_cc_assessments/g_quiz_empty.xml.qti"/>
    </resource>
    <resource identifier="g_quiz_nofile" type="{QUIZ_TYPE}"><file href="g_quiz_nofile/assessment_meta.xml"/>
    </resource>
    <resource identifier="bank_1" type="{LAR}" href="non_cc_assessments/bank_1.xml.qti">
      <file href="non_cc_assessments/bank_1.xml.qti"/></resource>
    <resource identifier="bank_unused" type="{LAR}" href="non_cc_assessments/bank_unused.xml.qti">
      <file href="non_cc_assessments/bank_unused.xml.qti"/></resource>
    <resource identifier="g_topic" type="imsdt_xmlv1p1"><file href="g_topic.xml"/>
      <dependency identifierref="g_topic_meta"/><dependency identifierref="nowhere"/></resource>
    <resource identifier="g_topic_meta" type="{LAR}" href="g_topic_meta.xml"><file href="g_topic_meta.xml"/></resource>
    <resource identifier="g_news" type="imsdt_xmlv1p1"><file href="g_news.xml"/>
      <dependency identifierref="g_news_meta"/></resource>
    <resource identifier="g_news_meta" type="{LAR}" href="g_news_meta.xml"><file href="g_news_meta.xml"/></resource>
    <resource identifier="g_topic2" type="imsdt_xmlv1p1"><file href="g_topic2.xml"/></resource>
    <resource identifier="g_link" type="imswl_xmlv1p1"><file href="g_link.xml"/></resource>
    """
    write(root, "g_link.xml", """<webLink xmlns="http://www.imsglobal.org/xsd/imsccv1p1/imswl_v1p1">
      <title>Org link</title><url href="https://example.org"/></webLink>""")
    org_items = """<item identifier="mod_a"><title>Week 1: Cells</title>
          <item identifier="i1" identifierref="w_welcome"><title>Welcome</title></item>
          <item identifier="i2" identifierref="g_link"><title>Org link</title></item>
        </item>""" if modules else ""
    write(root, "imsmanifest.xml", f"""<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="g_manifest" xmlns="{CC_NS}" xmlns:lomimscc="http://ltsc.ieee.org/xsd/imsccv1p1/LOM/manifest">
  <metadata><schema>IMS Common Cartridge</schema><schemaversion>1.1.0</schemaversion>
    <lomimscc:lom><lomimscc:general><lomimscc:title><lomimscc:string>Biology (manifest)</lomimscc:string>
    </lomimscc:title></lomimscc:general></lomimscc:lom></metadata>
  <organizations><organization identifier="org_1" structure="rooted-hierarchy">
    <item identifier="LearningModules">{org_items}</item></organization></organizations>
  <resources>{resources}</resources>
</manifest>""")

    if modules:
        write(root, "course_settings/module_meta.xml", f"""<?xml version="1.0" encoding="UTF-8"?>
<modules xmlns="{CANVAS_NS}">
  <module identifier="mod_b">
    <title>Week 2: Genetics</title><workflow_state>active</workflow_state><position>2</position>
    <items>
      {module_item("b2", "Quizzes::Quiz", "Unit quiz", "g_quiz_classic", position=2)}
      {module_item("b1", "Assignment", "Lab report", "g_asg_upload", position=1)}
      {module_item("b3", "Assignment", "Reflection", "g_asg_text", position=3)}
      {module_item("b4", "Assignment", "", "g_asg_none", position=4)}
      {module_item("b5", "Assignment", "Poster", "g_asg_paper", position=5)}
      {module_item("b6", "Assignment", "Survey", "g_asg_ng", position=6)}
      {module_item("b7", "Assignment", "Publisher homework", "g_asg_lti", position=7)}
      {module_item("b8", "Assignment", "Quiz assignment", "g_asg_quiz", position=8)}
      {module_item("b9", "Assignment", "", "g_cc_asg", position=9)}
      {module_item("b10", "Assignment", "", "g_cc_plain", position=10)}
      {module_item("b11", "Quizzes::Quiz", "Course survey", "g_quiz_survey", position=11)}
      {module_item("b12", "Quizzes::Quiz", "Empty file", "g_quiz_empty", position=12)}
      {module_item("b13", "Quizzes::Quiz", "No questions file", "g_quiz_nofile", position=13)}
      {module_item("b14", "Quizzes::Quiz", "Practice by id", "g_quiz_byid", position=14)}
    </items>
  </module>
  <module identifier="mod_a">
    <title>Week 1: Cells</title><workflow_state>active</workflow_state><position>1</position>
    <items>
      {module_item("a1", "WikiPage", "Welcome", "w_welcome", position=1)}
      {module_item("a2", "Attachment", "Lab manual", "f_manual", position=2)}
      {module_item("a3", "Attachment", "Lecture video", "f_lecture", position=3, indent=1)}
      {module_item("a4", "Attachment", "Diagram", "f_diagram", position=4)}
      {module_item("a5", "ContextModuleSubHeader", "Readings", position=5)}
      {module_item("a6", "WikiPage", "Cell structure", "w_cells", position=6)}
      {module_item("a7", "WikiPage", "Draft page", "w_draft", position=7)}
      {module_item("a8", "WikiPage", "Hidden item", "w_cells", position=8, state="unpublished")}
      {module_item("a9", "ExternalUrl", "Crash course", url="https://www.youtube.com/watch?v=dQw4w9WgXcQ", position=9)}
      {module_item("a10", "ExternalUrl", "Khan Academy", url="https://www.khanacademy.org/science/biology", position=10)}
      {module_item("a11", "ExternalUrl", "Broken link", position=11)}
      {module_item("a12", "ContextExternalTool", "Publisher tool", url="https://tool.example.com/lti", position=12)}
      {module_item("a13", "ContextExternalTool", "Tool without URL", position=13)}
      {module_item("a14", "DiscussionTopic", "Introduce yourself", "g_topic", position=14)}
      {module_item("a15", "WikiPage", "Missing page", "w_nowhere", position=15)}
      {module_item("a16", "WikiPage", "Gone page", "w_gone", position=16)}
      {module_item("a17", "ContextModuleSubHeader", "", position=17)}
      {module_item("a18", "ContextModuleSubHeader", "Empty header", position=18)}
    </items>
  </module>
  <module identifier="mod_c">
    <title>Drafts</title><workflow_state>unpublished</workflow_state><position>3</position>
    <items>{module_item("c1", "WikiPage", "Draft module page", "w_cells")}</items>
  </module>
</modules>""")
        # A quiz referenced by id only (its resource missing from the manifest)
        write(root, "g_quiz_byid/assessment_meta.xml", quiz_meta("g_quiz_byid", "Practice by id"))
        write(root, "non_cc_assessments/g_quiz_byid.xml.qti", simple_quiz_qti("g_quiz_byid"))
    return root


def by_title(section: ir.Section) -> dict[str, ir.Item]:
    return {i.title: i for i in section.items}


@pytest.fixture
def course(tmp_path):
    return canvas.read(build_canvas(tmp_path / "export"))


# ---------------------------------------------------------------------------
# Detection and course settings
# ---------------------------------------------------------------------------


def test_detect(tmp_path):
    assert canvas.detect(str(tmp_path)) == 0
    write(tmp_path, "COURSE_SETTINGS/canvas_export.txt", "panda")
    assert canvas.detect(str(tmp_path)) == 95
    other = tmp_path / "other"
    write(other, "course_settings/course_settings.xml", "<course/>")
    assert canvas.detect(str(other)) == 95
    write(tmp_path / "file", "course_settings", "not a dir")
    assert canvas.detect(str(tmp_path / "file")) == 0
    assert canvas.detect(str(tmp_path / "missing")) == 0


def test_canvas_wins_detection_over_common_cartridge(tmp_path):
    root = build_canvas(tmp_path / "export")
    found = detect(root)
    assert [d.key for d in found][:2] == ["canvas", "common_cartridge"]
    assert found[0].score == 95


def test_course_settings(course):
    assert course.title == "Biology 101"
    assert course.short_name == "BIO101"
    assert course.language == "en"
    assert course.id == "g_course"
    assert course.summary.html == "Cells, genes and ecosystems."
    assert course.thumbnail is not None and course.thumbnail.name == "banner.png"


def test_overview_section(course):
    overview = course.sections[0]
    assert overview.title == "Course overview"
    syllabus, home = overview.items
    assert syllabus.title == "Syllabus" and "Grading" in syllabus.parts[0].content.html
    assert home.title == "Course home"  # front page not placed in a module


def test_modules_order_and_subheaders(course):
    titles = [s.title for s in course.sections]
    assert titles == ["Course overview", "Week 1: Cells", "Week 1: Cells › Readings", "Week 2: Genetics", "Drafts",
                      "Question banks"]
    # The bank no quiz draws from is kept as a hidden quiz
    banks = course.sections[-1]
    assert not banks.visible and all(isinstance(i, ir.Assessment) and not i.visible for i in banks.items)
    drafts = course.sections[-1]
    assert drafts.visible is False and drafts.items[0].visible is False
    week1 = by_title(course.sections[1])
    assert list(week1) == ["Welcome", "Lab manual", "Lecture video", "Diagram"]
    assert isinstance(week1["Lab manual"], ir.DocumentItem)
    assert isinstance(week1["Lecture video"], ir.VideoItem)
    assert week1["Diagram"].parts[0].kind == ir.MediaKind.IMAGE
    week2_order = [i.title for i in course.sections[3].items]
    assert week2_order[:2] == ["Lab report", "Unit quiz"]


# ---------------------------------------------------------------------------
# Pages and HTML
# ---------------------------------------------------------------------------


def test_wiki_page_html(course):
    welcome = by_title(course.sections[1])["Welcome"]
    rich = welcome.parts[0].content
    html = rich.html
    assert "$WIKI_REFERENCE$" not in html and "cell structure page" in html
    assert "CANVAS_OBJECT_REFERENCE" not in html and "the lab report" in html
    assert rich.resolve("$IMS-CC-FILEBASE$/images/diagram.png").name == "diagram.png"
    assert rich.resolve("%24IMS-CC-FILEBASE%24/docs/lab%20manual.pdf?canvas_download=1").name == "lab manual.pdf"
    assert rich.resolve("$CANVAS_COURSE_REFERENCE$/file_ref/f_banner").name == "banner.png"
    assert rich.resolve(f"/media_objects/{MEDIA_ID}").name == f"{MEDIA_ID}.mp4"
    assert rich.resolve("/media_objects/m-unknownunknownunknown") is None
    # Media iframes become players pointing at the exported file
    assert f'<video src="/web_resources/media_objects/{MEDIA_ID}.mp4"></video>' in html
    assert '<video src="/web_resources/Uploaded%20Media/lecture.mp4"></video>' in html
    assert '<img src="/web_resources/Uploaded%20Media/cell.png">' in html
    assert rich.resolve("/web_resources/Uploaded%20Media/lecture.mp4").name == "lecture.mp4"
    assert "[Media not included in the export]" in html
    assert "https://www.youtube.com/embed/dQw4w9WgXcQ" in html  # web embeds untouched
    assert 'data-equation-content="x^2"' in html
    assert any(MISSING_MEDIA_ID in t and k == "file" and r == "not in the export" for t, k, r in course.skipped)


def test_wiki_visibility(course):
    readings = by_title(course.sections[2])
    assert readings["Cell structure"].visible is True
    assert readings["Draft page"].visible is False  # page unpublished
    assert readings["Hidden item"].visible is False  # module item unpublished


def test_links_tools_and_discussions(course):
    readings = by_title(course.sections[2])
    video = readings["Crash course"]
    assert isinstance(video, ir.VideoItem) and video.url.startswith("https://www.youtube.com/")
    khan = readings["Khan Academy"]
    assert isinstance(khan.parts[0], ir.LinkPart) and khan.parts[0].url.endswith("/biology")
    assert readings["Broken link"].reason == "link has no URL"
    tool = readings["Publisher tool"]
    assert isinstance(tool, ir.UnsupportedItem) and "https://tool.example.com/lti" in tool.reason
    assert readings["Tool without URL"].reason == "external tool (LTI) links are not migrated"
    topic = readings["Introduce yourself"]
    assert isinstance(topic, ir.Page) and topic.visible is False
    assert topic.parts[0].content.resolve("$IMS-CC-FILEBASE$/images/diagram.png") is not None
    # Items that are not (fully) in the course are skipped entries, not warnings
    skipped = {(t, k) for t, k, _ in course.skipped}
    assert ("Introduce yourself", "discussion") not in skipped  # the graded discussion is a page: imported
    assert ("Missing page", "page") in skipped and ("Gone page", "page") in skipped
    assert not any("w_nowhere" in t or "gone.html" in t for t, _k, _r in course.skipped)
    assert all(r == "missing from the export" for t, k, r in course.skipped if k == "page")
    assert not any("discussion topic" in w or "points to content" in w for w in course.warnings)
    assert "Empty header" not in [s.title for s in course.sections]


# ---------------------------------------------------------------------------
# Assignments
# ---------------------------------------------------------------------------


def test_assignments(course):
    week2 = by_title(course.sections[3])
    lab = week2["Lab report"]
    assert isinstance(lab, ir.AssignmentItem)
    assert lab.allow_file and not lab.allow_text and lab.points == 25 and lab.graded
    assert lab.due_date.startswith("2026-05-01T23:59:00")
    assert "Submit your report" in lab.instructions.html
    assert lab.instructions.resolve("$IMS-CC-FILEBASE$/images/diagram.png").name == "diagram.png"
    reflection = week2["Reflection"]
    assert reflection.allow_text and reflection.allow_file and reflection.due_date is None
    read_page = week2["Read chapter"]
    assert isinstance(read_page, ir.Page) and "chapter 1" in read_page.parts[0].content.html
    poster = week2["Poster"]
    assert isinstance(poster, ir.AssignmentItem) and poster.allow_file and poster.visible is False
    survey = week2["Survey"]
    assert survey.graded is False
    tool = week2["Publisher homework"]
    assert isinstance(tool, ir.UnsupportedItem) and "https://tool.example.com/launch" in tool.reason
    quiz_asg = week2["Quiz assignment"]
    assert isinstance(quiz_asg, ir.Assessment) and len(quiz_asg.questions) == 1
    ext = week2["Extension assignment"]
    assert isinstance(ext, ir.AssignmentItem) and ext.points == 5
    assert ext.allow_file and ext.allow_text and ext.instructions.html == "Plain &lt;instructions&gt;"
    plain = week2["Plain CC assignment"]
    assert isinstance(plain, ir.AssignmentItem) and plain.allow_text and not plain.allow_file
    # Submission types LearnHouse lacks (URL, media recording, on paper) become file
    # submissions: imported items, so neither a warning nor a skipped entry
    assert not [t for t, k, _r in course.skipped if k == "assignment"]
    assert not any("assignment(s)" in w for w in course.warnings)


# ---------------------------------------------------------------------------
# Quizzes
# ---------------------------------------------------------------------------


def _questions(course) -> dict[str, ir.Question]:
    quiz = by_title(course.sections[3])["Unit quiz"]
    return {q.id: q for q in quiz.questions}


def test_quiz_settings(course):
    week2 = by_title(course.sections[3])
    quiz = week2["Unit quiz"]
    assert isinstance(quiz, ir.Assessment)
    assert quiz.max_attempts == 0  # -1 = unlimited
    assert quiz.time_limit_minutes == 30 and quiz.shuffle is True and quiz.show_correct_answers is True
    assert quiz.graded is True and quiz.visible is True
    assert quiz.due_date.startswith("2026-06-01T12:00:00")
    assert quiz.intro.resolve("$IMS-CC-FILEBASE$/images/diagram.png").name == "diagram.png"
    practice = week2["Quiz assignment"]
    assert practice.graded is False and practice.max_attempts == 3
    survey = week2["Course survey"]
    assert survey.graded is False and survey.visible is False and survey.max_attempts == 1
    assert week2["Empty file"].reason == "no QTI assessment in the quiz file"
    assert week2["No questions file"].reason == "quiz questions missing from the export"
    assert isinstance(week2["Practice by id"], ir.Assessment)


def test_choice_questions(course):
    qs = _questions(course)
    mc = qs["mc"]
    assert mc.type == ir.QType.MULTICHOICE and [c.text.html for c in mc.choices] == ["3", "4"]
    assert [c.correct for c in mc.choices] == [False, True]
    assert "Two and two" in mc.general_feedback
    tf = qs["tf"]
    assert tf.type == ir.QType.TRUEFALSE and [c.correct for c in tf.choices] == [True, False]
    ma = qs["ma"]
    assert ma.multiple and [c.correct for c in ma.choices] == [True, False, True] and ma.points == 2
    match = qs["match"]
    assert match.type == ir.QType.MATCHING
    assert [(p.prompt.html, p.answer) for p in match.pairs] == [("France", "Paris"), ("Italy", "Rome")]
    assert match.distractors == ["Madrid"]


def test_text_questions(course):
    qs = _questions(course)
    assert qs["sa"].type == ir.QType.SHORTANSWER and qs["sa"].answers == ["Paris", "paris"]
    fimb = qs["fimb"]
    assert fimb.type == ir.QType.CLOZE
    assert "Roses are {{1}}, violets are {{2}}" in fimb.text.html
    # Blanks follow the text order even though Canvas wrote color2 first
    assert [b.answers for b in fimb.blanks] == [["red", "crimson"], ["blue"]]
    assert all(b.choices == [] for b in fimb.blanks)
    dd = qs["dd"]
    assert dd.type == ir.QType.CLOZE
    assert [(b.answers, b.choices) for b in dd.blanks] == [(["blue"], ["blue", "green"]),
                                                          (["green"], ["blue", "green"])]
    assert qs["essay"].type == ir.QType.ESSAY and qs["essay"].points == 5
    upload = qs["upload"]
    assert upload.type == ir.QType.FILE_UPLOAD and upload.allow_attachments and not upload.allow_text
    assert qs["text"].type == ir.QType.DESCRIPTION


def test_numeric_questions(course):
    qs = _questions(course)
    num = qs["num"]
    assert num.type == ir.QType.NUMERICAL
    assert [(round(n.value, 4), round(n.tolerance, 4)) for n in num.numeric] == [(3.14, 0.01), (25.0, 5.0)]
    calc = qs["calc"]
    assert calc.type == ir.QType.NUMERICAL and "What is 3 + 4?" in calc.text.html
    assert [(n.value, round(n.tolerance, 4)) for n in calc.numeric] == [(7.0, 0.7)]
    assert [(n.value, n.tolerance) for n in qs["calc_abs"].numeric] == [(4.0, 0.5)]
    assert qs["calc_none"].type == ir.QType.UNSUPPORTED and "without generated values" in qs["calc_none"].reason
    assert qs["calc_nan"].type == ir.QType.UNSUPPORTED and "numeric answer" in qs["calc_nan"].reason
    exact = qs["num_exact"]
    assert [(n.value, n.tolerance) for n in exact.numeric] == [(42.0, 0.0)]
    formula = qs["formula"]
    assert formula.type == ir.QType.NUMERICAL and "5 times 2" in formula.text.html


def test_unsupported_and_groups(course):
    qs = _questions(course)
    order = qs["ord"]
    assert order.type == ir.QType.ORDERING and order.ordering == ["Prophase", "Metaphase", "Anaphase"]
    cat = qs["cat"]
    assert cat.type == ir.QType.UNSUPPORTED and "categorization" in cat.reason
    # Group questions take the group's points; bank questions come in place
    assert qs["g1"].points == 3 and qs["g2"].points == 3
    assert {"bank_1_q1", "bank_1_q2", "bank_1_q3"} <= set(qs)
    assert qs["bank_1_q1"].points == 1
    # A bank the quiz draws from but the export lacks is the one genuine warning;
    # random draws and unused banks (imported as hidden quizzes) are silent
    assert course.warnings == ["Unit quiz: question bank 'bank_gone' is not in the export"]
    assert any(s.title == "Question banks" and not s.visible for s in course.sections)


# ---------------------------------------------------------------------------
# Fallbacks
# ---------------------------------------------------------------------------


def test_no_module_meta_uses_manifest_organization(tmp_path):
    root = build_canvas(tmp_path / "export", modules=True)
    os.remove(os.path.join(root, "course_settings", "module_meta.xml"))
    course = canvas.read(root)
    week = next(s for s in course.sections if s.title == "Week 1: Cells")
    assert [i.title for i in week.items] == ["Welcome", "Org link"]
    welcome = week.items[0]
    assert "<video" in welcome.parts[0].content.html


def test_no_modules_groups_content_by_type(tmp_path):
    course = canvas.read(build_canvas(tmp_path / "export", modules=False, image=False))
    titles = [s.title for s in course.sections]
    assert titles == ["Course overview", "Pages", "Assignments", "Quizzes", "Discussions", "Files", "Question banks"]
    # Only files nothing links to (pages link the diagram, banner, manual, lecture and media recording)
    files = course.sections[5].items
    assert [(type(i).__name__, i.title) for i in files] == [("DocumentItem", "Unlinked")]
    pages = [i.title for i in course.sections[1].items]
    assert "Welcome" in pages and "Orphan" in pages and "Course home" not in pages
    assignments = [i.title for i in course.sections[2].items]
    assert "Lab report" in assignments and "Quiz assignment" not in assignments
    assert "Extension assignment" in assignments
    quizzes = [i.title for i in course.sections[3].items]
    assert "Unit quiz" in quizzes and "Practice quiz" in quizzes
    discussions = [i.title for i in course.sections[4].items]
    assert discussions == ["Introduce yourself", "Open forum"]  # announcements left out
    assert course.thumbnail is None
    # Grouping by type and a web-address card image are not worth a report line
    assert not any("modules" in w or "card image" in w for w in course.warnings)
    assert not any(k == "image" for _t, k, _r in course.skipped)


def test_minimal_export_without_manifest(tmp_path):
    write(tmp_path, "course_settings/canvas_export.txt", "panda")
    course = canvas.read(str(tmp_path))
    assert course.title == "Imported course" and course.sections == [] and course.thumbnail is None
    assert canvas.CanvasReader(str(tmp_path)).manifest_dir() == ""  # no manifest: inline documents sit at the root


def test_empty_syllabus_is_skipped(tmp_path):
    root = build_canvas(tmp_path / "export")
    write(root, "course_settings/syllabus.html", wiki_page("Syllabus", "<p> </p>"))
    course = canvas.read(root)
    assert [i.title for i in course.sections[0].items] == ["Course home"]


# ---------------------------------------------------------------------------
# End to end
# ---------------------------------------------------------------------------


def _zip_dir(src: str, dest: str) -> str:
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as zf:
        for dirpath, _dirs, files in os.walk(src):
            for f in files:
                full = os.path.join(dirpath, f)
                zf.write(full, os.path.relpath(full, src))
    return dest


def _load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _activities(course_dir):
    chapters = {}
    for chapter in sorted((course_dir / "chapters").iterdir()):
        data = _load(chapter / "chapter.json")
        acts = {}
        if (chapter / "activities").exists():
            for act_dir in sorted((chapter / "activities").iterdir()):
                act = _load(act_dir / "activity.json")
                # A quiz with a rich intro is an intro page plus the assignment, same name
                if act["name"] in acts and acts[act["name"]][0]["activity_type"] == "TYPE_ASSIGNMENT":
                    continue
                acts[act["name"]] = (act, act_dir)
        chapters[data["name"]] = (data, acts)
    return chapters


def test_convert_end_to_end(tmp_path):
    src = build_canvas(tmp_path / "export")
    archive = _zip_dir(src, str(tmp_path / "biology.imscc"))
    out = tmp_path / "package"
    result = convert(archive, str(out), options=ConvertOptions(keep_past_due_dates=True))
    assert result.course.source == "canvas"
    manifest = _load(out / "manifest.json")
    assert manifest["source"]["lms"] == "canvas"
    course_dir = out / manifest["courses"][0]["path"]
    course_json = _load(course_dir / "course.json")
    assert course_json["name"] == "Biology 101"
    assert course_json["thumbnail_image"].endswith(".png")
    assert (course_dir / "thumbnails" / course_json["thumbnail_image"]).is_file()
    assert course_json["extra_metadata"]["lms_import"]["short_name"] == "BIO101"

    chapters = _activities(course_dir)
    assert list(sorted(chapters, key=lambda n: chapters[n][0]["order"]))[:4] == [
        "Course overview", "Week 1: Cells", "Week 1: Cells › Readings", "Week 2: Genetics"]

    week1 = chapters["Week 1: Cells"][1]
    welcome, welcome_dir = week1["Welcome"]
    nodes = welcome["content"]["content"]
    types = [n["type"] for n in nodes]
    assert "blockImage" in types and "blockVideo" in types and "blockMathEquation" in types
    assert "blockEmbed" in types  # the YouTube iframe
    assert week1["Lab manual"][0]["activity_type"] == "TYPE_DOCUMENT"
    assert week1["Lecture video"][0]["activity_type"] == "TYPE_VIDEO"

    week2 = chapters["Week 2: Genetics"][1]
    lab, lab_dir = week2["Lab report"]
    assert lab["activity_type"] == "TYPE_ASSIGNMENT"
    lab_plan = _load(lab_dir / "assignment.json")
    assert lab_plan["assignment"]["due_date"].startswith("2026-05-01")
    assert lab_plan["tasks"][0]["assignment_type"] == "FILE_SUBMISSION"
    assert lab_plan["tasks"][0]["reference_file"]  # the image in the instructions

    quiz, quiz_dir = week2["Unit quiz"]
    plan = _load(quiz_dir / "assignment.json")
    assert plan["assignment"]["allow_retries"] is True
    assert plan["assignment"]["show_correct_answers"] is True
    task_types = {t["assignment_type"] for t in plan["tasks"]}
    assert {"QUIZ", "FORM"} <= task_types
    assert result.report.counts["questions"] > 15

    readings = chapters["Week 1: Cells › Readings"][1]
    assert readings["Draft page"][0]["published"] is False
    assert readings["Crash course"][0]["activity_sub_type"] == "SUBTYPE_VIDEO_YOUTUBE"
    skipped = {s.title for s in result.report.skipped}
    assert {"Publisher tool", "Publisher homework"} <= skipped
