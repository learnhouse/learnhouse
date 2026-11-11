"""Copy chapters and pages: chosen chapters (with their pages) and single
pages, into a chapter of the same course or of another course of the
organization.

Each page is copied the way duplicating a whole course copies it
(`clone_course`'s per-activity step): the row, its stored files and its
blocks, with every block, file and activity id inside the content pointed at
the copies, so a copy never shows (or later deletes) the original's files.

Copying needs edit rights on every source course, like duplicating a course:
pages carry drafts and quiz answers. Assignments are skipped, since their
tasks, grading and submissions live outside the page. Locks, learner progress
and version history are not copied.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from uuid import uuid4

from fastapi import HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import func
from sqlmodel import select

from src.db.courses.activities import Activity, ActivityTypeEnum
from src.db.courses.blocks import Block
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.chapters import Chapter
from src.db.courses.course_chapters import CourseChapter
from src.db.courses.courses import Course
from src.security.rbac import AccessAction, check_resource_access
from src.services.ai.rag.queue import index_activity, index_course
from src.services.ai.tools import refs
from src.services.ai.tools.base import ActionTier, ToolContext, ToolSpec
from src.services.ai.tools.chapters import (
    activity_ref,
    activity_type,
    course_of,
    course_ref,
    current_order,
    write_order,
)
from src.services.ai.tools.results import changed
from src.services.courses.courses import clone_activity
from src.services.courses.transfer.storage_utils import delete_storage_directory

MAX_CHAPTERS = 20
MAX_ACTIVITIES = 50
# Pages copied in one call, those inside copied chapters included.
MAX_TOTAL = 200

_SKIP_ASSIGNMENT = (
    "Assignments are not copied: their tasks, grading and submissions live outside the page. "
    "Create one with create_assignment."
)
_NOT_COPIED = (
    "Chapter and page locks are not copied (the copies are open to anyone who can open the "
    "course), nor learner progress or version history."
)


class CopyCourseItemsParams(BaseModel):
    course_uuid: str = Field(..., max_length=100, description="The course that receives the copies (course_...).")
    chapter_uuids: list[str] = Field(
        default_factory=list,
        max_length=MAX_CHAPTERS,
        description=f"Chapters to copy with all their pages, added to the course as new chapters (max {MAX_CHAPTERS}).",
    )
    activity_uuids: list[str] = Field(
        default_factory=list,
        max_length=MAX_ACTIVITIES,
        description=f"Single pages to copy into to_chapter_uuid (max {MAX_ACTIVITIES}).",
    )
    to_chapter_uuid: str | None = Field(
        None, max_length=100, description="Chapter of the course that receives the copied pages (needed with activity_uuids)."
    )
    position: int | None = Field(
        None,
        ge=0,
        description=(
            "0-based place of the copies: among the course's chapters for copied chapters, "
            "inside to_chapter_uuid for copied pages. Omit to add them at the end."
        ),
    )

    @model_validator(mode="after")
    def _check(self):
        if not self.chapter_uuids and not self.activity_uuids:
            raise ValueError("pass chapter_uuids, activity_uuids or both")
        if self.activity_uuids and not self.to_chapter_uuid:
            raise ValueError("activity_uuids need to_chapter_uuid, the chapter the copies go into")
        if len(set(self.chapter_uuids)) != len(self.chapter_uuids) or len(set(self.activity_uuids)) != len(
            self.activity_uuids
        ):
            raise ValueError("each id at most once")
        return self


# ─── helpers ─────────────────────────────────────────────────────────────────


def _course_path(ctx: ToolContext, course: Course) -> str:
    return f"content/orgs/{ctx.org.org_uuid}/courses/{course.course_uuid}"


async def _require_edit(ctx: ToolContext, course: Course, checked: set[int]) -> None:
    if course.id in checked:
        return
    await check_resource_access(ctx.request, ctx.db_session, ctx.user, course.course_uuid, AccessAction.UPDATE)
    checked.add(course.id)


async def _blocks_of(ctx: ToolContext, activities: list[Activity]) -> dict[int, list[Block]]:
    ids = [a.id for a in activities if a.activity_type == ActivityTypeEnum.TYPE_DYNAMIC]
    if not ids:
        return {}
    rows = (await ctx.db_session.execute(select(Block).where(Block.activity_id.in_(ids)))).scalars().all()
    out: dict[int, list[Block]] = defaultdict(list)
    for block in rows:
        out[block.activity_id].append(block)
    return out


async def _max_order(ctx: ToolContext, column, where) -> int:
    value = (await ctx.db_session.execute(select(func.max(column)).where(where))).scalar()
    return int(value or 0)


def _skipped(activity: Activity) -> dict:
    return refs.ref(
        "activity",
        activity.activity_uuid,
        activity.name,
        type=activity_type(activity.activity_type, activity.activity_sub_type),
        reason=_SKIP_ASSIGNMENT,
    )


# ─── executor ────────────────────────────────────────────────────────────────


async def _copy_course_items(ctx: ToolContext, p: CopyCourseItemsParams):
    target = await refs.load(ctx, "course", p.course_uuid)
    checked: set[int] = set()
    await _require_edit(ctx, target, checked)
    to_chapter = None
    if p.to_chapter_uuid:
        to_chapter = await refs.load(ctx, "chapter", p.to_chapter_uuid)
        if to_chapter.course_id != target.id:
            raise HTTPException(
                status_code=400,
                detail=f"to_chapter_uuid '{p.to_chapter_uuid}' is not a chapter of '{target.name}'. Read its outline with get_course.",
            )

    # Load and check everything before writing anything.
    chapter_plan: list[tuple[Chapter, Course, list[Activity]]] = []
    for uuid in p.chapter_uuids:
        chapter = await refs.load(ctx, "chapter", uuid)
        course = await course_of(ctx, chapter.course_id, "chapter", uuid)
        await _require_edit(ctx, course, checked)
        rows = (
            await ctx.db_session.execute(
                select(Activity)
                .join(ChapterActivity, ChapterActivity.activity_id == Activity.id)
                .where(ChapterActivity.chapter_id == chapter.id)
                .order_by(ChapterActivity.order, ChapterActivity.id)
            )
        ).scalars().all()
        unique = list({a.id: a for a in rows}.values())  # a page linked twice is copied once
        chapter_plan.append((chapter, course, unique))
    page_plan: list[tuple[Activity, Course]] = []
    for uuid in p.activity_uuids:
        activity = await refs.load(ctx, "activity", uuid)
        course = await course_of(ctx, activity.course_id, "activity", uuid)
        await _require_edit(ctx, course, checked)
        page_plan.append((activity, course))

    total = sum(len(acts) for _, _, acts in chapter_plan) + len(page_plan)
    if total > MAX_TOTAL:
        raise HTTPException(
            status_code=400,
            detail=f"That is {total} pages; copy at most {MAX_TOTAL} per call and the rest in another call.",
        )
    everything = [a for _, _, acts in chapter_plan for a in acts] + [a for a, _ in page_plan]
    blocks = await _blocks_of(ctx, everything)

    # A copy in a live course starts as a draft, like a new page; in a draft
    # course it keeps the original's state and shows once the course is published.
    live = bool(target.published)
    target_path = _course_path(ctx, target)
    copied_paths: list[str] = []
    skipped: list[dict] = []

    async def copy_one(activity: Activity, source: Course, chapter_id: int, order: int) -> Activity | None:
        if activity.activity_type == ActivityTypeEnum.TYPE_ASSIGNMENT:
            skipped.append(_skipped(activity))
            return None
        new = await clone_activity(
            ctx.db_session,
            activity,
            blocks.get(activity.id, []),
            org_uuid=ctx.org.org_uuid,
            org_id=ctx.org.id,
            source_course_path=_course_path(ctx, source),
            new_course_uuid=target.course_uuid,
            new_course_path=target_path,
            new_course_id=target.id,
            new_chapter_id=chapter_id,
            order=order,
            published=False if live else bool(activity.published),
        )
        copied_paths.append(f"{target_path}/activities/{new.activity_uuid}")
        return new

    new_chapters: list[tuple[Chapter, Chapter, list[tuple[Activity, Activity]]]] = []
    new_pages: list[tuple[Activity, Activity]] = []
    # A savepoint, so a failure drops only what this call added (rolling the
    # whole session back would expire objects the caller still holds).
    savepoint = await ctx.db_session.begin_nested()
    try:
        next_chapter = await _max_order(ctx, CourseChapter.order, CourseChapter.course_id == target.id)
        for k, (chapter, source, acts) in enumerate(chapter_plan, 1):
            now = str(datetime.now())
            copy = Chapter(
                name=chapter.name,
                description=chapter.description,
                thumbnail_image="",
                chapter_uuid=f"chapter_{uuid4()}",
                org_id=ctx.org.id,
                course_id=target.id,
                creation_date=now,
                update_date=now,
                extra_metadata=chapter.extra_metadata,
            )
            ctx.db_session.add(copy)
            await ctx.db_session.flush()
            ctx.db_session.add(
                CourseChapter(
                    course_id=target.id,
                    chapter_id=copy.id,
                    org_id=ctx.org.id,
                    order=next_chapter + k,
                    creation_date=now,
                    update_date=now,
                )
            )
            pairs = []
            for i, activity in enumerate(acts, 1):
                new = await copy_one(activity, source, copy.id, i)
                if new is not None:
                    pairs.append((activity, new))
            new_chapters.append((chapter, copy, pairs))
        if page_plan and to_chapter is not None:
            next_page = await _max_order(ctx, ChapterActivity.order, ChapterActivity.chapter_id == to_chapter.id)
            for k, (activity, source) in enumerate(page_plan, 1):
                new = await copy_one(activity, source, to_chapter.id, next_page + k)
                if new is not None:
                    new_pages.append((activity, new))
        await savepoint.commit()
    except Exception as e:
        await savepoint.rollback()
        for path in copied_paths:
            delete_storage_directory(path)
        if isinstance(e, HTTPException):
            raise
        raise HTTPException(status_code=500, detail="Copying failed; nothing was created.") from e
    await ctx.db_session.commit()

    if p.position is not None:
        await _place(ctx, target, p.position, [c.id for _, c, _ in new_chapters], to_chapter, [n.id for _, n in new_pages])
    for _, new in [pair for _, _, pairs in new_chapters for pair in pairs] + new_pages:
        index_activity(new.id)
    if new_chapters:
        index_course(target.id)

    async def page_ref(original: Activity, new: Activity) -> dict:
        return await activity_ref(
            ctx, target.course_uuid, new, published=bool(new.published), copied_from=original.activity_uuid
        )

    chapters_out = [
        refs.ref(
            "chapter",
            copy.chapter_uuid,
            copy.name,
            copied_from=chapter.chapter_uuid,
            activities=[await page_ref(o, n) for o, n in pairs],
        )
        for chapter, copy, pairs in new_chapters
    ]
    pages_out = [await page_ref(o, n) for o, n in new_pages]
    n_pages = sum(len(c["activities"]) for c in chapters_out) + len(pages_out)
    parts = []
    if chapters_out:
        parts.append(_count(len(chapters_out), "chapter"))
    parts.append(_count(n_pages, "page"))
    where = (
        "(drafts: learners see them once they are published)." if live
        else "(the course is a draft: they show once the course is published)."
    )
    return changed(
        f"Copied {' with '.join(parts)} into '{target.name}' {where}",
        course=await course_ref(ctx, target),
        chapters=chapters_out or None,
        to_chapter=refs.ref("chapter", to_chapter.chapter_uuid, to_chapter.name) if to_chapter else None,
        activities=pages_out or None,
        skipped=skipped or None,
        editor_url=await refs.web_url(ctx, "course_editor", course=target.course_uuid),
        note=_NOT_COPIED,
    )


async def _place(
    ctx: ToolContext,
    course: Course,
    position: int,
    chapter_ids: list[int],
    to_chapter: Chapter | None,
    activity_ids: list[int],
) -> None:
    """Move the new chapters (and the new pages inside to_chapter) to `position`."""
    order, _, _ = await current_order(ctx, course)
    before = [(cid, list(acts)) for cid, acts in order]
    if chapter_ids:
        moving = [entry for entry in order if entry[0] in chapter_ids]
        order = [entry for entry in order if entry[0] not in chapter_ids]
        at = min(position, len(order))
        order[at:at] = moving
    if activity_ids and to_chapter is not None:
        acts = next((a for cid, a in order if cid == to_chapter.id), None)
        if acts is not None:
            kept = [a for a in acts if a not in activity_ids]
            at = min(position, len(kept))
            acts[:] = kept[:at] + [a for a in acts if a in activity_ids] + kept[at:]
    if order != before:
        await write_order(ctx, course, order)


def _count(n: int, one: str) -> str:
    return f"{n} {one if n == 1 else one + 's'}"


def _summary(p: CopyCourseItemsParams) -> str:
    parts = []
    if p.chapter_uuids:
        parts.append(_count(len(p.chapter_uuids), "chapter"))
    if p.activity_uuids:
        parts.append(_count(len(p.activity_uuids), "page"))
    return f"Copy {' and '.join(parts)} into course {p.course_uuid}"


SPECS: list[ToolSpec] = [
    ToolSpec(
        name="copy_course_items",
        title="Copy chapters and pages",
        description=(
            "Copy chapters (with their pages) and/or single pages into a course of this "
            "organization, the same one or another, at the end or at a 0-based position. Pages "
            "keep their content, blocks and files. In a live course the copies start as drafts. "
            "Assignments are skipped and listed; locks are not copied. To duplicate a whole "
            "course, use create_course with copy_from_course_uuid."
        ),
        params_model=CopyCourseItemsParams,
        tier=ActionTier.CREATE,
        rights_bucket="courses",
        access_action=AccessAction.UPDATE,
        execute=_copy_course_items,
        target_param="course_uuid",
        target_kind="course",
        summarize=_summary,
    ),
]
