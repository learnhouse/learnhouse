"""Playground tools — list/read/create/update/duplicate/delete + usergroup access.

Every tool wraps an existing playground service function in-process, passing
`ctx.request` / `ctx.user` / `ctx.db_session` so the service's own rights
checks stay authoritative. Params models are curated subsets of the service
schemas — enough for an agent, nothing internal.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from src.db.playgrounds import PlaygroundAccessType, PlaygroundCreate, PlaygroundUpdate
from src.security.rbac import AccessAction
from src.services.ai.tools.base import ActionTier, ToolContext, ToolSpec, jsonable
from src.services.playgrounds.playgrounds import (
    add_usergroup_to_playground,
    create_playground,
    delete_playground,
    duplicate_playground,
    get_playground,
    list_org_playgrounds,
    remove_usergroup_from_playground,
    update_playground,
)


def _compact_playground(playground) -> dict:
    data = jsonable(playground)
    keep = (
        "playground_uuid",
        "name",
        "description",
        "access_type",
        "published",
        "course_uuid",
        "author_username",
        "update_date",
    )
    out = {k: data.get(k) for k in keep if k in data}
    desc = out.get("description")
    if isinstance(desc, str) and len(desc) > 280:
        out["description"] = desc[:280] + "…"
    html = data.get("html_content")
    out["has_html_content"] = bool(html)
    return out


# ─── params ────────────────────────────────────────────────────────────────


class ListPlaygroundsParams(BaseModel):
    pass


class GetPlaygroundParams(BaseModel):
    playground_uuid: str


class CreatePlaygroundParams(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: str | None = None
    access_type: PlaygroundAccessType = Field(
        PlaygroundAccessType.AUTHENTICATED,
        description=(
            "Who can view: 'public' (anyone, even anonymous), 'authenticated' "
            "(any logged-in user), or 'restricted' (specific usergroups only)."
        ),
    )
    course_uuid: str | None = Field(
        None, description="Optional course to link the playground to."
    )
    html_content: str | None = Field(
        None, description="Full HTML document rendered inside the playground."
    )


class UpdatePlaygroundParams(BaseModel):
    playground_uuid: str
    name: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = None
    access_type: PlaygroundAccessType | None = None
    published: bool | None = Field(
        None, description="Set true to publish, false to unpublish (draft)."
    )
    course_uuid: str | None = None
    html_content: str | None = Field(
        None, description="Replaces the playground's HTML document entirely."
    )


class DuplicatePlaygroundParams(BaseModel):
    playground_uuid: str


class DeletePlaygroundParams(BaseModel):
    playground_uuid: str
    confirm: bool | None = None


class SetPlaygroundAccessParams(BaseModel):
    playground_uuid: str
    usergroup_uuid: str
    operation: Literal["add", "remove"] = Field(
        ...,
        description="'add' grants the usergroup access, 'remove' revokes it.",
    )


# ─── executors ─────────────────────────────────────────────────────────────


async def _list_playgrounds(ctx: ToolContext, p: ListPlaygroundsParams):
    playgrounds = await list_org_playgrounds(
        ctx.request, ctx.org.id, ctx.user, ctx.db_session
    )
    return [_compact_playground(pg) for pg in playgrounds]


async def _get_playground(ctx: ToolContext, p: GetPlaygroundParams):
    playground = await get_playground(
        ctx.request, p.playground_uuid, ctx.user, ctx.db_session
    )
    return jsonable(playground)


async def _create_playground(ctx: ToolContext, p: CreatePlaygroundParams):
    playground = await create_playground(
        ctx.request,
        ctx.org.id,
        PlaygroundCreate(
            name=p.name,
            description=p.description,
            access_type=p.access_type,
            course_uuid=p.course_uuid,
            html_content=p.html_content,
        ),
        ctx.user,
        ctx.db_session,
    )
    return _compact_playground(playground)


async def _update_playground(ctx: ToolContext, p: UpdatePlaygroundParams):
    patch = p.model_dump(exclude={"playground_uuid"}, exclude_none=True)
    playground = await update_playground(
        ctx.request,
        p.playground_uuid,
        PlaygroundUpdate(**patch),
        ctx.user,
        ctx.db_session,
    )
    return _compact_playground(playground)


async def _duplicate_playground(ctx: ToolContext, p: DuplicatePlaygroundParams):
    playground = await duplicate_playground(
        ctx.request, p.playground_uuid, ctx.user, ctx.db_session
    )
    return _compact_playground(playground)


async def _delete_playground(ctx: ToolContext, p: DeletePlaygroundParams):
    return jsonable(
        await delete_playground(ctx.request, p.playground_uuid, ctx.user, ctx.db_session)
    )


async def _set_playground_access(ctx: ToolContext, p: SetPlaygroundAccessParams):
    if p.operation == "add":
        result = await add_usergroup_to_playground(
            ctx.request, p.playground_uuid, p.usergroup_uuid, ctx.user, ctx.db_session
        )
    else:
        result = await remove_usergroup_from_playground(
            ctx.request, p.playground_uuid, p.usergroup_uuid, ctx.user, ctx.db_session
        )
    return jsonable(result)


# ─── specs ─────────────────────────────────────────────────────────────────

SPECS: list[ToolSpec] = [
    ToolSpec(
        name="list_playgrounds",
        description=(
            "List the organization's playgrounds the caller can see (drafts "
            "included for owners/admins). Use this to resolve a playground "
            "mentioned by name before acting on it."
        ),
        params_model=ListPlaygroundsParams,
        tier=ActionTier.READ,
        rights_bucket="playgrounds",
        access_action=AccessAction.READ,
        execute=_list_playgrounds,
    ),
    ToolSpec(
        name="get_playground",
        description=(
            "Get one playground's full details by uuid, including its "
            "html_content. Use before editing its HTML."
        ),
        params_model=GetPlaygroundParams,
        tier=ActionTier.READ,
        rights_bucket="playgrounds",
        access_action=AccessAction.READ,
        execute=_get_playground,
        target_param="playground_uuid",
        target_kind="playground",
    ),
    ToolSpec(
        name="create_playground",
        description=(
            "Create a new playground (interactive HTML page) in the "
            "organization. Created unpublished; publish via update_playground."
        ),
        params_model=CreatePlaygroundParams,
        tier=ActionTier.CREATE,
        rights_bucket="playgrounds",
        access_action=AccessAction.CREATE,
        execute=_create_playground,
        target_kind="playground",
        summarize=lambda p: f'Create playground "{p.name}"',
    ),
    ToolSpec(
        name="update_playground",
        description=(
            "Update playground fields (name, description, access_type, "
            "published state, linked course, html_content). Only send fields "
            "to change; html_content replaces the whole document."
        ),
        params_model=UpdatePlaygroundParams,
        tier=ActionTier.EDIT,
        rights_bucket="playgrounds",
        access_action=AccessAction.UPDATE,
        execute=_update_playground,
        target_param="playground_uuid",
        target_kind="playground",
        summarize=lambda p: "Update playground fields: "
        + ", ".join(
            p.model_dump(exclude={"playground_uuid"}, exclude_none=True) or ["-"]
        ),
    ),
    ToolSpec(
        name="duplicate_playground",
        description=(
            "Duplicate an existing playground (content and settings); the "
            "copy is created unpublished."
        ),
        params_model=DuplicatePlaygroundParams,
        tier=ActionTier.CREATE,
        rights_bucket="playgrounds",
        access_action=AccessAction.CREATE,
        execute=_duplicate_playground,
        target_param="playground_uuid",
        target_kind="playground",
    ),
    ToolSpec(
        name="delete_playground",
        description=(
            "Permanently delete a playground and its usergroup access links. "
            "Irreversible."
        ),
        params_model=DeletePlaygroundParams,
        tier=ActionTier.DESTRUCTIVE,
        rights_bucket="playgrounds",
        access_action=AccessAction.DELETE,
        execute=_delete_playground,
        target_param="playground_uuid",
        target_kind="playground",
    ),
    ToolSpec(
        name="set_playground_access",
        description=(
            "Grant ('add') or revoke ('remove') a usergroup's access to a "
            "playground. Only relevant for playgrounds with access_type "
            "'restricted'."
        ),
        params_model=SetPlaygroundAccessParams,
        tier=ActionTier.EDIT,
        rights_bucket="playgrounds",
        access_action=AccessAction.UPDATE,
        execute=_set_playground_access,
        target_param="playground_uuid",
        target_kind="playground",
        summarize=lambda p: (
            f"{'Grant' if p.operation == 'add' else 'Revoke'} usergroup "
            f"{p.usergroup_uuid} access to playground"
        ),
    ),
]
