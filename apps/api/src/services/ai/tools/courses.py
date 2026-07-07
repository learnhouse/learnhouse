"""Course tools — list/search/read/create/update/clone/delete + updates.

Exemplar domain module: every tool wraps an existing service function
in-process, passing `ctx.request` / `ctx.user` / `ctx.db_session` so the
service's own RBAC checks stay authoritative. Params models are curated
subsets of the service schemas — enough for an agent, nothing internal.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from src.db.courses.course_updates import CourseUpdateCreate
from src.db.courses.courses import CourseCreate, CourseUpdate
from src.security.rbac import AccessAction
from src.services.ai.tools.base import ActionTier, ToolContext, ToolSpec, jsonable
from src.services.courses.courses import (
    clone_course,
    create_course,
    delete_course,
    get_course,
    get_course_meta,
    get_courses_orgslug,
    search_courses,
    update_course,
)
from src.services.courses.updates import create_update


def _compact_course(course) -> dict:
    data = jsonable(course)
    keep = (
        "course_uuid",
        "name",
        "description",
        "published",
        "public",
        "tags",
        "thumbnail_image",
        "update_date",
    )
    out = {k: data.get(k) for k in keep if k in data}
    desc = out.get("description")
    if isinstance(desc, str) and len(desc) > 280:
        out["description"] = desc[:280] + "…"
    return out


# ─── params ────────────────────────────────────────────────────────────────


class ListCoursesParams(BaseModel):
    page: int = Field(1, ge=1)
    limit: int = Field(20, ge=1, le=100)
    include_unpublished: bool = True


class SearchCoursesParams(BaseModel):
    query: str = Field(..., min_length=1, description="Free-text course search")
    page: int = Field(1, ge=1)
    limit: int = Field(20, ge=1, le=100)


class GetCourseParams(BaseModel):
    course_uuid: str


class GetCourseStructureParams(BaseModel):
    course_uuid: str
    include_unpublished: bool = True


class CreateCourseParams(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: str = ""
    about: str = ""
    learnings: str = ""
    tags: str = ""
    public: bool = False
    published: bool = False
    open_to_contributors: bool = False


class UpdateCourseParams(BaseModel):
    course_uuid: str
    name: str | None = None
    description: str | None = None
    about: str | None = None
    learnings: str | None = None
    tags: str | None = None
    public: bool | None = None
    published: bool | None = None
    open_to_contributors: bool | None = None


class CloneCourseParams(BaseModel):
    course_uuid: str


class DeleteCourseParams(BaseModel):
    course_uuid: str
    confirm: bool | None = None


class PostCourseUpdateParams(BaseModel):
    course_uuid: str
    title: str = Field(..., min_length=1, max_length=200)
    content: str = Field(..., min_length=1)


# ─── executors ─────────────────────────────────────────────────────────────


async def _list_courses(ctx: ToolContext, p: ListCoursesParams):
    courses = await get_courses_orgslug(
        ctx.request,
        ctx.user,
        ctx.org_slug,
        ctx.db_session,
        page=p.page,
        limit=p.limit,
        include_unpublished=p.include_unpublished,
    )
    return [_compact_course(c) for c in courses]


async def _search_courses(ctx: ToolContext, p: SearchCoursesParams):
    courses = await search_courses(
        ctx.request,
        ctx.user,
        ctx.org_slug,
        p.query,
        ctx.db_session,
        page=p.page,
        limit=p.limit,
    )
    return [_compact_course(c) for c in courses]


async def _get_course(ctx: ToolContext, p: GetCourseParams):
    course = await get_course(ctx.request, p.course_uuid, ctx.user, ctx.db_session)
    return jsonable(course)


async def _get_course_structure(ctx: ToolContext, p: GetCourseStructureParams):
    meta = await get_course_meta(
        ctx.request,
        p.course_uuid,
        p.include_unpublished,
        ctx.user,
        ctx.db_session,
        slim=True,
    )
    return jsonable(meta)


async def _create_course(ctx: ToolContext, p: CreateCourseParams):
    course = await create_course(
        ctx.request,
        ctx.org.id,
        CourseCreate(
            name=p.name,
            description=p.description,
            about=p.about,
            learnings=p.learnings,
            tags=p.tags,
            public=p.public,
            published=p.published,
            open_to_contributors=p.open_to_contributors,
            org_id=ctx.org.id,
        ),
        ctx.user,
        ctx.db_session,
    )
    return jsonable(course)


async def _update_course(ctx: ToolContext, p: UpdateCourseParams):
    patch = p.model_dump(exclude={"course_uuid"}, exclude_none=True)
    course = await update_course(
        ctx.request,
        CourseUpdate(**patch),
        p.course_uuid,
        ctx.user,
        ctx.db_session,
    )
    return jsonable(course)


async def _clone_course(ctx: ToolContext, p: CloneCourseParams):
    course = await clone_course(ctx.request, p.course_uuid, ctx.user, ctx.db_session)
    return _compact_course(course)


async def _delete_course(ctx: ToolContext, p: DeleteCourseParams):
    return jsonable(
        await delete_course(ctx.request, p.course_uuid, ctx.user, ctx.db_session)
    )


async def _post_course_update(ctx: ToolContext, p: PostCourseUpdateParams):
    update = await create_update(
        ctx.request,
        p.course_uuid,
        CourseUpdateCreate(title=p.title, content=p.content, org_id=ctx.org.id),
        ctx.user,
        ctx.db_session,
    )
    return jsonable(update)


# ─── specs ─────────────────────────────────────────────────────────────────

SPECS: list[ToolSpec] = [
    ToolSpec(
        name="list_courses",
        description=(
            "List the organization's courses (paginated, includes unpublished "
            "ones the caller can see)."
        ),
        params_model=ListCoursesParams,
        tier=ActionTier.READ,
        rights_bucket="courses",
        access_action=AccessAction.READ,
        execute=_list_courses,
    ),
    ToolSpec(
        name="search_courses",
        description=(
            "Search courses by free text (name/description). Use this FIRST "
            "to resolve a course mentioned by name before acting on it."
        ),
        params_model=SearchCoursesParams,
        tier=ActionTier.READ,
        rights_bucket="courses",
        access_action=AccessAction.READ,
        execute=_search_courses,
    ),
    ToolSpec(
        name="get_course",
        description="Get one course's full details by uuid.",
        params_model=GetCourseParams,
        tier=ActionTier.READ,
        rights_bucket="courses",
        access_action=AccessAction.READ,
        execute=_get_course,
        target_param="course_uuid",
        target_kind="course",
    ),
    ToolSpec(
        name="get_course_structure",
        description=(
            "Get a course's chapter/activity tree (uuids, names, types, "
            "order). Use before restructuring or targeting activities."
        ),
        params_model=GetCourseStructureParams,
        tier=ActionTier.READ,
        rights_bucket="courses",
        access_action=AccessAction.READ,
        execute=_get_course_structure,
        target_param="course_uuid",
        target_kind="course",
    ),
    ToolSpec(
        name="create_course",
        description="Create a new course in the organization.",
        params_model=CreateCourseParams,
        tier=ActionTier.CREATE,
        rights_bucket="courses",
        access_action=AccessAction.CREATE,
        execute=_create_course,
        target_kind="course",
        summarize=lambda p: f'Create course "{p.name}"',
    ),
    ToolSpec(
        name="update_course",
        description=(
            "Update course fields (name, description, about, learnings, "
            "tags, visibility, published state). Only send fields to change."
        ),
        params_model=UpdateCourseParams,
        tier=ActionTier.EDIT,
        rights_bucket="courses",
        access_action=AccessAction.UPDATE,
        execute=_update_course,
        target_param="course_uuid",
        target_kind="course",
        summarize=lambda p: "Update course fields: "
        + ", ".join(p.model_dump(exclude={"course_uuid"}, exclude_none=True) or ["-"]),
    ),
    ToolSpec(
        name="clone_course",
        description="Duplicate an existing course (content and structure).",
        params_model=CloneCourseParams,
        tier=ActionTier.CREATE,
        rights_bucket="courses",
        access_action=AccessAction.CREATE,
        execute=_clone_course,
        target_param="course_uuid",
        target_kind="course",
    ),
    ToolSpec(
        name="delete_course",
        description=(
            "Permanently delete a course and all its chapters/activities. "
            "Irreversible."
        ),
        params_model=DeleteCourseParams,
        tier=ActionTier.DESTRUCTIVE,
        rights_bucket="courses",
        access_action=AccessAction.DELETE,
        execute=_delete_course,
        target_param="course_uuid",
        target_kind="course",
    ),
    ToolSpec(
        name="post_course_update",
        description="Post an announcement/changelog entry on a course.",
        params_model=PostCourseUpdateParams,
        tier=ActionTier.CREATE,
        rights_bucket="courses",
        access_action=AccessAction.UPDATE,
        execute=_post_course_update,
        target_param="course_uuid",
        target_kind="course",
        summarize=lambda p: f'Post course update "{p.title}"',
    ),
]
