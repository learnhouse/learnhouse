"""Import outside content into a course: Markdown, HTML or a web page into
pages, and a plain outline into a build_course spec.

* `import_content` turns Markdown, HTML or a public URL into one page, or one
  page per heading (split_on), in a chapter. HTML goes through the same
  converter as LMS imports (lms_import/html_to_tiptap.py), so only nodes the
  editor knows come out; images become files fetched after approval, like
  images written in Markdown. Fetching a URL needs the user's approval.
* `import_outline` reads an outline (Markdown headings or an indented list)
  into the spec build_course takes, and with create=true builds it (a draft).

No model is called here: the assistant connected over MCP does the writing,
so these tools never spend the organization's AI credits.
"""

from __future__ import annotations

import re
from typing import Any, Literal
from urllib.parse import urljoin, urlsplit

from bs4 import BeautifulSoup
from fastapi import HTTPException
from pydantic import BaseModel, Field, model_validator

from src.db.courses.activities import ActivityCreate, ActivitySubTypeEnum, ActivityTypeEnum
from src.security.rbac import AccessAction
from src.services.ai.tools import doc_ops as d
from src.services.ai.tools import refs
from src.services.ai.tools.base import ActionTier, ToolContext, ToolSpec, require_approval
from src.services.ai.tools.chapters import activity_ref
from src.services.ai.tools.content_assets import MAX_MEDIA_PER_CALL, attach_media, check_media, check_url, fetch_page, media_reason
from src.services.ai.tools.content_edit import require_risky_approval
from src.services.ai.tools.markdown import MAX_CHARS, Converted, Media, convert
from src.services.ai.tools.results import changed

MAX_HTML = 3_000_000
MAX_PAGES = 40
_STRIP = ("script", "style", "noscript", "nav", "header", "footer", "aside", "form", "iframe[hidden]", "svg", "button")


class _Sink:
    """MediaSink for HtmlConverter: outside images become link stand-ins
    listed as Media, stored by attach_media once the page exists."""

    def __init__(self) -> None:
        self.media: list[Media] = []

    def remote_image_node(self, url: str, *, width: int | None = None, alignment: str = "center") -> dict:
        node = d.paragraph([d.text_node(url, [{"type": "link", "attrs": {"href": url}}])])
        attrs: dict[str, Any] = {"alignment": alignment if alignment in ("left", "center", "right") else "center"}
        if width and 50 <= width <= 2000:
            attrs["size"] = {"width": width}
        self.media.append(Media("image", url, node, "", attrs))
        return node

    def media_node(self, kind, asset, **_kw):  # files inside a package: none here
        return None

    def scratch_file(self, name, data):  # pragma: no cover - only data: URIs reach it, and media_node drops them
        return None

    def library_node(self, asset, **_kw):  # pragma: no cover - no package files here
        return None

    def missing_file(self, name) -> None:
        return None


def main_html(html: str, base_url: str | None = None) -> tuple[str, str | None]:
    """The readable part of a page (article, main or body, without menus and
    scripts), with relative links made absolute; plus the page title."""
    soup = BeautifulSoup(html, "html.parser")
    title_tag = soup.find("title")
    title = title_tag.get_text(" ", strip=True)[:200] if title_tag else None
    root = soup.find("article") or soup.find("main") or soup.find("body") or soup
    for selector in _STRIP:
        for tag in root.select(selector):
            tag.decompose()
    if base_url:
        for tag in root.find_all(["a", "img", "iframe", "source", "video", "audio"]):
            for attr in ("href", "src"):
                value = tag.get(attr)
                if value and not value.startswith(("#", "data:", "mailto:", "javascript:")):
                    tag[attr] = urljoin(base_url, value)
    if not title:
        h1 = root.find("h1")
        title = h1.get_text(" ", strip=True)[:200] if h1 else None
    return str(root), title


def html_to_converted(html: str, base_url: str | None = None) -> tuple[Converted, str | None]:
    from src.services.courses.lms_import.html_to_tiptap import HtmlConverter
    from src.services.courses.lms_import.ir import RichText

    if len(html) > MAX_HTML:
        raise HTTPException(status_code=400, detail=f"The HTML is over {MAX_HTML} characters.")
    body, title = main_html(html, base_url)
    sink = _Sink()
    notes: list[str] = []
    blocks = HtmlConverter(sink, warn=notes.append).convert(RichText(html=body))
    doc = {"type": "doc", "content": blocks or [d.paragraph()]}
    # Only top-level images can become image blocks; the rest stay links.
    media = [m for m in sink.media if any(n == m.node for n in doc["content"])]
    if len(media) < len(sink.media):
        notes.append("Images inside lists or tables were kept as links.")
    try:
        d.check_loadable(doc)
    except d.DocError as e:  # pragma: no cover - the converter only emits known nodes
        raise HTTPException(status_code=400, detail=f"The page could not be converted: {e}")
    return Converted(doc, sorted(set(notes)), media), title


_RAW_HTML = re.compile(r"^\s{0,3}<(?:p|div|img|a|table|h[1-6]|br|details|picture|center|ul|ol)\b", re.I | re.M)


def markdown_to_converted(text: str) -> tuple[Converted, str | None]:
    """Markdown as pages. Markdown that carries raw HTML (READMEs often do)
    is rendered to HTML first, so its images and links come through instead
    of showing as tags; plain Markdown keeps LearnHouse's fences."""
    if not _RAW_HTML.search(text or ""):
        return convert(text[:MAX_CHARS], media=True), None
    from markdown_it import MarkdownIt

    html = MarkdownIt("commonmark", {"html": True}).enable("table").render(text[:MAX_CHARS])
    return html_to_converted(html)


def split_doc(doc: dict, level: int | None, fallback: str) -> list[tuple[str, dict]]:
    """[(name, doc)]: one page per heading of `level` (text before the first
    heading opens the first page), or the whole document."""
    content = doc.get("content") or []
    if level is None:
        return [(fallback, doc)]
    pages: list[tuple[str, list[dict]]] = []
    for node in content:
        if d.kind(node) == "heading" and (node.get("attrs") or {}).get("level") == level:
            name = d.inline_text(node).strip()[:200] or fallback
            pages.append((name, []))
            continue
        if not pages:
            pages.append((fallback, []))
        pages[-1][1].append(node)
    pages = [(n, c) for n, c in pages if c or n != fallback]
    if len(pages) > MAX_PAGES:
        raise HTTPException(status_code=400, detail=f"That makes {len(pages)} pages; at most {MAX_PAGES} per import. Split on a higher heading level.")
    return [(n, {"type": "doc", "content": c or [d.paragraph()]}) for n, c in pages] or [(fallback, doc)]


class ImportContentParams(BaseModel):
    chapter_uuid: str = Field(..., max_length=100, description="The chapter to add the page(s) to (chapter_...).")
    markdown: str | None = Field(None, max_length=MAX_CHARS, description="Markdown to import (fences included).")
    html: str | None = Field(None, max_length=MAX_HTML, description="HTML to import (menus and scripts are dropped).")
    url: str | None = Field(None, min_length=8, max_length=2048, description="A public web page or .md file to import (needs approval).")
    name: str | None = Field(None, min_length=1, max_length=200, description="Page name; defaults to the page title.")
    split_on: Literal["none", "h1", "h2"] = Field(
        "none", description="none: one page; h1/h2: one page per heading of that level (the heading becomes its name)."
    )

    @model_validator(mode="after")
    def _one(self):
        if sum(x is not None for x in (self.markdown, self.html, self.url)) != 1:
            raise ValueError("pass exactly one of markdown, html or url")
        return self


async def _import_content(ctx: ToolContext, p: ImportContentParams):
    from src.services.courses.activities.activities import create_activity

    from src.db.courses.courses import Course

    chapter = await refs.load(ctx, "chapter", p.chapter_uuid)
    course = await ctx.db_session.get(Course, chapter.course_id)
    source = None
    if p.url:
        check_url(p.url)
        require_approval(ctx, f"Fetches the page at {urlsplit(p.url).hostname} to import it.", person=True)
        text, final, is_markdown = await fetch_page(p.url)
        source = final
        if is_markdown:
            converted, title = markdown_to_converted(text)
        else:
            converted, title = html_to_converted(text, final)
    elif p.html is not None:
        converted, title = html_to_converted(p.html)
    else:
        converted, title = markdown_to_converted(p.markdown)
    level = {"none": None, "h1": 1, "h2": 2}[p.split_on]
    first = (converted.doc.get("content") or [{}])[0]
    if not title and d.kind(first) == "heading" and (first.get("attrs") or {}).get("level") == 1:
        title = d.inline_text(first).strip()[:200] or None
        if level != 1 and len(converted.doc["content"]) > 1:
            converted.doc["content"] = converted.doc["content"][1:]  # the title becomes the page name
    name = p.name or title or "Imported page"
    pages = split_doc(converted.doc, level, name)
    if len(converted.media) > MAX_MEDIA_PER_CALL:
        # Store the first ones; the rest stay links rather than failing the import.
        extra = len(converted.media) - MAX_MEDIA_PER_CALL
        converted.media = converted.media[:MAX_MEDIA_PER_CALL]
        converted.notes.append(f"{extra} more images were kept as links; add them with add_media_block if needed.")
    check_media(converted.media)
    require_risky_approval(ctx, {}, converted.doc, media_reason(converted.media) if not p.url else None)
    created = []
    ready = not course.published
    for page_name, doc in pages:
        activity = await create_activity(
            ctx.request,
            ActivityCreate(
                name=page_name, chapter_id=chapter.id, activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
                activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE, content=doc, published=ready,
            ),
            ctx.user,
            ctx.db_session,
        )
        ref = await activity_ref(ctx, course.course_uuid, activity, published=ready)
        mine = [m for m in converted.media if any(n == m.node for n in doc["content"])]
        stored = await attach_media(ctx, activity.activity_uuid, mine)
        if stored:
            stored.pop("version_after", None)
            ref["media"] = stored
        created.append(ref)
    return changed(
        f"Imported {len(created)} page(s) into chapter '{chapter.name}'" + (f" from {source}" if source else "") + ".",
        activities=created,
        notes=converted.notes or None,
        next_step="Read a page with get_activity_content to tidy it, and run score_course to check the result.",
    )


# ─── outlines ────────────────────────────────────────────────────────────────

_HEADING = re.compile(r"^(#{1,4})\s+(.+?)\s*#*\s*$")
_ITEM = re.compile(r"^(\s*)(?:[-*+]|\d{1,3}[.)])\s+(.+?)\s*$")


def parse_outline(text: str) -> dict:
    """An outline as a build_course spec. `# Course`, `## Chapter`, `### Page`
    (or `- Chapter` with indented `- Page` items); lines under a page become
    its Markdown."""
    course: dict[str, Any] = {"name": None, "description": None}
    chapters: list[dict] = []
    page: dict | None = None
    list_mode_indent: int | None = None
    for raw in (text or "").replace("\r\n", "\n").split("\n"):
        line = raw.rstrip()
        heading = _HEADING.match(line)
        item = _ITEM.match(line) if not heading else None
        if heading:
            level, title = len(heading.group(1)), heading.group(2).strip()[:200]
            if level == 1:
                course["name"] = title
            elif level == 2:
                chapters.append({"name": title, "activities": [], "_heading": True})
                page = None
            else:
                if not chapters:
                    chapters.append({"name": "Chapter 1", "activities": []})
                page = {"name": title, "markdown": ""}
                chapters[-1]["activities"].append(page)
            continue
        if item and page is None:
            indent = len(item.group(1).replace("\t", "    "))
            title = item.group(2).strip()[:200]
            if chapters and chapters[-1].get("_heading"):
                chapters[-1]["activities"].append({"name": title})  # items under '## Chapter' are its pages
            elif list_mode_indent is None or indent <= list_mode_indent:
                list_mode_indent = indent
                chapters.append({"name": title, "activities": []})
            else:
                if not chapters:  # pragma: no cover - an indented first item opens a chapter above
                    chapters.append({"name": "Chapter 1", "activities": []})
                chapters[-1]["activities"].append({"name": title})
            continue
        if page is not None:
            page["markdown"] += line + "\n"
        elif line.strip() and not chapters and course["description"] is None:
            course["description"] = line.strip()[:1000]
    for chapter in chapters:
        chapter.pop("_heading", None)
        for act in chapter["activities"]:
            if "markdown" in act:
                act["markdown"] = act["markdown"].strip() or None
                if act["markdown"] is None:
                    del act["markdown"]
    if not chapters:
        raise HTTPException(status_code=400, detail="No chapters found: use ## Chapter and ### Page headings, or a nested list.")
    return {"course": {k: v for k, v in course.items() if v}, "chapters": chapters}


class ImportOutlineParams(BaseModel):
    outline: str = Field(
        ..., min_length=3, max_length=200_000,
        description="'# Course name', '## Chapter', '### Page' (text under a page becomes its content), or a nested bullet list.",
    )
    course_name: str | None = Field(None, min_length=1, max_length=200, description="Course name when the outline has no '# ' title.")
    create: bool = Field(False, description="true builds the course now (as a draft); false only returns the spec to review or extend.")


async def _import_outline(ctx: ToolContext, p: ImportOutlineParams):
    spec = parse_outline(p.outline)
    if p.course_name:
        spec["course"]["name"] = p.course_name
    if not spec["course"].get("name"):
        raise HTTPException(status_code=400, detail="Give the course a name: a '# Course name' line or course_name.")
    pages = sum(len(c["activities"]) for c in spec["chapters"])
    if not p.create:
        return {
            "spec": spec,
            "summary": f"Read {len(spec['chapters'])} chapters and {pages} pages. Nothing was created.",
            "next_step": "Fill in pages (markdown or blocks), add quizzes or assignments, then pass it to build_course (dry_run first).",
        }
    from src.services.ai.tools.course_build import BuildCourseParams, _build_course

    return await _build_course(ctx, BuildCourseParams.model_validate(spec))


SPECS: list[ToolSpec] = [
    ToolSpec(
        name="import_content",
        title="Import Markdown, HTML or a web page",
        description=(
            "Turn Markdown, HTML or a public web page (url, needs approval) into a page in a chapter, or "
            "one page per heading with split_on=h1/h2. Menus and scripts are dropped, images become "
            "stored files, embeds and tables are kept. Then tidy the pages with the content tools."
        ),
        params_model=ImportContentParams,
        tier=ActionTier.CREATE,
        rights_bucket="activities",
        access_action=AccessAction.CREATE,
        execute=_import_content,
        target_param="chapter_uuid",
        target_kind="chapter",
        approval_in_call=True,
        open_world=True,
        summarize=lambda p: f"Import {'the page at ' + p.url if p.url else 'content'} into the chapter {p.chapter_uuid}",
    ),
    ToolSpec(
        name="import_outline",
        title="Import a course outline",
        description=(
            "Read an outline ('# Course', '## Chapter', '### Page' with optional text under each page, or a "
            "nested bullet list) into a build_course spec. create=false (default) returns the spec to "
            "review and enrich; create=true builds it as a draft course."
        ),
        params_model=ImportOutlineParams,
        tier=ActionTier.CREATE,
        rights_bucket="courses",
        access_action=AccessAction.CREATE,
        execute=_import_outline,
        approval_in_call=True,
        summarize=lambda p: "Build a course from an outline" if p.create else "Read a course outline",
    ),
]
