"""Activity tools — read/create/update/delete + content versioning.

Every tool wraps an existing service function in-process, passing
`ctx.request` / `ctx.user` / `ctx.db_session` so the services' own RBAC
checks (which run against the parent course) stay authoritative. Params
models are curated subsets of the service schemas — enough for an agent,
nothing internal.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from src.db.courses.activities import (
    ActivityCreate,
    ActivitySubTypeEnum,
    ActivityTypeEnum,
    ActivityUpdate,
)
from src.security.rbac import AccessAction
from src.services.ai.tools.base import ActionTier, ToolContext, ToolSpec, jsonable
from src.services.courses.activities.activities import (
    create_activity,
    delete_activity,
    get_activity,
    update_activity,
)
from src.services.courses.activities.versioning import (
    get_activity_versions,
    restore_activity_version,
)


def _compact_activity(activity) -> dict:
    data = jsonable(activity)
    keep = (
        "activity_uuid",
        "name",
        "activity_type",
        "activity_sub_type",
        "published",
        "current_version",
        "update_date",
    )
    out = {k: data.get(k) for k in keep if k in data}
    content = data.get("content")
    out["has_content"] = bool(content)
    return out


def _compact_version(version) -> dict:
    data = jsonable(version)
    keep = (
        "version_number",
        "created_at",
        "created_by_username",
    )
    return {k: data.get(k) for k in keep if k in data}


# ─── params ────────────────────────────────────────────────────────────────


class GetActivityParams(BaseModel):
    activity_uuid: str


class CreateActivityParams(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    chapter_id: int = Field(
        ...,
        description=(
            "Numeric id of the chapter to add the activity to "
            "(from get_course_structure)."
        ),
    )
    activity_type: ActivityTypeEnum = Field(
        ActivityTypeEnum.TYPE_DYNAMIC,
        description="Kind of activity; TYPE_DYNAMIC for an editable page.",
    )
    activity_sub_type: ActivitySubTypeEnum = Field(
        ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE,
        description="Sub-kind; must match the activity_type family.",
    )
    content: dict = Field(
        default_factory=dict,
        description=(
            "Editor JSON document (TipTap): {\"type\":\"doc\",\"content\":[...blocks...]}. "
            "Call describe_activity_blocks first to get the block palette and "
            "examples — you can compose quiz, callout, flipcard, math, headings, "
            "and lists, not just paragraphs. {} starts empty."
        ),
    )
    published: bool = False


class UpdateActivityParams(BaseModel):
    activity_uuid: str
    name: str | None = Field(None, min_length=1, max_length=200)
    content: dict | None = Field(
        None,
        description=(
            "Full replacement editor JSON (TipTap doc); snapshots the previous "
            "version. See describe_activity_blocks for the block palette."
        ),
    )
    published: bool | None = None


class SetActivityContentParams(BaseModel):
    activity_uuid: str
    content: dict = Field(
        ...,
        description=(
            "Full replacement editor JSON document (TipTap doc). Call "
            "describe_activity_blocks for the supported blocks (quiz, callout, "
            "flipcard, math, …) and their JSON shapes before composing."
        ),
    )


class DeleteActivityParams(BaseModel):
    activity_uuid: str
    confirm: bool | None = None


class ListActivityVersionsParams(BaseModel):
    activity_uuid: str
    limit: int = Field(20, ge=1, le=50)
    offset: int = Field(0, ge=0)


class RestoreActivityVersionParams(BaseModel):
    activity_uuid: str
    version_number: int = Field(..., ge=1)


# ─── executors ─────────────────────────────────────────────────────────────


async def _get_activity(ctx: ToolContext, p: GetActivityParams):
    activity = await get_activity(ctx.request, p.activity_uuid, ctx.user, ctx.db_session)
    return jsonable(activity)


async def _create_activity(ctx: ToolContext, p: CreateActivityParams):
    activity = await create_activity(
        ctx.request,
        ActivityCreate(
            name=p.name,
            chapter_id=p.chapter_id,
            activity_type=p.activity_type,
            activity_sub_type=p.activity_sub_type,
            content=p.content,
            published=p.published,
        ),
        ctx.user,
        ctx.db_session,
    )
    return _compact_activity(activity)


async def _update_activity(ctx: ToolContext, p: UpdateActivityParams):
    patch = p.model_dump(exclude={"activity_uuid"}, exclude_none=True)
    activity = await update_activity(
        ctx.request,
        ActivityUpdate(**patch),
        p.activity_uuid,
        ctx.user,
        ctx.db_session,
    )
    return _compact_activity(activity)


async def _set_activity_content(ctx: ToolContext, p: SetActivityContentParams):
    activity = await update_activity(
        ctx.request,
        ActivityUpdate(content=p.content),
        p.activity_uuid,
        ctx.user,
        ctx.db_session,
    )
    return _compact_activity(activity)


async def _delete_activity(ctx: ToolContext, p: DeleteActivityParams):
    return jsonable(
        await delete_activity(ctx.request, p.activity_uuid, ctx.user, ctx.db_session)
    )


async def _list_activity_versions(ctx: ToolContext, p: ListActivityVersionsParams):
    versions = await get_activity_versions(
        ctx.request,
        p.activity_uuid,
        ctx.user,
        ctx.db_session,
        limit=p.limit,
        offset=p.offset,
    )
    return [_compact_version(v) for v in versions]


async def _restore_activity_version(ctx: ToolContext, p: RestoreActivityVersionParams):
    activity = await restore_activity_version(
        ctx.request,
        p.activity_uuid,
        p.version_number,
        ctx.user,
        ctx.db_session,
    )
    return _compact_activity(activity)


# ─── specs ─────────────────────────────────────────────────────────────────

SPECS: list[ToolSpec] = [
    ToolSpec(
        name="get_activity",
        description=(
            "Get one activity's full details by uuid, including its editor "
            "JSON content. Use get_course_structure first to find uuids."
        ),
        params_model=GetActivityParams,
        tier=ActionTier.READ,
        rights_bucket="activities",
        access_action=AccessAction.READ,
        execute=_get_activity,
        target_param="activity_uuid",
        target_kind="activity",
    ),
    ToolSpec(
        name="create_activity",
        description=(
            "Create an activity (lesson/page) inside a chapter. Defaults to a "
            "dynamic page; pass editor JSON in `content` to prefill it. Get "
            "the numeric chapter_id from get_course_structure."
        ),
        params_model=CreateActivityParams,
        tier=ActionTier.CREATE,
        rights_bucket="activities",
        access_action=AccessAction.CREATE,
        execute=_create_activity,
        target_kind="activity",
        summarize=lambda p: f'Create activity "{p.name}"',
    ),
    ToolSpec(
        name="update_activity",
        description=(
            "Update an activity's name, content or published state. Only send "
            "fields to change; sending `content` snapshots a version first."
        ),
        params_model=UpdateActivityParams,
        tier=ActionTier.EDIT,
        rights_bucket="activities",
        access_action=AccessAction.UPDATE,
        execute=_update_activity,
        target_param="activity_uuid",
        target_kind="activity",
        summarize=lambda p: "Update activity fields: "
        + ", ".join(
            p.model_dump(exclude={"activity_uuid"}, exclude_none=True) or ["-"]
        ),
    ),
    ToolSpec(
        name="set_activity_content",
        description=(
            "Replace a dynamic activity's editor JSON content wholesale. "
            "Prefer this over update_activity when only rewriting the page "
            "body; the previous content is version-snapshotted."
        ),
        params_model=SetActivityContentParams,
        tier=ActionTier.EDIT,
        rights_bucket="activities",
        access_action=AccessAction.UPDATE,
        execute=_set_activity_content,
        target_param="activity_uuid",
        target_kind="activity",
        summarize=lambda p: "Replace activity content",
    ),
    ToolSpec(
        name="delete_activity",
        description=(
            "Permanently delete an activity and its stored files. Irreversible."
        ),
        params_model=DeleteActivityParams,
        tier=ActionTier.DESTRUCTIVE,
        rights_bucket="activities",
        access_action=AccessAction.DELETE,
        execute=_delete_activity,
        target_param="activity_uuid",
        target_kind="activity",
    ),
    ToolSpec(
        name="list_activity_versions",
        description=(
            "List an activity's saved content versions (newest first). Use "
            "before restore_activity_version to pick a version_number."
        ),
        params_model=ListActivityVersionsParams,
        tier=ActionTier.READ,
        rights_bucket="activities",
        access_action=AccessAction.READ,
        execute=_list_activity_versions,
        target_param="activity_uuid",
        target_kind="activity",
    ),
    ToolSpec(
        name="restore_activity_version",
        description=(
            "Restore an activity's content to a previous version (the current "
            "state is snapshotted first, so this is safely undoable)."
        ),
        params_model=RestoreActivityVersionParams,
        tier=ActionTier.EDIT,
        rights_bucket="activities",
        access_action=AccessAction.UPDATE,
        execute=_restore_activity_version,
        target_param="activity_uuid",
        target_kind="activity",
        summarize=lambda p: f"Restore activity to version {p.version_number}",
    ),
]
