"""Learning path tools: ordered sets of courses with their own certificate.

A path groups courses a learner follows in order (required ones, plus
electives when the path asks for some) and can award a certificate once they
are done. Authoring a path needs the courses bucket rights, as the HTTP
routes do; the paths service checks them again, and keeps drafts to the
people who can edit them.

New paths start as drafts. Publishing or unpublishing a path, changing who
can see a published one, and changing the courses of a published path all
change what learners see or must finish, so those calls ask for approval.
"""

from __future__ import annotations

from typing import Literal

from fastapi import HTTPException
from pydantic import BaseModel, Field, model_validator

from src.db.paths import PathCourseInput, PathCoursesUpdate, PathCreate, PathUpdate
from src.security.rbac import AccessAction
from src.services.ai.tools import refs, results
from src.services.ai.tools.base import ActionTier, ToolContext, ToolSpec, require_approval
from src.services.ai.tools.results import Paging
from src.services.paths.paths import (
    MAX_PATH_COURSES,
    create_path,
    delete_path,
    get_path,
    get_path_learners,
    list_org_paths,
    set_path_courses,
    update_path,
)

Level = Literal["beginner", "intermediate", "advanced", ""]

# Certificate fields a path can set, by their name in the certificate config.
_CERTIFICATE_FIELDS = {
    "certificate_name": "certification_name",
    "certificate_description": "certification_description",
}


# ─── helpers ─────────────────────────────────────────────────────────────────


async def _path_ref(ctx: ToolContext, path, **extra) -> dict:
    return refs.ref(
        "path",
        path.path_uuid,
        path.name,
        await refs.web_url(ctx, "path", path=path.path_uuid),
        **extra,
    )


async def _editor_url(ctx: ToolContext, path_uuid: str) -> str | None:
    return await refs.web_url(ctx, "path_editor", path=path_uuid)


def _status(path) -> str:
    if not path.published:
        return "draft"
    return "published" if path.public else "published_members_only"


async def _course_uuid(ctx: ToolContext, value: str) -> str:
    """A course of this organization, by id or by the name the user said."""
    value = (value or "").strip()
    if refs.kind_of(value) != "course":
        from src.services.ai.tools import discovery

        named, _ = await discovery.resolve_names(ctx, {"course_uuid"}, {"course_uuid": value})
        value = named["course_uuid"]
    row = await refs.load(ctx, "course", value)
    return row.course_uuid


async def _course_list(ctx: ToolContext, items: list["PathCourseItem"]) -> list[PathCourseInput]:
    out: list[PathCourseInput] = []
    for item in items:
        out.append(PathCourseInput(course_uuid=await _course_uuid(ctx, item.course), required=item.required))
    uuids = [c.course_uuid for c in out]
    duplicate = next((u for u in uuids if uuids.count(u) > 1), None)
    if duplicate:
        raise HTTPException(status_code=400, detail=f"{duplicate} is listed twice; a course appears once in a path.")
    return out


async def _outline(ctx: ToolContext, read) -> list[dict]:
    courses = []
    for item in read.courses or []:
        card = item.course or {}
        if card.get("restricted"):
            continue
        courses.append(
            refs.ref(
                "course",
                item.course_uuid,
                card.get("name"),
                await refs.web_url(ctx, "course", course=item.course_uuid),
                position=item.position,
                required=item.required,
                published=card.get("published"),
            )
        )
    return courses


# ─── params ──────────────────────────────────────────────────────────────────


class PathCourseItem(BaseModel):
    course: str = Field(..., min_length=1, max_length=200, description="course_uuid, or the course's name.")
    required: bool = Field(True, description="False makes it an elective.")


class ListPathsParams(Paging):
    status: Literal["all", "draft", "published"] = Field("all", description="Only drafts, or only published paths.")


class GetPathParams(BaseModel):
    path_uuid: str = Field(..., max_length=100, description="The path, e.g. path_...")


class CreatePathParams(BaseModel):
    name: str = Field(..., min_length=1, max_length=200, description="Path name.")
    description: str | None = Field(None, max_length=1000, description="One or two sentences shown on the path card.")
    about: str | None = Field(None, max_length=10000, description="Longer text for the path page.")
    level: Level = Field("", description="Who it is for; empty leaves it unset.")
    courses: list[PathCourseItem] = Field(
        default_factory=list,
        max_length=MAX_PATH_COURSES,
        description="The courses in order. Add more later with set_path_courses.",
    )
    sequential: bool = Field(False, description="True opens each course only once the previous required one is done.")
    electives_required: int = Field(0, ge=0, le=MAX_PATH_COURSES, description="How many electives learners must also finish.")
    certificate_enabled: bool = Field(False, description="Award a certificate when a learner completes the path.")
    members_only: bool = Field(False, description="True hides the path from people outside the organization once published.")

    @model_validator(mode="after")
    def _electives_exist(self):
        electives = sum(1 for c in self.courses if not c.required)
        if self.courses and self.electives_required > electives:
            raise ValueError(f"electives_required is {self.electives_required} but only {electives} electives are listed")
        return self


class UpdatePathParams(BaseModel):
    path_uuid: str = Field(..., max_length=100, description="The path to change.")
    name: str | None = Field(None, min_length=1, max_length=200, description="New name.")
    description: str | None = Field(None, max_length=1000, description="New card description.")
    about: str | None = Field(None, max_length=10000, description="New text for the path page.")
    level: Level | None = Field(None, description="New level; empty clears it.")
    published: bool | None = Field(None, description="True publishes the path, false takes it back to draft.")
    members_only: bool | None = Field(None, description="True keeps it to members of the organization.")
    sequential: bool | None = Field(None, description="Open courses one after another.")
    electives_required: int | None = Field(None, ge=0, le=MAX_PATH_COURSES, description="Electives learners must finish.")
    certificate_enabled: bool | None = Field(None, description="Award a certificate on completion.")
    certificate_name: str | None = Field(None, max_length=200, description="Title printed on the certificate.")
    certificate_description: str | None = Field(None, max_length=500, description="Text printed on the certificate.")


class SetPathCoursesParams(BaseModel):
    path_uuid: str = Field(..., max_length=100, description="The path.")
    courses: list[PathCourseItem] = Field(
        ...,
        max_length=MAX_PATH_COURSES,
        description="The full ordered list; it replaces the path's courses. An empty list clears them.",
    )


class ListPathLearnersParams(Paging):
    path_uuid: str = Field(..., max_length=100, description="The path.")
    status: Literal["all", "completed", "in_progress"] = Field("all", description="Filter by completion.")


class DeletePathParams(BaseModel):
    path_uuid: str = Field(..., max_length=100, description="The path to delete.")


# ─── executors ───────────────────────────────────────────────────────────────


async def _list_paths(ctx: ToolContext, p: ListPathsParams):
    # The service keeps drafts to authors and members-only paths to members.
    paths = await list_org_paths(ctx.request, ctx.org.id, ctx.user, ctx.db_session)
    if p.status != "all":
        paths = [x for x in paths if bool(x.published) == (p.status == "published")]
    offset = results.offset_of(p.cursor)
    chunk = paths[offset : offset + p.limit]
    items = [
        await _path_ref(
            ctx,
            x,
            status=_status(x),
            level=x.level or None,
            courses=x.course_count,
            learners=x.enrollment_count,
            certificate=bool(x.certificate_enabled),
            description=results.clip(x.description or "") or None,
        )
        for x in chunk
    ]
    return results.page(items, offset=offset, limit=p.limit, total=len(paths))


async def _get_path(ctx: ToolContext, p: GetPathParams):
    row = await refs.load(ctx, "path", p.path_uuid)
    read = await get_path(ctx.request, row.path_uuid, ctx.user, ctx.db_session)
    out = {
        "path": await _path_ref(ctx, read, status=_status(read)),
        "editor_url": await _editor_url(ctx, read.path_uuid),
        "description": read.description or "",
        "about": read.about or "",
        "level": read.level or None,
        "sequential": bool(read.sequential),
        "electives_required": read.electives_required,
        "certificate": {
            "enabled": bool(read.certificate_enabled),
            "name": (read.certificate_config or {}).get("certification_name"),
        },
        "learners": read.enrollment_count,
        "courses": await _outline(ctx, read),
    }
    results.clip_field(out, "about")
    return out


async def _create_path(ctx: ToolContext, p: CreatePathParams):
    courses = await _course_list(ctx, p.courses)
    read = await create_path(
        ctx.request,
        PathCreate(
            org_id=ctx.org.id,
            name=p.name,
            description=p.description or "",
            about=p.about or "",
            level=p.level,
            public=not p.members_only,
            published=False,
            sequential=p.sequential,
            electives_required=p.electives_required,
            certificate_enabled=p.certificate_enabled,
        ),
        ctx.user,
        ctx.db_session,
    )
    if courses:
        read = await set_path_courses(
            ctx.request, read.path_uuid, PathCoursesUpdate(courses=courses), ctx.user, ctx.db_session
        )
    return results.changed(
        f'Created draft path "{read.name}" with {len(courses)} course{"s" if len(courses) != 1 else ""}. '
        "Review it in the editor and publish it when ready.",
        path=await _path_ref(ctx, read, status="draft"),
        editor_url=await _editor_url(ctx, read.path_uuid),
        courses=await _outline(ctx, read),
    )


def _visible_change(path, p: UpdatePathParams) -> bool:
    """Whether the call changes what learners see: publishing, unpublishing,
    or the audience of a published path."""
    if p.published is not None and p.published != bool(path.published):
        return True
    return bool(path.published) and p.members_only is not None and p.members_only == bool(path.public)


async def _update_path(ctx: ToolContext, p: UpdatePathParams):
    row = await refs.load(ctx, "path", p.path_uuid)
    patch = p.model_dump(
        include={"name", "description", "about", "level", "published", "sequential", "electives_required", "certificate_enabled"},
        exclude_none=True,
    )
    if p.members_only is not None:
        patch["public"] = not p.members_only
    certificate = {
        key: getattr(p, field) for field, key in _CERTIFICATE_FIELDS.items() if getattr(p, field) is not None
    }
    if certificate:
        patch["certificate_config"] = {**(row.certificate_config or {}), **certificate}
    if not patch:
        raise HTTPException(status_code=400, detail="Nothing to change: pass at least one field.")
    if _visible_change(row, p):
        require_approval(ctx, "Publishing, unpublishing or changing who sees a published path needs the user's approval.")
    read = await update_path(ctx.request, row.path_uuid, PathUpdate(**patch), ctx.user, ctx.db_session)
    changes = ", ".join(sorted({"members_only" if k == "public" else k for k in patch}))
    return results.changed(
        f'Updated path "{read.name}" ({changes}).',
        path=await _path_ref(ctx, read, status=_status(read)),
        editor_url=await _editor_url(ctx, read.path_uuid),
    )


async def _set_path_courses(ctx: ToolContext, p: SetPathCoursesParams):
    row = await refs.load(ctx, "path", p.path_uuid)
    courses = await _course_list(ctx, p.courses)
    electives = sum(1 for c in courses if not c.required)
    if courses and row.electives_required > electives:
        raise HTTPException(
            status_code=400,
            detail=(
                f"The path asks learners for {row.electives_required} electives but this list has {electives}. "
                "Mark more courses required=false, or lower electives_required with update_path first."
            ),
        )
    if row.published:
        require_approval(ctx, "Changing the courses of a published path changes what learners must finish.")
    read = await set_path_courses(
        ctx.request, row.path_uuid, PathCoursesUpdate(courses=courses), ctx.user, ctx.db_session
    )
    return results.changed(
        f'Path "{read.name}" now has {len(courses)} course{"s" if len(courses) != 1 else ""}.',
        path=await _path_ref(ctx, read, status=_status(read)),
        courses=await _outline(ctx, read),
    )


async def _list_path_learners(ctx: ToolContext, p: ListPathLearnersParams):
    row = await refs.load(ctx, "path", p.path_uuid)
    learners = await get_path_learners(ctx.request, row.path_uuid, ctx.user, ctx.db_session)
    if p.status == "completed":
        learners = [x for x in learners if x.completed_at]
    elif p.status == "in_progress":
        learners = [x for x in learners if not x.completed_at]
    offset = results.offset_of(p.cursor)
    chunk = learners[offset : offset + p.limit]
    # Emails stay with staff on an admin connection, as for get_member.
    show_email = await refs.can_look_up_by_email(ctx)
    items = []
    for x in chunk:
        user = x.user or {}
        name = " ".join(v for v in (user.get("first_name"), user.get("last_name")) if v)
        items.append(
            {
                "user": refs.ref(
                    "user",
                    user.get("user_uuid"),
                    name or user.get("username"),
                    username=user.get("username"),
                    email=user.get("email") if show_email else None,
                ),
                "enrolled_at": x.enrolled_at,
                "completed_at": x.completed_at,
                "percent": x.percent,
                "required_done": f"{x.required_done}/{x.required_total}",
                "courses_done": f"{x.courses_done}/{x.courses_needed}",
                "certificate_uuid": None if x.certificate_revoked else x.certificate_uuid,
                "certificate_revoked": x.certificate_revoked or None,
            }
        )
    return results.page(
        items,
        offset=offset,
        limit=p.limit,
        total=len(learners),
        path=await _path_ref(ctx, row),
    )


async def _delete_path(ctx: ToolContext, p: DeletePathParams):
    row = await refs.load(ctx, "path", p.path_uuid)
    name = row.name
    await delete_path(ctx.request, row.path_uuid, ctx.user, ctx.db_session)
    return results.changed(
        f'Deleted path "{name}". Its courses are untouched.', path=refs.ref("path", p.path_uuid, name)
    )


# ─── specs ───────────────────────────────────────────────────────────────────


def _course_names(courses: list[PathCourseItem]) -> str:
    listed = ", ".join(c.course + ("" if c.required else " (elective)") for c in courses[:6])
    return listed + (f" and {len(courses) - 6} more" if len(courses) > 6 else "")


SPECS: list[ToolSpec] = [
    ToolSpec(
        name="list_paths",
        description=(
            "List learning paths (ordered sets of courses with their own certificate): status, "
            "level, how many courses and learners. Drafts show only to people who can edit them. Paged."
        ),
        params_model=ListPathsParams,
        tier=ActionTier.READ,
        rights_bucket="courses",
        access_action=AccessAction.READ,
        execute=_list_paths,
        title="List paths",
    ),
    ToolSpec(
        name="get_path",
        description=(
            "One learning path: its text, settings, certificate and its courses in order "
            "(required or elective), with links."
        ),
        params_model=GetPathParams,
        tier=ActionTier.READ,
        rights_bucket="courses",
        access_action=AccessAction.READ,
        execute=_get_path,
        target_param="path_uuid",
        target_kind="path",
        title="Get path",
    ),
    ToolSpec(
        name="create_path",
        description=(
            "Create a learning path as a draft, with its courses in order (by id or name; "
            "required=false makes one an elective). Turn on certificate_enabled to award a "
            "certificate on completion. Publish it later with update_path."
        ),
        params_model=CreatePathParams,
        tier=ActionTier.CREATE,
        rights_bucket="courses",
        access_action=AccessAction.CREATE,
        execute=_create_path,
        target_kind="path",
        summarize=lambda p: f'Create draft path "{p.name}"'
        + (f" with {_course_names(p.courses)}" if p.courses else ""),
        title="Create path",
    ),
    ToolSpec(
        name="update_path",
        description=(
            "Change a learning path's text, level, ordering rule, electives or certificate, or "
            "publish it. Send only what changes. Publishing, unpublishing and changing who sees "
            "a published path need approval."
        ),
        params_model=UpdatePathParams,
        tier=ActionTier.EDIT,
        rights_bucket="courses",
        access_action=AccessAction.UPDATE,
        execute=_update_path,
        target_param="path_uuid",
        target_kind="path",
        approval_in_call=True,
        idempotent=True,
        summarize=lambda p: (
            ("Publish path" if p.published else "Unpublish path" if p.published is False else "Update path")
            + f" {p.path_uuid}"
            + (
                ": " + ", ".join(p.model_dump(exclude={"path_uuid", "published"}, exclude_none=True))
                if p.model_dump(exclude={"path_uuid", "published"}, exclude_none=True)
                else ""
            )
        ),
        title="Update path",
    ),
    ToolSpec(
        name="set_path_courses",
        description=(
            "Replace a learning path's courses with this ordered list (by id or name; "
            "required=false for electives). Read it with get_path first to keep what is there. "
            "On a published path this needs approval."
        ),
        params_model=SetPathCoursesParams,
        tier=ActionTier.EDIT,
        rights_bucket="courses",
        access_action=AccessAction.UPDATE,
        execute=_set_path_courses,
        target_param="path_uuid",
        target_kind="path",
        approval_in_call=True,
        idempotent=True,
        summarize=lambda p: f"Set the courses of path {p.path_uuid} to: {_course_names(p.courses) or 'none'}",
        title="Set path courses",
    ),
    ToolSpec(
        name="list_path_learners",
        description=(
            "Who follows a learning path and how far they are: percent done, required courses "
            "done, completion date and certificate. Filter by status. Paged."
        ),
        params_model=ListPathLearnersParams,
        tier=ActionTier.READ,
        rights_bucket="courses",
        access_action=AccessAction.UPDATE,
        execute=_list_path_learners,
        target_param="path_uuid",
        target_kind="path",
        title="List path learners",
    ),
    ToolSpec(
        name="delete_path",
        description=(
            "Permanently delete a learning path. Its courses stay. Refused while the path has "
            "awarded certificates: unpublish it instead."
        ),
        params_model=DeletePathParams,
        tier=ActionTier.DESTRUCTIVE,
        rights_bucket="courses",
        access_action=AccessAction.DELETE,
        execute=_delete_path,
        target_param="path_uuid",
        target_kind="path",
        summarize=lambda p: f"Delete path {p.path_uuid}",
        title="Delete path",
    ),
]
