"""Chapter tools — list/create/update/delete chapters + course reordering.

Every tool wraps an existing chapter service function in-process, passing
`ctx.request` / `ctx.user` / `ctx.db_session` so the services' own RBAC
checks stay authoritative. Chapters are addressed by their integer `id`
(the chapter services key on ids, not uuids); agents obtain ids from
`list_course_chapters` or `get_course_structure`.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from src.db.courses.chapters import (
    ActivityOrder,
    ChapterCreate,
    ChapterOrder,
    ChapterUpdate,
    ChapterUpdateOrder,
    LockType,
)
from src.security.rbac import AccessAction
from src.services.ai.tools.base import ActionTier, ToolContext, ToolSpec, jsonable
from src.services.courses.chapters import (
    create_chapter,
    delete_chapter,
    get_course_chapters,
    reorder_chapters_and_activities,
    update_chapter,
)
from src.services.courses.courses import get_course


def _compact_activity(activity) -> dict:
    data = jsonable(activity)
    keep = (
        "id",
        "activity_uuid",
        "name",
        "activity_type",
        "activity_sub_type",
        "published",
    )
    return {k: data.get(k) for k in keep if k in data}


def _compact_chapter(chapter) -> dict:
    data = jsonable(chapter)
    keep = (
        "id",
        "chapter_uuid",
        "name",
        "description",
        "lock_type",
        "is_locked",
        "update_date",
    )
    out = {k: data.get(k) for k in keep if k in data}
    desc = out.get("description")
    if isinstance(desc, str) and len(desc) > 280:
        out["description"] = desc[:280] + "…"
    activities = data.get("activities") or []
    out["activities"] = [_compact_activity(a) for a in activities]
    return out


# ─── params ────────────────────────────────────────────────────────────────


class ListCourseChaptersParams(BaseModel):
    course_uuid: str
    include_unpublished_activities: bool = True


class CreateChapterParams(BaseModel):
    course_uuid: str = Field(..., description="Course to add the chapter to")
    name: str = Field(..., min_length=1, max_length=200)
    description: str = ""


class UpdateChapterParams(BaseModel):
    chapter_id: int = Field(
        ..., ge=1, description="Chapter id from list_course_chapters"
    )
    name: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = None
    lock_type: LockType | None = Field(
        None,
        description=(
            "Access lock: 'public' (anyone), 'authenticated' (signed-in "
            "users), or 'restricted' (assigned usergroups only)"
        ),
    )


class DeleteChapterParams(BaseModel):
    chapter_id: int = Field(
        ..., ge=1, description="Chapter id from list_course_chapters"
    )
    confirm: bool | None = None


class ChapterOrderSpec(BaseModel):
    chapter_id: int = Field(..., ge=1)
    activity_ids: list[int] = Field(
        default_factory=list,
        description="ALL of this chapter's activity ids, in the desired order",
    )


class ReorderCourseStructureParams(BaseModel):
    course_uuid: str
    chapters: list[ChapterOrderSpec] = Field(
        ...,
        min_length=1,
        description=(
            "The COMPLETE ordered list of the course's chapters with their "
            "activities. Chapters or activities omitted here are unlinked "
            "from the course, so always start from the current structure."
        ),
    )


# ─── executors ─────────────────────────────────────────────────────────────


async def _list_course_chapters(ctx: ToolContext, p: ListCourseChaptersParams):
    course = await get_course(ctx.request, p.course_uuid, ctx.user, ctx.db_session)
    chapters = await get_course_chapters(
        ctx.request,
        course.id,
        ctx.db_session,
        ctx.user,
        p.include_unpublished_activities,
        slim=True,
    )
    return [_compact_chapter(c) for c in chapters]


async def _create_chapter(ctx: ToolContext, p: CreateChapterParams):
    course = await get_course(ctx.request, p.course_uuid, ctx.user, ctx.db_session)
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
    return _compact_chapter(chapter)


async def _update_chapter(ctx: ToolContext, p: UpdateChapterParams):
    patch = p.model_dump(exclude={"chapter_id"}, exclude_none=True)
    chapter = await update_chapter(
        ctx.request,
        ChapterUpdate(**patch),
        p.chapter_id,
        ctx.user,
        ctx.db_session,
    )
    return _compact_chapter(chapter)


async def _delete_chapter(ctx: ToolContext, p: DeleteChapterParams):
    return jsonable(
        await delete_chapter(ctx.request, p.chapter_id, ctx.user, ctx.db_session)
    )


async def _reorder_course_structure(ctx: ToolContext, p: ReorderCourseStructureParams):
    order = ChapterUpdateOrder(
        chapter_order_by_ids=[
            ChapterOrder(
                chapter_id=c.chapter_id,
                activities_order_by_ids=[
                    ActivityOrder(activity_id=a) for a in c.activity_ids
                ],
            )
            for c in p.chapters
        ]
    )
    return jsonable(
        await reorder_chapters_and_activities(
            ctx.request,
            p.course_uuid,
            order,
            ctx.user,
            ctx.db_session,
        )
    )


# ─── specs ─────────────────────────────────────────────────────────────────

SPECS: list[ToolSpec] = [
    ToolSpec(
        name="list_course_chapters",
        description=(
            "List a course's chapters in order, each with its activities "
            "(ids, uuids, names, types). Use this to get the chapter_id / "
            "activity ids needed by the other chapter tools."
        ),
        params_model=ListCourseChaptersParams,
        tier=ActionTier.READ,
        rights_bucket="coursechapters",
        access_action=AccessAction.READ,
        execute=_list_course_chapters,
        target_param="course_uuid",
        target_kind="course",
    ),
    ToolSpec(
        name="create_chapter",
        description=(
            "Add a new chapter to a course (appended at the end; use "
            "reorder_course_structure to move it)."
        ),
        params_model=CreateChapterParams,
        tier=ActionTier.CREATE,
        rights_bucket="coursechapters",
        access_action=AccessAction.CREATE,
        execute=_create_chapter,
        target_param="course_uuid",
        target_kind="course",
        summarize=lambda p: f'Create chapter "{p.name}"',
    ),
    ToolSpec(
        name="update_chapter",
        description=(
            "Update a chapter's name, description, or access lock. Only "
            "send fields to change. Get chapter_id from "
            "list_course_chapters."
        ),
        params_model=UpdateChapterParams,
        tier=ActionTier.EDIT,
        rights_bucket="coursechapters",
        access_action=AccessAction.UPDATE,
        execute=_update_chapter,
        target_kind="chapter",
        summarize=lambda p: "Update chapter fields: "
        + ", ".join(p.model_dump(exclude={"chapter_id"}, exclude_none=True) or ["-"]),
    ),
    ToolSpec(
        name="delete_chapter",
        description=(
            "Permanently delete a chapter and unlink its activities from "
            "the course. Irreversible."
        ),
        params_model=DeleteChapterParams,
        tier=ActionTier.DESTRUCTIVE,
        rights_bucket="coursechapters",
        access_action=AccessAction.DELETE,
        execute=_delete_chapter,
        target_kind="chapter",
        summarize=lambda p: f"Delete chapter #{p.chapter_id}",
    ),
    ToolSpec(
        name="reorder_course_structure",
        description=(
            "Reorder a course's chapters and move activities between "
            "chapters by sending the FULL desired structure (every chapter "
            "with all its activity ids, in order). Anything omitted is "
            "unlinked from the course — call list_course_chapters first "
            "and edit that structure."
        ),
        params_model=ReorderCourseStructureParams,
        tier=ActionTier.EDIT,
        rights_bucket="coursechapters",
        access_action=AccessAction.UPDATE,
        execute=_reorder_course_structure,
        target_param="course_uuid",
        target_kind="course",
        summarize=lambda p: f"Reorder chapters/activities ({len(p.chapters)} chapters)",
    ),
]
