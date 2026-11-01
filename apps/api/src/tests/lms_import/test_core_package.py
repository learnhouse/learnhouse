"""package: IR course -> LearnHouse course package on disk."""

from __future__ import annotations

import json
import os
import subprocess
import zipfile

import pytest
from PIL import Image

from src.services.courses.lms_import import ir, package
from src.services.courses.lms_import.ir import (
    Asset,
    Assessment,
    AssignmentItem,
    Blank,
    Choice,
    CodePart,
    Course,
    DocumentItem,
    EmbedPart,
    FilePart,
    FlashcardsPart,
    HeadingPart,
    HtmlPart,
    InlineQuizPart,
    LinkPart,
    MathPart,
    MediaKind,
    MediaPart,
    NumericAnswer,
    Page,
    Question,
    QType,
    RichText,
    ScormItem,
    Section,
    UnsupportedItem,
    VideoItem,
)
from src.services.courses.lms_import.package import ConvertOptions, PackageWriter, zip_directory
from src.services.courses.lms_import.report import ConversionReport
from src.tests.lms_import.test_core_html_to_tiptap import assert_valid_doc

# ---------------------------------------------------------------------------
# Fixture files
# ---------------------------------------------------------------------------

PDF = b"%PDF-1.4\n%fake\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"
MP4 = b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom" + b"\x00" * 64
WEBM = b"\x1aE\xdf\xa3" + b"\x00" * 64
MP3 = b"ID3\x03\x00" + b"\x00" * 64
OGG = b"OggS" + b"\x00" * 64
WAV = b"RIFF\x24\x00\x00\x00WAVEfmt " + b"\x00" * 32


class Files:
    def __init__(self, root):
        self.root = root
        os.makedirs(root, exist_ok=True)

    def raw(self, name: str, data: bytes) -> Asset:
        path = os.path.join(self.root, name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(data)
        return Asset(path=path, name=os.path.basename(name))

    def image(self, name: str, fmt: str = "PNG", size=(40, 20)) -> Asset:
        path = os.path.join(self.root, name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        Image.new("RGB", size, (255, 0, 0)).save(path, fmt)
        return Asset(path=path, name=os.path.basename(name))

    def missing(self, name: str) -> Asset:
        return Asset(path=os.path.join(self.root, "nope", name), name=name)

    def scorm(self, name: str, manifest: str | None, *, prefix: str = "", extra: dict | None = None) -> Asset:
        path = os.path.join(self.root, name)
        with zipfile.ZipFile(path, "w") as zf:
            if manifest is not None:
                zf.writestr(prefix + "imsmanifest.xml", manifest)
            zf.writestr(prefix + "index.html", "<html>sco</html>")
            for k, v in (extra or {}).items():
                zf.writestr(k, v)
        return Asset(path=path, name=name)

    def resolver(self, mapping: dict[str, Asset]):
        return lambda url: mapping.get(url)


SCORM12 = """<?xml version="1.0"?>
<manifest identifier="m" xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
          xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2">
  <metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>
  <organizations default="org1">
    <organization identifier="other"><item identifier="x" identifierref="res_other"><title>Wrong</title></item>
    </organization>
    <organization identifier="org1"><title>Course</title>
      <item identifier="folder"><title>Folder</title>
        <item identifier="item1" identifierref="missing_res"><title>Broken</title></item>
        <item identifier="item2" identifierref="res_nohref"><title>No href</title></item>
        <item identifier="item3" identifierref="res1" parameters="lang=en"><title> Lesson 1 </title></item>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="res_other" type="webcontent" adlcp:scormtype="sco" href="other.html"/>
    <resource identifier="res_nohref" type="webcontent" adlcp:scormtype="asset"/>
    <resource identifier="res1" type="webcontent" adlcp:scormtype="sco" href="index.html"/>
  </resources>
</manifest>"""

SCORM2004 = """<?xml version="1.0"?>
<manifest identifier="m" xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
          xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3">
  <metadata><schema>ADL SCORM</schema><schemaversion>2004 4th Edition</schemaversion></metadata>
  <organizations default="o"><organization identifier="o">
    <item identifier="i1" identifierref="r1" parameters="?a=1"><title>Unit</title></item>
  </organization></organizations>
  <resources><resource identifier="r1" adlcp:scormType="sco" href="index.html"/></resources>
</manifest>"""

SCORM_RESOURCES_ONLY = """<manifest><metadata><schemaversion>CAM 1.3</schemaversion></metadata>
  <resources><resource identifier="a" scormtype="asset" href="a.html"/>
  <resource identifier="r" scormType="sco" href="index.html"/></resources></manifest>"""

SCORM_NO_SCO = """<manifest><organizations><organization identifier="o"><item identifier="i"/></organization>
  </organizations><resources><resource identifier="r" href="x.html"/></resources></manifest>"""


# ---------------------------------------------------------------------------
# Package reader
# ---------------------------------------------------------------------------


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


class Pkg:
    def __init__(self, out_dir):
        self.dir = out_dir
        self.manifest = load(os.path.join(out_dir, "manifest.json"))
        self.course_dir = os.path.join(out_dir, self.manifest["courses"][0]["path"])
        self.course = load(os.path.join(self.course_dir, "course.json"))
        self.chapters = []
        chapters_dir = os.path.join(self.course_dir, "chapters")
        for key in os.listdir(chapters_dir) if os.path.isdir(chapters_dir) else []:
            cdir = os.path.join(chapters_dir, key)
            chapter = load(os.path.join(cdir, "chapter.json"))
            chapter["_dir"] = cdir
            acts = []
            adir = os.path.join(cdir, "activities")
            for akey in os.listdir(adir) if os.path.isdir(adir) else []:
                p = os.path.join(adir, akey)
                if not os.path.exists(os.path.join(p, "activity.json")):
                    acts.append({"_dir": p, "_orphan": True})
                    continue
                a = load(os.path.join(p, "activity.json"))
                a["_dir"] = p
                if os.path.exists(os.path.join(p, "assignment.json")):
                    a["_assignment"] = load(os.path.join(p, "assignment.json"))
                blocks = {}
                bdir = os.path.join(p, "blocks")
                for bkey in os.listdir(bdir) if os.path.isdir(bdir) else []:
                    blocks[bkey] = load(os.path.join(bdir, bkey, "block.json"))
                a["_blocks"] = blocks
                acts.append(a)
            chapter["activities"] = sorted(acts, key=lambda a: a.get("order", -1))
            self.chapters.append(chapter)
        self.chapters.sort(key=lambda c: c["order"])

    def activities(self):
        return [a for c in self.chapters for a in c["activities"]]

    def by_name(self, name):
        found = [a for a in self.activities() if a.get("name") == name]
        assert found, f"no activity named {name!r}: {[a.get('name') for a in self.activities()]}"
        return found

    def one(self, name):
        found = self.by_name(name)
        assert len(found) == 1
        return found[0]


def write(course, tmp_path, name="pkg", **opts) -> tuple[Pkg, ConversionReport]:
    report = ConversionReport(source=course.source, course_title=course.title)
    out = str(tmp_path / name)
    result = PackageWriter(course, out, ConvertOptions(**opts), report).write()
    assert result == os.path.realpath(out)
    pkg = Pkg(out)
    for a in pkg.activities():
        assert not a.get("_orphan"), f"activity dir without activity.json: {a['_dir']}"
        if a["activity_type"] == "TYPE_DYNAMIC":
            assert_valid_doc(a["content"])
    assert not os.path.exists(os.path.join(out, ".scratch"))
    return pkg, report


def media_file(activity, node):
    bo = node["attrs"]["blockObject"]
    block = activity["_blocks"][bo["block_uuid"]]
    folder = package._BLOCK_FOLDERS[{"BLOCK_IMAGE": MediaKind.IMAGE, "BLOCK_VIDEO": MediaKind.VIDEO,
                                      "BLOCK_AUDIO": MediaKind.AUDIO,
                                      "BLOCK_DOCUMENT_PDF": MediaKind.PDF}[block["block_type"]]][0]
    path = os.path.join(activity["_dir"], "files", "dynamic", "blocks", folder, bo["block_uuid"],
                        f"{bo['content']['file_id']}.{bo['content']['file_format']}")
    assert os.path.isfile(path), path
    return path, block


def course_with(*items, sections=None, **kw) -> Course:
    return Course(title=kw.pop("title", "Test course"), source=kw.pop("source", "moodle"), id=kw.pop("id", "c1"),
                  sections=sections or [Section(title="S1", items=list(items), id="s1")], **kw)


def mc(text="Pick", correct=(0,), n=3, **kw):
    return Question(type=QType.MULTICHOICE, text=RichText(text),
                    choices=[Choice(RichText(f"o{i}"), i in correct) for i in range(n)], **kw)


# ---------------------------------------------------------------------------
# Manifest, course, chapters
# ---------------------------------------------------------------------------


def test_manifest_course_and_chapter_shapes(tmp_path):
    files = Files(str(tmp_path / "src"))
    thumb = files.image("thumb.jpeg", "JPEG")
    course = course_with(
        Page(title="P", parts=[HtmlPart(RichText("<p>hi</p>"))], id="p1"),
        title="Intro to X", short_name="X101", language="fr", thumbnail=thumb, tags=[" a ", "", "b"],
        learnings=["Learn A", "  ", "Learn B" * 100], summary=RichText("<p>First. Second sentence.</p>"),
        warnings=["reader said hi"],
    )
    pkg, report = write(course, tmp_path)
    m = pkg.manifest
    assert m["format"] == "learnhouse-course-export" and m["version"] == "1.0.0"
    assert m["source"] == {"lms": "moodle", "id": "c1"}
    assert m["courses"][0]["name"] == "Intro to X"
    assert m["courses"][0]["course_uuid"] == pkg.course["course_uuid"]
    assert m["courses"][0]["path"] == f"courses/{pkg.course['course_uuid']}"
    assert "created_at" in m

    c = pkg.course
    assert c["name"] == "Intro to X"
    assert c["description"] == "First. Second sentence." == c["about"]
    assert c["tags"] == "a,b"
    learnings = json.loads(c["learnings"])
    assert [x["text"] for x in learnings] == ["Learn A", ("Learn B" * 100)[:300]]
    assert all(x["emoji"] == "✅" and x["id"].startswith("learning_") for x in learnings)
    assert c["thumbnail_image"].endswith(".jpg")
    assert os.path.isfile(os.path.join(pkg.course_dir, "thumbnails", c["thumbnail_image"]))
    assert c["public"] is False and c["published"] is False
    assert c["extra_metadata"]["lms_import"] == {"source": "moodle", "source_id": "c1", "short_name": "X101",
                                                 "language": "fr"}

    ch = pkg.chapters[0]
    assert ch["name"] == "S1" and ch["order"] == 0 and ch["description"] == ""
    assert ch["extra_metadata"] == {"lms_import": {"source_id": "s1"}}
    act = ch["activities"][0]
    assert act["activity_type"] == "TYPE_DYNAMIC" and act["activity_sub_type"] == "SUBTYPE_DYNAMIC_PAGE"
    assert act["published"] is True and act["order"] == 0
    assert act["extra_metadata"] == {"lms_import": {"source": "moodle", "source_id": "p1"}}
    assert "reader said hi" in report.warnings
    assert report.counts["chapters"] == 1 and report.counts["TYPE_DYNAMIC"] == 1


def test_course_defaults_and_bad_thumbnails(tmp_path):
    files = Files(str(tmp_path / "src"))
    for thumb in (files.raw("t.png", b"not a png"), files.raw("t.svg", b"<svg/>"), files.missing("t.png"), None):
        course = Course(title="", source="canvas", thumbnail=thumb)
        pkg, _ = write(course, tmp_path, name=f"p{id(thumb)}")
        assert pkg.course["thumbnail_image"] == ""
        assert pkg.course["name"] == "Imported course" == pkg.manifest["courses"][0]["name"]
        assert pkg.course["learnings"] is None and pkg.course["tags"] is None
        assert pkg.chapters == []


def test_long_summary_is_cut_at_a_sentence(tmp_path):
    long = "Sentence number one is here. " * 40
    pkg, _ = write(Course(title="T", source="x", summary=RichText(long)), tmp_path)
    desc = pkg.course["description"]
    assert len(desc) <= 500 and desc.endswith(".")
    assert package._first_sentences("word " * 200, 50).endswith("…")
    assert package._first_sentences("short", 50) == "short"


def test_empty_sections_and_hidden_sections(tmp_path):
    sections = [
        Section(title="Empty", id="e"),
        Section(title="Plain summary", summary=RichText("<p>Just words</p>"), id="ps"),
        Section(title="Hidden", items=[Page(title="HP", id="hp")], visible=False, id="h"),
        Section(title="", items=[Page(title="Untitled section page")], id="u"),
    ]
    course = course_with(sections=sections)
    pkg, report = write(course, tmp_path)
    assert [c["name"] for c in pkg.chapters] == ["Plain summary", "Hidden", "Chapter 3"]
    assert pkg.chapters[0]["description"] == "Just words" and pkg.chapters[0]["activities"] == []
    # items of a hidden section are imported unpublished
    assert pkg.one("HP")["published"] is False
    assert pkg.one("Untitled section page")["published"] is True

    pkg, report = write(course, tmp_path, name="nohidden", include_hidden=False, include_empty_sections=True)
    # untitled chapters are numbered by their position in the package
    assert [c["name"] for c in pkg.chapters] == ["Empty", "Plain summary", "Chapter 3"]
    assert [(s.title, s.kind) for s in report.skipped] == [("Hidden", "section")]


def test_rich_section_summary_becomes_first_page(tmp_path):
    files = Files(str(tmp_path / "src"))
    img = files.image("s.png")
    summary = RichText('<p>Welcome</p><img src="s.png">', files.resolver({"s.png": img}))
    course = course_with(sections=[Section(title="Week 1", summary=summary, items=[Page(title="After")], id="w1")])
    pkg, _ = write(course, tmp_path)
    ch = pkg.chapters[0]
    assert ch["description"] == ""
    first, second = ch["activities"]
    assert first["name"] == "Week 1" and first["order"] == 0 and second["order"] == 1
    assert first["extra_metadata"]["lms_import"]["source_id"] == "w1:summary"
    assert [n["type"] for n in first["content"]["content"]] == ["paragraph", "blockImage"]


def test_hidden_items_and_publish_option(tmp_path):
    course = course_with(Page(title="Shown"), Page(title="Hidden", visible=False))
    pkg, _ = write(course, tmp_path)
    assert pkg.one("Shown")["published"] is True and pkg.one("Hidden")["published"] is False
    pkg, report = write(course, tmp_path, name="skip", include_hidden=False)
    assert [a["name"] for a in pkg.activities()] == ["Shown"]
    assert report.skipped[0].title == "Hidden" and report.skipped[0].kind == "Page"
    pkg, _ = write(course, tmp_path, name="unpub", publish=False)
    assert all(a["published"] is False for a in pkg.activities())


def test_invalid_quiz_mode():
    with pytest.raises(ValueError):
        PackageWriter(Course(title="x", source="y"), "/tmp/never", ConvertOptions(quiz_mode="nope"))


def test_default_options_and_report(tmp_path):
    w = PackageWriter(course_with(Page(title="P")), str(tmp_path / "o"))
    w.write()
    assert w.report.course_title == "Test course" and w.report.counts["TYPE_DYNAMIC"] == 1


# ---------------------------------------------------------------------------
# Page parts
# ---------------------------------------------------------------------------


def test_every_page_part_type(tmp_path):
    files = Files(str(tmp_path / "src"))
    img = files.image("pic.png", size=(1200, 10))
    clip = files.raw("clip.mp4", MP4)
    song = files.raw("song.mp3", MP3)
    doc = files.raw("doc.pdf", PDF)
    docx = files.raw("notes.docx", b"PK\x03\x04docx")
    cards = [(f"<b>T{i}</b>", f"D{i}") for i in range(14)] + [("", "")]
    parts = [
        HtmlPart(RichText('<h2>Hello</h2><img src="pic.png">', files.resolver({"pic.png": img}))),
        HeadingPart("Section", 9),
        HeadingPart(""),
        MediaPart(MediaKind.IMAGE, asset=img, title="Same image again"),
        MediaPart(MediaKind.VIDEO, asset=clip),
        MediaPart(MediaKind.AUDIO, asset=song, title="Listen"),
        MediaPart(MediaKind.PDF, asset=doc),
        MediaPart(MediaKind.IMAGE, url="https://cdn.example.com/x.png"),
        MediaPart(MediaKind.VIDEO, url="https://youtu.be/dQw4w9WgXcQ"),
        MediaPart(MediaKind.AUDIO, url="https://cdn.example.com/a.mp3"),
        MediaPart(MediaKind.VIDEO, url="ftp://nope", title="Bad url"),
        MediaPart(MediaKind.VIDEO, asset=files.missing("gone.mp4")),
        EmbedPart(url="https://h5p.org/x", title="H5P", height=10),
        EmbedPart(code="<iframe src='https://x.y'></iframe>"),
        EmbedPart(url="javascript:alert(1)"),
        EmbedPart(),
        LinkPart(url="https://example.com", title="Site", description="A site"),
        LinkPart(url="https://vimeo.com/42", description="Video link"),
        LinkPart(url="https://youtu.be/dQw4w9WgXcQ"),
        LinkPart(url="file:///etc/passwd", title="Local"),
        LinkPart(url=""),
        MathPart("x^2"),
        MathPart("  "),
        FlashcardsPart(cards, title="Glossary"),
        FlashcardsPart([("a", "b")]),
        FlashcardsPart([]),
        FilePart(doc, title="Doc file"),
        FilePart(docx, title="Notes"),
        FilePart(files.missing("gone.png")),
        CodePart("print(1)", "python"),
        CodePart(""),
        object(),  # unknown part type
    ]
    pkg, report = write(course_with(Page(title="Kitchen sink", parts=parts)), tmp_path)
    act = pkg.one("Kitchen sink")
    nodes = act["content"]["content"]
    types = [n["type"] for n in nodes]
    assert types == [
        "heading", "blockImage",
        "heading",
        "paragraph", "blockImage",
        "blockVideo",
        "paragraph", "blockAudio",
        "blockPDF",
        "blockImage",
        "blockEmbed",
        "blockEmbed",
        "paragraph",
        "paragraph", "blockEmbed",
        "blockEmbed",
        "paragraph", "blockWebPreview",
        "paragraph", "blockEmbed",
        "blockEmbed",
        "paragraph",
        "blockMathEquation",
        "heading", "flipcardGrid", "flipcardGrid",
        "flipcardGrid",
        "blockPDF",
        "blockLibrary",
        "codeBlock", "codeBlock",
    ]
    assert nodes[28]["attrs"]["snapshot"]["name"] == "Notes (docx)"  # not a real OOXML file: zipped for the Library
    assert ("gone.png", "file", "missing from the export") in [(s.title, s.kind, s.reason) for s in report.skipped]
    assert nodes[2]["attrs"]["level"] == 6
    # the same image used twice in one page is stored once
    assert nodes[1]["attrs"]["blockObject"]["block_uuid"] == nodes[4]["attrs"]["blockObject"]["block_uuid"]
    assert nodes[1]["attrs"]["size"]["width"] == 900 == nodes[4]["attrs"]["size"]["width"]  # natural, clamped
    assert nodes[27]["attrs"]["blockObject"]["block_uuid"] == nodes[8]["attrs"]["blockObject"]["block_uuid"]
    assert len(act["_blocks"]) == 4  # image, video, audio, pdf
    path, block = media_file(act, nodes[1])
    assert block["block_type"] == "BLOCK_IMAGE"
    assert block["content"]["file_name"] == "pic.png" and block["content"]["file_format"] == "png"
    assert block["content"]["file_type"] == "image/png" and block["content"]["file_size"] == os.path.getsize(path)
    assert block["content"]["activity_uuid"] == act["activity_uuid"]
    assert nodes[5]["attrs"]["blockObject"]["size"] == "medium"
    assert nodes[7]["attrs"]["blockObject"]["source_type"] == "upload"
    assert nodes[8]["attrs"]["pdfHeight"] is None
    assert nodes[9]["attrs"]["unsplash_url"] == "https://cdn.example.com/x.png"
    assert nodes[10]["attrs"]["embedUrl"] == "https://www.youtube.com/embed/dQw4w9WgXcQ"
    assert nodes[11]["attrs"]["embedHeight"] == 160
    assert nodes[12]["content"][0]["text"] == "Bad url"
    assert nodes[14]["attrs"]["embedHeight"] == 150
    assert nodes[15]["attrs"]["embedType"] == "code"
    preview = nodes[17]["attrs"]
    assert preview["url"] == "https://example.com" and preview["title"] == "Site"
    assert nodes[19]["attrs"]["embedUrl"] == "https://player.vimeo.com/video/42"
    assert nodes[21]["content"][0]["text"] == "Local"
    assert nodes[24]["attrs"]["columns"] == 3 and len(nodes[24]["content"]) == 12
    assert len(nodes[25]["content"]) == 3
    assert nodes[24]["content"][0]["attrs"]["question"] == "T0"
    assert nodes[25]["content"][-1]["attrs"]["question"] == "…"
    assert nodes[26]["attrs"]["columns"] == 2
    assert nodes[29]["attrs"]["language"] == "python" and "content" not in nodes[30]
    assert report.counts["media_image"] == 1 and report.counts["media_pdf"] == 1
    # Nothing here is a problem to act on: not-migrated items are skipped entries
    assert report.warnings == []
    skipped = {(s.kind, s.reason) for s in report.skipped}
    assert ("embed", "not a web address") in skipped
    assert ("gone.mp4", "file", "missing from the export") in [(s.title, s.kind, s.reason) for s in report.skipped]


def test_empty_page_gets_a_paragraph(tmp_path):
    pkg, _ = write(course_with(Page(title="Blank")), tmp_path)
    assert pkg.one("Blank")["content"] == {"type": "doc", "content": [{"type": "paragraph"}]}


def test_media_node_without_activity_is_none(tmp_path):
    w = PackageWriter(Course(title="x", source="y"), str(tmp_path / "o"))
    assert w.media_node(MediaKind.IMAGE, Asset(path="/x", name="x.png")) is None


def test_data_uri_images_go_through_scratch(tmp_path):
    import base64
    import io

    buf = io.BytesIO()
    Image.new("RGB", (10, 10)).save(buf, "PNG")
    uri = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
    pkg, _ = write(course_with(Page(title="D", parts=[HtmlPart(RichText(f'<img src="{uri}">'))])), tmp_path)
    act = pkg.one("D")
    node = act["content"]["content"][0]
    _, block = media_file(act, node)
    assert block["content"]["file_name"].startswith("inline-")


# ---------------------------------------------------------------------------
# Media formats
# ---------------------------------------------------------------------------


def _page_media(tmp_path, parts, name="pkg", **opts):
    pkg, report = write(course_with(Page(title="M", parts=parts)), tmp_path, name=name, **opts)
    act = pkg.one("M")
    nodes = act["content"]["content"]
    if nodes == [{"type": "paragraph"}]:  # placeholder of a page left empty
        nodes = []
    return act, nodes, report


def test_canonical_extensions_and_sniffing(tmp_path):
    files = Files(str(tmp_path / "src"))
    parts = [
        MediaPart(MediaKind.IMAGE, asset=files.image("a.jpeg", "JPEG")),
        MediaPart(MediaKind.VIDEO, asset=files.raw("b.m4v", MP4)),
        MediaPart(MediaKind.IMAGE, asset=files.image("c.jpg", "PNG")),  # misnamed PNG
        MediaPart(MediaKind.IMAGE, asset=files.image("d.gif", "GIF")),
        MediaPart(MediaKind.IMAGE, asset=files.image("e.webp", "WEBP")),
        MediaPart(MediaKind.AUDIO, asset=files.raw("f.oga", OGG)),
        MediaPart(MediaKind.AUDIO, asset=files.raw("g.mp3", WAV)),  # misnamed WAV
        MediaPart(MediaKind.VIDEO, asset=files.raw("h.webm", WEBM)),
        MediaPart(MediaKind.IMAGE, asset=files.raw("bad.png", b"<html>not an image</html>")),
        MediaPart(MediaKind.AUDIO, asset=files.raw("bad.wav", b"RIFF\x00\x00\x00\x00WEBPVP8 ")),
        MediaPart(MediaKind.IMAGE, asset=files.raw("i.svg", b"<svg/>")),
    ]
    act, nodes, report = _page_media(tmp_path, parts)
    media = [n for n in nodes if n["type"] != "blockLibrary"]
    formats = [n["attrs"]["blockObject"]["content"]["file_format"] for n in media]
    assert formats == ["jpg", "mp4", "png", "gif", "webp", "ogg", "wav", "webm"]
    for n in media:
        media_file(act, n)
    # Files that cannot be shown in a block are kept as Library downloads
    downloads = [n["attrs"]["snapshot"]["name"] for n in nodes if n["type"] == "blockLibrary"]
    assert downloads == ["bad.png (png)", "bad.wav (wav)", "i.svg (svg)"]
    assert report.counts["media_file"] == 3
    assert [w for w in report.warnings if "Could not convert bad.wav" in w]  # ffmpeg refused it
    assert len(report.warnings) == 1


def test_bmp_and_tiff_are_converted_to_png(tmp_path):
    files = Files(str(tmp_path / "src"))
    parts = [MediaPart(MediaKind.IMAGE, asset=files.image("a.bmp", "BMP")),
             MediaPart(MediaKind.IMAGE, asset=files.image("b.tif", "TIFF")),
             MediaPart(MediaKind.IMAGE, asset=files.raw("broken.bmp", b"BMnot really"))]
    act, nodes, report = _page_media(tmp_path, parts)
    assert [n["type"] for n in nodes] == ["blockImage", "blockImage", "blockLibrary"]
    for n in nodes[:2]:
        path, block = media_file(act, n)
        assert block["content"]["file_format"] == "png"
        with Image.open(path) as im:
            assert im.format == "PNG"
    assert block["content"]["file_name"] == "b.tif"
    assert any("Could not convert image broken.bmp" in x for x in report.warnings)
    assert nodes[2]["attrs"]["snapshot"]["name"] == "broken.bmp (bmp)"  # still downloadable


def test_transcode_disabled(tmp_path):
    files = Files(str(tmp_path / "src"))
    _, nodes, report = _page_media(tmp_path, [MediaPart(MediaKind.VIDEO, asset=files.raw("v.mov", b"moov")),
                                              MediaPart(MediaKind.IMAGE, asset=files.image("a.bmp", "BMP"))],
                                   transcode=False)
    # Not converted: both are offered as downloads instead, without a warning
    assert [n["type"] for n in nodes] == ["blockLibrary", "blockLibrary"]
    assert [n["attrs"]["snapshot"]["file_format"] for n in nodes] == ["zip", "zip"]
    assert report.warnings == []


def test_mov_without_ffmpeg(tmp_path, monkeypatch):
    monkeypatch.setattr(package.shutil, "which", lambda _name: None)
    files = Files(str(tmp_path / "src"))
    _, nodes, report = _page_media(tmp_path, [MediaPart(MediaKind.VIDEO, asset=files.raw("v.mov", b"moov"))])
    assert [n["type"] for n in nodes] == ["blockLibrary"] and report.warnings == []


def test_mov_and_flac_with_ffmpeg(tmp_path, monkeypatch):
    monkeypatch.setattr(package.shutil, "which", lambda name: "/usr/bin/ffmpeg" if name == "ffmpeg" else None)
    calls = []

    def fake_run(args, check, timeout, capture_output):
        calls.append(args)
        out = args[-1]
        with open(out, "wb") as f:
            f.write(MP4 if out.endswith(".mp4") else MP3)
        return subprocess.CompletedProcess(args, 0)

    monkeypatch.setattr(package.subprocess, "run", fake_run)
    files = Files(str(tmp_path / "src"))
    act, nodes, report = _page_media(tmp_path, [MediaPart(MediaKind.VIDEO, asset=files.raw("v.mov", b"moov")),
                                                MediaPart(MediaKind.AUDIO, asset=files.raw("a.flac", b"fLaC"))])
    assert [n["type"] for n in nodes] == ["blockVideo", "blockAudio"]
    assert [n["attrs"]["blockObject"]["content"]["file_format"] for n in nodes] == ["mp4", "mp3"]
    assert calls[0][0] == "/usr/bin/ffmpeg" and "libx264" in calls[0] and "+faststart" in calls[0]
    assert "libmp3lame" in calls[1] and "-vn" in calls[1]
    assert report.counts["transcoded"] == 2
    for n in nodes:
        media_file(act, n)


def test_ffmpeg_failure(tmp_path, monkeypatch):
    monkeypatch.setattr(package, "_ffmpeg", lambda: "/usr/bin/ffmpeg")

    def fail(args, **_k):
        raise subprocess.CalledProcessError(1, args)

    monkeypatch.setattr(package.subprocess, "run", fail)
    files = Files(str(tmp_path / "src"))
    _, nodes, report = _page_media(tmp_path, [MediaPart(MediaKind.VIDEO, asset=files.raw("v.avi", b"RIFF"))])
    assert [n["type"] for n in nodes] == ["blockLibrary"]
    assert any("Could not convert v.avi" in x for x in report.warnings)


def test_unconvertible_audio_and_video_formats(tmp_path):
    files = Files(str(tmp_path / "src"))
    _, nodes, report = _page_media(tmp_path, [MediaPart(MediaKind.VIDEO, asset=files.raw("v.swf", b"FWS")),
                                              MediaPart(MediaKind.PDF, asset=files.raw("d.ps", b"%!PS"))])
    assert [n["attrs"]["snapshot"]["name"] for n in nodes] == ["v.swf (swf)", "d.ps (ps)"]
    assert report.warnings == []


def test_sniff_ok_helpers(tmp_path):
    files = Files(str(tmp_path / "src"))
    assert package._sniff_ok(files.raw("a.webp", b"RIFF\x00\x00\x00\x00WEBPVP8 ").path, "webp")
    assert not package._sniff_ok(files.raw("b.webp", WAV).path, "webp")
    assert package._sniff_ok(files.raw("c.m4a", MP4).path, "m4a")
    assert package._sniff_ok(files.raw("d.xyz", b"anything").path, "xyz")  # no signature known
    assert not package._sniff_ok(os.path.join(files.root, "missing"), "png")


def test_image_width_and_clamp(tmp_path):
    files = Files(str(tmp_path / "src"))
    assert package._image_width(files.image("w.png", size=(123, 4)).path) == 123
    assert package._image_width(files.raw("x.png", b"junk").path) is None
    assert package._clamp_width(None) == 600 and package._clamp_width(-5) == 600
    assert package._clamp_width(10) == 80 and package._clamp_width(5000) == 900 and package._clamp_width(300) == 300


def test_explicit_image_width_is_kept_on_reuse(tmp_path):
    files = Files(str(tmp_path / "src"))
    img = files.image("pic.png", size=(500, 10))
    html = RichText('<img src="p.png" width="200"><img src="p.png">', files.resolver({"p.png": img}))
    _, nodes, _ = _page_media(tmp_path, [HtmlPart(html)])
    assert [n["attrs"]["size"]["width"] for n in nodes] == [200, 500]


# ---------------------------------------------------------------------------
# Video items
# ---------------------------------------------------------------------------


def test_video_items(tmp_path):
    files = Files(str(tmp_path / "src"))
    clip = files.raw("lecture.m4v", MP4)
    items = [
        VideoItem(title="Hosted", asset=clip, id="v1"),
        VideoItem(title="YouTube", url="https://www.youtube.com/watch?v=dQw4w9WgXcQ", id="v2"),
        VideoItem(title="Vimeo", url="https://vimeo.com/42", id="v3"),
        VideoItem(title="With notes", asset=clip, description=RichText("<p>Read first</p>"), id="v4"),
        VideoItem(title="YouTube notes", url="https://youtu.be/dQw4w9WgXcQ", description=RichText("<p>n</p>")),
        VideoItem(title="Empty notes", url="https://youtu.be/dQw4w9WgXcQ", description=RichText(" ")),
        VideoItem(title="Missing", asset=files.missing("x.mp4")),
        VideoItem(title="Unsupported", asset=files.raw("x.swf", b"FWS")),
    ]
    pkg, report = write(course_with(*items), tmp_path)
    hosted = pkg.one("Hosted")
    assert hosted["activity_type"] == "TYPE_VIDEO" and hosted["activity_sub_type"] == "SUBTYPE_VIDEO_HOSTED"
    assert hosted["content"]["filename"].endswith("_video.mp4")
    assert hosted["content"]["activity_uuid"] == hosted["activity_uuid"]
    assert os.path.isfile(os.path.join(hosted["_dir"], "files", "video", hosted["content"]["filename"]))
    assert hosted["details"] == {"startTime": 0, "endTime": None, "autoplay": False, "muted": False}
    yt = pkg.one("YouTube")
    assert yt["activity_sub_type"] == "SUBTYPE_VIDEO_YOUTUBE"
    assert yt["content"]["uri"] == "https://www.youtube.com/watch?v=dQw4w9WgXcQ" and yt["content"]["type"] == "youtube"
    vimeo = pkg.one("Vimeo")
    assert vimeo["activity_type"] == "TYPE_DYNAMIC"
    assert vimeo["content"]["content"][0]["attrs"]["embedUrl"] == "https://player.vimeo.com/video/42"
    notes = pkg.one("With notes")
    assert [n["type"] for n in notes["content"]["content"]] == ["paragraph", "blockVideo"]
    assert [n["type"] for n in pkg.one("YouTube notes")["content"]["content"]] == ["paragraph", "blockEmbed"]
    assert pkg.one("Empty notes")["activity_type"] == "TYPE_VIDEO"
    assert [a["order"] for a in pkg.chapters[0]["activities"]] == list(range(6))
    skipped = {s.title: s.reason for s in report.skipped}
    assert "Missing" in skipped and "Unsupported" in skipped


def test_missing_video_file_spawns_no_ffmpeg(tmp_path, monkeypatch):
    monkeypatch.setattr(package, "_ffmpeg", lambda: "/usr/bin/ffmpeg")

    def never(*_a, **_k):
        raise AssertionError("ffmpeg must not run for a missing file")

    monkeypatch.setattr(package.subprocess, "run", never)
    files = Files(str(tmp_path / "src"))
    pkg, report = write(course_with(VideoItem(title="Missing", asset=files.missing("x.mp4")), Page(title="Next")),
                        tmp_path)
    assert [a["name"] for a in pkg.activities()] == ["Next"]
    assert report.warnings == []
    assert [(s.title, s.kind, s.reason) for s in report.skipped] == [
        ("Missing", "video", "video file missing from the export")]


# ---------------------------------------------------------------------------
# Documents
# ---------------------------------------------------------------------------


def test_document_items(tmp_path):
    files = Files(str(tmp_path / "src"))
    pkg, report = write(course_with(
        DocumentItem(title="Syllabus", asset=files.raw("s.pdf", PDF), id="d1"),
        DocumentItem(title="Fake", asset=files.raw("f.pdf", b"<html>")),
        DocumentItem(title="Gone", asset=files.missing("g.pdf")),
    ), tmp_path)
    doc = pkg.one("Syllabus")
    assert doc["activity_type"] == "TYPE_DOCUMENT" and doc["activity_sub_type"] == "SUBTYPE_DOCUMENT_PDF"
    assert doc["content"]["filename"].endswith("_documentpdf.pdf")
    assert open(os.path.join(doc["_dir"], "files", "documentpdf", doc["content"]["filename"]), "rb").read() == PDF
    assert [s.title for s in report.skipped] == ["Fake", "Gone"]
    assert report.counts["TYPE_DOCUMENT"] == 1


# ---------------------------------------------------------------------------
# Assessments
# ---------------------------------------------------------------------------


def test_graded_assessment(tmp_path):
    files = Files(str(tmp_path / "src"))
    fig = files.image("fig.png")
    q_img = mc('<p>Look <img src="fig.png"></p>')
    q_img.text = RichText('<p>Look <img src="fig.png"></p>', files.resolver({"fig.png": fig}))
    questions = [
        q_img, mc("Second", general_feedback="<p>Because</p>"),
        Question(type=QType.SHORTANSWER, text=RichText("Name"), answers=["Ada"]),
        Question(type=QType.NUMERICAL, text=RichText("Num"), numeric=[NumericAnswer(3.0)]),
        Question(type=QType.CLOZE, text=RichText("A {{1}}"), blanks=[Blank(answers=["b"])]),
    ]
    quiz = Assessment(title="Quiz 1", questions=questions, intro=RichText("<p>Plain intro</p>"),
                      due_date="2099-01-01T00:00:00+00:00", max_attempts=3, pass_percent=60.0,
                      show_correct_answers=True, time_limit_minutes=30, shuffle=True, id="a1")
    pkg, report = write(course_with(quiz), tmp_path)
    act = pkg.one("Quiz 1")
    assert act["activity_type"] == "TYPE_ASSIGNMENT" and act["activity_sub_type"] == "SUBTYPE_ASSIGNMENT_ANY"
    assert act["content"] == {}
    data = act["_assignment"]
    a = data["assignment"]
    assert data["assignment_uuid"].startswith("assignment_")
    assert a == {
        "title": "Quiz 1", "description": "Plain intro", "due_date": "2099-01-01T00:00:00+00:00",
        "published": True, "grading_type": "PERCENTAGE", "auto_grading": True, "show_correct_answers": True,
        "allow_retries": True, "max_retries": 3, "pass_threshold_percentage": 60.0, "ungraded": False,
        "solution": "2. Because", "solution_reveal": "AFTER_GRADING",
    }
    tasks = data["tasks"]
    assert [t["assignment_type"] for t in tasks] == ["QUIZ", "SHORT_ANSWER", "NUMBER_ANSWER", "FORM"]
    assert [t["order"] for t in tasks] == [0, 1, 2, 3]
    # Two one-point questions share the quiz task: it weighs twice a single question
    assert [t["max_grade_value"] for t in tasks] == [100, 50, 50, 50]
    assert all(t["assignment_task_uuid"].startswith("assignmenttask_") for t in tasks)
    ref = tasks[0]["reference_file"]
    assert ref and ref.endswith(".png")
    assert os.path.isfile(os.path.join(act["_dir"], "files", "assignments", data["assignment_uuid"], "tasks",
                                       tasks[0]["assignment_task_uuid"], ref))
    assert tasks[1]["reference_file"] is None
    assert report.warnings == []  # time limit and shuffling are documented differences, not warnings
    assert report.counts["questions"] == 5 and report.counts["assignment_tasks"] == 4
    assert len(pkg.activities()) == 1  # plain intro: no extra page


def test_assessment_attempts_and_manual_grading(tmp_path):
    single = Assessment(title="Once", questions=[mc()], max_attempts=1)
    unlimited = Assessment(title="Unlimited", questions=[Question(type=QType.ESSAY, text=RichText("Essay"))],
                           max_attempts=0)
    pkg, _ = write(course_with(single, unlimited), tmp_path)
    once = pkg.one("Once")["_assignment"]["assignment"]
    assert once["allow_retries"] is False and once["max_retries"] == 0
    assert once["solution"] is None and once["solution_reveal"] == "NEVER"
    unl = pkg.one("Unlimited")["_assignment"]["assignment"]
    assert unl["allow_retries"] is True and unl["max_retries"] == 0  # 0 = unlimited
    assert unl["auto_grading"] is False


def test_assessment_with_rich_intro_writes_a_page_first(tmp_path):
    quiz = Assessment(title="Rich", questions=[mc()], intro=RichText("<p>See</p><table><tr><td>x</td></tr></table>"),
                      id="r")
    pkg, _ = write(course_with(Page(title="Before"), quiz, Page(title="After")), tmp_path)
    names = [(a["name"], a["activity_type"], a["order"]) for a in pkg.chapters[0]["activities"]]
    assert names == [("Before", "TYPE_DYNAMIC", 0), ("Rich", "TYPE_DYNAMIC", 1), ("Rich", "TYPE_ASSIGNMENT", 2),
                     ("After", "TYPE_DYNAMIC", 3)]
    page = [a for a in pkg.by_name("Rich") if a["activity_type"] == "TYPE_DYNAMIC"][0]
    assert page["extra_metadata"]["lms_import"]["source_id"] == "r:intro"


def test_assessment_without_convertible_questions(tmp_path):
    quiz = Assessment(title="Broken", questions=[Question(type=QType.UNSUPPORTED, source_type="hotspot")])
    rich = Assessment(title="Broken rich", questions=[], intro=RichText("<pre>code</pre>"))
    pkg, report = write(course_with(quiz, rich, Page(title="Next")), tmp_path)
    assert [a["name"] for a in pkg.activities()] == ["Broken rich", "Next"]
    assert [a["order"] for a in pkg.activities()] == [0, 1]
    assert [(s.title, s.kind) for s in report.skipped] == [
        ("(untitled)", "hotspot question"), ("Broken", "quiz"), ("Broken rich", "quiz")]
    assert report.warnings == []


@pytest.mark.parametrize("mode,graded", [("page", True), ("assignment", False)])
def test_assessment_as_page(tmp_path, mode, graded):
    quiz = Assessment(title="Self check", graded=graded, intro=RichText("<p>Try these</p>"), questions=[
        Question(type=QType.DESCRIPTION, text=RichText("<p>Context</p>")),
        mc("Q1"), Question(type=QType.SHORTANSWER, text=RichText("S"), answers=["x"]),
    ])
    pkg, _ = write(course_with(quiz), tmp_path, quiz_mode=mode)
    act = pkg.one("Self check")
    assert act["activity_type"] == "TYPE_DYNAMIC"
    assert [n["type"] for n in act["content"]["content"]] == ["paragraph", "paragraph", "blockQuiz", "flipcardGrid"]


def test_inline_quiz_part_with_title(tmp_path):
    part = InlineQuizPart(questions=[mc("a", n=8, correct=(7,))], title="Check yourself")
    pkg, report = write(course_with(Page(title="P", parts=[part])), tmp_path)
    nodes = pkg.one("P")["content"]["content"]
    assert nodes[0]["type"] == "heading" and nodes[0]["attrs"]["level"] == 3
    # More options than a quiz block shows: a flipcard keeps every option's answer
    assert nodes[1]["type"] == "flipcardGrid" and nodes[1]["content"][0]["attrs"]["answer"] == "o7"
    assert report.warnings == []


# ---------------------------------------------------------------------------
# Assignments
# ---------------------------------------------------------------------------


def test_assignment_item_with_attachments(tmp_path):
    files = Files(str(tmp_path / "src"))
    brief = files.raw("brief.pdf", PDF)
    data = files.raw("data.xlsx", b"PK")
    exe = files.raw("tool.exe", b"MZ")
    pic = files.image("diagram.jpeg", "JPEG")
    instructions = RichText('<p>Do it</p><img src="d.jpeg"><img src="b.pdf">',
                            files.resolver({"d.jpeg": pic, "b.pdf": brief}))
    item = AssignmentItem(title="Essay", instructions=instructions, due_date="2099-02-01", points=10,
                          pass_percent=50.0, attachments=[brief, data, exe, files.missing("gone.pdf")], id="as1")
    pkg, report = write(course_with(item), tmp_path)
    acts = pkg.by_name("Essay")
    page = [a for a in acts if a["activity_type"] == "TYPE_DYNAMIC"][0]  # the <img> makes it rich
    assignment = [a for a in acts if a["activity_type"] == "TYPE_ASSIGNMENT"][0]
    assert page["order"] == 0 and assignment["order"] == 1
    a = assignment["_assignment"]["assignment"]
    assert a["description"] == "Do it" and a["auto_grading"] is False and a["ungraded"] is False
    assert a["due_date"] == "2099-02-01" and a["pass_threshold_percentage"] == 50.0
    tasks = assignment["_assignment"]["tasks"]
    assert [(t["assignment_type"], t["title"], t["max_grade_value"]) for t in tasks] == [
        ("FILE_SUBMISSION", "Essay", 100)]
    assert tasks[0]["reference_file"].endswith(".pdf")
    # The other attachments are on the instructions page: media as blocks, the rest as Library downloads
    page_nodes = page["content"]["content"]
    assert [n["type"] for n in page_nodes if n["type"] != "paragraph"] == [
        "blockImage", "blockPDF", "blockLibrary", "blockLibrary", "blockImage"]
    downloads = [n["attrs"]["snapshot"]["name"] for n in page_nodes if n["type"] == "blockLibrary"]
    assert downloads == ["data.xlsx (xlsx)", "tool.exe (exe)"]  # "PK" alone is not a real xlsx
    assert ("gone.pdf", "file", "missing from the export") in [(s.title, s.kind, s.reason) for s in report.skipped]
    assert tasks[0]["hint"] == "" and report.warnings == []


def test_text_only_and_ungraded_assignment(tmp_path):
    item = AssignmentItem(title="Journal", instructions=RichText("<p>Write</p>"), allow_file=False, allow_text=True,
                          graded=False, visible=False)
    pkg, report = write(course_with(item), tmp_path)
    act = pkg.one("Journal")
    a = act["_assignment"]["assignment"]
    assert a["ungraded"] is True and a["published"] is False and act["published"] is False
    task = act["_assignment"]["tasks"][0]
    assert task["hint"] == "Upload your work as a file." and task["reference_file"] is None
    assert task["contents"] == {}
    assert report.warnings == []


def test_assignment_without_title(tmp_path):
    pkg, _ = write(course_with(AssignmentItem(title="")), tmp_path)
    act = pkg.activities()[0]
    assert act["name"] == "Untitled"
    assert act["_assignment"]["tasks"][0]["title"] == "Submission"


# ---------------------------------------------------------------------------
# SCORM
# ---------------------------------------------------------------------------


def test_scorm_12(tmp_path):
    files = Files(str(tmp_path / "src"))
    pkg_zip = files.scorm("sco12.zip", SCORM12)
    pkg, report = write(course_with(ScormItem(title="Module", package=pkg_zip, id="sc")), tmp_path)
    act = pkg.one("Module")
    assert act["activity_type"] == "TYPE_SCORM" and act["activity_sub_type"] == "SUBTYPE_SCORM_12"
    assert act["content"] == {"scorm_version": "SCORM_12", "sco_identifier": "item3",
                              "entry_point": "index.html?lang=en", "sco_title": "Lesson 1"}
    scorm_dir = os.path.join(act["_dir"], "files", "scorm")
    assert os.path.isfile(os.path.join(scorm_dir, "package.zip"))
    assert os.path.isfile(os.path.join(scorm_dir, "extracted", "imsmanifest.xml"))
    assert report.warnings == []


def test_scorm_2004_in_a_subfolder(tmp_path):
    files = Files(str(tmp_path / "src"))
    pkg_zip = files.scorm("sco2004.zip", SCORM2004, prefix="course/")
    pkg, _ = write(course_with(ScormItem(title="Unit", package=pkg_zip)), tmp_path)
    act = pkg.one("Unit")
    assert act["activity_sub_type"] == "SUBTYPE_SCORM_2004"
    assert act["content"]["scorm_version"] == "SCORM_2004"
    assert act["content"]["entry_point"] == "course/index.html?a=1"
    assert os.path.isfile(os.path.join(act["_dir"], "files", "scorm", "extracted", act["content"]["entry_point"]
                                       .split("?")[0]))


def test_scorm_resources_only(tmp_path):
    files = Files(str(tmp_path / "src"))
    pkg, _ = write(course_with(ScormItem(title="R", package=files.scorm("r.zip", SCORM_RESOURCES_ONLY))), tmp_path)
    act = pkg.one("R")
    assert act["content"] == {"scorm_version": "SCORM_2004", "sco_identifier": "r", "entry_point": "index.html",
                              "sco_title": "R"}


def test_invalid_scorm_packages(tmp_path):
    files = Files(str(tmp_path / "src"))
    items = [
        ScormItem(title="Not a zip", package=files.raw("bad.zip", b"hello")),
        ScormItem(title="No manifest", package=files.scorm("nm.zip", None)),
        ScormItem(title="No SCO", package=files.scorm("ns.zip", SCORM_NO_SCO)),
        ScormItem(title="Broken XML", package=files.scorm("bx.zip", "<manifest>")),
        ScormItem(title="Missing", package=files.missing("m.zip")),
        ScormItem(title="Deep manifest", package=files.scorm("deep.zip", SCORM12, prefix="a/b/")),
    ]
    pkg, report = write(course_with(*items), tmp_path)
    assert pkg.activities() == []
    reasons = {s.title: s.reason for s in report.skipped}
    assert reasons["Not a zip"].startswith("unreadable package")
    assert reasons["No manifest"] == reasons["No SCO"] == reasons["Broken XML"] == reasons["Deep manifest"] == \
        "no launchable SCO in imsmanifest.xml"
    assert reasons["Missing"] == "package missing from the export"
    # failed SCORM activities leave nothing behind
    adir = os.path.join(pkg.chapters[0]["_dir"], "activities")
    assert not os.path.isdir(adir) or os.listdir(adir) == []


def test_scorm_org_default_mismatch_falls_back_to_resources(tmp_path):
    manifest = SCORM12.replace('default="org1"', 'default="nope"')
    files = Files(str(tmp_path / "src"))
    pkg, _ = write(course_with(ScormItem(title="Fallback", package=files.scorm("f.zip", manifest))), tmp_path)
    assert pkg.one("Fallback")["content"]["sco_identifier"] == "res_other"


# ---------------------------------------------------------------------------
# Unsupported, unknown and failing items
# ---------------------------------------------------------------------------


def test_unsupported_and_unknown_items(tmp_path):
    class Strange:
        pass

    pkg, report = write(course_with(UnsupportedItem(title="Forum", kind="forum", reason="no forums"), Strange(),
                                    Page(title="Kept")), tmp_path)
    assert [a["name"] for a in pkg.activities()] == ["Kept"]
    assert pkg.activities()[0]["order"] == 0
    assert [(s.title, s.kind, s.reason) for s in report.skipped] == [
        ("Forum", "forum", "no forums"), ("?", "Strange", "unknown item")]


def test_item_error_is_reported_and_cleaned_up(tmp_path, monkeypatch):
    def broken(self, chapter_dir, item, order, visible):
        act = self._new_activity(chapter_dir)
        with open(os.path.join(act.dir, "partial.bin"), "wb") as f:
            f.write(b"x")
        raise RuntimeError("disk on fire")

    monkeypatch.setattr(PackageWriter, "_document", broken)
    files = Files(str(tmp_path / "src"))
    pkg, report = write(course_with(DocumentItem(title="Doc", asset=files.raw("d.pdf", PDF)), Page(title="Next")),
                        tmp_path)
    assert [a["name"] for a in pkg.activities()] == ["Next"]
    assert report.skipped[0].reason == "conversion error: disk on fire"
    assert len(os.listdir(os.path.join(pkg.chapters[0]["_dir"], "activities"))) == 1


def test_item_error_before_any_activity(tmp_path, monkeypatch):
    monkeypatch.setattr(PackageWriter, "_page", lambda *a, **k: (_ for _ in ()).throw(ValueError("early")))
    pkg, report = write(course_with(Page(title="P")), tmp_path)
    assert pkg.activities() == [] and report.skipped[0].reason == "conversion error: early"


def test_partial_item_failure_keeps_activity_orders_unique(tmp_path, monkeypatch):
    def broken(self, act, assignment, tasks):
        raise RuntimeError("boom")

    monkeypatch.setattr(PackageWriter, "_write_assignment", broken)
    files = Files(str(tmp_path / "src"))
    img = files.image("i.png")
    resolve = files.resolver({"i.png": img})
    picture_choices = Question(type=QType.MULTICHOICE, text=RichText("Which?"), choices=[
        Choice(RichText('<img src="i.png">', resolve), True), Choice(RichText('<img src="i.png">', resolve))])
    quiz = Assessment(title="Quiz", questions=[picture_choices, mc()], intro=RichText('<p><img src="i.png"></p>', resolve))
    pkg, report = write(course_with(quiz, Page(title="Next")), tmp_path)
    # The intro and figures pages were written before the assignment failed: their slots stay taken
    acts = pkg.chapters[0]["activities"]
    assert [(a["name"], a["order"]) for a in acts] == [("Quiz", 0), ("Quiz: figures", 1), ("Next", 2)]
    assert ("Quiz", "Assessment", "conversion error: boom") in [(s.title, s.kind, s.reason) for s in report.skipped]


def test_non_finite_numbers_skip_the_item_not_the_course(tmp_path):
    # Postgres rejects NaN/Infinity in JSON: the package must never contain them
    with pytest.raises(ValueError):
        package._write_json(str(tmp_path / "nan.json"), {"x": float("nan")})
    assert not os.path.exists(tmp_path / "nan.json")

    quiz = Assessment(title="Quiz", questions=[mc()], pass_percent=float("inf"))
    pkg, report = write(course_with(quiz, Page(title="Next")), tmp_path)
    assert [(a["name"], a["order"]) for a in pkg.activities()] == [("Next", 0)]
    assert [(s.title, s.kind) for s in report.skipped] == [("Quiz", "Assessment")]
    assert report.skipped[0].reason.startswith("conversion error: Out of range float")


# ---------------------------------------------------------------------------
# Determinism and zipping
# ---------------------------------------------------------------------------


def _big_course(files: Files) -> Course:
    img = files.image("pic.png")
    return course_with(
        Page(title="P", parts=[HtmlPart(RichText('<p>x</p><img src="p.png">', files.resolver({"p.png": img})))]),
        Assessment(title="Q", questions=[mc(), Question(type=QType.SHORTANSWER, text=RichText("s"), answers=["a"])]),
        VideoItem(title="V", asset=files.raw("v.mp4", MP4)),
        DocumentItem(title="D", asset=files.raw("d.pdf", PDF)),
        thumbnail=files.image("t.png"), learnings=["L"],
    )


def _snapshot(root):
    snap = {}
    for dirpath, _dirs, fnames in os.walk(root):
        for f in fnames:
            full = os.path.join(dirpath, f)
            rel = os.path.relpath(full, root)
            with open(full, "rb") as fh:
                data = fh.read()
            if f == "manifest.json":
                m = json.loads(data)
                m.pop("created_at")
                data = json.dumps(m).encode()
            snap[rel] = data
    return snap


def test_two_writes_are_identical(tmp_path):
    files = Files(str(tmp_path / "src"))
    course = _big_course(files)
    write(course, tmp_path, name="one")
    write(course, tmp_path, name="two")
    a, b = _snapshot(tmp_path / "one"), _snapshot(tmp_path / "two")
    assert a == b and len(a) > 10


def test_zip_directory(tmp_path):
    files = Files(str(tmp_path / "src"))
    write(_big_course(files), tmp_path, name="pkg")
    out = tmp_path / "pkg"
    os.makedirs(out / ".scratch")
    (out / ".scratch" / "tmp.bin").write_bytes(b"x")
    zpath = zip_directory(str(out), str(tmp_path / "course.zip"))
    assert zpath == str(tmp_path / "course.zip")
    assert not os.path.exists(zpath + ".part")
    with zipfile.ZipFile(zpath) as zf:
        infos = zf.infolist()
        names = [i.filename for i in infos]
        assert "manifest.json" in names
        assert not any(n.startswith(".scratch") for n in names)
        assert all(i.compress_type == zipfile.ZIP_STORED for i in infos)
        assert all(i.date_time == (1980, 1, 1, 0, 0, 0) for i in infos)
        assert json.loads(zf.read("manifest.json"))["format"] == "learnhouse-course-export"
    # zipping again gives the same bytes
    zip2 = zip_directory(str(out), str(tmp_path / "again.zip"))
    assert open(zpath, "rb").read() == open(zip2, "rb").read()


def test_is_rich():
    assert not package._is_rich(None)
    assert not package._is_rich(RichText(""))
    assert not package._is_rich(RichText("<p><b>plain</b></p>"))
    for html in ("<img src=x>", "<TABLE>", "<iframe>", "<video>", "<audio>", "<object>", "<embed>", "<pre>",
                 "<math>", "$$x$$", "\\[x\\]", "\\(x\\)"):
        assert package._is_rich(RichText(html)), html


def test_scorm_launch_unreadable(tmp_path):
    assert package._scorm_launch(str(tmp_path / "missing.xml")) is None


def test_module_exports():
    assert set(package.__all__) == {"PackageWriter", "ConvertOptions", "zip_directory", "QUIZ_MODES"}
    assert ir.MediaKind.IMAGE in package._BLOCK_FOLDERS


def test_library_file_edge_cases(tmp_path):
    from unittest.mock import patch

    files = Files(str(tmp_path / "src"))
    office = tmp_path / "src" / "handout.docx"
    with zipfile.ZipFile(office, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("word/document.xml", "<w:document/>")
    assert package._library_file_ok(str(office), "docx")  # the Library's zip-container check
    assert not package._library_file_ok(files.raw("bad.docx", b"not a zip").path, "docx")
    assert not package._library_file_ok(str(office), "nope")  # not an upload type at all
    assert not package._library_file_ok(str(tmp_path / "missing.pdf"), "pdf")  # unreadable

    writer = PackageWriter(course_with(), str(tmp_path / "out"))
    writer._course_dir = str(tmp_path / "out" / "courses" / "c")
    assert writer.library_node(files.missing("gone.pptx")) is None
    assert [(s.title, s.kind, s.reason) for s in writer.report.skipped] == [
        ("gone.pptx", "file", "missing from the export")]
    exe = files.raw("tool.exe", b"MZ")
    assert writer._copy_reference(None, "a", "t", exe) is None  # never a task reference file

    # A failed zip fallback leaves nothing half-written and is a genuine warning
    with patch("src.services.courses.lms_import.package.zipfile.ZipFile", side_effect=OSError("disk full")):
        assert writer.library_node(exe) is None
    assert any("Could not package tool.exe" in w for w in writer.report.warnings)
    assert os.listdir(os.path.join(writer._course_dir, "library")) == []
    node = writer.library_node(exe)
    assert node["attrs"]["snapshot"]["name"] == "tool.exe (exe)" and node["attrs"]["snapshot"]["file_format"] == "zip"


def test_misnamed_reference_file_is_skipped(tmp_path):
    files = Files(str(tmp_path / "src"))
    items = [
        AssignmentItem(title="Fake PDF", instructions=RichText("<p>Read</p>"),
                       attachments=[files.raw("notes.pdf", b"not a pdf at all")], id="a1"),
        AssignmentItem(title="Plain text", instructions=RichText("<p>Read</p>"),
                       attachments=[files.raw("readme.txt", b"hello")], id="a2"),
        AssignmentItem(title="Real PDF", instructions=RichText("<p>Read</p>"),
                       attachments=[files.raw("real.pdf", PDF)], id="a3"),
    ]
    pkg, report = write(course_with(*items), tmp_path)
    refs = {a["name"]: a["_assignment"]["tasks"][0]["reference_file"] for a in pkg.activities()}
    # The importer would drop the misnamed file and the task would lose its reference silently
    assert refs["Fake PDF"] is None
    assert refs["Plain text"].endswith(".txt")  # no upload validator for txt: copied as is
    assert refs["Real PDF"].endswith(".pdf")
    assert [(s.title, s.kind, s.reason) for s in report.skipped] == [("notes.pdf", "file", "not a valid pdf file")]


def test_oversized_library_files_are_skipped(tmp_path, monkeypatch):
    mb = 1024 * 1024
    monkeypatch.setattr(package, "max_size_for_extension", lambda ext: mb)
    monkeypatch.setattr(package, "_MAX_UNCOMPRESSED_ZIP", mb)
    files = Files(str(tmp_path / "src"))
    big_office = tmp_path / "src" / "big.docx"
    with zipfile.ZipFile(big_office, "w") as z:
        z.writestr("word/document.xml", b"\x00" * (mb + 1))
    parts = [
        FilePart(Asset(str(big_office), "big.docx")),  # a direct Library copy over its type's limit
        FilePart(files.raw("big.txt", b"x" * (mb + 1))),  # zipped fallback over the zip-bomb cap
        FilePart(files.raw("small.txt", b"x")),
    ]
    _, nodes, report = _page_media(tmp_path, parts)
    assert [n["attrs"]["snapshot"]["name"] for n in nodes] == ["small.txt (txt)"]
    assert [(s.title, s.kind, s.reason) for s in report.skipped] == [
        ("big.docx", "file", "larger than the Library allows (1 MB)"),
        ("big.txt", "file", "larger than the Library allows (1 MB)")]
    assert report.counts["media_file"] == 1 and report.warnings == []


def test_corrupt_inline_image_is_skipped_not_a_library_item(tmp_path):
    import base64
    import io

    buf = io.BytesIO()
    Image.new("RGB", (8, 8), (0, 0, 255)).save(buf, "PNG")
    good = base64.b64encode(buf.getvalue()).decode()
    junk = base64.b64encode(b"this is not an image at all").decode()
    html = f'<img src="data:image/png;base64,{good}"><img src="data:image/png;base64,{junk}">'
    pkg, report = write(course_with(Page(title="M", parts=[HtmlPart(RichText(html))])), tmp_path)
    act = pkg.one("M")
    nodes = act["content"]["content"]
    assert [n["type"] for n in nodes] == ["blockImage"]
    media_file(act, nodes[0])
    assert [(s.kind, s.reason) for s in report.skipped] == [("image", "unreadable image data")]
    assert report.skipped[0].title.startswith("inline-") and report.skipped[0].title.endswith(".png")
    assert not os.path.isdir(os.path.join(pkg.course_dir, "library"))  # no junk zip in the Library
    assert report.counts.get("media_file", 0) == 0 and report.warnings == []
