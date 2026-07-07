"""Role tools — list/create/update/delete organization roles.

Every tool wraps an existing service function in-process, passing
`ctx.request` / `ctx.user` / `ctx.db_session` so the service's own RBAC
checks stay authoritative (membership, per-org permission, and the
no-privilege-escalation guard that stops a caller from granting rights
they don't hold themselves). Roles are addressed by their integer `id`
(as returned by `list_roles`), not a uuid.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from src.db.roles import RoleCreate, RoleUpdate
from src.security.rbac import AccessAction
from src.services.ai.tools.base import ActionTier, ToolContext, ToolSpec, jsonable
from src.services.roles.roles import (
    create_role,
    delete_role,
    get_roles_by_organization,
    update_role,
)

_RIGHTS_SHAPE = (
    "The rights dict must contain ALL of these bucket keys: 'courses', "
    "'users', 'usergroups', 'folders', 'media', 'organizations', "
    "'coursechapters', 'activities', 'roles', 'dashboard'. Each bucket is an "
    "object of boolean flags: 'courses' needs action_create, action_read, "
    "action_read_own, action_update, action_update_own, action_delete, "
    "action_delete_own; 'dashboard' needs action_access; every other bucket "
    "needs action_create, action_read, action_update, action_delete. "
    "Optional extra buckets with the courses shape: 'discussions', "
    "'podcasts', 'boards', 'playgrounds'; with the standard shape: "
    "'assignments', 'communities'."
)


def _rights_summary(rights) -> dict:
    """Bucket → list of granted action_* flags (compact, drops the Falses)."""
    data = jsonable(rights) or {}
    if not isinstance(data, dict):
        return {}
    return {
        bucket: sorted(k for k, v in perms.items() if v is True)
        for bucket, perms in data.items()
        if isinstance(perms, dict)
    }


def _compact_role(role) -> dict:
    data = jsonable(role)
    out = {
        k: data.get(k)
        for k in ("id", "role_uuid", "name", "description", "role_type", "org_id")
    }
    desc = out.get("description")
    if isinstance(desc, str) and len(desc) > 280:
        out["description"] = desc[:280] + "…"
    out["rights_summary"] = _rights_summary(data.get("rights"))
    return out


# ─── params ────────────────────────────────────────────────────────────────


class ListRolesParams(BaseModel):
    pass


class CreateRoleParams(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: str = ""
    rights: dict = Field(
        ...,
        description="Full rights structure for the role. " + _RIGHTS_SHAPE,
    )


class UpdateRoleParams(BaseModel):
    role_id: int = Field(..., description="Integer id of the role (from list_roles)")
    name: str | None = Field(None, min_length=1, max_length=100)
    description: str | None = None
    rights: dict | None = Field(
        None,
        description="Replacement rights structure (whole object, not a patch). "
        + _RIGHTS_SHAPE,
    )


class DeleteRoleParams(BaseModel):
    role_id: int = Field(..., description="Integer id of the role (from list_roles)")
    confirm: bool | None = None


# ─── executors ─────────────────────────────────────────────────────────────


async def _list_roles(ctx: ToolContext, p: ListRolesParams):
    roles = await get_roles_by_organization(
        ctx.request, ctx.db_session, ctx.org.id, ctx.user
    )
    return [_compact_role(r) for r in roles]


async def _create_role(ctx: ToolContext, p: CreateRoleParams):
    role = await create_role(
        ctx.request,
        ctx.db_session,
        RoleCreate(
            name=p.name,
            description=p.description,
            rights=p.rights,
            org_id=ctx.org.id,
        ),
        ctx.user,
    )
    return _compact_role(role)


async def _update_role(ctx: ToolContext, p: UpdateRoleParams):
    patch = p.model_dump(exclude={"role_id"}, exclude_none=True)
    role = await update_role(
        ctx.request,
        ctx.db_session,
        RoleUpdate(role_id=p.role_id, **patch),
        ctx.user,
    )
    return _compact_role(role)


async def _delete_role(ctx: ToolContext, p: DeleteRoleParams):
    return jsonable(
        await delete_role(ctx.request, ctx.db_session, p.role_id, ctx.user)
    )


# ─── specs ─────────────────────────────────────────────────────────────────

SPECS: list[ToolSpec] = [
    ToolSpec(
        name="list_roles",
        description=(
            "List the organization's roles (global system roles first, then "
            "org-specific ones) with a summary of granted rights per bucket. "
            "Use this FIRST to resolve a role's integer id before updating "
            "or deleting it."
        ),
        params_model=ListRolesParams,
        tier=ActionTier.READ,
        rights_bucket="roles",
        access_action=AccessAction.READ,
        execute=_list_roles,
    ),
    ToolSpec(
        name="create_role",
        description=(
            "Create a new organization role with a name, description and a "
            "full rights structure. You cannot grant a permission the "
            "calling user does not hold. " + _RIGHTS_SHAPE
        ),
        params_model=CreateRoleParams,
        tier=ActionTier.CREATE,
        rights_bucket="roles",
        access_action=AccessAction.CREATE,
        execute=_create_role,
        target_kind="role",
        summarize=lambda p: f'Create role "{p.name}"',
    ),
    ToolSpec(
        name="update_role",
        description=(
            "Update an organization role's name, description or rights. "
            "Only send fields to change; `rights`, when sent, replaces the "
            "whole rights object and must be complete. Global system roles "
            "cannot be updated."
        ),
        params_model=UpdateRoleParams,
        tier=ActionTier.EDIT,
        rights_bucket="roles",
        access_action=AccessAction.UPDATE,
        execute=_update_role,
        target_param="role_id",
        target_kind="role",
        summarize=lambda p: "Update role fields: "
        + ", ".join(p.model_dump(exclude={"role_id"}, exclude_none=True) or ["-"]),
    ),
    ToolSpec(
        name="delete_role",
        description=(
            "Permanently delete an organization role. Users assigned to it "
            "lose those rights immediately. Global system roles cannot be "
            "deleted. Irreversible."
        ),
        params_model=DeleteRoleParams,
        tier=ActionTier.DESTRUCTIVE,
        rights_bucket="roles",
        access_action=AccessAction.DELETE,
        execute=_delete_role,
        target_param="role_id",
        target_kind="role",
        summarize=lambda p: f"Delete role #{p.role_id}",
    ),
]
