"""Open edX (OLX) reader.

The synthetic exports follow what Studio's "Export course" writes (see
openedx/edx-demo-course and the OLX reference): a ``course.xml`` pointer, one
file per block under ``chapter/``, ``sequential/``, ``vertical/``, ``html/``,
``problem/``, ``video/``, plus ``policies/{run}/policy.json`` and ``static/``.
Some tests use the older inline style where the whole tree lives in one file.
"""

from __future__ import annotations

import base64
import json
import os
import tarfile

import pytest

from src.services.courses.lms_import import ir
from src.services.courses.lms_import.sources import openedx

PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)
PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"
MP4 = b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 32


class Olx:
    """Writes an OLX tree under ``root``."""

    def __init__(self, root, run="2024", org="TestOrg", number="TX101"):
        self.root = str(root)
        self.run = run
        self.org = org
        self.number = number
        self.policy: dict = {}

    def write(self, rel: str, content) -> str:
        path = os.path.join(self.root, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        mode = "wb" if isinstance(content, bytes) else "w"
        with open(path, mode, **({} if mode == "wb" else {"encoding": "utf-8"})) as f:
            f.write(content)
        return path

    def course(self, chapters=(), attrs: str = 'display_name="Test Course"') -> None:
        self.write("course.xml", f'<course url_name="{self.run}" org="{self.org}" course="{self.number}"/>')
        inner = "".join(f'<chapter url_name="{c}"/>' for c in chapters)
        self.write(f"course/{self.run}.xml", f"<course {attrs}>{inner}<wiki slug=\"x\"/></course>")

    def block(self, tag: str, url: str, xml: str) -> None:
        self.write(f"{tag}/{url}.xml", xml)

    def chapter(self, url: str, name: str, sequentials=()) -> None:
        inner = "".join(f'<sequential url_name="{s}"/>' for s in sequentials)
        self.block("chapter", url, f'<chapter display_name="{name}">{inner}</chapter>')

    def sequential(self, url: str, name: str, verticals=(), attrs: str = "") -> None:
        inner = "".join(f'<vertical url_name="{v}"/>' for v in verticals)
        self.block("sequential", url, f'<sequential display_name="{name}" {attrs}>{inner}</sequential>')

    def vertical(self, url: str, name: str, components: str, attrs: str = "") -> None:
        self.block("vertical", url, f'<vertical display_name="{name}" {attrs}>{components}</vertical>')

    def html(self, url: str, body: str, name: str = "Text") -> str:
        self.write(f"html/{url}.xml", f'<html filename="{url}" display_name="{name}"/>')
        self.write(f"html/{url}.html", body)
        return f'<html url_name="{url}"/>'

    def problem(self, url: str, xml: str) -> str:
        self.block("problem", url, xml)
        return f'<problem url_name="{url}"/>'

    def save_policy(self) -> None:
        self.write(f"policies/{self.run}/policy.json", json.dumps(self.policy))

    def grading(self, cutoffs: dict) -> None:
        self.write(f"policies/{self.run}/grading_policy.json",
                   json.dumps({"GRADER": [{"type": "Homework", "weight": 1.0}], "GRADE_CUTOFFS": cutoffs}))


def one_unit(tmp_path, components: str, *, graded: bool = False, seq_attrs: str = "", vert_attrs: str = "",
             setup=None) -> ir.Course:
    """A course with one chapter, one subsection and one unit holding ``components``."""
    olx = Olx(tmp_path)
    olx.course(["ch1"])
    olx.chapter("ch1", "Week 1", ["seq1"])
    attrs = ('graded="true" format="Homework" ' if graded else "") + seq_attrs
    olx.sequential("seq1", "Lesson", ["v1"], attrs)
    olx.vertical("v1", "Unit one", components(olx) if callable(components) else components, vert_attrs)
    if setup:
        setup(olx)
    return openedx.read(str(tmp_path))


def items(course: ir.Course) -> list:
    return [i for s in course.sections if s.id != "course-pages" for i in s.items]


def problem_questions(tmp_path, xml: str) -> tuple[list, ir.Course]:
    course = one_unit(tmp_path, lambda o: o.problem("p1", xml))
    page = items(course)[0]
    quizzes = [p for p in page.parts if isinstance(p, ir.InlineQuizPart)]
    return (quizzes[0].questions if quizzes else []), course


# ---------------------------------------------------------------------------
# Detection
# ---------------------------------------------------------------------------


def test_detect_course_xml_at_root(tmp_path):
    Olx(tmp_path).course()
    assert openedx.detect(str(tmp_path)) == 100


def test_detect_inside_single_course_folder(tmp_path):
    Olx(tmp_path / "course").course()
    (tmp_path / ".DS_Store").write_text("x")
    assert openedx.detect(str(tmp_path)) == 100
    course = openedx.read(str(tmp_path))
    assert course.title == "Test Course"


@pytest.mark.parametrize("content", [
    "<course><shortname>x</shortname></course>",  # Moodle's course/course.xml
    "<course/>",  # no url_name, org or chapters
    "<chapter url_name='x'/>",
    "<course url_name='x'",  # broken XML
])
def test_detect_rejects_other_xml(tmp_path, content):
    (tmp_path / "course.xml").write_text(content)
    assert openedx.detect(str(tmp_path)) == 0


def test_detect_rejects_moodle_backup_and_ambiguous_folders(tmp_path):
    (tmp_path / "moodle_backup.xml").write_text("<moodle_backup/>")
    Olx(tmp_path).course()
    assert openedx.detect(str(tmp_path)) == 0

    other = tmp_path / "other"
    Olx(other / "a").course()
    (other / "b").mkdir()
    assert openedx.detect(str(other)) == 0
    assert openedx.detect(str(tmp_path / "missing")) == 0
    with pytest.raises(ValueError):
        openedx.read(str(other))


# ---------------------------------------------------------------------------
# Course, policies, outline
# ---------------------------------------------------------------------------


def test_pointer_style_course_with_policies(tmp_path):
    olx = Olx(tmp_path)
    olx.course(["ch1", "ch2"], attrs='display_name="XML name" course_image="card.png" language="fr" '
                                     'learning_info="[&quot;Learn A&quot;, &quot;Learn B&quot;]"')
    olx.chapter("ch1", "Chapter XML", ["seq1"])
    olx.chapter("ch2", "Hidden chapter", [])
    olx.sequential("seq1", "Seq", ["v1"])
    olx.vertical("v1", "Unit", olx.html("h1", "<p>Hello <img src='/static/pic.png'/></p>"))
    olx.write("static/pic.png", PNG)
    olx.write("static/policy-card.png", PNG)
    olx.write("about/short_description.html", "Short text")
    olx.write("about/overview.html", "<section class='about'><h2>About</h2><p>Long</p></section>")
    olx.policy = {
        "course/2024": {"display_name": "Policy name", "course_image": "policy-card.png"},
        "chapter/ch1": {"display_name": "Chapter from policy"},
        "chapter/ch2": {"visible_to_staff_only": True},
    }
    olx.save_policy()
    course = openedx.read(str(tmp_path))
    assert course.title == "Policy name"
    assert course.short_name == "TX101"
    assert course.id == "TestOrg+TX101+2024"
    assert course.language == "fr"
    assert course.learnings == ["Learn A", "Learn B"]
    assert course.thumbnail.name == "policy-card.png"
    assert course.summary.html == "Short text"
    assert [s.title for s in course.sections] == ["Chapter from policy", "Hidden chapter", "Course pages"]
    assert course.sections[1].visible is False
    page = course.sections[0].items[0]
    assert isinstance(page, ir.Page) and page.title == "Unit" and page.id == "vertical/v1"
    html = page.parts[0].content
    assert html.resolve("/static/pic.png").name == "pic.png"
    about = course.sections[-1].items[0]
    assert about.title == "About this course"


def test_inline_style_course(tmp_path):
    (tmp_path / "course.xml").write_text("""
<course org="Org" course="Inline" url_name="run" display_name="Inline course">
  <chapter display_name="Intro">
    <sequential display_name="First">
      <vertical display_name="Welcome">
        <html display_name="Welcome text"><![CDATA[<p>Hi <b>there</b></p>]]></html>
        <html><p>Second <i>block</i></p></html>
        <video display_name="Clip" youtube="0.75:slow,1.00:abcdEFGhijk,1.50:fast"/>
      </vertical>
    </sequential>
  </chapter>
</course>""")
    course = openedx.read(str(tmp_path))
    assert course.title == "Inline course"
    page = course.sections[0].items[0]
    assert [type(p).__name__ for p in page.parts] == ["HtmlPart", "HtmlPart", "MediaPart"]
    assert page.parts[0].content.html == "<p>Hi <b>there</b></p>"
    assert "<i>block</i>" in page.parts[1].content.html
    assert page.parts[2].url == "https://www.youtube.com/watch?v=abcdEFGhijk"


def test_course_file_fallbacks_and_broken_files(tmp_path):
    olx = Olx(tmp_path)
    olx.write("course.xml", '<course url_name="2024" org="O" course="C"/>')
    olx.write("course/2024.xml", "<course><broken")
    olx.write("policies/other_run/policy.json", "{not json")
    course = openedx.read(str(tmp_path))
    assert course.title == "C"
    assert any("course/2024.xml" in w for w in course.warnings)
    assert any("not valid JSON" in w for w in course.warnings)
    assert course.thumbnail is None


def test_policy_found_in_a_differently_named_run_folder(tmp_path):
    olx = Olx(tmp_path)
    olx.course(["ch1"])
    olx.chapter("ch1", "XML", [])
    olx.write("policies/renamed/policy.json", json.dumps({"chapter/ch1": {"display_name": "Renamed"}}))
    olx.write("policies/renamed/grading_policy.json", json.dumps({"GRADE_CUTOFFS": {"A": 0.9, "B": 0.6}}))
    reader = openedx._Reader(str(tmp_path))
    course = reader.read()
    assert [s.title for s in course.sections] == ["Renamed"]
    assert reader.pass_percent == 60.0


def test_staff_only_and_hidden_units(tmp_path):
    def comps(o):
        return (o.html("h1", "<p>Visible</p>")
                + '<html url_name="h2" visible_to_staff_only="true"><p>Answer key</p></html>')

    course = one_unit(tmp_path, comps, vert_attrs='visible_to_staff_only="true"')
    page = items(course)[0]
    assert page.visible is False
    # the staff-only component inside an already hidden unit is kept (whole unit is unpublished)
    assert len(page.parts) == 2


def test_staff_only_component_is_left_out(tmp_path):
    def setup(o):
        o.policy = {"html/h2": {"visible_to_staff_only": True}}
        o.save_policy()

    course = one_unit(tmp_path, lambda o: o.html("h1", "<p>Visible</p>") + o.html("h2", "<p>Key</p>"),
                      setup=setup)
    page = items(course)[0]
    assert len(page.parts) == 1
    # left out silently: learners never saw it, and it is not a problem with the export
    assert course.warnings == [] and course.skipped == []


def test_loose_components_and_loops(tmp_path):
    olx = Olx(tmp_path)
    olx.course(["ch1"])
    olx.block("chapter", "ch1", '<chapter display_name="Ch"><html><p>Loose in chapter</p></html>'
                                '<sequential url_name="s1"/></chapter>')
    olx.block("sequential", "s1", '<sequential display_name="S"><html><p>Loose in seq</p></html>'
                                  '<vertical url_name="v1"/><vertical url_name="missing"/></sequential>')
    olx.vertical("v1", "Loop", '<html><p>Unit text</p></html><vertical url_name="v1"/>'
                               '<problem url_name="bad"/>')
    olx.write("problem/bad.xml", "<problem><broken")
    course = openedx.read(str(tmp_path))
    titles = [i.title for i in course.sections[0].items]
    assert titles == ["Ch", "S", "Loop"]
    assert any("loops back" in w for w in course.warnings)
    assert any("Could not parse problem/bad.xml" in w for w in course.warnings)


def test_component_errors_do_not_sink_the_unit(tmp_path, monkeypatch):
    def boom(self, node, where):
        raise RuntimeError("bad video")

    monkeypatch.setattr(openedx._Reader, "_video", boom)
    course = one_unit(tmp_path, lambda o: o.html("h1", "<p>x</p>") + '<video youtube_id_1_0="abc"/>')
    assert len(items(course)[0].parts) == 1
    assert any("bad video" in w for w in course.warnings)


# ---------------------------------------------------------------------------
# HTML, assets, links
# ---------------------------------------------------------------------------


def test_asset_url_forms(tmp_path):
    olx = Olx(tmp_path)
    olx.course(["ch1"], attrs='display_name="C" course_image="images_card.png"')
    olx.chapter("ch1", "Ch", [])
    olx.write("static/My File.png", PNG)
    olx.write("static/images/card.png", PNG)
    olx.write("static/Mapped Name.pdf", PDF)
    olx.write("policies/assets.json", json.dumps({
        "mapped.pdf": {"displayname": "Mapped Name.pdf", "import_path": None},
        "broken": "x",
    }))
    reader = openedx._Reader(str(tmp_path))
    course = reader.read()
    assert course.thumbnail.path.endswith("images/card.png")
    resolve = reader.resolve
    assert resolve("/static/My_File.png").name == "My File.png"
    assert resolve("/static/My%20File.png").name == "My File.png"
    assert resolve("/c4x/TestOrg/TX101/asset/My_File.png").name == "My File.png"
    assert resolve("/asset-v1:TestOrg+TX101+2024+type@asset+block@My_File.png").name == "My File.png"
    assert resolve("https://lms.example.org/asset-v1:O+C+R+type@asset+block@mapped.pdf").name == "Mapped Name.pdf"
    assert resolve("asset-v1:O+C+R+type@asset+block@images_card.png").path.endswith("images/card.png")
    assert resolve("/static/nope.png") is None
    assert resolve("/c4x/a/b/asset/nope.png") is None
    assert resolve("https://example.org/x.png") is None


def test_html_variants(tmp_path):
    def comps(o):
        o.write("html/raw.html", "<p>Only an html file</p>")
        o.write("html/sub/named.html", "<p>Nested file name</p>")
        o.write("html/n.xml", '<html filename="sub/named"/>')
        o.write("html/gone.xml", '<html filename="does-not-exist"/>')
        o.write("html/blank.xml", '<html filename="blank"/>')
        o.write("html/blank.html", "   ")
        return ('<html url_name="raw"/><html url_name="n"/><html url_name="gone"/><html url_name="blank"/>'
                '<html url_name="nothing"/>'
                '<html><p>See <a href="/jump_to_id/abc">the next unit</a> and '
                '<a href="0123456789abcdef0123456789abcdef">this</a> and <a href="https://x.org">web</a></p></html>')

    course = one_unit(tmp_path, comps)
    parts = items(course)[0].parts
    assert [p.content.html for p in parts[:2]] == ["<p>Only an html file</p>", "<p>Nested file name</p>"]
    assert len(parts) == 3
    assert parts[2].content.html == '<p>See the next unit and this and <a href="https://x.org">web</a></p>'
    # The missing file is the only genuine problem; internal links are dropped silently
    assert course.warnings == []
    assert course.skipped == [("does-not-exist", "html component", "its HTML file is missing from the export")]


def test_annotatable(tmp_path):
    xml = ('<annotatable display_name="Poem"><instructions><p>Read</p></instructions>'
           '<p>Line with <annotation title="Note" body="Explained">a phrase</annotation> inside.</p></annotatable>')
    course = one_unit(tmp_path, xml)
    html = items(course)[0].parts[0].content.html
    assert "<mark>a phrase</mark><sup>[1]</sup> inside." in html
    assert "<li><strong>Note</strong> Explained</li>" in html
    assert "<p>Read</p>" in html


# ---------------------------------------------------------------------------
# Media components
# ---------------------------------------------------------------------------


def test_video_alone_becomes_video_item(tmp_path):
    course = one_unit(tmp_path, '<video url_name="v" display_name="Clip" youtube_id_1_0="dQw4w9WgXcQ"/>')
    item = items(course)[0]
    assert isinstance(item, ir.VideoItem)
    assert item.title == "Unit one" and item.url == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"


def test_video_sources_and_handout(tmp_path):
    def comps(o):
        o.write("static/clip.mp4", MP4)
        o.write("static/notes.pdf", PDF)
        o.block("video", "local", '<video display_name="Local" youtube_id_1_0="" '
                                  'html5_sources="[&quot;https://cdn.example.org/a.mp4&quot;, '
                                  '&quot;/static/clip.mp4&quot;]" handout="/static/notes.pdf"/>')
        return ('<video url_name="local"/>'
                '<video display_name="Remote"><source src="https://cdn.example.org/b.mp4"/></video>'
                '<video display_name="Pipeline" edx_video_id="abc-123" html5_sources="[]"/>'
                '<video display_name="Empty"/>'
                '<video display_name="Handout el" youtube="1.0:xyz"><handout src="/static/notes.pdf"/></video>')

    course = one_unit(tmp_path, comps)
    page = items(course)[0]
    kinds = [(type(p).__name__, getattr(p, "url", "") or getattr(getattr(p, "asset", None), "name", ""))
             for p in page.parts]
    assert kinds == [
        ("MediaPart", "clip.mp4"), ("FilePart", "notes.pdf"),
        ("MediaPart", "https://cdn.example.org/b.mp4"),
        ("MediaPart", "https://www.youtube.com/watch?v=xyz"), ("FilePart", "notes.pdf"),
    ]
    assert page.parts[1].title == "Local handout"
    assert course.warnings == []
    assert course.skipped == [
        ("Pipeline", "video", "hosted by the Open edX video service; no file in the export"),
        ("Empty", "video", "no source"),
    ]


def test_pdf_and_embeds(tmp_path):
    def comps(o):
        o.write("static/doc.pdf", PDF)
        return ('<pdf display_name="Remote" url="https://example.org/r.pdf"/>'
                '<pdf display_name="Missing" url="/static/missing.pdf"/>'
                '<pdf display_name="None"/>'
                '<google-document display_name="Doc" embed_code="&lt;iframe src=&quot;https://docs.google.com/'
                'document/d/x/pub?embedded=true&amp;a=1&quot;&gt;&lt;/iframe&gt;"/>'
                '<google-calendar calendar_id="abc@group.calendar.google.com"/>'
                '<iframe src="https://example.org/embed" height="300"/>'
                '<iframe display_name="Nothing"/>')

    course = one_unit(tmp_path, comps)
    parts = items(course)[0].parts
    assert parts[0].kind == ir.MediaKind.PDF and parts[0].url == "https://example.org/r.pdf"
    assert parts[1].url == "https://docs.google.com/document/d/x/pub?embedded=true&a=1"
    assert parts[2].url.startswith("https://calendar.google.com/calendar/embed?src=abc")
    assert parts[3].url == "https://example.org/embed" and parts[3].height == 300
    assert len(parts) == 4
    # A file missing from the export is a warning; empty components are only listed as skipped
    assert course.warnings == ["Unit one: PDF '/static/missing.pdf' is missing from the export"]
    assert course.skipped == [("None", "pdf", "no file"), ("Nothing", "iframe", "no address")]


def test_pdf_alone_becomes_document(tmp_path):
    course = one_unit(tmp_path, lambda o: o.write("static/doc.pdf", PDF) and '<pdf url="/static/doc.pdf"/>')
    item = items(course)[0]
    assert isinstance(item, ir.DocumentItem) and item.asset.name == "doc.pdf"


# ---------------------------------------------------------------------------
# Other components
# ---------------------------------------------------------------------------


def test_misc_components(tmp_path):
    xml = ('<html><p>Intro</p></html>'
           '<discussion display_name="Talk" discussion_target="Week 1"/>'
           '<poll display_name="Vote" question="?"/>'
           '<survey/>'
           '<done/>'
           '<mystery_xblock/>'
           '<drag-and-drop-v2 display_name="DnD" data="{}"/>'
           '<scorm display_name="Package"/>'
           '<lti_consumer lti_1p3_launch_url="https://tool.example.org/launch"/>'
           '<lti display_name="Old LTI"/>'
           '<staffgradedxblock/>'
           '<edx_sga display_name="Upload essay" points="10"/>')
    course = one_unit(tmp_path, xml, vert_attrs="")
    out = items(course)
    page = out[0]
    assert isinstance(page, ir.Page) and len(page.parts) == 1
    standalone = out[1:]
    assert [(type(i).__name__, i.title) for i in standalone] == [
        ("UnsupportedItem", "Package"), ("UnsupportedItem", "Unit one"), ("UnsupportedItem", "Old LTI"),
        ("UnsupportedItem", "Unit one"), ("AssignmentItem", "Upload essay"),
    ]
    assert "https://tool.example.org/launch" in standalone[1].reason
    assert standalone[4].points == 10 and standalone[4].allow_file
    # Nothing here is a problem with the export: every unmigrated item is listed as skipped
    assert course.warnings == []
    assert course.skipped == [
        ("Talk", "discussion", "discussions are not migrated"),
        ("Vote", "poll", "polls have no LearnHouse equivalent"),
        ("survey", "survey", "surveys have no LearnHouse equivalent"),
        ("mystery_xblock", "mystery_xblock", "no LearnHouse equivalent"),
        ("DnD", "drag and drop question", "no interactive equivalent (drag-and-drop problem without items)"),
    ]


def test_standalone_items_in_hidden_unit_with_no_title(tmp_path):
    olx = Olx(tmp_path)
    olx.course(["ch1"])
    olx.chapter("ch1", "Ch", ["s1"])
    olx.block("sequential", "s1", '<sequential><vertical visible_to_staff_only="true"><scorm/></vertical>'
                                  '</sequential>')
    course = openedx.read(str(tmp_path))
    item = course.sections[0].items[0]
    assert item.title == "Subsection" and item.visible is False
    assert openedx._DEFAULT_TITLES["scorm"] == "SCORM package"


def test_open_response_assessment(tmp_path):
    ora = """<openassessment url_name="ora1" submission_due="2025-03-01T12:00:00+00:00" text_response="required"
  file_upload_response="optional" prompts_type="html">
  <title>Essay</title>
  <assessments><assessment name="peer-assessment" must_grade="1"/><assessment name="staff-assessment"/></assessments>
  <prompts><prompt><description>&lt;p&gt;Write about &lt;b&gt;X&lt;/b&gt;&lt;/p&gt;</description></prompt></prompts>
  <rubric>
    <criterion><name>c1</name><label>Clarity</label><prompt>Clear?</prompt>
      <option points="3"><name>a</name><label>Great</label></option>
      <option points="0"><name>b</name><label>Poor</label></option>
    </criterion>
    <criterion><name>c2</name><label>Ideas</label>
      <option points="2"><name>a</name><label>Good</label></option>
    </criterion>
  </rubric>
</openassessment>"""
    course = one_unit(tmp_path, ora, graded=True,
                      setup=lambda o: o.grading({"Pass": 0.7}))
    item = items(course)[0]
    assert isinstance(item, ir.AssignmentItem)
    assert item.title == "Essay"
    assert item.due_date == "2025-03-01T12:00:00+00:00"
    assert item.allow_text and item.allow_file
    assert item.points == 5
    assert item.pass_percent == 70.0
    assert "<p>Write about <b>X</b></p>" in item.instructions.html
    assert "<strong>Clarity</strong>: Great (3), Poor (0)" in item.instructions.html
    assert course.warnings == []
    assert course.skipped == [("Essay", "assessment steps", "peer and self assessment are not migrated")]


def test_open_response_text_prompt_old_format(tmp_path):
    ora = ('<openassessment prompts_type="text" text_response="" display_name="Reflect">'
           '<prompt>Plain &lt;prompt&gt;</prompt></openassessment>'
           '<openassessment><prompts><prompt><description>A</description></prompt></prompts></openassessment>')
    course = one_unit(tmp_path, ora, seq_attrs='due="2025-01-02T00:00:00Z"')
    first, second = items(course)
    assert first.title == "Reflect" and first.instructions.html == "<p>Plain &lt;prompt&gt;</p>"
    assert first.allow_file and not first.allow_text
    assert first.due_date == "2025-01-02T00:00:00+00:00"
    assert second.title == "Unit one" and second.allow_text and not second.allow_file


def test_containers(tmp_path):
    def comps(o):
        o.problem("lib1", '<problem display_name="L1"><multiplechoiceresponse><label>Q1</label><choicegroup>'
                          '<choice correct="true">a</choice><choice correct="false">b</choice></choicegroup>'
                          '</multiplechoiceresponse></problem>')
        o.problem("lib2", '<problem display_name="L2"><stringresponse answer="x"><label>Q2</label>'
                          '<textline/></stringresponse></problem>')
        o.block("library_content", "lib", '<library_content max_count="1"><problem url_name="lib1"/>'
                                          '<problem url_name="lib2"/></library_content>')
        return ('<library_content url_name="lib"/>'
                '<library_content max_count="2"/>'
                '<conditional sources="x"><html><p>Shown</p></html></conditional>'
                '<split_test><vertical display_name="A"><html><p>Group A</p></html></vertical>'
                '<vertical display_name="B"><html><p>Group B</p></html></vertical></split_test>'
                '<split_test/>'
                '<vertical display_name="Nested"><html><p>Nested</p></html></vertical>')

    course = one_unit(tmp_path, comps)
    parts = items(course)[0].parts
    assert [type(p).__name__ for p in parts] == ["InlineQuizPart", "InlineQuizPart", "HtmlPart", "HtmlPart",
                                                 "HtmlPart"]
    assert [p.content.html for p in parts[2:]] == ["<p>Shown</p>", "<p>Group A</p>", "<p>Nested</p>"]
    # Randomization, conditions and A/B groups are resolved silently; only the empty library is listed
    assert course.warnings == []
    assert course.skipped == [("Unit one", "library content", "no problems in the export")]


# ---------------------------------------------------------------------------
# Problems
# ---------------------------------------------------------------------------


def test_multiple_choice_with_hints_and_solution(tmp_path):
    qs, _ = problem_questions(tmp_path, """<problem display_name="MC" markdown="ignored">
<multiplechoiceresponse>
  <p><img src="/static/abacus.png"/></p>
  <label>Which <b>one</b>?</label>
  <description>Pick one</description>
  <choicegroup type="MultipleChoice">
    <choice correct="false">A<choicehint>Not A</choicehint></choice>
    <choice correct="true">B</choice>
    <choice correct="partial" name="c"/>
  </choicegroup>
  <solution><div class="detailed-solution"><p>Explanation</p><p>Because B.</p></div></solution>
</multiplechoiceresponse>
<demandhint><hint>Think</hint></demandhint>
</problem>""")
    (q,) = qs
    assert q.type == ir.QType.MULTICHOICE and not q.multiple
    assert q.title == "MC" and q.id == "p1"
    assert "<b>one</b>" in q.text.html and "Pick one" in q.text.html and "abacus.png" in q.text.html
    assert "Think" not in q.text.html and "Because" not in q.text.html
    assert [(c.text.html, c.correct, c.feedback) for c in q.choices] == [
        ("A", False, "Not A"), ("B", True, ""), ("c", False, "")]
    assert "Because B." in q.general_feedback and "Explanation" not in q.general_feedback


def test_checkboxes_and_true_false(tmp_path):
    qs, _ = problem_questions(tmp_path, """<problem>
<choiceresponse partial_credit="EDC"><label>Pick all</label><checkboxgroup>
  <choice correct="true">x<choicehint selected="false">missed</choicehint>
    <choicehint selected="true">yes</choicehint></choice>
  <choice correct="false">y</choice></checkboxgroup></choiceresponse>
<choiceresponse><label>Again</label><checkboxgroup><choice correct="true">z</choice></checkboxgroup></choiceresponse>
<truefalseresponse><choicegroup label="Legacy label"><choice correct="true">t</choice></choicegroup></truefalseresponse>
<multiplechoiceresponse><label>No choices</label></multiplechoiceresponse>
</problem>""")
    assert [q.type for q in qs] == [ir.QType.MULTICHOICE] * 3 + [ir.QType.UNSUPPORTED]
    assert qs[0].multiple and qs[0].partial_credit and qs[0].choices[0].feedback == "yes"
    assert qs[1].multiple and not qs[1].partial_credit
    assert qs[2].multiple and "Legacy label" in qs[2].text.html
    assert qs[3].reason == "no choices"
    assert [q.title for q in qs] == ["Problem (1)", "Problem (2)", "Problem (3)", "Problem (4)"]
    assert [q.id for q in qs] == ["p1:1", "p1:2", "p1:3", "p1:4"]


def test_dropdowns(tmp_path):
    qs, course = problem_questions(tmp_path, """<problem>
<optionresponse><label>Capital?</label>
  <optioninput options="('Sydney','Canberra', 'O\\'Brien')" correct="Canberra"/></optionresponse>
<optionresponse><label>New style</label><optioninput>
  <option correct="False">a<optionhint>no</optionhint></option><option correct="True">b</option></optioninput>
  <optioninput options="('x')" correct="x"/>
</optionresponse>
<optionresponse><label>Empty</label></optionresponse>
</problem>""")
    assert [html_choice(q) for q in qs[:2]] == [
        [("Sydney", False), ("Canberra", True), ("O'Brien", False)],
        [("a", False), ("b", True)],
    ]
    assert qs[2].choices == []
    assert any("several dropdowns" in w for w in course.warnings)


def html_choice(q):
    return [(c.text.html, c.correct) for c in q.choices]


def test_inline_dropdowns_become_cloze(tmp_path):
    qs, _ = problem_questions(tmp_path, """<problem display_name="Table">
<p>Fill the table</p>
<table><tr><td>Relativity</td><td><optionresponse><optioninput options="('Einstein','Newton')"
  correct="Einstein"/></optionresponse></td></tr></table>
<p>Speed of light is <numericalresponse answer="3e8"><responseparam type="tolerance" default="1%"/>
  <textline/></numericalresponse> m/s and water is <stringresponse answer="H2O" type="ci"><textline/>
  </stringresponse>.</p>
<p>Bad <numericalresponse answer="pi"/> number.</p>
<solution><p>Einstein, 3e8, H2O</p></solution>
</problem>""")
    (q,) = qs
    assert q.type == ir.QType.CLOZE and q.title == "Table"
    assert "{{1}}" in q.text.html and "{{4}}" in q.text.html and "Fill the table" in q.text.html
    b = q.blanks
    assert b[0].answers == ["Einstein"] and b[0].choices == ["Einstein", "Newton"]
    assert b[1].numeric.value == 3e8 and b[1].numeric.tolerance == pytest.approx(3e6)
    assert b[1].answers == ["300000000"]
    assert b[2].answers == ["H2O"]
    assert b[3].answers == ["pi"] and b[3].numeric is None
    assert q.general_feedback == "<p>Einstein, 3e8, H2O</p>"


def test_text_input(tmp_path):
    qs, course = problem_questions(tmp_path, """<problem>
<stringresponse answer="Doc" type="ci"><label>Dwarf?</label>
  <additional_answer answer="Sleepy"/><additional_answer>Dopey</additional_answer><textline/></stringresponse>
<stringresponse answer="Exact"><textline label="Old label"/></stringresponse>
<stringresponse answer="..bble" type="ci regexp"><label>Regex</label><textline/></stringresponse>
<stringresponse answer="plain" type="regexp"><label>Literal regex</label><textline/></stringresponse>
</problem>""")
    assert [q.type for q in qs] == [ir.QType.SHORTANSWER] * 4
    assert qs[0].answers == ["Doc", "Sleepy", "Dopey"] and not qs[0].case_sensitive
    assert qs[1].case_sensitive and "Old label" in qs[1].text.html
    assert qs[2].answers == ["..bble"]
    assert qs[2].regex and not qs[0].regex
    assert all(q.wildcard is False for q in qs)


def test_numerical(tmp_path):
    qs, _ = problem_questions(tmp_path, """<problem weight="6">
<p>First</p>
<numericalresponse answer="600"><label>Abs</label><responseparam type="tolerance" default="5"/>
  <formulaequationinput/></numericalresponse>
<p>Second</p>
<numericalresponse answer="-200"><label>Pct</label><responseparam type="tolerance" default="10%"/>
  <additional_answer answer="1/4"/></numericalresponse>
<numericalresponse answer="[5, 10)"><label>Range</label></numericalresponse>
<numericalresponse answer="2*pi"><label>Expr</label></numericalresponse>
<p>Trailing note</p>
</problem>""")
    assert [q.type for q in qs] == [ir.QType.NUMERICAL] * 3 + [ir.QType.UNSUPPORTED]
    assert qs[0].numeric == [ir.NumericAnswer(600.0, 5.0)]
    assert qs[0].text.html.startswith("\n<p>First</p>")
    assert "<p>Second</p>" in qs[1].text.html and "First" not in qs[1].text.html
    assert qs[1].numeric == [ir.NumericAnswer(-200.0, 20.0), ir.NumericAnswer(0.25, 0.025)]
    assert qs[2].numeric == [ir.NumericAnswer(7.5, 2.5)]
    assert "is an expression" in qs[3].reason
    assert "Trailing note" in qs[3].text.html
    assert [q.points for q in qs] == [2.0, 2.0, 2.0, 1.0]


def test_number_helpers():
    assert openedx._number("1/0") is None
    assert openedx._number("abc") is None
    assert openedx._number(" 2.5e1 ") == 25.0
    assert openedx._fmt(2.0) == "2" and openedx._fmt(0.5) == "0.5"
    assert openedx._options("(\"a\", 'b')") == ["a", "b"]


def test_script_generated_problem_is_unsupported(tmp_path):
    xml = """<problem display_name="Random">
<script type="loncapa/python">z = 1 + 2</script>
<p>Let x = $x</p>
<numericalresponse answer="$z"><textline/></numericalresponse>
</problem>"""
    reader = openedx._Reader(str(tmp_path))
    node = openedx._Node("problem", openedx.parse_bytes(xml.encode()), {}, "p1")
    (q,) = reader._problem(node, "Unit")
    assert q.type == ir.QType.UNSUPPORTED and q.source_type == "python-script"
    assert "Let x" in q.text.html and "z = 1" not in q.text.html


@pytest.mark.parametrize("xml,reason,kept", [
    ("<formularesponse answer='x^2'><label>F</label><formulaequationinput/></formularesponse>", "symbolically",
     True),
    ("<customresponse cfn='check'><jsinput gradefn='g'/></customresponse>", "jsinput", False),
    ("<schematicresponse><schematic/></schematicresponse>", "schematic", False),
    ("<imageresponse><imageinput src='/static/a.png'/></imageresponse>", "image", False),
])
def test_unsupported_response_types(tmp_path, xml, reason, kept):
    course = one_unit(tmp_path, lambda o: o.html("h", "<p>Text</p>") + o.problem("p1", f"<problem>{xml}</problem>"))
    page = items(course)[0]
    # The prompt stays readable; only the input LearnHouse cannot grade is lost
    assert len(page.parts) == (2 if kept else 1)
    if kept:
        assert page.parts[1].content.html == "<p>F</p>"
    assert course.warnings == []
    ((title, kind, why),) = course.skipped
    tag = xml[1:].split(">")[0].split(" ")[0]
    assert title == "Problem" and kind == openedx._KIND_LABELS[tag] + " question"
    assert reason in why and ("text was kept" in why) == kept


def test_code_response(tmp_path):
    qs, course = problem_questions(tmp_path, """<problem><p>Write a function</p>
<coderesponse queuename="q"><textbox mode="Python" rows="10"/>
<codeparam><initial_display>def f():\n    pass</initial_display><answer_display>def f():\n    return 1</answer_display>
<grader_payload>{}</grader_payload></codeparam></coderesponse></problem>""")
    (q,) = qs
    assert q.type == ir.QType.CODE
    assert q.code.language == "python" and "pass" in q.code.starter_code and "return 1" in q.code.solution_code
    assert course.warnings == []  # a problem graded by an external queue arrives without tests (documented)


def test_problem_without_responses_and_empty(tmp_path):
    def comps(o):
        return (o.problem("p1", "<problem><text><p>Just reading</p></text></problem>")
                + o.problem("p2", "<problem>  </problem>"))

    course = one_unit(tmp_path, comps)
    parts = items(course)[0].parts
    assert len(parts) == 1
    assert parts[0].questions[0].type == ir.QType.DESCRIPTION


def test_problem_nested_in_containers_and_old_text_wrapper(tmp_path):
    qs, _ = problem_questions(tmp_path, """<problem>
<text>
  <div class="intro"><p>Context</p></div>
  <div><p>Q one</p><multiplechoiceresponse><choicegroup><choice correct="true">a</choice></choicegroup>
  <solution><p>Sol one</p></solution></multiplechoiceresponse>
  tail text
  </div>
  <stringresponse answer="b"><label>Q two</label><textline/></stringresponse>
</text>
<solution><p>General</p></solution>
<clarification>ignored outside</clarification>
</problem>""")
    assert [q.type for q in qs] == [ir.QType.MULTICHOICE, ir.QType.SHORTANSWER]
    assert "Context" in qs[0].text.html and "Q one" in qs[0].text.html
    assert "tail text" in qs[1].text.html
    assert qs[0].general_feedback == "<p>Sol one</p>"
    assert qs[1].general_feedback == "<p>General</p>"


def test_clarification_reads_inline(tmp_path):
    qs, _ = problem_questions(tmp_path, """<problem><numericalresponse answer="2">
<p>Use the formula<clarification>a reminder</clarification> to solve.</p><formulaequationinput/>
</numericalresponse></problem>""")
    assert "formula (a reminder) to solve" in qs[0].text.html


# ---------------------------------------------------------------------------
# Graded subsections
# ---------------------------------------------------------------------------


MC = ('<problem display_name="{name}" {attrs}><multiplechoiceresponse><label>{name}?</label><choicegroup>'
      '<choice correct="true">yes</choice><choice correct="false">no</choice></choicegroup>'
      '</multiplechoiceresponse></problem>')


def test_graded_problem_only_subsection_is_one_assessment(tmp_path):
    olx = Olx(tmp_path)
    olx.course(["ch1"])
    olx.chapter("ch1", "Week 1", ["hw"])
    olx.sequential("hw", "Homework 1", ["v1", "v2"],
                   'graded="true" format="Homework" due="2025-05-01T23:59:00Z" is_time_limited="true" '
                   'default_time_limit_minutes="30"')
    olx.vertical("v1", "Q1", olx.problem("p1", MC.format(name="One", attrs='max_attempts="2" showanswer="never"')))
    olx.vertical("v2", "Q2", olx.problem("p2", MC.format(name="Two", attrs='max_attempts="3" showanswer="never"')))
    olx.grading({"Pass": 0.5})
    course = openedx.read(str(tmp_path))
    (item,) = course.sections[0].items
    assert isinstance(item, ir.Assessment)
    assert item.title == "Homework 1" and item.id == "sequential/hw"
    assert [q.title for q in item.questions] == ["One", "Two"]
    assert item.due_date == "2025-05-01T23:59:00+00:00"
    assert item.max_attempts == 3 and item.show_correct_answers is False
    assert item.pass_percent == 50.0 and item.time_limit_minutes == 30 and item.graded


def test_graded_attempts_inherited_and_unlimited(tmp_path):
    def setup(o):
        o.policy = {"course/2024": {"max_attempts": None}, "sequential/seq1": {"due": "2025-02-02"}}
        o.save_policy()

    course = one_unit(tmp_path, lambda o: o.problem("p1", MC.format(name="One", attrs="")), graded=True,
                      setup=setup)
    (item,) = items(course)
    assert item.max_attempts == 0 and item.show_correct_answers
    assert item.due_date == "2025-02-02T00:00:00+00:00"


def test_graded_mixed_unit(tmp_path):
    def comps(o):
        return (o.html("h1", "<p>Read this first</p>")
                + o.problem("p1", MC.format(name="One", attrs=""))
                + o.html("h2", "<p>Between</p>")
                + o.html("h3", "<p>&nbsp;</p>")
                + '<video display_name="After" youtube_id_1_0="after1"/>'
                + o.problem("p2", MC.format(name="Two", attrs=""))
                + '<edx_sga/>')

    course = one_unit(tmp_path, comps, graded=True)
    out = items(course)
    assert [type(i).__name__ for i in out] == ["Assessment", "VideoItem", "AssignmentItem"]
    a = out[0]
    assert a.intro.html == "<p>Read this first</p>"
    assert [q.type for q in a.questions] == [ir.QType.MULTICHOICE, ir.QType.DESCRIPTION, ir.QType.MULTICHOICE]
    assert out[1].url.endswith("after1")
    assert out[2].title == "Unit one" and out[2].due_date is None


def test_graded_unit_with_media_before_problems(tmp_path):
    def comps(o):
        return ('<video youtube_id_1_0="intro1"/>' + o.html("h1", "<p>Then text</p>")
                + o.problem("p1", MC.format(name="One", attrs="")))

    course = one_unit(tmp_path, comps, graded=True)
    page, assessment = items(course)
    assert isinstance(page, ir.Page) and page.id == "vertical/v1:intro" and len(page.parts) == 2
    assert isinstance(assessment, ir.Assessment) and assessment.intro.is_empty()


def test_graded_unit_without_gradable_problems_is_a_page(tmp_path):
    course = one_unit(tmp_path, lambda o: o.html("h", "<p>Info</p>") + o.problem(
        "p1", "<problem><customresponse/></problem>"), graded=True)
    (page,) = items(course)
    assert isinstance(page, ir.Page) and len(page.parts) == 1


def test_unit_with_only_unsupported_problem_disappears(tmp_path):
    course = one_unit(tmp_path, lambda o: o.problem("p1", "<problem><customresponse/></problem>"))
    assert items(course) == []


def test_ungraded_problems_stay_in_the_page(tmp_path):
    course = one_unit(tmp_path, lambda o: o.html("h", "<p>Info</p>") + o.problem(
        "p1", MC.format(name="Check", attrs="")))
    (page,) = items(course)
    quiz = page.parts[1]
    assert isinstance(quiz, ir.InlineQuizPart) and quiz.title == "Check"


# ---------------------------------------------------------------------------
# Course pages
# ---------------------------------------------------------------------------


def test_course_pages(tmp_path):
    olx = Olx(tmp_path)
    olx.course([])
    olx.policy = {"course/2024": {"tabs": [
        {"type": "courseware", "name": "Course"},
        {"type": "static_tab", "name": "Syllabus", "url_slug": "syl"},
        {"type": "static_tab", "name": "Staff notes", "url_slug": "staff", "course_staff_only": True},
        {"type": "static_tab", "name": "Gone", "url_slug": "gone"},
        "junk",
    ]}}
    olx.save_policy()
    olx.write("tabs/syl.html", "<p>Syllabus body</p>")
    olx.write("tabs/staff.html", "<p>Staff</p>")
    olx.write("tabs/extra_page.html", "<p>Orphan</p>")
    olx.write("tabs/empty.html", "  ")
    olx.write("info/handouts.html", "<ol><li><a href='/static/h.pdf'>Handout</a></li></ol>")
    olx.write("info/updates.items.json", json.dumps([
        {"date": "May 1", "content": "<p>Welcome</p>", "status": "visible"},
        {"date": "May 2", "content": "<p>Removed</p>", "status": "deleted"},
        {"content": "<p>Undated</p>"},
        "junk",
    ]))
    course = openedx.read(str(tmp_path))
    (pages,) = course.sections
    assert [(p.title, p.visible) for p in pages.items] == [
        ("Syllabus", True), ("Staff notes", False), ("Extra page", True), ("Course handouts", True),
        ("Course updates", True),
    ]
    updates = pages.items[-1].parts[0].content.html
    assert updates == "<h3>May 1</h3><p>Welcome</p><p>Undated</p>"
    assert any("'Gone' is missing" in w for w in course.warnings)


def test_course_pages_fallbacks(tmp_path):
    olx = Olx(tmp_path)
    olx.course([])
    olx.write("about/overview.html", "<p>Only overview</p>")
    olx.write("info/handouts.html", "<ol></ol>")
    olx.write("info/updates.html", "<section><p>Old updates</p></section>")
    course = openedx.read(str(tmp_path))
    assert course.summary.html == "<p>Only overview</p>"
    assert [p.title for p in course.sections[0].items] == ["Course updates"]


def test_ctx_helpers():
    ctx = openedx._Ctx().child({"max_attempts": "null", "showanswer": "Never"})
    assert ctx.max_attempts is None and ctx.showanswer == "never"
    assert openedx._Ctx().child({"max_attempts": "4"}).max_attempts == 4
    assert openedx._json("[1]", None) == [1] and openedx._json(5, "d") == "d"
    assert openedx._read_text(None) == "" and openedx._read_text("/nonexistent/file") == ""


def test_edge_branches(tmp_path):
    # Three wrapper folders deep is too far to look for course.xml
    Olx(tmp_path / "a" / "b" / "c").course()
    assert openedx.detect(str(tmp_path)) == 0
    assert openedx._inner(None) == "" and openedx._json([1], None) == [1]
    assert openedx._has_content("<table></table>") and not openedx._has_content("<p>&nbsp;</p>")

    root = tmp_path / "x"
    olx = Olx(root)
    olx.course(["broken", "ch1"])
    olx.write("chapter/broken.xml", "<chapter")
    olx.chapter("ch1", "Ch", ["s1"])
    olx.sequential("s1", "S", ["v1"])
    olx.vertical("v1", "V", '<video source="/static/deep/clip.mp4"/><html><p>x</p></html>')
    olx.write("static/deep/clip.mp4", MP4)
    olx.write("static/other/unique-name.png", PNG)
    reader = openedx._Reader(str(root))
    course = reader.read()
    assert [s.title for s in course.sections] == ["Ch"]
    assert course.sections[0].items[0].parts[0].asset.name == "clip.mp4"
    found = reader.resolve("/asset-v1:O+C+R+type@asset+block@unique-name.png")
    assert found is not None and found.name == "unique-name.png"


def test_oversized_files_are_ignored(tmp_path, monkeypatch):
    monkeypatch.setattr(openedx, "MAX_FILE_BYTES", 10)
    p = tmp_path / "big.xml"
    p.write_text("<course url_name='x'/>")
    assert openedx._parse_path(str(p)) is None
    assert openedx._read_text(str(p)) == ""


# ---------------------------------------------------------------------------
# End to end
# ---------------------------------------------------------------------------


def test_convert_tar_gz_end_to_end(tmp_path):
    from src.services.courses.lms_import.convert import convert

    src = tmp_path / "export" / "course"
    olx = Olx(src)
    olx.course(["ch1"], attrs='display_name="E2E course" course_image="card.png"')
    olx.write("static/card.png", PNG)
    olx.write("static/diagram.png", PNG)
    olx.write("about/short_description.html", "An end to end course")
    olx.chapter("ch1", "Week 1", ["lesson", "hw"])
    olx.sequential("lesson", "Lesson", ["v1", "v2"])
    olx.vertical("v1", "Reading", olx.html("h1", "<p>Look <img src='/static/diagram.png'/></p>")
                 + olx.problem("check", MC.format(name="Self check", attrs="")))
    olx.vertical("v2", "Watch", '<video display_name="Talk" youtube_id_1_0="dQw4w9WgXcQ"/>')
    olx.sequential("hw", "Homework", ["v3"], 'graded="true" format="Homework" due="2030-01-01T00:00:00Z"')
    olx.vertical("v3", "Problems", olx.problem("p1", MC.format(name="Graded", attrs=""))
                 + olx.problem("p2", '<problem><numericalresponse answer="4"><label>2+2</label>'
                                     '<responseparam type="tolerance" default="0"/></numericalresponse></problem>'))
    olx.grading({"Pass": 0.6})
    tgz = tmp_path / "course.tar.gz"
    with tarfile.open(tgz, "w:gz") as tf:
        tf.add(str(src), arcname="course")

    result = convert(str(tgz), str(tmp_path / "out"))
    assert result.course.source == "openedx"
    assert result.course.title == "E2E course"
    counts = result.report.counts
    assert counts["chapters"] == 1
    assert counts["TYPE_DYNAMIC"] == 1 and counts["TYPE_VIDEO"] == 1 and counts["TYPE_ASSIGNMENT"] == 1
    manifest = json.loads((tmp_path / "out" / "manifest.json").read_text())
    assert manifest["source"]["lms"] == "openedx"
    assignments = list((tmp_path / "out").rglob("assignment.json"))
    assert len(assignments) == 1
    data = json.loads(assignments[0].read_text())
    assert data["assignment"]["due_date"] == "2030-01-01T00:00:00+00:00"
    assert data["assignment"]["pass_threshold_percentage"] == 60.0
    course_json = next((tmp_path / "out").rglob("course.json"))
    assert json.loads(course_json.read_text())["thumbnail_image"]


# ---------------------------------------------------------------------------
# Regressions found on real exports
# ---------------------------------------------------------------------------


def test_git_course_with_course_xml_symlink_dropped(tmp_path):
    # MITx git repos: course.xml -> roots/2013_Spring.xml; archive extraction drops the symlink
    olx = Olx(tmp_path / "course", run="2013_Spring")
    olx.write("roots/2013_Spring.xml", '<course url_name="2013_Spring" org="HarvardX" course="ER22x"/>')
    olx.write("roots/notes.txt", "x")
    olx.write("course/2013_Spring.xml", '<course display_name="From roots"/>')
    assert openedx.detect(str(tmp_path)) == 100
    assert openedx.read(str(tmp_path)).title == "From roots"
    (tmp_path / "course" / "roots" / "2013_Spring.xml").write_text("<course/>")
    assert openedx.detect(str(tmp_path)) == 0


def test_old_sequence_children_are_units_of_their_own(tmp_path):
    olx = Olx(tmp_path)
    olx.course(["ch1"])
    olx.block("chapter", "ch1", '<chapter display_name="Ch"><vertical display_name="Direct unit">'
                                '<html><p>In a vertical under the chapter</p></html></vertical>'
                                '<videosequence url_name="vs"/></chapter>')
    olx.block("videosequence", "vs", '<videosequence display_name="Lecture">'
                                     '<problem url_name="p1"/><problem url_name="p2"/><html><p>Notes</p></html>'
                                     '<problem url_name="gone"/></videosequence>')
    olx.problem("p1", MC.format(name="First", attrs=""))
    olx.problem("p2", MC.format(name="Second", attrs=""))
    course = openedx.read(str(tmp_path))
    assert [(type(i).__name__, i.title) for i in course.sections[0].items] == [
        ("Page", "Direct unit"), ("Page", "First"), ("Page", "Second"), ("Page", "Lecture")]
    assert course.sections[0].items[1].id == "vertical/problem-p1"


def test_draft_only_units_are_imported_hidden(tmp_path):
    olx = Olx(tmp_path)
    olx.course(["ch1"])
    olx.chapter("ch1", "Ch", ["seq1"])
    olx.sequential("seq1", "Seq", ["v1", "v2", "v3"])  # v3 is listed but only exists as a draft
    olx.vertical("v1", "Published one", "<html><p>1</p></html>")
    olx.vertical("v2", "Published two", "<html><p>2</p></html>")
    parent = "block-v1:O+C+R+type@sequential+block@seq1"
    olx.write("drafts/vertical/v3.xml", f'<vertical parent_url="{parent}" index_in_children_list="2" '
                                        'display_name="Stale draft"><html><p>3</p></html></vertical>')
    olx.write("drafts/vertical/v1.xml", f'<vertical parent_url="{parent}" index_in_children_list="0" '
                                        'display_name="Edited copy"><html><p>draft</p></html></vertical>')
    olx.write("drafts/vertical/new.xml", f'<vertical parent_url="{parent}" index_in_children_list="1" '
                                         'display_name="Never published"><html url_name="dh"/></vertical>')
    olx.write("drafts/html/dh.xml", '<html filename="dh"/>')
    olx.write("html/dh.html", "<p>Draft html</p>")
    olx.write("drafts/vertical/orphan.xml", '<vertical display_name="No parent"/>')
    olx.write("drafts/vertical/old.xml", '<vertical parent_sequential_url="i4x://O/C/sequential/other" '
                                         'display_name="Elsewhere"><html><p>x</p></html></vertical>')
    olx.write("drafts/vertical/broken.xml", "<vertical")
    course = openedx.read(str(tmp_path))
    items = course.sections[0].items
    assert [(i.title, i.visible) for i in items] == [
        ("Published one", True), ("Never published", False), ("Published two", True)]  # no "Stale draft"
    assert items[1].parts[0].content.html == "<p>Draft html</p>"
    # importing the draft hidden is the expected outcome, not a warning
    assert course.warnings == [] and course.skipped == []


def test_broken_sequence_and_component_files_are_skipped(tmp_path):
    """A subsection file or a component placed straight in a subsection that
    does not parse is reported and left out; the rest of the chapter imports."""
    olx = Olx(tmp_path)
    olx.course(["ch1"])
    olx.chapter("ch1", "Ch", ["bad", "s1"])
    olx.write("sequential/bad.xml", "<sequential")
    olx.block("sequential", "s1", '<sequential display_name="S"><problem url_name="broken"/>'
                                  "<html><p>Loose in seq</p></html></sequential>")
    olx.write("problem/broken.xml", "<problem><broken")
    course = openedx.read(str(tmp_path))
    assert [i.title for i in course.sections[0].items] == ["S"]
    assert sorted(w.split(";")[0] for w in course.warnings) == [
        "Could not parse problem/broken.xml", "Could not parse sequential/bad.xml"]


@pytest.mark.parametrize("raw,expected", [
    ("null", None), ("false", None), ("", None), (None, None), ('"2025-02-03T04:05:00+00:00"',
                                                                 "2025-02-03T04:05:00+00:00"),
    ("Feb 20, 2020, 17:00", "2020-02-20T17:00:00+00:00"), ("2019-05-29T17:00", "2019-05-29T17:00:00+00:00"),
    ("9999-01-01T00:00:00", None), ("2114-02-24T21:30", None), ("whenever", None),
])
def test_due_dates(raw, expected):
    assert openedx._due(raw) == expected


def test_due_placeholders_in_real_layouts(tmp_path):
    ora = ('<openassessment submission_due="2029-01-01T00:00:00"><prompts><prompt><description>Write'
           '</description></prompt></prompts></openassessment>')
    course = one_unit(tmp_path, ora, graded=True, seq_attrs='due="null"')
    assert items(course)[0].due_date is None


def test_lti_launch_url_is_trimmed(tmp_path):
    course = one_unit(tmp_path, '<lti launch_url=" https://tool.example.org/launch "/>')
    assert items(course)[0].reason.endswith("(https://tool.example.org/launch)")


def test_formula_with_script_reports_formula_reason(tmp_path):
    xml = ('<problem><script type="loncapa/python">I = "m*c^2"</script><text><p>E =</p>'
           '<formularesponse answer="$I"><textline/></formularesponse></text></problem>')
    course = one_unit(tmp_path, lambda o: o.problem("p1", xml))
    assert course.warnings == []
    assert any(k == "formula question" and "math expressions are graded symbolically" in r
               for _t, k, r in course.skipped)


def test_single_inline_input_stays_native(tmp_path):
    qs, _ = problem_questions(tmp_path, """<problem><text>
<p>Enter the value of Pi: <numericalresponse answer="3.14159"><responseparam type="tolerance" default="5%"/>
<textline/></numericalresponse></p>
<p>Name it: <stringresponse answer="pi" type="ci"><textline/></stringresponse></p></text></problem>""")
    assert [q.type for q in qs] == [ir.QType.NUMERICAL, ir.QType.SHORTANSWER]
    assert qs[0].numeric[0].tolerance == pytest.approx(0.1570795)
    assert "Enter the value of Pi" in qs[0].text.html and "Name it" in qs[1].text.html


def test_two_inputs_in_one_sentence_are_a_cloze(tmp_path):
    qs, _ = problem_questions(tmp_path, '<problem><p><stringresponse answer="a"><textline/></stringresponse> and '
                                        '<numericalresponse answer="2"><textline/></numericalresponse></p></problem>')
    assert [q.type for q in qs] == [ir.QType.CLOZE]


def test_ora_prompt_type_detection(tmp_path):
    ora = ('<openassessment><prompts><prompt><description>Line one\n  wrapped.\n\nSecond &amp; last'
           '</description></prompt><prompt><description>&lt;p&gt;Already &lt;b&gt;HTML&lt;/b&gt;&lt;/p&gt;'
           '</description></prompt></prompts></openassessment>')
    course = one_unit(tmp_path, ora)
    assert items(course)[0].instructions.html == ("<p>Line one wrapped.</p><p>Second &amp; last</p>"
                                                  "<p>Already <b>HTML</b></p>")


def test_pipeline_video_encodings(tmp_path):
    comps = ('<video display_name="Hosted" edx_video_id="abc" html5_sources="[]"><video_asset>'
             '<encoded_video profile="hls" url="https://cdn.example.org/a.m3u8"/>'
             '<encoded_video profile="mobile_low" url="https://cdn.example.org/low.mp4"/>'
             '<encoded_video profile="desktop_mp4" url="https://cdn.example.org/hd.mp4"/>'
             '</video_asset></video>'
             '<video edx_video_id="def"><video_asset><encoded_video profile="youtube" url="ytID123"/>'
             '</video_asset></video>')
    course = one_unit(tmp_path, comps)
    assert [p.url for p in items(course)[0].parts] == ["https://cdn.example.org/hd.mp4",
                                                        "https://www.youtube.com/watch?v=ytID123"]


def test_library_sourced_without_children(tmp_path):
    course = one_unit(tmp_path, '<html><p>x</p></html><library_sourced url_name="ls"/>')
    assert course.warnings == []
    assert course.skipped == [("Unit one", "library content", "no problems in the export")]


DND = {
    "feedback": {"start": "Drag the items onto the image above.", "finish": "Done"},
    "targetImg": "/static/brain.png", "targetImgDescription": "A brain",
    "zones": [{"uid": "z1", "title": "Frontal"}, {"uid": "z2", "title": "Parietal"},
              {"uid": "z3", "title": "<b>Unused</b>"}],
    "items": [
        {"displayName": "Planning", "zones": ["z1"]},
        {"displayName": "", "imageDescription": "Touch icon", "zones": ["z2", "z1"]},
        {"displayName": "Decoy", "zones": []},
        {"zones": ["z1"]},
        "junk",
    ],
}


def test_drag_and_drop_becomes_matching(tmp_path):
    data = json.dumps(DND).replace("&", "&amp;").replace('"', "&quot;").replace("<", "&lt;")
    course = one_unit(tmp_path, lambda o: o.write("static/brain.png", PNG) and
                      f'<drag-and-drop-v2 url_name="d1" display_name="Brain" data="{data}"/>')
    quiz = items(course)[0].parts[0]
    (q,) = quiz.questions
    assert q.type == ir.QType.MATCHING and q.title == "Brain"
    assert [(p.prompt.html, p.answer) for p in q.pairs] == [
        ("Planning", "Frontal"), ("Touch icon", "Parietal"), ("Item 4", "Frontal")]
    assert q.distractors == ["Unused"]
    assert "Drag the items" in q.text.html and 'src="/static/brain.png"' in q.text.html
    assert q.text.resolve("/static/brain.png").name == "brain.png"
    assert course.warnings == []
    assert course.skipped == [("Brain", "drag and drop question", "items fitting several zones keep only the first")]


def test_drag_and_drop_old_format_and_broken(tmp_path):
    old = json.dumps({"zones": [{"id": "a", "title": "Top"}], "items": [{"displayName": "x", "zone": "a"},
                                                                        {"displayName": "y", "zone": "none"}]})
    old = old.replace('"', "&quot;")
    xml = (f'<drag-and-drop-v2 display_name="Old" question_text="Place it" data="{old}"/>'
           '<drag-and-drop-v2 display_name="Empty" data="{&quot;items&quot;: [{&quot;zones&quot;: []}]}"/>'
           '<drag-and-drop-v2 display_name="List" data="[1, 2]"/>')
    course = one_unit(tmp_path, xml)
    parts = items(course)[0].parts
    assert len(parts) == 1
    (q,) = parts[0].questions
    assert [(p.prompt.html, p.answer) for p in q.pairs] == [("x", "Top")]
    assert q.text.html == "<p>Place it</p>"
    assert course.warnings == []
    assert course.skipped == [
        ("Empty", "drag and drop question", "no interactive equivalent (drag-and-drop problem without items)"),
        ("List", "drag and drop question", "no interactive equivalent (drag-and-drop problem without items)")]


def test_choices_without_a_correct_answer_are_left_out(tmp_path):
    xml = ('<problem><p>1) Good</p><multiplechoiceresponse><choicegroup><choice correct="true">T</choice>'
           '<choice correct="false">F</choice></choicegroup></multiplechoiceresponse><p>2) Broken</p>'
           '<multiplechoiceresponse><choicegroup><choice correct="false">T</choice></choicegroup>'
           '</multiplechoiceresponse></problem>')
    qs, _ = problem_questions(tmp_path, xml)
    assert [q.type for q in qs] == [ir.QType.MULTICHOICE, ir.QType.UNSUPPORTED]
    assert qs[1].reason == "no choice is marked correct"


def test_asset_names_with_dashes_and_course_links(tmp_path):
    def comps(o):
        o.write("static/Activity 3.6.1 - Data Set Reports.pdf", PDF)
        return ('<html><p><a href="/static/Activity_3.6.1___Data_Set_Reports.pdf">PDF</a> '
                '<a href="/course/courseware/chapter/sequential/">Unit</a> '
                '<a href="/courses/course-v1:O+C+R/discussion/forum">Forum</a></p></html>')

    course = one_unit(tmp_path, comps)
    html = items(course)[0].parts[0].content
    assert html.resolve("/static/Activity_3.6.1___Data_Set_Reports.pdf").name == "Activity 3.6.1 - Data Set Reports.pdf"
    assert 'href="/course' not in html.html and "Unit" in html.html and "Forum" in html.html


def test_old_youtube_id_attribute(tmp_path):
    comps = ('<video display_name="Talk" youtube_id="1.00:3DuXOWlmbAx9M"/>'
             '<video display_name="Bare" youtube_id="abcdefghijk"/>')
    course = one_unit(tmp_path, comps)
    assert [p.url for p in items(course)[0].parts] == ["https://www.youtube.com/watch?v=uXOWlmbAx9M",
                                                        "https://www.youtube.com/watch?v=abcdefghijk"]


def test_unit_of_script_graded_problems_keeps_its_text(tmp_path):
    xml = ('<problem display_name="Basic Usage"><p>Enter <code>x^2</code></p>'
           '<customresponse cfn="grader"><textline/></customresponse>'
           '<solution><p>Any equivalent form works.</p></solution></problem>')
    course = one_unit(tmp_path, lambda o: o.problem("p1", xml))
    (page,) = items(course)
    assert page.parts[0].content.html == ("<h3>Basic Usage</h3><p>Enter <code>x^2</code></p>"
                                          "<p>Any equivalent form works.</p>")


def test_unit_beyond_the_depth_limit_is_skipped(tmp_path, monkeypatch):
    monkeypatch.setattr(openedx, "MAX_DEPTH", 2)  # chapter and subsection fill the stack
    course = one_unit(tmp_path, '<html><p>Deep</p></html>')
    assert items(course) == []  # the unit is gone, the course is otherwise intact
    assert any("Nested vertical 'v1'" in w and "too deep" in w for w in course.warnings)
