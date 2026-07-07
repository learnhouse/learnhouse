"""User tools — list/lookup org members, invites, role changes, removal.

Every tool wraps an existing service function in-process, passing
`ctx.request` / `ctx.user` / `ctx.db_session` so the services' own RBAC
checks stay authoritative. Params models are curated subsets of what the
services accept — enough for an agent, nothing internal.
"""

from __future__ import annotations

from pydantic import BaseModel, EmailStr, Field, model_validator

from src.security.rbac import AccessAction
from src.services.ai.tools.base import ActionTier, ToolContext, ToolSpec, jsonable
from src.services.orgs.invites import create_invite_code
from src.services.orgs.users import (
    get_list_of_invited_users,
    get_organization_users,
    invite_batch_users,
    remove_user_from_org,
    update_user_role,
)
from src.services.users.users import read_user_by_username, read_user_by_uuid


def _compact_user(user) -> dict:
    data = jsonable(user)
    keep = (
        "id",
        "user_uuid",
        "username",
        "first_name",
        "last_name",
        "email",
        "email_verified",
        "avatar_image",
        "bio",
    )
    return {k: data.get(k) for k in keep if k in data}


def _compact_org_user(org_user) -> dict:
    data = jsonable(org_user)
    out = _compact_user(data.get("user") or {})
    role = data.get("role") or {}
    out["role"] = {k: role.get(k) for k in ("role_uuid", "name") if k in role}
    out["usergroups"] = [
        {"id": g.get("id"), "name": g.get("name")}
        for g in data.get("usergroups") or []
    ]
    out["joined_at"] = data.get("joined_at")
    return out


# ─── params ────────────────────────────────────────────────────────────────


class ListOrgUsersParams(BaseModel):
    page: int = Field(1, ge=1)
    limit: int = Field(20, ge=1, le=100)
    search: str = Field(
        "",
        description="Optional free-text filter on name, username or email",
    )


class GetUserParams(BaseModel):
    user_uuid: str | None = Field(
        None, description="User uuid (user_...); preferred when known"
    )
    username: str | None = Field(
        None, description="Exact username; used when no uuid is available"
    )

    @model_validator(mode="after")
    def _one_identifier(self):
        if not self.user_uuid and not self.username:
            raise ValueError("Provide user_uuid or username")
        return self


class InviteUsersParams(BaseModel):
    emails: list[EmailStr] = Field(
        ...,
        min_length=1,
        max_length=50,
        description="Email addresses to invite to the organization",
    )
    invite_code_uuid: str | None = Field(
        None,
        description=(
            "Optional existing invite code uuid (org_invite_code_...) to "
            "attach so invitees sign up with it"
        ),
    )


class CreateInviteCodeParams(BaseModel):
    usergroup_id: int | None = Field(
        None,
        ge=1,
        description="Optional user group new signups are auto-added to",
    )


class ListInvitedUsersParams(BaseModel):
    pass


class UpdateUserRoleParams(BaseModel):
    user_id: int = Field(
        ...,
        ge=1,
        description="The member's numeric user id (the `id` from list_org_users)",
    )
    role_uuid: str = Field(
        ...,
        min_length=1,
        description=(
            "Target role uuid: role_global_admin, role_global_maintainer, "
            "role_global_instructor, role_global_user, or a custom role_... uuid"
        ),
    )


class RemoveUserFromOrgParams(BaseModel):
    user_id: int = Field(
        ...,
        ge=1,
        description="The member's numeric user id (the `id` from list_org_users)",
    )
    confirm: bool | None = None


# ─── executors ─────────────────────────────────────────────────────────────


async def _list_org_users(ctx: ToolContext, p: ListOrgUsersParams):
    result = await get_organization_users(
        ctx.request,
        ctx.org.id,
        ctx.db_session,
        ctx.user,
        page=p.page,
        limit=p.limit,
        search=p.search,
    )
    return {
        "items": [_compact_org_user(u) for u in result.get("items", [])],
        "total": result.get("total"),
        "page": result.get("page"),
        "limit": result.get("limit"),
    }


async def _get_user(ctx: ToolContext, p: GetUserParams):
    if p.user_uuid:
        user = await read_user_by_uuid(
            ctx.request, ctx.db_session, ctx.user, p.user_uuid
        )
    else:
        user = await read_user_by_username(
            ctx.request, ctx.db_session, ctx.user, p.username
        )
    return _compact_user(user)


async def _invite_users(ctx: ToolContext, p: InviteUsersParams):
    result = await invite_batch_users(
        ctx.request,
        ctx.org.id,
        ",".join(p.emails),
        p.invite_code_uuid,
        ctx.db_session,
        ctx.user,
    )
    return jsonable(result)


async def _create_invite_code(ctx: ToolContext, p: CreateInviteCodeParams):
    code = await create_invite_code(
        ctx.request,
        ctx.org.id,
        ctx.user,
        ctx.db_session,
        usergroup_id=p.usergroup_id,
    )
    return jsonable(code)


async def _list_invited_users(ctx: ToolContext, p: ListInvitedUsersParams):
    invited = await get_list_of_invited_users(
        ctx.request, ctx.org.id, ctx.db_session, ctx.user
    )
    return jsonable(invited)


async def _update_user_role(ctx: ToolContext, p: UpdateUserRoleParams):
    result = await update_user_role(
        ctx.request,
        ctx.org.id,
        p.user_id,
        p.role_uuid,
        ctx.db_session,
        ctx.user,
    )
    return jsonable(result)


async def _remove_user_from_org(ctx: ToolContext, p: RemoveUserFromOrgParams):
    result = await remove_user_from_org(
        ctx.request,
        ctx.org.id,
        p.user_id,
        ctx.db_session,
        ctx.user,
    )
    return jsonable(result)


# ─── specs ─────────────────────────────────────────────────────────────────

SPECS: list[ToolSpec] = [
    ToolSpec(
        name="list_org_users",
        description=(
            "List the organization's members (paginated) with their role and "
            "user groups. Use this FIRST to resolve a member mentioned by "
            "name/email before changing their role or removing them — the "
            "returned `id` is what role/removal tools take."
        ),
        params_model=ListOrgUsersParams,
        tier=ActionTier.READ,
        rights_bucket="users",
        access_action=AccessAction.READ,
        execute=_list_org_users,
    ),
    ToolSpec(
        name="get_user",
        description=(
            "Get one user's public profile by uuid or exact username. "
            "Returns public fields only; use list_org_users for org role "
            "and membership details."
        ),
        params_model=GetUserParams,
        tier=ActionTier.READ,
        rights_bucket="users",
        access_action=AccessAction.READ,
        execute=_get_user,
        target_param="user_uuid",
        target_kind="user",
    ),
    ToolSpec(
        name="invite_users",
        description=(
            "Send email invitations to join the organization (up to 50 "
            "addresses per call). Optionally attach an existing invite code "
            "so signups land in its linked user group."
        ),
        params_model=InviteUsersParams,
        tier=ActionTier.CREATE,
        rights_bucket="organizations",
        access_action=AccessAction.CREATE,
        execute=_invite_users,
        summarize=lambda p: f"Invite {len(p.emails)} user(s) by email: "
        + ", ".join(p.emails[:5])
        + ("…" if len(p.emails) > 5 else ""),
    ),
    ToolSpec(
        name="create_invite_code",
        description=(
            "Create a shareable signup invite code for the organization "
            "(valid 365 days, max 6 active codes). Optionally bind it to a "
            "user group new signups are auto-added to."
        ),
        params_model=CreateInviteCodeParams,
        tier=ActionTier.CREATE,
        rights_bucket="organizations",
        access_action=AccessAction.UPDATE,
        execute=_create_invite_code,
        summarize=lambda p: "Create an organization invite code"
        + (f" linked to user group {p.usergroup_id}" if p.usergroup_id else ""),
    ),
    ToolSpec(
        name="list_invited_users",
        description=(
            "List pending email invitations (who was invited, when, and "
            "whether the email was sent). Use before re-inviting someone."
        ),
        params_model=ListInvitedUsersParams,
        tier=ActionTier.READ,
        rights_bucket="organizations",
        access_action=AccessAction.READ,
        execute=_list_invited_users,
    ),
    ToolSpec(
        name="update_user_role",
        description=(
            "Change an organization member's role (admin, maintainer, "
            "instructor, user, or a custom role). The org must always keep "
            "at least one admin."
        ),
        params_model=UpdateUserRoleParams,
        tier=ActionTier.EDIT,
        rights_bucket="organizations",
        access_action=AccessAction.UPDATE,
        execute=_update_user_role,
        target_kind="user",
        summarize=lambda p: f"Change user {p.user_id}'s role to {p.role_uuid}",
    ),
    ToolSpec(
        name="remove_user_from_org",
        description=(
            "Remove a member from the organization (their account is kept, "
            "only the membership is revoked). The last admin cannot be "
            "removed."
        ),
        params_model=RemoveUserFromOrgParams,
        tier=ActionTier.DESTRUCTIVE,
        rights_bucket="organizations",
        access_action=AccessAction.DELETE,
        execute=_remove_user_from_org,
        target_kind="user",
        summarize=lambda p: f"Remove user {p.user_id} from the organization",
    ),
]
