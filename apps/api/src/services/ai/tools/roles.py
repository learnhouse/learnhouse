"""Role tools: what each role may do, and custom roles of the organization.

A role is a set of rights per bucket (courses, users, roles, ...), each a set
of action flags. Global roles (Admin, Maintainer, Instructor, User) are fixed;
organizations add their own. Rights are taken as a typed patch on top of a
starting role (or nothing), so an agent names only the flags it changes and
cannot send a malformed or empty rights object. The service then refuses any
right the caller does not hold themselves.
"""

from __future__ import annotations

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, create_model
from sqlalchemy import func
from sqlmodel import select

from src.db.roles import (
    DashboardPermission,
    Permission,
    PermissionsWithOwn,
    Rights,
    RoleCreate,
    RoleTypeEnum,
    RoleUpdate,
)
from src.db.user_organizations import UserOrganization
from src.security.rbac import AccessAction
from src.services.ai.tools import refs
from src.services.ai.tools.base import ActionTier, ToolContext, ToolSpec
from src.services.ai.tools.results import DETAIL_TEXT, Paging, changed, clip, page_of
from src.services.roles.roles import (
    create_role,
    delete_role,
    get_roles_by_organization,
    read_role,
    update_role,
)


# ─── typed rights patch ──────────────────────────────────────────────────────


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PermissionPatch(_Strict):
    action_create: bool | None = None
    action_read: bool | None = None
    action_update: bool | None = None
    action_delete: bool | None = None


class OwnPermissionPatch(PermissionPatch):
    action_read_own: bool | None = Field(None, description="Read what they authored.")
    action_update_own: bool | None = Field(None, description="Edit what they authored.")
    action_delete_own: bool | None = Field(None, description="Delete what they authored.")


class DashboardPatch(_Strict):
    action_access: bool | None = Field(None, description="Can open the admin dashboard (uses an admin seat).")


_PATCH_FOR = {
    Permission: PermissionPatch,
    PermissionsWithOwn: OwnPermissionPatch,
    DashboardPermission: DashboardPatch,
}
_BUCKETS = list(Rights.model_fields)

RightsPatch = create_model(  # type: ignore[call-overload]
    "RightsPatch",
    __config__=ConfigDict(extra="forbid"),
    **{
        bucket: (_PATCH_FOR[field.annotation] | None, None)
        for bucket, field in Rights.model_fields.items()
    },
)

_RIGHTS_FIELD_DESC = (
    "Only the flags to change, per bucket, e.g. {\"courses\": {\"action_update\": true}}. "
    f"Buckets: {', '.join(_BUCKETS)}. You cannot grant a flag your own role lacks."
)


def _perms_of(bucket: str) -> list[str]:
    return list(Rights.model_fields[bucket].annotation.model_fields)


def _full_rights(base: dict | None, patch: BaseModel | None) -> dict:
    """Every bucket and flag, from `base` (missing flags off) plus `patch`."""
    base = base if isinstance(base, dict) else {}
    out: dict[str, dict[str, bool]] = {}
    for bucket in _BUCKETS:
        current = base.get(bucket) if isinstance(base.get(bucket), dict) else {}
        out[bucket] = {perm: current.get(perm) is True for perm in _perms_of(bucket)}
    if patch is not None:
        for bucket, flags in patch.model_dump(exclude_none=True).items():
            out[bucket].update({k: bool(v) for k, v in flags.items()})
    return out


def _rights_dict(rights) -> dict:
    if rights is None:
        return {}
    if isinstance(rights, dict):
        return rights
    return rights.model_dump()


def _summary(rights) -> dict[str, str]:
    """Granted flags per bucket, e.g. {"courses": "create, read, update_own"}."""
    full = _full_rights(_rights_dict(rights), None)
    out = {}
    for bucket, flags in full.items():
        granted = [k.removeprefix("action_") for k, v in flags.items() if v]
        if granted:
            out[bucket] = ", ".join(granted)
    return out


def _is_global(role) -> bool:
    return role.role_type == RoleTypeEnum.TYPE_GLOBAL or role.org_id is None


async def _holders(ctx: ToolContext, role_ids: list[int]) -> dict[int, int]:
    if not role_ids:
        return {}
    rows = (
        await ctx.db_session.execute(
            select(UserOrganization.role_id, func.count())
            .where(UserOrganization.org_id == ctx.org.id, UserOrganization.role_id.in_(role_ids))
            .group_by(UserOrganization.role_id)
        )
    ).all()
    return dict(rows)


async def _role_ref(ctx: ToolContext, role, **extra) -> dict:
    return refs.ref("role", role.role_uuid, role.name, await refs.web_url(ctx, "role"), **extra)


# ─── list_roles / get_role ───────────────────────────────────────────────────


class ListRolesParams(Paging):
    pass


async def _list_roles(ctx: ToolContext, p: ListRolesParams):
    roles = await get_roles_by_organization(ctx.request, ctx.db_session, ctx.org.id, ctx.user)
    counts = await _holders(ctx, [r.id for r in roles])
    items = [
        await _role_ref(
            ctx,
            r,
            scope="global" if _is_global(r) else "organization",
            editable=not _is_global(r),
            description=clip(r.description) or None,
            members=counts.get(r.id, 0),
            rights=_summary(r.rights),
        )
        for r in roles
    ]
    return page_of(items, p)


class GetRoleParams(BaseModel):
    role_uuid: str = Field(..., max_length=80, description="The role (role_...).")


async def _get_role(ctx: ToolContext, p: GetRoleParams):
    role = await refs.load(ctx, "role", p.role_uuid)
    await read_role(ctx.request, ctx.db_session, role.id, ctx.user)
    counts = await _holders(ctx, [role.id])
    return await _role_ref(
        ctx,
        role,
        scope="global" if _is_global(role) else "organization",
        editable=not _is_global(role),
        description=clip(role.description, DETAIL_TEXT) or None,
        members=counts.get(role.id, 0),
        rights=_full_rights(_rights_dict(role.rights), None),
    )


# ─── create_role / update_role / delete_role ─────────────────────────────────


class CreateRoleParams(BaseModel):
    name: str = Field(..., min_length=1, max_length=100, description="Role name, unique in the organization.")
    description: str = Field("", max_length=500, description="What the role is for.")
    base_role_uuid: str | None = Field(
        None,
        max_length=80,
        description="Start from this role's rights (role_...). Omit to start with everything off.",
    )
    rights: RightsPatch | None = Field(None, description=_RIGHTS_FIELD_DESC)  # type: ignore[valid-type]


async def _create_role(ctx: ToolContext, p: CreateRoleParams):
    base = None
    if p.base_role_uuid:
        base_role = await refs.load(ctx, "role", p.base_role_uuid)
        base = _rights_dict(base_role.rights)
    rights = _full_rights(base, p.rights)
    created = await create_role(
        ctx.request,
        ctx.db_session,
        RoleCreate(
            name=p.name.strip(),
            description=p.description.strip(),
            rights=rights,
            org_id=ctx.org.id,
        ),
        ctx.user,
    )
    role = await refs.load(ctx, "role", created.role_uuid)
    return changed(
        f"Created role '{role.name}'.",
        role=await _role_ref(ctx, role),
        rights=_summary(role.rights),
    )


class UpdateRoleParams(BaseModel):
    role_uuid: str = Field(..., max_length=80, description="An organization role (role_...); global roles are fixed.")
    name: str | None = Field(None, min_length=1, max_length=100, description="New name.")
    description: str | None = Field(None, max_length=500, description="New description.")
    rights: RightsPatch | None = Field(None, description=_RIGHTS_FIELD_DESC)  # type: ignore[valid-type]


def _refuse_global(role) -> None:
    if _is_global(role):
        raise HTTPException(
            status_code=403,
            detail=(
                f"'{role.name}' is a built-in role and cannot be changed. Create an "
                "organization role from it with create_role(base_role_uuid=...)."
            ),
        )


async def _update_role(ctx: ToolContext, p: UpdateRoleParams):
    role = await refs.load(ctx, "role", p.role_uuid)
    _refuse_global(role)
    changes: dict = {}
    if p.name is not None:
        changes["name"] = p.name.strip()
    if p.description is not None:
        changes["description"] = p.description.strip()
    if p.rights is not None and p.rights.model_dump(exclude_none=True):
        changes["rights"] = _full_rights(_rights_dict(role.rights), p.rights)
    if not changes:
        raise HTTPException(status_code=400, detail="Nothing to change: pass name, description or rights.")
    before = _summary(role.rights)
    await update_role(ctx.request, ctx.db_session, RoleUpdate(role_id=role.id, **changes), ctx.user)
    role = await refs.load(ctx, "role", p.role_uuid)
    after = _summary(role.rights)
    return changed(
        f"Updated role '{role.name}' ({', '.join(changes)}).",
        role=await _role_ref(ctx, role),
        rights=after if "rights" in changes else None,
        rights_before=before if "rights" in changes else None,
    )


class DeleteRoleParams(BaseModel):
    role_uuid: str = Field(..., max_length=80, description="An organization role (role_...).")


async def _delete_role(ctx: ToolContext, p: DeleteRoleParams):
    role = await refs.load(ctx, "role", p.role_uuid)
    _refuse_global(role)
    holders = (await _holders(ctx, [role.id])).get(role.id, 0)
    if holders:
        raise HTTPException(
            status_code=409,
            detail=(
                f"{holders} member(s) have the role '{role.name}'. Give them another role "
                "with set_member_role first (list_members with role_uuid finds them)."
            ),
        )
    ref = await _role_ref(ctx, role)
    await delete_role(ctx.request, ctx.db_session, role.id, ctx.user)
    return changed(f"Deleted role '{role.name}'.", role=ref)


def _patch_text(p) -> str:
    patch = p.rights.model_dump(exclude_none=True) if p.rights is not None else {}
    flags = [
        f"{bucket}.{flag.removeprefix('action_')}={'on' if value else 'off'}"
        for bucket, values in patch.items()
        for flag, value in values.items()
    ]
    if not flags:
        return ""
    shown = ", ".join(flags[:8]) + (" and more" if len(flags) > 8 else "")
    return f" with rights {shown}"


# ─── specs ───────────────────────────────────────────────────────────────────

SPECS: list[ToolSpec] = [
    ToolSpec(
        name="list_roles",
        description=(
            "The roles members can have: built-in (global) roles and this organization's "
            "own, with how many members hold each and a summary of granted rights."
        ),
        params_model=ListRolesParams,
        tier=ActionTier.READ,
        rights_bucket="roles",
        access_action=AccessAction.READ,
        execute=_list_roles,
        access="admin",
        title="List roles",
    ),
    ToolSpec(
        name="get_role",
        description="One role with every rights flag per bucket, as create_role and update_role take them.",
        params_model=GetRoleParams,
        tier=ActionTier.READ,
        rights_bucket="roles",
        access_action=AccessAction.READ,
        execute=_get_role,
        access="admin",
        target_param="role_uuid",
        target_kind="role",
        title="Get role",
    ),
    ToolSpec(
        name="create_role",
        description=(
            "Create an organization role. Starts from base_role_uuid's rights (or all off) "
            "and applies the rights patch. You cannot grant a right your own role lacks; "
            "dashboard access uses admin seats."
        ),
        params_model=CreateRoleParams,
        tier=ActionTier.CREATE,
        rights_bucket="roles",
        access_action=AccessAction.CREATE,
        execute=_create_role,
        access="admin",
        approval=True,
        target_kind="role",
        summarize=lambda p: f"Create role '{p.name}'"
        + (f" based on {p.base_role_uuid}" if p.base_role_uuid else "")
        + _patch_text(p),
        title="Create role",
    ),
    ToolSpec(
        name="update_role",
        description=(
            "Rename an organization role or change its rights with a patch (only the flags "
            "you send change). Applies at once to every member holding it. Built-in roles "
            "are fixed. You cannot grant a right your own role lacks."
        ),
        params_model=UpdateRoleParams,
        tier=ActionTier.EDIT,
        rights_bucket="roles",
        access_action=AccessAction.UPDATE,
        execute=_update_role,
        access="admin",
        approval=True,
        idempotent=True,
        target_param="role_uuid",
        target_kind="role",
        summarize=lambda p: f"Update role {p.role_uuid}"
        + (f": rename to '{p.name}'" if p.name else "")
        + _patch_text(p),
        title="Update role",
    ),
    ToolSpec(
        name="delete_role",
        description=(
            "Delete an organization role nobody holds anymore (move its members with "
            "set_member_role first). Built-in roles cannot be deleted."
        ),
        params_model=DeleteRoleParams,
        tier=ActionTier.DESTRUCTIVE,
        rights_bucket="roles",
        access_action=AccessAction.DELETE,
        execute=_delete_role,
        access="admin",
        target_param="role_uuid",
        target_kind="role",
        summarize=lambda p: f"Delete role {p.role_uuid}",
        title="Delete role",
    ),
]
