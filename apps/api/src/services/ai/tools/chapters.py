"""Course structure tools: chapters, and moving chapters and activities.

A course is an ordered list of chapters; a chapter is an ordered list of
activities. Chapters are addressed by ``chapter_uuid`` and every id is loaded
from the connected organization first. Moves are applied to the course's
current order, computed here from the database, and the whole new order is
written with the same service the course editor uses, so an item can never be
dropped by leaving it out.

The structure helpers (outline, current order, placement) are shared with the
course and activity tools.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from fastapi import HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlmodel import select

from src.db.courses.activities import Activity, ActivitySubTypeEnum, ActivityTypeEnum
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.chapters import (
    ActivityOrder,
    Chapter,
    ChapterCreate,
    ChapterOrder,
    ChapterUpdate,
    ChapterUpdateOrder,
    LockType,
)
from src.db.courses.course_chapters import CourseChapter
from src.db.courses.courses import Course
from src.security.rbac import AccessAction, check_resource_access
from src.services.ai.tools import refs
from src.services.ai.tools.base import ActionTier, ToolContext, ToolSpec, require_approval
from src.services.ai.tools.results import changed, clip
from src.services.courses.chapters import (
    create_chapter,
    delete_chapter,
    get_course_chapters,
    reorder_chapters_and_activities,
    update_chapter,
)

# Most activities an outline lists before it is cut (keeps results small).
OUTLINE_MAX_ACTIVITIES = 200
MAX_MOVES = 100


# ─── shared helpers ──────────────────────────────────────────────────────────


def iso(value: Any) -> str | None:
    """Stored dates are ``str(datetime.now())``; return ISO 8601."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value)).isoformat()
    except ValueError:
        return str(value)


_TYPE_NAMES = {
    ActivityTypeEnum.TYPE_VIDEO.value: "video",
    ActivityTypeEnum.TYPE_DOCUMENT.value: "document",
    ActivityTypeEnum.TYPE_ASSIGNMENT.value: "assignment",
    ActivityTypeEnum.TYPE_SCORM.value: "scorm",
    ActivityTypeEnum.TYPE_PLAY.value: "play",
    ActivityTypeEnum.TYPE_CUSTOM.value: "custom",
}
_DYNAMIC_NAMES = {
    ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE.value: "page",
    ActivitySubTypeEnum.SUBTYPE_DYNAMIC_MARKDOWN.value: "page",
    ActivitySubTypeEnum.SUBTYPE_DYNAMIC_EMBED.value: "embed",
    ActivitySubTypeEnum.SUBTYPE_DYNAMIC_RESOURCE.value: "resource",
}


def activity_type(type_: Any, sub_type: Any) -> str:
    """The lower_snake kind of an activity ("page", "video", ...)."""
    type_ = getattr(type_, "value", type_)
    sub_type = getattr(sub_type, "value", sub_type)
    if type_ == ActivityTypeEnum.TYPE_DYNAMIC.value:
        return _DYNAMIC_NAMES.get(sub_type, "page")
    return _TYPE_NAMES.get(type_, str(type_ or "unknown").lower())


async def can_edit_course(ctx: ToolContext, course_uuid: str) -> bool:
    """Whether the caller may edit the course (sees drafts, editor links)."""
    try:
        decision = await check_resource_access(
            ctx.request,
            ctx.db_session,
            ctx.user,
            course_uuid,
            AccessAction.UPDATE,
            raise_on_deny=False,
        )
    except HTTPException:
        return False
    return bool(decision.allowed)


async def course_of(ctx: ToolContext, course_id: int, kind: str, uuid: str) -> Course:
    """The course a chapter or activity belongs to, in this organization."""
    course = await ctx.db_session.get(Course, course_id)
    if course is None or course.org_id != ctx.org.id:
        raise refs.not_found(kind, uuid)
    return course


async def course_ref(ctx: ToolContext, course: Course, **extra) -> dict:
    url = await refs.web_url(ctx, "course", course=course.course_uuid)
    return refs.ref("course", course.course_uuid, course.name, url, **extra)


async def activity_ref(ctx: ToolContext, course_uuid: str, activity: Any, **extra) -> dict:
    url = await refs.web_url(ctx, "activity", course=course_uuid, activity=activity.activity_uuid)
    return refs.ref(
        "activity",
        activity.activity_uuid,
        activity.name,
        url,
        type=activity_type(activity.activity_type, activity.activity_sub_type),
        **extra,
    )


async def outline(ctx: ToolContext, course: Course, *, editor: bool) -> dict:
    """The course's chapters in order, each with its activities in order.

    Drafts (unpublished activities) are listed only for people who can edit
    the course, like the course page does."""
    chapters = await get_course_chapters(
        ctx.request,
        course.id,
        ctx.db_session,
        ctx.user,
        editor,
        slim=True,
        course=course,
    )
    listed = 0
    truncated = False
    out: list[dict] = []
    for chapter in chapters:
        activities: list[dict] = []
        hidden = 0
        for activity in chapter.activities:
            if listed >= OUTLINE_MAX_ACTIVITIES:
                hidden += 1
                continue
            listed += 1
            extra: dict[str, Any] = {"published": bool(activity.published)}
            if activity.is_locked:
                extra["locked"] = True
            activities.append(await activity_ref(ctx, course.course_uuid, activity, **extra))
        entry = refs.ref("chapter", chapter.chapter_uuid, chapter.name, activities=activities)
        if hidden:
            entry["more_activities"] = hidden
            truncated = True
        if chapter.is_locked:
            entry["locked"] = True
        lock = getattr(chapter.lock_type, "value", chapter.lock_type)
        if editor and lock and lock != LockType.PUBLIC.value:
            entry["lock"] = lock
        out.append(entry)
    result: dict[str, Any] = {"chapters": out}
    if truncated:
        result["truncated"] = (
            f"Only the first {OUTLINE_MAX_ACTIVITIES} activities are listed; "
            "search inside this course to find the others."
        )
    return result


# The course's order as [(chapter_id, [activity_id, ...]), ...].
Order = list[tuple[int, list[int]]]


async def current_order(ctx: ToolContext, course: Course) -> tuple[Order, dict, dict]:
    """Every chapter and activity link of the course, in order, read from the
    database (drafts included). Returns the order plus uuid -> id maps for
    the chapters and activities in it."""
    chapter_rows = (
        await ctx.db_session.execute(
            select(Chapter.id, Chapter.chapter_uuid)
            .join(CourseChapter, CourseChapter.chapter_id == Chapter.id)
            .where(CourseChapter.course_id == course.id, Chapter.course_id == course.id)
            .order_by(CourseChapter.order, CourseChapter.id)
        )
    ).all()
    order: Order = []
    chapters: dict[str, int] = {}
    for chapter_id, chapter_uuid in chapter_rows:
        if chapter_uuid in chapters:
            continue
        chapters[chapter_uuid] = chapter_id
        order.append((chapter_id, []))
    by_chapter = {chapter_id: acts for chapter_id, acts in order}

    link_rows = (
        await ctx.db_session.execute(
            select(ChapterActivity.chapter_id, Activity.id, Activity.activity_uuid)
            .join(Activity, Activity.id == ChapterActivity.activity_id)
            .where(ChapterActivity.course_id == course.id)
            .order_by(ChapterActivity.chapter_id, ChapterActivity.order, ChapterActivity.id)
        )
    ).all()
    activities: dict[str, int] = {}
    for chapter_id, activity_id, activity_uuid in link_rows:
        acts = by_chapter.get(chapter_id)
        if acts is None or activity_id in acts:
            continue
        acts.append(activity_id)
        activities.setdefault(activity_uuid, activity_id)
    return order, chapters, activities


async def write_order(ctx: ToolContext, course: Course, order: Order) -> None:
    await reorder_chapters_and_activities(
        ctx.request,
        course.course_uuid,
        ChapterUpdateOrder(
            chapter_order_by_ids=[
                ChapterOrder(
                    chapter_id=chapter_id,
                    activities_order_by_ids=[ActivityOrder(activity_id=a) for a in acts],
                )
                for chapter_id, acts in order
            ]
        ),
        ctx.user,
        ctx.db_session,
    )


async def place_chapter(ctx: ToolContext, course: Course, chapter_id: int, position: int) -> None:
    """Move one chapter to a 0-based position."""
    order, _, _ = await current_order(ctx, course)
    index = next((i for i, (cid, _) in enumerate(order) if cid == chapter_id), None)
    if index is None or index == min(position, len(order) - 1):
        return
    entry = order.pop(index)
    order.insert(min(position, len(order)), entry)
    await write_order(ctx, course, order)


async def place_activity(
    ctx: ToolContext, course: Course, chapter_id: int, activity_id: int, position: int
) -> None:
    """Move one activity to a 0-based position inside its chapter."""
    order, _, _ = await current_order(ctx, course)
    acts = next((a for cid, a in order if cid == chapter_id), None)
    if acts is None or activity_id not in acts:
        return
    if acts.index(activity_id) == min(position, len(acts) - 1):
        return
    acts.remove(activity_id)
    acts.insert(min(position, len(acts)), activity_id)
    await write_order(ctx, course, order)


async def _load_chapter(ctx: ToolContext, chapter_uuid: str) -> tuple[Chapter, Course]:
    chapter = await refs.load(ctx, "chapter", chapter_uuid)
    course = await course_of(ctx, chapter.course_id, "chapter", chapter_uuid)
    return chapter, course


# ─── params ──────────────────────────────────────────────────────────────────

_CHAPTER_UUID = Field(..., max_length=100, description="The chapter (chapter_...).")
_COURSE_UUID = Field(..., max_length=100, description="The course (course_...).")


class CreateChapterParams(BaseModel):
    course_uuid: str = _COURSE_UUID
    name: str = Field(..., min_length=1, max_length=200, description="Chapter name.")
    description: str = Field("", max_length=1000, description="Optional short description.")
    position: int | None = Field(
        None, ge=0, le=1000, description="0-based place among the chapters; omit to add at the end."
    )


class UpdateChapterParams(BaseModel):
    chapter_uuid: str = _CHAPTER_UUID
    name: str | None = Field(None, min_length=1, max_length=200, description="New name.")
    description: str | None = Field(None, max_length=1000, description="New description.")
    lock: Literal["public", "authenticated", "restricted"] | None = Field(
        None,
        description=(
            "Who may open the chapter's activities: 'public' (anyone who can see the "
            "course), 'authenticated' (signed in), 'restricted' (only usergroups "
            "assigned to the chapter in the dashboard, plus admins)."
        ),
    )


class DeleteChapterParams(BaseModel):
    chapter_uuid: str = _CHAPTER_UUID


class Move(BaseModel):
    item_uuid: str = Field(..., max_length=100, description="The chapter_... or activity_... to move.")
    to_chapter_uuid: str | None = Field(
        None,
        max_length=100,
        description="Activities only: the chapter to move it into. Omit to stay in its chapter (or the anchor's).",
    )
    before_uuid: str | None = Field(
        None, max_length=100, description="Put it just before this item (same kind as item_uuid)."
    )
    after_uuid: str | None = Field(
        None, max_length=100, description="Put it just after this item (same kind as item_uuid)."
    )
    position: int | None = Field(
        None, ge=0, le=10_000,
        description="Place among its siblings: 0 is first, 1 second; 10000 means last.",
    )

    @model_validator(mode="after")
    def _one_anchor(self):
        if sum(x is not None for x in (self.before_uuid, self.after_uuid, self.position)) > 1:
            raise ValueError("give at most one of before_uuid, after_uuid, position")
        return self


class MoveCourseItemsParams(BaseModel):
    course_uuid: str = _COURSE_UUID
    moves: list[Move] = Field(
        ...,
        min_length=1,
        max_length=MAX_MOVES,
        description="Moves applied in order to the course's current structure.",
    )


# ─── executors ───────────────────────────────────────────────────────────────


async def _create_chapter(ctx: ToolContext, p: CreateChapterParams):
    course = await refs.load(ctx, "course", p.course_uuid)
    chapter = await create_chapter(
        ctx.request,
        ChapterCreate(
            name=p.name,
            description=p.description,
            org_id=course.org_id,
            course_id=course.id,
        ),
        ctx.user,
        ctx.db_session,
    )
    if p.position is not None:
        await place_chapter(ctx, course, chapter.id, p.position)
    return changed(
        f"Created chapter '{chapter.name}' in '{course.name}'.",
        chapter=refs.ref("chapter", chapter.chapter_uuid, chapter.name),
        course=await course_ref(ctx, course),
        editor_url=await refs.web_url(ctx, "course_editor", course=course.course_uuid),
    )


async def _update_chapter(ctx: ToolContext, p: UpdateChapterParams):
    chapter, course = await _load_chapter(ctx, p.chapter_uuid)
    patch = p.model_dump(include={"name", "description"}, exclude_none=True)
    if p.lock is not None:
        patch["lock_type"] = LockType(p.lock)
    if not patch:
        raise HTTPException(status_code=400, detail="Nothing to change: pass name, description or lock.")
    previous = {
        "name": chapter.name,
        "description": chapter.description or "",
        "lock": getattr(chapter.lock_type, "value", chapter.lock_type),
    }
    updated = await update_chapter(ctx.request, ChapterUpdate(**patch), chapter.id, ctx.user, ctx.db_session)
    fields = ", ".join(sorted(k if k != "lock_type" else "lock" for k in patch))
    undo_args = {"chapter_uuid": chapter.chapter_uuid}
    for key in patch:
        name = "lock" if key == "lock_type" else key
        undo_args[name] = previous[name]
    return changed(
        f"Updated chapter '{updated.name}' ({fields}).",
        chapter=refs.ref(
            "chapter",
            chapter.chapter_uuid,
            updated.name,
            lock=getattr(updated.lock_type, "value", updated.lock_type),
        ),
        course=await course_ref(ctx, course),
        undo={"tool": "update_chapter", "args": undo_args},
    )


async def _delete_chapter(ctx: ToolContext, p: DeleteChapterParams):
    chapter, course = await _load_chapter(ctx, p.chapter_uuid)
    count = len(
        (
            await ctx.db_session.execute(
                select(ChapterActivity.activity_id).where(ChapterActivity.chapter_id == chapter.id)
            )
        ).all()
    )
    name = chapter.name
    await delete_chapter(ctx.request, chapter.id, ctx.user, ctx.db_session)
    return changed(
        f"Deleted chapter '{name}' and its {count} activities from '{course.name}'.",
        chapter=refs.ref("chapter", p.chapter_uuid, name),
        course=await course_ref(ctx, course),
        activities_deleted=count,
    )


def _kind(uuid: str | None, field: str) -> str:
    kind = refs.kind_of(uuid)
    if kind not in ("chapter", "activity"):
        raise HTTPException(
            status_code=400,
            detail=f"{field} must be a chapter_... or activity_... id, got '{uuid}'.",
        )
    return kind


def _id_in(course_name: str, uuid: str, ids: dict, kind: str) -> int:
    if uuid not in ids:
        raise HTTPException(
            status_code=404,
            detail=f"No {kind} '{uuid}' in course '{course_name}'. Read the course outline with get_course.",
        )
    return ids[uuid]


def _apply_move(order: Order, m: Move, chapters: dict, activities: dict, course_name: str) -> None:
    kind = _kind(m.item_uuid, "item_uuid")
    anchor_uuid = m.before_uuid or m.after_uuid
    if anchor_uuid and _kind(anchor_uuid, "before_uuid/after_uuid") != kind:
        raise HTTPException(
            status_code=400,
            detail=f"Move {m.item_uuid} relative to another {kind}, not to '{anchor_uuid}'.",
        )
    if anchor_uuid == m.item_uuid:
        raise HTTPException(status_code=400, detail="An item cannot be placed relative to itself.")

    if kind == "chapter":
        if m.to_chapter_uuid:
            raise HTTPException(status_code=400, detail="to_chapter_uuid is only for moving activities.")
        chapter_id = _id_in(course_name, m.item_uuid, chapters, "chapter")
        if not anchor_uuid and m.position is None:
            raise HTTPException(
                status_code=400,
                detail=f"Say where to move {m.item_uuid}: before_uuid, after_uuid or position.",
            )
        anchor_id = _id_in(course_name, anchor_uuid, chapters, "chapter") if anchor_uuid else None
        index = next(i for i, (cid, _) in enumerate(order) if cid == chapter_id)
        entry = order.pop(index)
        if anchor_id is not None:
            at = next(i for i, (cid, _) in enumerate(order) if cid == anchor_id)
            order.insert(at + (1 if m.after_uuid else 0), entry)
        else:
            order.insert(min(m.position, len(order)), entry)
        return

    activity_id = _id_in(course_name, m.item_uuid, activities, "activity")
    source = next(acts for _, acts in order if activity_id in acts)
    target = source
    if m.to_chapter_uuid:
        if refs.kind_of(m.to_chapter_uuid) != "chapter":
            raise HTTPException(
                status_code=400,
                detail=f"to_chapter_uuid must be a chapter_... id, got '{m.to_chapter_uuid}'.",
            )
        to_id = _id_in(course_name, m.to_chapter_uuid, chapters, "chapter")
        target = next(acts for cid, acts in order if cid == to_id)
    anchor_id = None
    if anchor_uuid:
        anchor_id = _id_in(course_name, anchor_uuid, activities, "activity")
        anchor_chapter = next(acts for _, acts in order if anchor_id in acts)
        if m.to_chapter_uuid and anchor_chapter is not target:
            raise HTTPException(
                status_code=400,
                detail=f"{anchor_uuid} is not in chapter {m.to_chapter_uuid}.",
            )
        target = anchor_chapter
    if not (m.to_chapter_uuid or anchor_uuid or m.position is not None):
        raise HTTPException(
            status_code=400,
            detail=f"Say where to move {m.item_uuid}: to_chapter_uuid, before_uuid, after_uuid or position.",
        )
    source.remove(activity_id)
    if anchor_id is not None:
        target.insert(target.index(anchor_id) + (1 if m.after_uuid else 0), activity_id)
    elif m.position is not None:
        target.insert(min(m.position, len(target)), activity_id)
    else:
        target.append(activity_id)


# How far a chapter lock narrows who may open its activities.
_LOCK_RANK = {LockType.PUBLIC.value: 0, LockType.AUTHENTICATED.value: 1, LockType.RESTRICTED.value: 2}


async def _widens_access(ctx: ToolContext, course: Course, before: Order, after: Order) -> bool:
    """Whether some activity lands in a chapter that lets more people open it
    than the chapter it left. Two restricted chapters may name different
    usergroups, so a move between them counts as widening too."""
    was_in = {a: cid for cid, acts in before for a in acts}
    moved = [(was_in.get(a), cid) for cid, acts in after for a in acts if was_in.get(a) != cid]
    if not moved:
        return False
    rows = (
        await ctx.db_session.execute(
            select(Chapter.id, Chapter.lock_type).where(Chapter.course_id == course.id)
        )
    ).all()
    # Unknown lock values rank as restricted (fail closed).
    rank = {cid: _LOCK_RANK.get(getattr(lock, "value", lock) or "public", 2) for cid, lock in rows}
    for source, target in moved:
        src, dst = rank.get(source, 2), rank.get(target, 0)
        if dst < src or (src == dst == 2):
            return True
    return False


async def _move_course_items(ctx: ToolContext, p: MoveCourseItemsParams):
    course = await refs.load(ctx, "course", p.course_uuid)
    order, chapters, activities = await current_order(ctx, course)
    before = [(cid, list(acts)) for cid, acts in order]
    for m in p.moves:
        _apply_move(order, m, chapters, activities, course.name)
    if await _widens_access(ctx, course, before, order):
        require_approval(
            ctx, "Moving an activity into a chapter with a looser lock needs the user's approval."
        )
    if order != before:
        await write_order(ctx, course, order)
    return changed(
        f"Applied {len(p.moves)} move(s) in '{course.name}'.",
        course=await course_ref(ctx, course),
        outline=(await outline(ctx, course, editor=True))["chapters"],
        undo=_restore_order(course, before, chapters, activities) if order != before else None,
    )


def _restore_order(course: Course, before: Order, chapters: dict, activities: dict) -> dict | None:
    """The move_course_items call that puts every chapter and activity back
    where it was, or None when that takes more moves than one call allows."""
    chapter_uuid = {cid: uuid for uuid, cid in chapters.items()}
    activity_uuid = {aid: uuid for uuid, aid in activities.items()}
    moves: list[dict] = []
    for i, (cid, acts) in enumerate(before):
        moves.append({"item_uuid": chapter_uuid[cid], "position": i})
        for j, aid in enumerate(acts):
            moves.append({"item_uuid": activity_uuid[aid], "to_chapter_uuid": chapter_uuid[cid], "position": j})
    if len(moves) > MAX_MOVES:
        return None
    return {"tool": "move_course_items", "args": {"course_uuid": course.course_uuid, "moves": moves}}


# ─── specs ───────────────────────────────────────────────────────────────────

SPECS: list[ToolSpec] = [
    ToolSpec(
        name="create_chapter",
        title="Create chapter",
        description=(
            "Add a chapter to a course, at the end or at a 0-based position. Add pages to "
            "it with create_activity. Returns the new chapter_uuid."
        ),
        params_model=CreateChapterParams,
        tier=ActionTier.CREATE,
        rights_bucket="coursechapters",
        access_action=AccessAction.CREATE,
        execute=_create_chapter,
        target_param="course_uuid",
        target_kind="course",
        summarize=lambda p: f"Add chapter '{clip(p.name, 80)}' to the course",
    ),
    ToolSpec(
        name="update_chapter",
        title="Update chapter",
        description=(
            "Rename a chapter, change its description, or set who may open its "
            "activities (lock). Only send what changes. Changing the lock needs approval."
        ),
        params_model=UpdateChapterParams,
        tier=ActionTier.EDIT,
        rights_bucket="coursechapters",
        access_action=AccessAction.UPDATE,
        execute=_update_chapter,
        target_param="chapter_uuid",
        target_kind="chapter",
        approval_if=lambda p: p.lock is not None,
        idempotent=True,
        summarize=lambda p: "Update chapter: "
        + ", ".join(sorted(p.model_dump(exclude={"chapter_uuid"}, exclude_none=True)) or ["nothing"]),
    ),
    ToolSpec(
        name="delete_chapter",
        title="Delete chapter",
        description=(
            "Permanently delete a chapter together with its activities and their files "
            "(an activity also linked from another chapter is kept). Cannot be undone."
        ),
        params_model=DeleteChapterParams,
        tier=ActionTier.DESTRUCTIVE,
        rights_bucket="coursechapters",
        access_action=AccessAction.DELETE,
        execute=_delete_chapter,
        target_param="chapter_uuid",
        target_kind="chapter",
        summarize=lambda p: f"Delete chapter {p.chapter_uuid} and all its activities",
    ),
    ToolSpec(
        name="move_course_items",
        title="Move chapters and activities",
        description=(
            "Reorder a course: move chapters, or move activities within or between "
            "chapters, each placed before/after another item or at a 0-based position. "
            "Moves apply in order to the current structure; nothing else changes. Moving an "
            "activity into a chapter with a looser lock needs approval. Returns the new outline."
        ),
        params_model=MoveCourseItemsParams,
        tier=ActionTier.EDIT,
        rights_bucket="coursechapters",
        access_action=AccessAction.UPDATE,
        execute=_move_course_items,
        target_param="course_uuid",
        target_kind="course",
        approval_in_call=True,
        idempotent=True,
        summarize=lambda p: f"Move {len(p.moves)} item(s) in the course structure",
    ),
]
