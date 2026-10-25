"""Shared-module behaviour the source readers rely on."""

from __future__ import annotations

from src.services.courses.lms_import import ir, qti
from src.services.courses.lms_import.questions import IdFactory, build_tasks
from src.services.courses.lms_import.xmlutil import parse_bytes


def _short(**kw):
    return ir.Question(ir.QType.SHORTANSWER, ir.RichText("Q"), **kw)


def test_short_answer_modes():
    tasks = build_tasks([
        _short(answers=["a.*b"], regex=True),
        _short(answers=["SELECT * FROM t"], wildcard=False),
        _short(answers=["colo*r"]),
        _short(answers=["x"], wildcard=True),
    ], IdFactory("s")).tasks
    modes = [(t.contents["correct_answers"], t.contents["match_mode"]) for t in tasks]
    assert modes == [
        (["a.*b"], "regex"),
        (["SELECT * FROM t"], "case_insensitive"),
        (["colo.*r"], "regex"),
        (["x"], "regex"),
    ]


def _item(xml: str):
    return qti.parse_item(parse_bytes(xml.encode()))


def test_d2l_metadata_field_spelling_and_positive_points():
    q = _item("""<item ident="i"><itemmetadata><qtimetadata>
      <qti_metadatafield><fieldlabel>qmd_questiontype</fieldlabel><fieldentry>Short Answer</fieldentry></qti_metadatafield>
      <qtimetadatafield><fieldlabel>qmd_weighting</fieldlabel><fieldentry>0.0</fieldentry></qtimetadatafield>
      <qtimetadatafield><fieldlabel>qmd_absolutescore_max</fieldlabel><fieldentry>4</fieldentry></qtimetadatafield>
    </qtimetadata></itemmetadata>
    <presentation><material><mattext>Name?</mattext></material><response_str ident="r"/></presentation>
    <resprocessing><respcondition><conditionvar><varequal respident="r">Ada</varequal></conditionvar>
      <setvar action="Set">1</setvar></respcondition></resprocessing></item>""")
    assert q.type == ir.QType.SHORTANSWER and q.answers == ["Ada"]
    assert q.points == 4


def test_blackboard_scoring_conventions():
    q = _item("""<item ident="i"><presentation><material><mattext>Pick</mattext></material>
      <response_lid ident="r" rcardinality="Single"><render_choice>
        <response_label ident="a"><material><mattext>A</mattext></material></response_label>
        <response_label ident="b"><material><mattext>B</mattext></material></response_label>
      </render_choice></response_lid></presentation>
      <resprocessing>
        <respcondition title="correct"><conditionvar><varequal respident="r">a</varequal></conditionvar>
          <displayfeedback linkrefid="correct"/></respcondition>
        <respcondition><conditionvar><other/></conditionvar><setvar>SCORE.max</setvar></respcondition>
        <respcondition><conditionvar><varequal respident="r">b</varequal></conditionvar>
          <displayfeedback linkrefid="Correct"/></respcondition>
      </resprocessing></item>""")
    # "other" is a catch-all, not an answer key; linkrefid=correct marks a key
    assert [c.correct for c in q.choices] == [True, True]


def test_matapplication_and_image_only_answers():
    html = qti.material_html(parse_bytes(
        b'<material><mattext>See</mattext><matapplication uri="files/data.xlsx"/>'
        b'<matapplication uri=""/></material>'))
    assert '<a href="files/data.xlsx">data.xlsx</a>' in html
    assert qti._strip('<img src="a/b/cat.png?x=1">') == "Image: cat.png"
    assert qti._strip('<img alt="A cat" src="cat.png">') == "A cat"
    assert qti._strip("<span></span>") == "<span></span>"


def test_icon_font_glyphs_are_dropped():
    from src.services.courses.lms_import.html_to_tiptap import HtmlConverter, html_to_text

    html = ('<p><span class="material-icons">menu_book</span>Docs <i class="fa fa-star"></i>'
            '<span aria-hidden="true">x</span>here <span class="bit">kept</span></p>')
    assert html_to_text(html) == "Docs here kept"

    class Sink:
        pass

    nodes = HtmlConverter(Sink()).convert(ir.RichText(html))
    assert "".join(n["text"] for n in nodes[0]["content"]) == "Docs here kept"


def test_ffmpeg_and_pillow_inputs_are_restricted(tmp_path, monkeypatch):
    """Untrusted media must not reach playlist demuxers or risky image decoders."""
    import subprocess

    from src.services.courses.lms_import import package as pkg

    calls = []

    def fake_run(args, **kwargs):
        calls.append(args)
        open(args[-1], "wb").close()
        return subprocess.CompletedProcess(args, 0)

    monkeypatch.setattr(pkg, "_ffmpeg", lambda: "/usr/bin/ffmpeg")
    monkeypatch.setattr(pkg.subprocess, "run", fake_run)
    src = tmp_path / "clip.mov"
    src.write_bytes(b"#EXTM3U\nfile:///etc/passwd\n")
    writer = pkg.PackageWriter(ir.Course(title="t", source="moodle"), str(tmp_path / "out"))
    writer._transcode(ir.MediaKind.VIDEO, ir.Asset(str(src), "clip.mov"))
    args = calls[0]
    i = args.index("-i")
    assert args[args.index("-protocol_whitelist") + 1] == "file" and args.index("-protocol_whitelist") < i
    formats = args[args.index("-format_whitelist") + 1].split(",")
    assert args.index("-format_whitelist") < i
    assert "hls" not in formats and "concat" not in formats and "image2" not in formats

    # An EPS file named .bmp is refused instead of being handed to Ghostscript
    eps = tmp_path / "evil.bmp"
    eps.write_bytes(b"%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 10 10\nshowpage\n")
    assert writer._convert_image(ir.Asset(str(eps), "evil.bmp")) is None


def test_legacy_media_formats_reach_the_writer():
    from src.services.courses.lms_import.html_to_tiptap import media_kind_for

    assert media_kind_for("lecture.avi") == ir.MediaKind.VIDEO
    assert media_kind_for("lecture.WMV") == ir.MediaKind.VIDEO
    assert media_kind_for("talk.wma") == ir.MediaKind.AUDIO
    assert media_kind_for("notes.docx") is None


def test_iframe_with_a_packaged_file(tmp_path):
    from src.services.courses.lms_import.html_to_tiptap import HtmlConverter

    pdf = tmp_path / "guide.pdf"
    pdf.write_bytes(b"%PDF-1.4")
    calls = []

    class Sink:
        def media_node(self, kind, asset, **kw):
            calls.append((kind, asset.name))
            return {"type": "blockPDF", "attrs": {"blockObject": None, "pdfHeight": None}}

    def resolve(url):
        return ir.Asset(str(pdf), "guide.pdf") if url.endswith("guide.pdf") else None

    conv = HtmlConverter(Sink())
    nodes = conv.convert(ir.RichText('<iframe src="/static/guide.pdf"></iframe><iframe src="javascript:x"></iframe>'
                                     '<iframe src="/static/page.html"></iframe>', resolve))
    assert [n["type"] for n in nodes] == ["blockPDF"]
    assert calls == [(ir.MediaKind.PDF, "guide.pdf")]


def test_doctype_and_declarations_are_not_text():
    from src.services.courses.lms_import.html_to_tiptap import HtmlConverter, html_to_text

    html = '<!DOCTYPE html><?xml version="1.0"?><html><body><!-- c --><p>Hello</p></body></html>'
    assert html_to_text(html) == "Hello"
    nodes = HtmlConverter(object()).convert(ir.RichText(html))
    assert nodes == [{"type": "paragraph", "content": [{"type": "text", "text": "Hello"}]}]


def test_unkeyed_choice_questions_become_text_in_pages():
    from src.services.courses.lms_import.questions import block_quiz_nodes

    poll = ir.Question(ir.QType.MULTICHOICE, ir.RichText("Favourite colour?"),
                       choices=[ir.Choice(ir.RichText("Red")), ir.Choice(ir.RichText("Blue"))])
    quiz = ir.Question(ir.QType.MULTICHOICE, ir.RichText("2+2?"),
                       choices=[ir.Choice(ir.RichText("4"), True), ir.Choice(ir.RichText("5"))])
    nodes = block_quiz_nodes([quiz, poll], IdFactory("p"), lambda m: None)
    assert [n["type"] for n in nodes] == ["blockQuiz", "paragraph", "bulletList"]
    assert len(nodes[2]["content"]) == 2


def test_html_entities_in_xml_and_cp437_zip_names(tmp_path):
    import zipfile

    from src.services.courses.lms_import.archive import extract_archive
    from src.services.courses.lms_import.sources.common import FileIndex
    from src.services.courses.lms_import.xmlutil import XmlError

    el = parse_bytes(b"<a>x&nbsp;y &amp; &eacute;</a>")
    assert el.text == "x\xa0y & \xe9"
    import pytest

    with pytest.raises(XmlError):
        parse_bytes(b"<a>&notarealentity;</a>")

    # A UTF-8 name stored without the UTF-8 flag (zipfile would read it as cp437)
    path = tmp_path / "x.zip"
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("molAB.txt", b"hi")  # ASCII placeholder: no UTF-8 flag
    path.write_bytes(path.read_bytes().replace(b"molAB.txt", "mol\u00e9.txt".encode("utf-8")))
    out = extract_archive(str(path), str(tmp_path / "out"))
    assert (tmp_path / "out" / "molé.txt").is_file()

    # NFD (macOS) and NFC spellings find the same file
    import unicodedata

    idx = FileIndex(out)
    assert idx.get(unicodedata.normalize("NFD", "molé.txt"))
    assert idx.by_basename(unicodedata.normalize("NFD", "MOLÉ.txt"))


def _png_file(path):
    import struct
    import zlib

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
                     + chunk(b"IDAT", zlib.compress(b"\x00\xff\x00\x00")) + chunk(b"IEND", b""))


def _written_activities(out):
    import glob
    import json
    import os

    acts = []
    for p in sorted(glob.glob(os.path.join(out, "courses/*/chapters/*/activities/*/activity.json"))):
        a = json.load(open(p))
        aj = p.replace("activity.json", "assignment.json")
        a["_assignment"] = json.load(open(aj)) if os.path.exists(aj) else None
        acts.append(a)
    return sorted(acts, key=lambda a: a["order"])


def test_picture_answers_get_a_figures_page(tmp_path):
    from src.services.courses.lms_import import PackageWriter

    for name in ("g1.png", "g2.png", "q.png"):
        _png_file(tmp_path / name)

    def resolve(url):
        p = tmp_path / url
        return ir.Asset(str(p), url) if p.exists() else None

    pic = ir.Question(ir.QType.MULTICHOICE, ir.RichText("<p>Which graph is linear?</p>", resolve), choices=[
        ir.Choice(ir.RichText('<img src="g1.png">', resolve), True),
        ir.Choice(ir.RichText('<img src="g2.png">', resolve)),
    ])
    plain_q = ir.Question(ir.QType.TRUEFALSE, ir.RichText("Sky blue?"),
                          choices=[ir.Choice(ir.RichText("True"), True), ir.Choice(ir.RichText("False"))])
    quiz = ir.Assessment("Graphs", [pic, plain_q])
    course = ir.Course(title="C", source="moodle", sections=[ir.Section("S", items=[quiz])])
    PackageWriter(course, str(tmp_path / "out")).write()
    acts = _written_activities(str(tmp_path / "out"))
    assert [a["name"] for a in acts] == ["Graphs: figures", "Graphs"]
    figures = acts[0]["content"]["content"]
    assert [n["type"] for n in figures].count("blockImage") == 2
    task = acts[1]["_assignment"]["tasks"][0]
    options = [o["text"] for o in task["contents"]["questions"][0]["options"]]
    assert options == ["Option A", "Option B"]
    assert "Graphs: figures" in acts[1]["_assignment"]["assignment"]["description"]


def test_quiz_without_gradable_questions_is_kept_as_a_page(tmp_path):
    from src.services.courses.lms_import import PackageWriter

    stack = [ir.Question(ir.QType.UNSUPPORTED, ir.RichText(f"<p>Differentiate x^{i}</p>"), source_type="stack",
                         reason="computed by a CAS") for i in range(3)]
    course = ir.Course(title="C", source="moodle",
                       sections=[ir.Section("S", items=[ir.Assessment("Calculus", stack)])])
    w = PackageWriter(course, str(tmp_path / "out"))
    w.write()
    acts = _written_activities(str(tmp_path / "out"))
    assert [(a["name"], a["activity_type"]) for a in acts] == [("Calculus", "TYPE_DYNAMIC")]
    skipped = [(s.title, s.kind, s.reason) for s in w.report.skipped]
    assert ("3 questions: Differentiate x^0; Differentiate x^1; Differentiate x^2", "stack question",
            "computed by a CAS") in skipped
    assert any(t == "Calculus" and k == "quiz" and "kept as a page" in r for t, k, r in skipped)
    assert w.report.warnings == []


def test_remote_picture_answers_also_get_a_figures_page(tmp_path):
    from src.services.courses.lms_import import PackageWriter

    pic = ir.Question(ir.QType.MULTICHOICE, ir.RichText("<p>Which graph?</p>"), choices=[
        ir.Choice(ir.RichText('<p><img src="https://x.org/a.png" alt="solid line, shade below"></p>'), True),
        ir.Choice(ir.RichText('<p>Dashed <img src="https://x.org/b.png" alt="dashed"></p>')),
    ])
    course = ir.Course(title="C", source="moodle",
                       sections=[ir.Section("S", items=[ir.Assessment("Lines", [pic])])])
    PackageWriter(course, str(tmp_path / "out")).write()
    acts = _written_activities(str(tmp_path / "out"))
    assert [a["name"] for a in acts] == ["Lines: figures", "Lines"]
    images = [n for n in acts[0]["content"]["content"] if n["type"] == "blockImage"]
    assert [n["attrs"]["unsplash_url"] for n in images] == ["https://x.org/a.png", "https://x.org/b.png"]
    options = [o["text"] for o in acts[1]["_assignment"]["tasks"][0]["contents"]["questions"][0]["options"]]
    assert options == ["Option A", "Option B: Dashed"]  # alt text never leaks the answer


def test_tex_in_plain_text_fields_is_readable():
    from src.services.courses.lms_import.html_to_tiptap import html_to_text, latex_to_text

    assert html_to_text(r"<p>\( W = \dfrac{6,\!000}{n} \)</p>") == "W = (6,000)/(n)"
    assert html_to_text(r"Solve \(x^{2} \le \sqrt{9}\) and $$\frac{\pi}{2}$$") == "Solve x^2 ≤ √(9) and (π)/(2)"
    assert latex_to_text(r"\left( a_{1}, b \right) \quad \text{cm}\, \unknowncmd") == "( a_1, b ) cm unknowncmd"
    assert html_to_text("Price is $5 and $6") == "Price is $5 and $6"


def test_resolver_basename_fallback_and_blank_dates(tmp_path):
    from src.services.courses.lms_import.sources.common import FileIndex, iso_from_text, make_resolver

    (tmp_path / "deep" / "er").mkdir(parents=True)
    (tmp_path / "deep" / "er" / "doc.pdf").write_bytes(b"%PDF")
    index = FileIndex(str(tmp_path))
    # The export names a path that does not exist, but only one file has that name
    assert make_resolver(index)("elsewhere/doc.pdf").name == "doc.pdf"
    assert make_resolver(index, basename_fallback=False)("elsewhere/doc.pdf") is None
    assert iso_from_text(None) is None and iso_from_text("   ") is None


def test_out_of_range_timestamps_are_not_dates():
    from src.services.courses.lms_import.sources.common import iso_from_text, iso_from_timestamp

    assert iso_from_timestamp(1700000000) == "2023-11-14T22:13:20+00:00"
    # Millisecond epochs and absurd values used to raise out of datetime.fromtimestamp
    assert iso_from_text("1700000000000") is None
    assert iso_from_timestamp(1700000000000) is None
    assert iso_from_timestamp("1e300") is None and iso_from_timestamp("1e999") is None
    assert iso_from_timestamp(10**15) is None
