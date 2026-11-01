"""
Canvas reader (.imscc from "Export course content").

A Canvas export is a Common Cartridge with Canvas-only metadata on the side:

* ``course_settings/course_settings.xml``: title, course code, card image
* ``course_settings/module_meta.xml``: modules with their items, positions,
  publish state and content types (the manifest organization mirrors it
  without the publish state, external URLs or tools)
* ``course_settings/syllabus.html``: the syllabus page
* ``wiki_content/*.html``: pages (``<meta name="workflow_state">``, front page)
* ``<id>/assignment_settings.xml`` + ``<id>/<slug>.html``: assignments
* ``<id>/assessment_meta.xml`` + ``non_cc_assessments/<id>.xml.qti``: classic
  quizzes in Canvas's QTI dialect (``question_type`` metadata)
* ``web_resources/``: course files, which ``$IMS-CC-FILEBASE$`` points at;
  ``web_resources/media_objects/`` holds media recordings

The generic cartridge machinery lives in :mod:`.common_cartridge`; this module
adds the Canvas metadata and the question dialect fixes.
"""

from __future__ import annotations

import html as html_lib
import os
import posixpath
import re
from typing import Optional
from urllib.parse import quote, unquote
from xml.etree.ElementTree import Element

from .. import ir, qti
from ..html_to_tiptap import html_to_text, media_kind_for
from ..report import error_text
from ..xmlutil import MAX_TEXT_BYTES, XmlError, attr, children, text, to_bool, to_float, to_int
from .common import FileIndex, iso_from_text
from .common_cartridge import (
    CartridgeReader,
    Manifest,
    Resource,
    find_manifest,
    link_item,
    max_attempts_from,
    own_qti_metadata,
    parse_manifest,
    parse_xml_file as parse_file,
    read_html,
    resource_files,
    try_parse_xml_file as try_parse_file,
    unwrap_internal_links,
)

KEY = "canvas"
LABEL = "Canvas"

SETTINGS_DIR = "course_settings"
WEB_RESOURCES = "web_resources"
QTI_DIR = "non_cc_assessments"

_NO_ANSWER_TEXT = "no answer text provided."
# New Quizzes types with no LearnHouse equivalent
_UNSUPPORTED_TYPES = {
    "categorization_question": "categorization questions have no LearnHouse equivalent",
    "hot_spot_question": "hot spot questions have no LearnHouse equivalent",
    "hotspot_question": "hot spot questions have no LearnHouse equivalent",
    "stimulus": "stimulus blocks are not migrated",
    "error": "Canvas exported this question as broken (question type 'Error'); it has no answers",
}
# CC assignment extension submission formats -> Canvas submission types
_CC_FORMATS = {"file": "online_upload", "text": "online_text_entry", "html": "online_text_entry",
               "url": "online_url"}
# module_meta.xml content types -> item kinds used in the report
_CONTENT_KINDS = {"wikipage": "page", "assignment": "assignment", "quizzes::quiz": "quiz",
                  "discussiontopic": "discussion", "attachment": "file"}
_UNGRADED_QUIZ_TYPES = {"practice_quiz", "survey", "graded_survey"}

# $IMS-CC-FILEBASE$/path (group 1) or $CANVAS_*_REFERENCE$/file_ref/<id> (group 2)
_FILE_REF_RE = re.compile(
    r"""(?:\$|%24)IMS[-_]CC[-_]FILEBASE(?:\$|%24)/([^"'<>?#]+)"""
    r"""|(?:\$|%24)CANVAS_(?:OBJECT|COURSE)_REFERENCE(?:\$|%24)/(?:file_ref|attachments)/([^/"'<>?#\s]+)"""
)
_MEDIA_ID_RE = re.compile(r"media_(?:objects|comments?)(?:_iframe)?/(m-[A-Za-z0-9_]+)|\b(m-[A-Za-z0-9]{16,})\b")
_MEDIA_IFRAME_RE = re.compile(r"<iframe\b[^>]*>(?:.*?</iframe\s*>)?", re.S | re.I)
_SRC_RE = re.compile(r"""\b(src|data-media-id|data-media-type)\s*=\s*(?:"([^"]*)"|'([^']*)')""", re.I)


def _settings_file(root: str, name: str) -> Optional[str]:
    folder = None
    try:
        for entry in os.listdir(root):
            if entry.lower() == SETTINGS_DIR and os.path.isdir(os.path.join(root, entry)):
                folder = os.path.join(root, entry)
                break
    except OSError:
        return None
    if folder is None:
        return None
    for entry in os.listdir(folder):
        if entry.lower() == name:
            return os.path.join(folder, entry)
    return None


def detect(root: str) -> int:
    if _settings_file(root, "canvas_export.txt") or _settings_file(root, "course_settings.xml"):
        return 95
    return 0


def read(root: str) -> ir.Course:
    return CanvasReader(root).read()


def _split(value: str) -> list[str]:
    return [v.strip().lower() for v in (value or "").split(",") if v.strip()]


def _plain(rich_html: str) -> str:
    return html_to_text(rich_html).strip()


class CanvasReader(CartridgeReader):
    source_key = KEY
    filebase_dirs = (WEB_RESOURCES,)

    def __init__(self, root: str):
        root = os.path.realpath(root)
        index = FileIndex(root)
        manifest = parse_manifest(root) if find_manifest(root) else Manifest(root=root, path="")
        super().__init__(root, manifest=manifest, index=index)
        self._banks: dict[str, Optional[Element]] = {}
        self._media_cache: dict[str, Optional[ir.Asset]] = {}
        self._all_files: Optional[list[str]] = None
        self._image_ref = ""
        # module_meta.xml and the manifest organization share item identifiers
        self._org_refs = {i.identifier: i.identifierref for i in self.manifest.iter_items() if i.identifierref}

    # ----------------------------------------------------------------- course

    def _sidecar(self, path: Optional[str]) -> Optional[Element]:
        """A Canvas metadata file: None when the export has none. A corrupt one
        is reported (the item silently degrades otherwise) and then treated as absent."""
        if not path:
            return None
        try:
            return parse_file(path)
        except (XmlError, OSError) as e:
            rel = os.path.relpath(path, self.root).replace(os.sep, "/")
            self.warn(f"Could not read '{rel}': {error_text(e)}")
            return None

    def _try_read_html(self, full: str, title: str):
        """``read_html`` for pages read outside ``_safe_items``; None (reported) when unreadable."""
        try:
            return read_html(full)
        except (XmlError, OSError) as e:
            self.warn(f"Could not read '{title}': {error_text(e)}")
            return None

    def read(self) -> ir.Course:
        settings = self._sidecar(_settings_file(self.root, "course_settings.xml"))
        m = self.manifest
        title = text(settings, "title") or m.title or "Imported course"
        course = ir.Course(title=title, source=KEY, id=attr(settings, "identifier") or m.identifier,
                           short_name=text(settings, "course_code"), language=text(settings, "locale") or m.language)
        description = text(settings, "public_description")
        if description:
            course.summary = ir.RichText(description if "<" in description else html_lib.escape(description))
        course.thumbnail = self._course_image(settings)

        modules_el = self._sidecar(_settings_file(self.root, "module_meta.xml"))
        modules = sorted(children(modules_el, "module"), key=lambda el: to_int(text(el, "position"), 0))
        if modules:
            course.sections = [s for module in modules for s in self._module_sections(module)]
        elif m.items:
            course.sections = self.sections(title)
        else:
            course.sections = self._sections_by_type()

        overview = self._overview_items()
        if overview:
            course.sections.insert(0, ir.Section(title="Course overview", items=overview, id="course-overview"))
        if not any(sec.items for sec in course.sections):
            course.sections.extend(self.bank_sections())
        else:
            course.sections.extend(self.bank_sections(used=set(self._banks)))
        course.warnings = list(self.warnings)
        course.skipped = list(self.skipped)
        return course

    def _course_image(self, settings: Optional[Element]) -> Optional[ir.Asset]:
        if settings is None:
            return None
        ref = text(settings, "image_identifier_ref")
        self._image_ref = ref
        res = self.manifest.resource(ref) if ref else None
        if res is not None and res.main_file:
            full = self.index.get(res.main_file)
            if full:
                return self.index.asset(full)
        if ref:
            self.skip("Course card image", "image", "not in the export")
        # An image_url is a web address, not a file of the export: nothing to import
        return None

    def _overview_items(self) -> list[ir.Item]:
        items: list[ir.Item] = []
        syllabus = _settings_file(self.root, "syllabus.html")
        if syllabus:
            doc = self._try_read_html(syllabus, "Syllabus")
            if doc is None:
                self.skip("Syllabus", "page", "unreadable in the export")
            elif _plain(doc.body) or re.search(r"<(img|iframe|video|audio)\b", doc.body, re.I):
                items.append(ir.Page(title="Syllabus", parts=[ir.HtmlPart(self.rich(doc.body, SETTINGS_DIR))],
                                     id="syllabus"))
        for res in self.manifest.resources.values():
            if res.identifier in self.used or not res.href.lower().startswith("wiki_content/"):
                continue
            if self._is_front_page(res):
                items.extend(self.item_for_resource(res, "", res.identifier, True))
                self.used.add(res.identifier)
        return items

    def _is_front_page(self, res: Resource) -> bool:
        full = self.index.get(res.href) if res.href.lower().startswith("wiki_content/") else None
        if not full:
            return False
        try:
            doc = read_html(full)
        except (XmlError, OSError):
            return False  # an ordinary page then: _safe_items reports the unreadable file once
        return to_bool(doc.meta.get("front_page"), False)

    # ---------------------------------------------------------------- modules

    def _module_sections(self, module: Element) -> list[ir.Section]:
        title = text(module, "title") or "Untitled module"
        visible = text(module, "workflow_state") != "unpublished"
        sections = [ir.Section(title=title, id=attr(module, "identifier"), visible=visible)]
        items = sorted(children(module.find("items"), "item"), key=lambda el: to_int(text(el, "position"), 0))
        for el in items:
            ctype = text(el, "content_type")
            item_title = text(el, "title")
            if ctype == "ContextModuleSubHeader":
                if item_title:
                    item_visible = visible and text(el, "workflow_state") != "unpublished"
                    sections.append(ir.Section(title=f"{title} › {item_title}", id=attr(el, "identifier"),
                                               visible=item_visible))
                continue
            sections[-1].items.extend(self._module_item(el, visible))
        return [s for i, s in enumerate(sections) if i == 0 or s.items]

    def _module_item(self, el: Element, module_visible: bool) -> list[ir.Item]:
        ctype = text(el, "content_type")
        title = text(el, "title")
        ident = attr(el, "identifier")
        visible = module_visible and text(el, "workflow_state") != "unpublished"
        url = text(el, "url")
        if ctype == "ExternalUrl":
            if not url:
                return [ir.UnsupportedItem(title=title or "Link", kind="link", reason="link has no URL", id=ident)]
            return [link_item(url, title, ident, visible)]
        if ctype == "ContextExternalTool":
            reason = "external tool (LTI) links are not migrated"
            return [ir.UnsupportedItem(title=title or "External tool", kind="LTI tool",
                                       reason=f"{reason}; launch URL: {url}" if url else reason, id=ident)]
        ref = text(el, "identifierref") or self._org_refs.get(ident, "")
        res = self.manifest.resource(ref)
        if res is None and ctype == "Quizzes::Quiz" and self._quiz_files(ref)[1]:
            res = Resource(identifier=ref, type="imsqti_xmlv1p2/imscc_xmlv1p1/assessment")
        if res is None:
            kind = _CONTENT_KINDS.get(ctype.lower(), ctype.lower() or "item")
            self.skip(title or ref, kind, "missing from the export")
            return []
        self.used.add(res.identifier)
        return self._safe_items(res, title, ident, visible)

    def _sections_by_type(self) -> list[ir.Section]:
        """No modules: group the course content by type, as Canvas lists it."""
        groups: dict[str, list[tuple[int, Resource]]] = {"Pages": [], "Assignments": [], "Quizzes": [],
                                                        "Discussions": [], "Files": []}
        referenced = self._referenced_files()
        for res in self.manifest.resources.values():
            if res.identifier in self.used:
                continue
            if res.kind == "webcontent" and res.href.lower().startswith("wiki_content/"):
                if not self._is_front_page(res):  # the overview section shows it
                    groups["Pages"].append((0, res))
            elif self._is_quiz(res):
                groups["Quizzes"].append((0, res))
            elif self._assignment_settings_path(res) or res.kind == "assignment":
                settings = self._sidecar(self._assignment_settings_path(res))
                if "online_quiz" in _split(text(settings, "submission_types")):
                    continue
                groups["Assignments"].append((to_int(text(settings, "position"), 0), res))
            elif res.kind == "discussion" and not self._is_announcement(res):
                groups["Discussions"].append((0, res))
            elif (res.kind == "webcontent" and res.main_file.lower().startswith(f"{WEB_RESOURCES}/")
                  and res.main_file.lower() not in referenced and res.identifier != self._image_ref):
                # Course files nothing links to: without modules they are content of their own
                groups["Files"].append((0, res))
        sections = []
        for name, entries in groups.items():
            section = ir.Section(title=name, id=f"type:{name.lower()}")
            for _pos, res in sorted(entries, key=lambda e: (e[0], e[1].main_file.lower() if name == "Files" else "")):
                self.used.add(res.identifier)
                section.items.extend(self._safe_items(res, "", res.identifier, True))
            if section.items:
                sections.append(section)
        return sections

    def _referenced_files(self) -> set[str]:
        """Package paths (lowercase) of course files linked from any document."""
        found: set[str] = set()
        for dirpath, _dirs, files in os.walk(self.root):
            for f in files:
                if not f.lower().endswith((".html", ".htm", ".xml", ".qti")):
                    continue
                try:
                    path = os.path.join(dirpath, f)
                    if os.path.getsize(path) > MAX_TEXT_BYTES:
                        continue
                    with open(path, encoding="utf-8", errors="replace") as fh:
                        body = html_lib.unescape(fh.read())
                except OSError:  # pragma: no cover - unreadable file in the export
                    continue
                for m in _MEDIA_ID_RE.finditer(body):
                    media = self.media_asset(m.group(0))
                    if media is not None:
                        found.add(os.path.relpath(media.path, self.root).replace(os.sep, "/").lower())
                for m in _FILE_REF_RE.finditer(body):
                    if m.group(1):
                        found.add(f"{WEB_RESOURCES}/{unquote(m.group(1)).split('?')[0]}".lower())
                    else:
                        res = self.manifest.resource(unquote(m.group(2)))
                        if res is not None:
                            found.add(res.main_file.lower())
        return found

    # -------------------------------------------------------------- resources

    def item_for_resource(self, res: Resource, title: str, ident: str, visible: bool) -> list[ir.Item]:
        if self._is_quiz(res):
            return self._quiz_items(res.identifier, title, ident, visible)
        if self._assignment_settings_path(res) or res.kind == "assignment":
            return self._assignment_items(res, title, ident, visible)
        if res.kind == "discussion":
            return self._discussion_items(res, title, ident, visible)
        if res.kind == "webcontent" and res.href.lower().startswith("wiki_content/"):
            return self._wiki_items(res, title, ident, visible)
        return super().item_for_resource(res, title, ident, visible)

    def _wiki_items(self, res: Resource, title: str, ident: str, visible: bool) -> list[ir.Item]:
        full = self.index.get(res.href)
        if not full:
            self.skip(title or res.href, "page", "missing from the export")
            return []
        doc = read_html(full)
        if doc.meta.get("workflow_state", "").lower() == "unpublished":
            visible = False
        return [ir.Page(title=title or doc.title or res.identifier,
                        parts=[ir.HtmlPart(self.rich(doc.body, posixpath.dirname(res.href)))], id=ident,
                        visible=visible)]

    # ------------------------------------------------------------ discussions

    def _topic_meta(self, res: Resource) -> Optional[Element]:
        for dep in res.dependencies:
            dep_res = self.manifest.resource(dep)
            if dep_res is None:
                continue
            for rel in resource_files(self.manifest, dep_res, include_dependencies=False):
                el = try_parse_file(self.index.get(rel) or "")
                if el is not None and el.tag == "topicMeta":
                    return el
        return None

    def _is_announcement(self, res: Resource) -> bool:
        return text(self._topic_meta(res), "type") == "announcement"

    def _discussion_items(self, res: Resource, title: str, ident: str, visible: bool) -> list[ir.Item]:
        meta = self._topic_meta(res)
        if meta is not None:
            if text(meta, "workflow_state") == "unpublished":
                visible = False
        items = self.discussion_items(res, title, ident, visible)
        return items

    # ------------------------------------------------------------ assignments

    def _assignment_settings_path(self, res: Resource) -> Optional[str]:
        for rel in res.files + ([res.href] if res.href else []):
            if posixpath.basename(rel).lower() == "assignment_settings.xml":
                return self.index.get(rel)
        return self.index.get(f"{res.identifier}/assignment_settings.xml")

    def _assignment_items(self, res: Resource, title: str, ident: str, visible: bool) -> list[ir.Item]:
        settings = self._sidecar(self._assignment_settings_path(res))
        html_rel = next((f for f in [res.href] + res.files
                         if f and f.lower().endswith((".html", ".htm"))), "")
        instructions = ir.RichText()
        cc_formats: list[str] = []
        if html_rel and self.index.get(html_rel):
            instructions = self.rich(read_html(self.index.get(html_rel)).body, posixpath.dirname(html_rel))
        if settings is None and res.kind == "assignment":
            # CC 1.3 assignment extension, Canvas settings embedded in <extensions>
            full = self.index.get(res.main_file) if res.main_file.lower().endswith(".xml") else None
            full = full or next((self.index.get(f) for f in res.files
                                 if f.lower().endswith(".xml") and self.index.get(f)), None)
            el = self._sidecar(full)
            exts = el.find("extensions") if el is not None else None
            settings = next((c for c in exts if c.tag == "assignment"), None) if exts is not None else None
            if settings is None:
                return self.assignment_items(res, title, ident, visible)
            cc_formats = [_CC_FORMATS.get(attr(f, "type").lower(), "") for f in el.iter("format")]
            if instructions.is_empty():
                text_el = el.find("text")
                body = (text_el.text or "") if text_el is not None else ""
                if text_el is not None and attr(text_el, "texttype", "text/plain") != "text/html":
                    body = html_lib.escape(body)
                rel_dir = os.path.relpath(os.path.dirname(full), self.root).replace(os.sep, "/")
                instructions = self.rich(body, "" if rel_dir == "." else rel_dir)
        if settings is None:
            return super().webcontent_items(res, title, ident, visible)

        title = title or text(settings, "title") or "Assignment"
        if text(settings, "workflow_state") == "unpublished":
            visible = False
        sub_types = _split(text(settings, "submission_types")) or [f for f in cc_formats if f]
        quiz_ref = text(settings, "quiz_identifierref")
        if quiz_ref or "online_quiz" in sub_types:
            return self._quiz_items(quiz_ref or res.identifier, title, ident, visible)
        if "external_tool" in sub_types:
            if self._quiz_files(res.identifier)[1]:
                return self._quiz_items(res.identifier, title, ident, visible)
            url = text(settings, "external_tool_url") or text(settings.find("external_tool_tag_attributes"), "url")
            reason = "external tool (LTI) assignments are not migrated"
            if url:
                reason += f"; launch URL: {url}"
            return [ir.UnsupportedItem(title=title, kind="LTI tool", reason=reason, id=ident)]

        points = to_float(text(settings, "points_possible"), 0.0)
        grading_type = text(settings, "grading_type").lower()
        graded = grading_type != "not_graded"
        allow_file = bool({"online_upload", "media_recording"} & set(sub_types))
        allow_text = bool({"online_text_entry", "online_url"} & set(sub_types))
        if not allow_file and not allow_text:
            if not graded or points <= 0:
                # Nothing to hand in and nothing to grade: the instructions are the content
                return [ir.Page(title=title, parts=[ir.HtmlPart(instructions)], id=ident, visible=visible)]
            # Handed in on paper or not at all: learners upload a file instead.
            # URL and media-recording submissions, and pass/fail grading, also
            # become file submissions graded as a percentage (documented differences)
            allow_file = True
        return [ir.AssignmentItem(
            title=title, instructions=instructions, due_date=iso_from_text(text(settings, "due_at")),
            allow_file=allow_file, allow_text=allow_text, points=points or None, graded=graded, id=ident,
            visible=visible,
        )]

    # ---------------------------------------------------------------- quizzes

    def _quiz_files(self, quiz_id: str) -> tuple[Optional[str], Optional[str]]:
        """(assessment_meta.xml, QTI file) for a quiz identifier.

        Canvas writes the questions to ``non_cc_assessments/<id>.xml.qti``;
        QTI-only exports keep them next to the meta file instead.
        """
        if not quiz_id:
            return None, None
        meta = self.index.get(f"{quiz_id}/assessment_meta.xml")
        qti_file = self.index.get(f"{QTI_DIR}/{quiz_id}.xml.qti") or self.index.get(f"{QTI_DIR}/{quiz_id}.xml")
        res = self.manifest.resource(quiz_id)
        if res is not None and res.kind == "assessment" and qti_file is None:
            for rel in resource_files(self.manifest, res, include_dependencies=False):
                if rel.lower().endswith((".xml", ".qti")) and posixpath.basename(rel).lower() != "assessment_meta.xml":
                    qti_file = self.index.get(rel)
                    if qti_file:
                        break
        return meta, qti_file

    def _is_quiz(self, res: Resource) -> bool:
        if res.kind == "assessment":
            return True
        # Question banks also live in non_cc_assessments but have no assessment_meta.xml
        meta, qti_file = self._quiz_files(res.identifier)
        return meta is not None and qti_file is not None

    def _quiz_items(self, quiz_id: str, title: str, ident: str, visible: bool) -> list[ir.Item]:
        meta_path, qti_path = self._quiz_files(quiz_id)
        meta = self._sidecar(meta_path)
        title = title or text(meta, "title") or "Quiz"
        if qti_path is None:
            return [ir.UnsupportedItem(title=title, kind="quiz", reason="quiz questions missing from the export",
                                       id=ident)]
        root = parse_file(qti_path)
        assessment_el = next(root.iter("assessment"), None)
        if assessment_el is None:
            return [ir.UnsupportedItem(title=title, kind="quiz", reason="no QTI assessment in the quiz file",
                                       id=ident)]
        resolve = self.resolver_for(posixpath.dirname(os.path.relpath(qti_path, self.root).replace(os.sep, "/")))
        questions = self._questions(assessment_el, resolve, title)
        qmeta = own_qti_metadata(assessment_el)

        assignment = meta.find("assignment") if meta is not None else None
        quiz_type = text(meta, "quiz_type").lower()
        # A graded quiz's publish state lives on its assignment; ``available``
        # only speaks for quizzes without one (practice quizzes, surveys)
        if assignment is not None and text(assignment, "workflow_state"):
            if text(assignment, "workflow_state") == "unpublished":
                visible = False
        elif meta is not None and text(meta, "available") == "false":
            visible = False
        attempts = text(meta, "allowed_attempts") or qmeta.get("cc_maxattempts", "")
        time_limit = to_int(text(meta, "time_limit") or qmeta.get("qmd_timelimit"), 0)
        intro_html = text(meta, "description")
        empty_reason = "the quiz has no questions in the export"
        if attr(assessment_el, "external_assignment_id"):
            empty_reason += " (New Quizzes are exported without their questions)"
        return [self.finish_assessment(ir.Assessment(
            title=title,
            questions=questions,
            intro=self.rich(intro_html, posixpath.dirname(os.path.relpath(meta_path or qti_path, self.root))),
            due_date=iso_from_text(text(meta, "due_at") or text(assignment, "due_at")),
            max_attempts=max_attempts_from(attempts),
            show_correct_answers=to_bool(text(meta, "show_correct_answers"), False),
            graded=quiz_type not in _UNGRADED_QUIZ_TYPES,
            time_limit_minutes=time_limit if time_limit > 0 else None,
            shuffle=to_bool(text(meta, "shuffle_answers"), False) or to_bool(text(meta, "shuffle_questions"), False),
            id=ident or quiz_id,
            visible=visible,
        ), empty_reason)]

    def bank_sources(self) -> list[tuple[str, str, str]]:
        out = []
        for res in self.manifest.resources.values():
            full = self.index.get(res.main_file) if res.main_file.lower().startswith(f"{QTI_DIR}/") else None
            if full and not self._is_quiz(res):
                out.append((res.identifier, full, QTI_DIR))
        return out

    def bank_question(self, item: Element, resolve: ir.Resolver) -> ir.Question:
        return self._question(item, resolve)

    def _bank(self, ident: str) -> Optional[Element]:
        if ident not in self._banks:
            path = self.index.get(f"{QTI_DIR}/{ident}.xml.qti") or self.index.get(f"{QTI_DIR}/{ident}.xml")
            self._banks[ident] = self._sidecar(path)
        return self._banks[ident]

    def _questions(self, assessment_el: Element, resolve: ir.Resolver, quiz_title: str) -> list[ir.Question]:
        """Questions in document order, question groups and linked banks included."""
        out: list[ir.Question] = []

        def walk(node: Element, points: Optional[float]):
            for child in node:
                if child.tag == "item":
                    q = self._question(child, resolve)
                    if points:
                        q.points = points
                    out.append(q)
                elif child.tag == "section":
                    group(child)

        def group(section: Element):
            selection = section.find("selection_ordering/selection")
            points = to_float(text(selection, "selection_extension/points_per_item"), 0.0) if selection is not None \
                else 0.0
            bank_ref = text(selection, "sourcebank_ref") if selection is not None else ""
            if bank_ref:
                bank = self._bank(bank_ref)
                if bank is None:
                    self.warn(f"{quiz_title}: question bank '{bank_ref}' is not in the export")
                else:
                    walk(next(bank.iter("objectbank"), bank), points or None)
            # A group drawing N of its questions at random: all of them are imported
            walk(section, points or None)

        walk(assessment_el, None)
        return out

    def _question(self, el: Element, resolve: ir.Resolver) -> ir.Question:
        q = qti.parse_item(el, resolve, type_hook=_type_hook)
        label = q.source_type
        if label in _UNSUPPORTED_TYPES:
            q.type = ir.QType.UNSUPPORTED
            q.reason = _UNSUPPORTED_TYPES[label]
            return q
        if label == "fill_in_multiple_blanks_question":
            # Free-text gaps: the labels are accepted spellings, never a dropdown
            for blank in q.blanks:
                blank.choices = []
        if q.choices:
            # Canvas pads answer lists with empty / "No answer text provided." options
            q.choices = [c for c in q.choices if c.correct or _has_content(c.text.html)] or q.choices
        return q

    # ------------------------------------------------------------------ HTML

    def prepare_html(self, source_html: str, doc_dir: str) -> str:
        source_html = self.unwrap_dead_links(unwrap_internal_links(source_html), doc_dir)
        if "<iframe" not in source_html.lower():
            return source_html
        return _MEDIA_IFRAME_RE.sub(lambda m: self._media_iframe(m.group(0), doc_dir), source_html)

    def _media_iframe(self, tag: str, doc_dir: str) -> str:
        attrs = {k.lower(): html_lib.unescape(a or b or "") for k, a, b in _SRC_RE.findall(tag.split(">", 1)[0])}
        src = attrs.get("src", "").strip()
        if re.match(r"^(https?:)?//", src, re.I):
            return tag  # a web embed, handled by the converter
        media_id = attrs.get("data-media-id", "")
        asset = self.media_asset(media_id or src) or (self.resolver_for(doc_dir)(src) if src else None)
        if asset is None:
            self.skip(unquote(media_id or src)[:120], "file", "not in the export")
            return "<p><em>[Media not included in the export]</em></p>"
        kind = media_kind_for(asset)
        hint = (attrs.get("data-media-type") or "").lower() or ("audio" if "type=audio" in src.lower() else "")
        tag_name = "audio" if (kind == ir.MediaKind.AUDIO or hint == "audio") else "video"
        if kind == ir.MediaKind.IMAGE:
            tag_name = "img"
        rel = os.path.relpath(asset.path, self.root).replace(os.sep, "/")
        url = "/" + quote(rel)
        return f'<img src="{url}">' if tag_name == "img" else f'<{tag_name} src="{url}"></{tag_name}>'

    def media_asset(self, ref: str) -> Optional[ir.Asset]:
        """The file of a Canvas media object (``m-...`` id, ``/media_objects/m-...``)."""
        m = _MEDIA_ID_RE.search(ref or "")
        if not m:
            return None
        media_id = (m.group(1) or m.group(2)).lower()
        if media_id not in self._media_cache:
            if self._all_files is None:
                self._all_files = sorted(
                    os.path.join(d, f) for d, _dirs, files in os.walk(self.root) for f in files
                    if not f.startswith("._")
                )
            found = next((p for p in self._all_files if os.path.basename(p).lower().startswith(media_id)), None)
            self._media_cache[media_id] = self.index.asset(found) if found else None
        return self._media_cache[media_id]

    def resolver_for(self, doc_dir: str) -> ir.Resolver:
        base = super().resolver_for(doc_dir)

        def resolve(url: str) -> Optional[ir.Asset]:
            found = base(url)
            if found is None and _MEDIA_ID_RE.search(url or ""):
                found = self.media_asset(url)
            return found

        return resolve


def _has_content(choice_html: str) -> bool:
    if re.search(r"<(img|video|audio|iframe)\b", choice_html or "", re.I):
        return True
    plain = _plain(choice_html).lower()
    return bool(plain) and plain != _NO_ANSWER_TEXT


def _type_hook(item: qti.QtiItem) -> Optional[ir.QType]:
    label = (item.meta.get("question_type") or "").lower()
    if label in _UNSUPPORTED_TYPES:
        return ir.QType.UNSUPPORTED
    if label == "formula_question":
        return ir.QType.NUMERICAL
    return None


__all__ = ["KEY", "LABEL", "CanvasReader", "detect", "read"]
