"""
IMS Common Cartridge reader (CC 1.0, 1.1, 1.2, 1.3 and Thin CC).

A cartridge is an IMS content package: ``imsmanifest.xml`` lists resources
(typed files) and one organization, a tree of items that point at them. The
top-level items of that tree (under the mandatory root item) become chapters;
deeper folders are flattened into their chapter with "Folder › Item" titles,
and title-only items (text headers) start a new chapter.

Resource types:

* ``webcontent`` / ``associatedcontent``: an HTML page, or a file shown by
  type (PDF document, video, image/audio page, downloadable file, SCORM zip)
* ``imswl_xmlv1pN``: web links (YouTube/Vimeo links become videos)
* ``imsdt_xmlv1pN``: discussion topics, kept as pages (threads are not migrated)
* ``imsqti_xmlv1p2/.../assessment``: QTI 1.2 quizzes, parsed by :mod:`..qti`
* ``imsqti_xmlv1p2/.../question-bank``: hidden quizzes in a "Question banks" chapter
* ``imsbasiclti_xmlv1p0``: LTI links, reported as unsupported with their URL
* ``assignment_xmlv1p0``: the CC 1.3 assignment extension

The module also exposes the manifest parsing and resource helpers so the
dialect readers (Canvas, Blackboard, Brightspace), which ship CC-shaped
manifests too, share one implementation. Their signatures are kept stable.
"""

from __future__ import annotations

import html as html_lib
import os
import posixpath
import re
import zipfile
from dataclasses import dataclass, field
from typing import Iterable, Optional, Union
from urllib.parse import unquote
from xml.etree.ElementTree import Element

from .. import ir, qti
from ..html_to_tiptap import vimeo_id, youtube_id
from ..xmlutil import MAX_TEXT_BYTES, XmlError, attr, children, inner_text, parse_bytes, read_limited, text, to_bool, to_float, to_int
from .common import FileIndex, clean_url, iso_from_text, make_resolver, slug_title
from ..report import error_text

KEY = "common_cartridge"
LABEL = "IMS Common Cartridge"

MANIFEST_NAME = "imsmanifest.xml"

# What a manifest says when it is a cartridge (namespaces, schema names)
_CC_MARKERS = (b"imscc", b"common cartridge", b"thin cc")

_HTML_EXTS = {"html", "htm", "xhtml"}
# Extensions the package writer can convert even though no block takes them
_VIDEO_EXTS = {"mp4", "m4v", "webm", "mov", "avi", "mkv", "ogv", "wmv", "flv", "mpg", "mpeg", "3gp"}
_AUDIO_EXTS = {"mp3", "wav", "ogg", "oga", "m4a", "aac", "flac", "wma", "aif", "aiff", "opus"}
_IMAGE_EXTS = {"png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff", "ico"}
_MAX_TEXT_PAGE = 512 * 1024  # plain text files up to this size become page text

# $IMS-CC-FILEBASE$ and the spellings exporters use for it (URL-encoded, underscores)
FILEBASE_RE = re.compile(r"^\s*(?:\$|%24)IMS[-_]CC[-_]FILEBASE(?:\$|%24)", re.I)
# Canvas links to other course objects; there is no target in the package
_OBJECT_LINK_RE = re.compile(
    r"(?:\$|%24)(?:WIKI_REFERENCE|CANVAS_OBJECT_REFERENCE|CANVAS_COURSE_REFERENCE)(?:\$|%24)", re.I
)
_FILE_LINK_RE = re.compile(
    r"(?:\$|%24)CANVAS_(?:OBJECT|COURSE)_REFERENCE(?:\$|%24)/(?:files|file_ref|attachments)/", re.I
)
# Links into the source LMS itself: Moodle backup placeholders ($@COURSEVIEWBYID*12@$)
# and LMS application paths (Moodle /mod/, D2L /d2l/, Blackboard /webapps/)
_LMS_LINK_RE = re.compile(r"^(?:\$@[A-Z_]+\*?[^@]*@\$|[\\/](?:mod|course|d2l|webapps|courses|user|blocks)[\\/])", re.I)
# <a ... href="..."> inner </a>: groups 1/2 = href (double/single quoted), 3 = inner HTML
_ANCHOR_RE = re.compile(r"<a\b[^>]*?\bhref\s*=\s*(?:\"([^\"]*)\"|'([^']*)')[^>]*>(.*?)</a\s*>", re.S | re.I)
_REF_ID_RE = re.compile(
    r"(?:\$|%24)CANVAS_(?:OBJECT|COURSE)_REFERENCE(?:\$|%24)/(?:file_ref|attachments)/([^/?#\s\"']+)", re.I
)


# ---------------------------------------------------------------------------
# XML
# ---------------------------------------------------------------------------

_XML_ENTITIES = {"amp", "lt", "gt", "quot", "apos"}
_ENTITY_RE = re.compile(rb"&([A-Za-z][A-Za-z0-9]{1,31});")


def _numeric_entities(data: bytes) -> bytes:
    """``&nbsp;`` -> ``&#160;``: HTML named entities XML parsers do not know."""
    from html.entities import name2codepoint

    def repl(m: re.Match) -> bytes:
        name = m.group(1).decode("ascii")
        if name in _XML_ENTITIES or name not in name2codepoint:
            return m.group(0)
        return b"&#%d;" % name2codepoint[name]

    return _ENTITY_RE.sub(repl, data)


def parse_xml_file(path: str) -> Element:
    """Parse an export XML file (via defusedxml). Exporters such as Moodle
    write HTML entities (``&nbsp;``) into their XML; those are retried as
    numeric references instead of failing the whole document."""
    data = read_limited(path)
    try:
        return parse_bytes(data)
    except XmlError as e:
        if "entity" not in str(e).lower():
            raise
        return parse_bytes(_numeric_entities(data))


def try_parse_xml_file(path: Optional[str]) -> Optional[Element]:
    """:func:`parse_xml_file`, or None when the file is missing or unreadable."""
    if not path:
        return None
    try:
        return parse_xml_file(path)
    except (OSError, XmlError):
        return None


# ---------------------------------------------------------------------------
# Manifest model
# ---------------------------------------------------------------------------


def resource_kind(resource_type: str) -> str:
    """Normalized kind of a CC resource ``type`` attribute.

    One of ``webcontent``, ``weblink``, ``discussion``, ``assessment``,
    ``question_bank``, ``lti``, ``assignment``, ``associated`` or ``other``.
    Every CC revision (``imswl_xmlv1p0`` ... ``imswl_xmlv1p3``) maps to the
    same kind.
    """
    t = (resource_type or "").strip().lower()
    if t == "webcontent":
        return "webcontent"
    if t.startswith("imswl_"):
        return "weblink"
    if t.startswith("imsdt_"):
        return "discussion"
    if t.startswith("imsbasiclti") or t.startswith("imslticc"):
        return "lti"
    if "question-bank" in t or "question_bank" in t or t.endswith("objectbank"):
        return "question_bank"
    if t.startswith("imsqti_"):
        return "assessment"
    if t.startswith("assignment_xmlv"):
        return "assignment"
    if t.startswith("associatedcontent/"):
        return "associated"
    return "other"


@dataclass
class Resource:
    """One ``<resource>``. Paths are relative to the extraction root, ``/``-separated."""

    identifier: str
    type: str
    href: str = ""
    files: list[str] = field(default_factory=list)
    dependencies: list[str] = field(default_factory=list)
    intendeduse: str = ""
    instructor_only: bool = False
    element: Optional[Element] = field(default=None, repr=False)

    @property
    def kind(self) -> str:
        return resource_kind(self.type)

    @property
    def main_file(self) -> str:
        """The launch file: ``href``, or the first ``<file>`` when there is none."""
        return self.href or (self.files[0] if self.files else "")

    @property
    def base_dir(self) -> str:
        return posixpath.dirname(self.main_file)

    def existing_file(self, index: FileIndex) -> Optional[str]:
        """The launch file on disk, or the first listed file that exists
        (some exporters write an ``href`` without its extension)."""
        for rel in ([self.href] if self.href else []) + self.files:
            full = index.get(rel)
            if full:
                return full
        return None

    @property
    def inline(self) -> Optional[Element]:
        """The resource document embedded in the manifest (CC 1.3 inline resources)."""
        if self.element is None:
            return None
        return next((c for c in self.element if c.tag not in ("file", "dependency", "metadata", "variant")), None)


@dataclass
class OrgItem:
    """One ``<item>`` of the organization tree."""

    identifier: str
    title: str = ""
    identifierref: str = ""
    visible: bool = True
    children: list["OrgItem"] = field(default_factory=list)
    element: Optional[Element] = field(default=None, repr=False)


@dataclass
class Manifest:
    root: str  # extraction directory
    path: str  # imsmanifest.xml on disk
    identifier: str = ""
    schema: str = ""
    schema_version: str = ""
    title: str = ""
    description: str = ""
    language: str = ""
    keywords: list[str] = field(default_factory=list)
    resources: dict[str, Resource] = field(default_factory=dict)
    # Top-level items of the default organization, root wrapper item removed
    items: list[OrgItem] = field(default_factory=list)
    organization_title: str = ""  # <organization><title>, or the root item's title
    element: Optional[Element] = field(default=None, repr=False)

    def resource(self, identifier: str) -> Optional[Resource]:
        return self.resources.get(identifier or "")

    def iter_items(self) -> Iterable[OrgItem]:
        """Every organization item, depth first."""
        stack = list(reversed(self.items))
        while stack:
            item = stack.pop()
            yield item
            stack.extend(reversed(item.children))


def find_manifest(root: str) -> Optional[str]:
    """``imsmanifest.xml`` at the top of ``root`` (any case), or None."""
    try:
        names = os.listdir(root)
    except OSError:
        return None
    for name in sorted(names):
        if name.lower() == MANIFEST_NAME and os.path.isfile(os.path.join(root, name)):
            return os.path.join(root, name)
    return None


def is_cc_manifest(path: str) -> bool:
    """True when the manifest declares a Common Cartridge schema or namespace."""
    try:
        with open(path, "rb") as f:
            head = f.read(64 * 1024).lower()
    except OSError:
        return False
    return any(marker in head for marker in _CC_MARKERS)


def _lom_string(el: Optional[Element]) -> str:
    """Text of a LOM langstring (``<string>`` children, or the element itself)."""
    if el is None:
        return ""
    strings = [s for s in el.iter("string") if (s.text or "").strip()]
    if strings:
        return strings[0].text.strip()
    return inner_text(el)


def _join(base: str, href: str) -> str:
    href = unquote((href or "").strip()).replace("\\", "/")
    if not href:
        return ""
    joined = posixpath.normpath(posixpath.join(base, href)) if base else posixpath.normpath(href)
    return joined.lstrip("/") if joined != "." else ""


def _instructor_only(res_el: Element) -> bool:
    roles = [(text(r, "value") or "").lower() for r in res_el.iter("intendedEndUserRole")]
    roles = [r for r in roles if r]
    return bool(roles) and all(r in ("instructor", "mentor", "teacher") for r in roles)


_INLINE_TAG_RE = re.compile(r"</?(?:em|i|strong|b|u|span|sup|sub|small|big|font|code|br)\b[^>]*>", re.I)


def clean_title(title: str) -> str:
    """Item titles as plain text: Moodle and others put inline HTML in them."""
    if "<" in (title or "") or "&" in (title or ""):
        title = html_lib.unescape(_INLINE_TAG_RE.sub("", title))
    return re.sub(r"\s+", " ", title or "").strip()


def _parse_items(parent: Element) -> list[OrgItem]:
    out = []
    for el in children(parent, "item"):
        visible = attr(el, "isvisible", "true").strip().lower() not in ("false", "0", "no")
        out.append(OrgItem(identifier=attr(el, "identifier"), title=clean_title(text(el, "title")),
                           identifierref=attr(el, "identifierref"), visible=visible,
                           children=_parse_items(el), element=el))
    return out


def parse_manifest(root: str, manifest_path: Optional[str] = None) -> Manifest:
    """Parse ``imsmanifest.xml`` under ``root``.

    Resource and file paths are resolved against the manifest's folder and any
    ``xml:base`` so they are relative to ``root``. Raises :class:`XmlError`
    (or ``FileNotFoundError``) when the manifest is unreadable.
    """
    root = os.path.realpath(root)
    path = manifest_path or find_manifest(root)
    if not path:
        raise FileNotFoundError(f"{MANIFEST_NAME} not found")
    el = parse_xml_file(path)
    rel_dir = os.path.relpath(os.path.dirname(os.path.realpath(path)), root).replace(os.sep, "/")
    rel_dir = "" if rel_dir == "." else rel_dir
    m = Manifest(root=root, path=path, identifier=attr(el, "identifier"), element=el)

    meta = el.find("metadata")
    if meta is not None:
        m.schema = text(meta, "schema")
        m.schema_version = text(meta, "schemaversion")
        lom = meta.find("lom")
        general = lom.find("general") if lom is not None else None
        if general is not None:
            m.title = _lom_string(general.find("title"))
            m.description = _lom_string(general.find("description"))
            m.language = text(general, "language")
            m.keywords = [k for k in (_lom_string(kw) for kw in general.findall("keyword")) if k]

    resources_el = el.find("resources")
    if resources_el is not None:
        base = _join(rel_dir, attr(resources_el, "base")) if attr(resources_el, "base") else rel_dir
        for res_el in children(resources_el, "resource"):
            res_base = _join(base, attr(res_el, "base")) if attr(res_el, "base") else base
            href = _join(res_base, attr(res_el, "href"))
            files = [f for f in (_join(res_base, attr(f, "href")) for f in children(res_el, "file")) if f]
            deps = [attr(d, "identifierref") for d in children(res_el, "dependency") if attr(d, "identifierref")]
            ident = attr(res_el, "identifier")
            if not ident:
                continue
            m.resources[ident] = Resource(
                identifier=ident, type=attr(res_el, "type"), href=href, files=files, dependencies=deps,
                intendeduse=attr(res_el, "intendeduse").lower(), instructor_only=_instructor_only(res_el),
                element=res_el,
            )

    orgs = el.find("organizations")
    org = None
    if orgs is not None:
        all_orgs = children(orgs, "organization")
        default = attr(orgs, "default")
        org = next((o for o in all_orgs if default and attr(o, "identifier") == default), None)
        if org is None and all_orgs:
            org = all_orgs[0]
    if org is not None:
        items = _parse_items(org)
        m.organization_title = clean_title(text(org, "title"))
        # CC organizations are "rooted": one untitled item wraps the modules
        if len(items) == 1 and not items[0].identifierref:
            wrapper = items[0]
            if not wrapper.title or any(c.children for c in wrapper.children) or not wrapper.children:
                items = wrapper.children
                m.organization_title = m.organization_title or wrapper.title
        m.items = items
    return m


def resource_files(manifest: Manifest, resource: Resource, include_dependencies: bool = True) -> list[str]:
    """Files of ``resource`` (href first), plus those of its dependencies, without duplicates."""
    out: list[str] = []
    seen: set[str] = set()

    def visit(res: Resource):
        if res.identifier in seen:
            return
        seen.add(res.identifier)
        for f in ([res.href] if res.href else []) + res.files:
            if f and f not in out:
                out.append(f)
        if include_dependencies:
            for dep in res.dependencies:
                dep_res = manifest.resource(dep)
                if dep_res is not None:
                    visit(dep_res)

    visit(resource)
    return out


# ---------------------------------------------------------------------------
# Files and HTML
# ---------------------------------------------------------------------------


def read_text(path: str) -> str:
    """Decode a text file from an export (BOM aware, UTF-8 then cp1252)."""
    data = read_limited(path, MAX_TEXT_BYTES)
    for bom, encoding in ((b"\xef\xbb\xbf", "utf-8-sig"), (b"\xff\xfe", "utf-16"), (b"\xfe\xff", "utf-16")):
        if data.startswith(bom):
            return data.decode(encoding, errors="replace")
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return data.decode("cp1252", errors="replace")


@dataclass
class HtmlDoc:
    title: str = ""
    body: str = ""
    meta: dict[str, str] = field(default_factory=dict)  # <meta name=... content=...>, names lowercased


_BODY_RE = re.compile(r"<body\b[^>]*>(.*?)(?:</body\s*>|\Z)", re.S | re.I)
_TITLE_RE = re.compile(r"<title\b[^>]*>(.*?)</title\s*>", re.S | re.I)
_META_RE = re.compile(r"<meta\b[^>]*>", re.I)
_ATTR_RE = re.compile(r"""([a-zA-Z_:-]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)""")


def parse_html(source: str) -> HtmlDoc:
    """Title, ``<body>`` content and ``<meta>`` values of an HTML document."""
    doc = HtmlDoc()
    m = _TITLE_RE.search(source)
    if m:
        doc.title = html_lib.unescape(re.sub(r"<[^>]+>", "", m.group(1))).strip()
    head_end = source.lower().find("<body")
    head = source if head_end < 0 else source[:head_end]
    for tag in _META_RE.findall(head):
        attrs = {k.lower(): v.strip("\"'") for k, v in _ATTR_RE.findall(tag)}
        name = attrs.get("name", "").lower()
        if name:
            doc.meta[name] = html_lib.unescape(attrs.get("content", ""))
    body = _BODY_RE.search(source)
    if body:
        doc.body = body.group(1).strip()
    else:
        # A fragment: drop a stray head if there is one
        doc.body = re.sub(r"<head\b.*?</head\s*>", "", source, flags=re.S | re.I)
        doc.body = re.sub(r"</?html\b[^>]*>", "", doc.body, flags=re.I).strip()
    return doc


def read_html(path: str) -> HtmlDoc:
    return parse_html(read_text(path))


def make_cc_resolver(index: FileIndex, doc_dir: str = "", filebase_dirs: Iterable[str] = (),
                     manifest: Optional[Manifest] = None) -> ir.Resolver:
    """Resolver for URLs in a cartridge document stored in ``doc_dir``.

    ``$IMS-CC-FILEBASE$`` (in any of its spellings) is tried against the
    document folder, then each of ``filebase_dirs`` (Canvas puts course files
    under ``web_resources``), then the package root. Canvas ``file_ref`` links
    are looked up in the manifest resources. Everything else falls back to
    :func:`.common.make_resolver` (document-relative, root, unique basename).
    """
    dirs = [d for d in dict.fromkeys([doc_dir, *filebase_dirs, ""])]

    def extra(url: str) -> Optional[ir.Asset]:
        if manifest is not None:
            m = _REF_ID_RE.search(url or "")
            if m:
                res = manifest.resource(unquote(m.group(1)))
                full = index.get(res.main_file) if res is not None and res.main_file else None
                if full:
                    return index.asset(full)
        m = FILEBASE_RE.match(url or "")
        if not m:
            return None
        rest = clean_url(url[m.end():]).lstrip("/")
        if not rest:
            return None
        for d in dirs:
            full = index.get(f"{d}/{rest}" if d else rest)
            if full:
                return index.asset(full)
        return None

    return make_resolver(index, doc_dir, extra)


def unwrap_internal_links(source_html: str, keep_files: bool = True) -> str:
    """Turn links to other course objects into plain text.

    Canvas ``$WIKI_REFERENCE$`` / ``$CANVAS_OBJECT_REFERENCE$`` links and
    links to other HTML pages of the package have no target once the course
    is in LearnHouse; their text is kept. File links are left alone so the
    converter can attach the file.
    """
    if not source_html or "<a" not in source_html.lower():
        return source_html

    def repl(m: re.Match) -> str:
        href = html_lib.unescape(m.group(1) or m.group(2) or "").strip()
        internal = False
        if _OBJECT_LINK_RE.search(href) and not (keep_files and _FILE_LINK_RE.search(href)):
            internal = True
        elif _LMS_LINK_RE.match(href):
            internal = True
        elif href and not re.match(r"^[a-z][a-z0-9+.-]*:|^#|^//", href, re.I):
            path = clean_url(FILEBASE_RE.sub("", href))
            if os.path.splitext(path)[1].lower().lstrip(".") in _HTML_EXTS:
                internal = True
        return m.group(3) if internal else m.group(0)

    return _ANCHOR_RE.sub(repl, source_html)


def is_scorm_zip(path: str) -> bool:
    """A zip with an ``imsmanifest.xml`` at its top (a SCORM package)."""
    try:
        with zipfile.ZipFile(path) as zf:
            return any(n.lower().strip("/") == MANIFEST_NAME for n in zf.namelist())
    except (zipfile.BadZipFile, OSError):
        return False


def item_for_file(index: FileIndex, rel: str, title: str, ident: str = "", visible: bool = True,
                  ) -> Optional[ir.Item]:
    """The natural item for a non-HTML file: PDF document, video, image/audio
    page, SCORM package or a page offering the download. None when missing."""
    full = index.get(rel)
    if not full:
        return None
    asset = index.asset(full)
    ext = asset.extension
    title = title or slug_title(asset.name)
    if ext == "pdf":
        return ir.DocumentItem(title=title, asset=asset, id=ident, visible=visible)
    if ext in _VIDEO_EXTS:
        return ir.VideoItem(title=title, asset=asset, id=ident, visible=visible)
    if ext in _IMAGE_EXTS:
        return ir.Page(title=title, parts=[ir.MediaPart(ir.MediaKind.IMAGE, asset=asset)], id=ident,
                       visible=visible)
    if ext in _AUDIO_EXTS:
        return ir.Page(title=title, parts=[ir.MediaPart(ir.MediaKind.AUDIO, asset=asset)], id=ident,
                       visible=visible)
    if ext == "zip" and is_scorm_zip(full):
        return ir.ScormItem(title=title, package=asset, id=ident, visible=visible)
    if ext in ("txt", "text") and os.path.getsize(full) <= _MAX_TEXT_PAGE:
        return ir.Page(title=title, parts=[ir.HtmlPart(ir.RichText(text_to_html(read_text(full))))], id=ident,
                       visible=visible)
    return ir.Page(title=title, parts=[ir.FilePart(asset=asset, title=asset.name)], id=ident, visible=visible)


def text_to_html(value: str) -> str:
    """Plain text as HTML paragraphs (blank lines split paragraphs)."""
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", value.replace("\r\n", "\n")) if p.strip()]
    return "".join(f"<p>{html_lib.escape(p).replace(chr(10), '<br>')}</p>" for p in paragraphs)


def link_item(url: str, title: str, ident: str = "", visible: bool = True, description: str = "") -> ir.Item:
    """YouTube/Vimeo links become videos, anything else a page with a link card."""
    url = (url or "").strip()
    title = title or url
    if youtube_id(url) or vimeo_id(url):
        return ir.VideoItem(title=title, url=url, id=ident, visible=visible)
    return ir.Page(title=title, parts=[ir.LinkPart(url=url, title=title, description=description)], id=ident,
                   visible=visible)


# ---------------------------------------------------------------------------
# Resource documents
# ---------------------------------------------------------------------------


XmlSource = Union[str, Element]


def _as_element(source: XmlSource) -> Element:
    return parse_xml_file(source) if isinstance(source, str) else source


def parse_weblink(source: XmlSource) -> tuple[str, str]:
    """(title, url) of an ``imswl`` web link (file path or parsed element)."""
    el = _as_element(source)
    url_el = el.find("url")
    return text(el, "title"), attr(url_el, "href").strip() if url_el is not None else ""


@dataclass
class Topic:
    title: str = ""
    html: str = ""
    attachments: list[str] = field(default_factory=list)  # hrefs as written (relative to the topic file)


def _cc_text(el: Optional[Element]) -> str:
    """HTML of a CC ``<text texttype=...>`` element (plain text is escaped)."""
    if el is None:
        return ""
    value = el.text or ""
    if (attr(el, "texttype") or "text/plain").lower() == "text/html":
        return value.strip()
    return html_lib.escape(value.strip()).replace("\n", "<br>")


def parse_discussion(source: XmlSource) -> Topic:
    """Title, HTML text and attachment hrefs of an ``imsdt`` topic (path or element)."""
    el = _as_element(source)
    att = el.find("attachments")
    return Topic(title=text(el, "title"), html=_cc_text(el.find("text")),
                 attachments=[attr(a, "href") for a in children(att, "attachment") if attr(a, "href")])


@dataclass
class LtiLink:
    title: str = ""
    description: str = ""
    launch_url: str = ""


def parse_lti(source: XmlSource) -> LtiLink:
    """Title, description and launch URL of a ``cartridge_basiclti_link`` (path or element)."""
    el = _as_element(source)
    return LtiLink(title=text(el, "title"), description=text(el, "description"),
                   launch_url=text(el, "secure_launch_url") or text(el, "launch_url"))


# Question types whose answers a quiz can check automatically
_KEYED_TYPES = (ir.QType.MULTICHOICE, ir.QType.TRUEFALSE, ir.QType.SHORTANSWER, ir.QType.NUMERICAL,
                ir.QType.MATCHING, ir.QType.ORDERING, ir.QType.CLOZE)


def has_answer_key(q: ir.Question) -> bool:
    """True when ``q`` says which answer is right (choices, accepted values...)."""
    if q.type in (ir.QType.MULTICHOICE, ir.QType.TRUEFALSE):
        return any(c.correct for c in q.choices)
    if q.type == ir.QType.SHORTANSWER:
        return bool(q.answers)
    if q.type == ir.QType.NUMERICAL:
        return bool(q.numeric)
    if q.type == ir.QType.MATCHING:
        return bool(q.pairs)
    if q.type == ir.QType.ORDERING:
        return bool(q.ordering)
    if q.type == ir.QType.CLOZE:
        return any(b.answers or b.numeric for b in q.blanks)
    return False


def survey_prompt(q: ir.Question) -> ir.Question:
    """An unanswerable survey question as a text block: the prompt and its options."""
    body = q.text.html
    options = [c.text.html for c in q.choices] or [html_lib.escape(p.answer) for p in q.pairs]
    if options:
        body += "<ul>" + "".join(f"<li>{o}</li>" for o in options) + "</ul>"
    return ir.Question(type=ir.QType.DESCRIPTION, text=ir.RichText(body, q.text.resolve), title=q.title, id=q.id,
                       points=0, source_type=q.source_type)


def own_qti_metadata(el: Optional[Element]) -> dict[str, str]:
    """Metadata fields of an ``<assessment>`` itself, not of its items."""
    if el is None:
        return {}
    return qti.qti_metadata(el.find("qtimetadata"))


def max_attempts_from(value: str, default: int = 1) -> int:
    """cc_maxattempts / allowed_attempts: ``unlimited`` or -1 -> 0 (unlimited)."""
    v = (value or "").strip().lower()
    if not v:
        return default
    if v in ("unlimited", "-1"):
        return 0
    n = to_int(v, default)
    return 0 if n < 0 else (n or default)


def read_qti_assessment(source: XmlSource, resolve: ir.Resolver, *, title: str = "", ident: str = "",
                        visible: bool = True, type_hook: Optional[qti.TypeHook] = None,
                        material_hook: Optional[qti.MaterialHook] = None) -> Optional[ir.Assessment]:
    """First assessment of a QTI 1.2 file as an IR Assessment (None when the
    file has no assessment). Reads ``cc_maxattempts`` and ``qmd_timelimit``.
    ``source`` is a file path or an already parsed ``questestinterop``."""
    root = _as_element(source)
    parsed = qti.parse_assessment(root, resolve, type_hook=type_hook, material_hook=material_hook)
    if not parsed:
        return None
    qa = parsed[0]
    el = next(root.iter("assessment"), None)
    meta = own_qti_metadata(el) if el is not None else {}
    time_limit = to_int(meta.get("qmd_timelimit"), 0)
    kind = (meta.get("qmd_assessmenttype") or "").lower()
    return ir.Assessment(
        title=title or qa.title or "Quiz",
        questions=qa.questions,
        intro=ir.RichText(qa.intro_html, resolve),
        max_attempts=max_attempts_from(meta.get("cc_maxattempts", "")),
        time_limit_minutes=time_limit if time_limit > 0 else None,
        graded=kind not in ("self-assessment", "survey"),
        id=ident or qa.ident,
        visible=visible,
    )


# ---------------------------------------------------------------------------
# Reader
# ---------------------------------------------------------------------------


class CartridgeReader:
    """Builds an IR course from a cartridge.

    Dialect readers subclass it and override :meth:`item_for_resource`,
    :meth:`prepare_html` or :attr:`filebase_dirs`.
    """

    source_key = KEY
    filebase_dirs: tuple[str, ...] = ()

    def __init__(self, root: str, manifest: Optional[Manifest] = None, index: Optional[FileIndex] = None):
        self.root = os.path.realpath(root)
        self.index = index or FileIndex(self.root)
        self.manifest = manifest or parse_manifest(self.root)
        self.warnings: list[str] = []  # problems reading the export
        self.skipped: list[tuple[str, str, str]] = []  # (title, kind, reason) of items not migrated
        self.used: set[str] = set()  # resource identifiers placed in the course

    # ------------------------------------------------------------ helpers

    def warn(self, message: str) -> None:
        if message not in self.warnings:
            self.warnings.append(message)

    def skip(self, title: str, kind: str, reason: str) -> None:
        """Record a source item that is not in the course (see ``ir.Course.skipped``)."""
        entry = (title, kind, reason)
        if entry not in self.skipped:
            self.skipped.append(entry)

    def resolver_for(self, doc_dir: str) -> ir.Resolver:
        return make_cc_resolver(self.index, doc_dir, self.filebase_dirs, self.manifest)

    def prepare_html(self, source_html: str, doc_dir: str) -> str:
        """Hook to rewrite source HTML before it is stored in the IR."""
        return self.unwrap_dead_links(unwrap_internal_links(source_html), doc_dir)

    def unwrap_dead_links(self, source_html: str, doc_dir: str) -> str:
        """Site-absolute links (``/syllabus``) that no package file answers point
        back into the old site; keep their text only."""
        if 'href="/' not in source_html and "href='/" not in source_html:
            return source_html
        resolve = self.resolver_for(doc_dir)

        def repl(m: re.Match) -> str:
            href = html_lib.unescape(m.group(1) or m.group(2) or "").strip()
            if href.startswith("/") and not href.startswith("//") and resolve(href) is None:
                return m.group(3)
            return m.group(0)

        return _ANCHOR_RE.sub(repl, source_html)

    def rich(self, source_html: str, doc_dir: str) -> ir.RichText:
        return ir.RichText(self.prepare_html(source_html or "", doc_dir), self.resolver_for(doc_dir))

    def assignment_without_document(self, res: Resource, title: str, ident: str, visible: bool,
                                    ) -> ir.AssignmentItem:
        """An assignment whose description file is missing: keep it, with the
        files it depends on as attachments, rather than dropping it."""
        title = title or res.identifier
        self.skip(title, "assignment", "its description is missing from the export")
        attachments = []
        for rel in resource_files(self.manifest, res):
            full = self.index.get(rel)
            if full and not rel.lower().endswith(".xml"):
                attachments.append(self.index.asset(full))
        return ir.AssignmentItem(title=title, attachments=attachments, id=ident, visible=visible)

    def finish_assessment(self, assessment: ir.Assessment,
                          empty_reason: str = "the quiz has no questions in the export") -> ir.Item:
        """Checks shared by every quiz reader: empty quizzes and surveys."""
        if not assessment.questions:
            reason = empty_reason
            if not assessment.intro.is_empty():
                # Only the description survives, as a page
                self.skip(assessment.title, "quiz", "no questions in the export")
                return ir.Page(title=assessment.title, parts=[ir.HtmlPart(assessment.intro)], id=assessment.id,
                               visible=assessment.visible)
            return ir.UnsupportedItem(title=assessment.title, kind="quiz", reason=reason, id=assessment.id)
        keyed = [q for q in assessment.questions if q.type in _KEYED_TYPES]
        if assessment.graded and keyed and not any(has_answer_key(q) for q in keyed):
            assessment.graded = False  # nothing to check against: an ungraded survey
        if not assessment.graded:
            assessment.questions = [q if q.type not in _KEYED_TYPES or has_answer_key(q) else survey_prompt(q)
                                    for q in assessment.questions]
        return assessment

    # ------------------------------------------------------------- driver

    def read(self) -> ir.Course:
        m = self.manifest
        course = ir.Course(
            title=m.title or m.organization_title or "Imported course",
            source=self.source_key,
            id=m.identifier,
            summary=ir.RichText(html_lib.escape(m.description)) if m.description else ir.RichText(),
            tags=list(m.keywords),
            language=m.language,
        )
        course.sections = self.sections(course.title)
        syllabus = self.syllabus_page()
        if syllabus is not None:
            course.sections.insert(0, ir.Section(title="Syllabus", items=[syllabus], id="syllabus"))
        if not any(s.items for s in course.sections):
            course.sections.extend(self.bank_sections())
        course.warnings = list(self.warnings)
        course.skipped = list(self.skipped)
        return course

    def bank_sources(self) -> list[tuple[str, str, str]]:
        """(identifier, QTI file, folder) of every question bank resource."""
        out = []
        for res in self.manifest.resources.values():
            if res.kind == "question_bank":
                full = self.qti_file(res)
                if full:
                    rel = os.path.relpath(os.path.dirname(full), self.root).replace(os.sep, "/")
                    out.append((res.identifier, full, "" if rel == "." else rel))
        return out

    def bank_sections(self, used: Optional[set[str]] = None) -> list[ir.Section]:
        """Question banks as hidden quizzes: all of them for a cartridge that only
        holds banks, or (with ``used``) the banks no quiz draws from."""
        items: list[ir.Item] = []
        for ident, path, doc_dir in self.bank_sources():
            if used is not None and ident in used:
                continue
            root = try_parse_xml_file(path)
            if root is None:
                continue
            bank = next(root.iter("objectbank"), root)
            meta = qti.qti_metadata(bank.find("qtimetadata"))
            questions = [self.bank_question(item, self.resolver_for(doc_dir)) for item in bank.iter("item")]
            if questions:
                title = meta.get("bank_title") or attr(bank, "title") or f"Question bank {len(items) + 1}"
                items.append(ir.Assessment(title=title, questions=questions, max_attempts=0, id=ident,
                                           visible=False))
        if not items:
            return []
        return [ir.Section(title="Question banks", items=items, id="question-banks", visible=False)]

    def bank_question(self, item: Element, resolve: ir.Resolver) -> ir.Question:
        """Hook: parse one bank item (dialect readers add their type fixes)."""
        return qti.parse_item(item, resolve)

    def syllabus_page(self) -> Optional[ir.Page]:
        for res in self.manifest.resources.values():
            if res.intendeduse != "syllabus" or res.identifier in self.used:
                continue
            main = res.main_file
            try:
                if os.path.splitext(main)[1].lower().lstrip(".") in _HTML_EXTS:
                    page = self.html_page(main, "Syllabus", res.identifier, True)
                    if page is not None and not all(p.content.is_empty() for p in page.parts
                                                    if isinstance(p, ir.HtmlPart)):
                        self.used.add(res.identifier)
                        return page
                elif main:
                    item = item_for_file(self.index, main, "Syllabus", res.identifier)
                    if isinstance(item, ir.Page):
                        self.used.add(res.identifier)
                        return item
            except (XmlError, OSError) as e:  # read outside _safe_items: an oversized file must not end the import
                self.warn(f"Could not read 'Syllabus': {error_text(e)}")
                self.skip("Syllabus", "page", f"unreadable resource: {error_text(e)}")
                self.used.add(res.identifier)
        return None

    # ---------------------------------------------------------- structure

    def sections(self, course_title: str) -> list[ir.Section]:
        if not self.manifest.items:
            return self.unorganized_sections(course_title)
        out: list[ir.Section] = []
        loose: Optional[ir.Section] = None
        for item in self.manifest.items:
            if item.children:
                out.extend(self.module_sections(item))
                loose = None
            elif item.identifierref:
                if loose is None:
                    loose = ir.Section(title=course_title or "General", id=f"{item.identifier}:loose")
                    out.append(loose)
                loose.items.extend(self.items_for(item, "", True))
            else:
                out.append(ir.Section(title=item.title or "Untitled", id=item.identifier, visible=item.visible))
                loose = None
        return out

    def module_sections(self, module: OrgItem) -> list[ir.Section]:
        """A top-level item and its subtree: one section, split at text headers."""
        title = module.title or "Untitled"
        sections = [ir.Section(title=title, id=module.identifier, visible=module.visible)]
        if module.identifierref:
            sections[0].items.extend(self.items_for(module, "", module.visible))
        for child in module.children:
            self._add_child(child, sections, title, "", module.visible)
        return [s for i, s in enumerate(sections) if i == 0 or s.items]

    def _add_child(self, item: OrgItem, sections: list[ir.Section], module_title: str, prefix: str,
                   visible: bool) -> None:
        visible = visible and item.visible
        if item.children:
            if item.identifierref:
                sections[-1].items.extend(self.items_for(item, prefix, visible))
            sub_prefix = f"{prefix}{item.title} › " if item.title else prefix
            for child in item.children:
                self._add_child(child, sections, module_title, sub_prefix, visible)
        elif item.identifierref:
            sections[-1].items.extend(self.items_for(item, prefix, visible))
        elif item.title:
            # A text header: the items after it form their own chapter
            sections.append(ir.Section(title=f"{module_title} › {prefix}{item.title}", id=item.identifier,
                                       visible=visible))

    def unorganized_sections(self, course_title: str) -> list[ir.Section]:
        """No organization: every placeable resource, in manifest order."""
        section = ir.Section(title=course_title or "General", id="resources")
        for res in self.manifest.resources.values():
            if res.intendeduse == "syllabus" or not self.is_placeable(res):
                continue
            self.used.add(res.identifier)
            section.items.extend(self._safe_items(res, "", res.identifier, not res.instructor_only))
        return [section] if section.items else []

    def is_placeable(self, res: Resource) -> bool:
        """Resources worth importing when nothing organizes them."""
        if res.kind in ("weblink", "discussion", "assessment", "lti", "assignment"):
            return True
        if res.kind == "webcontent":
            return os.path.splitext(res.href)[1].lower().lstrip(".") in _HTML_EXTS
        return False

    def items_for(self, item: OrgItem, prefix: str, visible: bool) -> list[ir.Item]:
        title = f"{prefix}{item.title}" if item.title else ""
        res = self.manifest.resource(item.identifierref)
        if res is None:
            self.skip(item.title or item.identifierref, "item", "missing from the export")
            return []
        self.used.add(res.identifier)
        return self._safe_items(res, title, item.identifier, visible and item.visible and not res.instructor_only)

    def _safe_items(self, res: Resource, title: str, ident: str, visible: bool) -> list[ir.Item]:
        try:
            return self.item_for_resource(res, title, ident, visible)
        except (XmlError, OSError, ValueError) as e:
            self.warn(f"Could not read '{title or res.identifier}': {error_text(e)}")
            return [ir.UnsupportedItem(title=title or res.identifier, kind=res.type or "resource",
                                       reason=f"unreadable resource: {error_text(e)}", id=ident)]

    # ----------------------------------------------------------- resources

    def item_for_resource(self, res: Resource, title: str, ident: str, visible: bool) -> list[ir.Item]:
        """IR items for one resource placed in the course (usually one)."""
        kind = res.kind
        if kind in ("webcontent", "associated"):
            return self.webcontent_items(res, title, ident, visible)
        if kind == "weblink":
            return self.weblink_items(res, title, ident, visible)
        if kind == "discussion":
            return self.discussion_items(res, title, ident, visible)
        if kind == "assessment":
            return self.assessment_items(res, title, ident, visible)
        if kind == "question_bank":
            return []  # placed by bank_sections, hidden
        if kind == "lti":
            return self.lti_items(res, title, ident, visible)
        if kind == "assignment":
            return self.assignment_items(res, title, ident, visible)
        return [ir.UnsupportedItem(title=title or res.identifier, kind=res.type or "resource",
                                   reason=f"resource type '{res.type}' is not supported", id=ident)]

    def _file(self, res: Resource) -> Optional[str]:
        return res.existing_file(self.index)

    def manifest_dir(self) -> str:
        if not self.manifest.path:
            return ""
        rel = os.path.relpath(os.path.dirname(os.path.realpath(self.manifest.path)), self.root).replace(os.sep, "/")
        return "" if rel == "." else rel

    def document(self, res: Resource) -> tuple[Optional[XmlSource], str]:
        """(file path or inline element, folder its relative URLs start from)."""
        inline = res.inline
        if inline is not None:
            return inline, self.manifest_dir()
        return self._file(res), posixpath.dirname(res.main_file)

    def html_page(self, rel: str, title: str, ident: str, visible: bool) -> Optional[ir.Page]:
        full = self.index.get(rel)
        if not full:
            return None
        doc = read_html(full)
        doc_dir = posixpath.dirname(rel)
        return ir.Page(title=title or doc.title or slug_title(rel),
                       parts=[ir.HtmlPart(self.rich(doc.body, doc_dir))], id=ident, visible=visible)

    def webcontent_items(self, res: Resource, title: str, ident: str, visible: bool) -> list[ir.Item]:
        main = res.main_file
        if not main:
            return [ir.UnsupportedItem(title=title or res.identifier, kind="webcontent",
                                       reason="resource has no file", id=ident)]
        ext = os.path.splitext(main)[1].lower().lstrip(".")
        if res.intendeduse == "assignment":
            return [self.webcontent_assignment(res, title, ident, visible)]
        if res.intendeduse == "lessonplan":
            visible = False
        full = res.existing_file(self.index)
        if full and not self.index.get(main):
            main = os.path.relpath(full, self.root).replace(os.sep, "/")
            ext = os.path.splitext(main)[1].lower().lstrip(".")
        if ext in _HTML_EXTS:
            page = self.html_page(main, title, ident, visible)
        else:
            page = item_for_file(self.index, main, title, ident, visible)
        if page is None:
            self.skip(title or main, "file", "missing from the export")
            return []
        return [page]

    def webcontent_assignment(self, res: Resource, title: str, ident: str, visible: bool) -> ir.AssignmentItem:
        """A webcontent resource flagged ``intendeduse="assignment"``."""
        main = res.main_file
        instructions = ir.RichText()
        attachments: list[ir.Asset] = []
        doc_title = ""
        for rel in [main] + [f for f in res.files if f != main]:
            full = self.index.get(rel)
            if not full:
                continue
            if rel == main and os.path.splitext(rel)[1].lower().lstrip(".") in _HTML_EXTS:
                doc = read_html(full)
                doc_title = doc.title
                instructions = self.rich(doc.body, posixpath.dirname(rel))
            else:
                attachments.append(self.index.asset(full))
        return ir.AssignmentItem(title=title or doc_title or slug_title(main), instructions=instructions,
                                 attachments=attachments, id=ident, visible=visible)

    def weblink_items(self, res: Resource, title: str, ident: str, visible: bool) -> list[ir.Item]:
        doc, _doc_dir = self.document(res)
        if doc is None:
            self.skip(title or res.main_file or res.identifier, "link", "missing from the export")
            return []
        link_title, url = parse_weblink(doc)
        if not url:
            return [ir.UnsupportedItem(title=title or link_title or res.identifier, kind="link",
                                       reason="web link has no URL", id=ident)]
        return [link_item(url, title or link_title, ident, visible)]

    def discussion_items(self, res: Resource, title: str, ident: str, visible: bool) -> list[ir.Item]:
        doc, doc_dir = self.document(res)
        if doc is None:
            self.skip(title or res.main_file or res.identifier, "discussion", "missing from the export")
            return []
        topic = parse_discussion(doc)
        parts: list[ir.Part] = []
        rich = self.rich(topic.html, doc_dir)
        if not rich.is_empty():
            parts.append(ir.HtmlPart(rich))
        for href in topic.attachments:
            asset = rich.resolve(href)
            if asset is None:
                self.skip(posixpath.basename(unquote(href)) or href, "file", "missing from the export")
                continue
            parts.append(ir.FilePart(asset=asset, title=asset.name))
        return [ir.Page(title=title or topic.title or "Discussion", parts=parts, id=ident, visible=visible)]

    def qti_file(self, res: Resource) -> Optional[str]:
        """The QTI document of an assessment resource.

        Its own files first, then its dependencies (Canvas QTI exports list
        the questions under the meta resource) and Canvas's
        ``non_cc_assessments/<id>.xml.qti``.
        """
        own = resource_files(self.manifest, res, include_dependencies=False)
        deps = [f for f in resource_files(self.manifest, res) if f not in own]
        for rel in own + deps + [f"non_cc_assessments/{res.identifier}.xml.qti"]:
            if rel.lower().endswith((".xml", ".qti")) and posixpath.basename(rel).lower() != "assessment_meta.xml":
                full = self.index.get(rel)
                if full:
                    return full
        return None

    def assessment_items(self, res: Resource, title: str, ident: str, visible: bool) -> list[ir.Item]:
        inline = res.inline
        if inline is not None:
            source: Optional[XmlSource] = inline
            doc_dir = self.manifest_dir()
        else:
            source = self.qti_file(res)
            if source is None:
                self.skip(title or res.identifier, "quiz", "missing from the export")
                return []
            rel_dir = os.path.relpath(os.path.dirname(source), self.root).replace(os.sep, "/")
            doc_dir = "" if rel_dir == "." else rel_dir
        assessment = read_qti_assessment(source, self.resolver_for(doc_dir), title=title, ident=ident,
                                         visible=visible)
        if assessment is not None and isinstance(source, str) and "/survey/" in f"/{doc_dir.lower()}/":
            assessment.graded = False  # D2L files its surveys under survey/
        if assessment is None:
            return [ir.UnsupportedItem(title=title or res.identifier, kind="quiz",
                                       reason="no QTI assessment in the file", id=ident)]
        return [self.finish_assessment(assessment)]

    def lti_items(self, res: Resource, title: str, ident: str, visible: bool) -> list[ir.Item]:
        doc, _doc_dir = self.document(res)
        link = parse_lti(doc) if doc is not None else LtiLink()
        url = link.launch_url
        reason = "external tool (LTI) links are not migrated"
        if url:
            reason += f"; launch URL: {url}"
        return [ir.UnsupportedItem(title=title or link.title or res.identifier, kind="LTI tool", reason=reason,
                                   id=ident)]

    def assignment_items(self, res: Resource, title: str, ident: str, visible: bool) -> list[ir.Item]:
        """CC 1.3 ``assignment_xmlv1p0`` extension resource."""
        el = res.inline
        doc_dir = self.manifest_dir()
        if el is None:
            full = self._file(res)
            if not full or not full.lower().endswith(".xml"):
                # Some exporters point href at the instructions; the xml is a file
                full = next((self.index.get(f) for f in res.files
                             if f.lower().endswith(".xml") and self.index.get(f)), full)
            if not full or not full.lower().endswith(".xml"):
                return [self.assignment_without_document(res, title, ident, visible)]
            el = parse_xml_file(full)
            rel_dir = os.path.relpath(os.path.dirname(full), self.root).replace(os.sep, "/")
            doc_dir = "" if rel_dir == "." else rel_dir
        instructions = self.rich(_cc_text(el.find("text")), doc_dir)
        formats = {attr(f, "type").lower() for f in el.iter("format")}
        attachments = []
        for a in el.iter("attachment"):
            asset = instructions.resolve(attr(a, "href")) if attr(a, "href") else None
            if asset is not None:
                attachments.append(asset)
        ext = None
        exts = el.find("extensions")
        if exts is not None:
            ext = next((c for c in exts if c.tag == "assignment"), None)
        points = to_float(text(ext, "points_possible"), 0.0) if ext is not None else 0.0
        gradable = el.find("gradable")
        points = points or to_float(attr(gradable, "points_possible"), 0.0)
        graded = to_bool(text(el, "gradable"), True)
        if ext is not None and text(ext, "grading_type") == "not_graded":
            graded = False
        allow_text = bool(formats & {"text", "html", "url"})
        allow_file = "file" in formats or not formats
        item_title = title or (text(ext, "title") if ext is not None else "") or text(el, "title") or "Assignment"
        return [ir.AssignmentItem(
            title=item_title, instructions=instructions, due_date=iso_from_text(text(ext, "due_at")) if ext is not None
            else None, allow_file=allow_file, allow_text=allow_text, points=points or None, graded=graded,
            attachments=attachments, id=ident, visible=visible,
        )]


# ---------------------------------------------------------------------------
# Module interface
# ---------------------------------------------------------------------------


def detect(root: str) -> int:
    path = find_manifest(root)
    if not path:
        return 0
    return 60 if is_cc_manifest(path) else 0


def read(root: str) -> ir.Course:
    return CartridgeReader(root).read()
