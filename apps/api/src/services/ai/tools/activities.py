"""Activity tools: create pages (one or many) and video or PDF activities,
rename, publish and delete activities.

These tools handle an activity as an item of the course (name, published
state, place). What is written inside a page is handled by the content tools.
Every activity id is loaded from the connected organization first; the
activity services then check rights on the parent course.
"""

from __future__ import annotations

import asyncio
from typing import Literal
from urllib.parse import parse_qs, urlsplit

from fastapi import HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlmodel import select
from starlette.datastructures import Headers, UploadFile

from src.db.courses.activities import (
    ActivityCreate,
    ActivitySubTypeEnum,
    ActivityTypeEnum,
    ActivityUpdate,
)
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.chapters import Chapter
from src.security.rbac import AccessAction, check_resource_access
from src.services.ai.tools import refs
from src.services.ai.tools.base import ActionTier, ToolContext, ToolSpec, require_approval
from src.services.ai.tools.chapters import (
    activity_ref,
    course_of,
    course_ref,
    place_activity,
)
from src.services.ai.tools.content_assets import attach_media, check_media, check_url, fetch, media_reason
from src.services.ai.tools.content_edit import require_risky_approval
from src.services.ai.tools.markdown import MAX_CHARS, Converted, convert
from src.services.ai.tools.results import changed, clip
from src.services.courses.activities.activities import (
    create_activity,
    delete_activity,
    update_activity,
)
from src.services.courses.activities.pdf import create_documentpdf_activity
from src.services.courses.activities.video import (
    ExternalVideo,
    create_external_video_activity,
    create_video_activity,
)

MAX_MARKDOWN = MAX_CHARS
MAX_PAGES_PER_CALL = 50
MAX_TOTAL_MARKDOWN = 1_000_000
_PAGE_MARKDOWN = (
    "Optional page content in Markdown: headings, lists, tables, code, > [!NOTE] callouts, "
    "$$ math $$, images (![alt](https://...) on their own line, fetched and stored), and "
    "```quiz / ```flipcards / ```exercise / ```scenario / ```embed / ```video / ```pdf fences "
    "for rich blocks (describe_activity_blocks shows their syntax)."
)

_ACTIVITY_UUID = Field(..., max_length=100, description="The activity (activity_...).")


async def _chapter_ref(ctx: ToolContext, activity_id: int) -> dict | None:
    chapter = (
        await ctx.db_session.execute(
            select(Chapter)
            .join(ChapterActivity, ChapterActivity.chapter_id == Chapter.id)
            .where(ChapterActivity.activity_id == activity_id)
        )
    ).scalars().first()
    return refs.ref("chapter", chapter.chapter_uuid, chapter.name) if chapter else None


# ─── params ──────────────────────────────────────────────────────────────────


class CreateActivityParams(BaseModel):
    chapter_uuid: str = Field(..., max_length=100, description="The chapter to add the page to (chapter_...).")
    name: str = Field(..., min_length=1, max_length=200, description="Page name.")
    markdown: str | None = Field(None, max_length=MAX_MARKDOWN, description=_PAGE_MARKDOWN)
    position: int | None = Field(
        None, ge=0, le=10_000, description="0-based place in the chapter; omit to add at the end."
    )


class NewPage(BaseModel):
    name: str = Field(..., min_length=1, max_length=200, description="Page name.")
    markdown: str | None = Field(None, max_length=MAX_MARKDOWN, description=_PAGE_MARKDOWN)


class CreateActivitiesParams(BaseModel):
    chapter_uuid: str = Field(..., max_length=100, description="The chapter to add the pages to (chapter_...).")
    pages: list[NewPage] = Field(
        ..., min_length=1, max_length=MAX_PAGES_PER_CALL,
        description=f"The pages, in order (1 to {MAX_PAGES_PER_CALL}).",
    )
    position: int | None = Field(
        None, ge=0, le=10_000, description="0-based place of the first page in the chapter; omit to add at the end."
    )

    @model_validator(mode="after")
    def _total(self):
        total = sum(len(page.markdown or "") for page in self.pages)
        if total > MAX_TOTAL_MARKDOWN:
            raise ValueError(
                f"at most {MAX_TOTAL_MARKDOWN} characters of Markdown per call; split the pages over several calls"
            )
        return self


class CreateMediaActivityParams(BaseModel):
    chapter_uuid: str = Field(..., max_length=100, description="The chapter to add the activity to (chapter_...).")
    name: str = Field(..., min_length=1, max_length=200, description="Activity name.")
    kind: Literal["youtube", "video", "pdf"] = Field(
        ...,
        description=(
            "youtube: a YouTube video shown in the video player; video: an mp4/webm file, "
            "fetched and stored (up to 200 MB); pdf: a PDF document, fetched and stored (up to 50 MB)."
        ),
    )
    url: str = Field(..., min_length=8, max_length=2048, description="The YouTube link, or the public URL of the file itself.")
    position: int | None = Field(
        None, ge=0, le=10_000, description="0-based place in the chapter; omit to add at the end."
    )


class UpdateActivityParams(BaseModel):
    activity_uuid: str = _ACTIVITY_UUID
    name: str | None = Field(None, min_length=1, max_length=200, description="New name.")
    published: bool | None = Field(
        None, description="Publish (true) or unpublish (false) for learners."
    )


class DeleteActivityParams(BaseModel):
    activity_uuid: str = _ACTIVITY_UUID


# ─── executors ───────────────────────────────────────────────────────────────


async def _create_activity(ctx: ToolContext, p: CreateActivityParams):
    chapter = await refs.load(ctx, "chapter", p.chapter_uuid)
    course = await course_of(ctx, chapter.course_id, "chapter", p.chapter_uuid)
    # Know the caller may add to this course before converting anything.
    await check_resource_access(
        ctx.request, ctx.db_session, ctx.user, course.course_uuid, AccessAction.CREATE
    )
    converted = await asyncio.to_thread(convert, p.markdown, media=True) if p.markdown else Converted({})
    content = converted.doc
    check_media(converted.media)
    require_risky_approval(ctx, {}, content, media_reason(converted.media))
    # A draft course hides everything until it is published, so its pages are
    # made ready; in a live course a new page starts as a draft of its own.
    ready = not course.published
    activity = await create_activity(
        ctx.request,
        ActivityCreate(
            name=p.name,
            chapter_id=chapter.id,
            activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
            activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
            content=content,
            published=ready,
        ),
        ctx.user,
        ctx.db_session,
    )
    if p.position is not None:
        await place_activity(ctx, course, chapter.id, activity.id, p.position)
    media = await attach_media(ctx, activity.activity_uuid, converted.media)
    if media:
        media.pop("version_after", None)
    return changed(
        f"Created page '{activity.name}' in chapter '{chapter.name}' "
        + ("(the course is a draft: it shows once the course is published)." if ready
           else "(a draft: learners see it once it is published)."),
        activity=await activity_ref(ctx, course.course_uuid, activity, published=ready),
        editor_url=await refs.web_url(
            ctx, "activity_editor", course=course.course_uuid, activity=activity.activity_uuid
        ),
        chapter=refs.ref("chapter", chapter.chapter_uuid, chapter.name),
        course=await course_ref(ctx, course),
        media=media,
    )


def _convert_all(pages: list[NewPage]) -> list[Converted]:
    """Every page's Markdown as a document, converted before anything is
    created so a bad fence fails the call instead of leaving half the pages."""
    docs = []
    for k, page in enumerate(pages, 1):
        try:
            docs.append(convert(page.markdown, media=True) if page.markdown else Converted({}))
        except HTTPException as e:
            raise HTTPException(
                status_code=400, detail=f"Page {k} ('{page.name}'): {e.detail} Nothing was created."
            )
    return docs


async def _create_activities(ctx: ToolContext, p: CreateActivitiesParams):
    chapter = await refs.load(ctx, "chapter", p.chapter_uuid)
    course = await course_of(ctx, chapter.course_id, "chapter", p.chapter_uuid)
    await check_resource_access(
        ctx.request, ctx.db_session, ctx.user, course.course_uuid, AccessAction.CREATE
    )
    converted = await asyncio.to_thread(_convert_all, p.pages)
    media = [m for c in converted for m in c.media]
    check_media(media)
    require_risky_approval(
        ctx,
        {},
        {"type": "doc", "content": [n for c in converted for n in c.doc.get("content") or []]},
        media_reason(media),
    )
    ready = not course.published
    created: list[dict] = []
    stopped = None
    try:
        for k, (page, page_doc) in enumerate(zip(p.pages, converted)):
            activity = await create_activity(
                ctx.request,
                ActivityCreate(
                    name=page.name,
                    chapter_id=chapter.id,
                    activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
                    activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
                    content=page_doc.doc,
                    published=ready,
                ),
                ctx.user,
                ctx.db_session,
            )
            if p.position is not None:
                await place_activity(ctx, course, chapter.id, activity.id, p.position + k)
            ref = await activity_ref(ctx, course.course_uuid, activity, published=ready)
            stored = await attach_media(ctx, activity.activity_uuid, page_doc.media)
            if stored:
                stored.pop("version_after", None)
                ref["media"] = stored
            created.append(ref)
    except HTTPException as e:
        if not created:
            raise
        stopped = (
            f"Stopped early: {e.detail} The pages listed were created; add the rest with "
            "create_activities."
        )
    n = len(created)
    return changed(
        f"Created {n} page{'s' if n != 1 else ''} in chapter '{chapter.name}' "
        + ("(the course is a draft: they show once the course is published)." if ready
           else "(drafts: learners see them once they are published)."),
        activities=created,
        stopped=stopped,
        chapter=refs.ref("chapter", chapter.chapter_uuid, chapter.name),
        course=await course_ref(ctx, course),
    )


def _youtube_id(url: str) -> str | None:
    parts = urlsplit(url)
    host = (parts.hostname or "").lower().removeprefix("www.").removeprefix("m.")
    if parts.scheme not in ("http", "https"):
        return None
    if host == "youtu.be":
        video = parts.path.strip("/").split("/")[0]
    elif host in ("youtube.com", "youtube-nocookie.com"):
        path = parts.path.strip("/").split("/")
        if path[0] == "watch":
            video = parse_qs(parts.query).get("v", [""])[0]
        elif path[0] in ("embed", "shorts", "live", "v") and len(path) > 1:
            video = path[1]
        else:
            video = ""
    else:
        return None
    return video if video and len(video) <= 20 and video.replace("-", "").replace("_", "").isalnum() else None


async def _create_media_activity(ctx: ToolContext, p: CreateMediaActivityParams):
    chapter = await refs.load(ctx, "chapter", p.chapter_uuid)
    course = await course_of(ctx, chapter.course_id, "chapter", p.chapter_uuid)
    await check_resource_access(
        ctx.request, ctx.db_session, ctx.user, course.course_uuid, AccessAction.CREATE
    )
    if p.kind == "youtube":
        video = _youtube_id(p.url)
        if video is None:
            raise HTTPException(
                status_code=400,
                detail="That is not a YouTube video link (youtube.com/watch?v=..., youtu.be/..., /shorts/...).",
            )
        activity = await create_external_video_activity(
            ctx.request,
            ctx.user,
            ExternalVideo(
                name=p.name,
                uri=f"https://www.youtube.com/watch?v={video}",
                type="youtube",
                chapter_id=chapter.id,
            ),
            ctx.db_session,
        )
    else:
        check_url(p.url)
        host = urlsplit(p.url).hostname
        require_approval(ctx, f"Fetches a {p.kind} file from an outside link ({host}).", person=True)
        fetched = await fetch(p.url, p.kind)
        try:
            upload = UploadFile(
                file=fetched.file,
                size=fetched.size,
                filename=f"{p.kind}.{fetched.ext}",
                headers=Headers({"content-type": fetched.mime}),
            )
            create = create_video_activity if p.kind == "video" else create_documentpdf_activity
            activity = await create(ctx.request, p.name, chapter.id, ctx.user, ctx.db_session, upload)
        finally:
            fetched.file.close()
    # Same draft rules as pages: ready inside a draft course, a draft in a live one.
    ready = not course.published
    if ready:
        activity = await update_activity(
            ctx.request, ActivityUpdate(published=True), activity.activity_uuid, ctx.user, ctx.db_session
        )
    if p.position is not None:
        await place_activity(ctx, course, chapter.id, activity.id, p.position)
    what = {"youtube": "video", "video": "video", "pdf": "document"}[p.kind]
    return changed(
        f"Created {what} activity '{activity.name}' in chapter '{chapter.name}' "
        + ("(the course is a draft: it shows once the course is published)." if ready
           else "(a draft: learners see it once it is published)."),
        activity=await activity_ref(ctx, course.course_uuid, activity, published=ready),
        chapter=refs.ref("chapter", chapter.chapter_uuid, chapter.name),
        course=await course_ref(ctx, course),
    )


async def _update_activity(ctx: ToolContext, p: UpdateActivityParams):
    activity = await refs.load(ctx, "activity", p.activity_uuid)
    course = await course_of(ctx, activity.course_id, "activity", p.activity_uuid)
    patch = p.model_dump(include={"name", "published"}, exclude_none=True)
    if not patch:
        raise HTTPException(status_code=400, detail="Nothing to change: pass name or published.")
    previous = {"name": activity.name, "published": bool(activity.published)}
    if p.published is not None and course.published:
        # Learners of a live course see the change at once. Inside a draft
        # course nobody does, so building one needs no approvals.
        require_approval(ctx, "Changes what learners of a published course see")
    updated = await update_activity(
        ctx.request, ActivityUpdate(**patch), activity.activity_uuid, ctx.user, ctx.db_session
    )
    return changed(
        f"Updated activity '{updated.name}' ({', '.join(sorted(patch))}).",
        activity=await activity_ref(ctx, course.course_uuid, updated, published=bool(updated.published)),
        course=await course_ref(ctx, course),
        undo={"tool": "update_activity", "args": {"activity_uuid": activity.activity_uuid, **{k: previous[k] for k in patch}}},
    )


async def _delete_activity(ctx: ToolContext, p: DeleteActivityParams):
    activity = await refs.load(ctx, "activity", p.activity_uuid)
    course = await course_of(ctx, activity.course_id, "activity", p.activity_uuid)
    chapter = await _chapter_ref(ctx, activity.id)
    name = activity.name
    await delete_activity(ctx.request, activity.activity_uuid, ctx.user, ctx.db_session)
    return changed(
        f"Deleted activity '{name}' from '{course.name}'.",
        activity=refs.ref("activity", p.activity_uuid, name),
        chapter=chapter,
        course=await course_ref(ctx, course),
    )


# ─── specs ───────────────────────────────────────────────────────────────────

SPECS: list[ToolSpec] = [
    ToolSpec(
        name="create_activity",
        title="Create page",
        description=(
            "Add a page to a chapter, optionally written in Markdown, at the end or at a "
            "0-based position. In a draft course it shows once the course is published; in a "
            "live course it starts as a draft page. Images and media in the Markdown are fetched "
            "and stored. Video and PDF activities: create_media_activity; assignments: "
            "create_assignment; SCORM is added in the dashboard. Returns the page's link and "
            "editor link."
        ),
        params_model=CreateActivityParams,
        tier=ActionTier.CREATE,
        rights_bucket="activities",
        access_action=AccessAction.CREATE,
        execute=_create_activity,
        target_param="chapter_uuid",
        target_kind="chapter",
        approval_in_call=True,
        open_world=True,
        summarize=lambda p: f"Add page '{clip(p.name, 80)}' to the chapter",
    ),
    ToolSpec(
        name="create_activities",
        title="Create pages",
        description=(
            f"Add up to {MAX_PAGES_PER_CALL} pages to a chapter in one call, each with optional "
            "Markdown content, at the end or from a 0-based position. Use it to fill a chapter "
            "of an existing course; create_course builds a new course with its pages. Pages "
            "follow the same draft rules as create_activity. Returns each page's link."
        ),
        params_model=CreateActivitiesParams,
        tier=ActionTier.CREATE,
        rights_bucket="activities",
        access_action=AccessAction.CREATE,
        execute=_create_activities,
        target_param="chapter_uuid",
        target_kind="chapter",
        approval_in_call=True,
        open_world=True,
        summarize=lambda p: f"Add {len(p.pages)} page{'s' if len(p.pages) != 1 else ''} to the chapter",
    ),
    ToolSpec(
        name="create_media_activity",
        title="Create video or PDF activity",
        description=(
            "Add a video or document activity to a chapter: a YouTube video (kind=youtube), or "
            "an mp4/webm video or PDF fetched from a public URL and stored (kind=video or pdf; "
            "fetching needs the user's approval). Follows the same draft rules as "
            "create_activity. For a video or PDF inside a page, use a fence in the page's "
            "Markdown or add_media_block instead."
        ),
        params_model=CreateMediaActivityParams,
        tier=ActionTier.CREATE,
        rights_bucket="activities",
        access_action=AccessAction.CREATE,
        execute=_create_media_activity,
        target_param="chapter_uuid",
        target_kind="chapter",
        approval_in_call=True,
        open_world=True,
        summarize=lambda p: f"Add {p.kind} activity '{clip(p.name, 80)}' from {clip(p.url, 120)}",
    ),
    ToolSpec(
        name="update_activity",
        title="Update activity",
        description=(
            "Rename an activity or publish/unpublish it. Content is changed with the content "
            "tools. In a draft course this needs no approval; in a published course, "
            "publishing or unpublishing a page does, since learners see it at once."
        ),
        params_model=UpdateActivityParams,
        tier=ActionTier.EDIT,
        rights_bucket="activities",
        access_action=AccessAction.UPDATE,
        execute=_update_activity,
        target_param="activity_uuid",
        target_kind="activity",
        approval_in_call=True,
        idempotent=True,
        summarize=lambda p: (
            f"{'Publish' if p.published else 'Unpublish'} page {p.activity_uuid}"
            if p.published is not None
            else "Update page {}: ".format(p.activity_uuid)
            + ", ".join(sorted(p.model_dump(exclude={"activity_uuid"}, exclude_none=True)) or ["nothing"])
        ),
    ),
    ToolSpec(
        name="delete_activity",
        title="Delete activity",
        description=(
            "Permanently delete an activity (page, video, document, ...) and its stored "
            "files. Cannot be undone."
        ),
        params_model=DeleteActivityParams,
        tier=ActionTier.DESTRUCTIVE,
        rights_bucket="activities",
        access_action=AccessAction.DELETE,
        execute=_delete_activity,
        target_param="activity_uuid",
        target_kind="activity",
        summarize=lambda p: f"Delete activity {p.activity_uuid}",
    ),
]
