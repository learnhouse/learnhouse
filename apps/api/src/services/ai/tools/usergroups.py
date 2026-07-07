"""UserGroup tools — list/create/update/delete + member & resource linking.

Every tool wraps an existing usergroup service function in-process, passing
`ctx.request` / `ctx.user` / `ctx.db_session` so the services' own RBAC
checks stay authoritative. UserGroups are addressed by their integer id
(the services take `usergroup_id: int`, not a uuid), so `target_param`
carries that id purely for pending-action previews — the registry's uuid
pre-flight skips non-prefixed values.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from src.db.usergroups import UserGroupCreate, UserGroupUpdate
from src.security.rbac import AccessAction
from src.services.ai.tools.base import ActionTier, ToolContext, ToolSpec, jsonable
from src.services.users.usergroups import (
    add_resources_to_usergroup,
    add_users_to_usergroup,
    create_usergroup,
    delete_usergroup_by_id,
    get_resources_by_usergroup,
    get_users_linked_to_usergroup,
    read_usergroup_by_id,
    read_usergroups_by_org_id,
    remove_resources_from_usergroup,
    remove_users_from_usergroup,
    update_usergroup_by_id,
)


def _compact_usergroup(usergroup) -> dict:
    data = jsonable(usergroup)
    keep = ("id", "usergroup_uuid", "name", "description", "update_date")
    out = {k: data.get(k) for k in keep if k in data}
    desc = out.get("description")
    if isinstance(desc, str) and len(desc) > 280:
        out["description"] = desc[:280] + "…"
    return out


def _compact_member(user) -> dict:
    data = jsonable(user)
    keep = ("id", "user_uuid", "username", "first_name", "last_name", "avatar_image")
    return {k: data.get(k) for k in keep if k in data}


# ─── params ────────────────────────────────────────────────────────────────


class ListUserGroupsParams(BaseModel):
    usergroup_id: int | None = Field(
        None,
        ge=1,
        description=(
            "Omit to list every usergroup in the organization. Set to one "
            "group's id to get that group with its members and linked "
            "resource uuids."
        ),
    )


class CreateUserGroupParams(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: str = ""


class UpdateUserGroupParams(BaseModel):
    usergroup_id: int = Field(..., ge=1)
    name: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = None


class ManageUserGroupMembersParams(BaseModel):
    usergroup_id: int = Field(..., ge=1)
    operation: Literal["add", "remove"]
    user_ids: list[int] = Field(
        ...,
        min_length=1,
        description="Numeric user ids to add to / remove from the group.",
    )


class LinkUserGroupResourcesParams(BaseModel):
    usergroup_id: int = Field(..., ge=1)
    operation: Literal["add", "remove"]
    resource_uuids: list[str] = Field(
        ...,
        min_length=1,
        description=(
            "Resource uuids (course_…, community_…, podcast_…, folder_…, "
            "media_…, board_…) to link to / unlink from the group."
        ),
    )


class DeleteUserGroupParams(BaseModel):
    usergroup_id: int = Field(..., ge=1)
    confirm: bool | None = None


# ─── executors ─────────────────────────────────────────────────────────────


async def _list_usergroups(ctx: ToolContext, p: ListUserGroupsParams):
    if p.usergroup_id is None:
        usergroups = await read_usergroups_by_org_id(
            ctx.request, ctx.db_session, ctx.user, ctx.org.id
        )
        return [_compact_usergroup(ug) for ug in usergroups]

    usergroup = await read_usergroup_by_id(
        ctx.request, ctx.db_session, ctx.user, p.usergroup_id
    )
    members = await get_users_linked_to_usergroup(
        ctx.request, ctx.db_session, ctx.user, p.usergroup_id
    )
    resource_uuids = await get_resources_by_usergroup(
        ctx.request, ctx.db_session, ctx.user, p.usergroup_id
    )
    out = _compact_usergroup(usergroup)
    out["members"] = [_compact_member(m) for m in members]
    out["resource_uuids"] = jsonable(resource_uuids)
    return out


async def _create_usergroup(ctx: ToolContext, p: CreateUserGroupParams):
    usergroup = await create_usergroup(
        ctx.request,
        ctx.db_session,
        ctx.user,
        UserGroupCreate(name=p.name, description=p.description, org_id=ctx.org.id),
    )
    return jsonable(usergroup)


async def _update_usergroup(ctx: ToolContext, p: UpdateUserGroupParams):
    patch = p.model_dump(exclude={"usergroup_id"}, exclude_none=True)
    usergroup = await update_usergroup_by_id(
        ctx.request,
        ctx.db_session,
        ctx.user,
        p.usergroup_id,
        UserGroupUpdate(**patch),
    )
    return jsonable(usergroup)


async def _manage_usergroup_members(ctx: ToolContext, p: ManageUserGroupMembersParams):
    user_ids = ",".join(str(uid) for uid in p.user_ids)
    if p.operation == "add":
        result = await add_users_to_usergroup(
            ctx.request, ctx.db_session, ctx.user, p.usergroup_id, user_ids
        )
    else:
        result = await remove_users_from_usergroup(
            ctx.request, ctx.db_session, ctx.user, p.usergroup_id, user_ids
        )
    return jsonable(result)


async def _link_usergroup_resources(ctx: ToolContext, p: LinkUserGroupResourcesParams):
    resources_uuids = ",".join(p.resource_uuids)
    if p.operation == "add":
        result = await add_resources_to_usergroup(
            ctx.request, ctx.db_session, ctx.user, p.usergroup_id, resources_uuids
        )
    else:
        result = await remove_resources_from_usergroup(
            ctx.request, ctx.db_session, ctx.user, p.usergroup_id, resources_uuids
        )
    return jsonable(result)


async def _delete_usergroup(ctx: ToolContext, p: DeleteUserGroupParams):
    return jsonable(
        await delete_usergroup_by_id(
            ctx.request, ctx.db_session, ctx.user, p.usergroup_id
        )
    )


# ─── specs ─────────────────────────────────────────────────────────────────

SPECS: list[ToolSpec] = [
    ToolSpec(
        name="list_usergroups",
        description=(
            "List the organization's usergroups, or pass usergroup_id to get "
            "one group with its members and linked resource uuids. Use this "
            "FIRST to resolve a group mentioned by name before acting on it."
        ),
        params_model=ListUserGroupsParams,
        tier=ActionTier.READ,
        rights_bucket="usergroups",
        access_action=AccessAction.READ,
        execute=_list_usergroups,
    ),
    ToolSpec(
        name="create_usergroup",
        description=(
            "Create a new usergroup in the organization. Groups gate access "
            "to linked resources (courses, communities, ...) for their members."
        ),
        params_model=CreateUserGroupParams,
        tier=ActionTier.CREATE,
        rights_bucket="usergroups",
        access_action=AccessAction.CREATE,
        execute=_create_usergroup,
        target_kind="usergroup",
        summarize=lambda p: f'Create usergroup "{p.name}"',
    ),
    ToolSpec(
        name="update_usergroup",
        description=(
            "Rename a usergroup or change its description. Only send fields "
            "to change."
        ),
        params_model=UpdateUserGroupParams,
        tier=ActionTier.EDIT,
        rights_bucket="usergroups",
        access_action=AccessAction.UPDATE,
        execute=_update_usergroup,
        target_param="usergroup_id",
        target_kind="usergroup",
        summarize=lambda p: "Update usergroup fields: "
        + ", ".join(
            p.model_dump(exclude={"usergroup_id"}, exclude_none=True) or ["-"]
        ),
    ),
    ToolSpec(
        name="manage_usergroup_members",
        description=(
            "Add users to or remove users from a usergroup by numeric user "
            "ids. Added users must already be members of the organization; "
            "unknown or already-linked ids are skipped."
        ),
        params_model=ManageUserGroupMembersParams,
        tier=ActionTier.EDIT,
        rights_bucket="usergroups",
        access_action=AccessAction.UPDATE,
        execute=_manage_usergroup_members,
        target_param="usergroup_id",
        target_kind="usergroup",
        summarize=lambda p: (
            f"{'Add' if p.operation == 'add' else 'Remove'} "
            f"{len(p.user_ids)} user(s) "
            f"{'to' if p.operation == 'add' else 'from'} usergroup "
            f"{p.usergroup_id}"
        ),
    ),
    ToolSpec(
        name="link_usergroup_resources",
        description=(
            "Link resources (courses, communities, podcasts, folders, media, "
            "boards — by uuid) to a usergroup, or unlink them. Members of the "
            "group gain access to linked resources."
        ),
        params_model=LinkUserGroupResourcesParams,
        tier=ActionTier.EDIT,
        rights_bucket="usergroups",
        access_action=AccessAction.UPDATE,
        execute=_link_usergroup_resources,
        target_param="usergroup_id",
        target_kind="usergroup",
        summarize=lambda p: (
            f"{'Link' if p.operation == 'add' else 'Unlink'} "
            f"{len(p.resource_uuids)} resource(s) "
            f"{'to' if p.operation == 'add' else 'from'} usergroup "
            f"{p.usergroup_id}"
        ),
    ),
    ToolSpec(
        name="delete_usergroup",
        description=(
            "Permanently delete a usergroup (memberships and resource links "
            "go with it; the users and resources themselves are untouched). "
            "Irreversible."
        ),
        params_model=DeleteUserGroupParams,
        tier=ActionTier.DESTRUCTIVE,
        rights_bucket="usergroups",
        access_action=AccessAction.DELETE,
        execute=_delete_usergroup,
        target_param="usergroup_id",
        target_kind="usergroup",
    ),
]
