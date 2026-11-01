"""
Open edX reader: OLX course exports (the .tar.gz from Studio "Export course").

Layout of an export (every file is optional except ``course.xml``)::

    course.xml                      <course url_name="run" org="Org" course="Num"/>
    course/{run}.xml                course attributes and the chapter list
    chapter/{id}.xml                -> Section
    sequential/{id}.xml             subsection (graded, format, due)
    vertical/{id}.xml               unit -> Page (or Assessment / VideoItem...)
    html/{id}.xml + html/{id}.html  components ("pointer" files)...
    problem/{id}.xml, video/{id}.xml, ...
    policies/{run}/policy.json      per-block metadata overrides (display names, due dates, visibility)
    policies/{run}/grading_policy.json
    policies/assets.json            static file metadata
    about/overview.html, about/short_description.html
    info/handouts.html, info/updates.items.json
    tabs/{slug}.html                static pages
    static/                         course files (/static/x, /c4x/..., asset-v1:... URLs)

Any element may also be written inline instead of as a pointer to its own
file, and both styles mix freely, so every element goes through
``_Reader._definition`` which follows pointers when the file exists.

Mapping: chapter -> Section, every vertical (unit) -> one item. A unit becomes
a Page with its components as parts in order, and ungraded problems become
in-page self-check quizzes. Inside a graded subsection the problems become a
graded Assessment instead (one for the whole subsection when every unit is
made of problems only). Course pages (static tabs, handouts, updates) go into
a trailing "Course pages" section.
"""

from __future__ import annotations

import copy
import html as html_lib
import json
import math
import os
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import unquote
from xml.etree.ElementTree import Element, tostring

from .. import ir
from ..xmlutil import XmlError, parse_bytes, to_bool, to_float, to_int
from .common import FileIndex, iso_from_text, make_resolver, slug_title
from .moodle import eval_formula
from ..report import error_text

KEY = "openedx"
LABEL = "Open edX"

MAX_DEPTH = 16
MAX_FILE_BYTES = 20 * 1024 * 1024

# CAPA response types that map to a native question
_NATIVE_RESPONSES = {
    "multiplechoiceresponse", "choiceresponse", "truefalseresponse", "optionresponse",
    "stringresponse", "numericalresponse", "coderesponse",
}
# ... and the ones LearnHouse cannot grade, with the reason shown in the report
# Report wording for problem types that have no LearnHouse equivalent
_KIND_LABELS = {
    "customresponse": "script-graded", "python-script": "script-graded", "formularesponse": "formula",
    "schematicresponse": "circuit", "imageresponse": "image hot spot", "javascriptresponse": "JavaScript",
    "symbolicresponse": "symbolic math", "drag-and-drop-v2": "drag and drop", "numericalresponse": "numerical",
    "multiplechoiceresponse": "multiple choice", "choiceresponse": "checkbox", "optionresponse": "dropdown",
    "stringresponse": "text", "annotationresponse": "annotation", "coderesponse": "code",
}


def _kind_label(kinds: list[str]) -> str:
    names = [_KIND_LABELS.get(k, k) for k in kinds]
    return ("/".join(dict.fromkeys(names)) or "problem") + " question"


_UNSUPPORTED_RESPONSES = {
    "formularesponse": "math expressions are graded symbolically",
    "symbolicresponse": "math expressions are graded symbolically",
    "customresponse": "graded by a Python script",
    "schematicresponse": "circuit schematic problem",
    "imageresponse": "click-on-image regions",
    "annotationresponse": "annotation problem",
    "javascriptresponse": "graded by JavaScript",
    "externalresponse": "graded by an external service",
    "choicetextresponse": "choices with embedded text inputs",
}
_RESPONSE_TAGS = _NATIVE_RESPONSES | set(_UNSUPPORTED_RESPONSES)
_FILLABLE = {"optionresponse", "stringresponse", "numericalresponse"}
# Parents that put a response inside running text (inline dropdowns, tables)
_INLINE_PARENTS = {"p", "td", "th", "li", "span", "b", "strong", "em", "i", "u", "label", "a", "sub", "sup"}
# The paragraph-like element a blank sits in: several blanks in one are one fill-in-the-blanks text
_TEXT_BLOCKS = {"p", "li", "table", "blockquote", "pre", "h1", "h2", "h3", "h4", "h5", "h6", "dd", "dt"}
# Children of a response that are inputs/grading config, not question text
_CONTROL_TAGS = {
    "choicegroup", "checkboxgroup", "radiogroup", "optioninput", "textline", "formulaequationinput",
    "responseparam", "additional_answer", "correcthint", "stringequalhint", "regexphint", "hintgroup",
    "textbox", "codeparam", "imageinput", "schematic", "jsinput", "annotationinput", "choicetextgroup",
    "radiotextgroup", "checkboxtextgroup", "answer", "textinput", "chemicalequationinput",
    "drag_and_drop_input", "crystallography", "vsepr_input", "editamoleculeinput", "editageneinput",
    "designprotein2dinput", "filesubmission", "math", "numericalequalhint", "solution", "demandhint",
    "script", "sampleformula", "tolerance",
}
_STRIP_TAGS = {"script", "demandhint", "hintgroup", "style"}

# Components that only hold other components
_CONTAINERS = {"vertical", "library_content", "library_sourced", "conditional", "wrapper", "unit", "itembank"}
_DEFAULT_TITLES = {
    "openassessment": "Open response assessment", "edx_sga": "Staff graded assignment", "lti": "LTI tool",
    "lti_consumer": "LTI tool", "staffgradedxblock": "Staff graded points", "scorm": "SCORM package",
}
# openassessment's default submission_due: "no deadline"
_ORA_DEFAULT_DUE = ("2029-01-01T00:00:00",)
_SEQUENCES = {"sequential", "videosequence"}
_SILENT = {"done", "wiki", "textbook", "word_cloud_placeholder"}
_UNSUPPORTED_XBLOCKS = {
    "word_cloud": "word clouds have no LearnHouse equivalent",
    "poll": "polls have no LearnHouse equivalent",
    "survey": "surveys have no LearnHouse equivalent",
    "recommender": "recommender blocks have no LearnHouse equivalent",
    "image-explorer": "image explorer blocks have no LearnHouse equivalent",
    "invideoquiz": "in-video quizzes have no LearnHouse equivalent",
}

_NUM = r"[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?"
_RANGE = re.compile(rf"^\s*[\[(]\s*({_NUM})\s*,\s*({_NUM})\s*[\])]\s*$")
_FRACTION = re.compile(rf"^\s*({_NUM})\s*/\s*({_NUM})\s*$")
_QUOTED = re.compile(r"'((?:[^'\\]|\\.)*)'|\"((?:[^\"\\]|\\.)*)\"")
_ASSET_V1 = re.compile(r"asset-v1:[^/?#\s]*?\+type@asset\+block@([^/?#\s]+)")
_C4X = re.compile(r"(?:^|/)c4x/[^/]+/[^/]+/asset/([^?#\s]+)")
_STATIC = re.compile(r"^/?static/([^?#]+)")
# Open edX replaces spaces, "/" and other punctuation with "_" in asset names ("my file.png" ->
# /static/my_file.png, "a - b.pdf" -> a___b.pdf; the exact set changed across releases), so names are
# compared with every run of characters other than letters, digits and dots folded to one "_"
_ASSET_UNSAFE = re.compile(r"[^a-z0-9.]+")
# Links to other units of the course; they have no address outside Open edX
_INTERNAL_LINK = re.compile(
    r"<a\b[^>]*\bhref\s*=\s*[\"'](?:(?:[^\"']*/)?jump_to(?:_id)?/[^\"']*|/courses?/[^\"']*|[0-9a-f]{32})[\"'][^>]*>"
    r"(.*?)</a>", re.I | re.S)
_IFRAME_SRC = re.compile(r"<iframe[^>]*\ssrc\s*=\s*[\"']([^\"']+)", re.I)
_EXPLANATION_HEAD = re.compile(r"^\s*(<div[^>]*>\s*)?<p>\s*(<b>|<strong>)?\s*Explanation:?\s*(</b>|</strong>)?\s*</p>",
                               re.I)


# ---------------------------------------------------------------------------
# Detection
# ---------------------------------------------------------------------------


def _is_course_xml(path: str) -> bool:
    if not os.path.isfile(path):
        return False
    el = _parse_path(path)
    if el is None or el.tag != "course":
        return False
    if el.find("shortname") is not None:  # Moodle backups ship a course/course.xml too
        return False
    return bool(el.get("url_name") or el.get("org") or el.find("chapter") is not None)


def _course_file(folder: str) -> Optional[str]:
    """``course.xml``, or the ``roots/{run}.xml`` it links to in git-managed courses.

    Course repositories kept in git make ``course.xml`` a symlink into
    ``roots/``; the archive extractor drops symlinks, so the target is read directly.
    """
    path = os.path.join(folder, "course.xml")
    if _is_course_xml(path):
        return path
    roots = os.path.join(folder, "roots")
    if os.path.isdir(roots) and not os.path.lexists(path):
        for name in sorted(os.listdir(roots)):
            candidate = os.path.join(roots, name)
            if name.endswith(".xml") and _is_course_xml(candidate):
                return candidate
    return None


def _library_file(folder: str) -> Optional[str]:
    """``library.xml`` of a content library export (Studio › Libraries › Export)."""
    path = os.path.join(folder, "library.xml")
    el = _parse_path(path) if os.path.isfile(path) else None
    return path if el is not None and el.tag == "library" else None


def _olx_root(root: str) -> Optional[str]:
    """The directory holding ``course.xml`` (or a library's ``library.xml``): ``root`` or a lone subfolder."""
    current = root
    for _ in range(3):
        if os.path.isfile(os.path.join(current, "moodle_backup.xml")):
            return None
        if _course_file(current) or _library_file(current):
            return current
        try:
            entries = [e for e in os.listdir(current) if not e.startswith((".", "__MACOSX"))]
        except OSError:
            return None
        dirs = [e for e in entries if os.path.isdir(os.path.join(current, e))]
        if len(dirs) != 1:
            return None
        current = os.path.join(current, dirs[0])
    return None


def detect(root: str) -> int:
    return 100 if _olx_root(root) else 0


def read(root: str) -> ir.Course:
    olx = _olx_root(root)
    if olx is None:
        raise ValueError("No Open edX course.xml found in the export")
    if not _course_file(olx):
        return _Reader(olx).read_library()
    return _Reader(olx).read()


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------


def _parse_path(path: str) -> Optional[Element]:
    try:
        if os.path.getsize(path) > MAX_FILE_BYTES:
            return None
        with open(path, "rb") as f:
            return parse_bytes(f.read())
    except (OSError, XmlError):
        return None


def _read_text(path: Optional[str]) -> str:
    if not path:
        return ""
    try:
        if os.path.getsize(path) > MAX_FILE_BYTES:
            return ""
        with open(path, "rb") as f:
            return f.read().decode("utf-8", errors="replace")
    except OSError:
        return ""


def _outer(el: Element) -> str:
    """Serialized element without its tail."""
    tail, el.tail = el.tail, None
    try:
        return tostring(el, encoding="unicode")
    finally:
        el.tail = tail


def _inner(el: Optional[Element]) -> str:
    """Serialized content of ``el`` (text and children, not the tag itself)."""
    if el is None:
        return ""
    out = [html_lib.escape(el.text or "", quote=False)]
    for child in el:
        if isinstance(child.tag, str):
            out.append(_outer(child))
        out.append(html_lib.escape(child.tail or "", quote=False))
    return "".join(out)


def _plain(el: Optional[Element]) -> str:
    return re.sub(r"\s+", " ", "".join(el.itertext())).strip() if el is not None else ""


def _flag(value) -> bool:
    if isinstance(value, bool):
        return value
    return to_bool(value, False)


def _json(value, default):
    if isinstance(value, (list, dict)):
        return value
    if not value or not isinstance(value, str):
        return default
    try:
        return json.loads(value)
    except ValueError:
        return default


def _parents(root: Element) -> dict:
    return {child: parent for parent in root.iter() for child in parent}


def _replace_with_text(parents: dict, node: Element, text: str) -> None:
    parent = parents[node]
    index = list(parent).index(node)
    addition = text + (node.tail or "")
    if index == 0:
        parent.text = (parent.text or "") + addition
    else:
        prev = parent[index - 1]
        prev.tail = (prev.tail or "") + addition
    parent.remove(node)


def _number(value: str) -> Optional[float]:
    value = (value or "").strip()
    m = _FRACTION.match(value)
    if m:
        den = float(m.group(2))
        return float(m.group(1)) / den if den else None
    if re.fullmatch(_NUM, value):
        return float(value)
    # Answers written as arithmetic ("2*0.3259", "8*80*60"): evaluated without eval()
    if value and re.fullmatch(r"[0-9.eE+\-*/^() ]+", value):
        result = eval_formula(value.replace("^", "**"))
        if result is not None and math.isfinite(result):
            return result
    return None


def _options(raw: str) -> list[str]:
    """``optioninput options="('a','b')"`` -> ["a", "b"] (no eval)."""
    out = []
    for m in _QUOTED.finditer(raw or ""):
        value = m.group(1) if m.group(1) is not None else m.group(2)
        out.append(re.sub(r"\\(.)", r"\1", value).strip())
    return out


def _text_html(text: str) -> str:
    """Plain text with blank-line paragraphs as HTML."""
    paras = [re.sub(r"\s+", " ", p).strip() for p in re.split(r"\n\s*\n", text or "")]
    return "".join(f"<p>{html_lib.escape(p, quote=False)}</p>" for p in paras if p)


def _due(value, placeholders: tuple = ()) -> Optional[str]:
    """ISO due date from OLX, or None for unset values and "never" placeholders.

    Exports write "null"/"false" for no date, Studio's display format ("Feb 20, 2020, 17:00")
    in hand-edited XML, and far-future dates (ORA's 2029-01-01 default, 9999-...) meaning "no due date".
    """
    raw = str(value or "").strip().strip('"')
    if not raw or raw.lower() in ("null", "none", "false"):
        return None
    iso = iso_from_text(raw)
    if iso is None:
        for fmt in ("%b %d, %Y, %H:%M", "%B %d, %Y, %H:%M", "%b %d, %Y", "%B %d, %Y", "%Y-%m-%dT%H:%M"):
            try:
                iso = datetime.strptime(raw, fmt).replace(tzinfo=timezone.utc).isoformat()
                break
            except ValueError:
                continue
    if iso is None or int(iso[:4]) >= 2100 or any(iso.startswith(p) for p in placeholders):
        return None
    return iso


@dataclass
class _Node:
    tag: str
    el: Element
    attrs: dict
    url_name: str = ""


@dataclass
class _Ctx:
    """Settings inherited down the tree (edX "inheritable" metadata)."""

    visible: bool = True
    due: Optional[str] = None
    showanswer: str = ""
    max_attempts: Optional[int] = None
    graded: bool = False

    def child(self, attrs: dict) -> "_Ctx":
        c = _Ctx(self.visible, self.due, self.showanswer, self.max_attempts, self.graded)
        if _flag(attrs.get("visible_to_staff_only")):
            c.visible = False
        if attrs.get("due"):
            c.due = _due(attrs["due"]) or c.due
        if attrs.get("showanswer"):
            c.showanswer = str(attrs["showanswer"]).strip().lower()
        if "max_attempts" in attrs:
            raw = attrs.get("max_attempts")
            c.max_attempts = None if raw in (None, "", "null", "None") else to_int(raw, 0) or None
        return c


@dataclass
class _Problem:
    title: str
    questions: list
    id: str = ""
    max_attempts: Optional[int] = None
    showanswer: str = ""


@dataclass
class _Comp:
    """One flattened unit component."""

    kind: str  # "part", "problem" or "item"
    part: object = None
    problem: Optional[_Problem] = None
    item: object = None
    source: str = ""  # component tag


@dataclass
class _Unit:
    title: str
    comps: list = field(default_factory=list)
    id: str = ""
    visible: bool = True


# ---------------------------------------------------------------------------
# Reader
# ---------------------------------------------------------------------------


class _Reader:
    def __init__(self, root: str):
        self.root = root
        self.index = FileIndex(root)
        self.warnings: list[str] = []
        self.skipped: list[tuple[str, str, str]] = []  # (title, kind, reason) of items not migrated
        self.policy: dict = {}
        self.assets: dict[str, str] = {}
        self.pass_percent: Optional[float] = None
        self.run = ""
        self.resolve = make_resolver(self.index, "", extra=self._edx_url)
        self._stack: list[tuple[str, str]] = []
        self._static: Optional[dict[str, str]] = None
        self._draft_units: Optional[dict] = None
        self._in_draft = False

    # ------------------------------------------------------------ plumbing

    def warn(self, message: str) -> None:
        """A genuine problem with the export (unreadable file, missing asset)."""
        if message not in self.warnings:
            self.warnings.append(message)

    def skip(self, title: str, kind: str, reason: str) -> None:
        """A source item that is not migrated; listed in the report, not a warning."""
        self.skipped.append((title, kind, reason))

    def rich(self, html: str) -> ir.RichText:
        html = html or ""
        if "<a" in html:
            html = _INTERNAL_LINK.sub(r"\1", html)  # links to other units have no address outside edX
        return ir.RichText(html, self.resolve)

    def _edx_url(self, url: str) -> Optional[ir.Asset]:
        """Course file URLs -> static/: ``/static/x.png``, ``/c4x/org/course/asset/x.png`` and
        ``asset-v1:org+course+run+type@asset+block@x.png`` (asset names have "_" for spaces and "/")."""
        url = (url or "").strip()
        m = _ASSET_V1.search(url) or _C4X.search(url)
        keyed = m is not None
        m = m or _STATIC.match(url)
        if not m:
            return None
        name = unquote(m.group(1))
        for rel in (f"static/{name}", self.assets.get(name)):
            full = self.index.get(rel) if rel else None
            if full:
                return self.index.asset(full)
        full = self._static_names().get(_ASSET_UNSAFE.sub("_", name.lower()))
        if full:
            return self.index.asset(full)
        if keyed:
            matches = self.index.by_basename(os.path.basename(name))
            if len(matches) == 1:
                return self.index.asset(matches[0])
        return None

    def _static_names(self) -> dict[str, str]:
        if self._static is None:
            self._static = {}
            base = os.path.join(self.root, "static")
            for dirpath, _dirs, files in os.walk(base):
                for f in files:
                    full = os.path.join(dirpath, f)
                    rel = os.path.relpath(full, base).replace(os.sep, "/")
                    self._static.setdefault(_ASSET_UNSAFE.sub("_", rel.lower()), full)
        return self._static

    def _file(self, rel: str) -> Optional[str]:
        return self.index.get(rel)

    def _definition(self, el: Element) -> Optional[_Node]:
        """Follow a pointer tag (``<html url_name="x"/>`` -> html/x.xml) and apply policy.json."""
        tag = el.tag
        url = el.get("url_name", "")
        node_el = el
        if url and len(el) == 0 and not (el.text or "").strip():
            path = None
            rels = [f"{tag}/{url}.xml", f"{tag}/{url.replace(':', '/')}.xml"]
            if self._in_draft:  # a draft unit's own components may be drafts too
                rels.insert(0, f"drafts/{tag}/{url}.xml")
            for rel in rels:
                path = self._file(rel)
                if path:
                    break
            if path:
                loaded = _parse_path(path)
                if loaded is None:
                    self.warn(f"Could not parse {tag}/{os.path.basename(path)}; it was skipped")
                    return None
                node_el = loaded
        attrs: dict = dict(node_el.attrib)
        for k, v in el.attrib.items():
            attrs.setdefault(k, v)
        if url:
            meta = self.policy.get(f"{tag}/{url}")
            if isinstance(meta, dict):
                attrs.update(meta)
        return _Node(tag=tag, el=node_el, attrs=attrs, url_name=url)

    @staticmethod
    def _name(node: _Node, fallback: str = "") -> str:
        name = node.attrs.get("display_name")
        return re.sub(r"\s+", " ", str(name)).strip() if name else fallback

    # --------------------------------------------------------------- course

    def read(self) -> ir.Course:
        pointer = _parse_path(_course_file(self.root) or os.path.join(self.root, "course.xml"))
        self.run = pointer.get("url_name", "") if pointer is not None else ""
        self._load_policies()
        course_el = pointer
        if pointer.find("chapter") is None and self.run:
            path = self._file(f"course/{self.run}.xml")
            loaded = _parse_path(path) if path else None
            if loaded is not None:
                course_el = loaded
            elif path:
                self.warn(f"Could not parse course/{self.run}.xml")
        attrs = dict(course_el.attrib)
        for k, v in pointer.attrib.items():
            attrs.setdefault(k, v)
        meta = self.policy.get(f"course/{self.run}")
        if isinstance(meta, dict):
            attrs.update(meta)
        node = _Node("course", course_el, attrs, self.run)

        org = str(attrs.get("org") or "")
        number = str(attrs.get("course") or "")
        course = ir.Course(
            title=self._name(node, number or "Imported course"),
            source=KEY,
            short_name=number,
            id="+".join(p for p in (org, number, self.run) if p),
            language=str(attrs.get("language") or ""),
        )
        learnings = _json(attrs.get("learning_info"), [])
        course.learnings = [str(x).strip() for x in learnings if isinstance(x, str) and x.strip()]
        course.thumbnail = self._course_image(attrs)
        overview = _read_text(self._file("about/overview.html")).strip()
        short = _read_text(self._file("about/short_description.html")).strip()
        course.summary = self.rich(short or overview)

        ctx = _Ctx().child(attrs)
        ctx.visible = True  # staff-only on the course itself means nothing here
        for n, child in enumerate(c for c in course_el if c.tag == "chapter"):
            section = self._chapter(child, ctx, n + 1)
            if section is not None:
                course.sections.append(section)
        pages = self._course_pages(overview if short else "")
        if pages.items:
            course.sections.append(pages)
        course.warnings.extend(self.warnings)
        course.skipped.extend(self.skipped)
        return course

    def read_library(self) -> ir.Course:
        """A content library: its problems and other components, unpublished, as one course."""
        el = _parse_path(_library_file(self.root) or "")
        attrs = dict(el.attrib) if el is not None else {}
        self._load_policies()
        node = _Node("library", el if el is not None else Element("library"), attrs, attrs.get("url_name", ""))
        library_id = str(attrs.get("library") or "")
        course = ir.Course(title=self._name(node, library_id or "Content library"), source=KEY,
                           short_name=library_id,
                           id="+".join(p for p in (str(attrs.get("org") or ""), library_id) if p))
        ctx = _Ctx(graded=True)
        unit = self._unit(node, ctx, course.title)
        items = self._one_unit(unit, ctx, None) if unit is not None else []
        for item in items:
            item.visible = False
        if items:
            course.sections.append(ir.Section(title=course.title, items=items, id="library", visible=False))
        course.warnings.extend(self.warnings)
        course.skipped.extend(self.skipped)
        return course

    def _load_policies(self) -> None:
        candidates = [f"policies/{self.run}/policy.json", f"policies/{self.run}.json"] if self.run else []
        path = next((p for p in (self._file(c) for c in candidates) if p), None)
        if path is None:
            found = sorted(p for p in (self._file(f) for f in self._policy_files("policy.json")) if p)
            path = found[0] if len(found) == 1 else None
        if path:
            data = _json(_read_text(path), None)
            if isinstance(data, dict):
                self.policy = data
            else:
                self.warn("policies/policy.json is not valid JSON; its settings were ignored")
        grading_dir = os.path.dirname(path) if path else os.path.join(self.root, "policies", self.run)
        grading = _json(_read_text(os.path.join(grading_dir, "grading_policy.json")), {})
        cutoffs = grading.get("GRADE_CUTOFFS") if isinstance(grading, dict) else None
        if isinstance(cutoffs, dict):
            values = [to_float(v, -1) for v in cutoffs.values()]
            values = [v for v in values if 0 < v <= 1]
            if values:
                self.pass_percent = round(min(values) * 100, 2)
        assets = _json(_read_text(self._file("policies/assets.json")), {})
        if isinstance(assets, dict):
            for name, info in assets.items():
                if not isinstance(info, dict):
                    continue
                path = info.get("import_path") or info.get("displayname")
                if isinstance(path, str) and path:
                    self.assets[name] = f"static/{path}"

    def _policy_files(self, name: str) -> list[str]:
        base = os.path.join(self.root, "policies")
        try:
            return [f"policies/{d}/{name}" for d in os.listdir(base) if os.path.isdir(os.path.join(base, d))]
        except OSError:
            return []

    def _course_image(self, attrs: dict) -> Optional[ir.Asset]:
        for key in ("course_image", "banner_image", "video_thumbnail_image"):
            name = attrs.get(key)
            if not name or not isinstance(name, str):
                continue
            name = name.strip()
            asset = self.resolve(name if name.startswith("/") or ":" in name else f"/static/{name}")
            if asset is not None:
                return asset
        return None

    # ------------------------------------------------------------- outline

    def _enter(self, node: _Node) -> bool:
        key = (node.tag, node.url_name)
        if len(self._stack) >= MAX_DEPTH or (node.url_name and key in self._stack):
            self.warn(f"Nested {node.tag} '{node.url_name}' loops back on itself or is too deep; skipped")
            return False
        self._stack.append(key)
        return True

    def _leave(self) -> None:
        self._stack.pop()

    def _chapter(self, el: Element, ctx: _Ctx, n: int) -> Optional[ir.Section]:
        node = self._definition(el)
        if node is None or not self._enter(node):
            return None
        try:
            cctx = ctx.child(node.attrs)
            section = ir.Section(title=self._name(node, f"Chapter {n}"), id=f"chapter/{node.url_name or n}",
                                 visible=cctx.visible)
            units: list[_Unit] = []
            for child in node.el:
                if child.tag in _SEQUENCES:
                    section.items.extend(self._unit_items(units, cctx, section.title))
                    units = []
                    section.items.extend(self._sequential(child, cctx))
                else:
                    units.extend(self._child_units([child], cctx, section.title))
            section.items.extend(self._unit_items(units, cctx, section.title))
            return section
        finally:
            self._leave()

    def _child_units(self, children: list, ctx: _Ctx, fallback: str) -> list:
        """Units of a chapter or subsection. A child that is not a vertical (old XML courses put
        problems and videos straight in the sequence) is a unit of its own, as edX shows it."""
        units = []
        for child in children:
            if child.tag == "vertical":
                vnode = self._definition(child)
                unit = self._unit(vnode, ctx, fallback) if vnode is not None else None
            else:
                cnode = self._definition(child)
                if cnode is None:
                    continue
                holder = Element("vertical", {"display_name": self._name(cnode, fallback)})
                holder.append(child)
                unit = self._unit(_Node("vertical", holder, dict(holder.attrib),
                                        f"{cnode.tag}-{cnode.url_name}" if cnode.url_name else ""), ctx)
            if unit:
                units.append(unit)
        return units

    def _sequential(self, el: Element, ctx: _Ctx) -> list:
        node = self._definition(el)
        if node is None or not self._enter(node):
            return []
        try:
            sctx = ctx.child(node.attrs)
            sctx.graded = _flag(node.attrs.get("graded"))
            title = self._name(node, "Subsection")
            children = [c for c in node.el if isinstance(c.tag, str)]
            units = self._child_units(children, sctx, title)
            units = self._with_drafts(node.url_name, children, units, sctx, title)
            time_limit = None
            if _flag(node.attrs.get("is_time_limited")):
                minutes = to_int(node.attrs.get("default_time_limit_minutes"), 0)
                time_limit = minutes or None
            return self._unit_items(units, sctx, title, seq_id=f"sequential/{node.url_name}",
                                    time_limit=time_limit)
        finally:
            self._leave()

    # --------------------------------------------------------------- drafts

    def _drafts(self) -> dict:
        """Units that only exist as unpublished drafts, by parent subsection.

        Studio exports the draft copy of every unit under ``drafts/`` (with its parent and position);
        units that were never published have no copy in ``vertical/``.
        """
        if self._draft_units is None:
            self._draft_units = {}
            base = os.path.join(self.root, "drafts", "vertical")
            names = sorted(os.listdir(base)) if os.path.isdir(base) else []
            for name in names:
                if not name.endswith(".xml") or self._file(f"vertical/{name}"):
                    continue
                el = _parse_path(os.path.join(base, name))
                parent = (el.get("parent_url") or el.get("parent_sequential_url") or "") if el is not None else ""
                parent = re.split(r"block@|/", parent)[-1]
                if not parent:
                    continue
                el.set("url_name", name[:-4])
                self._draft_units.setdefault(parent, []).append(
                    (to_int(el.get("index_in_children_list"), 10 ** 6), el))
        return self._draft_units

    def _with_drafts(self, seq_url: str, children: list, units: list, ctx: _Ctx, title: str) -> list:
        drafts = self._drafts().get(seq_url) if seq_url else None
        if not drafts:
            return units
        published = {c.get("url_name") for c in children}
        for index, el in sorted(drafts, key=lambda d: d[0]):
            if el.get("url_name") in published:
                continue
            self._in_draft = True
            try:
                attrs = dict(el.attrib)
                attrs["visible_to_staff_only"] = True  # never published: imported hidden
                unit = self._unit(_Node("vertical", el, attrs, el.get("url_name")), ctx, title)
            finally:
                self._in_draft = False
            if unit:
                units.insert(min(index, len(units)), unit)
        return units

    # ---------------------------------------------------------------- units

    def _unit(self, node: _Node, ctx: _Ctx, fallback: str = "Unit") -> Optional[_Unit]:
        if not self._enter(node):
            return None
        try:
            uctx = ctx.child(node.attrs)
            title = self._name(node, fallback)
            unit = _Unit(title=title, id=f"vertical/{node.url_name}" if node.url_name else "",
                         visible=uctx.visible)
            self._collect(node, uctx, unit.comps, title)
            return unit if unit.comps else None
        finally:
            self._leave()

    def _collect(self, node: _Node, ctx: _Ctx, out: list, where: str) -> None:
        for child in node.el:
            cnode = self._definition(child)
            if cnode is None:
                continue
            cctx = ctx.child(cnode.attrs)
            if ctx.visible and not cctx.visible:
                continue  # staff-only component in a published unit: left out, as learners never saw it
            if cnode.tag in _CONTAINERS or cnode.tag == "split_test":
                if not self._enter(cnode):
                    continue
                try:
                    self._container(cnode, cctx, out, where)
                finally:
                    self._leave()
                continue
            try:
                self._component(cnode, cctx, out, where)
            except Exception as e:  # a broken component must not sink the unit
                self.warn(f"{where}: {cnode.tag} component could not be read ({error_text(e)})")

    def _container(self, node: _Node, ctx: _Ctx, out: list, where: str) -> None:
        tag = node.tag
        if tag == "split_test":
            # A content experiment (A/B test): learners saw one group, the import keeps the first
            first = next((c for c in node.el if isinstance(c.tag, str)), None)
            if first is not None:
                holder = Element("wrapper")
                holder.append(first)
                self._collect(_Node("wrapper", holder, {}), ctx, out, where)
            return
        if tag in ("library_content", "library_sourced"):
            # Randomized library content: every block is imported (max_count picked a few per learner)
            if not any(isinstance(c.tag, str) for c in node.el):
                self.skip(self._name(node) or where, "library content", "no problems in the export")
                return
        # conditional: the content is always shown (the condition was dropped)
        self._collect(node, ctx, out, where)

    # ----------------------------------------------------------- components

    def _component(self, node: _Node, ctx: _Ctx, out: list, where: str) -> None:
        tag = node.tag
        name = self._name(node)
        if tag == "html":
            part = self._html(node)
            if part is not None:
                out.append(_Comp("part", part=part, source=tag))
        elif tag == "video":
            out.extend(_Comp("part", part=p, source=tag) for p in self._video(node, where))
        elif tag == "problem":
            questions = self._problem(node, where)
            if questions:
                out.append(_Comp("problem", problem=_Problem(
                    title=name, questions=questions, id=f"problem/{node.url_name}",
                    max_attempts=ctx.max_attempts, showanswer=ctx.showanswer), source=tag))
        elif tag == "drag-and-drop-v2":
            q = self._drag_and_drop(node, name or "Drag and drop", where)
            out.append(_Comp("problem", problem=_Problem(title=name, questions=[q], id=f"problem/{node.url_name}",
                                                         max_attempts=ctx.max_attempts), source=tag))
        elif tag == "annotatable":
            part = self._annotatable(node)
            if part is not None:
                out.append(_Comp("part", part=part, source=tag))
        elif tag == "discussion":
            self.skip(name or str(node.attrs.get("discussion_target") or "Discussion"), "discussion",
                      "discussions are not migrated")
        elif tag == "openassessment":
            out.append(_Comp("item", item=self._ora(node, ctx, where), source=tag))
        elif tag == "edx_sga":
            out.append(_Comp("item", item=ir.AssignmentItem(
                title=name, allow_file=True, allow_text=False,
                points=to_float(node.attrs.get("points"), 0) or None, due_date=ctx.due, graded=True,
                id=f"edx_sga/{node.url_name}", visible=ctx.visible,
                instructions=self.rich(f"<p>{html_lib.escape(name or 'Upload your work.')}</p>")), source=tag))
        elif tag in ("lti", "lti_consumer"):
            url = str(node.attrs.get("launch_url") or node.attrs.get("lti_1p3_launch_url") or "").strip()
            out.append(_Comp("item", item=ir.UnsupportedItem(
                title=name, kind="LTI tool", id=f"{tag}/{node.url_name}",
                reason="external LTI tools must be reconnected in LearnHouse" + (f" ({url})" if url else "")),
                source=tag))
        elif tag == "staffgradedxblock":
            out.append(_Comp("item", item=ir.UnsupportedItem(
                title=name, kind=tag, id=f"{tag}/{node.url_name}",
                reason="points entered offline by staff have no LearnHouse equivalent"), source=tag))
        elif tag == "scorm":
            out.append(_Comp("item", item=ir.UnsupportedItem(
                title=name, kind="scorm", id=f"scorm/{node.url_name}",
                reason="the SCORM package is stored outside the course export; upload it again"), source=tag))
        elif tag == "pdf":
            part = self._pdf(node, where)
            if part is not None:
                out.append(_Comp("part", part=part, source=tag))
        elif tag in ("google-document", "google-calendar", "iframe"):
            part = self._embed(node)
            if part is not None:
                out.append(_Comp("part", part=part, source=tag))
            else:
                self.skip(name or tag, tag, "no address")
        elif tag in _UNSUPPORTED_XBLOCKS:
            self.skip(name or tag, tag, _UNSUPPORTED_XBLOCKS[tag])
        elif tag in _SILENT:
            return
        else:
            self.skip(name or tag, tag, "no LearnHouse equivalent")

    # html -----------------------------------------------------------------

    def _html(self, node: _Node) -> Optional[ir.HtmlPart]:
        html = ""
        filename = node.attrs.get("filename")
        if filename and isinstance(filename, str):
            for rel in (f"html/{filename}.html", f"html/{filename}", f"{filename}.html", filename):
                path = self._file(rel)
                if path:
                    html = _read_text(path)
                    break
            else:
                self.skip(self._name(node) or filename, "html component", "its HTML file is missing from the export")
        elif len(node.el):
            html = _inner(node.el)
        elif (node.el.text or "").strip():
            html = node.el.text  # <![CDATA[...]]>: the text is the HTML source
        elif node.url_name:
            html = _read_text(self._file(f"html/{node.url_name}.html"))
        if not html.strip():
            return None
        return ir.HtmlPart(self.rich(html))

    def _annotatable(self, node: _Node) -> Optional[ir.HtmlPart]:
        el = copy.deepcopy(node.el)
        notes = []
        for ann in list(el.iter("annotation")):
            notes.append((ann.get("title") or "", ann.get("body") or "", _plain(ann)))
            # A text marker survives serialization; it becomes the highlight below
            _replace_with_text(_parents(el), ann, f"\x00{len(notes)}\x00")
        html = _inner(el)
        for i, (_title, _body, text) in enumerate(notes, start=1):
            html = html.replace(f"\x00{i}\x00", f"<mark>{html_lib.escape(text)}</mark><sup>[{i}]</sup>")
        if notes:
            html += "<ol>" + "".join(f"<li><strong>{html_lib.escape(t)}</strong> {html_lib.escape(b)}</li>"
                                     for t, b, _x in notes) + "</ol>"
        return ir.HtmlPart(self.rich(html)) if html.strip() else None

    # media ----------------------------------------------------------------

    def _video(self, node: _Node, where: str) -> list:
        a = node.attrs
        name = self._name(node)
        yt = (a.get("youtube_id_1_0") or "").strip()
        speeds_attr = a.get("youtube") or a.get("youtube_id") or ""  # "0.75:id1,1.00:id2"; youtube_id is old XML
        if not yt and speeds_attr:
            pairs = [p.split(":", 1) if ":" in p else ["1.00", p] for p in str(speeds_attr).split(",")]
            speeds = {k.strip(): v.strip() for k, v in pairs if v.strip()}
            yt = speeds.get("1.00") or speeds.get("1.0") or speeds.get("1") or next(iter(speeds.values()), "")
        if len(yt) == 13 and yt.startswith("3D"):
            yt = yt[2:]  # "=ID" query values URL-encoded once too often by old exporters: "%3DID"
        sources = [s for s in _json(a.get("html5_sources"), []) if isinstance(s, str)]
        sources += [s.get("src", "") for s in node.el.findall("source")]
        if a.get("source"):
            sources.append(str(a["source"]))
        # Pipeline-hosted videos (edx_video_id) list their encodings, with public URLs, in the export
        encodings = {e.get("profile", ""): (e.get("url") or "").strip() for e in node.el.iter("encoded_video")}
        if not yt and encodings.get("youtube") and not encodings["youtube"].startswith("http"):
            yt = encodings["youtube"]
        sources += [encodings[p] for p in ("desktop_mp4", "mobile_high", "mobile_low", "desktop_webm")
                    if encodings.get(p)]
        part = None
        if yt:
            part = ir.MediaPart(ir.MediaKind.VIDEO, url=f"https://www.youtube.com/watch?v={yt}", title=name)
        else:
            remote = ""
            for src in (s.strip() for s in sources if s and s.strip()):
                if re.match(r"^https?://", src, re.I) and not _ASSET_V1.search(src):
                    remote = remote or src
                    continue
                asset = self.resolve(src)
                if asset is not None:
                    part = ir.MediaPart(ir.MediaKind.VIDEO, asset=asset, title=name)
                    break
            if part is None and remote:
                part = ir.MediaPart(ir.MediaKind.VIDEO, url=remote, title=name)
        parts = []
        if part is not None:
            parts.append(part)
        elif a.get("edx_video_id"):
            self.skip(name or "Video", "video", "hosted by the Open edX video service; no file in the export")
        else:
            self.skip(name or "Video", "video", "no source")
        handout_el = node.el.find("handout")
        handout = a.get("handout") or (handout_el.get("src", "") if handout_el is not None else "")
        if handout and parts:
            asset = self.resolve(str(handout))
            if asset is not None:
                parts.append(ir.FilePart(asset, title=f"{name} handout" if name else "Handout"))
        return parts

    def _drag_and_drop(self, node: _Node, title: str, where: str) -> ir.Question:
        """drag-and-drop-v2 -> matching question: each item is matched with the zone it belongs in."""
        data = _json(node.attrs.get("data"), None)
        q = ir.Question(type=ir.QType.UNSUPPORTED, title=title, id=f"drag-and-drop-v2/{node.url_name}",
                        source_type="drag-and-drop-v2", reason="drag-and-drop problem without items")
        if not isinstance(data, dict):
            return q
        zones = {}
        for z in data.get("zones") or []:
            if isinstance(z, dict):
                zid = str(z.get("uid") or z.get("id") or z.get("title") or "")
                zones[zid] = re.sub(r"<[^>]+>", "", str(z.get("title") or zid)).strip() or zid
        several = False
        for n, item in enumerate(data.get("items") or [], start=1):
            if not isinstance(item, dict):
                continue
            targets = item.get("zones")
            if targets is None and item.get("zone") not in (None, "none"):
                targets = [item.get("zone")]  # drag-and-drop v1 / early v2 data
            targets = [zones.get(str(t), str(t)) for t in (targets or [])]
            if not targets:
                continue  # a decoy: it belongs in no zone
            several = several or len(targets) > 1
            label = str(item.get("displayName") or "").strip() or str(item.get("imageDescription") or "").strip()
            q.pairs.append(ir.MatchPair(self.rich(label or f"Item {n}"), targets[0]))
        if not q.pairs:
            return q
        used = {p.answer for p in q.pairs}
        q.distractors = [z for z in zones.values() if z not in used]
        prompt = str(node.attrs.get("question_text") or "").strip()
        if not prompt and isinstance(data.get("feedback"), dict):
            prompt = str(data["feedback"].get("start") or "").strip()
        html = f"<p>{html_lib.escape(prompt or 'Match each item with its zone.')}</p>"
        target = str(data.get("targetImg") or "").strip()
        if target:
            alt = html_lib.escape(str(data.get("targetImgDescription") or ""), quote=True)
            html += f'<p><img src="{html_lib.escape(target, quote=True)}" alt="{alt}"/></p>'
        q.type, q.text, q.reason, q.source_type = ir.QType.MATCHING, self.rich(html), "", ""
        if several:
            self.skip(title, "drag and drop question", "items fitting several zones keep only the first")
        return q

    def _pdf(self, node: _Node, where: str):
        url = str(node.attrs.get("url") or node.attrs.get("source_url") or "").strip()
        name = self._name(node, "PDF")
        if not url:
            self.skip(name, "pdf", "no file")
            return None
        asset = self.resolve(url)
        if asset is not None:
            return ir.MediaPart(ir.MediaKind.PDF, asset=asset, title=name)
        if re.match(r"^https?://", url, re.I):
            return ir.MediaPart(ir.MediaKind.PDF, url=url, title=name)
        self.warn(f"{where}: PDF '{url}' is missing from the export")
        return None

    def _embed(self, node: _Node) -> Optional[ir.EmbedPart]:
        a = node.attrs
        name = self._name(node)
        url = str(a.get("src") or a.get("url") or "").strip()
        code = str(a.get("embed_code") or "")
        if not url and code:
            m = _IFRAME_SRC.search(code)
            url = html_lib.unescape(m.group(1)) if m else ""
        if not url and a.get("calendar_id"):
            url = f"https://calendar.google.com/calendar/embed?src={a['calendar_id']}"
        if not url:
            return None
        return ir.EmbedPart(url=url, height=to_int(a.get("height"), 0) or 500, title=name)

    # assignments ------------------------------------------------------------

    def _ora(self, node: _Node, ctx: _Ctx, where: str) -> ir.AssignmentItem:
        el, a = node.el, node.attrs
        title = (el.findtext("title") or "").strip() or self._name(node)
        prompts = [(p.findtext("description") or p.text or "") for p in el.findall("prompts/prompt")]
        if not prompts and el.find("prompt") is not None:
            prompts = [el.find("prompt").text or ""]
        # ORA's prompts_type defaults to plain text; old exports omit it even for HTML prompts
        kind = str(a.get("prompts_type") or "").lower()
        body = "".join(p if (kind == "html" or (not kind and re.search(r"<[a-z][^>]*>", p))) else _text_html(p)
                       for p in prompts if p.strip())
        points = 0.0
        rubric = []
        for crit in el.findall("rubric/criterion"):
            label = (crit.findtext("label") or crit.findtext("name") or "").strip()
            options = [(o.findtext("label") or o.findtext("name") or "").strip() + f" ({o.get('points', '0')})"
                       for o in crit.findall("option")]
            values = [to_float(o.get("points"), 0) for o in crit.findall("option")]
            points += max(values) if values else 0
            rubric.append(f"<li><strong>{html_lib.escape(label)}</strong>: "
                          f"{html_lib.escape(', '.join(options))}</li>")
        if rubric:
            body += "<h3>Rubric</h3><ul>" + "".join(rubric) + "</ul>"
        steps = [s.get("name", "") for s in el.findall("assessments/assessment")]
        if any(s in ("peer-assessment", "self-assessment") for s in steps):
            # Submissions are graded by staff instead
            self.skip(title, "assessment steps", "peer and self assessment are not migrated")
        text_mode = str(a.get("text_response") if a.get("text_response") is not None else "required").lower()
        file_mode = str(a.get("file_upload_response") or "").lower()
        allow_text = text_mode in ("required", "optional")
        allow_file = file_mode in ("required", "optional") or _flag(a.get("allow_file_upload"))
        return ir.AssignmentItem(
            title=title, instructions=self.rich(body), due_date=_due(a.get("submission_due"), _ORA_DEFAULT_DUE)
            or ctx.due, allow_file=allow_file or not allow_text, allow_text=allow_text,
            points=points or None, pass_percent=self.pass_percent if ctx.graded else None, graded=True,
            id=f"openassessment/{node.url_name}", visible=ctx.visible)

    # ------------------------------------------------------------- problems

    def _problem(self, node: _Node, where: str) -> list:
        root = copy.deepcopy(node.el)
        pid = node.url_name or "problem"
        title = self._name(node, "Problem")
        parents = _parents(root)

        has_script = False
        solutions: dict = {}  # response element (or None) -> html
        for el in list(root.iter()):
            if (el.tag not in _STRIP_TAGS and el.tag != "solution") or el not in parents:
                continue  # kept, or inside a block removed already
            if el.tag == "script" and "python" in (el.get("type") or "python").lower():
                has_script = True
            if el.tag == "solution":
                owner = next((a for a in self._ancestors(parents, el) if a.tag in _RESPONSE_TAGS), None)
                html = _EXPLANATION_HEAD.sub(r"\1", _inner(el)).strip()
                if html:
                    solutions[owner] = solutions.get(owner, "") + html
            _replace_with_text(parents, el, "")
            parents = _parents(root)
        # Hover-only clarifications read as part of the sentence: "formula (reminder) to find"
        for el in list(root.iter("clarification")):
            _replace_with_text(parents, el, html_lib.escape(f" ({_plain(el)})", quote=False))
            parents = _parents(root)

        responses = [r for r in root.iter() if r.tag in _RESPONSE_TAGS]
        responses = [r for r in responses if not any(p in responses for p in self._ancestors(parents, r))]

        weight = node.attrs.get("weight")
        if not responses:
            html = _inner(root)
            if not html.strip():
                return []
            return [ir.Question(type=ir.QType.DESCRIPTION, text=self.rich(html), title=title, id=pid)]

        if has_script and any("$" in (r.get("answer") or "") for r in responses if r.tag in _NATIVE_RESPONSES):
            return [ir.Question(type=ir.QType.UNSUPPORTED, text=self.rich(_inner(root)), title=title, id=pid,
                                source_type="python-script",
                                reason="answers are computed by a Python script (randomized problem)")]

        # Fill in the blanks: dropdowns inside running text or tables, or several inputs in one text.
        # A single text/number input after its prompt stays a native question (keeps tolerance, regex...).
        inline = [r for r in responses if parents.get(r) is not None and parents[r].tag in _INLINE_PARENTS]
        blocks = [next((a for a in self._ancestors(parents, r) if a.tag in _TEXT_BLOCKS), None) for r in inline]
        shared = any(b is not None and blocks.count(b) > 1 for b in blocks)
        # Blanks match their answer exactly: a pattern answer (type="regexp")
        # only keeps its meaning as a separate short answer question
        patterns = any(r.tag == "stringresponse" and "regexp" in (r.get("type") or "").lower().split()
                       for r in responses)
        if all(r.tag in _FILLABLE for r in responses) and not patterns and (
                any(r.tag == "optionresponse" for r in inline) or shared):
            cloze = self._cloze(root, parents, responses, title, pid)
            questions, owners = [cloze], {r: cloze for r in responses}
        else:
            pairs = self._split(root, responses, title, pid)
            questions, owners = [q for _r, q in pairs], dict(pairs)
        # Explanations: the response's own <solution>, else the problem's goes on the last question
        for owner, html in solutions.items():
            target = owners.get(owner) or questions[-1]
            target.general_feedback += html
        gradable = [q for q in questions if q.type not in (ir.QType.DESCRIPTION, ir.QType.UNSUPPORTED)]
        if weight not in (None, "", "null") and gradable:
            share = to_float(weight, 1.0) / len(gradable)
            for q in gradable:
                q.points = share
        return questions

    @staticmethod
    def _ancestors(parents: dict, el: Element):
        node = parents.get(el)
        while node is not None:
            yield node
            node = parents.get(node)

    def _cloze(self, root: Element, parents: dict, responses: list, title: str, pid: str) -> ir.Question:
        blanks = []
        for i, r in enumerate(responses, start=1):
            blanks.append(self._blank(r))
            _replace_with_text(parents, r, f"{{{{{i}}}}}")
            parents = _parents(root)
        return ir.Question(type=ir.QType.CLOZE, text=self.rich(_inner(root)), title=title, id=pid, blanks=blanks)

    def _blank(self, r: Element) -> ir.Blank:
        if r.tag == "optionresponse":
            choices, correct = self._option_choices(r)
            return ir.Blank(answers=correct, choices=choices)
        if r.tag == "numericalresponse":
            answers = self._numeric_answers(r)
            if answers:
                return ir.Blank(answers=[_fmt(answers[0].value)], numeric=answers[0])
            return ir.Blank(answers=[r.get("answer", "").strip()])
        return ir.Blank(answers=self._string_answers(r))

    def _split(self, root: Element, responses: list, title: str, pid: str) -> list:
        events: list = []
        resp_set = set(responses)

        def contains(el: Element) -> bool:
            return any(d in resp_set for d in el.iter())

        def walk(el: Element) -> None:
            if el in resp_set:
                events.append(("resp", el))
                return
            if not contains(el):
                events.append(("html", _outer(el)))
                return
            events.append(("html", html_lib.escape(el.text or "", quote=False)))
            for c in el:
                if isinstance(c.tag, str):
                    walk(c)
                events.append(("html", html_lib.escape(c.tail or "", quote=False)))

        events.append(("html", html_lib.escape(root.text or "", quote=False)))
        for c in root:
            if isinstance(c.tag, str):
                walk(c)
            events.append(("html", html_lib.escape(c.tail or "", quote=False)))

        pairs: list[tuple[Element, ir.Question]] = []
        buffer: list[str] = []
        for kind, value in events:
            if kind == "html":
                buffer.append(value)
                continue
            pairs.append((value, self._response(value, "".join(buffer))))
            buffer = []
        trailing = "".join(buffer)
        if trailing.strip():
            pairs[-1][1].text.html += trailing
        multi = len(pairs) > 1
        for i, (_r, q) in enumerate(pairs, start=1):
            q.id = f"{pid}:{i}" if multi else pid
            q.title = f"{title} ({i})" if multi else title
        return pairs

    def _response_text(self, r: Element, prefix: str) -> str:
        parts = [prefix, html_lib.escape(r.text or "", quote=False)]
        has_label = False
        for c in r:
            if c.tag == "label":
                has_label = True
                parts.append(f"<p>{_inner(c).strip()}</p>")
            elif c.tag == "description":
                parts.append(f"<p>{_inner(c).strip()}</p>")
            elif c.tag not in _CONTROL_TAGS:
                parts.append(_outer(c))
            parts.append(html_lib.escape(c.tail or "", quote=False))
        if not has_label:
            # Older problems put the label on the input itself
            for c in r.iter():
                label = c.get("label") if c is not r else None
                if label and not re.sub(r"<[^>]+>", "", prefix).strip():
                    parts.insert(1, f"<p>{html_lib.escape(label)}</p>")
                    break
        return "".join(parts)

    def _response(self, r: Element, prefix: str) -> ir.Question:
        tag = r.tag
        q = ir.Question(type=ir.QType.UNSUPPORTED, text=self.rich(self._response_text(r, prefix)))
        if tag in ("multiplechoiceresponse", "choiceresponse", "truefalseresponse"):
            group = r.find(".//choicegroup")
            if group is None:
                group = r.find(".//checkboxgroup")
            if group is None:
                group = r.find(".//radiogroup")
            q.type = ir.QType.MULTICHOICE
            q.multiple = tag != "multiplechoiceresponse"
            q.partial_credit = bool(re.search(r"edc|halves|ndc", r.get("partial_credit") or "", re.I))
            for ch in (group.findall("choice") if group is not None else []):
                ch = copy.deepcopy(ch)
                hints = ch.findall("choicehint")
                feedback = ""
                if hints:
                    chosen = next((h for h in hints if (h.get("selected") or "true").lower() == "true"), hints[0])
                    feedback = _plain(chosen)
                for h in hints:
                    ch.remove(h)
                q.choices.append(ir.Choice(text=self.rich(_inner(ch).strip() or html_lib.escape(ch.get("name", ""))),
                                           correct=(ch.get("correct") or "").strip().lower() == "true",
                                           feedback=feedback))
            if not q.choices:
                q.type, q.source_type, q.reason = ir.QType.UNSUPPORTED, tag, "no choices"
            elif not any(c.correct for c in q.choices):
                q.type, q.source_type, q.reason = ir.QType.UNSUPPORTED, tag, "no choice is marked correct"
        elif tag == "optionresponse":
            choices, correct = self._option_choices(r)
            q.type = ir.QType.MULTICHOICE
            q.choices = [ir.Choice(text=self.rich(html_lib.escape(c, quote=False)), correct=c in correct)
                         for c in choices]
            if len(r.findall(".//optioninput")) > 1:
                self.warn("A dropdown problem with several dropdowns in one response kept only the first one")
        elif tag == "stringresponse":
            q.type = ir.QType.SHORTANSWER
            q.answers = self._string_answers(r)
            tokens = (r.get("type") or "").lower().split()
            q.case_sensitive = "ci" not in tokens
            # edX answers are literal unless marked regexp: "*" is not a wildcard
            q.regex = "regexp" in tokens
            q.wildcard = False
        elif tag == "numericalresponse":
            answers = self._numeric_answers(r)
            if answers:
                q.type = ir.QType.NUMERICAL
                q.numeric = answers
            else:
                q.source_type, q.reason = tag, f"answer '{r.get('answer', '')}' is an expression, not a number"
        elif tag == "coderesponse":
            box = r.find(".//textbox")
            q.type = ir.QType.CODE
            q.code = ir.CodeSpec(
                language=((box.get("mode") if box is not None else "") or "python").lower(),
                starter_code=(r.findtext(".//codeparam/initial_display") or "").strip(),
                solution_code=(r.findtext(".//codeparam/answer_display") or "").strip(),
            )
        else:
            q.source_type = tag
            q.reason = _UNSUPPORTED_RESPONSES.get(tag, "unsupported problem type")
            if r.find(".//jsinput") is not None:
                q.reason = "JavaScript (jsinput) problem graded by a Python script"
        return q

    @staticmethod
    def _option_choices(r: Element) -> tuple[list[str], list[str]]:
        box = r.find(".//optioninput")
        if box is None:
            return [], []
        options = box.findall("option")
        if options:
            choices, correct = [], []
            for o in options:
                o = copy.deepcopy(o)
                for h in o.findall("optionhint"):
                    o.remove(h)
                label = _plain(o)
                choices.append(label)
                if (o.get("correct") or "").strip().lower() == "true":
                    correct.append(label)
            return choices, correct
        choices = _options(box.get("options", ""))
        right = (box.get("correct") or "").strip()
        return choices, [right] if right else []

    @staticmethod
    def _string_answers(r: Element) -> list[str]:
        answers = [r.get("answer", "")]
        for extra in r.findall("additional_answer"):
            answers.append(extra.get("answer") if extra.get("answer") is not None else (extra.text or ""))
        return [a.strip() for a in answers if a and a.strip()]

    @staticmethod
    def _numeric_answers(r: Element) -> list[ir.NumericAnswer]:
        tolerance_raw = ""
        for p in r.findall("responseparam"):
            if (p.get("type") or "") == "tolerance":
                tolerance_raw = (p.get("default") or "").strip()
        raws = [r.get("answer", "")] + [a.get("answer") or a.text or "" for a in r.findall("additional_answer")]
        out = []
        for raw in raws:
            raw = (raw or "").strip()
            m = _RANGE.match(raw)
            if m:
                lo, hi = sorted((float(m.group(1)), float(m.group(2))))
                out.append(ir.NumericAnswer(value=(lo + hi) / 2, tolerance=(hi - lo) / 2))
                continue
            value = _number(raw)
            if value is None:
                continue
            tolerance = 0.0
            if tolerance_raw.endswith("%"):
                tolerance = abs(value) * abs(to_float(tolerance_raw[:-1], 0.0)) / 100
            elif tolerance_raw:
                tolerance = abs(_number(tolerance_raw) or 0.0)
            out.append(ir.NumericAnswer(value=value, tolerance=tolerance))
        return out

    # ------------------------------------------------------------ unit items

    def _unit_items(self, units: list, ctx: _Ctx, seq_title: str, seq_id: str = "",
                    time_limit: Optional[int] = None) -> list:
        if ctx.graded and units and all(all(c.kind == "problem" for c in u.comps) for u in units) \
                and any(_gradable(c) for u in units for c in u.comps):
            # One assignment for the subsection. Staff-only or draft units
            # stay out of it (published with the rest they would leak their
            # questions): they become unpublished assignments of their own.
            shown = [u for u in units if u.visible] or units
            hidden = [u for u in units if u not in shown]
            problems = [c.problem for u in shown for c in u.comps]
            items = [self._assessment(seq_title, problems, "", ctx, seq_id or shown[0].id,
                                      any(u.visible for u in shown), time_limit)]
            for u in hidden:
                items.extend(self._one_unit(u, ctx, time_limit))
            return items
        items: list = []
        for u in units:
            items.extend(self._one_unit(u, ctx, time_limit))
        return items

    def _one_unit(self, unit: _Unit, ctx: _Ctx, time_limit: Optional[int]) -> list:
        standalone = [c for c in unit.comps if c.kind == "item"]
        content = [c for c in unit.comps if c.kind != "item"]
        out: list = []
        if ctx.graded and any(_gradable(c) for c in content):
            # Content before the first problem: the assignment intro (HTML only) or a page of its own.
            # After it, HTML stays next to the questions and other media goes to a page after.
            first = next(i for i, c in enumerate(content) if c.kind == "problem")
            before, after = content[:first], content[first:]
            intro = ""
            if all(isinstance(c.part, ir.HtmlPart) for c in before):
                intro = "".join(c.part.content.html for c in before)
            elif before:
                out.append(self._page_or_media(_Unit(unit.title, before, f"{unit.id}:intro", unit.visible)))
            problems, rest = [], []
            for c in after:
                if c.kind == "problem":
                    problems.append(c.problem)
                elif isinstance(c.part, ir.HtmlPart):
                    if _has_content(c.part.content.html):
                        problems.append(_Problem(title="", questions=[ir.Question(
                            type=ir.QType.DESCRIPTION, text=c.part.content)]))
                else:
                    rest.append(c)
            out.append(self._assessment(unit.title, problems, intro, ctx, unit.id, unit.visible, time_limit))
            if rest:
                out.append(self._page_or_media(_Unit(unit.title, rest, f"{unit.id}:after", unit.visible)))
        elif content:
            out.append(self._page_or_media(unit, content))
        out = [i for i in out if i is not None]
        for c in standalone:
            item = c.item
            if not unit.visible:
                item.visible = False
            item.title = item.title or unit.title or _DEFAULT_TITLES.get(c.source, "Activity")
            out.append(item)
        return out

    def _page_or_media(self, unit: _Unit, content: Optional[list] = None):
        content = unit.comps if content is None else content
        if len(content) == 1 and content[0].kind == "part" and isinstance(content[0].part, ir.MediaPart):
            part = content[0].part
            if part.kind == ir.MediaKind.VIDEO:
                return ir.VideoItem(title=unit.title or part.title or "Video", asset=part.asset, url=part.url,
                                    id=unit.id, visible=unit.visible)
            if part.kind == ir.MediaKind.PDF and part.asset is not None:
                return ir.DocumentItem(title=unit.title or part.title or "Document", asset=part.asset, id=unit.id,
                                       visible=unit.visible)
        parts: list = []
        for c in content:
            if c.kind == "part":
                parts.append(c.part)
                continue
            questions = c.problem.questions
            if all(q.type == ir.QType.UNSUPPORTED for q in questions):
                # Keep what the learner reads (prompt, explanation); only the graded input is lost
                reasons = sorted({q.reason for q in questions if q.reason})
                kinds = sorted({q.source_type for q in questions if q.source_type})
                text = "".join(q.text.html + q.general_feedback for q in questions)
                kept = _has_content(text)
                self.skip(c.problem.title or "Problem", _kind_label(kinds),
                          "no interactive equivalent" + (f" ({'; '.join(reasons)})" if reasons else "")
                          + ("; its text was kept" if kept else ""))
                if kept:
                    title = f"<h3>{html_lib.escape(c.problem.title)}</h3>" if c.problem.title else ""
                    parts.append(ir.HtmlPart(self.rich(title + text)))
                continue
            parts.append(ir.InlineQuizPart(questions, title=c.problem.title))
        if not parts:
            return None
        return ir.Page(title=unit.title, parts=parts, id=unit.id, visible=unit.visible)

    def _assessment(self, title: str, problems: list, intro: str, ctx: _Ctx, aid: str,
                    visible: bool, time_limit: Optional[int]) -> ir.Assessment:
        questions = [q for p in problems for q in p.questions]
        real = [p for p in problems if p.title or p.id]
        attempts = [p.max_attempts for p in real]
        max_attempts = 0 if (not attempts or any(a is None for a in attempts)) else max(attempts)
        shows = [p.showanswer for p in real]
        return ir.Assessment(
            title=title or "Assessment", questions=questions, intro=self.rich(intro), due_date=ctx.due,
            max_attempts=max_attempts, pass_percent=self.pass_percent,
            show_correct_answers=not shows or any(s != "never" for s in shows), graded=True,
            time_limit_minutes=time_limit, id=aid, visible=visible and ctx.visible)

    # ---------------------------------------------------------- course pages

    def _course_pages(self, overview: str) -> ir.Section:
        section = ir.Section(title="Course pages", id="course-pages")
        if overview.strip():
            section.items.append(ir.Page(title="About this course", parts=[ir.HtmlPart(self.rich(overview))],
                                         id="about/overview"))
        course_meta = self.policy.get(f"course/{self.run}") if isinstance(self.policy, dict) else None
        tabs = course_meta.get("tabs") if isinstance(course_meta, dict) else None
        seen = set()
        if isinstance(tabs, list):
            for tab in tabs:
                if not isinstance(tab, dict) or tab.get("type") != "static_tab":
                    continue
                slug = str(tab.get("url_slug") or "")
                path = self._file(f"tabs/{slug}.html") if slug else None
                if not path:
                    self.warn(f"Static page '{tab.get('name') or slug}' is missing from the export")
                    continue
                seen.add(os.path.realpath(path))
                hidden = _flag(tab.get("is_hidden")) or _flag(tab.get("course_staff_only"))
                self._add_page(section, str(tab.get("name") or slug_title(slug)), _read_text(path),
                               f"tabs/{slug}", not hidden)
        tabs_dir = os.path.join(self.root, "tabs")
        if os.path.isdir(tabs_dir):
            for name in sorted(os.listdir(tabs_dir)):
                full = os.path.join(tabs_dir, name)
                if name.lower().endswith(".html") and os.path.realpath(full) not in seen and os.path.isfile(full):
                    self._add_page(section, slug_title(name), _read_text(full), f"tabs/{name}", True)
        handouts = _read_text(self._file("info/handouts.html"))
        if re.sub(r"<[^>]+>|\s", "", handouts):
            self._add_page(section, "Course handouts", handouts, "info/handouts", True)
        updates = _json(_read_text(self._file("info/updates.items.json")), None)
        html = ""
        if isinstance(updates, list):
            for u in updates:
                if not isinstance(u, dict) or u.get("status") == "deleted" or not u.get("content"):
                    continue
                date = html_lib.escape(str(u.get("date") or ""))
                html += (f"<h3>{date}</h3>" if date else "") + str(u["content"])
        else:
            html = _read_text(self._file("info/updates.html"))
        if re.sub(r"<[^>]+>|\s", "", html):
            self._add_page(section, "Course updates", html, "info/updates", True)
        return section

    def _add_page(self, section: ir.Section, title: str, html: str, pid: str, visible: bool) -> None:
        if html.strip():
            section.items.append(ir.Page(title=title, parts=[ir.HtmlPart(self.rich(html))], id=pid,
                                         visible=visible))


def _has_content(html: str) -> bool:
    if re.search(r"<(img|iframe|video|audio|table|object|embed)\b", html, re.I):
        return True
    return bool(re.sub(r"<[^>]+>|&nbsp;|\s", "", html))


def _gradable(comp: _Comp) -> bool:
    return comp.kind == "problem" and any(q.type not in (ir.QType.DESCRIPTION, ir.QType.UNSUPPORTED)
                                          for q in comp.problem.questions)


def _fmt(v: float) -> str:
    return str(int(v)) if float(v).is_integer() else repr(float(v))
