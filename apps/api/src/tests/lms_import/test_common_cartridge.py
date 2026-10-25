"""IMS Common Cartridge reader.

Cartridges are built in ``tmp_path`` and modeled on real exports: the IMS CC
1.1 validation cartridge (nested folders, $IMS-CC-FILEBASE$ paths relative to
the resource, instructor-only question banks, BLTI links), CC 1.0/1.3
namespaces and Thin CC.
"""

from __future__ import annotations

import json
import os
import struct
import zipfile
import zlib
from html import escape

from urllib.parse import urlparse

import pytest

from src.services.courses.lms_import import ir
from src.services.courses.lms_import.convert import convert
from src.services.courses.lms_import.sources import common_cartridge as cc
from src.services.courses.lms_import.sources.common import FileIndex

CC11_NS = "http://www.imsglobal.org/xsd/imsccv1p1/imscp_v1p1"


# ---------------------------------------------------------------------------
# Builders
# ---------------------------------------------------------------------------


def write(root, rel: str, content) -> str:
    path = os.path.join(str(root), *rel.split("/"))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    mode = "wb" if isinstance(content, bytes) else "w"
    with open(path, mode, **({} if isinstance(content, bytes) else {"encoding": "utf-8"})) as f:
        f.write(content)
    return path


def png_bytes() -> bytes:
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", 2, 2, 8, 2, 0, 0, 0)
    raw = b"".join(b"\x00" + b"\x00\xff\x00" * 2 for _ in range(2))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF\n"
MP4 = b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 64
MP3 = b"ID3\x03\x00" + b"\x00" * 64


def manifest_xml(resources: str, organization: str = "", *, ns: str = CC11_NS, schema: str = "IMS Common Cartridge",
                 version: str = "1.1.0", title: str = "Intro to Psychology", extra_meta: str = "") -> str:
    org = f"""<organizations><organization identifier="O_1" structure="rooted-hierarchy">
        <item identifier="root">{organization}</item></organization></organizations>""" if organization else \
        "<organizations/>"
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="cc_course_1" xmlns="{ns}" xmlns:lomimscc="http://ltsc.ieee.org/xsd/imsccv1p1/LOM/manifest"
  xmlns:lom="http://ltsc.ieee.org/xsd/imsccv1p1/LOM/resource">
  <metadata>
    <schema>{schema}</schema>
    <schemaversion>{version}</schemaversion>
    <lomimscc:lom>
      <lomimscc:general>
        <lomimscc:title><lomimscc:string language="en-US">{escape(title)}</lomimscc:string></lomimscc:title>
        <lomimscc:description><lomimscc:string>Basics of the mind &amp; behavior</lomimscc:string></lomimscc:description>
        <lomimscc:language>en</lomimscc:language>
        <lomimscc:keyword><lomimscc:string>psychology</lomimscc:string></lomimscc:keyword>
        <lomimscc:keyword><lomimscc:string>intro</lomimscc:string></lomimscc:keyword>
      </lomimscc:general>
    </lomimscc:lom>
    {extra_meta}
  </metadata>
  {org}
  <resources>{resources}</resources>
</manifest>"""


def qti_item(ident: str, profile: str, body: str, presentation: str, processing: str, weight: str = "1") -> str:
    return f"""<item ident="{ident}" title="{ident}">
  <itemmetadata><qtimetadata>
    <qtimetadatafield><fieldlabel>cc_profile</fieldlabel><fieldentry>{profile}</fieldentry></qtimetadatafield>
    <qtimetadatafield><fieldlabel>cc_weighting</fieldlabel><fieldentry>{weight}</fieldentry></qtimetadatafield>
  </qtimetadata></itemmetadata>
  <presentation>
    <material><mattext texttype="text/html">{escape(body)}</mattext></material>
    {presentation}
  </presentation>
  <resprocessing><outcomes><decvar varname="SCORE" vartype="Decimal" minvalue="0" maxvalue="100"/></outcomes>
    {processing}
  </resprocessing>
</item>"""


def choice_lid(ident: str, labels: list[tuple[str, str]], cardinality: str = "Single") -> str:
    out = "".join(f'<response_label ident="{i}"><material><mattext texttype="text/plain">{escape(t)}</mattext>'
                  f"</material></response_label>" for i, t in labels)
    return f'<response_lid ident="{ident}" rcardinality="{cardinality}"><render_choice>{out}</render_choice></response_lid>'


def correct(respident: str, value: str, tag: str = "varequal", score: str = "100") -> str:
    return (f'<respcondition continue="No"><conditionvar><{tag} respident="{respident}" case="No">{value}</{tag}>'
            f'</conditionvar><setvar varname="SCORE" action="Set">{score}</setvar></respcondition>')


def cc_assessment_xml(*, attempts: str = "2", timelimit: str = "45", assessment_type: str = "Examination") -> str:
    items = [
        qti_item("mc1", "cc.multiple_choice.v0p1",
                 'Which defines psychology? <img src="$IMS-CC-FILEBASE$img1.png"/>',
                 choice_lid("mc1_rl", [("a1", "The study of mind and behavior"), ("a2", "The study of rocks")]),
                 correct("mc1_rl", "a1"), weight="2"),
        qti_item("mr1", "cc.multiple_response.v0p1", "Select the schools of psychology.",
                 choice_lid("mr1_rl", [("b1", "Behaviorism"), ("b2", "Cubism"), ("b3", "Functionalism")],
                            "Multiple"),
                 '<respcondition continue="No"><conditionvar><and>'
                 '<varequal respident="mr1_rl">b1</varequal><not><varequal respident="mr1_rl">b2</varequal></not>'
                 '<varequal respident="mr1_rl">b3</varequal></and></conditionvar>'
                 '<setvar varname="SCORE" action="Set">100</setvar></respcondition>'),
        qti_item("tf1", "cc.true_false.v0p1", "Freud founded psychoanalysis.",
                 choice_lid("tf1_rl", [("t", "True"), ("f", "False")]), correct("tf1_rl", "t")),
        qti_item("fib1", "cc.fib.v0p1", "An operant conditioning chamber is a [_____].",
                 '<response_str ident="fib1_rs" rcardinality="Single"><render_fib><response_label ident="x"/>'
                 "</render_fib></response_str>",
                 correct("fib1_rs", "Skinner box")),
        qti_item("pm1", "cc.pattern_match.v0p1", "Maslow's [_____] of needs.",
                 '<response_str ident="pm1_rs" rcardinality="Single"><render_fib><response_label ident="x"/>'
                 "</render_fib></response_str>",
                 correct("pm1_rs", "hierarchy", tag="varsubstring")),
        """<item ident="mat1" title="Materials">
  <itemmetadata><qtimetadata><qtimetadatafield><fieldlabel>cc_profile</fieldlabel>
    <fieldentry>cc.multiple_choice.v0p1</fieldentry></qtimetadatafield></qtimetadata></itemmetadata>
  <presentation>
    <material><mattext texttype="text/plain">Look at this
picture</mattext><matbreak/><matimage uri="img1.png" label="A brain"/><matemtext>carefully</matemtext></material>
    <response_lid ident="mat1_rl" rcardinality="Single"><render_choice>
      <response_label ident="m1"><material><mat_formattedtext>&lt;b&gt;Cortex&lt;/b&gt;</mat_formattedtext></material></response_label>
      <response_label ident="m2"><material><matemtext>Cerebellum</matemtext></material></response_label>
    </render_choice></response_lid>
  </presentation>
  <resprocessing><respcondition><conditionvar><varequal respident="mat1_rl">m1</varequal></conditionvar>
    <setvar action="Set">1</setvar></respcondition></resprocessing>
</item>""",
        qti_item("fib2", "cc.fib.v0p1", "Symbol of sodium: [_____]",
                 '<response_str ident="fib2_rs" rcardinality="Single"><render_fib><response_label ident="x"/>'
                 "</render_fib></response_str>",
                 '<respcondition continue="No"><conditionvar><varequal respident="fib2_rs" case="Yes">Na</varequal>'
                 '</conditionvar><setvar varname="SCORE" action="Set">100</setvar></respcondition>'),
        qti_item("es1", "cc.essay.v0p1", "Discuss nature versus nurture.",
                 '<response_str ident="es1_rs" rcardinality="Single"><render_fib><response_label ident="x"/>'
                 "</render_fib></response_str>", "", weight="10"),
    ]
    return f"""<?xml version="1.0" encoding="ISO-8859-1"?>
<questestinterop xmlns="http://www.imsglobal.org/xsd/ims_qtiasiv1p2">
  <assessment ident="QDB_1" title="Pretest">
    <qtimetadata>
      <qtimetadatafield><fieldlabel>cc_profile</fieldlabel><fieldentry>cc.exam.v0p1</fieldentry></qtimetadatafield>
      <qtimetadatafield><fieldlabel>qmd_assessmenttype</fieldlabel><fieldentry>{assessment_type}</fieldentry></qtimetadatafield>
      <qtimetadatafield><fieldlabel>qmd_timelimit</fieldlabel><fieldentry>{timelimit}</fieldentry></qtimetadatafield>
      <qtimetadatafield><fieldlabel>cc_maxattempts</fieldlabel><fieldentry>{attempts}</fieldentry></qtimetadatafield>
    </qtimetadata>
    <rubric><material><mattext texttype="text/html">&lt;p&gt;Answer every question.&lt;/p&gt;</mattext></material></rubric>
    <section ident="S_1">{''.join(items)}</section>
  </assessment>
</questestinterop>"""


def weblink_xml(title: str, url: str) -> str:
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<webLink xmlns="http://www.imsglobal.org/xsd/imsccv1p1/imswl_v1p1">
  <title>{escape(title)}</title>
  <url href="{escape(url)}" target="_self"/>
</webLink>"""


def lti_xml(title: str, url: str) -> str:
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<cartridge_basiclti_link xmlns="http://www.imsglobal.org/xsd/imslticc_v1p0"
    xmlns:blti="http://www.imsglobal.org/xsd/imsbasiclti_v1p0">
  <blti:title>{escape(title)}</blti:title>
  <blti:description>An external tool</blti:description>
  <blti:launch_url>{escape(url)}</blti:launch_url>
</cartridge_basiclti_link>"""


def build_cartridge(root) -> str:
    """A CC 1.1 cartridge exercising every resource type the reader knows."""
    root = str(root)
    write(root, "I_1/objectives.html", """<html><head><title>Objectives page</title></head><body>
      <h2>Objectives</h2><p>See <a href="../I_2/other.html">the other page</a> and
      <a href="$WIKI_REFERENCE$/pages/glossary">the glossary</a>.</p>
      <p><img src="$IMS-CC-FILEBASE$/../shared/diagram.png" alt="diagram"></p>
      <p><a href="https://example.com/ref">A reference</a></p></body></html>""")
    write(root, "I_2/other.html", "<p>Other page</p>")
    write(root, "shared/diagram.png", png_bytes())
    write(root, "files/reading.pdf", PDF)
    write(root, "files/lecture.mp4", MP4)
    write(root, "files/podcast.mp3", MP3)
    write(root, "files/photo.png", png_bytes())
    write(root, "files/handout.docx", b"PK\x03\x04docx")
    pkg = os.path.join(root, "files", "scorm.zip")
    with zipfile.ZipFile(pkg, "w") as zf:
        zf.writestr("imsmanifest.xml", "<manifest/>")
        zf.writestr("index.html", "<p>sco</p>")
    write(root, "files/plain.zip", b"not really a zip")
    write(root, "I_3/assessment.xml", cc_assessment_xml())
    write(root, "I_3/img1.png", png_bytes())
    write(root, "I_4/bank.xml", """<questestinterop><objectbank ident="bank1">
      <item ident="bq1"><presentation><material><mattext>Bank question</mattext></material></presentation></item>
      </objectbank></questestinterop>""")
    write(root, "I_5/weblink.xml", weblink_xml("Wikipedia - Freud", "http://en.wikipedia.org/wiki/Sigmund_Freud"))
    write(root, "I_5b/video.xml", weblink_xml("Intro video", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"))
    write(root, "I_5c/empty.xml", weblink_xml("No URL", ""))
    write(root, "I_6/discussion.xml", """<?xml version="1.0" encoding="UTF-8"?>
<dt:topic xmlns:dt="http://www.imsglobal.org/xsd/imsccv1p1/imsdt_v1p1">
  <dt:title>The Psychology of Faces</dt:title>
  <dt:text texttype="text/html">Faces matter. &lt;br/&gt; &lt;img src="$IMS-CC-FILEBASE$../I_media/dog.png"/&gt;</dt:text>
  <dt:attachments>
    <dt:attachment href="../I_media/angry.png"/>
    <dt:attachment href="../I_media/missing.png"/>
  </dt:attachments>
</dt:topic>""")
    write(root, "I_6b/plain.xml", """<topic xmlns="http://www.imsglobal.org/xsd/imsccv1p3/imsdt_v1p3">
      <title>Plain topic</title><text>Line one
Line two &lt;b&gt;</text></topic>""")
    write(root, "I_media/dog.png", png_bytes())
    write(root, "I_media/angry.png", png_bytes())
    write(root, "I_7/lti.xml", lti_xml("BLTI Test", "http://www.imsglobal.org/developers/BLTI/tool.php"))
    write(root, "I_8/assignment.xml", """<?xml version="1.0" encoding="UTF-8"?>
<assignment xmlns="http://www.imsglobal.org/xsd/imscc_extensions/assignment" identifier="A1">
  <title>Write an essay</title>
  <text texttype="text/html">&lt;p&gt;Write 500 words. &lt;img src="essay.png"&gt;&lt;/p&gt;</text>
  <gradable>true</gradable>
  <submission_formats><format type="file"/><format type="text"/></submission_formats>
  <attachments><attachment href="rubric.pdf"/></attachments>
</assignment>""")
    write(root, "I_8/essay.png", png_bytes())
    write(root, "I_8/rubric.pdf", PDF)
    write(root, "I_8b/assignment.xml", """<assignment xmlns="http://www.imsglobal.org/xsd/imscc_extensions/assignment">
  <title>Plain text assignment</title><text texttype="text/plain">Bring notes</text><gradable>false</gradable>
  <extensions><assignment xmlns="http://canvas.instructure.com/xsd/cccv1p0">
    <title>Canvas titled</title><points_possible>15</points_possible><due_at>2026-03-01T23:59:00</due_at>
    <grading_type>not_graded</grading_type></assignment></extensions>
</assignment>""")
    write(root, "I_9/homework.html", '<html><body><p>Do problems 1-5.</p><img src="hw.png"></body></html>')
    write(root, "I_9/hw.png", png_bytes())
    write(root, "I_9/data.csv", "a,b\n1,2\n")
    write(root, "I_10/plan.html", "<p>Teacher notes</p>")
    write(root, "syllabus.html", "<html><body><p>Welcome to the course.</p></body></html>")
    write(root, "I_11/hidden.html", "<p>Hidden page</p>")
    write(root, "I_12/instructor.html", "<p>Answers</p>")
    write(root, "I_13/loose.html", "<p>Loose page</p>")
    write(root, "I_14/sub.html", "<p>Folder with its own page</p>")

    resources = """
    <resource identifier="R_obj" type="webcontent" href="I_1/objectives.html"><file href="I_1/objectives.html"/>
      <dependency identifierref="R_shared"/></resource>
    <resource identifier="R_shared" type="webcontent"><file href="shared/diagram.png"/></resource>
    <resource identifier="R_other" type="webcontent" href="I_2/other.html"><file href="I_2/other.html"/></resource>
    <resource identifier="R_files" type="webcontent" xml:base="files/" href="reading.pdf"><file href="reading.pdf"/></resource>
    <resource identifier="R_video" type="webcontent" href="files/lecture.mp4"><file href="files/lecture.mp4"/></resource>
    <resource identifier="R_audio" type="webcontent" href="files/podcast.mp3"><file href="files/podcast.mp3"/></resource>
    <resource identifier="R_photo" type="webcontent" href="files/photo.png"><file href="files/photo.png"/></resource>
    <resource identifier="R_docx" type="webcontent" href="files/handout.docx"><file href="files/handout.docx"/></resource>
    <resource identifier="R_scorm" type="webcontent" href="files/scorm.zip"><file href="files/scorm.zip"/></resource>
    <resource identifier="R_zip" type="webcontent" href="files/plain.zip"><file href="files/plain.zip"/></resource>
    <resource identifier="R_quiz" type="imsqti_xmlv1p2/imscc_xmlv1p1/assessment"><file href="I_3/assessment.xml"/>
      <dependency identifierref="R_quiz_img"/></resource>
    <resource identifier="R_quiz_img" type="webcontent"><file href="I_3/img1.png"/></resource>
    <resource identifier="R_bank" type="imsqti_xmlv1p2/imscc_xmlv1p1/question-bank">
      <metadata><lom:lom><lom:educational><lom:intendedEndUserRole><lom:source>IMSGLC_CC_Rolesv1p1</lom:source>
      <lom:value>Instructor</lom:value></lom:intendedEndUserRole></lom:educational></lom:lom></metadata>
      <file href="I_4/bank.xml"/></resource>
    <resource identifier="R_wl" type="imswl_xmlv1p1"><file href="I_5/weblink.xml"/></resource>
    <resource identifier="R_yt" type="imswl_xmlv1p3"><file href="I_5b/video.xml"/></resource>
    <resource identifier="R_wl_empty" type="imswl_xmlv1p1"><file href="I_5c/empty.xml"/></resource>
    <resource identifier="R_wl_missing" type="imswl_xmlv1p1"><file href="I_5d/nope.xml"/></resource>
    <resource identifier="R_dt" type="imsdt_xmlv1p1"><file href="I_6/discussion.xml"/>
      <dependency identifierref="R_media"/></resource>
    <resource identifier="R_dt_plain" type="imsdt_xmlv1p3"><file href="I_6b/plain.xml"/></resource>
    <resource identifier="R_media" type="associatedcontent/imscc_xmlv1p1/learning-application-resource">
      <file href="I_media/dog.png"/><file href="I_media/angry.png"/></resource>
    <resource identifier="R_lti" type="imsbasiclti_xmlv1p0"><file href="I_7/lti.xml"/></resource>
    <resource identifier="R_asg" type="assignment_xmlv1p0"><file href="I_8/assignment.xml"/></resource>
    <resource identifier="R_asg2" type="assignment_xmlv1p0" href="I_8b/assignment.xml"><file href="I_8b/assignment.xml"/></resource>
    <resource identifier="R_hw" type="webcontent" href="I_9/homework.html" intendeduse="assignment">
      <file href="I_9/homework.html"/><file href="I_9/data.csv"/><file href="I_9/gone.txt"/></resource>
    <resource identifier="R_plan" type="webcontent" href="I_10/plan.html" intendeduse="lessonplan">
      <file href="I_10/plan.html"/></resource>
    <resource identifier="R_syl" type="webcontent" href="syllabus.html" intendeduse="syllabus">
      <file href="syllabus.html"/></resource>
    <resource identifier="R_hidden" type="webcontent" href="I_11/hidden.html"><file href="I_11/hidden.html"/></resource>
    <resource identifier="R_instr" type="webcontent" href="I_12/instructor.html">
      <metadata><lom:lom><lom:educational><lom:intendedEndUserRole><lom:value>Instructor</lom:value>
      </lom:intendedEndUserRole></lom:educational></lom:lom></metadata>
      <file href="I_12/instructor.html"/></resource>
    <resource identifier="R_loose" type="webcontent" href="I_13/loose.html"><file href="I_13/loose.html"/></resource>
    <resource identifier="R_sub" type="webcontent" href="I_14/sub.html"><file href="I_14/sub.html"/></resource>
    <resource identifier="R_epub" type="idpfepub_epubv3p0"><file href="book.epub"/></resource>
    <resource identifier="R_gone" type="webcontent" href="I_99/gone.html"><file href="I_99/gone.html"/></resource>
    <resource identifier="R_nofile" type="webcontent"/>
    <resource identifier="R_bad_quiz" type="imsqti_xmlv1p2/imscc_xmlv1p1/assessment"><file href="I_15/broken.xml"/></resource>
    <resource identifier="R_noquiz" type="imsqti_xmlv1p2/imscc_xmlv1p1/assessment"><file href="I_16/missing.xml"/></resource>
    """
    write(root, "I_15/broken.xml", "<questestinterop><assessment>")
    organization = """
      <item identifier="loose1" identifierref="R_loose"><title>Loose item</title></item>
      <item identifier="M1"><title>Week 1</title>
        <item identifier="i_obj" identifierref="R_obj"><title>Learning Objectives</title></item>
        <item identifier="i_folder"><title>Study Guide</title>
          <item identifier="i_quiz" identifierref="R_quiz"><title>Pretest</title></item>
          <item identifier="i_deeper"><title>Extras</title>
            <item identifier="i_wl" identifierref="R_wl"><title>Freud on Wikipedia</title></item>
          </item>
        </item>
        <item identifier="i_sub" identifierref="R_sub"><title>Folder page</title>
          <item identifier="i_sub_child" identifierref="R_other"><title>Child page</title></item>
        </item>
        <item identifier="i_dt" identifierref="R_dt"><title>Psychology of Faces</title></item>
        <item identifier="i_dt2" identifierref="R_dt_plain"><title></title></item>
      </item>
      <item identifier="M2"><title>Media</title>
        <item identifier="i_pdf" identifierref="R_files"><title>Reading</title></item>
        <item identifier="i_mp4" identifierref="R_video"><title>Lecture</title></item>
        <item identifier="i_mp3" identifierref="R_audio"><title>Podcast</title></item>
        <item identifier="i_png" identifierref="R_photo"><title>Photo</title></item>
        <item identifier="i_docx" identifierref="R_docx"><title>Handout</title></item>
        <item identifier="i_scorm" identifierref="R_scorm"><title>Interactive</title></item>
        <item identifier="i_zip" identifierref="R_zip"><title>Archive</title></item>
        <item identifier="i_yt" identifierref="R_yt"><title></title></item>
        <item identifier="h1"><title>Homework</title></item>
        <item identifier="i_asg" identifierref="R_asg"><title>Essay</title></item>
        <item identifier="i_asg2" identifierref="R_asg2"><title></title></item>
        <item identifier="i_hw" identifierref="R_hw"><title>Problems</title></item>
        <item identifier="i_plan" identifierref="R_plan"><title>Lesson plan</title></item>
      </item>
      <item identifier="M3" isvisible="false"><title>Hidden module</title>
        <item identifier="i_hidden" identifierref="R_hidden"><title>Hidden page</title></item>
      </item>
      <item identifier="M4"><title>Misc</title>
        <item identifier="i_instr" identifierref="R_instr"><title>Instructor notes</title></item>
        <item identifier="i_bank" identifierref="R_bank"><title>Bank</title></item>
        <item identifier="i_lti" identifierref="R_lti"><title>BLTI Test</title></item>
        <item identifier="i_epub" identifierref="R_epub"><title>Book</title></item>
        <item identifier="i_missing" identifierref="R_nowhere"><title>Non-existent reference</title></item>
        <item identifier="i_gone" identifierref="R_gone"><title>Gone</title></item>
        <item identifier="i_nofile" identifierref="R_nofile"><title>No file</title></item>
        <item identifier="i_wl_empty" identifierref="R_wl_empty"><title>Empty link</title></item>
        <item identifier="i_wl_missing" identifierref="R_wl_missing"><title>Missing link</title></item>
        <item identifier="i_bad_quiz" identifierref="R_bad_quiz"><title>Broken quiz</title></item>
        <item identifier="i_noquiz" identifierref="R_noquiz"><title>Missing quiz</title></item>
      </item>
      <item identifier="M5"><title>Empty module</title></item>
    """
    write(root, "imsmanifest.xml", manifest_xml(resources, organization))
    return root


def by_title(section: ir.Section) -> dict[str, ir.Item]:
    return {item.title: item for item in section.items}


# ---------------------------------------------------------------------------
# Detection and manifest parsing
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("ns,schema", [
    ("http://www.imsglobal.org/xsd/imscc/imscp_v1p1", "IMS Common Cartridge"),  # CC 1.0
    ("http://www.imsglobal.org/xsd/imsccv1p3/imscp_v1p1", "IMS Common Cartridge"),  # CC 1.3
    ("http://www.imsglobal.org/xsd/imscp_v1p1", "IMS Thin CC"),  # Thin CC, generic CP namespace
    ("http://www.imsglobal.org/xsd/imscp_v1p1", "IMS Common Cartridge"),
])
def test_detect_cartridges(tmp_path, ns, schema):
    write(tmp_path, "imsmanifest.xml", manifest_xml("", ns=ns, schema=schema))
    assert cc.detect(str(tmp_path)) == 60


def test_detect_rejects_other_packages(tmp_path):
    assert cc.detect(str(tmp_path)) == 0
    write(tmp_path, "IMSMANIFEST.XML", """<manifest xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2">
      <metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata></manifest>""")
    assert cc.find_manifest(str(tmp_path)).endswith("IMSMANIFEST.XML")
    assert cc.detect(str(tmp_path)) == 0
    assert cc.is_cc_manifest(str(tmp_path / "nope.xml")) is False
    assert cc.find_manifest(str(tmp_path / "missing-dir")) is None


@pytest.mark.parametrize("rtype,kind", [
    ("webcontent", "webcontent"),
    ("imswl_xmlv1p0", "weblink"), ("imswl_xmlv1p3", "weblink"),
    ("imsdt_xmlv1p2", "discussion"),
    ("imsbasiclti_xmlv1p0", "lti"),
    ("imsqti_xmlv1p2/imscc_xmlv1p0/assessment", "assessment"),
    ("imsqti_xmlv1p2", "assessment"),
    ("imsqti_xmlv1p2/imscc_xmlv1p3/question-bank", "question_bank"),
    ("assignment_xmlv1p0", "assignment"),
    ("associatedcontent/imscc_xmlv1p1/learning-application-resource", "associated"),
    ("imsapip_zipv1p0", "other"), ("", "other"),
])
def test_resource_kind(rtype, kind):
    assert cc.resource_kind(rtype) == kind


def test_parse_manifest(tmp_path):
    root = build_cartridge(tmp_path)
    m = cc.parse_manifest(root)
    assert m.title == "Intro to Psychology"
    assert m.description == "Basics of the mind & behavior"
    assert m.language == "en" and m.keywords == ["psychology", "intro"]
    assert m.schema == "IMS Common Cartridge" and m.schema_version == "1.1.0"
    assert m.identifier == "cc_course_1"
    # Root wrapper removed: the top level is the modules
    assert [i.identifier for i in m.items] == ["loose1", "M1", "M2", "M3", "M4", "M5"]
    assert m.items[3].visible is False
    week1 = m.items[1]
    assert week1.title == "Week 1" and week1.children[1].children[0].identifierref == "R_quiz"
    # xml:base applied to href and files
    pdf = m.resource("R_files")
    assert pdf.href == "files/reading.pdf" and pdf.files == ["files/reading.pdf"]
    assert pdf.kind == "webcontent" and pdf.base_dir == "files"
    assert m.resource("R_bank").instructor_only is True
    assert m.resource("R_instr").instructor_only is True
    assert m.resource("R_obj").instructor_only is False
    assert m.resource("R_syl").intendeduse == "syllabus"
    assert m.resource("R_nofile").main_file == ""
    assert m.resource("nope") is None
    assert cc.resource_files(m, m.resource("R_obj")) == ["I_1/objectives.html", "shared/diagram.png"]
    assert cc.resource_files(m, m.resource("R_obj"), include_dependencies=False) == ["I_1/objectives.html"]
    assert [i.identifier for i in m.iter_items()][:4] == ["loose1", "M1", "i_obj", "i_folder"]


def test_parse_manifest_variants(tmp_path):
    # Manifest in a subfolder, default organization, resources-level xml:base,
    # a dependency cycle and an organization without the root wrapper
    write(tmp_path, "pkg/imsmanifest.xml", f"""<manifest xmlns="{CC11_NS}">
      <organizations default="O_2">
        <organization identifier="O_1"><item identifier="x"><title>Wrong</title></item></organization>
        <organization identifier="O_2">
          <item identifier="only"><title>Only module</title>
            <item identifier="a" identifierref="R1"><title>A</title></item>
          </item>
        </organization>
      </organizations>
      <resources xml:base="content/">
        <resource identifier="R1" type="webcontent" href="a.html"><file href="a.html"/>
          <dependency identifierref="R2"/></resource>
        <resource identifier="R2" type="webcontent"><file href="b.png"/><dependency identifierref="R1"/></resource>
        <resource type="webcontent" href="no-id.html"/>
      </resources>
    </manifest>""")
    m = cc.parse_manifest(str(tmp_path), str(tmp_path / "pkg" / "imsmanifest.xml"))
    assert m.title == "" and len(m.resources) == 2
    assert m.resource("R1").href == "pkg/content/a.html"
    assert cc.resource_files(m, m.resource("R1")) == ["pkg/content/a.html", "pkg/content/b.png"]
    # A single titled module with leaf children is kept as a module
    assert [i.identifier for i in m.items] == ["only"]
    with pytest.raises(FileNotFoundError):
        cc.parse_manifest(str(tmp_path))


# ---------------------------------------------------------------------------
# Reading a full cartridge
# ---------------------------------------------------------------------------


def test_read_cartridge_structure(tmp_path):
    course = cc.read(build_cartridge(tmp_path))
    assert course.title == "Intro to Psychology"
    assert course.source == "common_cartridge" and course.id == "cc_course_1"
    assert course.tags == ["psychology", "intro"] and course.language == "en"
    assert "mind &amp; behavior" in course.summary.html
    titles = [s.title for s in course.sections]
    assert titles == ["Syllabus", "Intro to Psychology", "Week 1", "Media", "Media › Homework", "Hidden module",
                      "Misc", "Empty module"]
    syllabus = course.sections[0].items[0]
    assert isinstance(syllabus, ir.Page) and "Welcome" in syllabus.parts[0].content.html
    loose = course.sections[1]
    assert [i.title for i in loose.items] == ["Loose item"]
    hidden = course.sections[5]
    assert hidden.visible is False and hidden.items[0].visible is False


def test_read_webcontent_pages(tmp_path):
    course = cc.read(build_cartridge(tmp_path))
    week1 = by_title(course.sections[2])
    page = week1["Learning Objectives"]
    assert isinstance(page, ir.Page)
    html = page.parts[0].content.html
    # Links to other pages and Canvas wiki references keep their text only
    assert "the other page" in html and "../I_2/other.html" not in html
    assert "$WIKI_REFERENCE$" not in html and "the glossary" in html
    assert 'href="https://example.com/ref"' in html
    asset = page.parts[0].content.resolve("$IMS-CC-FILEBASE$/../shared/diagram.png")
    assert asset is not None and asset.name == "diagram.png"
    # Folder with its own resource: the resource, then its children prefixed
    assert "Folder page" in week1 and "Folder page › Child page" in week1


def test_read_nested_folders_and_quiz(tmp_path):
    course = cc.read(build_cartridge(tmp_path))
    week1 = by_title(course.sections[2])
    quiz = week1["Study Guide › Pretest"]
    assert isinstance(quiz, ir.Assessment)
    assert quiz.max_attempts == 2 and quiz.time_limit_minutes == 45 and quiz.graded is True
    assert "Answer every question" in quiz.intro.html
    types = [q.type for q in quiz.questions]
    assert types == [ir.QType.MULTICHOICE, ir.QType.MULTICHOICE, ir.QType.TRUEFALSE, ir.QType.SHORTANSWER,
                     ir.QType.SHORTANSWER, ir.QType.MULTICHOICE, ir.QType.SHORTANSWER, ir.QType.ESSAY]
    mc, mr, tf, fib, pm, mat, fib2, essay = quiz.questions
    assert mat.text.html == 'Look at this<br>picture<br><img src="img1.png" alt="A brain"><em>carefully</em>'
    assert [c.text.html for c in mat.choices] == ["<b>Cortex</b>", "<em>Cerebellum</em>"]
    assert mat.choices[0].correct and mat.text.resolve("img1.png").name == "img1.png"
    assert fib2.answers == ["Na"] and fib2.case_sensitive is True
    assert mc.points == 2 and [c.correct for c in mc.choices] == [True, False]
    img = mc.text.resolve("$IMS-CC-FILEBASE$img1.png")
    assert img is not None and img.path.endswith(os.path.join("I_3", "img1.png"))
    assert mr.multiple is True and [c.correct for c in mr.choices] == [True, False, True]
    assert [c.correct for c in tf.choices] == [True, False]
    assert fib.answers == ["Skinner box"]
    assert pm.answers == [".*(?:hierarchy).*"] and pm.regex  # varsubstring: the answer must contain it
    assert essay.points == 10
    link = week1["Study Guide › Extras › Freud on Wikipedia"]
    assert isinstance(link, ir.Page) and isinstance(link.parts[0], ir.LinkPart)
    assert link.parts[0].url == "http://en.wikipedia.org/wiki/Sigmund_Freud"


def test_read_discussions(tmp_path):
    course = cc.read(build_cartridge(tmp_path))
    week1 = by_title(course.sections[2])
    topic = week1["Psychology of Faces"]
    assert isinstance(topic, ir.Page)
    rich = topic.parts[0].content
    assert rich.resolve("$IMS-CC-FILEBASE$../I_media/dog.png").name == "dog.png"
    files = [p for p in topic.parts if isinstance(p, ir.FilePart)]
    assert [f.asset.name for f in files] == ["angry.png"]
    plain = week1["Plain topic"]
    assert "Line one<br>Line two &lt;b&gt;" in plain.parts[0].content.html
    # Topics imported as pages are silent; a lost attachment is a skipped file
    assert not any("discussion" in w.lower() for w in course.warnings)
    assert ("missing.png", "file", "missing from the export") in course.skipped


def test_read_files_by_type(tmp_path):
    course = cc.read(build_cartridge(tmp_path))
    media = by_title(course.sections[3])
    assert isinstance(media["Reading"], ir.DocumentItem) and media["Reading"].asset.name == "reading.pdf"
    assert isinstance(media["Lecture"], ir.VideoItem) and media["Lecture"].asset.name == "lecture.mp4"
    podcast = media["Podcast"]
    assert isinstance(podcast, ir.Page) and podcast.parts[0].kind == ir.MediaKind.AUDIO
    assert media["Photo"].parts[0].kind == ir.MediaKind.IMAGE
    assert isinstance(media["Handout"].parts[0], ir.FilePart)
    assert isinstance(media["Interactive"], ir.ScormItem)
    assert isinstance(media["Archive"].parts[0], ir.FilePart)  # a .zip that is not SCORM
    video = media["Intro video"]
    assert isinstance(video, ir.VideoItem) and urlparse(video.url).hostname == "www.youtube.com"


def test_read_assignments_and_header_split(tmp_path):
    course = cc.read(build_cartridge(tmp_path))
    homework = course.sections[4]
    assert homework.title == "Media › Homework"
    items = by_title(homework)
    essay = items["Essay"]
    assert isinstance(essay, ir.AssignmentItem)
    assert essay.allow_file and essay.allow_text and essay.graded
    assert [a.name for a in essay.attachments] == ["rubric.pdf"]
    assert essay.instructions.resolve("essay.png").name == "essay.png"
    canvas_ext = items["Canvas titled"]
    assert canvas_ext.points == 15 and canvas_ext.graded is False
    assert canvas_ext.due_date.startswith("2026-03-01T23:59")
    assert canvas_ext.instructions.html == "Bring notes"
    hw = items["Problems"]
    assert isinstance(hw, ir.AssignmentItem) and "problems 1-5" in hw.instructions.html
    assert [a.name for a in hw.attachments] == ["data.csv"]
    assert items["Lesson plan"].visible is False


def test_read_unsupported_and_missing(tmp_path):
    course = cc.read(build_cartridge(tmp_path))
    misc = by_title(course.sections[6])
    assert misc["Instructor notes"].visible is False
    assert "Bank" not in misc  # question banks are never placed
    lti = misc["BLTI Test"]
    assert isinstance(lti, ir.UnsupportedItem) and lti.kind == "LTI tool"
    assert "http://www.imsglobal.org/developers/BLTI/tool.php" in lti.reason
    assert isinstance(misc["Book"], ir.UnsupportedItem) and "idpfepub" in misc["Book"].reason
    assert misc["No file"].reason == "resource has no file"
    assert misc["Empty link"].reason == "web link has no URL" and misc["Empty link"].kind == "link"
    broken = misc["Broken quiz"]
    assert isinstance(broken, ir.UnsupportedItem) and "unreadable" in broken.reason
    assert "Non-existent reference" not in misc and "Gone" not in misc and "Missing quiz" not in misc
    # Only the unreadable file is a warning; everything missing is a skipped entry
    (warning,) = course.warnings
    assert warning.startswith("Could not read 'Broken quiz'")
    assert {(t, k) for t, k, _ in course.skipped} == {
        ("Non-existent reference", "item"), ("Gone", "file"), ("Missing link", "link"), ("Missing quiz", "quiz"),
        ("missing.png", "file"),  # a discussion attachment
    }
    assert all(r == "missing from the export" for _t, _k, r in course.skipped)


def test_unorganized_cartridge(tmp_path):
    """A QTI-only export: no organization, resources imported in manifest order."""
    write(tmp_path, "q/assessment.xml", cc_assessment_xml(attempts="unlimited", timelimit="", assessment_type="Survey"))
    write(tmp_path, "page.html", "<p>Hi</p>")
    write(tmp_path, "pic.png", png_bytes())
    write(tmp_path, "syl.html", "<p>Syllabus</p>")
    write(tmp_path, "imsmanifest.xml", manifest_xml("""
      <resource identifier="Q" type="imsqti_xmlv1p2"><file href="q/assessment.xml"/></resource>
      <resource identifier="P" type="webcontent" href="page.html"><file href="page.html"/></resource>
      <resource identifier="IMG" type="webcontent" href="pic.png"><file href="pic.png"/></resource>
      <resource identifier="S" type="webcontent" href="syl.html" intendeduse="syllabus"><file href="syl.html"/></resource>
      <resource identifier="X" type="associatedcontent/imscc_xmlv1p1/learning-application-resource" href="x.xml"/>
    """, title=""))
    course = cc.read(str(tmp_path))
    assert course.title == "Imported course"
    assert [s.title for s in course.sections] == ["Syllabus", "Imported course"]
    items = course.sections[1].items
    assert [type(i).__name__ for i in items] == ["Assessment", "Page"]
    quiz = items[0]
    assert quiz.max_attempts == 0 and quiz.time_limit_minutes is None and quiz.graded is False
    assert quiz.title == "Pretest"
    assert course.warnings == []  # manifest-order import is not reported


def test_empty_cartridge(tmp_path):
    write(tmp_path, "imsmanifest.xml", manifest_xml(""))
    course = cc.read(str(tmp_path))
    assert course.sections == [] and course.warnings == [] and course.skipped == []


def test_syllabus_variants(tmp_path):
    write(tmp_path, "empty.html", "<html><body>  </body></html>")
    write(tmp_path, "syllabus.pdf", PDF)
    write(tmp_path, "syl.png", png_bytes())
    write(tmp_path, "imsmanifest.xml", manifest_xml("""
      <resource identifier="S1" type="webcontent" href="empty.html" intendeduse="syllabus"><file href="empty.html"/></resource>
      <resource identifier="S2" type="webcontent" href="syllabus.pdf" intendeduse="syllabus"/>
      <resource identifier="S3" type="webcontent" href="syl.png" intendeduse="syllabus"/>
    """))
    course = cc.read(str(tmp_path))
    # Empty HTML and a PDF (not a page) are skipped; the image page is used
    assert course.sections[0].title == "Syllabus"
    assert course.sections[0].items[0].parts[0].kind == ir.MediaKind.IMAGE


def test_inline_resources_cc13(tmp_path):
    """CC 1.3 lets the resource document live inside <resource> itself."""
    qti_doc = cc_assessment_xml().split("?>", 1)[1]
    write(tmp_path, "img1.png", png_bytes())
    write(tmp_path, "imsmanifest.xml", manifest_xml(f"""
      <resource identifier="Q" type="imsqti_xmlv1p2/imscc_xmlv1p3/assessment">{qti_doc}</resource>
      <resource identifier="W" type="imswl_xmlv1p3">
        <webLink xmlns="http://www.imsglobal.org/xsd/imsccv1p3/imswl_v1p3"><title>Inline link</title>
        <url href="https://example.com/inline"/></webLink></resource>
      <resource identifier="D" type="imsdt_xmlv1p3">
        <topic xmlns="http://www.imsglobal.org/xsd/imsccv1p3/imsdt_v1p3"><title>Inline topic</title>
        <text texttype="text/html">&lt;p&gt;Talk&lt;/p&gt;</text></topic></resource>
      <resource identifier="L" type="imsbasiclti_xmlv1p0">
        <cartridge_basiclti_link xmlns="http://www.imsglobal.org/xsd/imslticc_v1p0">
        <title>Inline tool</title><secure_launch_url>https://tool.example.com/s</secure_launch_url>
        </cartridge_basiclti_link></resource>
      <resource identifier="A" type="assignment_xmlv1p0">
        <metadata/><assignment xmlns="http://www.imsglobal.org/xsd/imscc_extensions/assignment">
        <title>Inline assignment</title><text texttype="text/html">&lt;p&gt;Go&lt;/p&gt;</text>
        <submission_formats><format type="url"/></submission_formats></assignment></resource>
    """, """<item identifier="m"><title>Inline</title>
      <item identifier="q" identifierref="Q"><title></title></item>
      <item identifier="w" identifierref="W"><title></title></item>
      <item identifier="d" identifierref="D"><title></title></item>
      <item identifier="l" identifierref="L"><title></title></item>
      <item identifier="a" identifierref="A"><title></title></item>
    </item>""", ns="http://www.imsglobal.org/xsd/imsccv1p3/imscp_v1p1", version="1.3.0"))
    quiz, link, topic, tool, asg = cc.read(str(tmp_path)).sections[0].items
    assert isinstance(quiz, ir.Assessment) and quiz.title == "Pretest" and len(quiz.questions) == 8
    assert quiz.questions[0].text.resolve("$IMS-CC-FILEBASE$img1.png").name == "img1.png"
    assert link.title == "Inline link" and link.parts[0].url == "https://example.com/inline"
    assert topic.title == "Inline topic" and "Talk" in topic.parts[0].content.html
    assert tool.title == "Inline tool" and "https://tool.example.com/s" in tool.reason
    assert asg.title == "Inline assignment" and asg.allow_text and not asg.allow_file


def test_quiz_file_from_dependency(tmp_path):
    """Canvas "QTI export": the questions are listed under the meta resource."""
    write(tmp_path, "non_cc_assessments/g1.xml.qti", cc_assessment_xml())
    write(tmp_path, "g1/assessment_meta.xml", "<quiz/>")
    write(tmp_path, "non_cc_assessments/g2.xml.qti", cc_assessment_xml(attempts="1"))
    write(tmp_path, "imsmanifest.xml", manifest_xml("""
      <resource identifier="g1" type="imsqti_xmlv1p2"><file href="g1/g1.xml"/><dependency identifierref="m1"/></resource>
      <resource identifier="m1" type="associatedcontent/imscc_xmlv1p1/learning-application-resource"
        href="g1/assessment_meta.xml"><file href="g1/assessment_meta.xml"/>
        <file href="non_cc_assessments/g1.xml.qti"/></resource>
      <resource identifier="g2" type="imsqti_xmlv1p2"/>
    """))
    quizzes = cc.read(str(tmp_path)).sections[0].items
    assert [q.max_attempts for q in quizzes] == [2, 1]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def test_parse_html():
    doc = cc.parse_html("""<html><head><title>My &amp; page</title>
      <meta name="workflow_state" content="unpublished"/><meta name="Front_Page" content='true'>
      <meta http-equiv="Content-Type" content="text/html"></head>
      <body class="x"><p>Body</p></body></html>""")
    assert doc.title == "My & page"
    assert doc.meta == {"workflow_state": "unpublished", "front_page": "true"}
    assert doc.body == "<p>Body</p>"
    fragment = cc.parse_html("<html><head><style>p{}</style></head><p>Just a fragment</p></html>")
    assert fragment.body == "<p>Just a fragment</p>" and fragment.title == ""
    unclosed = cc.parse_html("<body><p>No end")
    assert unclosed.body == "<p>No end"


def test_read_text_encodings(tmp_path):
    p = tmp_path / "f.html"
    p.write_bytes(b"\xef\xbb\xbfcaf\xc3\xa9")
    assert cc.read_text(str(p)) == "café"
    p.write_bytes("café".encode("utf-16"))
    assert cc.read_text(str(p)) == "café"
    p.write_bytes(b"caf\xe9")
    assert cc.read_text(str(p)) == "café"
    p.write_bytes("café".encode("utf-8"))
    assert cc.read_html(str(p)).body == "café"


def test_unwrap_internal_links():
    html = ('<p><a href="$WIKI_REFERENCE$/pages/a">Page A</a> '
            '<a href="%24CANVAS_OBJECT_REFERENCE%24/assignments/g1">HW</a> '
            '<a href="$CANVAS_COURSE_REFERENCE$/file_ref/g2">File</a> '
            "<a href='other.htm#x'>Other</a> <a href=\"#top\">Top</a> "
            '<a href="mailto:a@b.c">Mail</a> <a href="notes.pdf">Notes</a></p>')
    out = cc.unwrap_internal_links(html)
    assert "Page A" in out and "WIKI_REFERENCE" not in out
    assert "HW" in out and "assignments/g1" not in out
    assert 'file_ref/g2">File</a>' in out
    assert "other.htm" not in out and "Other" in out
    assert 'href="#top"' in out and 'href="mailto:a@b.c"' in out and 'href="notes.pdf"' in out
    assert cc.unwrap_internal_links("<p>no links</p>") == "<p>no links</p>"
    assert cc.unwrap_internal_links("") == ""


def test_cc_resolver(tmp_path):
    write(tmp_path, "web_resources/Uploaded Media/pug.jpg", b"\xff\xd8\xffjpeg")
    write(tmp_path, "doc/local.png", png_bytes())
    write(tmp_path, "files/report.pdf", PDF)
    write(tmp_path, "imsmanifest.xml", manifest_xml(
        '<resource identifier="g2" type="webcontent" href="files/report.pdf"/>'
        '<resource identifier="g3" type="webcontent" href="files/gone.pdf"/>'))
    index = FileIndex(str(tmp_path))
    m = cc.parse_manifest(str(tmp_path))
    resolve = cc.make_cc_resolver(index, "doc", ["web_resources"], m)
    assert resolve("$IMS-CC-FILEBASE$/Uploaded Media/pug.jpg").name == "pug.jpg"
    assert resolve("%24IMS-CC-FILEBASE%24/Uploaded%20Media/pug.jpg?canvas_download=1").name == "pug.jpg"
    assert resolve("%24IMS_CC_FILEBASE%24/Uploaded Media/pug.jpg").name == "pug.jpg"
    assert resolve("$IMS-CC-FILEBASE$local.png").name == "local.png"
    assert resolve("local.png").name == "local.png"
    assert resolve("$CANVAS_COURSE_REFERENCE$/file_ref/g2?wrap=1").name == "report.pdf"
    assert resolve("$CANVAS_COURSE_REFERENCE$/file_ref/g3") is None
    assert resolve("$IMS-CC-FILEBASE$/") is None
    assert resolve("$IMS-CC-FILEBASE$/nothing.png") is None
    assert resolve("https://example.com/a.png") is None


def test_small_helpers(tmp_path):
    assert cc.max_attempts_from("") == 1
    assert cc.max_attempts_from("unlimited") == 0
    assert cc.max_attempts_from("-1") == 0
    assert cc.max_attempts_from("-3") == 0
    assert cc.max_attempts_from("0") == 1
    assert cc.max_attempts_from("4") == 4
    assert cc.max_attempts_from("x", 2) == 2
    assert cc.own_qti_metadata(None) == {}
    assert cc.Resource(identifier="x", type="webcontent").inline is None  # built by a reader, not the manifest
    assert cc.is_scorm_zip(str(tmp_path / "none.zip")) is False
    index = FileIndex(str(tmp_path))
    assert cc.item_for_file(index, "missing.pdf", "X") is None
    write(tmp_path, "a/clip.webm", b"\x1aE\xdf\xa3")
    index = FileIndex(str(tmp_path))
    video = cc.item_for_file(index, "a/clip.webm", "")
    assert isinstance(video, ir.VideoItem) and video.title == "Clip"
    vimeo = cc.link_item("https://vimeo.com/123456", "")
    assert isinstance(vimeo, ir.VideoItem) and vimeo.title == "https://vimeo.com/123456"
    link = cc.link_item(" https://example.com ", "Site", description="d")
    assert link.parts[0].url == "https://example.com" and link.parts[0].description == "d"
    write(tmp_path, "lti.xml", lti_xml("T", ""))
    assert cc.parse_lti(str(tmp_path / "lti.xml")).launch_url == ""
    write(tmp_path, "noqti.xml", "<questestinterop/>")
    assert cc.read_qti_assessment(str(tmp_path / "noqti.xml"), lambda u: None) is None


def test_lti_without_file_and_assignment_variants(tmp_path):
    write(tmp_path, "asg/instructions.html", "<p>See xml</p>")
    write(tmp_path, "asg/assignment.xml", """<assignment><title>From xml</title>
      <text texttype="text/html">&lt;p&gt;Hi&lt;/p&gt;</text></assignment>""")
    write(tmp_path, "imsmanifest.xml", manifest_xml("""
      <resource identifier="L" type="imsbasiclti_xmlv1p0"><file href="missing.xml"/></resource>
      <resource identifier="A" type="assignment_xmlv1p0" href="asg/instructions.html">
        <file href="asg/instructions.html"/><file href="asg/assignment.xml"/></resource>
      <resource identifier="B" type="assignment_xmlv1p0"><file href="asg/none.xml"/></resource>
    """, """<item identifier="m"><title>M</title>
      <item identifier="l" identifierref="L"><title></title></item>
      <item identifier="a" identifierref="A"><title></title></item>
      <item identifier="b" identifierref="B"><title>B</title></item>
    </item>"""))
    course = cc.read(str(tmp_path))
    lti, asg, missing = course.sections[0].items
    assert lti.title == "L" and lti.reason == "external tool (LTI) links are not migrated"
    assert isinstance(asg, ir.AssignmentItem) and asg.title == "From xml"
    assert asg.allow_file and not asg.allow_text and asg.points is None and asg.due_date is None
    # The description file is gone: the assignment is kept, without instructions
    assert isinstance(missing, ir.AssignmentItem) and missing.title == "B" and missing.instructions.is_empty()
    assert ("B", "assignment", "its description is missing from the export") in course.skipped
    assert course.warnings == []


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


def test_convert_end_to_end(tmp_path):
    src = build_cartridge(tmp_path / "src")
    archive = _zip_dir(src, str(tmp_path / "course.imscc"))
    out = tmp_path / "out"
    result = convert(archive, str(out), source="auto")
    assert result.course.source == "common_cartridge"
    manifest = _load(out / "manifest.json")
    assert manifest["format"] == "learnhouse-course-export"
    course_dir = out / manifest["courses"][0]["path"]
    course_json = _load(course_dir / "course.json")
    assert course_json["name"] == "Intro to Psychology"
    assert course_json["tags"] == "psychology,intro"

    chapters = {}
    for chapter in sorted((course_dir / "chapters").iterdir()):
        data = _load(chapter / "chapter.json")
        acts = []
        for act_dir in sorted((chapter / "activities").iterdir()) if (chapter / "activities").exists() else []:
            act = _load(act_dir / "activity.json")
            acts.append((act, act_dir))
        chapters[data["name"]] = sorted(acts, key=lambda a: a[0]["order"])
    assert "Week 1" in chapters and "Media" in chapters and "Empty module" not in chapters

    week1 = {a["name"]: (a, d) for a, d in chapters["Week 1"]}
    quiz, quiz_dir = week1["Study Guide › Pretest"]
    assert quiz["activity_type"] == "TYPE_ASSIGNMENT"
    plan = _load(quiz_dir / "assignment.json")
    assert plan["assignment"]["allow_retries"] is True and plan["assignment"]["max_retries"] == 2
    task_types = [t["assignment_type"] for t in plan["tasks"]]
    assert "QUIZ" in task_types
    objectives, obj_dir = week1["Learning Objectives"]
    assert objectives["activity_type"] == "TYPE_DYNAMIC"
    assert any(n["type"] == "blockImage" for n in objectives["content"]["content"])
    assert (obj_dir / "blocks").is_dir()

    media = {a["name"]: a for a, _d in chapters["Media"]}
    assert media["Reading"]["activity_type"] == "TYPE_DOCUMENT"
    assert media["Lecture"]["activity_type"] == "TYPE_VIDEO"
    assert media["Intro video"]["activity_sub_type"] == "SUBTYPE_VIDEO_YOUTUBE"
    hidden = {a["name"]: a for a, _d in chapters["Hidden module"]}
    assert hidden["Hidden page"]["published"] is False
    homework = {a["name"]: (a, d) for a, d in chapters["Media › Homework"]}
    essay, essay_dir = homework["Essay"]
    essay_plan = _load(essay_dir / "assignment.json")
    assert essay_plan["tasks"][0]["assignment_type"] == "FILE_SUBMISSION"
    assert any(s.kind == "LTI tool" for s in result.report.skipped)
