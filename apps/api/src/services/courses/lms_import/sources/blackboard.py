"""
Blackboard Learn reader: course Export and Archive packages (.zip), from both
Original and Ultra courses.

Layout of an extracted package::

    .bb-package-info            Java properties (always present)
    imsmanifest.xml             organizations (the course menu tree) + resources
    res00001.dat ...            one XML file per resource (``bb:file``)
    res00012/...                files stored with a resource (older exports)
    csfiles/home_dir/...        Content Collection files, named
                                ``<name>__xid-<id>_1.<ext>`` with a ``.xml``
                                sidecar holding the original path

Resource types this reader uses:

* ``course/x-bb-coursesetting``: COURSE (title, description, banner)
* ``course/x-bb-coursetoc``: one course menu entry. CONTENT entries are
  content areas; their manifest item holds a ``--TOP--`` folder whose children
  are the area's content
* ``resource/x-bb-document``: every content item (CONTENT), typed by its
  CONTENTHANDLER (folder, document, file, external link, test link,
  assignment, learning module, Ultra document...)
* ``resource/x-bb-link``: LINK from a content item to what it opens (a course
  assessment, a tool, another content item)
* ``course/x-bb-courseassessment``: deployment settings of a test (attempts,
  time limit), pointing at the ``assessment/x-bb-qti-test`` QTI file
* ``assessment/x-bb-qti-pool``: question pools (only used when a test draws
  questions from them)
* ``course/x-bb-gradebook``: OUTCOMEDEFINITIONS (due dates and points)

Ultra courses use the same package with a ``ROOT`` menu entry, learning
modules (``x-bb-lesson``) as top-level folders and documents stored as a
``BB_PAGE`` folder holding an ``ultraDocumentBody`` item.
"""

from __future__ import annotations

import html
import json
import math
import mimetypes
import os
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Callable, Optional
from urllib.parse import unquote
from xml.etree.ElementTree import Element

from .. import ir
from .. import qti
from ..archive import safe_join
from ..html_to_tiptap import html_to_text, media_kind_for, vimeo_id, youtube_id
from ..report import error_text
from ..xmlutil import attr, children, parse_file, text, to_bool, to_float, to_int, try_parse_file, XmlError
from .common import FileIndex, iso_from_text, make_resolver

KEY = "blackboard"
LABEL = "Blackboard Learn"

_MANIFEST = "imsmanifest.xml"
_PACKAGE_INFO = ".bb-package-info"
# Resource files bigger than this are not parsed (tracking logs reach GBs)
_MAX_DAT_BYTES = 256 * 1024 * 1024
# Ultra "embedded HTML" snippets are inlined up to this size
_MAX_INLINE_HTML = 2 * 1024 * 1024

_XID = re.compile(r"xid-(\d+_\d+)")
_XID_FILE = re.compile(r"__xid-(\d+_\d+)")
_CS_PATH = re.compile(r"bbcswebdav(/(?:courses|orgs|users|institution|library)/[^?#]+)", re.I)
_LOCATION = "@X@EmbeddedFile.location@X@"
# Absolute links into the source server's Content Collection
_ABS_WEBDAV = re.compile(r"""(["'])(?:https?:)?//[^"'\s<>]*?/bbcswebdav/""", re.I)
# Template variables in links (course.url, user.id...) that make no sense outside Blackboard
_TEMPLATE_HREF = re.compile(
    r"""href=(["'])(?:@X@(?!EmbeddedFile)|@X@EmbeddedFile\.requestUrlStub@X@webapps/)[^"']*\1""", re.I)
# Files stored next to a resource under their bare xid ("res00001/xid-42130631_1")
_BARE_XID_FILE = re.compile(r"^xid-(\d+_\d+)(?:\.[^.]+)?$")
# Learn SaaS archives replace some embedded files with a base64 JSON pointer to a backup snapshot
_SNAPSHOT_POINTER = b"eyJzbmFwc2hvdFBhdGgi"
_MAGIC_EXT = ((b"\x89PNG", ".png"), (b"\xff\xd8\xff", ".jpg"), (b"GIF8", ".gif"), (b"%PDF", ".pdf"),
              (b"ID3", ".mp3"), (b"OggS", ".ogg"))

_FOLDER_HANDLERS = {"resource/x-bb-folder", "resource/x-bb-lesson", "resource/x-bb-lesson-plan"}
_PAGE_HANDLERS = {
    "resource/x-bb-document", "resource/x-bb-blankpage", "resource/x-bb-module-page", "resource/x-bb-syllabus",
}
_FILE_HANDLERS = {"resource/x-bb-file", "resource/x-bb-image", "resource/x-bb-video", "resource/x-bb-audio",
                  "resource/x-bb-mediafile"}
_TOOL_HANDLERS = {
    "resource/x-bb-toollink": "tool link",
    "resource/x-bb-forumlink": "discussion",
    "resource/x-bb-discussionfolder": "discussion",
    "resource/x-bb-blog-link": "blog",
    "resource/x-bb-bloglink": "blog",
    "resource/x-bb-journallink": "journal",
    "resource/x-bb-journal-link": "journal",
    "resource/x-bb-wiki-link": "wiki",
    "resource/x-bb-wikilink": "wiki",
    "resource/x-bb-grouplink": "group",
    "resource/x-bb-chat": "chat",
    "resource/x-bb-vc": "virtual classroom",
    "resource/x-bb-collab": "collaborate session",
    "resource/x-bb-blti-link": "LTI tool",
    "resource/x-bb-achievement": "achievement",
    "resource/x-bb-asmt-survey-link": "survey",
    "resource/x-plugin-scormengine": "scorm",
}
# Stand-alone tool data that never becomes course content
_STANDALONE = {
    "resource/x-bb-discussionboard": "discussion",
    "resource/x-bb-blog": "blog",
    "resource/x-bb-journal": "journal",
    "resource/x-bb-wiki": "wiki",
    "resource/x-bb-announcement": "announcement",
}
_ULTRA_INTERNAL_AREAS = {"interactive", "indirect"}
# Report reasons for items the reader leaves out
_LEGACY_REASON = "Blackboard 5/6 pre-QTI format"
_SCORM_REASON = "stored unpacked in the export; upload the original SCORM zip"
_UNREADABLE_REASON = "unreadable or missing in the export"
_EITHER_OR = {
    "agree_disagree": ("Agree", "Disagree"),
    "right_wrong": ("Right", "Wrong"),
    "yes_no": ("Yes", "No"),
    "true_false": ("True", "False"),
}
# Time zone abbreviations Blackboard writes after its dates ("2024-01-22 11:57:58 AWST")
_TZ_HOURS = {
    "UTC": 0, "GMT": 0, "Z": 0, "WET": 0, "WEST": 1, "BST": 1, "IST": 1, "CET": 1, "CEST": 2, "MET": 1,
    "MEST": 2, "EET": 2, "EEST": 3, "MSK": 3, "SAST": 2, "WAT": 1, "CAT": 2, "EAT": 3, "GST": 4, "PKT": 5,
    "ICT": 7, "WIB": 7, "HKT": 8, "SGT": 8, "PHT": 8, "AWST": 8, "JST": 9, "KST": 9, "ACST": 9.5,
    "ACDT": 10.5, "AEST": 10, "AEDT": 11, "NZST": 12, "NZDT": 13, "HST": -10, "AKST": -9, "AKDT": -8,
    "PST": -8, "PDT": -7, "MST": -7, "MDT": -6, "CST": -6, "CDT": -5, "EST": -5, "EDT": -4, "AST": -4,
    "ADT": -3, "NST": -3.5, "NDT": -2.5, "BRT": -3, "BRST": -2, "ART": -3, "CLT": -4, "COT": -5, "PET": -5,
}
_DATE = re.compile(
    r"^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}:\d{2}(?::\d{2})?)(?:\.\d+)?\s*([A-Za-z]{1,5}|[+-]\d{2}:?\d{2})?$"
)


# ---------------------------------------------------------------------------
# Detection
# ---------------------------------------------------------------------------


def detect(root: str) -> int:
    if not os.path.isdir(root):
        return 0
    has_info = os.path.isfile(os.path.join(root, _PACKAGE_INFO))
    head = b""
    try:
        with open(os.path.join(root, _MANIFEST), "rb") as f:
            head = f.read(512 * 1024)
    except OSError:
        pass
    bb_types = re.search(rb"type=[\"'](?:course|resource|assessment)/x-bb-", head) is not None
    bb_ns = b"blackboard.com/content-packaging" in head
    if bb_types or (has_info and bb_ns):
        return 95
    if bb_ns:
        return 80
    if has_info and head:
        # A Blackboard-made Common Cartridge: let the cartridge reader take it
        return 20
    return 0


# ---------------------------------------------------------------------------
# Dates
# ---------------------------------------------------------------------------


def bb_date(value: Optional[str]) -> Optional[str]:
    """ISO 8601 from a Blackboard date ("2024-01-22 11:57:58 AWST"), or None."""
    v = (value or "").strip()
    if not v:
        return None
    m = _DATE.match(v)
    if not m:
        return iso_from_text(v)
    day, clock, zone = m.groups()
    if clock.count(":") == 1:
        clock += ":00"
    try:
        dt = datetime.strptime(f"{day} {clock}", "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return None
    tz = timezone.utc
    if zone:
        if zone[0] in "+-":
            sign = -1 if zone[0] == "-" else 1
            digits = zone[1:].replace(":", "")
            tz = timezone(sign * timedelta(hours=int(digits[:2]), minutes=int(digits[2:])))
        elif zone.upper() in _TZ_HOURS:
            tz = timezone(timedelta(hours=_TZ_HOURS[zone.upper()]))
    return dt.replace(tzinfo=tz).isoformat()


def _head(path: str, n: int = 32) -> bytes:
    try:
        with open(path, "rb") as f:
            return f.read(n)
    except OSError:
        return b""


def _sniff_ext(path: str) -> str:
    """Extension for an extension-less file, from its magic bytes ("" when unknown)."""
    head = _head(path)
    if head[4:8] == b"ftyp":
        return ".mp4"
    return next((ext for magic, ext in _MAGIC_EXT if head.startswith(magic)), "")


def _is_snapshot_pointer(path: str) -> bool:
    return _head(path, len(_SNAPSHOT_POINTER)) == _SNAPSHOT_POINTER


# ---------------------------------------------------------------------------
# Package model
# ---------------------------------------------------------------------------


@dataclass
class _Res:
    ident: str
    type: str
    file: str
    base: str
    title: str
    hrefs: list[str] = field(default_factory=list)


@dataclass
class _Node:
    ref: str
    title: str
    children: list["_Node"] = field(default_factory=list)


@dataclass
class _Content:
    res: _Res
    el: Element
    id: str
    title: str
    handler: str
    body: str
    description: str
    available: bool
    url: str
    folder_type: str

    @property
    def is_folder(self) -> bool:
        return self.handler in _FOLDER_HANDLERS and self.folder_type.upper() != "BB_PAGE"


@dataclass
class _Outcome:
    due: Optional[str] = None
    points: Optional[float] = None


class _Package:
    """Indexes of an extracted package: resources, menu tree, Content Collection files."""

    def __init__(self, root: str):
        self.root = os.path.realpath(root)
        self.index = FileIndex(self.root)
        manifest = os.path.join(self.root, _MANIFEST)
        if not os.path.isfile(manifest):
            raise ValueError("imsmanifest.xml is missing: not a Blackboard course package")
        doc = parse_file(manifest)
        self.resources: dict[str, _Res] = {}
        self.order: list[str] = []
        for r in doc.iter("resource"):
            ident = attr(r, "identifier")
            if not ident:
                continue
            self.resources[ident] = _Res(
                ident=ident,
                type=attr(r, "type").strip().lower(),
                file=attr(r, "file") or f"{ident}.dat",
                base=attr(r, "base") or attr(r, "baseurl") or ident,
                title=html.unescape(attr(r, "title")),
                hrefs=[attr(f, "href") for f in r.iter("file") if attr(f, "href")],
            )
            self.order.append(ident)
        self.tree: list[_Node] = []
        for org in doc.iter():
            # Learn 6.5+: <organization>; Blackboard 5.5/6.0: <tableofcontents>
            if org.tag in ("organization", "tableofcontents"):
                self.tree.extend(self._node(item) for item in children(org, "item"))
        self._dat_cache: dict[str, Optional[Element]] = {}
        # The reader plugs its warning sink in: a .dat that fails to parse is reported once
        self.warn: Callable[[str], None] = lambda _message: None
        self.xid_files: dict[str, str] = {}
        self.xid_names: dict[str, str] = {}
        self.cs_paths: dict[str, str] = {}
        self._index_csfiles()
        self.info = self._package_info()

    def _package_info(self) -> dict[str, str]:
        """``.bb-package-info`` (Java properties)."""
        info: dict[str, str] = {}
        try:
            with open(os.path.join(self.root, _PACKAGE_INFO), "rb") as f:
                data = f.read(256 * 1024).decode("utf-8", errors="replace")
        except OSError:
            return info
        for line in data.splitlines():
            key, sep, value = line.partition("=")
            if sep and not key.startswith("#"):
                info[key.strip()] = value.strip().replace("\\:", ":")
        return info

    def _node(self, item: Element) -> _Node:
        return _Node(ref=attr(item, "identifierref"), title=text(item, "title") or attr(item, "title"),
                     children=[self._node(c) for c in children(item, "item")])

    def _index_csfiles(self) -> None:
        """Map xids to files.

        Content Collection files live in ``csfiles/**/name__xid-123_1.ext`` with a
        ``.xml`` LOM sidecar; a few (course banner, staff photos) are stored next to
        their resource as ``res00001/xid-123_1``.
        """
        for dirpath, dirnames, filenames in os.walk(self.root):
            rel_dir = os.path.relpath(dirpath, self.root).replace(os.sep, "/")
            in_cs = rel_dir.split("/", 1)[0].lower() == "csfiles"
            if rel_dir == ".":
                continue
            names = set(filenames) | set(dirnames)
            for name in filenames:
                full = os.path.join(dirpath, name)
                if in_cs and name.lower().endswith(".xml") and self._is_sidecar(full, name, names):
                    self._read_sidecar(full, os.path.join(dirpath, name[:-4]))
                    continue
                m = _XID_FILE.search(name) if in_cs else _BARE_XID_FILE.match(name)
                if m:
                    self.xid_files.setdefault(m.group(1), full)

    @staticmethod
    def _is_sidecar(full: str, name: str, names: set[str]) -> bool:
        if name[:-4] in names:
            return True
        if not _XID_FILE.search(name[:-4]):
            return False
        # Sidecar of a file the export left out ("links only" exports): a LOM record
        try:
            with open(full, "rb") as f:
                return b"<lom" in f.read(400)
        except OSError:
            return False

    def _read_sidecar(self, sidecar: str, target: str) -> None:
        doc = try_parse_file(sidecar)
        ident = text(doc.find(".//identifier")) if doc is not None else ""
        m = _XID_FILE.search(os.path.basename(target))
        if not ident or "#" not in ident:
            return
        xid, path = ident.split("#", 1)
        xid = (m.group(1) if m else xid).strip()
        path = path.strip()
        if os.path.isfile(target):
            name = path.rstrip("/").rsplit("/", 1)[-1]
            if name:
                self.xid_names[xid] = name
            if path:
                self.cs_paths[path.lower()] = target

    # ------------------------------------------------------------ resources

    def res(self, ident: str) -> Optional[_Res]:
        return self.resources.get(ident)

    def of_type(self, *types: str) -> list[_Res]:
        return [self.resources[i] for i in self.order if self.resources[i].type in types]

    def dat(self, ident: str) -> Optional[Element]:
        if ident in self._dat_cache:
            return self._dat_cache[ident]
        el = None
        res = self.resources.get(ident)
        path = safe_join(self.root, res.file) if res else None
        if path and os.path.isfile(path) and os.path.getsize(path) <= _MAX_DAT_BYTES:
            try:
                el = parse_file(path)
            except (OSError, XmlError) as e:
                self.warn(f"{os.path.basename(path)} could not be parsed: {error_text(e)}")
        self._dat_cache[ident] = el
        return el

    # ---------------------------------------------------------------- files

    def xid_asset(self, xid: str) -> Optional[ir.Asset]:
        path = self.xid_files.get(xid)
        if not path:
            return None
        return self._asset(path, self.xid_names.get(xid))

    def _asset(self, path: str, name: Optional[str]) -> ir.Asset:
        on_disk = os.path.basename(path)
        ext = os.path.splitext(on_disk)[1] or _sniff_ext(path)
        if not name:
            stem = (_XID_FILE.split(on_disk)[0] if _XID_FILE.search(on_disk)
                    else "" if _BARE_XID_FILE.match(on_disk) else os.path.splitext(on_disk)[0])
            name = (stem or "file") + ext
        elif ext and not os.path.splitext(name)[1]:
            name += ext
        return ir.Asset(path=path, name=name, mime=mimetypes.guess_type(name)[0])

    def local_asset(self, rel: str, bases: tuple[str, ...] = ()) -> Optional[ir.Asset]:
        """A file stored next to a resource (pre-Content-Collection exports)."""
        rel = (rel or "").strip().replace("\\", "/")
        if not rel:
            return None
        candidates = []
        for base in bases:
            candidates += [f"{base}/{rel}", f"{base}/embedded/{rel}"]
        candidates.append(rel)
        for c in candidates:
            full = self.index.get(c)
            if full:
                return self._asset(full, os.path.basename(rel))
        for base in bases:
            res = self.resources.get(base)
            for href in res.hrefs if res else []:
                if os.path.basename(href).lower() == os.path.basename(rel).lower():
                    full = self.index.get(f"{base}/{href}")
                    if full:
                        return self._asset(full, os.path.basename(rel))
        matches = [m for m in self.index.by_basename(os.path.basename(rel)) if not m.lower().endswith(".dat")]
        if len(matches) == 1:
            return self._asset(matches[0], os.path.basename(rel))
        return None

    def resolve_url(self, url: str, bases: tuple[str, ...]) -> Optional[ir.Asset]:
        u = unquote(url or "").strip()
        m = _XID.search(u)
        if m:
            return self.xid_asset(m.group(1))
        m = _CS_PATH.search(u)
        if m:
            full = self.cs_paths.get(m.group(1).rstrip("/").lower())
            return self._asset(full, m.group(1).rstrip("/").rsplit("/", 1)[-1]) if full else None
        if _LOCATION in u:
            return self.local_asset(u.split(_LOCATION, 1)[1].split("?")[0], bases)
        return None

    def resolver(self, *bases: str) -> ir.Resolver:
        bases = tuple(b for b in bases if b)
        inner = make_resolver(self.index, bases[0] if bases else "", extra=lambda url: self.resolve_url(url, bases))

        def resolve(url: str) -> Optional[ir.Asset]:
            found = inner(url)
            return None if found is not None and _is_snapshot_pointer(found.path) else found

        return resolve


# ---------------------------------------------------------------------------
# Blackboard QTI dialect
# ---------------------------------------------------------------------------


def _looks_html(value: str) -> bool:
    return bool(re.search(r"<\s*/?\s*[a-zA-Z][a-zA-Z0-9]*[\s/>]", value or ""))


def _image_name(name: str) -> bool:
    return media_kind_for(name or "") == ir.MediaKind.IMAGE


def bb_material_html(el: Optional[Element]) -> str:
    """HTML of a Blackboard material subtree (formatted text, links, embedded files)."""
    if el is None:
        return ""
    out: list[str] = []
    for node in el.iter():
        tag = node.tag
        if tag == "mat_formattedtext":
            value = node.text or ""
            if (attr(node, "type") or "").upper() == "PLAIN_TEXT" or not _looks_html(value):
                value = html.escape(value.strip()).replace("\n", "<br>")
            out.append(value)
        elif tag == "mattext":
            value = node.text or ""
            uri = attr(node, "uri")
            if uri:  # LINK_BLOCK
                label = html.escape(value.strip() or uri)
                out.append(f'<p><a href="{html.escape(uri, quote=True)}">{label}</a></p>')
            elif (attr(node, "texttype") or "").lower() == "text/html" or _looks_html(value):
                out.append(value)
            else:
                out.append(html.escape(value.strip()).replace("\n", "<br>"))
        elif tag in ("matimage", "matapplication"):
            uri = attr(node, "uri")
            label = attr(node, "label") or os.path.basename(uri)
            if not uri:
                continue
            if _image_name(uri) or _image_name(label) or tag == "matimage":
                out.append(f'<p><img src="{html.escape(uri, quote=True)}" alt="{html.escape(label)}"></p>')
            else:
                out.append(f'<p><a href="{html.escape(uri, quote=True)}">{html.escape(label)}</a></p>')
        elif tag == "matbreak":
            out.append("<br>")
    return "".join(out).strip()


def _score_positive(cond: Element) -> bool:
    for setvar in cond.iter("setvar"):
        if (attr(setvar, "variablename") or "SCORE").upper() != "SCORE":
            continue
        value = (setvar.text or "").strip()
        if value.upper().startswith("SCORE.MAX"):
            return True
        if to_float(value, 0.0) > 0:
            return True
    return False


def _is_correct_condition(cond: Element) -> bool:
    title = (attr(cond, "title") or "").strip().lower()
    if title in ("incorrect", "wrong", "partially_correct", "partially correct"):
        return False
    cv = cond.find("conditionvar")
    if cv is None or cv.find("other") is not None:
        return False
    if title == "correct" or _score_positive(cond):
        return True
    return any((attr(fb, "linkrefid") or "").lower() == "correct" for fb in cond.iter("displayfeedback"))


def _accepted(item: Element) -> tuple[dict[str, list[str]], dict[str, list[str]], bool]:
    """respident -> exact values and substrings that make a response correct, plus case sensitivity."""
    exact: dict[str, list[str]] = {}
    substr: dict[str, list[str]] = {}
    case = False

    def walk(node: Element, negated: bool):
        nonlocal case
        for child in node:
            if child.tag == "not":
                walk(child, not negated)
            elif child.tag in ("and", "or"):
                walk(child, negated)
            elif child.tag in ("varequal", "varsubstring") and not negated:
                value = (child.text or "").strip()
                if not value:
                    continue
                bucket = exact if child.tag == "varequal" else substr
                values = bucket.setdefault(attr(child, "respident"), [])
                if value not in values:
                    values.append(value)
                if (attr(child, "case") or "").lower() == "yes":
                    case = True

    for cond in item.iter("respcondition"):
        if _is_correct_condition(cond):
            walk(cond.find("conditionvar"), False)
    return exact, substr, case


def _labels(response: Element) -> list[tuple[str, str]]:
    return [(attr(lb, "ident"), bb_material_html(lb)) for lb in response.iter("response_label")]


def _plain(value: str) -> str:
    return html_to_text(value or "").strip()


def _fmt(value: float) -> str:
    return str(int(value)) if float(value).is_integer() else repr(float(value))


class _QtiParser:
    """Blackboard flavour of QTI 1.2, on top of the shared parser."""

    def __init__(self, prepare: Callable[[str], str], warn: Callable[[str], None]):
        self.prepare = prepare
        self.warn = warn

    def material(self, el: Element) -> str:
        return self.prepare(bb_material_html(el))

    def _type_hook(self, raw: qti.QtiItem) -> Optional[ir.QType]:
        label = (raw.meta.get("bbmd_questiontype") or "").strip().lower()
        return {
            "presentation only": ir.QType.DESCRIPTION,
            "opinion scale": ir.QType.DESCRIPTION,
            "likert": ir.QType.DESCRIPTION,
            "hot spot": ir.QType.UNSUPPORTED,
            "image hot spot": ir.QType.UNSUPPORTED,
        }.get(label)

    def question(self, item: Element, resolve: ir.Resolver, points: Optional[float] = None) -> ir.Question:
        meta = qti.qti_metadata(item)
        label = (meta.get("bbmd_questiontype") or "").strip().lower()
        q = qti.parse_item(item, resolve, type_hook=self._type_hook, material_hook=self.material)
        q.source_type = label or q.source_type
        q.id = meta.get("bbmd_asi_object_id") or q.id
        if points and points > 0:  # question set / random block weighting
            q.points = points
        block = next((f for f in item.iter("flow") if attr(f, "class") == "QUESTION_BLOCK"), None)
        if block is not None:
            q.text = ir.RichText(self.material(block), resolve)
        q.general_feedback = "".join(
            self.material(fb) for fb in item.iter("itemfeedback") if (attr(fb, "ident") or "").lower() == "solution"
        )
        exact, substr, case = _accepted(item)
        q.reason = "" if q.type != ir.QType.UNSUPPORTED else q.reason

        if label in ("multiple choice", "multiple answer", "true/false", "either/or") or (
                q.type in (ir.QType.MULTICHOICE, ir.QType.TRUEFALSE) and not label):
            self._choices(q, item, exact, label)
        elif label in ("opinion scale", "likert"):
            self._opinion(q, item)
        elif label == "fill in the blank" or (label == "quiz bowl"):
            values = [v for vs in exact.values() for v in vs]
            if label == "quiz bowl":
                # First group: accepted phrases; second group: the question words (who, what...)
                values = [f"*{p}*" for p in self._quiz_bowl_phrases(item)]
                if values:
                    q.text = ir.RichText(q.text.html + "<p><em>Answer in the form of a question.</em></p>", resolve)
            else:
                values += [f"*{v}*" for vs in substr.values() for v in vs if f"*{v}*" not in values]
            q.type = ir.QType.SHORTANSWER
            q.answers = list(dict.fromkeys(values))
            q.case_sensitive = case
            if not q.answers:
                q.type, q.reason = ir.QType.UNSUPPORTED, "no accepted answer"
        elif label in ("fill in the blank plus", "jumbled sentence"):
            self._cloze(q, item, exact, substr, case, resolve)
        elif label == "matching":
            self._matching(q, item, exact, resolve)
        elif label == "numeric":
            self._numeric(q, item)
        elif label == "calculated":
            self._calculated(q, item, resolve)
        elif label in ("hot spot", "image hot spot"):
            q.type = ir.QType.UNSUPPORTED
            q.reason = "hot spot questions have no LearnHouse equivalent"
        elif label == "presentation only":
            q.points = 0.0
        return q

    # ------------------------------------------------------------- choices

    def _choices(self, q: ir.Question, item: Element, exact: dict[str, list[str]], label: str) -> None:
        response = next(item.iter("response_lid"), None)
        if response is None:
            q.type, q.reason = ir.QType.UNSUPPORTED, "choice question without choices"
            return
        labels = _labels(response)
        good = set(exact.get(attr(response, "ident"), [])) | set(exact.get("", []))
        idents = [lid for lid, _ in labels]
        if not good and len(list(item.iter("response_lid"))) == 1:
            # Cognero-made pools name the choice block "RESPONSE_..." but score it
            # as respident="response": take scored values that are this question's choices
            known = {i.lower() for i in idents}
            good = {v for values in exact.values() for v in values if v.lower() in known}
        # Blackboard compares choice ids case-insensitively (case="No"): "True" selects ident "true"
        good_ci = {g.lower() for g in good}
        if good and not good_ci & {i.lower() for i in idents}:
            # Ultra relabels the choices ("new_<uuid>") but keeps the original ids
            # in one scoring condition per choice, in choice order
            per_choice = []
            for cond in item.iter("respcondition"):
                ve = cond.find("conditionvar/varequal")
                if ve is not None and not (ve.text or "").strip() and attr(ve, "respident"):
                    per_choice.append(attr(ve, "respident"))
            if len(per_choice) == len(idents):
                idents = per_choice
        choices = []
        for (lid, label_html), ident in zip(labels, idents):
            plain = _plain(label_html)
            if not plain and "<img" not in label_html:
                continue  # Blackboard keeps empty answer slots
            if label == "either/or":
                prefix, _, side = plain.partition(".")
                pair = _EITHER_OR.get(prefix.strip().lower())
                if pair and side.strip().lower() in ("true", "false"):
                    label_html = pair[0] if side.strip().lower() == "true" else pair[1]
            elif label == "true/false" and plain.lower() in ("true", "false"):
                label_html = plain.capitalize()
            choices.append(ir.Choice(text=ir.RichText(label_html, q.text.resolve),
                                     correct=ident in good or ident.lower() in good_ci))
        q.choices = choices
        q.multiple = label == "multiple answer" or (attr(response, "rcardinality") or "").lower() == "multiple"
        q.type = ir.QType.TRUEFALSE if label == "true/false" and len(choices) == 2 else ir.QType.MULTICHOICE
        q.reason = ""
        if not choices:
            q.type, q.reason = ir.QType.UNSUPPORTED, "choice question without choices"

    def _opinion(self, q: ir.Question, item: Element) -> None:
        response = next(item.iter("response_lid"), None)
        options = [_plain(t) for _, t in _labels(response)] if response is not None else []
        items = "".join(f"<li>{html.escape(o)}</li>" for o in options if o)
        q.type = ir.QType.DESCRIPTION
        q.choices = []
        q.points = 0.0
        if items:
            q.text = ir.RichText(f"{q.text.html}<ul>{items}</ul>", q.text.resolve)

    @staticmethod
    def _quiz_bowl_phrases(item: Element) -> list[str]:
        for cond in item.iter("respcondition"):
            if (attr(cond, "title") or "").lower() != "correct":
                continue
            groups = list(cond.iter("or"))
            if groups:
                return [(v.text or "").strip() for v in groups[0] if (v.text or "").strip()]
        return []

    # ---------------------------------------------------------------- cloze

    def _cloze(self, q: ir.Question, item: Element, exact, substr, case: bool, resolve) -> None:
        pres = item.find("presentation")
        responses = [r for r in (pres.iter() if pres is not None else []) if r.tag in ("response_str", "response_lid")]
        text_html = q.text.html
        blanks = []
        for i, resp in enumerate(responses, start=1):
            ident = attr(resp, "ident")
            values = exact.get(ident, []) + substr.get(ident, [])
            if resp.tag == "response_lid":
                labels = {lid: _plain(t) for lid, t in _labels(resp)}
                blanks.append(ir.Blank(answers=[labels.get(v, v) for v in values], choices=list(labels.values())))
            else:
                blanks.append(ir.Blank(answers=values))
            marker = next((m for m in (f"[{ident}]", f"[{html.escape(ident)}]") if m in text_html), None)
            if marker:
                text_html = text_html.replace(marker, f"{{{{{i}}}}}", 1)
            else:
                text_html += f" {{{{{i}}}}}"
        q.text = ir.RichText(text_html, resolve)
        q.blanks = blanks
        q.case_sensitive = case  # <varequal case="Yes"> on the gap answers
        q.type = ir.QType.CLOZE if blanks else ir.QType.UNSUPPORTED
        q.reason = "" if blanks else "fill-in question without blanks"

    # ------------------------------------------------------------- matching

    def _matching(self, q: ir.Question, item: Element, exact, resolve) -> None:
        pres = item.find("presentation")
        if pres is None:
            q.type, q.reason = ir.QType.UNSUPPORTED, "matching pairs could not be read"
            return
        parents = {c: p for p in pres.iter() for c in p}
        right_block = next((f for f in pres.iter("flow") if attr(f, "class") == "RIGHT_MATCH_BLOCK"), None)
        rights = [_plain(self.material(f)) for f in children(right_block, "flow")] if right_block is not None else []
        pairs: list[ir.MatchPair] = []
        used: set[int] = set()
        for resp in pres.iter("response_lid"):
            parent = parents.get(resp)
            prompt = "".join(self.material(m) for m in (parent.iter("material") if parent is not None else [])
                             if not _inside(m, resp, parents))
            labels = list(resp.iter("response_label"))
            good = exact.get(attr(resp, "ident"), [])
            answer = ""
            for index, lb in enumerate(labels):
                if good and attr(lb, "ident") == good[0]:
                    if index < len(rights):
                        answer = rights[index]
                        used.add(index)
                    else:
                        answer = _plain(bb_material_html(lb))
            if answer:
                pairs.append(ir.MatchPair(prompt=ir.RichText(prompt, resolve), answer=answer))
        q.pairs = pairs
        q.distractors = [r for i, r in enumerate(rights) if i not in used and r]
        q.type = ir.QType.MATCHING if pairs else ir.QType.UNSUPPORTED
        q.reason = "" if pairs else "matching pairs could not be read"

    # -------------------------------------------------------------- numbers

    def _numeric(self, q: ir.Question, item: Element) -> None:
        answers = []
        for cond in item.iter("respcondition"):
            if not _is_correct_condition(cond):
                continue
            cv = cond.find("conditionvar")
            lo, hi, eq = cv.find(".//vargte"), cv.find(".//varlte"), cv.find(".//varequal")
            value = qti.finite_float(eq.text) if eq is not None else None
            if lo is not None and hi is not None:
                low, high = qti.finite_float(lo.text), qti.finite_float(hi.text)
                if low is None or high is None:  # "1e999" bounds: no usable answer
                    continue
                if value is None:
                    value = (low + high) / 2
                answers.append(ir.NumericAnswer(value=value, tolerance=max(abs(value - low), abs(high - value))))
            elif value is not None:
                answers.append(ir.NumericAnswer(value=value))
        q.numeric = answers
        q.type = ir.QType.NUMERICAL if answers else ir.QType.UNSUPPORTED
        q.reason = "" if answers else "no numeric answer"

    def _calculated(self, q: ir.Question, item: Element, resolve) -> None:
        calc = item.find("itemproc_extension/calculated")
        var_set = calc.find("var_sets/var_set") if calc is not None else None
        value = qti.finite_float(text(var_set, "answer")) if var_set is not None else None
        if value is None:
            q.type, q.reason = ir.QType.UNSUPPORTED, "calculated question without answer sets"
            return
        text_html = q.text.html
        for var in children(var_set, "var"):
            raw = (var.text or "").strip()
            shown = _fmt(to_float(raw)) if raw else raw
            text_html = text_html.replace(f"[{attr(var, 'name')}]", shown)
        tol_el = calc.find("answer_tolerance")
        tolerance = to_float(tol_el.text if tol_el is not None else 0, 0.0)
        if tol_el is not None and (attr(tol_el, "type") or "").lower().startswith("percent"):
            tolerance = abs(value) * tolerance / 100
        if not math.isfinite(tolerance):
            tolerance = 0.0
        q.text = ir.RichText(text_html, resolve)
        q.numeric = [ir.NumericAnswer(value=value, tolerance=tolerance)]
        q.unit = text(calc, "unit_value")
        q.type, q.reason = ir.QType.NUMERICAL, ""


def _meta(el: Optional[Element]) -> dict[str, str]:
    """Leaves of the ``*metadata`` children of an item, section or assessment."""
    out: dict[str, str] = {}
    for child in el if el is not None else []:
        if not child.tag.endswith("metadata"):
            continue
        for leaf in child.iter():
            if leaf is not child and not len(leaf) and (leaf.text or "").strip():
                out.setdefault(leaf.tag.lower(), leaf.text.strip())
    return out


def _inside(node: Element, container: Element, parents: dict) -> bool:
    current = node
    while current is not None:
        if current is container:
            return True
        current = parents.get(current)
    return False


# ---------------------------------------------------------------------------
# Reader
# ---------------------------------------------------------------------------


def _value(el: Optional[Element], path: str, default: str = "") -> str:
    node = el.find(path) if el is not None else None
    if node is None:
        return default
    v = node.get("value")
    if v is None:
        v = node.text or ""
    return v.strip()


def _flag(el: Optional[Element], name: str, default: bool = True) -> bool:
    return to_bool(_value(el, f"FLAGS/{name}") or None, default)


_OBJECT_VIDEO = {"avi", "wmv", "mpg", "mpeg", "mov", "mp4", "m4v", "asf", "flv", "webm", "3gp", "mkv"}
_OBJECT_AUDIO = {"wma", "mp3", "wav", "m4a", "aac", "ogg", "mid", "midi"}


def _object_params(value: str) -> str:
    """Point ``<object>`` players at their media: Windows Media / QuickTime embeds keep it in a <param>."""
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(value, "html.parser")
    for obj in soup.find_all("object"):
        src = obj.get("data") or next(
            (p["value"] for p in obj.find_all("param")
             if (p.get("name") or "").lower() in ("url", "src", "filename", "movie", "file") and p.get("value")), "")
        ext = os.path.splitext(src.split("?")[0])[1].lower().lstrip(".")
        if ext in _OBJECT_VIDEO or ext in _OBJECT_AUDIO:
            # A <video>/<audio> tag lets the writer transcode avi/wmv/mpg... instead of dropping the player
            obj.replace_with(soup.new_tag("video" if ext in _OBJECT_VIDEO else "audio", src=src))
        elif src:
            obj["data"] = src
    return str(soup)


def _label(value: str) -> str:
    """Readable course menu label from Blackboard's built-in i18n keys.

    "COURSE_DEFAULT.CourseDocuments.CONTENT_LINK.label" -> "Course Documents",
    "content.Assignments.label" -> "Assignments".
    """
    v = (value or "").strip()
    if not re.fullmatch(r"[\w-]+(?:\.[\w-]+)+\.label", v):
        return v
    parts = [p for p in v.split(".")[:-1] if not p.isupper() and not p.islower()]
    if not parts:
        return v
    return re.sub(r"(?<=[a-z])(?=[A-Z])", " ", parts[0].replace("_", " "))


def _display_name(linkname: str, ext: str) -> str:
    """Link name shown for an attachment, keeping the stored file's extension ("Graham is 2." + jpg)."""
    name = linkname.strip()
    if not ext or os.path.splitext(name)[1].lower().lstrip(".") == ext:
        return name
    return f"{name.rstrip('.')}.{ext}"


def _normalize_url(url: str) -> str:
    url = (url or "").strip()
    if url and not re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*:", url) and re.match(r"^(www\.)?[\w-]+(\.[\w-]+)+", url):
        return "https://" + url
    return url


class _Reader:
    def __init__(self, root: str):
        self.pkg = _Package(root)
        self.warnings: list[str] = []
        self.skipped: list[tuple[str, str, str]] = []  # (title, kind, reason), copied onto the course
        self._seen: set[str] = set()
        self.pkg.warn = self.warn
        self.qti = _QtiParser(self.prepare_html, self.warn)
        self._contents: dict[str, Optional[_Content]] = {}
        self._content_ids: Optional[dict[str, str]] = None
        self._used: set[str] = set()
        self.links = self._links()
        self.outcomes = self._gradebook()
        self.course_assessments = self._course_assessments()
        self._pool_items: Optional[dict[str, tuple[Element, str]]] = None
        self._drawn: set[str] = set()  # pool question ids drawn by a test
        self._area_title = ""

    def warn(self, message: str) -> None:
        """A genuine problem with the package (unreadable file, missing pool...)."""
        if message not in self._seen:
            self._seen.add(message)
            self.warnings.append(message)

    def skip(self, title: str, kind: str, reason: str) -> None:
        """A source item that is not migrated; listed in the report, not a warning."""
        entry = (title, kind, reason)
        if entry not in self.skipped:
            self.skipped.append(entry)

    # ------------------------------------------------------------- indexes

    def _links(self) -> dict[str, tuple[str, str]]:
        links = {}
        for res in self.pkg.of_type("resource/x-bb-link"):
            el = self.pkg.dat(res.ident)
            if el is None:
                continue
            src = attr(el.find("REFERRER"), "id")
            dst = el.find("REFERREDTO")
            if src and dst is not None:
                links.setdefault(src, (attr(dst, "id"), attr(dst, "type").upper()))
        return links

    def _gradebook(self) -> dict[str, _Outcome]:
        out: dict[str, _Outcome] = {}
        for res in self.pkg.of_type("course/x-bb-gradebook"):
            el = self.pkg.dat(res.ident)
            for od in el.iter("OUTCOMEDEFINITION") if el is not None else []:
                points = to_float(_value(od, "POINTSPOSSIBLE"), 0.0)
                outcome = _Outcome(due=bb_date(_value(od, "DATES/DUE")), points=points if points > 0 else None)
                for key in (_value(od, "CONTENTID"), _value(od, "ASIDATAID")):
                    if key:
                        out.setdefault(key, outcome)
        return out

    def _course_assessments(self) -> dict[str, Element]:
        """QTI resource id -> COURSEASSESSMENT settings (also keyed by the course assessment's own id)."""
        out: dict[str, Element] = {}
        for res in self.pkg.of_type("course/x-bb-courseassessment"):
            el = self.pkg.dat(res.ident)
            if el is None:
                continue
            out[res.ident] = el
            asmt = _value(el, "ASMTID")
            if asmt:
                out.setdefault(asmt, el)
        return out

    def content(self, ident: str) -> Optional[_Content]:
        if ident in self._contents:
            return self._contents[ident]
        res = self.pkg.res(ident)
        el = self.pkg.dat(ident) if res else None
        c = None
        if el is not None and el.tag in ("CONTENT", "EXTERNALLINK"):
            legacy = el.find("CONTENTHANDLER") is None
            body = next((b for b in (el.find("BODY/TEXT"), el.find("MAINDATA/TEXT"), el.find("DESCRIPTION/TEXT"))
                         if b is not None), None)
            body_html = re.sub(r"<!--\s*@X@.*?@X@\s*-->", "", (body.text or "") if body is not None else "")
            if legacy and not to_bool(_value(el, "MAINDATA/FLAGS/ISHTML") or _value(el, "DESCRIPTION/FLAGS/ISHTML")
                                      or None, True):
                body_html = html.escape(body_html).replace("\n", "<br>")
            url = _value(el, "URL")
            c = _Content(
                res=res, el=el, id=attr(el, "id"), title=html.unescape(_value(el, "TITLE")) or res.title,
                handler=_value(el, "CONTENTHANDLER").lower() or self._legacy_handler(el),
                body=body_html, description="" if legacy else _value(el, "DESCRIPTION"),
                available=_flag(el, "ISAVAILABLE"), url="" if url.rstrip("/").lower() in ("http:", "https:") else url,
                folder_type=_value(el, "FOLDERTYPE"),
            )
        self._contents[ident] = c
        return c

    @staticmethod
    def _legacy_handler(el: Element) -> str:
        """CONTENTHANDLER equivalent for Blackboard 5.5/6.0 records, which have none."""
        folder = _flag(el, "ISFOLDER", False)
        if el.tag == "EXTERNALLINK":
            return "resource/x-bb-folder" if folder else "resource/x-bb-externallink"
        if folder:
            return "resource/x-bb-lesson" if _value(el, "FLAGS/LESSONTYPE").upper() == "Y" else "resource/x-bb-folder"
        start = el.find(".//STARTASSESSMENT")
        if start is not None:
            kind = next((attr(a, "value") for a in start.iter("ATTRIB") if attr(a, "key") == "assessment_type"), "")
            return "resource/x-bb-asmt-survey-link" if kind == "survey" else "legacy/quiz"
        return "resource/x-bb-document"

    def _res_for(self, key: str) -> Optional[str]:
        """Resource id for a resource id or a Blackboard content id (``_123_1``)."""
        if key in self.pkg.resources:
            return key
        if self._content_ids is None:
            self._content_ids = {}
            for res in self.pkg.of_type("resource/x-bb-document"):
                c = self.content(res.ident)
                if c is not None and c.id:
                    self._content_ids[c.id] = res.ident
        return self._content_ids.get(key)

    def outcome(self, *keys: str) -> _Outcome:
        for key in keys:
            if key and key in self.outcomes:
                return self.outcomes[key]
        return _Outcome()

    # ---------------------------------------------------------------- html

    def prepare_html(self, value: str) -> str:
        """Rewrite Blackboard link stubs and Ultra file anchors into plain HTML."""
        if not value:
            return ""
        value = _ABS_WEBDAV.sub(r"\1bbcswebdav/", value)
        value = _TEMPLATE_HREF.sub('href="#"', value)
        if "data-bbfile" in value:
            value = self._ultra_files(value)
        if re.search(r"<object\b", value, re.I):
            value = _object_params(value)
        return value

    def _ultra_files(self, value: str) -> str:
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(value, "html.parser")
        for a in soup.find_all(attrs={"data-bbfile": True}):
            try:
                info = json.loads(a.get("data-bbfile") or "{}")
            except ValueError:
                info = {}
            if not isinstance(info, dict):
                info = {}
            # The JSON values are strings in Blackboard's output; anything else is ignored
            info = {k: v for k, v in info.items() if isinstance(v, str)}
            href = a.get("href") or info.get("resourceUrl") or ""
            name = info.get("linkName") or info.get("alternativeText") or a.get_text(" ", strip=True)
            mime = (info.get("mimeType") or mimetypes.guess_type(name or "")[0] or "").lower()
            kind = (a.get("data-bbtype") or "").lower()
            if kind == "embedded-unsafe-html":
                fragment = self._embedded_html(href)
                if fragment is not None:
                    a.replace_with(BeautifulSoup(fragment, "html.parser"))
                else:
                    a.decompose()
                continue
            if mime.startswith("image/"):
                img = soup.new_tag("img", src=href, alt=info.get("alternativeText") or name or "")
                a.replace_with(img)
            elif mime.startswith(("video/", "audio/")):
                tag = soup.new_tag("video" if mime.startswith("video/") else "audio", src=href)
                if name:
                    tag["title"] = name
                a.replace_with(tag)
            elif not a.get_text(strip=True) and name:
                a.string = name
        return str(soup)

    def _embedded_html(self, href: str) -> Optional[str]:
        m = _XID.search(href or "")
        path = self.pkg.xid_files.get(m.group(1)) if m else None
        if not path or os.path.getsize(path) > _MAX_INLINE_HTML:
            return None
        from bs4 import BeautifulSoup

        with open(path, "rb") as f:
            data = f.read().decode("utf-8", errors="replace")
        soup = BeautifulSoup(data, "html.parser")
        for tag in soup.find_all("script"):
            tag.decompose()
        return str(soup)

    def rich(self, value: str, *bases: str) -> ir.RichText:
        return ir.RichText(self.prepare_html(value), self.pkg.resolver(*bases))

    def body(self, c: _Content) -> Optional[ir.RichText]:
        parts = []
        if c.description and _plain(c.description) and c.description.strip() != c.body.strip():
            parts.append(c.description if _looks_html(c.description) else f"<p>{html.escape(c.description)}</p>")
        if _plain(c.body) or re.search(r"<(img|video|audio|iframe|object|embed|a)\b", c.body or "", re.I):
            parts.append(c.body)
        if not parts:
            return None
        return self.rich("".join(parts), c.res.base)

    # ---------------------------------------------------------------- read

    def read(self) -> ir.Course:
        course = ir.Course(title="", source=KEY)
        settings = next((self.pkg.dat(r.ident) for r in self.pkg.of_type("course/x-bb-coursesetting")), None)
        if settings is not None:
            course.id = attr(settings, "id")
            course.title = html.unescape(_value(settings, "TITLE"))
            course.short_name = _value(settings, "COURSEID")
            course.language = _value(settings, "LOCALE")
            desc = settings.find("DESCRIPTION")
            desc_html = (desc.text or "") if desc is not None else ""
            if _plain(desc_html):
                course.summary = self.rich(desc_html)
            course.thumbnail = self._thumbnail(settings)
        course.title = course.title or next((r.title for r in self.pkg.of_type("course/x-bb-coursesetting")), "")
        course_id = self.pkg.info.get("cx.config.course.id", "")
        course.short_name = course.short_name or course_id
        course.sections = self._sections()
        if not any(s.items for s in course.sections):
            pools = self._pool_sections()
            if pools:
                course.sections = pools
        else:
            # Pools and tests no content item uses (publisher test banks) are
            # kept too, unpublished, rather than silently left out
            course.sections += self._pool_sections(unused_only=True)
        course.title = (course.title or self._area_title or course_id.replace("_", " ").strip()
                        or next((i.title for s in course.sections for i in s.items), ""))
        self._report_unused()
        course.warnings = self.warnings
        course.skipped = self.skipped
        return course

    def _pool_sections(self, unused_only: bool = False) -> list[ir.Section]:
        """Pool exports and publisher test banks: every pool becomes an unpublished assessment.

        With ``unused_only``, only the pools and tests nothing in the course uses."""
        items: list = []
        imported = {self.pkg.res(i).title for i in self._used if self.pkg.res(i)}
        for res in self.pkg.of_type("assessment/x-bb-qti-pool", "assessment/x-bb-qti-test"):
            doc = self.pkg.dat(res.ident)
            assessment = next(doc.iter("assessment"), None) if doc is not None else None
            if assessment is None:
                continue
            if unused_only and (res.ident in self._used or res.title in imported or any(
                    qti.qti_metadata(it).get("bbmd_asi_object_id") in self._drawn for it in doc.iter("item"))):
                continue
            title = html.unescape(attr(assessment, "title")) or res.title or res.ident
            resolve = self.pkg.resolver(res.base)
            questions = self._questions(assessment, resolve, title)
            if not questions:
                continue
            self._used.add(res.ident)
            intro = self.qti.material(assessment.find("presentation_material")) \
                if assessment.find("presentation_material") is not None else ""
            items.append(ir.Assessment(title=title, questions=questions, intro=ir.RichText(intro, resolve),
                                       id=res.ident, visible=False))
        if not items:
            return []
        return [ir.Section(title="Question pools", items=items, id="pools", visible=not unused_only)]

    def _thumbnail(self, settings: Element) -> Optional[ir.Asset]:
        candidates = [attr(e, "value") for e in settings.iter("REGISTRYENTRY")
                      if attr(e, "key") == "banner_thumbnail_url"]
        candidates.append(_value(settings, "BANNER"))
        bases = tuple(r.base for r in self.pkg.of_type("course/x-bb-coursesetting"))
        for value in candidates:
            m = _XID.search(value or "")
            asset = self.pkg.xid_asset(m.group(1)) if m else self.pkg.local_asset(value, bases) if value else None
            if asset is not None and _image_name(asset.name):
                return asset
        return None

    # ------------------------------------------------------------ sections

    def _sections(self) -> list[ir.Section]:
        areas: list[tuple[str, list[_Node], bool, str]] = []
        menu_links: list[tuple[str, str]] = []
        tree = self.pkg.tree or self._tree_from_parents()
        staff_label = ""
        for top in tree:
            res = self.pkg.res(top.ref)
            if res is None:
                # Staff information entries hang off a reference-less "placeholder/staff-info" item
                if top.children:
                    areas.append((top.title, top.children, True, top.ref or top.title))
                continue
            if res.type != "course/x-bb-coursetoc":
                label = top.title or res.title
                areas.append(("Course content" if label.strip() == "--TOP--" else label, self._unwrap([top]),
                              True, top.ref))
                continue
            toc = self.pkg.dat(top.ref)
            label = html.unescape(_value(toc, "LABEL")) or top.title or res.title
            target = _value(toc, "TARGETTYPE").upper()
            enabled = _flag(toc, "ISENABLED")
            if target == "URL" or (target != "CONTENT" and _value(toc, "URL") and not top.children):
                menu_links.append((label, _normalize_url(_value(toc, "URL"))))
            elif target == "CONTENT" or top.children:
                areas.append((label, self._unwrap(top.children), enabled, top.ref))
            elif _value(toc, "INTERNALHANDLE") == "staff_information":
                staff_label = label
            # Other menu entries (tools, dividers, subheaders) are navigation, not content

        areas = [((staff_label or "Staff information") if a[0].startswith("placeholder/staff") else a[0], *a[1:])
                 for a in areas]
        areas = [(_label(a[0]), *a[1:]) for a in areas]
        filled = [a for a in areas if a[1]]
        single = len([a for a in filled if a[0].strip().lower() not in _ULTRA_INTERNAL_AREAS]) <= 1
        named = [a[0] for a in filled if a[0].strip().upper() != "ROOT"
                 and a[0].strip().lower() not in _ULTRA_INTERNAL_AREAS]
        self._area_title = named[0] if len(named) == 1 else ""
        sections: list[ir.Section] = []
        for label, nodes, enabled, ident in filled:
            internal = label.strip().lower() in _ULTRA_INTERNAL_AREAS
            if label.strip().upper() == "ROOT":
                label = "Course content"
            elif internal:
                label, enabled = "Other content", False
            sections.extend(self._area(label, nodes, enabled, ident, single))
        if menu_links:
            pages = [ir.Page(title=t, parts=[ir.LinkPart(url=u, title=t)], id=f"menu:{t}") for t, u in menu_links if u]
            if pages:
                sections.append(ir.Section(title="Links", items=pages, id="menu-links"))

        out = []
        for section in sections:
            if section.items and all(isinstance(i, ir.UnsupportedItem) for i in section.items):
                # Tool-only areas are dropped whole; the writer never sees their items
                for i in section.items:
                    self.skip(i.title, i.kind, i.reason)
                if section.summary.is_empty():
                    continue
                section.items = []
            out.append(section)
        return out

    def _unwrap(self, nodes: list[_Node]) -> list[_Node]:
        out = []
        for node in nodes:
            c = self.content(node.ref)
            if c is not None and c.title.strip() == "--TOP--":
                out.extend(node.children)
            else:
                out.append(node)
        return out

    def _tree_from_parents(self) -> list[_Node]:
        """Menu tree rebuilt from CONTENT/PARENTID when the manifest has no organization."""
        nodes: dict[str, _Node] = {}
        parents: dict[str, str] = {}
        for res in self.pkg.of_type("resource/x-bb-document"):
            c = self.content(res.ident)
            if c is None:
                continue
            nodes[c.id or res.ident] = _Node(ref=res.ident, title=c.title)
            parents[c.id or res.ident] = _value(c.el, "PARENTID")
        roots = []
        for key, node in nodes.items():
            parent = nodes.get(parents.get(key, ""))
            (parent.children if parent is not None else roots).append(node)
        return roots

    def _area(self, label: str, nodes: list[_Node], enabled: bool, ident: str, single: bool) -> list[ir.Section]:
        loose: list = []
        folders: list[ir.Section] = []
        for node in nodes:
            c = self.content(node.ref)
            if c is not None and c.is_folder:
                self._used.add(node.ref)
                visible = enabled and c.available
                title = c.title if single else f"{label} › {c.title}"
                summary = self.body(c) or ir.RichText()
                folders.append(ir.Section(title=title, items=self._flatten(node, visible), summary=summary,
                                          id=node.ref, visible=visible))
            else:
                loose.extend(self._items(node, enabled))
        sections = []
        if loose:
            sections.append(ir.Section(title=label, items=loose, id=ident, visible=enabled))
        return sections + folders

    def _flatten(self, folder: _Node, visible: bool) -> list:
        items: list = []
        for node in folder.children:
            c = self.content(node.ref)
            if c is not None and c.is_folder:
                self._used.add(node.ref)
                v = visible and c.available
                body = self.body(c)
                if body is not None:
                    items.append(ir.Page(title=c.title, parts=[ir.HtmlPart(body)], id=node.ref, visible=v))
                items.extend(self._flatten(node, v))
            else:
                items.extend(self._items(node, visible))
        return items

    # --------------------------------------------------------------- items

    def _items(self, node: _Node, visible: bool) -> list:
        self._used.add(node.ref)
        res = self.pkg.res(node.ref)
        if res is None:
            self.skip(node.title or node.ref, "content", _UNREADABLE_REASON)
            return []
        if res.type == "resource/x-bb-staffinfo":
            page = self._staff(res, visible)
            # Staff folders ("Teaching assistants") hold more staff entries
            return ([page] if page else []) + [i for child in node.children for i in self._items(child, visible)]
        if res.type in _STANDALONE:
            return [ir.UnsupportedItem(title=node.title or res.title, kind=_STANDALONE[res.type], id=res.ident,
                                       reason="not imported")]
        c = self.content(node.ref)
        if c is None:
            # The .dat is missing or did not parse (reported by the package): the
            # item and the folder subtree under it would otherwise vanish silently
            self.skip(node.title or res.title or node.ref, "content", _UNREADABLE_REASON)
            return []
        v = visible and c.available
        h = c.handler
        if h in _FOLDER_HANDLERS and not c.is_folder:
            return self._ultra_document(node, c, v)
        if h in _PAGE_HANDLERS:
            return self._document(c, v)
        if h in _FILE_HANDLERS:
            return self._document(c, v, file_item=True)
        if h == "resource/x-bb-externallink":
            return [self._link(c, v)]
        if h == "resource/x-bb-asmt-test-link":
            return [self._test(c, v)]
        if h in ("resource/x-bb-assignment", "resource/x-bbpi-selfpeer-type1"):
            return [self._assignment(c, v)]
        if h == "legacy/quiz":
            return [ir.UnsupportedItem(title=c.title, kind="quiz", id=c.res.ident, reason=_LEGACY_REASON)]
        if h == "resource/x-bb-courselink":
            return [self._course_link(c, v)]
        if h in _TOOL_HANDLERS or h.startswith("resource/x-bb-bltiplacement"):
            kind = _TOOL_HANDLERS.get(h, "LTI tool")
            reason = _SCORM_REASON if kind == "scorm" else "not imported"
            return [ir.UnsupportedItem(title=c.title, kind=kind, id=c.res.ident, reason=reason)]
        if self.body(c) is not None or self._attachments(c):
            # Unknown content type with a body or files: imported as a plain page
            return self._document(c, v)
        return [ir.UnsupportedItem(title=c.title, kind=h.rsplit("/", 1)[-1], id=c.res.ident,
                                   reason="content type not supported")]

    def _attachments(self, c: _Content, body: Optional[ir.RichText] = None) -> list[ir.Asset]:
        embedded = set(_XID.findall(body.html)) if body is not None else set()
        assets = []
        for f in [e for e in c.el.iter() if e.tag in ("FILE", "FILEREF")]:
            name = text(f, "NAME") or _value(f, "NAME") or _value(f, "RELFILE")
            linkname = html.unescape(_value(f, "LINKNAME")) or os.path.basename(name.strip("/"))
            m = _XID.search(name)
            if m and m.group(1) in embedded:
                continue
            asset = self.pkg.xid_asset(m.group(1)) if m else self.pkg.local_asset(name, (c.res.base,))
            if asset is None:
                if m and name.endswith("/"):
                    self.skip(linkname, "link", "points to a Content Collection folder")
                else:
                    self.skip(linkname, "file", "missing from the export")
                continue
            if linkname:
                display = _display_name(linkname, asset.extension)
                asset = ir.Asset(path=asset.path, name=display, mime=mimetypes.guess_type(display)[0])
            assets.append(asset)
        return assets

    @staticmethod
    def _file_part(asset: ir.Asset):
        kind = media_kind_for(asset)
        if kind is not None:
            return ir.MediaPart(kind=kind, asset=asset, title="" if kind == ir.MediaKind.IMAGE else asset.name)
        return ir.FilePart(asset=asset, title=asset.name)

    def _document(self, c: _Content, visible: bool, file_item: bool = False) -> list:
        body = self.body(c)
        assets = self._attachments(c, body)
        if len(assets) == 1 and (body is None or file_item):
            kind = media_kind_for(assets[0])
            if kind == ir.MediaKind.PDF and body is None:
                return [ir.DocumentItem(title=c.title, asset=assets[0], id=c.res.ident, visible=visible)]
            if kind == ir.MediaKind.VIDEO:
                return [ir.VideoItem(title=c.title, asset=assets[0], description=body, id=c.res.ident,
                                     visible=visible)]
        parts: list = [ir.HtmlPart(body)] if body is not None else []
        parts += [self._file_part(a) for a in assets]
        if c.url and c.handler not in _FILE_HANDLERS:
            parts.append(ir.LinkPart(url=_normalize_url(c.url), title=c.title))
        return [ir.Page(title=c.title, parts=parts, id=c.res.ident, visible=visible)]

    def _ultra_document(self, node: _Node, c: _Content, visible: bool) -> list:
        """Ultra document: a BB_PAGE folder whose ``ultraDocumentBody`` children hold the content."""
        parts: list = []
        body = self.body(c)
        if body is not None:
            parts.append(ir.HtmlPart(body))
        extra: list = []
        for child in node.children:
            cc = self.content(child.ref)
            self._used.add(child.ref)
            if cc is not None and (cc.title == "ultraDocumentBody" or cc.handler in _PAGE_HANDLERS | _FILE_HANDLERS):
                child_body = self.body(cc)
                if child_body is not None:
                    parts.append(ir.HtmlPart(child_body))
                parts += [self._file_part(a) for a in self._attachments(cc, child_body)]
            else:
                extra.extend(self._items(child, visible))
        return [ir.Page(title=c.title, parts=parts, id=c.res.ident, visible=visible)] + extra

    def _link(self, c: _Content, visible: bool):
        url = _normalize_url(c.url)
        body = self.body(c)
        if youtube_id(url) or vimeo_id(url):
            return ir.VideoItem(title=c.title, url=url, description=body, id=c.res.ident, visible=visible)
        parts: list = [ir.HtmlPart(body)] if body is not None else []
        if url:
            parts.append(ir.LinkPart(url=url, title=c.title))
        else:
            self.skip(c.title, "link", "no address")
        return ir.Page(title=c.title, parts=parts, id=c.res.ident, visible=visible)

    def _course_link(self, c: _Content, visible: bool):
        target_id, target_type = self.links.get(c.res.ident, ("", ""))
        target = self.content(self._res_for(target_id) or "") if target_type == "CONTENT" else None
        body = self.body(c)
        parts: list = [ir.HtmlPart(body)] if body is not None else []
        name = target.title if target is not None else ""
        if name:
            parts.append(ir.HtmlPart(ir.RichText(f"<p>See “{html.escape(name)}” in this course.</p>")))
        else:
            self.skip(c.title, "link", "target missing from the export")
        return ir.Page(title=c.title, parts=parts, id=c.res.ident, visible=visible)

    def _assignment(self, c: _Content, visible: bool) -> ir.AssignmentItem:
        body = self.body(c)
        outcome = self.outcome(c.res.ident, c.id)
        return ir.AssignmentItem(
            title=c.title, instructions=body or ir.RichText(), due_date=outcome.due,
            points=outcome.points, allow_file=True, allow_text=True, attachments=self._attachments(c, body),
            id=c.res.ident, visible=visible,
        )

    def _staff(self, res: _Res, visible: bool) -> Optional[ir.Page]:
        el = self.pkg.dat(res.ident)
        if el is None or el.tag != "STAFFINFO":
            return None
        name = " ".join(v for v in (_value(el, "CONTACT/NAME/FORMALTITLE"), _value(el, "CONTACT/NAME/GIVEN"),
                                     _value(el, "CONTACT/NAME/FAMILY")) if v)
        rows = []
        for label, path in (("Email", "CONTACT/EMAIL"), ("Phone", "CONTACT/PHONE"),
                            ("Office", "CONTACT/OFFICE/ADDRESS"), ("Office hours", "CONTACT/OFFICE/HOURS"),
                            ("Web page", "HOMEPAGE")):
            value = _value(el, path)
            if value:
                rows.append(f"<li><strong>{label}:</strong> {html.escape(value)}</li>")
        bio = el.find("BIOGRAPHY/TEXT")
        content = (f"<p><strong>{html.escape(name)}</strong></p>" if name else "") + (
            f"<ul>{''.join(rows)}</ul>" if rows else "") + ((bio.text or "") if bio is not None else "")
        title = html.unescape(_value(el, "TITLE")) or name or res.title or "Staff"
        if not _plain(content):
            return None
        return ir.Page(title=title, parts=[ir.HtmlPart(self.rich(content, res.base))], id=res.ident,
                       visible=visible and _flag(el, "ISAVAILABLE"))

    # ---------------------------------------------------------------- tests

    def _test_resource(self, c: _Content) -> Optional[str]:
        target_id, _type = self.links.get(c.res.ident, ("", ""))
        if not target_id and c.id:
            target_id, _type = self.links.get(c.id, ("", ""))
        res = self.pkg.res(target_id) if target_id else None
        if res is not None and res.type == "course/x-bb-courseassessment":
            settings = self.pkg.dat(res.ident)
            target_id = _value(settings, "ASMTID")
            res = self.pkg.res(target_id)
        if res is not None and res.type.startswith("assessment/"):
            return res.ident
        # Gradebook columns tie the content item to its assessment
        for res in self.pkg.of_type("course/x-bb-gradebook"):
            el = self.pkg.dat(res.ident)
            for od in el.iter("OUTCOMEDEFINITION") if el is not None else []:
                if _value(od, "CONTENTID") in (c.res.ident, c.id) and _value(od, "ASIDATAID"):
                    found = self._res_for(_value(od, "ASIDATAID")) or self._qti_by_object_id(_value(od, "ASIDATAID"))
                    if found:
                        return found
        tests = [r for r in self.pkg.of_type("assessment/x-bb-qti-test") if r.title.strip() == c.title.strip()]
        return tests[0].ident if len(tests) == 1 else None

    def _qti_by_object_id(self, object_id: str) -> Optional[str]:
        for res in self.pkg.of_type("assessment/x-bb-qti-test", "assessment/x-bb-qti-survey"):
            el = self.pkg.dat(res.ident)
            a = el.find(".//assessment") if el is not None else None
            if a is not None and _meta(a).get("bbmd_asi_object_id") == object_id:
                return res.ident
        return None

    def _test(self, c: _Content, visible: bool):
        qti_id = self._test_resource(c)
        doc = self.pkg.dat(qti_id) if qti_id else None
        assessment = next(doc.iter("assessment"), None) if doc is not None else None
        if assessment is None:
            return ir.UnsupportedItem(title=c.title, kind="quiz", id=c.res.ident,
                                      reason="the test's questions are missing from the export")
        self._used.add(qti_id)
        base = self.pkg.res(qti_id).base
        resolve = self.pkg.resolver(base, c.res.base)
        intro_parts = []
        body = self.body(c)
        if body is not None:
            intro_parts.append(body.html)
        for tag in ("presentation_material", "rubric"):
            el = assessment.find(tag)
            value = self.qti.material(el) if el is not None else ""
            if _plain(value) and value not in intro_parts:
                intro_parts.append(value)
        intro = ir.RichText("".join(intro_parts), resolve)
        questions = self._questions(assessment, resolve, c.title)
        settings = self.course_assessments.get(qti_id)
        outcome = self.outcome(c.res.ident, c.id, qti_id, _meta(assessment).get("bbmd_asi_object_id", ""))
        if not questions:
            # Ultra assignments are tests without questions
            return ir.AssignmentItem(title=c.title, instructions=intro, due_date=outcome.due, points=outcome.points,
                                     allow_file=True, allow_text=True, attachments=self._attachments(c, body),
                                     id=c.res.ident, visible=visible)
        item = ir.Assessment(title=c.title, questions=questions, intro=intro, due_date=outcome.due,
                             id=c.res.ident, visible=visible)
        if settings is not None:
            if _flag(settings, "ISUNLIMITEDATTEMPTS", False):
                item.max_attempts = 0
            elif _flag(settings, "ALLOWMULTIPLEATTEMPTS", False):
                item.max_attempts = max(to_int(_value(settings, "ATTEMPTCOUNT"), 0), 0)
            minutes = to_int(_value(settings, "TIMELIMIT"), 0)
            item.time_limit_minutes = minutes if minutes > 0 else None
            feedback = _value(settings, "FEEDBACKSETTINGS").lower()
            item.show_correct_answers = _flag(settings, "SHOWCORRECTANSWER", False) or bool(
                re.search(r"(?:^|[:,])ca(?:,|\||$)", feedback))
            item.shuffle = _flag(settings, "RANDOMIZEQUESTIONS", False)
        return item

    def _questions(self, assessment: Element, resolve: ir.Resolver, title: str) -> list[ir.Question]:
        questions: list[ir.Question] = []

        def walk(node: Element):
            for child in node:
                if child.tag == "item":
                    questions.append(self.qti.question(child, resolve))
                elif child.tag == "section":
                    selection = child.find("selection_ordering")
                    if selection is not None and selection.find(".//selection") is not None:
                        self._block(child, selection, questions, title)
                    walk(child)

        walk(assessment)
        return questions

    def _block(self, section: Element, selection: Element, questions: list, title: str) -> None:
        """Question set / random block: questions drawn from pools."""
        weight = to_float(_meta(section).get("qmd_weighting"), 0.0)
        drawn: list[ir.Question] = []
        for sel in selection.iter("selection"):
            refs = [(m.text or "").strip() for m in sel.iter("selection_metadata")
                    if (attr(m, "mdname") or "").lower() in ("bbmd_questionid", "") and (m.text or "").strip()]
            bank = text(sel, "sourcebank_ref")
            items: list[tuple[Element, str]] = []
            if refs:
                pool = self.pool_items()
                self._drawn.update(refs)
                missing = [r for r in refs if r not in pool]
                items = [pool[r] for r in refs if r in pool]
                if missing:
                    self.warn(f"{len(missing)} pool question(s) used by “{title}” are missing from the export")
            elif bank:
                res_id = self._res_for(bank) or bank
                doc = self.pkg.dat(res_id) if self.pkg.res(res_id) else None
                if doc is None:
                    self.warn(f"Question pool used by “{title}” is missing from the export")
                    continue
                base = self.pkg.res(res_id).base
                self._used.add(res_id)
                items = [(it, base) for it in doc.iter("item")]
            else:
                continue
            # A random draw (selection_number) is replaced by the whole set
            for it, base in items:
                drawn.append(self.qti.question(it, self.pkg.resolver(base), points=weight or None))
        questions.extend(drawn)

    def pool_items(self) -> dict[str, tuple[Element, str]]:
        if self._pool_items is None:
            self._pool_items = {}
            for res in self.pkg.of_type("assessment/x-bb-qti-pool", "assessment/x-bb-qti-test"):
                doc = self.pkg.dat(res.ident)
                for it in doc.iter("item") if doc is not None else []:
                    oid = qti.qti_metadata(it).get("bbmd_asi_object_id")
                    if oid:
                        self._pool_items.setdefault(oid, (it, res.base))
        return self._pool_items

    # ------------------------------------------------------------- leftovers

    def _report_unused(self) -> None:
        """Source items nothing in the course content pointed at; each one goes in the report."""
        for res in self.pkg.of_type(*_STANDALONE):
            if res.ident not in self._used:
                self.skip(res.title or res.ident, _STANDALONE[res.type], "not imported")
        legacy = {"assessment/x-bb-pool": "question pool", "assessment/x-bb-quiz": "quiz",
                  "assessment/x-bb-survey": "survey"}
        for res in self.pkg.of_type(*legacy):
            self.skip(res.title or res.ident, legacy[res.type], _LEGACY_REASON)
        for res in self.pkg.of_type("resource/x-plugin-scormengine"):
            self.skip(res.title or res.ident, "scorm", _SCORM_REASON)


def read(root: str) -> ir.Course:
    return _Reader(root).read()
