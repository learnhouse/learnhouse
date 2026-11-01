"""
Convert LMS HTML into LearnHouse editor (TipTap) nodes.

Only nodes the course editor registers are produced (see
``apps/web/components/Objects/Editor/Editor.tsx``): paragraphs, headings,
lists, blockquote, codeBlock, tables, horizontalRule, hardBreak, callout and
the file-backed ``blockImage``/``blockVideo``/``blockAudio``/``blockPDF``
nodes, plus ``blockEmbed`` and ``blockMathEquation``. Anything else in the
source HTML is flattened to text so the page never carries a node the editor
would drop or refuse to render.

Media is handed to a ``MediaSink`` (the package writer), which stores the file
and returns the node that points at it.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import os
import re
from dataclasses import dataclass, field
from typing import Callable, Optional, Protocol
from urllib.parse import ParseResult, unquote, urlparse

from bs4 import BeautifulSoup, NavigableString, Tag
# Comment, Doctype, CData, Declaration and ProcessingInstruction: never page text
from bs4.element import PreformattedString

from .ir import Asset, MediaKind, RichText

# Editor link mark only accepts these schemes (EditorConf.ts)
_LINK_SCHEMES = ("http", "https")

_HEADINGS = {"h1": 1, "h2": 2, "h3": 3, "h4": 4, "h5": 5, "h6": 6}
_MARK_TAGS = {
    "strong": "bold",
    "b": "bold",
    "em": "italic",
    "i": "italic",
    "cite": "italic",
    "dfn": "italic",
    "var": "italic",
    "u": "underline",
    "ins": "underline",
    "s": "strike",
    "strike": "strike",
    "del": "strike",
    "code": "code",
    "kbd": "code",
    "samp": "code",
    "tt": "code",
}
_DROP_TAGS = {
    "script", "style", "noscript", "template", "head", "meta", "link", "title",
    "button", "input", "select", "textarea", "form", "svg", "canvas", "map", "area",
}
_BLOCK_TAGS = {
    "p", "div", "section", "article", "header", "footer", "main", "aside", "nav",
    "ul", "ol", "li", "blockquote", "pre", "table", "hr", "figure", "figcaption",
    "details", "summary", "dl", "dt", "dd", "center", "address", "fieldset",
    "legend", "body", "html", "tbody", "thead", "tfoot", "tr", "td", "th", "caption",
    *_HEADINGS,
}
_MEDIA_TAGS = {"img", "iframe", "video", "audio", "object", "embed"}

_IMAGE_EXTS = {"png", "jpg", "jpeg", "gif", "webp"}
# Includes formats the package writer transcodes (avi, wmv...) when ffmpeg is available
_VIDEO_EXTS = {"mp4", "webm", "mov", "m4v", "ogv", "avi", "wmv", "mkv", "flv", "mpg", "mpeg", "3gp"}
_AUDIO_EXTS = {"mp3", "wav", "ogg", "m4a", "oga", "aac", "flac", "wma", "aif", "aiff", "opus"}

_WS = re.compile(r"\s+")
# Display math: $$...$$ and \[...\]; inline: \(...\)
_DISPLAY_MATH = re.compile(r"\$\$(.+?)\$\$|\\\[(.+?)\\\]", re.S)
_INLINE_MATH = re.compile(r"\\\((.+?)\\\)", re.S)
# A paragraph that is a single formula. The groups refuse to span a closing
# delimiter, so "$$a$$ and $$b$$" is two formulas with text between, not one.
_ONLY_MATH = re.compile(
    r"^\s*(?:\$\$((?:(?!\$\$).)+)\$\$|\\\[((?:(?!\\\]).)+)\\\]|\\\(((?:(?!\\\)).)+)\\\))\s*$", re.S
)
_EDX_MATHJAX = re.compile(r"\[mathjax(?:inline)?\](.+?)\[/mathjax(?:inline)?\]", re.S | re.I)

_CALLOUT_CLASSES = (
    ("alert-danger", "error"),
    ("alert-error", "error"),
    ("alert-warning", "warning"),
    ("warning", "warning"),
    ("caution", "warning"),
    ("alert-success", "success"),
    ("alert-info", "info"),
    ("note", "info"),
    ("callout", "info"),
    ("tip", "tip"),
    ("hint", "tip"),
)


class MediaSink(Protocol):
    def media_node(self, kind: MediaKind, asset: Asset, *, alt: str = "", width: Optional[int] = None,
                   alignment: str = "center") -> Optional[dict]: ...

    def remote_image_node(self, url: str, *, width: Optional[int] = None, alignment: str = "center") -> dict: ...

    def scratch_file(self, name: str, data: bytes) -> Asset: ...

    def library_node(self, asset: Asset, *, title: str = "") -> Optional[dict]: ...

    def missing_file(self, name: str) -> None: ...


def _safe_urlparse(url: str) -> ParseResult:
    """``urlparse`` that treats an unparsable URL ("http://[x") as empty instead of raising."""
    try:
        return urlparse(url)
    except ValueError:
        return urlparse("")


def media_kind_for(asset_or_name) -> Optional[MediaKind]:
    name = asset_or_name.name if isinstance(asset_or_name, Asset) else str(asset_or_name)
    ext = os.path.splitext(_safe_urlparse(name).path if "://" in name else name)[1].lower().lstrip(".")
    if ext in _IMAGE_EXTS:
        return MediaKind.IMAGE
    if ext in _VIDEO_EXTS:
        return MediaKind.VIDEO
    if ext in _AUDIO_EXTS:
        return MediaKind.AUDIO
    if ext == "pdf":
        return MediaKind.PDF
    return None


_YOUTUBE = re.compile(
    r"(?:youtube(?:-nocookie)?\.com/(?:watch\?(?:.*&)?v=|embed/|shorts/|live/|v/)|youtu\.be/)([A-Za-z0-9_-]{11})"
)
_VIMEO = re.compile(r"vimeo\.com/(?:video/|channels/[^/]+/|groups/[^/]+/videos/)?(\d+)")


def youtube_id(url: str) -> Optional[str]:
    m = _YOUTUBE.search(url or "")
    return m.group(1) if m else None


def vimeo_id(url: str) -> Optional[str]:
    m = _VIMEO.search(url or "")
    return m.group(1) if m else None


def embed_url_for(url: str) -> str:
    """Player URL for a video page URL; unchanged for anything else."""
    yid = youtube_id(url)
    if yid:
        return f"https://www.youtube.com/embed/{yid}"
    vid = vimeo_id(url)
    if vid:
        return f"https://player.vimeo.com/video/{vid}"
    return url


# Links into the source LMS rather than to a file in the export
_TOOL_LINK = re.compile(r"/lti/|toolLaunch|\$WIKI_REFERENCE\$|\$CANVAS_|/webapps/|/d2l/|/mod/|/course/view|"
                        r"/pluginfile\.php|/jump_to|/courseware/", re.I)
_FILE_NAME = re.compile(r"^[^/\\]+\.[A-Za-z0-9]{1,5}$")


def is_http_url(url: str) -> bool:
    parsed = _safe_urlparse(url.strip())
    return parsed.scheme.lower() in _LINK_SCHEMES and bool(parsed.netloc)


def text_node(text: str, marks: Optional[list[dict]] = None) -> dict:
    node: dict = {"type": "text", "text": text}
    if marks:
        node["marks"] = [dict(m) for m in marks]
    return node


def paragraph(inline: Optional[list[dict]] = None) -> dict:
    node: dict = {"type": "paragraph"}
    if inline:
        node["content"] = inline
    return node


def paragraph_text(text: str, marks: Optional[list[dict]] = None) -> dict:
    return paragraph([text_node(text, marks)]) if text else paragraph()


def heading(text: str, level: int = 2) -> dict:
    node: dict = {"type": "heading", "attrs": {"level": max(1, min(6, level))}}
    if text:
        node["content"] = [text_node(text)]
    return node


def math_node(latex: str) -> dict:
    return {"type": "blockMathEquation", "attrs": {"math_equation": latex.strip()}}


def embed_node(url: str = "", code: str = "", height: int = 500) -> dict:
    return {
        "type": "blockEmbed",
        "attrs": {
            "embedUrl": embed_url_for(url) if url else None,
            "embedCode": code or None,
            "embedType": "code" if code and not url else "url",
            "embedHeight": max(150, min(int(height or 500), 2000)),
            "embedAspectRatio": None,
            "embedWidth": "100%",
            "alignment": "center",
        },
    }


@dataclass
class _Break:
    """Block nodes found while walking inline content."""

    blocks: list[dict] = field(default_factory=list)


_ICON_CLASSES = re.compile(r"(?:^|\s)(?:material-icons\S*|material-symbols\S*|fa|fas|far|fab|glyphicon|bi)(?:\s|$)")


def _is_icon(tag: Tag) -> bool:
    """Icon-font glyphs: their text is a ligature name ("menu_book"), not prose."""
    if (tag.get("aria-hidden") or "").lower() == "true" and tag.name in ("span", "i", "em", "div"):
        return True
    return bool(_ICON_CLASSES.search(" ".join(tag.get("class") or [])))


def _has_class(tag: Tag, *names: str) -> bool:
    classes = " ".join(tag.get("class") or []).lower()
    return any(n in classes for n in names)


def _int_px(value) -> Optional[int]:
    if value is None:
        return None
    m = re.match(r"^\s*(\d+(?:\.\d+)?)\s*(px)?\s*$", str(value))
    return int(float(m.group(1))) if m else None


def _style_value(tag: Tag, prop: str) -> Optional[str]:
    style = tag.get("style") or ""
    m = re.search(rf"(?:^|;)\s*{prop}\s*:\s*([^;]+)", style, re.I)
    return m.group(1).strip() if m else None


def _alignment(tag: Tag) -> str:
    fl = (_style_value(tag, "float") or tag.get("align") or "").lower()
    if fl in ("left", "right"):
        return fl
    return "center"


class HtmlConverter:
    """Stateless per call, apart from the warnings it collects."""

    def __init__(self, media: MediaSink, warn: Callable[[str], None] = lambda _m: None):
        self.media = media
        self.warn = warn
        self._resolve = None

    # ------------------------------------------------------------------ API

    def convert(self, rich: Optional[RichText]) -> list[dict]:
        if rich is None or rich.is_empty():
            return []
        html = _EDX_MATHJAX.sub(lambda m: f"\\({m.group(1)}\\)", rich.html)
        soup = BeautifulSoup(html, "html.parser")
        for c in soup.find_all(string=lambda s: isinstance(s, PreformattedString)):
            c.extract()
        self._resolve = rich.resolve
        try:
            blocks = self._blocks(list(soup.children), [])
        finally:
            self._resolve = None
        return _clean_blocks(blocks)

    # -------------------------------------------------------------- walking

    def _blocks(self, nodes, marks: list[dict]) -> list[dict]:
        out: list[dict] = []
        buf: list[dict] = []

        def flush():
            if buf:
                out.extend(_finish_paragraph(buf))
                buf.clear()

        for node in nodes:
            for item in self._node(node, marks):
                if isinstance(item, _Break):
                    flush()
                    out.extend(item.blocks)
                else:
                    buf.append(item)
        flush()
        return out

    def _node(self, node, marks: list[dict]) -> list:
        """Inline nodes and _Break items for one DOM node."""
        if isinstance(node, NavigableString):
            if isinstance(node, PreformattedString):
                return []
            text = _WS.sub(" ", str(node))
            return [text_node(text, marks)] if text else []
        if not isinstance(node, Tag):
            return []
        name = (node.name or "").lower()
        if name in _DROP_TAGS or _is_icon(node):
            return []
        if name == "br":
            return [{"type": "hardBreak"}]
        if name in _MEDIA_TAGS:
            blocks = self._media(node)
            return [_Break(blocks)] if blocks else []
        if name in _BLOCK_TAGS:
            return [_Break(self._block(node, name))]
        if name == "math":
            latex = self._mathml_latex(node)
            return [text_node(f"\\({latex}\\)" if latex else node.get_text(" ", strip=True), marks)]
        if name == "a":
            return self._anchor(node, marks)
        mark = _MARK_TAGS.get(name)
        if mark == "code":
            new_marks = [{"type": "code"}]
        elif mark and not any(m["type"] in (mark, "code") for m in marks):
            new_marks = marks + [{"type": mark}]
        else:
            new_marks = marks
        if name == "span" and not _has_mark(new_marks, "code"):  # code excludes every other mark
            if (_style_value(node, "font-weight") or "") in ("bold", "700", "800", "900") and not _has_mark(marks, "bold"):
                new_marks = new_marks + [{"type": "bold"}]
            if (_style_value(node, "font-style") or "") == "italic" and not _has_mark(new_marks, "italic"):
                new_marks = new_marks + [{"type": "italic"}]
            if "underline" in (_style_value(node, "text-decoration") or "") and not _has_mark(new_marks, "underline"):
                new_marks = new_marks + [{"type": "underline"}]
        out: list = []
        for child in node.children:
            out.extend(self._node(child, new_marks))
        return out

    def _anchor(self, node: Tag, marks: list[dict]) -> list:
        href = (node.get("href") or "").strip()
        if href.startswith("//"):  # protocol-relative
            href = "https:" + href
        inner_marks = marks
        trailing: list[dict] = []
        if href and not href.startswith("#"):
            if is_http_url(href) and not _has_mark(marks, "code"):
                # An <a> nested in another <a>: the innermost target wins
                inner_marks = [m for m in marks if m.get("type") != "link"] + [{
                    "type": "link",
                    "attrs": {"href": href, "target": "_blank", "rel": "noopener noreferrer", "class": None},
                }]
            elif not _safe_urlparse(href).scheme and self._resolve:
                asset = self._resolve(href)
                if asset is not None:
                    node_for_file = self._file_block(asset, node.get_text(" ", strip=True))
                    if node_for_file:
                        trailing.append(node_for_file)
                else:
                    self._missing_link(href)
        out: list = []
        for child in node.children:
            out.extend(self._node(child, inner_marks))
        if trailing:
            out.append(_Break(trailing))
        return out

    def _block(self, node: Tag, name: str) -> list[dict]:
        if name in _HEADINGS:
            inline, extra = self._inline_only(node)
            blocks = []
            if inline:
                blocks.append({"type": "heading", "attrs": {"level": _HEADINGS[name]}, "content": inline})
            return blocks + extra
        if name in ("ul", "ol"):
            return [self._list(node, name)]
        if name == "blockquote":
            inner = self._blocks(list(node.children), [])
            return [{"type": "blockquote", "content": inner}] if inner else []
        if name == "pre":
            return [self._code_block(node)]
        if name == "table":
            return self._table(node)
        if name == "hr":
            return [{"type": "horizontalRule"}]
        if name == "dt":
            inline, extra = self._inline_only(node, [{"type": "bold"}])
            return ([paragraph(inline)] if inline else []) + extra
        if name in ("div", "section", "aside", "p") and node.get("class"):
            ctype = self._callout_type(node)
            if ctype:
                return [self._callout(node, ctype)]
        if name == "summary":
            inline, extra = self._inline_only(node, [{"type": "bold"}])
            return ([paragraph(inline)] if inline else []) + extra
        return self._blocks(list(node.children), [])

    def _inline_only(self, node: Tag, marks: Optional[list[dict]] = None) -> tuple[list[dict], list[dict]]:
        """Inline content of ``node``; block children are returned separately."""
        inline: list[dict] = []
        extra: list[dict] = []
        for child in node.children:
            for item in self._node(child, marks or []):
                if isinstance(item, _Break):
                    for b in item.blocks:
                        if b.get("type") in ("paragraph", "heading") and b.get("content"):
                            if inline:
                                inline.append(text_node(" "))
                            inline.extend(b["content"])
                        else:
                            extra.append(b)
                else:
                    inline.append(item)
        return _inline_math(_trim_inline(_merge_text(inline))), extra

    def _list(self, node: Tag, name: str) -> dict:
        items = []
        for li in node.find_all("li", recursive=False):
            content = self._blocks(list(li.children), [])
            if not content or content[0].get("type") != "paragraph":
                content.insert(0, paragraph())
            items.append({"type": "listItem", "content": content})
        # Bare text or tags directly under <ul> (broken HTML)
        stray = [c for c in node.children if not (isinstance(c, Tag) and c.name == "li")]
        if stray:
            content = self._blocks(stray, [])
            if content:
                if content[0].get("type") != "paragraph":
                    content.insert(0, paragraph())
                items.append({"type": "listItem", "content": content})
        if not items:
            items = [{"type": "listItem", "content": [paragraph()]}]
        result: dict = {"type": "bulletList" if name == "ul" else "orderedList", "content": items}
        if name == "ol":
            start = node.get("start")
            result["attrs"] = {"start": int(start) if str(start or "").isdigit() else 1, "type": None}
        return result

    def _code_block(self, node: Tag) -> dict:
        language = None
        for el in [node] + node.find_all("code", limit=1):
            for cls in el.get("class") or []:
                m = re.match(r"^(?:language|lang|brush:?)-?(\w[\w+#-]*)$", cls)
                if m:
                    language = m.group(1).lower()
        for br in node.find_all("br"):
            br.replace_with("\n")
        code = node.get_text()
        code = code.strip("\n")
        result: dict = {"type": "codeBlock", "attrs": {"language": language}}
        if code:
            result["content"] = [text_node(code)]
        return result

    def _table(self, node: Tag) -> list[dict]:
        rows = []
        caption = node.find("caption")
        for tr in node.find_all("tr"):
            # Skip rows that belong to a nested table
            if tr.find_parent("table") is not node:
                continue
            cells = []
            for cell in tr.find_all(["td", "th"], recursive=False):
                content = self._blocks(list(cell.children), [])
                content = [b for b in content if b.get("type") != "table"] or [paragraph()]
                attrs = {"colspan": _pos_int(cell.get("colspan")), "rowspan": _pos_int(cell.get("rowspan")),
                         "colwidth": None}
                cells.append({"type": "tableHeader" if cell.name == "th" else "tableCell",
                              "attrs": attrs, "content": content})
            if cells:
                rows.append({"type": "tableRow", "content": cells})
        out: list[dict] = []
        if caption is not None and caption.get_text(strip=True):
            out.append(paragraph_text(caption.get_text(" ", strip=True), [{"type": "bold"}]))
        if rows:
            out.append({"type": "table", "content": rows})
        # Nested tables become siblings
        for inner in node.find_all("table"):
            if inner.find_parent("table") is node:
                out.extend(self._table(inner))
        return out

    def _callout_type(self, node: Tag) -> Optional[str]:
        classes = " ".join(node.get("class") or []).lower()
        for needle, ctype in _CALLOUT_CLASSES:
            if re.search(rf"(?:^|[\s_-]){re.escape(needle)}(?:$|[\s_-])", classes):
                return ctype
        return None

    def _callout(self, node: Tag, ctype: str) -> dict:
        inner = self._blocks(list(node.children), [])
        allowed, after = [], []
        for b in inner:
            t = b.get("type")
            if t in ("paragraph", "bulletList", "orderedList"):
                allowed.append(b)
            elif t == "heading" and b.get("content"):
                allowed.append(paragraph([dict(n, marks=[{"type": "bold"}]) if n.get("type") == "text" else n
                                          for n in b["content"]]))
            else:
                after.append(b)
        if not allowed:
            allowed = [paragraph()]
        return {"type": "callout", "attrs": {"type": ctype, "dismissible": False}, "content": allowed, **(
            {"_after": after} if after else {})}

    # ---------------------------------------------------------------- media

    def _media(self, node: Tag) -> list[dict]:
        name = node.name.lower()
        if name == "img":
            return self._image(node)
        if name == "iframe":
            src = (node.get("src") or node.get("data-src") or "").strip()
            if src.startswith("//"):
                src = "https:" + src
            if not is_http_url(src):
                # An iframe showing a file from the export (e.g. /static/guide.pdf)
                kind = media_kind_for(src) if src and not src.startswith(("javascript:", "data:")) else None
                block = self._src_block(src, kind, node.get("title") or "") if kind else None
                return [block] if block else []
            return [embed_node(src, height=_int_px(node.get("height")) or 500)]
        if name in ("video", "audio"):
            sources = [node.get("src")] + [s.get("src") for s in node.find_all("source")]
            for src in [s for s in sources if s]:
                block = self._src_block(src.strip(), MediaKind.VIDEO if name == "video" else MediaKind.AUDIO,
                                        node.get("title") or "")
                if block:
                    return [block]
            return []
        # object / embed (Flash, PDF viewers)
        src = (node.get("data") or node.get("src") or "").strip()
        if src:
            block = self._src_block(src, media_kind_for(src), "")
            if block:
                return [block]
        return []

    def _src_block(self, src: str, kind: Optional[MediaKind], title: str) -> Optional[dict]:
        if is_http_url(src):
            if youtube_id(src) or vimeo_id(src):
                return embed_node(src, height=450)
            if kind == MediaKind.IMAGE:
                return self.media.remote_image_node(src)
            return embed_node(src, height=450 if kind != MediaKind.AUDIO else 160)
        asset = self._resolve(src) if self._resolve else None
        if asset is None:
            self._missing_link(src)
            return None
        kind = media_kind_for(asset) or kind
        if kind is None:
            return None
        return self.media.media_node(kind, asset, alt=title)

    def _image(self, node: Tag) -> list[dict]:
        latex = (node.get("data-equation-content") or "").strip()
        if latex:  # Canvas equation editor images
            return [math_node(latex)]
        src = (node.get("src") or node.get("data-src") or "").strip()
        if not src:
            return []
        alt = node.get("alt") or node.get("title") or ""
        width = _int_px(node.get("width")) or _int_px(_style_value(node, "width"))
        alignment = _alignment(node)
        if src.startswith("data:"):
            asset = self._data_uri(src)
            if asset is None:
                return []
            block = self.media.media_node(MediaKind.IMAGE, asset, alt=alt, width=width, alignment=alignment)
            return [block] if block else []
        if src.startswith("//"):
            src = "https:" + src
        if is_http_url(src):
            return [self.media.remote_image_node(src, width=width, alignment=alignment)]
        asset = self._resolve(src) if self._resolve else None
        if asset is None:
            self._missing_link(src)
            return []
        # Exporters write <img> for any attached file: a PDF or video gets its own block
        kind = media_kind_for(asset) or MediaKind.IMAGE
        block = self.media.media_node(kind, asset, alt=alt, width=width, alignment=alignment)
        return [block] if block else []

    def _data_uri(self, src: str) -> Optional[Asset]:
        m = re.match(r"^data:image/(png|jpe?g|gif|webp);base64,(.+)$", src, re.S | re.I)
        if not m:
            return None
        try:
            data = base64.b64decode(m.group(2), validate=False)
        except (binascii.Error, ValueError):
            return None
        if not data:
            return None
        ext = m.group(1).lower().replace("jpeg", "jpg")
        digest = hashlib.sha1(data).hexdigest()[:16]
        return self.media.scratch_file(f"inline-{digest}.{ext}", data)

    def _file_block(self, asset: Asset, label: str) -> Optional[dict]:
        kind = media_kind_for(asset)
        if kind is None:
            # No player for it: a Library file the learner downloads
            return self.media.library_node(asset, title=label)
        return self.media.media_node(kind, asset, alt=label)

    def _missing_link(self, href: str) -> None:
        """A local link whose target is not in the export.

        Files the course relied on are reported as skipped. Links into the
        source platform itself (tool launches, wiki references, course
        navigation) have no file to miss: their text stays, silently."""
        path = unquote(_safe_urlparse(href).path)
        name = path.rstrip("/").rsplit("/", 1)[-1]
        if _TOOL_LINK.search(href) or not _FILE_NAME.match(name):
            return
        self.media.missing_file(name[:120])

    @staticmethod
    def _mathml_latex(node: Tag) -> str:
        ann = node.find("annotation", attrs={"encoding": re.compile("tex", re.I)})
        return ann.get_text().strip() if ann else ""


# ---------------------------------------------------------------------------
# Post-processing
# ---------------------------------------------------------------------------


def _pos_int(value) -> int:
    try:
        return max(1, int(value))
    except (TypeError, ValueError):
        return 1


def _has_mark(marks: list[dict], mark: str) -> bool:
    return any(m.get("type") == mark for m in marks)


def _merge_text(inline: list[dict]) -> list[dict]:
    out: list[dict] = []
    for node in inline:
        if (
            out
            and node.get("type") == "text"
            and out[-1].get("type") == "text"
            and out[-1].get("marks") == node.get("marks")
        ):
            out[-1] = dict(out[-1], text=out[-1]["text"] + node["text"])
        else:
            out.append(node)
    # Collapse runs of spaces created across element boundaries
    for i, node in enumerate(out):
        if node.get("type") == "text":
            out[i] = dict(node, text=re.sub(r" {2,}", " ", node["text"]))
    for i in range(1, len(out)):
        prev, cur = out[i - 1], out[i]
        if prev.get("type") == "text" and cur.get("type") == "text" and prev["text"].endswith(" ") \
                and cur["text"].startswith(" "):
            out[i] = dict(cur, text=cur["text"][1:])
    return [n for n in out if n.get("type") != "text" or n["text"]]


def _trim_inline(inline: list[dict]) -> list[dict]:
    while inline and inline[0].get("type") == "hardBreak":
        inline = inline[1:]
    while inline and inline[-1].get("type") == "hardBreak":
        inline = inline[:-1]
    if inline and inline[0].get("type") == "text":
        inline[0] = dict(inline[0], text=inline[0]["text"].lstrip())
    if inline and inline[-1].get("type") == "text":
        inline[-1] = dict(inline[-1], text=inline[-1]["text"].rstrip())
    inline = [n for n in inline if n.get("type") != "text" or n["text"]]
    if all(n.get("type") == "hardBreak" for n in inline):
        return []
    return inline


def _plain(inline: list[dict]) -> str:
    return "".join(n.get("text", "") if n.get("type") == "text" else "\n" for n in inline)


def _finish_paragraph(buf: list[dict]) -> list[dict]:
    inline = _trim_inline(_merge_text(list(buf)))
    if not inline:
        return []
    plain = _plain(inline)
    only = _ONLY_MATH.match(plain)
    if only and next(g for g in only.groups() if g).strip():
        return [math_node(next(g for g in only.groups() if g))]
    unmarked = all(n.get("type") != "text" or not n.get("marks") for n in inline)
    if unmarked and _DISPLAY_MATH.search(plain) and all(n.get("type") == "text" for n in inline):
        out: list[dict] = []
        pos = 0
        for m in _DISPLAY_MATH.finditer(plain):
            before = plain[pos:m.start()].strip()
            latex = (m.group(1) or m.group(2)).strip()
            if not latex:  # "$$ $$" is not a formula; keep it as text
                continue
            if before:
                out.append(paragraph(_inline_math([text_node(before)])))
            out.append(math_node(latex))
            pos = m.end()
        rest = plain[pos:].strip()
        if rest:
            out.append(paragraph(_inline_math([text_node(rest)])))
        return out
    return [paragraph(_inline_math(inline))]


def _inline_math(inline: list[dict]) -> list[dict]:
    """``\\(x^{2}\\)`` inside running text becomes readable italic text (``x^2``).

    The editor only has a block-level math node; showing raw TeX in a code
    mark read poorly in real courses (OpenStax, edX), so simple expressions
    are rewritten the same way plain-text fields are."""
    out: list[dict] = []
    for node in inline:
        if node.get("type") != "text" or not _INLINE_MATH.search(node["text"]) or _has_mark(node.get("marks", []), "code"):
            out.append(node)
            continue
        pos = 0
        text = node["text"]
        for m in _INLINE_MATH.finditer(text):
            if m.start() > pos:
                out.append(dict(node, text=text[pos:m.start()]))
            readable = latex_to_text(m.group(1))
            if readable:
                marks = [mk for mk in node.get("marks", []) if mk.get("type") != "italic"] + [{"type": "italic"}]
                out.append(text_node(readable, marks))
            pos = m.end()
        if pos < len(text):
            out.append(dict(node, text=text[pos:]))
    return [n for n in out if n.get("type") != "text" or n["text"]]


def _clean_blocks(blocks: list[dict]) -> list[dict]:
    """Place the blocks a callout could not hold right after it, at any depth."""
    out: list[dict] = []
    for b in blocks:
        after = b.pop("_after", None) if isinstance(b, dict) else None
        if isinstance(b, dict) and isinstance(b.get("content"), list):
            b["content"] = _clean_blocks(b["content"])
        out.append(b)
        if after:
            out.extend(_clean_blocks(after))
    return out


# ---------------------------------------------------------------------------
# Plain text
# ---------------------------------------------------------------------------


_LATEX_SYMBOLS = {
    "cdot": "·", "times": "×", "div": "÷", "pm": "±", "mp": "∓", "le": "≤", "leq": "≤", "ge": "≥", "geq": "≥",
    "ne": "≠", "neq": "≠", "approx": "≈", "infty": "∞", "degree": "°", "circ": "°", "to": "→", "rightarrow": "→",
    "leftarrow": "←", "Rightarrow": "⇒", "in": "∈", "sum": "Σ", "prod": "Π", "int": "∫", "partial": "∂",
    "alpha": "α", "beta": "β", "gamma": "γ", "delta": "δ", "Delta": "Δ", "epsilon": "ε", "theta": "θ",
    "lambda": "λ", "mu": "μ", "pi": "π", "sigma": "σ", "Sigma": "Σ", "phi": "φ", "omega": "ω", "Omega": "Ω",
    "rho": "ρ", "tau": "τ", "%": "%", "$": "$", "{": "{", "}": "}", "&": "&", "#": "#", "_": "_",
    "ldots": "…", "cdots": "…", "dots": "…", "quad": " ", "qquad": "  ", "angle": "∠", "perp": "⊥",
    "parallel": "∥", "cup": "∪", "cap": "∩", "subset": "⊂", "emptyset": "∅", "forall": "∀", "exists": "∃",
    "lt": "<", "gt": ">", "ll": "≪", "gg": "≫", "sim": "∼", "equiv": "≡", "propto": "∝", "nabla": "∇",
    "neg": "¬", "lnot": "¬", "land": "∧", "wedge": "∧", "lor": "∨", "vee": "∨", "oplus": "⊕", "otimes": "⊗",
    "leftrightarrow": "↔", "Leftrightarrow": "⇔", "Leftarrow": "⇐", "mid": "|", "vert": "|", "prime": "′",
    "notin": "∉", "subseteq": "⊆", "supset": "⊃", "supseteq": "⊇", "setminus": "∖", "therefore": "∴",
    "bullet": "•", "hbar": "ħ", "ell": "ℓ", "varepsilon": "ε", "vartheta": "θ", "varphi": "φ", "eta": "η",
    "zeta": "ζ", "kappa": "κ", "nu": "ν", "xi": "ξ", "chi": "χ", "psi": "ψ", "Gamma": "Γ", "Theta": "Θ",
    "Lambda": "Λ", "Pi": "Π", "Phi": "Φ", "Psi": "Ψ",
}
_INLINE_TEX = re.compile(r"\\\((.+?)\\\)|\\\[(.+?)\\\]|\$\$(.+?)\$\$", re.S)
_TEX_FRAC = re.compile(r"\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}")
_TEX_SQRT = re.compile(r"\\sqrt\s*\{([^{}]*)\}")
# Fonts and accents: keep the content ("\\mathbb{R}" -> "R", not "mathbbR")
_TEX_TEXT = re.compile(r"\\(?:text|textbf|textit|textrm|mathrm|mathbf|mathit|mathsf|mathbb|mathcal|boldsymbol|"
                       r"operatorname|mbox|overline|underline|bar|hat|vec|tilde|dot|ddot|widehat|overrightarrow)"
                       r"\s*\{([^{}]*)\}")
_TEX_CMD = re.compile(r"\\([A-Za-z]+|[%${}&#_])")
_TEX_SPACING = re.compile(r"\\[!,;:> ]")


def latex_to_text(expr: str) -> str:
    """Readable plain text for a TeX expression ("\\dfrac{6,\\!000}{n}" -> "(6,000)/(n)").

    Task prompts and quiz options are plain strings that LearnHouse shows as
    text, so math is rewritten rather than left as raw TeX.
    """
    out = _TEX_SPACING.sub(lambda m: " " if m.group(0) in ("\\,", "\\;", "\\:", "\\>", "\\ ") else "", expr)
    out = out.replace("\\left", "").replace("\\right", "")
    for _ in range(4):  # nested \frac / \text
        new = _TEX_TEXT.sub(r"\1", out)
        new = _TEX_FRAC.sub(lambda m: f"({m.group(1).strip()})/({m.group(2).strip()})", new)
        new = _TEX_SQRT.sub(lambda m: f"√({m.group(1).strip()})", new)
        if new == out:
            break
        out = new
    out = _TEX_CMD.sub(lambda m: _LATEX_SYMBOLS.get(m.group(1), m.group(1)), out)
    out = re.sub(r"\^\{([^{}]*)\}", r"^\1", out)
    out = re.sub(r"_\{([^{}]*)\}", r"_\1", out)
    out = out.replace("{", "").replace("}", "")
    return re.sub(r"[ \t]{2,}", " ", out).strip()


def math_to_text(text: str) -> str:
    """Replace every delimited TeX expression in ``text`` with readable text."""
    return _INLINE_TEX.sub(lambda m: latex_to_text(next(g for g in m.groups() if g is not None)), text)


def html_to_text(html: str) -> str:
    """Readable plain text for fields that do not render HTML (task prompts)."""
    if not html or not html.strip():
        return ""
    html = _EDX_MATHJAX.sub(lambda m: f"\\({m.group(1)}\\)", html)
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup.find_all(list(_DROP_TAGS)):
        tag.decompose()
    for tag in [t for t in soup.find_all(True) if _is_icon(t)]:
        if not tag.decomposed:
            tag.decompose()
    for c in soup.find_all(string=lambda s: isinstance(s, PreformattedString)):
        c.extract()
    # Newlines in the HTML source are only whitespace; the line breaks of the
    # result come from <br> and block elements below (and <pre>, kept as is)
    for s in soup.find_all(string=True):
        if s.find_parent("pre") is None:
            s.replace_with(_WS.sub(" ", str(s)))
    for img in soup.find_all("img"):
        latex = img.get("data-equation-content")
        alt = latex or img.get("alt") or ""
        img.replace_with(f" {alt} " if alt else " ")
    for br in soup.find_all("br"):
        br.replace_with("\n")
    for li in soup.find_all("li"):
        li.insert_before("\n• ")
    for tag in soup.find_all(["p", "div", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "pre", "blockquote", "table",
                              "ul", "ol"]):
        tag.insert_before("\n")
        tag.insert_after("\n")
    for cell in soup.find_all(["td", "th"]):
        cell.insert_after(" | ")
    text = math_to_text(soup.get_text())
    lines = [_WS.sub(" ", line).strip() for line in text.split("\n")]
    out: list[str] = []
    for line in lines:
        if line or (out and out[-1]):
            out.append(line)
    return "\n".join(out).strip()


def html_assets(rich: Optional[RichText]) -> list[Asset]:
    """Local files referenced by ``<img>`` in ``rich`` (for task attachments)."""
    if rich is None or rich.is_empty():
        return []
    soup = BeautifulSoup(rich.html, "html.parser")
    assets = []
    for img in soup.find_all("img"):
        src = (img.get("src") or "").strip()
        if src and not is_http_url(src) and not src.startswith("data:"):
            asset = rich.resolve(src)
            if asset is not None:
                assets.append(asset)
    return assets
