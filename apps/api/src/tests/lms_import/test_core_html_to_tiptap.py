"""
html_to_tiptap: LMS HTML -> LearnHouse editor (TipTap) JSON.

Every conversion result is run through ``assert_valid_blocks``, a recursive
validator of the editor schema (node names, content rules, mark rules), so a
change that emits a node the editor would drop or reject fails here.
"""

from __future__ import annotations

import base64

import pytest

from src.services.courses.lms_import import html_to_tiptap as h2t
from src.services.courses.lms_import.html_to_tiptap import (
    HtmlConverter,
    embed_node,
    embed_url_for,
    heading,
    html_assets,
    html_to_text,
    is_http_url,
    math_node,
    media_kind_for,
    paragraph,
    paragraph_text,
    text_node,
    vimeo_id,
    youtube_id,
)
from src.services.courses.lms_import.ir import Asset, MediaKind, RichText

# ---------------------------------------------------------------------------
# Schema validator (shared with the package tests)
# ---------------------------------------------------------------------------

INLINE_TYPES = {"text", "hardBreak"}
MARK_TYPES = {"bold", "italic", "underline", "strike", "code", "link"}
CALLOUT_TYPES = {"info", "warning", "tip", "success", "error"}
CALLOUT_CHILDREN = {"paragraph", "bulletList", "orderedList"}
ATOM_BLOCKS = {
    "horizontalRule", "blockImage", "blockVideo", "blockAudio", "blockPDF", "blockEmbed",
    "blockMathEquation", "blockQuiz", "blockWebPreview", "blockLibrary",
}
BLOCK_TYPES = {
    "paragraph", "heading", "bulletList", "orderedList", "blockquote", "codeBlock", "table",
    "callout", "flipcardGrid", "flipcard", *ATOM_BLOCKS,
}
ALLOWED_KEYS = {"type", "content", "attrs", "marks", "text"}


class SchemaError(AssertionError):
    pass


def _fail(path: str, msg: str):
    raise SchemaError(f"{path}: {msg}")


def _check_keys(node: dict, path: str):
    extra = set(node) - ALLOWED_KEYS
    if extra:
        _fail(path, f"unexpected keys {sorted(extra)}")


def _check_inline(nodes, path: str):
    if not isinstance(nodes, list):
        _fail(path, "inline content must be a list")
    for i, n in enumerate(nodes):
        p = f"{path}[{i}]"
        if not isinstance(n, dict):
            _fail(p, "node must be a dict")
        _check_keys(n, p)
        t = n.get("type")
        if t not in INLINE_TYPES:
            _fail(p, f"block or unknown node '{t}' in inline content")
        if t == "hardBreak":
            if "content" in n or "text" in n:
                _fail(p, "hardBreak must be empty")
            continue
        if not isinstance(n.get("text"), str) or n["text"] == "":
            _fail(p, "text node must have non-empty text")
        marks = n.get("marks", [])
        if "marks" in n and not marks:
            _fail(p, "empty marks list")
        types = [m.get("type") for m in marks]
        if len(set(types)) != len(types):
            _fail(p, f"duplicate marks {types}")
        for m in marks:
            if m.get("type") not in MARK_TYPES:
                _fail(p, f"unknown mark {m}")
            if m["type"] == "link":
                href = (m.get("attrs") or {}).get("href", "")
                if not is_http_url(href):
                    _fail(p, f"link mark with non-http href {href!r}")
        if "code" in types and len(types) > 1:
            _fail(p, f"code mark combined with {types}")


def _check_blocks(nodes, path: str, *, allow_empty: bool = False):
    if not isinstance(nodes, list):
        _fail(path, "content must be a list")
    if not nodes and not allow_empty:
        _fail(path, "block+ content is empty")
    for i, n in enumerate(nodes):
        _check_block(n, f"{path}[{i}]")


def _check_block(n, path: str):
    if not isinstance(n, dict):
        _fail(path, "node must be a dict")
    _check_keys(n, path)
    t = n.get("type")
    if t not in BLOCK_TYPES:
        _fail(path, f"unknown or inline node '{t}' at block level")
    attrs = n.get("attrs") or {}
    content = n.get("content")
    p = f"{path}<{t}>"
    if t == "paragraph":
        if content is not None:
            _check_inline(content, p)
    elif t == "heading":
        if attrs.get("level") not in range(1, 7):
            _fail(p, f"bad heading level {attrs.get('level')}")
        if content is not None:
            _check_inline(content, p)
    elif t in ("bulletList", "orderedList"):
        if not content:
            _fail(p, "list without items")
        for j, li in enumerate(content):
            lp = f"{p}[{j}]"
            _check_keys(li, lp)
            if li.get("type") != "listItem":
                _fail(lp, f"list child is {li.get('type')}")
            lc = li.get("content")
            if not lc or lc[0].get("type") != "paragraph":
                _fail(lp, "listItem must start with a paragraph")
            _check_blocks(lc, lp)
        if t == "orderedList":
            start = attrs.get("start", 1)
            if not isinstance(start, int) or start < 0:
                _fail(p, f"bad start {start!r}")
    elif t == "blockquote":
        _check_blocks(content, p)
    elif t == "codeBlock":
        if "language" not in attrs:
            _fail(p, "codeBlock without language attr")
        for tn in content or []:
            if tn.get("type") != "text" or tn.get("marks") or not tn.get("text"):
                _fail(p, f"codeBlock may only hold unmarked text, got {tn}")
    elif t == "table":
        if not content:
            _fail(p, "table without rows")
        for j, row in enumerate(content):
            rp = f"{p}[{j}]"
            _check_keys(row, rp)
            if row.get("type") != "tableRow" or not row.get("content"):
                _fail(rp, "table child must be a non-empty tableRow")
            for k, cell in enumerate(row["content"]):
                cp = f"{rp}[{k}]"
                _check_keys(cell, cp)
                if cell.get("type") not in ("tableCell", "tableHeader"):
                    _fail(cp, f"row child is {cell.get('type')}")
                ca = cell.get("attrs") or {}
                for span in ("colspan", "rowspan"):
                    if not isinstance(ca.get(span, 1), int) or ca.get(span, 1) < 1:
                        _fail(cp, f"bad {span}")
                _check_blocks(cell.get("content"), cp)
    elif t == "callout":
        if attrs.get("type") not in CALLOUT_TYPES:
            _fail(p, f"bad callout type {attrs.get('type')}")
        if not content:
            _fail(p, "callout must hold at least one block")
        for j, c in enumerate(content):
            if c.get("type") not in CALLOUT_CHILDREN:
                _fail(f"{p}[{j}]", f"callout cannot hold {c.get('type')}")
        _check_blocks(content, p)
    elif t == "flipcardGrid":
        if not content:
            _fail(p, "empty flipcardGrid")
        for j, c in enumerate(content):
            if c.get("type") != "flipcard":
                _fail(f"{p}[{j}]", "flipcardGrid holds flipcards only")
            _check_block(c, f"{p}[{j}]")
    elif t == "flipcard":
        if not attrs.get("question") or not attrs.get("answer"):
            _fail(p, "flipcard without question/answer")
        if content:
            _check_inline(content, p)
    else:  # atoms
        if content:
            _fail(p, "atom node with content")
        if t in ("blockImage", "blockVideo", "blockAudio", "blockPDF"):
            bo = attrs.get("blockObject")
            if bo is None:
                if t != "blockImage" or not attrs.get("unsplash_url"):
                    _fail(p, "media node without blockObject")
            else:
                if not bo.get("block_uuid") or not (bo.get("content") or {}).get("file_id"):
                    _fail(p, f"bad blockObject {bo}")
        elif t == "blockEmbed":
            if not attrs.get("embedUrl") and not attrs.get("embedCode"):
                _fail(p, "embed with neither url nor code")
            if attrs.get("embedUrl") and not is_http_url(attrs["embedUrl"]):
                _fail(p, "embed with non-http url")
        elif t == "blockMathEquation":
            if not (attrs.get("math_equation") or "").strip():
                _fail(p, "empty equation")
        elif t == "blockQuiz":
            if not attrs.get("quizId") or not attrs.get("questions"):
                _fail(p, "quiz without id or questions")
            for q in attrs["questions"]:
                if q.get("type") != "multiple_choice" or q.get("response_type") not in ("single", "multiple"):
                    _fail(p, f"bad quiz question {q}")
                if not q.get("question_id") or not isinstance(q.get("question"), str):
                    _fail(p, "quiz question without id/text")
                if not 1 <= len(q.get("answers", [])) <= 5:
                    _fail(p, f"quiz question must have 1..5 answers, got {len(q.get('answers', []))}")
                for a in q["answers"]:
                    if not a.get("answer_id") or not isinstance(a.get("correct"), bool):
                        _fail(p, f"bad answer {a}")
        elif t == "blockWebPreview":
            if not is_http_url(attrs.get("url") or ""):
                _fail(p, "web preview without url")
        elif t == "blockLibrary":
            if attrs.get("resourceType") != "media" or not str(attrs.get("resourceUuid") or "").startswith("media_"):
                _fail(p, f"library block without a media resource {attrs}")
            snap = attrs.get("snapshot") or {}
            if not snap.get("name") or not snap.get("file_format") or snap.get("media_type") != "UPLOAD":
                _fail(p, f"library block with a bad snapshot {snap}")


def assert_valid_blocks(blocks) -> list:
    _check_blocks(blocks, "doc", allow_empty=True)
    return blocks


def assert_valid_doc(doc: dict) -> dict:
    if doc.get("type") != "doc":
        raise SchemaError("root must be a doc")
    _check_blocks(doc.get("content"), "doc")
    return doc


def walk(nodes):
    for n in nodes or []:
        yield n
        yield from walk(n.get("content"))


def types_of(nodes) -> list[str]:
    return [n["type"] for n in walk(nodes)]


def all_text(nodes) -> str:
    return "".join(n.get("text", "") for n in walk(nodes))


# ---------------------------------------------------------------------------
# Fake media sink
# ---------------------------------------------------------------------------


class FakeSink:
    def __init__(self, refuse: bool = False):
        self.calls: list[tuple] = []
        self.remote: list[str] = []
        self.library: list[tuple] = []
        self.missing: list[str] = []
        self.scratch: dict[str, bytes] = {}
        self.refuse = refuse

    def library_node(self, asset, *, title=""):
        self.library.append((asset.name, title))
        if self.refuse:
            return None
        return {"type": "blockLibrary", "attrs": {
            "resourceUuid": f"media_{len(self.library)}", "resourceType": "media", "display": "inline",
            "snapshot": {"name": title or asset.name, "media_type": "UPLOAD", "file_format": asset.extension,
                         "file_mime": "", "file_size": 1, "url": "", "thumbnail_image": ""}}}

    def missing_file(self, name):
        self.missing.append(name)

    def media_node(self, kind, asset, *, alt="", width=None, alignment="center"):
        self.calls.append((kind, asset.name, alt, width, alignment))
        if self.refuse:
            return None
        bo = {"block_uuid": f"block_{len(self.calls)}", "content": {"file_id": f"f{len(self.calls)}"}}
        name = {MediaKind.IMAGE: "blockImage", MediaKind.VIDEO: "blockVideo", MediaKind.AUDIO: "blockAudio",
                MediaKind.PDF: "blockPDF"}[kind]
        return {"type": name, "attrs": {"blockObject": bo, "alignment": alignment}}

    def remote_image_node(self, url, *, width=None, alignment="center"):
        self.remote.append(url)
        return {"type": "blockImage", "attrs": {"blockObject": None, "unsplash_url": url, "alignment": alignment,
                                                "size": {"width": width}}}

    def scratch_file(self, name, data):
        self.scratch[name] = data
        return Asset(path=f"/scratch/{name}", name=name)


FILES = {
    "img/a.png": "a.png",
    "img/b.jpg": "b.jpg",
    "files/doc.pdf": "doc.pdf",
    "files/report.docx": "report.docx",
    "media/clip.mp4": "clip.mp4",
    "media/song.mp3": "song.mp3",
    "media/unknown.xyz": "unknown.xyz",
}


def resolver(url: str):
    key = url.split("?")[0].lstrip("./")
    if key in FILES:
        return Asset(path=f"/export/{key}", name=FILES[key])
    return None


def conv(html: str, *, refuse: bool = False, resolve=resolver):
    sink = FakeSink(refuse=refuse)
    warnings: list[str] = []
    c = HtmlConverter(sink, warnings.append)
    out = c.convert(RichText(html, resolve))
    assert_valid_blocks(out)
    return out, sink, warnings


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------


def test_media_kind_for_names_assets_and_urls():
    assert media_kind_for("a.PNG") == MediaKind.IMAGE
    assert media_kind_for("x.jpeg") == MediaKind.IMAGE
    assert media_kind_for("v.m4v") == MediaKind.VIDEO
    assert media_kind_for("s.oga") == MediaKind.AUDIO
    assert media_kind_for("d.pdf") == MediaKind.PDF
    assert media_kind_for("d.docx") is None
    assert media_kind_for("https://cdn.example.com/x/y.mp4?sig=1") == MediaKind.VIDEO
    assert media_kind_for(Asset(path="/tmp/zzz", name="photo.webp")) == MediaKind.IMAGE


@pytest.mark.parametrize("url,expected", [
    ("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("https://www.youtube.com/watch?feature=share&v=dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("https://youtu.be/dQw4w9WgXcQ?t=3", "dQw4w9WgXcQ"),
    ("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("https://youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
    ("https://example.com/watch?v=dQw4w9WgXcQ", None),
    ("", None),
    (None, None),
])
def test_youtube_id(url, expected):
    assert youtube_id(url) == expected


@pytest.mark.parametrize("url,expected", [
    ("https://vimeo.com/123456", "123456"),
    ("https://player.vimeo.com/video/987", "987"),
    ("https://vimeo.com/channels/staff/42", "42"),
    ("https://vimeo.com/groups/g/videos/77", "77"),
    ("https://example.com/1", None),
])
def test_vimeo_id(url, expected):
    assert vimeo_id(url) == expected


def test_embed_url_for():
    assert embed_url_for("https://youtu.be/dQw4w9WgXcQ") == "https://www.youtube.com/embed/dQw4w9WgXcQ"
    assert embed_url_for("https://vimeo.com/42") == "https://player.vimeo.com/video/42"
    assert embed_url_for("https://h5p.org/x") == "https://h5p.org/x"


def test_is_http_url():
    assert is_http_url("https://a.b/c")
    assert is_http_url("  HTTP://a.b ")
    assert not is_http_url("http:///nohost")
    assert not is_http_url("mailto:a@b.c")
    assert not is_http_url("javascript:alert(1)")
    assert not is_http_url("/relative")
    assert not is_http_url("http://[::1")  # urlparse ValueError


def test_unparsable_urls_do_not_sink_the_page():
    # urlparse raises ValueError("Invalid IPv6 URL") on these; the page must survive
    assert media_kind_for("http://[x/a.png") is None
    assert h2t._safe_urlparse("http://[x").path == ""
    out, sink, _ = conv('<p><a href="http://[x">one</a> <a href="//[x">two</a><img src="http://[x/a.png"></p>')
    assert all_text(out) == "one two"
    assert not any(m.get("type") == "link" for n in walk(out) for m in n.get("marks", []))
    assert sink.missing == [] and sink.calls == []


def test_node_builders():
    assert text_node("x") == {"type": "text", "text": "x"}
    marks = [{"type": "bold"}]
    tn = text_node("x", marks)
    assert tn["marks"] == marks and tn["marks"][0] is not marks[0]
    assert paragraph() == {"type": "paragraph"}
    assert paragraph_text("") == {"type": "paragraph"}
    assert paragraph_text("hi")["content"][0]["text"] == "hi"
    assert heading("T", 9)["attrs"]["level"] == 6
    assert heading("T", 0)["attrs"]["level"] == 1
    assert "content" not in heading("")
    assert math_node("  x^2 ")["attrs"]["math_equation"] == "x^2"


def test_embed_node_attrs():
    e = embed_node("https://youtu.be/dQw4w9WgXcQ", height=50)
    assert e["attrs"]["embedUrl"] == "https://www.youtube.com/embed/dQw4w9WgXcQ"
    assert e["attrs"]["embedType"] == "url"
    assert e["attrs"]["embedHeight"] == 150
    code = embed_node(code="<iframe></iframe>", height=99999)
    assert code["attrs"]["embedType"] == "code" and code["attrs"]["embedUrl"] is None
    assert code["attrs"]["embedHeight"] == 2000
    assert embed_node("https://a.b", height=0)["attrs"]["embedHeight"] == 500
    assert_valid_blocks([e, code])


# ---------------------------------------------------------------------------
# Conversion: text, marks, whitespace
# ---------------------------------------------------------------------------


def test_empty_and_none():
    c = HtmlConverter(FakeSink())
    assert c.convert(None) == []
    assert c.convert(RichText("   \n ")) == []
    out, _, _ = conv("<p>&nbsp;</p><p> </p><div><br><br></div>")
    assert out == []


def test_plain_text_becomes_paragraph():
    out, _, _ = conv("Just text")
    assert out == [{"type": "paragraph", "content": [{"type": "text", "text": "Just text"}]}]


def test_word_pasted_html():
    html = """
    <html><head><meta charset="utf-8"><style>p.MsoNormal{margin:0}</style>
    <script>alert(1)</script><title>Doc</title></head>
    <body>
    <div class="WordSection1"><div><div>
    <p class="MsoNormal"><span style="font-family:Calibri;font-size:11pt"><o:p>&nbsp;</o:p></span></p>
    <p class="MsoNormal"><span style='font-weight:bold'>Bold</span> <span style="font-style:italic">it</span>
       <span style="text-decoration: underline">un</span><font face="Arial" color="red">font</font></p>
    <!--[if gte mso 9]><xml>junk</xml><![endif]-->
    <p class=MsoListParagraph>  lots    of
       spaces  </p>
    </div></div></div>
    <noscript>nojs</noscript><form><input value="x"><button>Go</button></form>
    </body></html>
    """
    out, _, _ = conv(html)
    text = all_text(out)
    assert "alert" not in text and "junk" not in text and "Doc" not in text
    assert "nojs" not in text and "Go" not in text and "p.MsoNormal" not in text
    para = out[0]["content"]
    assert {"type": "text", "text": "Bold", "marks": [{"type": "bold"}]} in para
    assert {"type": "text", "text": "it", "marks": [{"type": "italic"}]} in para
    assert {"type": "text", "text": "un", "marks": [{"type": "underline"}]} in para
    assert any(n["text"].endswith("font") and "marks" not in n for n in para)
    assert out[-1]["content"] == [{"type": "text", "text": "lots of spaces"}]


def test_marks_nested_and_deduplicated():
    out, _, _ = conv("<p><b>a<strong>b<i>c<em>d</em></i></strong></b><u>e</u><s>f</s><del>g</del><ins>h</ins></p>")
    content = out[0]["content"]
    assert content[0] == {"type": "text", "text": "ab", "marks": [{"type": "bold"}]}
    assert content[1] == {"type": "text", "text": "cd", "marks": [{"type": "bold"}, {"type": "italic"}]}
    assert {"type": "text", "text": "fg", "marks": [{"type": "strike"}]} in content


def test_span_styles_do_not_duplicate_marks():
    out, _, _ = conv('<p><b><span style="font-weight:700">x</span></b>'
                     '<i><span style="font-style:italic">y</span></i>'
                     '<u><span style="text-decoration:underline">z</span></u></p>')
    for n in out[0]["content"]:
        assert len(n["marks"]) == 1


def test_code_mark_is_exclusive():
    out, _, _ = conv('<p><b>x<code>y<i>z</i><span style="font-weight:bold">w</span>'
                     '<a href="https://e.com">l</a></code></b> <kbd>k</kbd></p>')
    for n in walk(out):
        marks = [m["type"] for m in n.get("marks", [])]
        if "code" in marks:
            assert marks == ["code"]
    assert {"type": "text", "text": "yzwl", "marks": [{"type": "code"}]} in out[0]["content"]


def test_br_runs_and_trailing_breaks():
    out, _, _ = conv("<p><br><br>a<br>b<br><br><br></p>")
    assert out[0]["content"] == [
        {"type": "text", "text": "a"}, {"type": "hardBreak"}, {"type": "text", "text": "b"},
    ]


def test_comments_are_removed():
    out, _, _ = conv("<p>a<!-- secret -->b</p><!-- top -->")
    assert all_text(out) == "ab"


def test_whitespace_across_elements_collapses():
    out, _, _ = conv("<p>one <b> two </b> three</p>")
    texts = [n["text"] for n in out[0]["content"]]
    assert "".join(texts) == "one two three"
    assert "  " not in "".join(texts)


def test_unknown_inline_tags_are_flattened():
    out, _, _ = conv("<p>H<sub>2</sub>O and x<sup>2</sup> <abbr>abbr</abbr> <custom-el>c</custom-el></p>")
    assert all_text(out) == "H2O and x2 abbr c"


# ---------------------------------------------------------------------------
# Headings
# ---------------------------------------------------------------------------


def test_headings_with_inline_image_and_block_children():
    out, sink, _ = conv('<h2>Title <img src="img/a.png"> after</h2><h6><p>Para in heading</p></h6><h3> </h3>')
    assert out[0]["type"] == "heading" and out[0]["attrs"]["level"] == 2
    assert all(n["type"] in ("text", "hardBreak") for n in out[0]["content"])
    assert out[1]["type"] == "blockImage"
    assert out[2]["type"] == "heading" and all_text([out[2]]) == "Para in heading"
    assert len(out) == 3  # empty heading dropped
    assert sink.calls[0][0] == MediaKind.IMAGE


def test_heading_with_list_and_math_inside():
    out, _, _ = conv("<h1>Topic \\(x^2\\)<ul><li>a</li></ul></h1>")
    assert out[0]["type"] == "heading"
    assert {"type": "text", "text": "x^2", "marks": [{"type": "italic"}]} in out[0]["content"]
    assert out[1]["type"] == "bulletList"


# ---------------------------------------------------------------------------
# Lists
# ---------------------------------------------------------------------------


def test_nested_lists():
    out, _, _ = conv("<ul><li>a<ul><li>a1</li><li><ol start='3'><li>deep</li></ol></li></ul></li><li>b</li></ul>")
    lst = out[0]
    assert lst["type"] == "bulletList" and len(lst["content"]) == 2
    first = lst["content"][0]["content"]
    assert first[0]["type"] == "paragraph" and first[1]["type"] == "bulletList"
    inner_ol = first[1]["content"][1]["content"]
    assert inner_ol[0] == {"type": "paragraph"}  # inserted before the leading list
    assert inner_ol[1]["type"] == "orderedList" and inner_ol[1]["attrs"]["start"] == 3


def test_ordered_list_start_attribute():
    out, _, _ = conv("<ol><li>a</li></ol><ol start='x'><li>b</li></ol>")
    assert out[0]["attrs"] == {"start": 1, "type": None}
    assert out[1]["attrs"]["start"] == 1


def test_list_with_stray_text_and_tags():
    out, _, _ = conv("<ul>stray<li>item</li><b>bold stray</b>\n</ul>")
    items = out[0]["content"]
    assert len(items) == 2
    assert "stray" in all_text([items[1]]) and "bold stray" in all_text([items[1]])


def test_list_stray_block_gets_leading_paragraph():
    out, _, _ = conv("<ul><li>a</li><table><tr><td>t</td></tr></table></ul>")
    stray = out[0]["content"][1]
    assert stray["content"][0] == {"type": "paragraph"}
    assert stray["content"][1]["type"] == "table"


def test_empty_list_and_empty_item():
    out, _, _ = conv("<ul></ul><ol><li></li></ol>")
    assert out[0] == {"type": "bulletList", "content": [{"type": "listItem", "content": [{"type": "paragraph"}]}]}
    assert out[1]["content"][0]["content"] == [{"type": "paragraph"}]


def test_list_item_with_image_first():
    out, _, _ = conv('<ul><li><img src="img/a.png">caption</li></ul>')
    li = out[0]["content"][0]["content"]
    assert li[0] == {"type": "paragraph"}
    assert li[1]["type"] == "blockImage"
    assert li[2]["content"][0]["text"] == "caption"


def test_stray_li_outside_list_and_dl():
    out, _, _ = conv("<li>orphan</li><dl><dt>Term</dt><dd>Def</dd><dt></dt></dl>")
    assert out[0]["content"][0]["text"] == "orphan"
    assert out[1]["content"][0] == {"type": "text", "text": "Term", "marks": [{"type": "bold"}]}
    assert out[2]["content"][0]["text"] == "Def"
    assert len(out) == 3


def test_details_summary():
    out, _, _ = conv("<details><summary>More</summary><p>hidden</p></details><details><summary></summary></details>")
    assert out[0]["content"][0]["marks"] == [{"type": "bold"}]
    assert out[1]["content"][0]["text"] == "hidden"
    assert len(out) == 2


# ---------------------------------------------------------------------------
# Blockquote, code, hr
# ---------------------------------------------------------------------------


def test_blockquote():
    out, _, _ = conv("<blockquote><p>q</p><ul><li>x</li></ul></blockquote><blockquote> </blockquote>")
    assert out[0]["type"] == "blockquote" and len(out[0]["content"]) == 2
    assert len(out) == 1


def test_pre_with_br_and_language_classes():
    out, _, _ = conv('<pre class="language-python">a = 1<br>b = 2<br/></pre>'
                     '<pre><code class="lang-js">x()</code></pre>'
                     '<pre class="brush-cpp">int x;</pre>'
                     '<pre class="hljs">plain</pre>'
                     '<pre>\n\n</pre>')
    assert out[0] == {"type": "codeBlock", "attrs": {"language": "python"},
                      "content": [{"type": "text", "text": "a = 1\nb = 2"}]}
    assert out[1]["attrs"]["language"] == "js"
    assert out[2]["attrs"]["language"] == "cpp"
    assert out[3]["attrs"]["language"] is None
    assert out[4] == {"type": "codeBlock", "attrs": {"language": None}}


def test_pre_keeps_inner_markup_as_text():
    out, _, _ = conv("<pre><b>if</b> x &lt; 1:\n    pass</pre>")
    assert out[0]["content"][0]["text"] == "if x < 1:\n    pass"


def test_hr():
    out, _, _ = conv("<p>a</p><hr><p>b</p>")
    assert [n["type"] for n in out] == ["paragraph", "horizontalRule", "paragraph"]


# ---------------------------------------------------------------------------
# Tables
# ---------------------------------------------------------------------------


def test_table_with_header_spans_and_caption():
    out, _, _ = conv("""
      <table><caption>Results</caption>
        <thead><tr><th colspan="2">Head</th></tr></thead>
        <tbody><tr><td rowspan="2">a</td><td colspan="0">b</td></tr>
               <tr><td colspan="x"></td></tr></tbody>
      </table>""")
    assert out[0]["content"][0]["marks"] == [{"type": "bold"}]
    table = out[1]
    assert table["type"] == "table" and len(table["content"]) == 3
    head = table["content"][0]["content"][0]
    assert head["type"] == "tableHeader" and head["attrs"]["colspan"] == 2
    a, b = table["content"][1]["content"]
    assert a["attrs"]["rowspan"] == 2 and b["attrs"]["colspan"] == 1
    assert table["content"][2]["content"][0]["content"] == [{"type": "paragraph"}]


def test_nested_tables_become_siblings():
    out, _, _ = conv("<table><tr><td>outer<table><tr><td>inner</td></tr></table></td></tr></table>")
    tables = [n for n in out if n["type"] == "table"]
    assert len(tables) == 2
    assert "inner" not in all_text([tables[0]])
    assert all_text([tables[1]]) == "inner"


def test_table_cell_with_only_nested_table_is_not_empty():
    out, _, _ = conv("<table><tr><td><table><tr><td>x</td></tr></table></td></tr></table>")
    assert out[0]["content"][0]["content"][0]["content"] == [{"type": "paragraph"}]


def test_table_with_image_and_list_in_cells():
    out, _, _ = conv('<table><tr><td><img src="img/a.png"></td><td><ul><li>x</li></ul></td></tr></table>')
    cells = out[0]["content"][0]["content"]
    assert cells[0]["content"][0]["type"] == "blockImage"
    assert cells[1]["content"][0]["type"] == "bulletList"


def test_empty_table_and_stray_cells():
    out, _, _ = conv("<table></table><table><caption> </caption></table><td>loose</td>")
    assert out == [{"type": "paragraph", "content": [{"type": "text", "text": "loose"}]}]


# ---------------------------------------------------------------------------
# Links
# ---------------------------------------------------------------------------


def test_http_link_mark():
    out, _, _ = conv('<p><a href="https://example.com/x">go <b>here</b></a></p>')
    link = {"type": "link", "attrs": {"href": "https://example.com/x", "target": "_blank",
                                      "rel": "noopener noreferrer", "class": None}}
    assert out[0]["content"][0] == {"type": "text", "text": "go ", "marks": [link]}
    assert out[0]["content"][1]["marks"] == [link, {"type": "bold"}]


def test_protocol_relative_link():
    out, _, w = conv('<p><a href="//example.com/x">x</a></p>')
    assert out[0]["content"][0]["marks"][0]["attrs"]["href"] == "https://example.com/x"
    assert w == []


def test_non_http_links_have_no_mark():
    out, _, w = conv('<p><a href="mailto:a@b.c">mail</a> <a href="javascript:x()">js</a> '
                     '<a href="#anchor">anchor</a> <a>bare</a> <a href="tel:1">tel</a></p>')
    assert all("marks" not in n for n in out[0]["content"])
    assert all_text(out) == "mail js anchor bare tel"
    assert w == []


def test_relative_file_links():
    out, sink, w = conv('<p>See <a href="files/doc.pdf">the doc</a>, <a href="img/b.jpg">pic</a>, '
                        '<a href="files/report.docx">report</a> and <a href="nope.pdf">missing</a>.</p>')
    kinds = [c[0] for c in sink.calls]
    assert kinds == [MediaKind.PDF, MediaKind.IMAGE]
    assert sink.calls[0][2] == "the doc"
    types = [n["type"] for n in out]
    # A file with no player becomes a Library download; a missing one is reported as skipped
    assert types == ["paragraph", "blockPDF", "paragraph", "blockImage", "paragraph", "blockLibrary", "paragraph"]
    assert sink.library == [("report.docx", "report")]
    assert sink.missing == ["nope.pdf"] and w == []


def test_links_into_the_source_platform_are_silent():
    out, sink, w = conv('<p><a href="/d2l/le/lti/1/toolLaunch/4">Tool</a> <a href="$WIKI_REFERENCE$/pages/x">Wiki</a> '
                        '<a href="/courses/1/pages/intro">Page</a> <a href="../mod/forum/view.php?id=3">Forum</a></p>')
    assert out == [{"type": "paragraph", "content": [{"type": "text", "text": "Tool Wiki Page Forum"}]}]
    assert sink.missing == [] and w == []


def test_relative_link_without_resolver_is_text():
    sink = FakeSink()
    c = HtmlConverter(sink)
    c._resolve = None
    out = c._anchor(h2t.BeautifulSoup('<a href="x.pdf">x</a>', "html.parser").a, [])
    assert out == [{"type": "text", "text": "x"}]


def test_link_file_refused_by_sink():
    out, _, _ = conv('<p><a href="files/doc.pdf">doc</a></p>', refuse=True)
    assert out == [{"type": "paragraph", "content": [{"type": "text", "text": "doc"}]}]


# ---------------------------------------------------------------------------
# Media
# ---------------------------------------------------------------------------


def test_inline_images_split_paragraphs():
    out, sink, _ = conv('<p>before <img src="img/a.png" alt="A" width="300" style="float:right"> after</p>')
    assert [n["type"] for n in out] == ["paragraph", "blockImage", "paragraph"]
    assert sink.calls == [(MediaKind.IMAGE, "a.png", "A", 300, "right")]


def test_image_attributes():
    _, sink, _ = conv('<img src="img/a.png" title="T" style="width: 120px" align="left">'
                      '<img data-src="img/b.jpg" width="50%">')
    assert sink.calls[0] == (MediaKind.IMAGE, "a.png", "T", 120, "left")
    assert sink.calls[1] == (MediaKind.IMAGE, "b.jpg", "", None, "center")


def test_remote_and_protocol_relative_images():
    out, sink, _ = conv('<img src="https://cdn.example.com/a.png"><img src="//cdn.example.com/b.png">')
    assert sink.remote == ["https://cdn.example.com/a.png", "https://cdn.example.com/b.png"]
    assert all(n["attrs"]["blockObject"] is None for n in out)


def test_missing_image_is_reported_as_skipped():
    out, sink, w = conv('<p>x<img src="gone.png"></p><img src="">')
    assert out == [{"type": "paragraph", "content": [{"type": "text", "text": "x"}]}]
    assert sink.missing == ["gone.png"] and w == []


def test_image_without_resolver():
    out, sink, w = conv('<img src="img/a.png">', resolve=None)
    assert out == [] and sink.missing == ["a.png"] and not w


def test_image_refused_by_sink():
    out, _, _ = conv('<img src="img/a.png"><img src="data:image/png;base64,iVBORw0KGgo=">', refuse=True)
    assert out == []


def test_data_uri_images():
    payload = base64.b64encode(b"\x89PNG\r\n\x1a\nfake").decode()
    out, sink, _ = conv(f'<img src="data:image/png;base64,{payload}">'
                        f'<img src="data:image/jpeg;base64,{payload}">'
                        '<img src="data:image/svg+xml;base64,PHN2Zz4=">'
                        '<img src="data:image/gif;base64,@@@">')
    names = list(sink.scratch)
    assert names[0].startswith("inline-") and names[0].endswith(".png")
    assert names[1].endswith(".jpg")
    assert sink.scratch[names[0]] == b"\x89PNG\r\n\x1a\nfake"
    # svg is not an accepted data URI type; "@@@" decodes to nothing
    assert len(sink.scratch) == 2
    assert len([n for n in out if n["type"] == "blockImage"]) == 2


def test_data_uri_decode_error(monkeypatch):
    def boom(*_a, **_k):
        raise ValueError("bad")

    monkeypatch.setattr(h2t.base64, "b64decode", boom)
    out, sink, _ = conv('<img src="data:image/png;base64,AAAA">')
    assert out == [] and not sink.scratch


def test_canvas_equation_images():
    out, sink, _ = conv('<p>Solve <img class="equation_image" src="/equation_images/x" '
                        'data-equation-content="x^2 + 1 = 0"> now</p>')
    assert [n["type"] for n in out] == ["paragraph", "blockMathEquation", "paragraph"]
    assert out[1]["attrs"]["math_equation"] == "x^2 + 1 = 0"
    assert sink.calls == []


@pytest.mark.parametrize("src,expected", [
    ("https://www.youtube.com/embed/dQw4w9WgXcQ", "https://www.youtube.com/embed/dQw4w9WgXcQ"),
    ("//player.vimeo.com/video/42", "https://player.vimeo.com/video/42"),
    ("https://h5p.org/h5p/embed/1", "https://h5p.org/h5p/embed/1"),
])
def test_iframes(src, expected):
    out, _, _ = conv(f'<p>x<iframe src="{src}" height="300px"></iframe></p>')
    embed = out[1]
    assert embed["type"] == "blockEmbed" and embed["attrs"]["embedUrl"] == expected
    assert embed["attrs"]["embedHeight"] == 300


def test_iframe_non_http_and_data_src():
    out, _, _ = conv('<iframe src="javascript:alert(1)"></iframe><iframe src="about:blank"></iframe>'
                     '<iframe></iframe><iframe data-src="https://e.com/x" height="abc"></iframe>')
    assert len(out) == 1 and out[0]["attrs"]["embedUrl"] == "https://e.com/x"
    assert out[0]["attrs"]["embedHeight"] == 500


def test_video_audio_and_sources():
    out, sink, w = conv('<video><source src="media/missing.mp4"><source src="media/clip.mp4"></video>'
                        '<audio src="media/song.mp3" title="Song"></audio>'
                        '<video src="https://youtu.be/dQw4w9WgXcQ"></video>'
                        '<audio src="https://cdn.example.com/a.mp3"></audio>'
                        '<video src="https://cdn.example.com/v.mp4"></video>'
                        '<video></video>')
    assert [n["type"] for n in out] == ["blockVideo", "blockAudio", "blockEmbed", "blockEmbed", "blockEmbed"]
    assert sink.calls[1] == (MediaKind.AUDIO, "song.mp3", "Song", None, "center")
    assert out[2]["attrs"]["embedUrl"] == "https://www.youtube.com/embed/dQw4w9WgXcQ"
    assert out[3]["attrs"]["embedHeight"] == 160 and out[4]["attrs"]["embedHeight"] == 450
    assert sink.missing == ["missing.mp4"] and w == []


def test_media_file_with_unknown_extension():
    # <video>/<audio> pass the tag's kind on (the package writer rejects the format);
    # <object> has no kind to go by, so the file is dropped here
    out, sink, _ = conv('<video src="media/unknown.xyz"></video><object data="media/unknown.xyz"></object>')
    assert [n["type"] for n in out] == ["blockVideo"]
    assert sink.calls == [(MediaKind.VIDEO, "unknown.xyz", "", None, "center")]


def test_object_and_embed_tags():
    out, sink, _ = conv('<object data="files/doc.pdf"></object><embed src="https://cdn.example.com/x.png">'
                        '<embed src="https://example.com/flash.swf"><object></object>')
    assert [n["type"] for n in out] == ["blockPDF", "blockImage", "blockEmbed"]
    assert sink.remote == ["https://cdn.example.com/x.png"]


def test_media_kind_from_asset_overrides_tag():
    _, sink, _ = conv('<audio src="media/clip.mp4"></audio>')
    assert sink.calls[0][0] == MediaKind.VIDEO


# ---------------------------------------------------------------------------
# Math
# ---------------------------------------------------------------------------


def test_display_math_alone():
    out, _, _ = conv("<p>$$E=mc^2$$</p><p> \\[ a+b \\] </p><p><b>\\(x\\)</b></p>")
    assert [n["attrs"]["math_equation"] for n in out] == ["E=mc^2", "a+b", "x"]


def test_two_display_formulas_in_one_paragraph():
    out, _, _ = conv("<p>$$a$$ and $$b$$</p>")
    assert [n["type"] for n in out] == ["blockMathEquation", "paragraph", "blockMathEquation"]
    assert out[0]["attrs"]["math_equation"] == "a" and out[2]["attrs"]["math_equation"] == "b"


def test_two_inline_formulas_alone_stay_inline():
    out, _, _ = conv("<p>\\(a\\) and \\(b\\)</p>")
    assert out[0]["type"] == "paragraph"
    assert out[0]["content"] == [
        {"type": "text", "text": "a", "marks": [{"type": "italic"}]},
        {"type": "text", "text": " and "},
        {"type": "text", "text": "b", "marks": [{"type": "italic"}]},
    ]


def test_display_math_mixed_with_text():
    out, _, _ = conv("<p>Before $$x^2$$ middle \\[y\\] after \\(z\\)</p>")
    assert [n["type"] for n in out] == ["paragraph", "blockMathEquation", "paragraph", "blockMathEquation",
                                        "paragraph"]
    assert out[4]["content"][-1] == {"type": "text", "text": "z", "marks": [{"type": "italic"}]}


def test_display_math_with_marks_stays_paragraph():
    out, _, _ = conv("<p><b>Bold</b> $$x$$ rest</p>")
    assert len(out) == 1 and out[0]["type"] == "paragraph"


def test_inline_math_inside_marked_text():
    out, _, _ = conv("<p><i>let \\(x\\) be</i> <code>\\(raw\\)</code></p>")
    content = out[0]["content"]
    assert content[0] == {"type": "text", "text": "let ", "marks": [{"type": "italic"}]}
    assert content[1] == {"type": "text", "text": "x", "marks": [{"type": "italic"}]}
    assert {"type": "text", "text": "\\(raw\\)", "marks": [{"type": "code"}]} in content


def test_edx_mathjax_syntax():
    out, _, _ = conv("<p>[mathjax]\\frac{1}{2}[/mathjax]</p><p>so [mathjaxinline]x[/mathjaxinline] ok</p>")
    assert out[0] == math_node("\\frac{1}{2}")
    assert {"type": "text", "text": "x", "marks": [{"type": "italic"}]} in out[1]["content"]


def test_mathml_with_tex_annotation():
    out, _, _ = conv('<p><math><semantics><mi>x</mi><annotation encoding="application/x-tex">x^2</annotation>'
                     '</semantics></math></p><p>Area <math><mi>r</mi></math> here</p>')
    assert out[0] == math_node("x^2")
    assert all_text([out[1]]) == "Area r here"


# ---------------------------------------------------------------------------
# Callouts
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("cls,ctype", [
    ("alert alert-danger", "error"),
    ("alert-error", "error"),
    ("alert alert-warning", "warning"),
    ("box warning", "warning"),
    ("caution-box", "warning"),
    ("alert-success", "success"),
    ("alert-info", "info"),
    ("note", "info"),
    ("callout", "info"),
    ("tip", "tip"),
    ("hint_box", "tip"),
])
def test_callout_classes(cls, ctype):
    out, _, _ = conv(f'<div class="{cls}"><p>Careful</p></div>')
    assert out[0]["type"] == "callout" and out[0]["attrs"] == {"type": ctype, "dismissible": False}


def test_non_callout_classes():
    out, _, _ = conv('<div class="footnote"><p>a</p></div><div class="notebook"><p>b</p></div>')
    assert all(n["type"] == "paragraph" for n in out)


def test_callout_content_rules():
    out, _, _ = conv('<div class="alert-info"><h3>Heads up</h3><p>text</p><ul><li>x</li></ul>'
                     '<img src="img/a.png"><table><tr><td>t</td></tr></table><pre>code</pre>'
                     '<div class="tip"><p>nested</p></div></div>')
    callout = out[0]
    assert callout["type"] == "callout"
    assert [c["type"] for c in callout["content"]] == ["paragraph", "paragraph", "bulletList"]
    assert callout["content"][0]["content"][0]["marks"] == [{"type": "bold"}]
    assert [n["type"] for n in out[1:]] == ["blockImage", "table", "codeBlock", "callout"]


def test_empty_callout_and_callout_paragraph():
    out, _, _ = conv('<div class="note"></div><p class="tip">inline tip</p><section class="warning"></section>')
    assert out[0]["content"] == [{"type": "paragraph"}]
    assert out[1]["type"] == "callout" and all_text([out[1]]) == "inline tip"


def test_callout_overflow_inside_list_item_and_blockquote():
    out, _, _ = conv('<ul><li><div class="alert-warning"><p>x</p><table><tr><td>t</td></tr></table></div></li></ul>'
                     '<blockquote><div class="note"><img src="img/a.png"></div></blockquote>')
    li = out[0]["content"][0]["content"]
    assert [n["type"] for n in li] == ["paragraph", "callout", "table"]
    assert [n["type"] for n in out[1]["content"]] == ["callout", "blockImage"]
    for n in walk(out):
        assert "_after" not in n


def test_callout_overflow_inside_table_cell():
    out, _, _ = conv('<table><tr><td><div class="note"><hr></div></td></tr></table>')
    cell = out[0]["content"][0]["content"][0]
    assert [n["type"] for n in cell["content"]] == ["callout", "horizontalRule"]


# ---------------------------------------------------------------------------
# Nasty real-world documents (schema validity is the assertion)
# ---------------------------------------------------------------------------

NASTY = [
    "<p><b><i><u><s>all</s></u></i></b><code><b>c</b></code></p>",
    "<div><p>unclosed <b>bold <i>italic</div><p>after",
    "<ul><li><p></p></li><li><h2>head</h2></li><li><pre>x</pre></li><li><br></li></ul>",
    "<ol><li><ol><li><ol><li>3 deep</li></ol></li></ol></li></ol>",
    "<table><tr><th><h1>h</h1></th><td><blockquote>q</blockquote></td></tr><tr></tr></table>",
    "<table><tbody><tr><td><table><tr><td><table><tr><td>3</td></tr></table></td></tr></table></td></tr></tbody></table>",
    "<h1><img src='img/a.png'></h1><h2><br><br></h2>",
    "<p>a<div>block in p</div>b</p>",
    "<span>loose</span><b>bold loose</b><br><i>it</i>",
    "<a href='https://e.com'><p>block in link</p><img src='img/a.png'></a>",
    "<blockquote><blockquote><p>nested quote</p></blockquote></blockquote>",
    "<div class='alert-info'><div class='alert-warning'><ul><li><div class='tip'><table><tr><td>x</td></tr></table>"
    "</div></li></ul></div></div>",
    "<p>$$</p><p>\\(\\)</p><p>$$ $$</p>",
    "<figure><img src='img/a.png'><figcaption>cap</figcaption></figure>",
    "<center><font size=7>BIG</font></center><address>addr</address><fieldset><legend>L</legend>f</fieldset>",
    "<p>tab\there\r\nnewline</p>",
    "<ul><li>a<table><tr><td><ul><li><img src='img/a.png'></li></ul></td></tr></table></li></ul>",
    "<svg><text>vector</text></svg><canvas>c</canvas><map><area></map><template><p>t</p></template>",
    "<p>  <b> </b> </p>",
    "<div class='callout'><h4></h4></div>",
    "<p><a href='https://a.b'><a href='https://c.d'>double</a></a></p>",
    "<video><source src='https://vimeo.com/42'></video><audio><source></audio>",
    "<summary><img src='img/a.png'></summary><dt><table><tr><td>x</td></tr></table></dt>",
]


@pytest.mark.parametrize("html", NASTY)
def test_nasty_html_is_schema_valid(html):
    conv(html)  # conv validates


# ---------------------------------------------------------------------------
# html_to_text
# ---------------------------------------------------------------------------


def test_html_to_text_basics():
    assert html_to_text("") == ""
    assert html_to_text("   ") == ""
    assert html_to_text(None) == ""
    assert html_to_text("<p>a</p><p>b</p>") == "a\n\nb"
    assert html_to_text("a<br>b") == "a\nb"
    assert html_to_text("<script>x</script><style>y</style><p>z</p>") == "z"


def test_html_to_text_lists_tables_images():
    txt = html_to_text("<ul><li>one</li><li>two</li></ul><table><tr><td>a</td><th>b</th></tr></table>"
                       '<p>img <img alt="Alt"> eq <img data-equation-content="x^2"> none <img></p>')
    assert "• one" in txt and "• two" in txt
    assert "a | b |" in txt
    assert "img Alt eq x^2 none" in txt


def test_html_to_text_mathjax_and_whitespace():
    assert html_to_text("[mathjaxinline]x^{2}[/mathjaxinline]") == "x^2"
    assert html_to_text("<p>  a \n\t b  </p>\n\n\n<p></p><p>c</p>") == "a b\n\nc"


# ---------------------------------------------------------------------------
# html_assets
# ---------------------------------------------------------------------------


def test_html_assets():
    rich = RichText('<img src="img/a.png"><img src="https://x.y/z.png"><img src="data:image/png;base64,AA==">'
                    '<img src="gone.png"><img><img src=" img/b.jpg ">', resolver)
    assert [a.name for a in html_assets(rich)] == ["a.png", "b.jpg"]
    assert html_assets(None) == []
    assert html_assets(RichText("")) == []


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def test_int_px_and_alignment():
    assert h2t._int_px(None) is None
    assert h2t._int_px("12.7px") == 12
    assert h2t._int_px(" 40 ") == 40
    assert h2t._int_px("50%") is None
    assert h2t._pos_int("3") == 3 and h2t._pos_int("-1") == 1 and h2t._pos_int(None) == 1


def test_converter_resets_resolver_after_error(monkeypatch):
    c = HtmlConverter(FakeSink())

    def boom(*_a):
        raise RuntimeError("x")

    monkeypatch.setattr(c, "_blocks", boom)
    with pytest.raises(RuntimeError):
        c.convert(RichText("<p>x</p>", resolver))
    assert c._resolve is None


def test_node_ignores_non_tag_objects():
    c = HtmlConverter(FakeSink())
    assert c._node(object(), []) == []
    from bs4 import Comment, Doctype

    assert c._node(Comment("x"), []) == []
    assert c._node(Doctype("html"), []) == []


def test_nested_links_keep_one_link_mark():
    out, _, _ = conv("<p><a href='https://a.b'>x<a href='https://c.d'>double</a></a></p>")
    for n in out[0]["content"]:
        assert [m["type"] for m in n["marks"]] == ["link"]
    assert out[0]["content"][-1]["marks"][0]["attrs"]["href"] == "https://c.d"


def test_blank_formulas_are_text():
    out, _, _ = conv("<p>$$ $$</p><p>$$ $$ then $$y$$</p><img data-equation-content='  '>")
    assert out[0] == paragraph_text("$$ $$")
    assert [n["type"] for n in out[1:]] == ["paragraph", "blockMathEquation"]
    assert all_text([out[1]]) == "$$ $$ then"


def test_html_to_text_keeps_pre_and_drops_comments():
    # <pre> keeps its line breaks (indentation is collapsed like any other line)
    assert html_to_text("<p>a<!-- hidden -->b</p><pre>x\n  y</pre>") == "ab\n\nx\ny"


def test_heading_text_then_block_paragraph_is_joined():
    out, _, _ = conv("<h2>Title<p>sub</p></h2>")
    assert out == [{"type": "heading", "attrs": {"level": 2},
                    "content": [{"type": "text", "text": "Title sub"}]}]


def test_has_class():
    tag = h2t.BeautifulSoup('<div class="Alert Box"></div>', "html.parser").div
    assert h2t._has_class(tag, "alert")
    assert not h2t._has_class(tag, "note")


# ---------------------------------------------------------------------------
# Generated documents: random nesting of every construct, schema-checked
# ---------------------------------------------------------------------------

_LEAVES = [
    "text", " spaced  text ", "&nbsp;", "<br>", "<br><br>", '<img src="img/a.png">', '<img src="gone.png">',
    '<img src="https://cdn.example.com/x.png">', '<img data-equation-content="x^2">', "$$a$$", "\\(b\\)",
    "$$ $$", '<iframe src="https://youtu.be/dQw4w9WgXcQ"></iframe>', '<video src="media/clip.mp4"></video>',
    '<a href="files/doc.pdf">pdf</a>', '<a href="https://e.com">link</a>', '<a href="mailto:x@y.z">m</a>',
    "<hr>", "<pre>a<br>b</pre>", "<!-- c -->", "<script>x</script>",
    '<math><annotation encoding="TeX">y</annotation></math>',
]
_WRAPPERS = [
    "<p>{}</p>", "<div>{}</div>", "<span>{}</span>", "<b>{}</b>", "<i>{}</i>", "<code>{}</code>",
    '<span style="font-weight:bold">{}</span>', "<h2>{}</h2>", "<h5>{}</h5>", "<ul><li>{}</li></ul>",
    "<ol><li>{}</li><li>{}</li></ol>", "<ul>{}</ul>", "<blockquote>{}</blockquote>",
    "<table><tr><td>{}</td><th>{}</th></tr></table>", "<table><caption>{}</caption><tr><td>x</td></tr></table>",
    '<div class="alert-warning">{}</div>', '<p class="note">{}</p>', '<a href="https://e.com">{}</a>',
    '<a href="https://f.com">{}</a>', "<dl><dt>{}</dt><dd>{}</dd></dl>", "<details><summary>{}</summary></details>",
    "<li>{}</li>", "<td>{}</td>", "<figure>{}</figure>",
]


def _random_html(rng, depth=0):
    if depth > 4 or rng.random() < 0.25:
        return rng.choice(_LEAVES)
    wrapper = rng.choice(_WRAPPERS)
    parts = [
        "".join(_random_html(rng, depth + 1) for _ in range(rng.randint(1, 3)))
        for _ in range(wrapper.count("{}"))
    ]
    return wrapper.format(*parts)


def test_generated_documents_are_schema_valid():
    import random

    rng = random.Random(1234)
    for _ in range(400):
        html = "".join(_random_html(rng) for _ in range(rng.randint(1, 4)))
        try:
            conv(html)
        except SchemaError as e:  # pragma: no cover - the message carries the input
            raise AssertionError(f"{e}\nHTML: {html}") from None
