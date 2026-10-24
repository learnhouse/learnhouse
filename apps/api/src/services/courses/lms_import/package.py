"""
Write an IR course as a LearnHouse course package.

The layout is the one ``transfer/export_service.py`` produces and
``transfer/import_service.py`` reads, plus an ``assignment.json`` next to
assignment activities (assignments and their tasks, with answer keys):

    manifest.json
    courses/<course>/course.json
    courses/<course>/thumbnails/<file>
    courses/<course>/chapters/<chapter>/chapter.json
    courses/<course>/chapters/<chapter>/activities/<activity>/activity.json
                                                   .../assignment.json
                                                   .../files/...            (video/, documentpdf/, scorm/,
                                                                             dynamic/blocks/, assignments/)
                                                   .../blocks/<block>/block.json

The importer regenerates every uuid, so the ids written here only need to be
unique inside the package. They are derived deterministically from the source
ids, so two conversions of the same export are identical apart from the
manifest's created_at timestamp.
"""

from __future__ import annotations

import copy
import json
import mimetypes
import os
import re
import shutil
import subprocess
import time
import zipfile
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
from typing import Optional

from src.security.file_validation import (
    _MAX_UNCOMPRESSED_ZIP,
    FILE_TYPES,
    max_size_for_extension,
    validate_audio_content,
    validate_image_content,
    validate_video_content,
)

from . import ir
from .archive import ArchiveError, ExtractLimits, extract_archive, find_file
from .html_to_tiptap import (
    HtmlConverter,
    embed_node,
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
from .questions import IdFactory, block_quiz_nodes, build_tasks
from .report import ConversionReport, error_text
from .xmlutil import attr, children, parse_file

PACKAGE_FORMAT = "learnhouse-course-export"
PACKAGE_VERSION = "1.0.0"

QUIZ_MODES = ("assignment", "page")

_BLOCK_FOLDERS = {
    ir.MediaKind.IMAGE: ("imageBlock", "BLOCK_IMAGE"),
    ir.MediaKind.VIDEO: ("videoBlock", "BLOCK_VIDEO"),
    ir.MediaKind.AUDIO: ("audioBlock", "BLOCK_AUDIO"),
    ir.MediaKind.PDF: ("pdfBlock", "BLOCK_DOCUMENT_PDF"),
}

# What each block type accepts (routers/courses/activities/block_types/*),
# mapped to the canonical extension the importer stores.
_ACCEPTED = {
    ir.MediaKind.IMAGE: {"png": "png", "jpg": "jpg", "jpeg": "jpg", "gif": "gif", "webp": "webp"},
    ir.MediaKind.VIDEO: {"mp4": "mp4", "m4v": "mp4", "webm": "webm"},
    ir.MediaKind.AUDIO: {"mp3": "mp3", "wav": "wav", "ogg": "ogg", "oga": "ogg", "m4a": "m4a"},
    ir.MediaKind.PDF: {"pdf": "pdf"},
}
# Images Pillow can turn into PNG
_CONVERTIBLE_IMAGES = {"bmp", "tif", "tiff", "ico"}
# Videos ffmpeg can remux/transcode into MP4
_CONVERTIBLE_VIDEOS = {"mov", "avi", "mkv", "ogv", "wmv", "flv", "mpg", "mpeg", "3gp"}
_CONVERTIBLE_AUDIO = {"aac", "flac", "wma", "aif", "aiff", "opus"}
# Demuxers ffmpeg may use on export media (no hls, concat, image2, subtitles...)
# Bounds for media conversion and SCORM unpacking, per conversion: an export
# full of long or crafted media files must not hold a conversion slot for
# hours, and nested SCORM zips must not expand past what the export allows.
TRANSCODE_FILE_TIMEOUT = 20 * 60
TRANSCODE_TOTAL_SECONDS = 2 * 60 * 60
TRANSCODE_MAX_OUTPUT = "4G"
SCORM_TOTAL_BYTES = 20 * 1024 ** 3
SCORM_PACKAGE_BYTES = 4 * 1024 ** 3

_FFMPEG_INPUT_FORMATS = "mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,avi,asf,flv,mpeg,mpegts,ogg,wav,flac,aac,aiff,mp3"
_PILLOW_INPUT_FORMATS = ("BMP", "TIFF", "ICO", "DIB")

# Reference files allowed on assignment tasks (tasks_ref_files.py accepts
# documents, images, video, office files and SCORM zips)
_REFERENCE_EXTS = {
    "pdf", "png", "jpg", "jpeg", "gif", "webp", "mp4", "webm", "docx", "xlsx", "pptx", "doc", "xls",
    "ppt", "zip", "txt", "mp3", "wav",
}

_MAGIC = {
    "png": [b"\x89PNG"],
    "jpg": [b"\xff\xd8\xff"],
    "gif": [b"GIF87a", b"GIF89a"],
    "webp": [b"RIFF"],
    "pdf": [b"%PDF"],
    "webm": [b"\x1aE\xdf\xa3"],
    "mp3": [b"ID3", b"\xff\xfb", b"\xff\xf3", b"\xff\xf2", b"\xff\xfa"],
    "wav": [b"RIFF"],
    "ogg": [b"OggS"],
}


# What the Library accepts as uploads (src/services/media: image, video,
# document, audio, office, office_legacy, archive); anything else is zipped
_LIBRARY_EXTS = {
    ext.lstrip(".") for spec in FILE_TYPES.values() for ext in spec["extensions"]
} - {"sqlite", "db", "sqlite3"}


def _library_file_ok(path: str, ext: str) -> bool:
    """The upload validator of ``ext`` accepts the file (the importer drops it otherwise)."""
    spec = next((t for t in FILE_TYPES.values() if f".{ext}" in t["extensions"]), None)
    if spec is None:
        return False
    try:
        with open(path, "rb") as f:
            stream_validator = spec.get("stream_validator")
            if stream_validator is not None:
                return bool(stream_validator(f))
            return bool(spec["validator"](f.read(64 * 1024)))
    except OSError:
        return False


def _sniff_ok(path: str, ext: str) -> bool:
    try:
        with open(path, "rb") as f:
            head = f.read(64)
    except OSError:
        return False
    if ext in ("mp4", "m4a"):
        ok = head[4:8] == b"ftyp"
    elif ext in ("webp", "wav"):  # both are RIFF containers
        ok = head.startswith(b"RIFF") and head[8:12] == (b"WEBP" if ext == "webp" else b"WAVE")
    else:
        signatures = _MAGIC.get(ext)
        ok = not signatures or any(head.startswith(s) for s in signatures)
    # The course importer drops package files that fail the upload validator
    # for their extension (stricter on MP4 brands and MP3 headers); a file
    # kept here must pass it or the block would point at nothing
    validator = _UPLOAD_VALIDATORS.get(ext)
    return ok and (validator is None or bool(validator(head)))


_UPLOAD_VALIDATORS = {
    ext.lstrip("."): spec["validator"]
    for spec in FILE_TYPES.values()
    if spec["validator"] in (validate_image_content, validate_video_content, validate_audio_content)
    for ext in spec["extensions"]
}


def _ffmpeg() -> Optional[str]:
    return shutil.which("ffmpeg")


@dataclass
class ConvertOptions:
    quiz_mode: str = "assignment"  # "assignment" (graded) or "page" (blockQuiz self-checks)
    include_hidden: bool = True  # hidden items are imported unpublished
    publish: bool = True  # visible items are published (the import step can still unpublish)
    include_empty_sections: bool = False
    transcode: bool = True  # convert unsupported image/video/audio formats when tools exist
    zip_output: bool = True
    # Course name when the export has none (the uploaded file's name)
    fallback_title: str = ""
    # Exports usually come from a finished term: a past due date would close
    # the assignment to learners on day one, so it is dropped unless kept here
    keep_past_due_dates: bool = False


@dataclass
class _Activity:
    key: str
    dir: str
    blocks: dict[str, str] = field(default_factory=dict)  # asset path -> block node key


class PackageWriter:
    def __init__(self, course: ir.Course, out_dir: str, options: Optional[ConvertOptions] = None,
                 report: Optional[ConversionReport] = None):
        self.course = course
        self.out_dir = os.path.realpath(out_dir)
        self.options = options or ConvertOptions()
        if self.options.quiz_mode not in QUIZ_MODES:
            raise ValueError(f"quiz_mode must be one of {QUIZ_MODES}")
        self.report = report or ConversionReport(source=course.source, course_title=course.title)
        self.ids = IdFactory(f"{course.source}:{course.id or course.title}")
        self.course_key = self.ids("course")
        self._activity: Optional[_Activity] = None
        self._written = 0  # activity.json files written so far
        self._context = ""
        self._scratch = os.path.join(self.out_dir, ".scratch")
        self._transcode_seconds = 0.0
        self._scorm_bytes = 0
        self._course_dir = ""
        self._library: dict[str, dict] = {}  # file path -> blockLibrary node
        self.converter = HtmlConverter(self, self._warn)

    # ------------------------------------------------------------ reporting

    def _warn(self, message: str) -> None:
        self.report.warn(message, self._context)

    # --------------------------------------------------------------- driver

    def write(self) -> str:
        """Write the package directory and return its path."""
        os.makedirs(self.out_dir, exist_ok=True)
        for w in self.course.warnings:
            self.report.warn(w)
        for title, kind, reason in self.course.skipped:
            self.report.skip(title, kind, reason)
        course_dir = os.path.join(self.out_dir, "courses", self.course_key)
        os.makedirs(course_dir, exist_ok=True)
        self._course_dir = course_dir

        chapter_order = 0
        for section in self.course.sections:
            if not self.options.include_hidden and not section.visible:
                self.report.skip(section.title, "section", "hidden in the source")
                continue
            if not section.items and section.summary.is_empty() and not self.options.include_empty_sections:
                continue
            self._write_chapter(course_dir, section, chapter_order)
            chapter_order += 1

        self._write_course_json(course_dir)
        manifest = {
            "version": PACKAGE_VERSION,
            "format": PACKAGE_FORMAT,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "courses": [{"course_uuid": self.course_key, "name": self.course.title or "Imported course",
                         "path": f"courses/{self.course_key}"}],
            "source": {"lms": self.course.source, "id": self.course.id},
        }
        _write_json(os.path.join(self.out_dir, "manifest.json"), manifest)
        shutil.rmtree(self._scratch, ignore_errors=True)
        return self.out_dir

    # --------------------------------------------------------------- course

    def _write_course_json(self, course_dir: str) -> None:
        c = self.course
        summary = html_to_text(c.summary.html)
        thumbnail_name = ""
        if c.thumbnail is not None and c.thumbnail.exists():
            ext = _ACCEPTED[ir.MediaKind.IMAGE].get(c.thumbnail.extension)
            if ext and _sniff_ok(c.thumbnail.path, ext):
                thumbnail_name = f"{self.ids.uuid()}.{ext}"
                os.makedirs(os.path.join(course_dir, "thumbnails"), exist_ok=True)
                shutil.copyfile(c.thumbnail.path, os.path.join(course_dir, "thumbnails", thumbnail_name))
        learnings = [{"id": self.ids("learning"), "text": t[:300], "emoji": "✅"} for t in c.learnings if t.strip()]
        data = {
            "course_uuid": self.course_key,
            "name": (c.title or "Imported course")[:500],
            "description": _first_sentences(summary, 500),
            "about": summary,
            "learnings": json.dumps(learnings) if learnings else None,
            "tags": ",".join(t.strip() for t in c.tags if t.strip()) or None,
            "thumbnail_type": "image",
            "thumbnail_image": thumbnail_name,
            "thumbnail_video": "",
            "public": False,
            "published": False,
            "open_to_contributors": False,
            "seo": None,
            "extra_metadata": {"lms_import": {"source": c.source, "source_id": c.id, "short_name": c.short_name,
                                              "language": c.language}},
        }
        _write_json(os.path.join(course_dir, "course.json"), data)

    def _write_chapter(self, course_dir: str, section: ir.Section, order: int) -> None:
        key = self.ids("chapter")
        chapter_dir = os.path.join(course_dir, "chapters", key)
        os.makedirs(chapter_dir, exist_ok=True)
        self._context = section.title
        summary_text = html_to_text(section.summary.html)
        items = list(section.items)
        # A summary with media or layout would be flattened in the plain-text
        # chapter description, so it becomes the chapter's first page instead
        if not section.summary.is_empty() and _is_rich(section.summary):
            items.insert(0, ir.Page(title=section.title or "Overview", parts=[ir.HtmlPart(section.summary)],
                                    id=f"{section.id}:summary", visible=section.visible))
            summary_text = ""
        _write_json(os.path.join(chapter_dir, "chapter.json"), {
            "chapter_uuid": key,
            "name": (section.title or f"Chapter {order + 1}")[:500],
            "description": summary_text[:2000],
            "thumbnail_image": "",
            "order": order,
            "extra_metadata": {"lms_import": {"source_id": section.id}},
        })
        self.report.count("chapters")
        activity_order = 0
        for item in items:
            # Everything in a hidden section stays unpublished
            visible = getattr(item, "visible", True) and section.visible
            title = getattr(item, "title", "") or ""
            if not visible and not self.options.include_hidden:
                self.report.skip(title, type(item).__name__, "hidden in the source")
                continue
            self._context = f"{section.title} › {title}"
            before = self._activity
            written_before = self._written
            try:
                written = self._write_item(chapter_dir, item, activity_order, visible)
            except Exception as e:  # one broken item must not sink the course
                self.report.skip(title, type(item).__name__, f"conversion error: {error_text(e)}")
                # Activities the item completed before failing (an intro page, a
                # figures page) stay, so their order slots are taken
                written = self._written - written_before
                act = self._activity
                if act is not None and act is not before and not os.path.exists(os.path.join(act.dir, "activity.json")):
                    shutil.rmtree(act.dir, ignore_errors=True)  # half-written activity
            activity_order += written
        self._context = ""

    # ---------------------------------------------------------------- items

    def _write_item(self, chapter_dir: str, item, order: int, visible: bool) -> int:
        if isinstance(item, ir.Page):
            return self._page(chapter_dir, item.title, item.parts, order, visible, item.id)
        if isinstance(item, ir.VideoItem):
            return self._video(chapter_dir, item, order, visible)
        if isinstance(item, ir.DocumentItem):
            return self._document(chapter_dir, item, order, visible)
        if isinstance(item, ir.Assessment):
            return self._assessment(chapter_dir, item, order, visible)
        if isinstance(item, ir.AssignmentItem):
            return self._assignment_item(chapter_dir, item, order, visible)
        if isinstance(item, ir.ScormItem):
            return self._scorm(chapter_dir, item, order, visible)
        if isinstance(item, ir.UnsupportedItem):
            self.report.skip(item.title, item.kind, item.reason)
            return 0
        self.report.skip(getattr(item, "title", "?"), type(item).__name__, "unknown item")
        return 0

    def _new_activity(self, chapter_dir: str) -> _Activity:
        key = self.ids("activity")
        path = os.path.join(chapter_dir, "activities", key)
        os.makedirs(path, exist_ok=True)
        self._activity = _Activity(key=key, dir=path)
        return self._activity

    def _activity_json(self, act: _Activity, *, name: str, activity_type: str, sub_type: str, content: dict,
                       order: int, visible: bool, source_id: str, details: Optional[dict] = None) -> None:
        _write_json(os.path.join(act.dir, "activity.json"), {
            "activity_uuid": act.key,
            "name": (name or "Untitled")[:500],
            "activity_type": activity_type,
            "activity_sub_type": sub_type,
            "content": content,
            "details": details or {},
            "published": bool(visible and self.options.publish),
            "order": order,
            "extra_metadata": {"lms_import": {"source": self.course.source, "source_id": source_id}},
        })
        self._written += 1
        self.report.count(activity_type)

    def _page(self, chapter_dir: str, title: str, parts: list, order: int, visible: bool, source_id: str) -> int:
        act = self._new_activity(chapter_dir)
        nodes: list[dict] = []
        for part in parts:
            nodes.extend(self._part_nodes(part))
        if not nodes:
            nodes = [paragraph()]
        self._activity_json(act, name=title, activity_type="TYPE_DYNAMIC", sub_type="SUBTYPE_DYNAMIC_PAGE",
                            content={"type": "doc", "content": nodes}, order=order, visible=visible,
                            source_id=source_id)
        return 1

    def _part_nodes(self, part) -> list[dict]:
        if isinstance(part, ir.HtmlPart):
            return self.converter.convert(part.content)
        if isinstance(part, ir.HeadingPart):
            return [heading(part.text, part.level)] if part.text else []
        if isinstance(part, ir.MediaPart):
            title_nodes = [paragraph_text(part.title, [{"type": "bold"}])] if part.title else []
            if part.asset is not None:
                node = self.media_node(part.kind, part.asset, alt=part.title)
                return title_nodes + [node] if node else title_nodes
            if part.url and is_http_url(part.url):
                if part.kind == ir.MediaKind.IMAGE:
                    return title_nodes + [self.remote_image_node(part.url)]
                return title_nodes + [embed_node(part.url, height=160 if part.kind == ir.MediaKind.AUDIO else 450)]
            return title_nodes
        if isinstance(part, ir.EmbedPart):
            if part.url and not is_http_url(part.url):
                self.report.skip(part.url[:100], "embed", "not a web address")
                return []
            if not part.url and not (part.code or "").strip():
                return []
            nodes = [paragraph_text(part.title, [{"type": "bold"}])] if part.title else []
            return nodes + [embed_node(part.url, part.code, part.height)]
        if isinstance(part, ir.LinkPart):
            if not is_http_url(part.url):
                return [paragraph_text(part.title or part.url)] if (part.title or part.url) else []
            yid, vid = youtube_id(part.url), vimeo_id(part.url)
            nodes = []
            if part.description:
                nodes.append(paragraph_text(part.description))
            if yid or vid:
                return nodes + [embed_node(part.url, height=450)]
            nodes.append({
                "type": "blockWebPreview",
                "attrs": {"url": part.url, "title": part.title or part.url, "description": None, "og_image": None,
                          "favicon": None, "og_type": None, "og_url": None, "alignment": "left",
                          "buttonLabel": "Open link", "showButton": True, "openInPopup": False},
            })
            return nodes
        if isinstance(part, ir.MathPart):
            return [math_node(part.latex)] if part.latex.strip() else []
        if isinstance(part, ir.InlineQuizPart):
            return ([heading(part.title, 3)] if part.title else []) + self._inline_quiz_nodes(part.questions)
        if isinstance(part, ir.FlashcardsPart):
            cards = [{"type": "flipcard", "attrs": {"question": html_to_text(t)[:500] or "…",
                                                    "answer": html_to_text(d)[:500] or "…", "color": "blue",
                                                    "alignment": "center", "size": "medium"}}
                     for t, d in part.cards]
            if not cards:
                return []
            nodes = [heading(part.title, 3)] if part.title else []
            for i in range(0, len(cards), 12):
                nodes.append({"type": "flipcardGrid", "attrs": {"columns": 3 if len(cards) > 4 else 2},
                              "content": cards[i:i + 12]})
            return nodes
        if isinstance(part, ir.FilePart):
            kind = media_kind_for(part.asset)
            node = (self.media_node(kind, part.asset, alt=part.title) if kind is not None
                    else self.library_node(part.asset, title=part.title))
            return [node] if node else []
        if isinstance(part, ir.CodePart):
            node: dict = {"type": "codeBlock", "attrs": {"language": part.language or None}}
            if part.code:
                node["content"] = [text_node(part.code)]
            return [node]
        return []

    def _inline_quiz_nodes(self, questions: list[ir.Question]) -> list[dict]:
        """Questions on a page, in order: quiz blocks and flipcards take plain
        text, so a question with images, tables or no interactive equivalent
        is shown as rich content first (picture answers labelled "Option A"...)."""
        nodes: list[dict] = []
        plain: list[ir.Question] = []

        def flush() -> None:
            if plain:
                nodes.extend(block_quiz_nodes(plain, self.ids, self._warn))
                plain.clear()

        for n, q in enumerate(questions, start=1):
            if q.type == ir.QType.DESCRIPTION:
                flush()
                nodes.extend(self.converter.convert(q.text))
                continue
            image_choices = any(_count_images(c.text.html) for c in q.choices)
            rich = image_choices or _count_images(q.text.html) or _TABLE_TAG.search(q.text.html or "")
            if q.type == ir.QType.UNSUPPORTED:
                flush()
                if not q.text.is_empty():
                    nodes.append(heading(f"Question {n}", 4))
                    nodes.extend(self.converter.convert(q.text))
                self.report.skip((html_to_text(q.text.html) or q.title)[:80], f"{q.source_type or 'unknown'} question",
                                 "no interactive equivalent; its text was kept")
                continue
            if not rich:
                plain.append(q)
                continue
            flush()
            nodes.append(heading(f"Question {n}", 4))
            nodes.extend(self.converter.convert(q.text))
            if image_choices:
                relabelled, figure_parts = _figures([q])
                for fp in figure_parts[2:]:  # the option pictures; the question text is above
                    nodes.extend(self._part_nodes(fp))
                q = relabelled[0]
            nodes.extend(block_quiz_nodes([replace(q, text=ir.RichText(f"Question {n}"))], self.ids, self._warn))
        flush()
        return nodes

    def _video(self, chapter_dir: str, item: ir.VideoItem, order: int, visible: bool) -> int:
        has_notes = item.description is not None and not item.description.is_empty()
        if item.asset is not None and not has_notes:
            if not item.asset.exists():
                self.report.skip(item.title, "video", "video file missing from the export")
                return 0
            prepared = self._prepare(ir.MediaKind.VIDEO, item.asset)
            if prepared is None:
                self.report.skip(item.title, "video", "video file missing from the export or in an unsupported format")
                return 0
            src, ext = prepared
            act = self._new_activity(chapter_dir)
            filename = f"{self.ids.uuid()}_video.{ext}"
            dest = os.path.join(act.dir, "files", "video", filename)
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            shutil.copyfile(src, dest)
            self._activity_json(act, name=item.title, activity_type="TYPE_VIDEO", sub_type="SUBTYPE_VIDEO_HOSTED",
                                content={"filename": filename, "activity_uuid": act.key},
                                details={"startTime": 0, "endTime": None, "autoplay": False, "muted": False},
                                order=order, visible=visible, source_id=item.id)
            return 1
        if item.url and youtube_id(item.url) and not has_notes:
            act = self._new_activity(chapter_dir)
            self._activity_json(act, name=item.title, activity_type="TYPE_VIDEO", sub_type="SUBTYPE_VIDEO_YOUTUBE",
                                content={"uri": item.url, "type": "youtube", "activity_uuid": act.key},
                                details={"startTime": 0, "endTime": None, "autoplay": False, "muted": False},
                                order=order, visible=visible, source_id=item.id)
            return 1
        # Vimeo and other players, or a video with notes: a page with the player
        parts: list = []
        if has_notes:
            parts.append(ir.HtmlPart(item.description))
        parts.append(ir.MediaPart(ir.MediaKind.VIDEO, asset=item.asset, url=item.url))
        return self._page(chapter_dir, item.title, parts, order, visible, item.id)

    def _document(self, chapter_dir: str, item: ir.DocumentItem, order: int, visible: bool) -> int:
        if not item.asset.exists() or not _sniff_ok(item.asset.path, "pdf"):
            self.report.skip(item.title, "document", "PDF missing from the export or not a valid PDF")
            return 0
        act = self._new_activity(chapter_dir)
        filename = f"{self.ids.uuid()}_documentpdf.pdf"
        dest = os.path.join(act.dir, "files", "documentpdf", filename)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        shutil.copyfile(item.asset.path, dest)
        self._activity_json(act, name=item.title, activity_type="TYPE_DOCUMENT", sub_type="SUBTYPE_DOCUMENT_PDF",
                            content={"filename": filename, "activity_uuid": act.key}, order=order, visible=visible,
                            source_id=item.id)
        return 1

    def _assessment(self, chapter_dir: str, item: ir.Assessment, order: int, visible: bool) -> int:
        if not item.questions and item.intro.is_empty():
            self.report.skip(item.title, "quiz", "no questions in the export")
            return 0
        if self.options.quiz_mode == "page" or not item.graded:
            parts: list = []
            if not item.intro.is_empty():
                parts.append(ir.HtmlPart(item.intro))
            parts.append(ir.InlineQuizPart(item.questions))
            return self._page(chapter_dir, item.title, parts, order, visible, item.id)

        written = 0
        if _is_rich(item.intro):
            written += self._page(chapter_dir, item.title, [ir.HtmlPart(item.intro)], order, visible,
                                  f"{item.id}:intro")
        questions, figures = _figures(item.questions)
        build = build_tasks(questions, self.ids)
        for title, kind, reason in build.skipped:
            self.report.skip(title, kind, reason)
        if not build.tasks:
            # Nothing gradable (e.g. only STACK or drag-onto-image questions):
            # keep the questions readable instead of dropping the whole quiz
            parts: list = [ir.HtmlPart(item.intro)] if not item.intro.is_empty() and not written else []
            for n, q in enumerate(item.questions, start=1):
                if not q.text.is_empty():
                    parts += [ir.HeadingPart(f"Question {n}", 3), ir.HtmlPart(q.text)]
            self.report.skip(item.title, "quiz", "no question could be converted to a graded task"
                             + ("; the questions were kept as a page" if parts else ""))
            if parts:
                written += self._page(chapter_dir, item.title, parts, order + written, visible, f"{item.id}:questions")
            return written
        figures_title = ""
        if figures:
            figures_title = f"{item.title}: figures"
            written += self._page(chapter_dir, figures_title, figures, order + written, visible,
                                  f"{item.id}:figures")
        act = self._new_activity(chapter_dir)
        assignment = {
            "title": item.title[:500],
            "description": "\n\n".join(p for p in (
                html_to_text(item.intro.html),
                f"The figures for these questions are on the page \u201c{figures_title}\u201d." if figures_title else "",
            ) if p),
            "due_date": self._due_date(item.due_date),
            "published": bool(visible and self.options.publish),
            "grading_type": "PERCENTAGE",
            "auto_grading": not build.has_manual,
            "show_correct_answers": item.show_correct_answers,
            "allow_retries": item.max_attempts != 1,
            "max_retries": item.max_attempts if item.max_attempts > 1 else 0,
            "pass_threshold_percentage": item.pass_percent,
            "ungraded": False,
            "solution": "\n".join(build.solution_notes) or None,
            "solution_reveal": "AFTER_GRADING" if build.solution_notes else "NEVER",
        }
        self._write_assignment(act, assignment, build.tasks)
        self._activity_json(act, name=item.title, activity_type="TYPE_ASSIGNMENT",
                            sub_type="SUBTYPE_ASSIGNMENT_ANY", content={}, order=order + written,
                            visible=visible, source_id=item.id)
        self.report.count("questions", len(item.questions))
        return written + 1

    def _due_date(self, value: Optional[str]) -> Optional[str]:
        if not value or self.options.keep_past_due_dates:
            return value
        try:
            due = datetime.fromisoformat(value)
        except ValueError:
            return value
        if due.tzinfo is None:
            due = due.replace(tzinfo=timezone.utc)
        if due < datetime.now(timezone.utc):
            self.report.count("past_due_dates_removed")
            return None
        return value

    def _assignment_item(self, chapter_dir: str, item: ir.AssignmentItem, order: int, visible: bool) -> int:
        from .questions import TaskSpec

        written = 0
        description = html_to_text(item.instructions.html)
        refs: list[ir.Asset] = []
        for a in item.attachments + html_assets(item.instructions):
            if all(os.path.realpath(r.path) != os.path.realpath(a.path) for r in refs):
                refs.append(a)
        for a in refs:
            if not a.exists():
                self.missing_file(a.name)
        refs = [a for a in refs if a.exists()]
        # The task shows one reference file; the other attachments go on the
        # instructions page as Library files (or media), where learners get them
        reference = next((a for a in refs if a.extension.replace("jpeg", "jpg") in _REFERENCE_EXTS), None)
        extras = [a for a in refs if a is not reference]
        if _is_rich(item.instructions) or extras:
            parts: list = [ir.HtmlPart(item.instructions)] + [ir.FilePart(a, title=a.name) for a in extras]
            written += self._page(chapter_dir, item.title, parts, order, visible, f"{item.id}:instructions")
        tasks = [TaskSpec(title=item.title[:500] or "Submission", assignment_type="FILE_SUBMISSION",
                          contents={}, description=description, reference=reference,
                          hint="Upload your work as a file." if item.allow_text and not item.allow_file else "")]
        act = self._new_activity(chapter_dir)
        assignment = {
            "title": item.title[:500],
            "description": description,
            "due_date": self._due_date(item.due_date),
            "published": bool(visible and self.options.publish),
            "grading_type": "PERCENTAGE",
            "auto_grading": False,
            "show_correct_answers": False,
            "allow_retries": False,
            "max_retries": 0,
            "pass_threshold_percentage": item.pass_percent,
            "ungraded": not item.graded,
            "solution": None,
            "solution_reveal": "NEVER",
        }
        self._write_assignment(act, assignment, tasks)
        self._activity_json(act, name=item.title, activity_type="TYPE_ASSIGNMENT",
                            sub_type="SUBTYPE_ASSIGNMENT_ANY", content={}, order=order + written,
                            visible=visible, source_id=item.id)
        return written + 1

    def _write_assignment(self, act: _Activity, assignment: dict, tasks: list) -> None:
        a_key = self.ids("assignment")
        out_tasks = []
        for index, task in enumerate(tasks):
            t_key = self.ids("assignmenttask")
            reference_file = None
            if task.reference is not None:
                reference_file = self._copy_reference(act, a_key, t_key, task.reference)
            out_tasks.append({
                "assignment_task_uuid": t_key,
                "title": task.title[:500] or f"Task {index + 1}",
                "description": task.description,
                "hint": task.hint,
                "reference_file": reference_file,
                "assignment_type": task.assignment_type,
                "contents": task.contents,
                "max_grade_value": task.max_grade_value,
                "order": index,
            })
        _write_json(os.path.join(act.dir, "assignment.json"),
                    {"assignment_uuid": a_key, "assignment": assignment, "tasks": out_tasks})
        self.report.count("assignment_tasks", len(out_tasks))

    def _copy_reference(self, act: _Activity, a_key: str, t_key: str, asset: ir.Asset) -> Optional[str]:
        ext = asset.extension.replace("jpeg", "jpg")
        if ext not in _REFERENCE_EXTS or not asset.exists():
            return None
        # The importer drops a file whose content does not match its extension;
        # the task would then silently lose its reference
        if ext in _LIBRARY_EXTS and not _library_file_ok(asset.path, ext):
            self.report.skip(asset.name, "file", f"not a valid {ext} file")
            return None
        name = f"{self.ids.uuid()}.{ext}"
        dest = os.path.join(act.dir, "files", "assignments", a_key, "tasks", t_key, name)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        shutil.copyfile(asset.path, dest)
        return name

    def _scorm(self, chapter_dir: str, item: ir.ScormItem, order: int, visible: bool) -> int:
        if not item.package.exists():
            self.report.skip(item.title, "scorm", "package missing from the export")
            return 0
        act = self._new_activity(chapter_dir)
        scorm_dir = os.path.join(act.dir, "files", "scorm")
        extracted = os.path.join(scorm_dir, "extracted")
        budget = min(SCORM_PACKAGE_BYTES, SCORM_TOTAL_BYTES - self._scorm_bytes)
        if budget <= 0:
            shutil.rmtree(act.dir, ignore_errors=True)
            self.report.skip(item.title, "scorm", "the SCORM packages of this export are too large in total")
            return 0
        try:
            extract_archive(item.package.path, extracted, ExtractLimits(max_total_bytes=budget))
            self._scorm_bytes += _tree_size(extracted)
        except ArchiveError as e:
            shutil.rmtree(act.dir, ignore_errors=True)
            self.report.skip(item.title, "scorm", f"unreadable package: {error_text(e)}")
            return 0
        manifest = find_file(extracted, "imsmanifest.xml", max_depth=1)
        launch = _scorm_launch(manifest) if manifest else None
        if launch is None:
            shutil.rmtree(act.dir, ignore_errors=True)
            self.report.skip(item.title, "scorm", "no launchable SCO in imsmanifest.xml")
            return 0
        shutil.copyfile(item.package.path, os.path.join(scorm_dir, "package.zip"))
        version, identifier, href, sco_title = launch
        # A package zipped from its parent folder: launch paths are relative to the manifest
        base = os.path.relpath(os.path.dirname(manifest), extracted)
        if base != ".":
            href = f"{base.replace(os.sep, '/')}/{href}"
        self._activity_json(act, name=item.title, activity_type="TYPE_SCORM",
                            sub_type="SUBTYPE_SCORM_2004" if version == "SCORM_2004" else "SUBTYPE_SCORM_12",
                            content={"scorm_version": version, "sco_identifier": identifier, "entry_point": href,
                                     "sco_title": sco_title or item.title},
                            order=order, visible=visible, source_id=item.id)
        return 1

    # ---------------------------------------------------- MediaSink protocol

    def scratch_file(self, name: str, data: bytes) -> ir.Asset:
        os.makedirs(self._scratch, exist_ok=True)
        path = os.path.join(self._scratch, re.sub(r"[^A-Za-z0-9._-]", "_", name))
        with open(path, "wb") as f:
            f.write(data)
        return ir.Asset(path=path, name=name)

    def missing_file(self, name: str) -> None:
        self.report.skip(name, "file", "missing from the export")

    def library_node(self, asset: ir.Asset, *, title: str = "") -> Optional[dict]:
        """A ``blockLibrary`` node for a file the learner downloads (pptx, docx, zip...).

        The file becomes a Library media item of the organization on import.
        Types the Library does not accept are wrapped in a zip, so nothing is
        left behind. One Library item per source file, however often it is linked.
        """
        if not asset.exists():
            self.missing_file(asset.name)
            return None
        key_path = os.path.realpath(asset.path)
        if key_path not in self._library:
            node = self._write_library_file(asset, title)
            if node is None:
                return None
            self._library[key_path] = node
        return copy.deepcopy(self._library[key_path])

    def _write_library_file(self, asset: ir.Asset, title: str) -> Optional[dict]:
        ext = asset.extension.replace("jpeg", "jpg")
        direct = ext in _LIBRARY_EXTS and _library_file_ok(asset.path, ext)
        # The importer refuses Library files over the upload limit of their type,
        # and zips (the fallback wrapper) whose content exceeds the zip-bomb cap
        limit = max_size_for_extension(ext) if direct else _MAX_UNCOMPRESSED_ZIP
        if os.path.getsize(asset.path) > limit:
            self.report.skip(asset.name, "file", f"larger than the Library allows ({limit // (1024 * 1024)} MB)")
            return None
        key = self.ids("media")
        folder = os.path.join(self._course_dir, "library", key)
        os.makedirs(folder, exist_ok=True)
        if direct:
            file_name = f"{key}.{ext}"
            shutil.copyfile(asset.path, os.path.join(folder, file_name))
        else:
            ext, file_name = "zip", f"{key}.zip"
            try:
                with zipfile.ZipFile(os.path.join(folder, file_name), "w", zipfile.ZIP_DEFLATED) as z:
                    z.write(asset.path, re.sub(r"[^\w. -]", "_", asset.name) or "file")
            except OSError as e:
                shutil.rmtree(folder, ignore_errors=True)
                self._warn(f"Could not package {asset.name}: {error_text(e)}")
                return None
        size = os.path.getsize(os.path.join(folder, file_name))
        name = (title or asset.name).strip()[:200] or asset.name
        if ext == "zip" and asset.extension != "zip":
            name = f"{name} ({asset.extension or 'file'})"
        snapshot = {"name": name, "media_type": "UPLOAD", "file_format": ext,
                    "file_mime": mimetypes.types_map.get(f".{ext}") or "application/octet-stream",
                    "file_size": size, "url": "", "thumbnail_image": ""}
        _write_json(os.path.join(folder, "media.json"), {
            "media_uuid": key, "name": name, "description": "", "file_name": file_name, "file_format": ext,
            "file_mime": snapshot["file_mime"], "file_size": size, "source_name": asset.name,
        })
        self.report.count("media_file")
        return {"type": "blockLibrary", "attrs": {"resourceUuid": key, "resourceType": "media",
                                                   "snapshot": snapshot, "display": "inline"}}

    def remote_image_node(self, url: str, *, width: Optional[int] = None, alignment: str = "center") -> dict:
        return {"type": "blockImage", "attrs": {
            "blockObject": None, "size": {"width": _clamp_width(width)}, "alignment": alignment,
            "unsplash_url": url, "unsplash_photographer_name": None, "unsplash_photographer_url": None,
            "unsplash_photo_url": None,
        }}

    def media_node(self, kind: ir.MediaKind, asset: ir.Asset, *, alt: str = "", width: Optional[int] = None,
                   alignment: str = "center") -> Optional[dict]:
        act = self._activity
        if act is None:
            return None
        if not asset.exists():
            self.missing_file(asset.name)
            return None
        cached = act.blocks.get(f"{kind.value}:{asset.path}")
        if cached:
            block_key, file_id, ext, natural = cached.split("|")
            if kind == ir.MediaKind.IMAGE and width is None and natural:
                width = int(natural)
        else:
            prepared = self._prepare(kind, asset)
            if prepared is None:
                if os.path.realpath(asset.path).startswith(self._scratch + os.sep):
                    # Decoded from a data: URI or generated here: junk bytes, not a
                    # file the learner could use as a download
                    self.report.skip(asset.name, kind.value, f"unreadable {kind.value} data")
                    return None
                # Not playable as a block: the learner can still download it
                return self.library_node(asset, title=alt)
            src, ext = prepared
            folder, block_type = _BLOCK_FOLDERS[kind]
            block_key = self.ids("block")
            file_id = self.ids.uuid()
            dest = os.path.join(act.dir, "files", "dynamic", "blocks", folder, block_key, f"{file_id}.{ext}")
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            shutil.copyfile(src, dest)
            mime = mimetypes.types_map.get(f".{ext}") or asset.mime or "application/octet-stream"
            _write_json(os.path.join(act.dir, "blocks", block_key, "block.json"), {
                "block_uuid": block_key,
                "block_type": block_type,
                "content": {"file_id": file_id, "file_format": ext, "file_name": asset.name,
                            "file_size": os.path.getsize(dest), "file_type": mime, "activity_uuid": act.key},
            })
            natural = _image_width(dest) if kind == ir.MediaKind.IMAGE else None
            act.blocks[f"{kind.value}:{asset.path}"] = f"{block_key}|{file_id}|{ext}|{natural or ''}"
            self.report.count(f"media_{kind.value}")
            if kind == ir.MediaKind.IMAGE and width is None:
                width = natural
        block_object = {"block_uuid": block_key,
                        "content": {"file_id": file_id, "file_format": ext, "activity_uuid": act.key}}
        if kind == ir.MediaKind.IMAGE:
            return {"type": "blockImage", "attrs": {
                "blockObject": block_object, "size": {"width": _clamp_width(width)}, "alignment": alignment,
                "unsplash_url": None, "unsplash_photographer_name": None, "unsplash_photographer_url": None,
                "unsplash_photo_url": None,
            }}
        if kind == ir.MediaKind.VIDEO:
            return {"type": "blockVideo", "attrs": {"blockObject": dict(block_object, size="medium")}}
        if kind == ir.MediaKind.AUDIO:
            return {"type": "blockAudio",
                    "attrs": {"blockObject": dict(block_object, source_type="upload", size="medium")}}
        return {"type": "blockPDF", "attrs": {"blockObject": block_object, "pdfHeight": None}}

    def _prepare(self, kind: ir.MediaKind, asset: ir.Asset) -> Optional[tuple[str, str]]:
        """(path, canonical extension) of a file the block type accepts, converting if needed.

        None when the file cannot be shown in a block: the caller offers it as a download."""
        src_ext = asset.extension
        accepted = _ACCEPTED[kind]
        if src_ext in accepted:
            ext = accepted[src_ext]
            if _sniff_ok(asset.path, ext):
                return asset.path, ext
            # Misnamed file: trust the content when it is another accepted type
            for candidate in sorted(set(accepted.values())):
                if _sniff_ok(asset.path, candidate):
                    return asset.path, candidate
            # A playable file in a variant LearnHouse does not accept as is
            # (an MP4 with an "iso2"/"avc1" brand, MPEG audio without ID3...)
            if kind in (ir.MediaKind.VIDEO, ir.MediaKind.AUDIO) and self.options.transcode:
                return self._transcode(kind, asset)
            return None
        if not self.options.transcode:
            return None
        if kind == ir.MediaKind.IMAGE and src_ext in _CONVERTIBLE_IMAGES:
            return self._convert_image(asset)
        if kind in (ir.MediaKind.VIDEO, ir.MediaKind.AUDIO) and src_ext in (_CONVERTIBLE_VIDEOS | _CONVERTIBLE_AUDIO):
            return self._transcode(kind, asset)
        return None

    def _convert_image(self, asset: ir.Asset) -> Optional[tuple[str, str]]:
        try:
            from PIL import Image
        except ImportError:  # pragma: no cover - Pillow ships with the API
            return None
        os.makedirs(self._scratch, exist_ok=True)
        out = os.path.join(self._scratch, f"{self.ids.uuid()}.png")
        try:
            # Explicit formats: never let Pillow pick EPS (Ghostscript) or other
            # risky decoders for an untrusted file
            with Image.open(asset.path, formats=_PILLOW_INPUT_FORMATS) as img:
                img.save(out, "PNG")
        except Exception as e:
            self._warn(f"Could not convert image {asset.name}: {error_text(e)}")
            return None
        return out, "png"

    def _transcode(self, kind: ir.MediaKind, asset: ir.Asset, remuxed: bool = False) -> Optional[tuple[str, str]]:
        ffmpeg = _ffmpeg()
        if not ffmpeg:
            return None
        remaining = TRANSCODE_TOTAL_SECONDS - self._transcode_seconds
        if remaining <= 0:
            self._warn(f"Media conversion time limit reached; {asset.name} is a download instead")
            return None
        os.makedirs(self._scratch, exist_ok=True)
        ext = "mp4" if kind == ir.MediaKind.VIDEO else "mp3"
        out = os.path.join(self._scratch, f"{self.ids.uuid()}.{ext}")
        # The input comes from an untrusted export: a ".mov" can really be an
        # HLS or concat playlist that makes ffmpeg read other local files (or
        # URLs) into the output, which would then be served. Allow only real
        # media containers and plain file access.
        args = [ffmpeg, "-nostdin", "-loglevel", "error", "-y",
                "-protocol_whitelist", "file",
                "-format_whitelist", _FFMPEG_INPUT_FORMATS,
                "-threads", "2",
                "-i", asset.path,
                "-threads", "2", "-fs", TRANSCODE_MAX_OUTPUT]
        if kind == ir.MediaKind.VIDEO and asset.extension in ("mp4", "m4v") and not remuxed:
            # Already H.264/AAC in most cases: rewrap without re-encoding first
            converted = self._run_ffmpeg(args + ["-c", "copy", "-movflags", "+faststart"], out, asset, warn=False)
            if converted is None:
                return self._transcode(kind, asset, remuxed=True)
            self.report.count("transcoded")
            return converted
        if kind == ir.MediaKind.VIDEO:
            args += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-movflags", "+faststart"]
        else:
            args += ["-vn", "-c:a", "libmp3lame", "-q:a", "3"]
        converted = self._run_ffmpeg(args, out, asset)
        if converted is None:
            return None
        self.report.count("transcoded")
        return converted

    def _run_ffmpeg(self, args: list[str], out: str, asset: ir.Asset,
                    warn: bool = True) -> Optional[tuple[str, str]]:
        remaining = TRANSCODE_TOTAL_SECONDS - self._transcode_seconds
        started = time.monotonic()
        try:
            subprocess.run(args + [out], check=True, timeout=max(1.0, min(TRANSCODE_FILE_TIMEOUT, remaining)),
                           capture_output=True)
        except (subprocess.SubprocessError, OSError) as e:
            if warn:
                self._warn(f"Could not convert {asset.name}: {_ffmpeg_error(e)}")
            return None
        finally:
            self._transcode_seconds += time.monotonic() - started
        ext = os.path.splitext(out)[1].lstrip(".")
        if not _sniff_ok(out, ext):
            if warn:
                self._warn(f"Could not convert {asset.name}: unexpected output")
            return None
        return out, ext


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _write_json(path: str, data) -> None:
    # Serialized before the file is opened: Postgres rejects NaN/Infinity, so a
    # non-finite value raises here, and a failed item must not leave a
    # half-written file that looks like a finished activity
    text = json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


def _first_sentences(text: str, limit: int) -> str:
    text = " ".join(text.split())
    if len(text) <= limit:
        return text
    cut = text[:limit]
    dot = cut.rfind(". ")
    return (cut[:dot + 1] if dot > limit // 2 else cut.rstrip() + "…")


def _is_rich(rich: ir.RichText) -> bool:
    """True when plain text would lose something (media, tables, embeds, math)."""
    if rich is None or rich.is_empty():
        return False
    return bool(re.search(r"<(img|table|iframe|video|audio|object|embed|pre|math)\b|\$\$|\\\[|\\\(",
                          rich.html, re.I))


_OPTION_LABELS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
_IMG_TAG = re.compile(r"<img\b[^>]*>", re.I)


def _count_images(html: str) -> int:
    return len(_IMG_TAG.findall(html or ""))


_TABLE_TAG = re.compile(r"<table\b", re.I)


def _figures(questions: list[ir.Question]) -> tuple[list[ir.Question], list]:
    """Move images that assignment tasks cannot show onto a companion page.

    Task prompts and quiz options are plain text, and a task holds a single
    reference file, so answers that are pictures (graphs, diagrams) and
    question images inside a multi-question quiz would be lost. Those
    questions are shown on a page instead, and their picture answers are
    relabelled "Option A", "Option B"... so the task still makes sense.
    """
    out: list[ir.Question] = []
    parts: list = []
    text_images = sum(_count_images(q.text.html) for q in questions)
    for n, q in enumerate(questions, start=1):
        # Packaged or remote: either way a plain-text option cannot show it
        image_choices = any(_count_images(c.text.html) for c in q.choices)
        has_text_images = bool(_count_images(q.text.html)) and text_images > 1
        if not image_choices and not has_text_images:
            out.append(q)
            continue
        parts += [ir.HeadingPart(f"Question {n}", 3), ir.HtmlPart(q.text)]
        if image_choices:
            new_choices = []
            for i, c in enumerate(q.choices):
                label = f"Option {_OPTION_LABELS[i] if i < len(_OPTION_LABELS) else i + 1}"
                # Text outside the images only: an image's alt text can give the answer away
                text = html_to_text(_IMG_TAG.sub(" ", c.text.html))
                parts.append(ir.HtmlPart(ir.RichText(f"<p><strong>{label}</strong></p>{c.text.html}", c.text.resolve)))
                new_choices.append(replace(c, text=ir.RichText(f"{label}: {text}" if text else label)))
            q = replace(q, choices=new_choices)
        out.append(q)
    return out, parts


def _clamp_width(width: Optional[int]) -> int:
    if not width or width <= 0:
        return 600
    return max(80, min(int(width), 900))


def _image_width(path: str) -> Optional[int]:
    try:
        from PIL import Image

        with Image.open(path) as img:
            return img.width
    except Exception:
        return None


def _tree_size(path: str) -> int:
    total = 0
    for root, _dirs, files in os.walk(path):
        for name in files:
            try:
                total += os.lstat(os.path.join(root, name)).st_size
            except OSError:  # pragma: no cover - removed while walking
                pass
    return total


def _ffmpeg_error(e: BaseException) -> str:
    """Short reason for a failed ffmpeg run, without its command line (server paths)."""
    if isinstance(e, subprocess.TimeoutExpired):
        return "took too long"
    if isinstance(e, subprocess.CalledProcessError):
        lines = (e.stderr or b"").decode("utf-8", "replace").strip().splitlines()
        return error_text(RuntimeError(lines[-1])) if lines else f"ffmpeg exited with status {e.returncode}"
    return error_text(e)


def _scorm_launch(manifest_path: str) -> Optional[tuple[str, str, str, str]]:
    """(version, sco identifier, launch href, title) of the first launchable SCO."""
    try:
        root = parse_file(manifest_path)
    except Exception:
        return None
    meta = root.find("metadata")
    schema_version = (meta.findtext("schemaversion") if meta is not None else "") or ""
    version = "SCORM_2004" if ("2004" in schema_version or "CAM" in schema_version) else "SCORM_12"
    resources = {}
    for res in root.iter("resource"):
        resources[attr(res, "identifier")] = res
    orgs = root.find("organizations")
    org = None
    if orgs is not None:
        default = attr(orgs, "default")
        for o in children(orgs, "organization"):
            if not default or attr(o, "identifier") == default:
                org = o
                break
    items = list(org.iter("item")) if org is not None else []
    for item in items:
        ref = attr(item, "identifierref")
        res = resources.get(ref)
        if res is None:
            continue
        href = attr(res, "href")
        if not href:
            continue
        params = attr(item, "parameters")
        if params:
            href = href + (params if params.startswith(("?", "#")) else "?" + params)
        title = (item.findtext("title") or "").strip()
        return version, attr(item, "identifier") or ref, href, title
    for res in resources.values():
        if attr(res, "href") and (attr(res, "scormtype") or attr(res, "scormType")).lower() == "sco":
            return version, attr(res, "identifier"), attr(res, "href"), ""
    return None


def zip_directory(src_dir: str, zip_path: str) -> str:
    """Zip a package directory. Entries are stored, not deflated, so the
    importer's compression-ratio guard never trips on JSON-heavy packages."""
    tmp = zip_path + ".part"
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_STORED, allowZip64=True) as zf:
        for root, dirs, files in os.walk(src_dir):
            dirs.sort()
            for name in sorted(files):
                full = os.path.join(root, name)
                rel = os.path.relpath(full, src_dir).replace(os.sep, "/")
                if rel.startswith(".scratch/"):
                    continue
                info = zipfile.ZipInfo(rel, date_time=(1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_STORED
                info.external_attr = 0o644 << 16
                with open(full, "rb") as fsrc, zf.open(info, "w", force_zip64=True) as fdst:
                    shutil.copyfileobj(fsrc, fdst, 8 * 1024 * 1024)
    os.replace(tmp, zip_path)
    return zip_path


__all__ = ["PackageWriter", "ConvertOptions", "zip_directory", "QUIZ_MODES"]
