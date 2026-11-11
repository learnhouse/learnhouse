"""Course tools: find, read, create (optionally a whole outline or a copy),
change, announce on and delete courses.

Every course id is loaded from the connected organization before a service
runs, and the services keep their own permission checks. Lists only show
courses the caller can open: drafts stay with the people who can edit them.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any
from urllib.parse import urlsplit

from fastapi import HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import and_, func, or_
from sqlmodel import select
from starlette.datastructures import Headers, UploadFile

from src.db.courses.activities import (
    Activity,
    ActivityCreate,
    ActivitySubTypeEnum,
    ActivityTypeEnum,
    ActivityUpdate,
)
from src.db.courses.chapters import ChapterCreate
from src.db.courses.course_chapters import CourseChapter
from src.db.courses.course_updates import CourseUpdateCreate
from src.db.courses.courses import Course, CourseCreate, CourseUpdate, ThumbnailType
from src.db.resource_authors import ResourceAuthor, ResourceAuthorshipStatusEnum
from src.db.usergroup_resources import UserGroupResource
from src.db.usergroup_user import UserGroupUser
from src.db.users import AnonymousUser, APITokenUser
from src.security.auth import resolve_acting_user_id
from src.security.org_auth import is_org_admin
from src.security.rbac import AccessAction, check_resource_access
from src.services.ai.tools import refs
from src.services.ai.tools.base import ActionTier, ToolContext, ToolSpec, require_approval
from src.services.ai.tools.chapters import (
    activity_ref,
    can_edit_course,
    course_ref,
    iso,
    outline,
)
from src.services.ai.tools.content_assets import attach_media, check_media, check_url, fetch, media_reason
from src.services.ai.tools.content_edit import require_risky_approval
from src.services.ai.tools.markdown import MAX_CHARS, Converted, convert
from src.services.ai.tools.results import (
    DETAIL_TEXT,
    LIST_TEXT,
    Paging,
    changed,
    clip,
    clip_field,
    offset_of,
    page,
    untrusted,
)
from src.services.courses.activities.activities import create_activity, update_activity
from src.services.courses.chapters import create_chapter
from src.services.courses.courses import (
    clone_course,
    create_course,
    delete_course,
    get_course,
    update_course,
    update_course_thumbnail,
)
from src.services.courses.updates import create_update
from src.services.orgs.auth_policy import viewer_for_org
from src.services.search.normalization import LIKE_ESCAPE_CHAR, build_like_pattern

MAX_CHAPTERS = 60
MAX_PAGES = 200
MAX_MARKDOWN = MAX_CHARS
MAX_TOTAL_MARKDOWN = 1_000_000


# ─── field formats ───────────────────────────────────────────────────────────
# The dashboard stores tags as "a|b|c" and learnings as a JSON list of
# {id, text, emoji}; older courses hold learnings as "a, b, c".


def _tags_in(tags: list[str]) -> str:
    return "|".join(t.replace("|", " ").strip() for t in tags if t.strip())


def _tags_out(raw: str | None) -> list[str]:
    return [t.strip() for t in (raw or "").split("|") if t.strip()]


def _learnings_in(items: list[str]) -> str:
    return json.dumps(
        [
            {"id": f"learning-{i}", "text": text.strip(), "emoji": "📝"}
            for i, text in enumerate((t for t in items if t.strip()), start=1)
        ],
        ensure_ascii=False,
    )


def _learnings_out(raw: str | None) -> list[str]:
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except ValueError:
        return [t.strip() for t in raw.split(",") if t.strip()]
    if isinstance(data, list):
        return [str(i.get("text", "")).strip() for i in data if isinstance(i, dict) and i.get("text")]
    return [str(data)]


async def _is_staff(ctx: ToolContext) -> bool:
    """Admins and maintainers see every course; API tokens are bounded by
    their own courses rights (checked by the pipeline)."""
    if isinstance(ctx.user, APITokenUser):
        return True
    return await is_org_admin(resolve_acting_user_id(ctx.user), ctx.org.id, ctx.db_session)


# ─── params ──────────────────────────────────────────────────────────────────

_COURSE_UUID = Field(..., max_length=100, description="The course (course_...).")


class ListCoursesParams(Paging):
    query: str | None = Field(
        None,
        min_length=1,
        max_length=200,
        description="Only courses whose name, description, about, learnings or tags contain this text.",
    )
    published: bool | None = Field(
        None, description="true: only published courses; false: only drafts. Omit for both."
    )


class GetCourseParams(BaseModel):
    course_uuid: str = _COURSE_UUID
    include_details: bool = Field(
        False, description="Also return authors, dates and SEO settings."
    )


class OutlinePage(BaseModel):
    name: str = Field(..., min_length=1, max_length=200, description="Page name.")
    markdown: str | None = Field(
        None,
        max_length=MAX_MARKDOWN,
        description=(
            "Optional page content in Markdown: headings, lists, tables, code, > [!TIP] callouts, "
            "$$ math $$, plus ```quiz, ```flipcards, ```exercise, ```scenario, ```embed and ```button "
            "fences for rich blocks (describe_activity_blocks shows their syntax)."
        ),
    )


class OutlineChapter(BaseModel):
    name: str = Field(..., min_length=1, max_length=200, description="Chapter name.")
    description: str = Field("", max_length=1000, description="Optional chapter description.")
    activities: list[OutlinePage] = Field(
        default_factory=list, max_length=MAX_PAGES, description="The chapter's pages, in order."
    )


class CreateCourseParams(BaseModel):
    name: str = Field(..., min_length=1, max_length=200, description="Course name.")
    description: str = Field("", max_length=1000, description="One or two sentences shown on the course card.")
    about: str = Field("", max_length=10_000, description="Longer plain-text presentation of the course.")
    learnings: list[str] = Field(
        default_factory=list,
        description="What learners will be able to do, one outcome per item (up to 20, 300 characters each).",
    )
    tags: list[str] = Field(
        default_factory=list, description="Short keywords (up to 20, 60 characters each)."
    )
    chapters: list[OutlineChapter] = Field(
        default_factory=list,
        max_length=MAX_CHAPTERS,
        description=f"Optional outline: chapters in order with their pages (max {MAX_CHAPTERS} chapters, {MAX_PAGES} pages).",
    )
    copy_from_course_uuid: str | None = Field(
        None,
        max_length=100,
        description=(
            "Copy this course (chapters, activities, files) instead of starting empty; the "
            "copy takes `name` and any other field given here. Not combinable with chapters."
        ),
    )

    @model_validator(mode="after")
    def _caps(self):
        _check_list(self.tags, 60, "tags")
        _check_list(self.learnings, 300, "learnings")
        if self.copy_from_course_uuid and self.chapters:
            raise ValueError("pass chapters or copy_from_course_uuid, not both")
        pages = sum(len(c.activities) for c in self.chapters)
        if pages > MAX_PAGES:
            raise ValueError(f"at most {MAX_PAGES} pages per call; add the rest with create_activity")
        total = sum(len(a.markdown or "") for c in self.chapters for a in c.activities)
        if total > MAX_TOTAL_MARKDOWN:
            raise ValueError(
                f"at most {MAX_TOTAL_MARKDOWN} characters of Markdown per call; "
                "write long pages afterwards, one at a time"
            )
        return self


def _check_list(items: list[str] | None, limit: int, name: str) -> None:
    if items is None:
        return
    if len(items) > 20:
        raise ValueError(f"at most 20 {name}")
    if any(len(i) > limit for i in items):
        raise ValueError(f"each of {name} is at most {limit} characters")


class UpdateCourseParams(BaseModel):
    course_uuid: str = _COURSE_UUID
    name: str | None = Field(None, min_length=1, max_length=200, description="New name.")
    description: str | None = Field(None, max_length=1000, description="New card description.")
    about: str | None = Field(None, max_length=10_000, description="New long presentation.")
    learnings: list[str] | None = Field(None, description="Replaces all learning outcomes (up to 20).")
    tags: list[str] | None = Field(None, description="Replaces all tags (up to 20).")
    open_to_contributors: bool | None = Field(
        None, description="Let members apply to co-author the course."
    )
    published: bool | None = Field(None, description="Publish (true) or unpublish (false) the course.")
    public: bool | None = Field(
        None, description="true: anyone, signed in or not, can see it; false: members only."
    )
    publish_activities: bool | None = Field(
        None,
        description="true publishes every activity of the course at once; false unpublishes them all.",
    )
    thumbnail_url: str | None = Field(
        None,
        min_length=8,
        max_length=2048,
        description="Public http(s) URL of an image (jpg/png/gif/webp) to fetch and use as the course thumbnail.",
    )

    @model_validator(mode="after")
    def _caps(self):
        _check_list(self.tags, 60, "tags")
        _check_list(self.learnings, 300, "learnings")
        return self


class DeleteCourseParams(BaseModel):
    course_uuid: str = _COURSE_UUID


class CreateCourseUpdateParams(BaseModel):
    course_uuid: str = _COURSE_UUID
    title: str = Field(..., min_length=1, max_length=200, description="Announcement title.")
    content: str = Field(..., min_length=1, max_length=5000, description="Announcement text (plain text).")


# ─── reads ───────────────────────────────────────────────────────────────────


async def _visible(ctx: ToolContext):
    """The org's courses the caller can open, as a select on Course.

    Mirrors the course access rules: admins and maintainers see everything;
    other members see published courses that are public, not limited to a
    usergroup, or limited to one of their groups, plus courses they author.
    A usergroup member never sees an unpublished course they cannot open."""
    stmt = select(Course).where(Course.org_id == ctx.org.id)
    if await _is_staff(ctx):
        return stmt
    viewer = await viewer_for_org(ctx.db_session, ctx.user, ctx.org.id)
    if isinstance(viewer, AnonymousUser):
        return stmt.where(Course.public.is_(True), Course.published.is_(True))
    uid = resolve_acting_user_id(ctx.user)
    any_group = (
        select(UserGroupResource.id)
        .where(UserGroupResource.resource_uuid == Course.course_uuid)
        .exists()
    )
    my_group = (
        select(UserGroupResource.id)
        .join(UserGroupUser, UserGroupUser.usergroup_id == UserGroupResource.usergroup_id)
        .where(UserGroupResource.resource_uuid == Course.course_uuid, UserGroupUser.user_id == uid)
        .exists()
    )
    authored = (
        select(ResourceAuthor.id)
        .where(
            ResourceAuthor.resource_uuid == Course.course_uuid,
            ResourceAuthor.user_id == uid,
            ResourceAuthor.authorship_status == ResourceAuthorshipStatusEnum.ACTIVE,
        )
        .exists()
    )
    readable = and_(Course.published.is_(True), or_(Course.public.is_(True), ~any_group, my_group))
    return stmt.where(or_(readable, authored))


async def _list_courses(ctx: ToolContext, p: ListCoursesParams):
    stmt = await _visible(ctx)
    if p.published is not None:
        stmt = stmt.where(Course.published.is_(p.published))
    if p.query:
        pattern = build_like_pattern(p.query)
        stmt = stmt.where(
            or_(
                *(
                    column.ilike(pattern, escape=LIKE_ESCAPE_CHAR)
                    for column in (Course.name, Course.description, Course.about, Course.learnings, Course.tags)
                )
            )
        )
    total = (
        await ctx.db_session.execute(select(func.count()).select_from(stmt.subquery()))
    ).scalar_one()
    offset = offset_of(p.cursor)
    rows = (
        await ctx.db_session.execute(
            stmt.order_by(Course.creation_date.desc(), Course.id.desc()).offset(offset).limit(p.limit)
        )
    ).scalars().all()
    counts: dict[int, int] = {}
    if rows:
        counts = dict(
            (
                await ctx.db_session.execute(
                    select(CourseChapter.course_id, func.count(CourseChapter.id))
                    .where(CourseChapter.course_id.in_([c.id for c in rows]))
                    .group_by(CourseChapter.course_id)
                )
            ).all()
        )
    items = [
        await course_ref(
            ctx,
            c,
            published=bool(c.published),
            public=bool(c.public),
            description=clip(c.description, LIST_TEXT) or None,
            chapters_count=counts.get(c.id, 0),
        )
        for c in rows
    ]
    return page(items, offset=offset, limit=p.limit, total=total)


async def _get_course(ctx: ToolContext, p: GetCourseParams):
    course = await refs.load(ctx, "course", p.course_uuid)
    # The service applies the course read rules (drafts for editors only).
    read = await get_course(ctx.request, course.course_uuid, ctx.user, ctx.db_session)
    editor = await can_edit_course(ctx, course.course_uuid)
    out = await course_ref(
        ctx,
        course,
        published=bool(course.published),
        public=bool(course.public),
        open_to_contributors=bool(course.open_to_contributors),
        tags=_tags_out(course.tags),
        learnings=_learnings_out(course.learnings),
        description=course.description or None,
        about=course.about or None,
    )
    clip_field(out, "description", DETAIL_TEXT)
    clip_field(out, "about", DETAIL_TEXT)
    out["can_edit"] = editor
    if editor:
        out["editor_url"] = await refs.web_url(ctx, "course_editor", course=course.course_uuid)
    out.update(await outline(ctx, course, editor=editor))
    if p.include_details:
        out["created_at"] = iso(course.creation_date)
        out["updated_at"] = iso(course.update_date)
        out["authors"] = [
            {
                "user_uuid": a.user.user_uuid,
                "username": a.user.username,
                "name": " ".join(x for x in (a.user.first_name, a.user.last_name) if x) or None,
                "authorship": getattr(a.authorship, "value", a.authorship).lower(),
                "status": getattr(a.authorship_status, "value", a.authorship_status).lower(),
            }
            for a in read.authors[:20]
        ]
        if editor and course.seo:
            out["seo"] = {k: clip(v, LIST_TEXT) for k, v in course.seo.items() if v not in (None, "")}
        if out["authors"]:
            # Co-author names are written by those members themselves.
            untrusted(out, "authors")
    return out


# ─── writes ──────────────────────────────────────────────────────────────────

_EMPTY_PAGE: dict = {}


_RICH = (
    "blockQuiz", "flipcard", "flipcardGrid", "blockEmbed", "button", "badge", "blockCode",
    "scenarios", "blockWebPreview", "blockH5P", "blockMagic",
)


def _rich_blocks(doc: dict) -> dict[str, int] | None:
    """How many quizzes, flipcards, embeds... a page got from its fences, so
    the caller can check its Markdown landed without reading the page."""
    counts: dict[str, int] = {}
    for node in doc.get("content") or []:
        kind = node.get("type")
        if kind in _RICH:
            counts[kind] = counts.get(kind, 0) + 1
    return counts or None


async def _convert_pages(chapters: list[OutlineChapter]) -> list[list[Converted]]:
    """Every page's Markdown as a document, converted before anything is
    created so a bad fence fails the call instead of leaving half a course."""

    def work() -> list[list[Converted]]:
        out: list[list[Converted]] = []
        for k, chapter in enumerate(chapters, 1):
            row: list[Converted] = []
            for page_in in chapter.activities:
                try:
                    row.append(convert(page_in.markdown, media=True) if page_in.markdown else Converted(_EMPTY_PAGE))
                except HTTPException as e:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Page '{page_in.name}' (chapter {k}, '{chapter.name}'): {e.detail} Nothing was created.",
                    )
            out.append(row)
        return out

    return await asyncio.to_thread(work)


async def _build_outline(
    ctx: ToolContext, course: Course, chapters: list[OutlineChapter], docs: list[list[Converted]]
) -> dict:
    """Create the chapters and pages under a new course; stop at the first
    refusal and report what exists."""
    built: list[dict] = []
    try:
        for chapter_in, chapter_docs in zip(chapters, docs):
            chapter = await create_chapter(
                ctx.request,
                ChapterCreate(
                    name=chapter_in.name,
                    description=chapter_in.description,
                    org_id=course.org_id,
                    course_id=course.id,
                ),
                ctx.user,
                ctx.db_session,
            )
            pages: list[dict] = []
            built.append(refs.ref("chapter", chapter.chapter_uuid, chapter.name, activities=pages))
            # In a draft course the course itself is the gate: its pages are made
            # ready, so publishing the course from the dashboard shows them all.
            ready = not course.published
            for page_in, converted in zip(chapter_in.activities, chapter_docs):
                content = converted.doc
                activity = await create_activity(
                    ctx.request,
                    ActivityCreate(
                        name=page_in.name,
                        chapter_id=chapter.id,
                        activity_type=ActivityTypeEnum.TYPE_DYNAMIC,
                        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
                        content=content,
                        published=ready,
                    ),
                    ctx.user,
                    ctx.db_session,
                )
                ref = await activity_ref(
                    ctx, course.course_uuid, activity, published=ready, rich_blocks=_rich_blocks(content)
                )
                stored = await attach_media(ctx, activity.activity_uuid, converted.media)
                if stored:
                    stored.pop("version_after", None)
                    ref["media"] = stored
                pages.append(ref)
    except HTTPException as e:
        return {
            "chapters": built,
            "stopped": (
                f"Stopped early: {e.detail} Everything listed was created; add the rest "
                "with create_chapter and create_activity."
            ),
        }
    return {"chapters": built}


def _course_fields(p: CreateCourseParams | UpdateCourseParams, *, skip_empty: bool) -> dict:
    out: dict[str, Any] = {}
    for key in ("name", "description", "about"):
        value = getattr(p, key, None)
        if value is not None and not (skip_empty and value == ""):
            out[key] = value
    if p.learnings is not None and not (skip_empty and not p.learnings):
        out["learnings"] = _learnings_in(p.learnings)
    if p.tags is not None and not (skip_empty and not p.tags):
        out["tags"] = _tags_in(p.tags)
    return out


async def _create_course(ctx: ToolContext, p: CreateCourseParams):
    if p.copy_from_course_uuid:
        source = await refs.load(ctx, "course", p.copy_from_course_uuid)
        copy = await clone_course(ctx.request, source.course_uuid, ctx.user, ctx.db_session)
        await update_course(
            ctx.request,
            CourseUpdate(**_course_fields(p, skip_empty=True)),
            copy.course_uuid,
            ctx.user,
            ctx.db_session,
        )
        course = await refs.load(ctx, "course", copy.course_uuid)
        return changed(
            f"Copied '{source.name}' as '{course.name}' (a private draft).",
            course=await course_ref(ctx, course, published=False, public=False),
            copied_from=await course_ref(ctx, source),
            editor_url=await refs.web_url(ctx, "course_editor", course=course.course_uuid),
            outline=(await outline(ctx, course, editor=True))["chapters"],
        )

    docs = await _convert_pages(p.chapters)
    media = [m for row in docs for c in row for m in c.media]
    check_media(media)
    require_risky_approval(
        ctx,
        {},
        {"type": "doc", "content": [n for row in docs for c in row for n in c.doc.get("content") or []]},
        media_reason(media),
    )
    created = await create_course(
        ctx.request,
        ctx.org.id,
        CourseCreate(
            **{"description": "", "about": "", **_course_fields(p, skip_empty=False)},
            public=False,
            published=False,
            open_to_contributors=False,
            org_id=ctx.org.id,
        ),
        ctx.user,
        ctx.db_session,
        creation_source="ai",
    )
    course = await refs.load(ctx, "course", created.course_uuid)
    built = await _build_outline(ctx, course, p.chapters, docs) if p.chapters else {"chapters": []}
    pages = sum(len(c["activities"]) for c in built["chapters"])
    return changed(
        f"Created course '{course.name}' with {_count(len(built['chapters']), 'chapter')} and "
        f"{_count(pages, 'page')} as a private draft.",
        course=await course_ref(ctx, course, published=False, public=False),
        editor_url=await refs.web_url(ctx, "course_editor", course=course.course_uuid),
        next_step=_DRAFT_NEXT_STEP,
        **built,
    )


async def _set_thumbnail(ctx: ToolContext, course: Course, url: str) -> None:
    """Fetch an image from a link and store it as the course thumbnail."""
    check_url(url)
    require_approval(ctx, f"Fetches an image from an outside link ({urlsplit(url).hostname}).")
    fetched = await fetch(url, "image")
    try:
        upload = UploadFile(
            file=fetched.file,
            size=fetched.size,
            filename=f"thumbnail.{fetched.ext}",
            headers=Headers({"content-type": fetched.mime}),
        )
        await update_course_thumbnail(
            ctx.request, course.course_uuid, ctx.user, ctx.db_session, upload, ThumbnailType.IMAGE
        )
    finally:
        fetched.file.close()


_DRAFT_NEXT_STEP = (
    "Learners cannot see this draft yet; publishing the course shows all its pages at once. "
    "Unless the user asked to publish now, give them editor_url so they can review, edit "
    "and publish it themselves."
)


async def _update_course(ctx: ToolContext, p: UpdateCourseParams):
    course = await refs.load(ctx, "course", p.course_uuid)
    patch = _course_fields(p, skip_empty=False)
    for key in ("open_to_contributors", "published", "public"):
        value = getattr(p, key)
        if value is not None:
            patch[key] = value
    if not patch and p.publish_activities is None and p.thumbnail_url is None:
        raise HTTPException(status_code=400, detail="Nothing to change: pass at least one field.")
    if p.thumbnail_url is not None:
        await _set_thumbnail(ctx, course, p.thumbnail_url)
    if patch:
        await update_course(ctx.request, CourseUpdate(**patch), course.course_uuid, ctx.user, ctx.db_session)
    activities_changed = None
    if p.publish_activities is not None:
        await check_resource_access(
            ctx.request, ctx.db_session, ctx.user, course.course_uuid, AccessAction.UPDATE
        )
        pending = (
            await ctx.db_session.execute(
                select(Activity.activity_uuid).where(
                    Activity.course_id == course.id,
                    Activity.published.is_(not p.publish_activities),
                )
            )
        ).scalars().all()
        for activity_uuid in pending:
            await update_activity(
                ctx.request,
                ActivityUpdate(published=p.publish_activities),
                activity_uuid,
                ctx.user,
                ctx.db_session,
            )
        activities_changed = len(pending)
    await ctx.db_session.refresh(course)
    fields = sorted(patch) + (["thumbnail"] if p.thumbnail_url is not None else [])
    if activities_changed is not None:
        verb = "published" if p.publish_activities else "unpublished"
        fields.append(f"{activities_changed} activities {verb}")
    return changed(
        f"Updated course '{course.name}': {', '.join(fields)}.",
        course=await course_ref(ctx, course, published=bool(course.published), public=bool(course.public)),
        activities_changed=activities_changed,
    )


async def _delete_course(ctx: ToolContext, p: DeleteCourseParams):
    course = await refs.load(ctx, "course", p.course_uuid)
    chapters = (
        await ctx.db_session.execute(
            select(func.count(CourseChapter.id)).where(CourseChapter.course_id == course.id)
        )
    ).scalar_one()
    activities = (
        await ctx.db_session.execute(
            select(func.count(Activity.id)).where(Activity.course_id == course.id)
        )
    ).scalar_one()
    name = course.name
    await delete_course(ctx.request, course.course_uuid, ctx.user, ctx.db_session)
    return changed(
        f"Deleted course '{name}' with its {_count(chapters, 'chapter')} and {_count(activities, 'activity', 'activities')}.",
        course=refs.ref("course", p.course_uuid, name),
    )


async def _create_course_update(ctx: ToolContext, p: CreateCourseUpdateParams):
    course = await refs.load(ctx, "course", p.course_uuid)
    update = await create_update(
        ctx.request,
        course.course_uuid,
        CourseUpdateCreate(title=p.title, content=p.content),
        ctx.user,
        ctx.db_session,
    )
    return changed(
        f"Posted '{update.title}' on the page of '{course.name}'.",
        update={"kind": "course_update", "uuid": update.courseupdate_uuid, "title": update.title},
        course=await course_ref(ctx, course),
    )


# ─── specs ───────────────────────────────────────────────────────────────────


def _count(n: int, one: str, many: str | None = None) -> str:
    return f"{n} {one if n == 1 else (many or one + 's')}"


def _update_summary(p: UpdateCourseParams) -> str:
    """Says what the person is approving: who gains access, not field names."""
    parts = []
    if p.published is not None:
        parts.append("publish it for learners" if p.published else "unpublish it")
    if p.public is not None:
        parts.append("make it public (visible without signing in)" if p.public else "make it private")
    if p.publish_activities is not None:
        parts.append("publish all of its pages" if p.publish_activities else "unpublish all of its pages")
    if p.open_to_contributors is not None:
        parts.append("open it to contributors" if p.open_to_contributors else "close it to contributors")
    if p.thumbnail_url is not None:
        parts.append(f"set its thumbnail from {clip(p.thumbnail_url, 120)}")
    other = sorted(
        set(p.model_dump(exclude={"course_uuid"}, exclude_none=True))
        - {"published", "public", "publish_activities", "open_to_contributors", "thumbnail_url"}
    )
    if other:
        parts.append("change " + ", ".join(other))
    return f"Course {p.course_uuid}: " + ("; ".join(parts) or "no change")


def _create_summary(p: CreateCourseParams) -> str:
    if p.copy_from_course_uuid:
        return f"Copy course {p.copy_from_course_uuid} as '{clip(p.name, 80)}'"
    pages = sum(len(c.activities) for c in p.chapters)
    return f"Create course '{clip(p.name, 80)}' with {_count(len(p.chapters), 'chapter')} and {_count(pages, 'page')}"


SPECS: list[ToolSpec] = [
    ToolSpec(
        name="list_courses",
        title="List courses",
        description=(
            "List the organization's courses you can open, newest first, optionally "
            "filtered by text or published state. Drafts appear only for people who can "
            "edit them. Returns course refs with published/public flags and chapter counts."
        ),
        params_model=ListCoursesParams,
        tier=ActionTier.READ,
        rights_bucket="courses",
        access_action=AccessAction.READ,
        execute=_list_courses,
    ),
    ToolSpec(
        name="get_course",
        title="Get course",
        description=(
            "Read a course: its settings, learnings and tags, and its outline (chapters in "
            "order, each with its activities: uuid, type, published, link). Use it before "
            "editing or reorganizing a course. include_details adds authors and dates."
        ),
        params_model=GetCourseParams,
        tier=ActionTier.READ,
        rights_bucket="courses",
        access_action=AccessAction.READ,
        execute=_get_course,
        target_param="course_uuid",
        target_kind="course",
    ),
    ToolSpec(
        name="create_course",
        title="Create course",
        description=(
            "Create a course, optionally with its whole outline in one call: chapters in "
            "order, each with pages written in Markdown. Or copy an existing course with "
            "copy_from_course_uuid (an id or the course's name). Everything starts as a "
            "private draft the user reviews and publishes from editor_url. Returns every new "
            "id and link."
        ),
        params_model=CreateCourseParams,
        tier=ActionTier.CREATE,
        rights_bucket="courses",
        access_action=AccessAction.CREATE,
        execute=_create_course,
        # Copying needs edit rights on the source, like the dashboard.
        target_param="copy_from_course_uuid",
        target_access=AccessAction.UPDATE,
        target_kind="course",
        approval_in_call=True,
        open_world=True,
        summarize=_create_summary,
    ),
    ToolSpec(
        name="update_course",
        title="Update course",
        description=(
            "Change a course's name, texts, learnings, tags, contributor setting, or publish "
            "it / make it public. publish_activities publishes (or unpublishes) every "
            "activity at once; thumbnail_url sets the thumbnail from an image link. Only send "
            "what changes. Publishing, visibility changes and fetching a link need approval."
        ),
        params_model=UpdateCourseParams,
        tier=ActionTier.EDIT,
        rights_bucket="courses",
        access_action=AccessAction.UPDATE,
        execute=_update_course,
        target_param="course_uuid",
        target_kind="course",
        approval_if=lambda p: any(
            v is not None
            for v in (p.published, p.public, p.publish_activities, p.open_to_contributors)
        ),
        approval_in_call=True,
        open_world=True,
        idempotent=True,
        summarize=_update_summary,
    ),
    ToolSpec(
        name="delete_course",
        title="Delete course",
        description=(
            "Permanently delete a course with all its chapters, activities and files. "
            "Cannot be undone."
        ),
        params_model=DeleteCourseParams,
        tier=ActionTier.DESTRUCTIVE,
        rights_bucket="courses",
        access_action=AccessAction.DELETE,
        execute=_delete_course,
        target_param="course_uuid",
        target_kind="course",
        summarize=lambda p: f"Delete course {p.course_uuid} and everything in it",
    ),
    ToolSpec(
        name="create_course_update",
        title="Post course announcement",
        description=(
            "Post an announcement (title and plain text) in the course's updates section, "
            "visible to everyone who can open the course. It is shown on the course page "
            "only, not emailed. Needs approval."
        ),
        params_model=CreateCourseUpdateParams,
        tier=ActionTier.CREATE,
        rights_bucket="courses",
        access_action=AccessAction.UPDATE,
        execute=_create_course_update,
        target_param="course_uuid",
        target_kind="course",
        approval=True,
        summarize=lambda p: f"Post announcement '{clip(p.title, 80)}' on the course",
    ),
]
