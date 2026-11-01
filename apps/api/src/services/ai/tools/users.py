"""People tools: members, invitations, invite links, roles of members.

These are the highest-impact tools in the catalog: they decide who belongs to
the organization and what each person may do. Text a learner wrote can end up
in front of an admin's agent, so every change here needs the admin scope and
a person's approval on MCP, and every call mirrors the HTTP route it stands
for (admin or maintainer for member lists, role ceilings, last-admin
protection, seat limits, invite rate limits). The services keep their own
checks; this layer only ever hands them members of the connected
organization.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timedelta
from typing import Literal

from fastapi import HTTPException
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func
from sqlmodel import select

from src.db.user_organizations import UserOrganization
from src.db.usergroup_user import UserGroupUser
from src.db.usergroups import UserGroup
from src.db.users import User
from src.security.auth import resolve_acting_user_id
from src.security.org_auth import enforce_org_mfa, get_user_org_role, is_org_admin
from src.security.rbac import AccessAction
from src.services.ai.tools import refs
from src.services.ai.tools.base import ActionTier, ToolContext, ToolSpec
from src.services.ai.tools.results import (
    DETAIL_TEXT,
    Paging,
    changed,
    clip,
    offset_of,
    page,
    page_of,
    untrusted,
)
from src.services.orgs.invites import (
    create_invite_code,
    delete_invite_code,
    get_invite_codes,
)
from src.services.orgs.orgs import rbac_check
from src.services.orgs.users import (
    get_list_of_invited_users,
    get_organization_users,
    invite_batch_users,
    remove_invited_user,
    remove_user_from_org,
    update_user_role,
)
from src.services.security.rate_limiting import INVITE_MAX_BATCH_SIZE

logger = logging.getLogger(__name__)

# The invite-link service refuses a seventh active link.
MAX_INVITE_CODES = 6
_CODE_UUID = re.compile(r"^org_invite_code_[0-9a-fA-F-]{36}$")

_MEMBER_FIELD = Field(
    ...,
    min_length=1,
    max_length=320,
    description="The member's user_uuid (user_...), username, or email.",
)


# ─── helpers ─────────────────────────────────────────────────────────────────


def _name(user) -> str | None:
    full = " ".join(p for p in (getattr(user, "first_name", ""), getattr(user, "last_name", "")) if p)
    return full or None


def _iso(value) -> str | None:
    """Stored dates are str(datetime); return them as ISO 8601."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value)).isoformat(timespec="seconds")
    except ValueError:
        return str(value)


def _expires_at(created_at, ttl_seconds) -> str | None:
    try:
        start = datetime.fromisoformat(str(created_at))
        return (start + timedelta(seconds=int(ttl_seconds))).isoformat(timespec="seconds")
    except (TypeError, ValueError):
        return None


async def _dash_url(ctx: ToolContext, path: str) -> str | None:
    base = await refs.web_base(ctx)
    return f"{base}{path}" if base else None


async def _member_ref(ctx: ToolContext, user) -> dict:
    return refs.ref(
        "user",
        user.user_uuid,
        _name(user) or user.username,
        await refs.web_url(ctx, "user", username=user.username),
        username=user.username,
    )


# Built-in roles, named in approval prompts (summaries only see the arguments).
_GLOBAL_ROLE_NAMES = {
    "role_global_admin": "Admin",
    "role_global_maintainer": "Maintainer",
    "role_global_instructor": "Instructor",
    "role_global_user": "User",
}


def _role_label(role_uuid: str) -> str:
    """'the Admin role (role_global_admin)', or 'role <uuid>' for a custom one."""
    name = _GLOBAL_ROLE_NAMES.get(role_uuid)
    return f"the {name} role ({role_uuid})" if name else f"role {role_uuid}"


def _role_ref(role) -> dict | None:
    if role is None:
        return None
    return refs.ref("role", role.role_uuid, role.name)


async def _is_staff(ctx: ToolContext) -> bool:
    """Admin or maintainer of this org (superadmins too), as the HTTP member
    routes require. API tokens resolve to the person who made them."""
    return await is_org_admin(resolve_acting_user_id(ctx.user), ctx.org.id, ctx.db_session)


async def _member_groups(ctx: ToolContext, user_id: int) -> list[dict]:
    rows = (
        await ctx.db_session.execute(
            select(UserGroup)
            .join(UserGroupUser, UserGroupUser.usergroup_id == UserGroup.id)
            .where(UserGroupUser.user_id == user_id, UserGroup.org_id == ctx.org.id)
        )
    ).scalars().all()
    url = await refs.web_url(ctx, "usergroup")
    return [refs.ref("usergroup", g.usergroup_uuid, g.name, url) for g in rows]


def _service_detail(e: HTTPException) -> str:
    detail = e.detail
    if isinstance(detail, dict):
        return str(detail.get("message") or detail)
    return str(detail)


# ─── list_members ────────────────────────────────────────────────────────────


class ListMembersParams(Paging):
    status: Literal["active", "invited"] = Field(
        "active",
        description="active: people who joined. invited: email invitations not yet accepted.",
    )
    query: str | None = Field(
        None, max_length=100, description="Match on name, username or email."
    )
    role_uuid: str | None = Field(
        None, max_length=80, description="Only members with this role (role_...). Active members only."
    )
    usergroup_uuid: str | None = Field(
        None, max_length=80, description="Only members of this user group (usergroup_...). Active members only."
    )


async def _list_members(ctx: ToolContext, p: ListMembersParams):
    if p.status == "invited":
        return await _list_invited(ctx, p)

    role_id = usergroup_id = None
    if p.role_uuid:
        role_id = (await refs.load(ctx, "role", p.role_uuid)).id
    if p.usergroup_uuid:
        usergroup_id = (await refs.load(ctx, "usergroup", p.usergroup_uuid)).id

    offset = offset_of(p.cursor)
    if offset % p.limit:
        raise HTTPException(
            status_code=400,
            detail="Keep the same limit while paging, or start again without a cursor.",
        )
    result = await get_organization_users(
        ctx.request,
        ctx.org.id,
        ctx.db_session,
        ctx.user,
        page=offset // p.limit + 1,
        limit=p.limit,
        search=(p.query or "").strip(),
        usergroup_id=usergroup_id,
        usergroup_filter="in_group" if usergroup_id else None,
        sort_order="desc",
        role_id=role_id,
    )
    group_url = await refs.web_url(ctx, "usergroup")
    role_url = await refs.web_url(ctx, "role")
    items = []
    for row in result.get("items", []):
        user, role = row.user, row.role
        items.append(
            {
                "user_uuid": user.user_uuid,
                "name": _name(user),
                "username": user.username,
                # The HTTP members list shows emails to admins and maintainers,
                # the only callers get_organization_users lets through.
                "email": user.email,
                "email_verified": user.email_verified,
                "role": refs.ref("role", role.role_uuid, role.name, role_url),
                "usergroups": [
                    refs.ref("usergroup", g.usergroup_uuid, g.name, group_url)
                    for g in row.usergroups
                ],
                "joined_at": _iso(row.joined_at),
                "active_this_month": bool(row.is_active),
            }
        )
    out = page(
        items,
        offset=offset,
        limit=p.limit,
        total=result.get("total"),
        manage_url=await _dash_url(ctx, "/dash/users/settings/users"),
    )
    # Names and usernames are written by the members themselves.
    return untrusted(out, "items") if items else out


async def _list_invited(ctx: ToolContext, p: ListMembersParams):
    if p.role_uuid or p.usergroup_uuid:
        raise HTTPException(
            status_code=400,
            detail="role_uuid and usergroup_uuid only filter active members; drop them for status='invited'.",
        )
    records = await get_list_of_invited_users(
        ctx.request, ctx.org.id, ctx.db_session, ctx.user
    )
    query = (p.query or "").strip().lower()
    items = []
    for record in records:
        if not isinstance(record, dict) or not record.get("pending", True):
            continue
        email = str(record.get("email") or "")
        if query and query not in email.lower():
            continue
        items.append(
            {
                "email": email,
                "invited_at": _iso(record.get("created_at")),
                "expires_at": _expires_at(record.get("created_at"), record.get("expires")),
                "email_sent": bool(record.get("email_sent")),
                "with_invite_link": bool(record.get("invite_code_uuid")),
            }
        )
    items.sort(key=lambda i: i["invited_at"] or "", reverse=True)
    return page_of(items, p, manage_url=await _dash_url(ctx, "/dash/users/settings/users"))


# ─── get_member ──────────────────────────────────────────────────────────────


class GetMemberParams(BaseModel):
    member: str = _MEMBER_FIELD


async def _get_member(ctx: ToolContext, p: GetMemberParams):
    # Private fields (email, role, groups, activity) only for admins and
    # maintainers on a connection with admin access, as on the members page.
    staff = ctx.can_admin and await _is_staff(ctx)
    if "@" in p.member and not staff:
        # Probing emails would tell anyone who is in the organization.
        raise HTTPException(status_code=403, detail=refs.EMAIL_LOOKUP_DENIED)
    user = await refs.load_member(ctx, p.member)
    out = await _member_ref(ctx, user)
    out["bio"] = clip(user.bio or "", DETAIL_TEXT) or None
    if not staff:
        return untrusted(out)

    acting = resolve_acting_user_id(ctx.user)
    await enforce_org_mfa(acting, ctx.org.id, ctx.db_session)
    membership = (
        await ctx.db_session.execute(
            select(UserOrganization).where(
                UserOrganization.user_id == user.id, UserOrganization.org_id == ctx.org.id
            )
        )
    ).scalars().first()
    role = await get_user_org_role(user.id, ctx.org.id, ctx.db_session)
    visit_days = 0
    try:
        from src.security.features_utils.active_users import (
            current_utc_year_month,
            get_visit_days_for_users,
        )

        year, month = current_utc_year_month()
        visit_days = (
            await get_visit_days_for_users(ctx.org.id, [user.id], year, month, ctx.db_session)
        ).get(user.id, 0)
    except Exception:  # pragma: no cover - display only
        logger.debug("agent-tools: visit days unavailable", exc_info=True)
    out.update(
        {
            "email": user.email,
            "email_verified": user.email_verified,
            "role": refs.ref("role", role.role_uuid, role.name, await refs.web_url(ctx, "role"))
            if role
            else None,
            "usergroups": await _member_groups(ctx, user.id),
            "joined_at": _iso(membership.creation_date) if membership else None,
            "last_login_at": _iso(user.last_login_at),
            "days_active_this_month": visit_days,
        }
    )
    return untrusted(out)


# ─── invite_members ──────────────────────────────────────────────────────────


class InviteMembersParams(BaseModel):
    emails: list[EmailStr] = Field(
        ...,
        min_length=1,
        max_length=INVITE_MAX_BATCH_SIZE,
        description=f"Addresses to invite, 1 to {INVITE_MAX_BATCH_SIZE} per call.",
    )
    usergroup_uuid: str | None = Field(
        None,
        max_length=80,
        description=(
            "Put people who sign up from this invitation into this user group "
            "(usergroup_...). Needs an invite link for that group (create_invite_code)."
        ),
    )


_INVITE_STATUS = {
    "sent": "invited",
    "email_failed": "email_failed",
    "already_invited": "already_invited",
    "invalid_email": "invalid_email",
}


async def _invite_code_for_group(ctx: ToolContext, usergroup_uuid: str) -> str:
    group = await refs.load(ctx, "usergroup", usergroup_uuid)
    codes = await get_invite_codes(ctx.request, ctx.org.id, ctx.user, ctx.db_session)
    for code in codes:
        if code.get("usergroup_id") == group.id and code.get("invite_code_uuid"):
            return code["invite_code_uuid"]
    raise HTTPException(
        status_code=400,
        detail=(
            f"No invite link puts people into '{group.name}'. Create one with "
            "create_invite_code(usergroup_uuid=...) first, then invite again."
        ),
    )


async def _invite_members(ctx: ToolContext, p: InviteMembersParams):
    # The permission check invite_batch_users makes, run first: the lookups
    # below would otherwise tell anyone which addresses already belong.
    await rbac_check(ctx.request, ctx.org.org_uuid, ctx.user, "create", ctx.db_session)
    code_uuid = None
    if p.usergroup_uuid:
        code_uuid = await _invite_code_for_group(ctx, p.usergroup_uuid)

    emails = list(dict.fromkeys(str(e).strip().lower() for e in p.emails))
    # People who already belong are not mailed again.
    existing = set(
        (
            await ctx.db_session.execute(
                select(User.email)
                .join(UserOrganization, UserOrganization.user_id == User.id)
                .where(UserOrganization.org_id == ctx.org.id)
                .where(func.lower(User.email).in_(emails))
            )
        ).scalars().all()
    )
    existing = {e.lower() for e in existing if e}
    to_invite = [e for e in emails if e not in existing]

    results = [{"email": e, "result": "already_member"} for e in emails if e in existing]
    if to_invite:
        try:
            outcome = await invite_batch_users(
                ctx.request, ctx.org.id, ",".join(to_invite), code_uuid, ctx.db_session, ctx.user
            )
        except HTTPException as e:
            # Rate, batch and member limits answer with a structured detail.
            raise HTTPException(status_code=e.status_code, detail=_service_detail(e))
        for row in outcome.get("results", []):
            results.append(
                {"email": row.get("email"), "result": _INVITE_STATUS.get(row.get("status"), row.get("status"))}
            )

    counts: dict[str, int] = {}
    for row in results:
        counts[row["result"]] = counts.get(row["result"], 0) + 1
    sent = counts.get("invited", 0)
    failed = counts.get("email_failed", 0)
    parts = [f"Sent {sent} of {len(emails)} invitation(s)"]
    if counts.get("already_invited"):
        parts.append(f"{counts['already_invited']} already had a pending invitation")
    if counts.get("already_member"):
        parts.append(f"{counts['already_member']} already belong to the organization")
    if counts.get("invalid_email"):
        parts.append(f"{counts['invalid_email']} address(es) were rejected as invalid")
    if failed:
        parts.append(
            f"{failed} email(s) could not be sent: the invitation is recorded but the "
            "person was not told; share the signup link with them another way"
        )
    return {
        "ok": failed == 0 and not counts.get("invalid_email"),
        "summary": "; ".join(parts) + ".",
        "results": results,
        "counts": counts,
        "manage_url": await _dash_url(ctx, "/dash/users/settings/users"),
    }


# ─── cancel_invitation ───────────────────────────────────────────────────────


class CancelInvitationParams(BaseModel):
    email: EmailStr = Field(..., description="The invited address to withdraw.")


async def _cancel_invitation(ctx: ToolContext, p: CancelInvitationParams):
    await remove_invited_user(ctx.request, ctx.org.id, str(p.email), ctx.db_session, ctx.user)
    return changed(
        f"Withdrew the invitation for {p.email}; it can no longer be used to join.",
        email=str(p.email).lower(),
    )


# ─── invite links ────────────────────────────────────────────────────────────


class ListInviteCodesParams(BaseModel):
    pass


async def _code_item(ctx: ToolContext, code: dict, group_url: str | None) -> dict:
    group = None
    if code.get("usergroup_id"):
        group_uuid = await refs.uuid_for(ctx, "usergroup", code["usergroup_id"])
        if group_uuid:
            group = refs.ref("usergroup", group_uuid, code.get("usergroup_name"), group_url)
    return {
        "code_uuid": code.get("invite_code_uuid"),
        "usergroup": group,
        "created_at": _iso(code.get("created_at")),
        "expires_at": _expires_at(code.get("created_at"), code.get("invite_code_expires")),
    }


async def _list_invite_codes(ctx: ToolContext, _p: ListInviteCodesParams):
    codes = await get_invite_codes(ctx.request, ctx.org.id, ctx.user, ctx.db_session)
    group_url = await refs.web_url(ctx, "usergroup")
    items = [await _code_item(ctx, c, group_url) for c in codes if isinstance(c, dict)]
    items.sort(key=lambda i: i["created_at"] or "", reverse=True)
    # The codes themselves are join secrets: they stay on the signups page.
    return page(
        items,
        offset=0,
        limit=MAX_INVITE_CODES,
        total=len(items),
        max_links=MAX_INVITE_CODES,
        remaining=max(0, MAX_INVITE_CODES - len(items)),
        manage_url=await _dash_url(ctx, "/dash/users/settings/signups"),
    )


class CreateInviteCodeParams(BaseModel):
    usergroup_uuid: str | None = Field(
        None,
        max_length=80,
        description="Put everyone who joins with this link into this user group (usergroup_...).",
    )
    expires_in_days: int | None = Field(
        None, ge=1, le=365, description="Days until the link stops working (1 to 365, default 365)."
    )


def _shorten_code_ttl(ctx: ToolContext, code: dict, days: int) -> dict:
    """The service always issues one-year links; shorten the stored key."""
    from config.config import get_learnhouse_config
    from src.services.orgs.invites import _get_redis

    ttl = days * 86400
    conn = get_learnhouse_config().redis_config.redis_connection_string
    r = _get_redis(conn)
    key = f"{code['invite_code_uuid']}:org:{ctx.org.org_uuid}:code:{code['invite_code']}"
    updated = dict(code, invite_code_expires=ttl)
    r.set(key, json.dumps(updated), ex=ttl)
    return updated


async def _create_invite_code(ctx: ToolContext, p: CreateInviteCodeParams):
    group = None
    if p.usergroup_uuid:
        group = await refs.load(ctx, "usergroup", p.usergroup_uuid)
    try:
        code = await create_invite_code(
            ctx.request, ctx.org.id, ctx.user, ctx.db_session,
            usergroup_id=group.id if group else None,
        )
    except HTTPException as e:
        if e.status_code == 400 and "maximum" in _service_detail(e).lower():
            raise HTTPException(
                status_code=400,
                detail=(
                    f"This organization already has {MAX_INVITE_CODES} invite links, the most "
                    "it can hold. Delete one with delete_invite_code, then try again."
                ),
            )
        raise
    if p.expires_in_days and p.expires_in_days < 365:
        code = _shorten_code_ttl(ctx, code, p.expires_in_days)

    base = await refs.web_base(ctx)
    join_link = f"{base}/signup?inviteCode={code['invite_code']}" if base else None
    group_ref = (
        refs.ref("usergroup", group.usergroup_uuid, group.name, await refs.web_url(ctx, "usergroup"))
        if group
        else None
    )
    return changed(
        "Created an invite link"
        + (f" that adds people to '{group.name}'" if group else "")
        + ". Anyone holding it can join the organization until it expires or is deleted, "
        "so share it only with the people it is meant for.",
        code_uuid=code["invite_code_uuid"],
        join_link=join_link,
        invite_code=None if join_link else code["invite_code"],
        usergroup=group_ref,
        expires_at=_expires_at(code.get("created_at"), code.get("invite_code_expires")),
    )


class DeleteInviteCodeParams(BaseModel):
    code_uuid: str = Field(
        ..., max_length=60, description="The link's code_uuid (org_invite_code_...) from list_invite_codes."
    )


async def _delete_invite_code(ctx: ToolContext, p: DeleteInviteCodeParams):
    if not _CODE_UUID.match(p.code_uuid):
        raise HTTPException(
            status_code=400,
            detail="Expected a code_uuid like 'org_invite_code_<uuid>' from list_invite_codes.",
        )
    await delete_invite_code(ctx.request, ctx.org.id, p.code_uuid, ctx.user, ctx.db_session)
    return changed(
        "Deleted the invite link; it no longer lets anyone join.", code_uuid=p.code_uuid
    )


# ─── set_member_role ─────────────────────────────────────────────────────────


class SetMemberRoleParams(BaseModel):
    member: str = _MEMBER_FIELD
    role_uuid: str = Field(
        ..., max_length=80, description="The role to give (role_...), from list_roles."
    )


async def _set_member_role(ctx: ToolContext, p: SetMemberRoleParams):
    user = await refs.load_member(ctx, p.member)
    role = await refs.load(ctx, "role", p.role_uuid)
    member = await _member_ref(ctx, user)
    previous = await get_user_org_role(user.id, ctx.org.id, ctx.db_session)
    if previous is not None and previous.id == role.id:
        return changed(
            f"{member['name']} already has the {role.name} role; nothing changed.",
            member=member,
            role=_role_ref(role),
        )
    # update_user_role keeps every rule of the HTTP route: no changing your
    # own role, below Admin no granting Admin/Maintainer or rights you lack,
    # the last admin stays, and the admin-seat cap applies.
    await update_user_role(
        ctx.request, ctx.org.id, user.id, role.role_uuid, ctx.db_session, ctx.user
    )
    return changed(
        f"{member['name']} now has the {role.name} role"
        + (f" (was {previous.name})." if previous else "."),
        member=member,
        role=_role_ref(role),
        previous_role=_role_ref(previous),
    )


# ─── remove_member ───────────────────────────────────────────────────────────


class RemoveMemberParams(BaseModel):
    member: str = _MEMBER_FIELD


async def _active_ai_connections(ctx: ToolContext, user_id: int) -> int | None:
    """How many AI app connections the member has to this organization."""
    try:
        from src.db.mcp_oauth import MCPOAuthGrant
    except ImportError:
        return None
    return int(
        (
            await ctx.db_session.execute(
                select(func.count())
                .select_from(MCPOAuthGrant)
                .where(
                    MCPOAuthGrant.user_id == user_id,
                    MCPOAuthGrant.org_id == ctx.org.id,
                    MCPOAuthGrant.revoked_at.is_(None),
                )
            )
        ).scalar()
        or 0
    )


async def _revoke_mcp_grants(ctx: ToolContext, user_id: int) -> None:
    """Safety net: remove_user_from_org already ends the member's AI app
    connections to this organization; make sure none is left."""
    try:
        from src.services.mcp.oauth import revoke_member_grants
    except ImportError:
        return
    await revoke_member_grants(ctx.db_session, user_id=user_id, org_id=ctx.org.id)


async def _remove_member(ctx: ToolContext, p: RemoveMemberParams):
    user = await refs.load_member(ctx, p.member)
    if user.id == resolve_acting_user_id(ctx.user):
        raise HTTPException(
            status_code=400,
            detail="You cannot remove yourself here. Leave the organization from your account settings.",
        )
    member = await _member_ref(ctx, user)
    connections = await _active_ai_connections(ctx, user.id)
    # Keeps the HTTP rules: maintainers cannot remove staff, the last admin
    # stays, and the member's API tokens, AI app connections, group
    # memberships and authorship in this org end with the membership.
    await remove_user_from_org(ctx.request, ctx.org.id, user.id, ctx.db_session, ctx.user)
    await _revoke_mcp_grants(ctx, user.id)
    return changed(
        f"Removed {member['name']} from the organization. Their account still exists; "
        "they lose access to this organization's content.",
        member=member,
        ai_connections_revoked=connections,
    )


# ─── specs ───────────────────────────────────────────────────────────────────

SPECS: list[ToolSpec] = [
    ToolSpec(
        name="list_members",
        description=(
            "List the organization's members with role, user groups, join date and email "
            "(admins and maintainers only), filtered by name/email, role or group. "
            "status='invited' lists email invitations not yet accepted."
        ),
        params_model=ListMembersParams,
        tier=ActionTier.READ,
        rights_bucket="users",
        access_action=AccessAction.READ,
        execute=_list_members,
        access="admin",
        title="List members",
    ),
    ToolSpec(
        name="get_member",
        description=(
            "One member of this organization by user_uuid, username or email. Admins get "
            "email, role, groups, join date and recent activity; others get the public "
            "profile. People outside the organization are not found."
        ),
        params_model=GetMemberParams,
        tier=ActionTier.READ,
        rights_bucket="users",
        access_action=AccessAction.READ,
        execute=_get_member,
        target_param="member",
        target_kind="user",
        title="Get member",
    ),
    ToolSpec(
        name="invite_members",
        description=(
            f"Email invitations to join the organization, up to {INVITE_MAX_BATCH_SIZE} "
            "addresses per call, subject to daily invite limits and the member limit. The "
            "email text is fixed. Returns a result per address (invited, already_member, "
            "already_invited, email_failed, invalid_email)."
        ),
        params_model=InviteMembersParams,
        tier=ActionTier.CREATE,
        rights_bucket="organizations",
        access_action=AccessAction.CREATE,
        execute=_invite_members,
        access="admin",
        approval=True,
        # The invite service sends as a person; it cannot act for a token.
        api_tokens=False,
        open_world=True,
        summarize=lambda p: f"Email {len(p.emails)} invitation(s) to join the organization: "
        + ", ".join(str(e) for e in p.emails[:5])
        + (" and more" if len(p.emails) > 5 else ""),
        title="Invite members",
    ),
    ToolSpec(
        name="cancel_invitation",
        description="Withdraw a pending email invitation so it can no longer be used to join.",
        params_model=CancelInvitationParams,
        tier=ActionTier.DESTRUCTIVE,
        rights_bucket="organizations",
        access_action=AccessAction.DELETE,
        execute=_cancel_invitation,
        access="admin",
        summarize=lambda p: f"Withdraw the invitation sent to {p.email}",
        title="Cancel invitation",
    ),
    ToolSpec(
        name="list_invite_codes",
        description=(
            f"The organization's invite links (at most {MAX_INVITE_CODES}): code_uuid, the "
            "user group each adds people to, and expiry. The secret codes stay on the "
            "signups page; use code_uuid with delete_invite_code."
        ),
        params_model=ListInviteCodesParams,
        tier=ActionTier.READ,
        rights_bucket="organizations",
        access_action=AccessAction.UPDATE,
        execute=_list_invite_codes,
        access="admin",
        title="List invite links",
    ),
    ToolSpec(
        name="create_invite_code",
        description=(
            "Create a shareable invite link anyone can use to join, optionally adding them "
            f"to a user group and expiring sooner than a year. At most {MAX_INVITE_CODES} "
            "links per organization. Returns the join link: share it only with its audience."
        ),
        params_model=CreateInviteCodeParams,
        tier=ActionTier.CREATE,
        rights_bucket="organizations",
        access_action=AccessAction.UPDATE,
        execute=_create_invite_code,
        access="admin",
        approval=True,
        summarize=lambda p: "Create an invite link anyone can use to join the organization"
        + (f", adding them to group {p.usergroup_uuid}" if p.usergroup_uuid else "")
        + (f", valid {p.expires_in_days} day(s)" if p.expires_in_days else ""),
        title="Create invite link",
    ),
    ToolSpec(
        name="delete_invite_code",
        description="Delete an invite link so nobody else can join with it. People who already joined stay.",
        params_model=DeleteInviteCodeParams,
        tier=ActionTier.DESTRUCTIVE,
        rights_bucket="organizations",
        access_action=AccessAction.UPDATE,
        execute=_delete_invite_code,
        access="admin",
        target_param="code_uuid",
        target_kind="invite_code",
        summarize=lambda p: f"Delete invite link {p.code_uuid}",
        title="Delete invite link",
    ),
    ToolSpec(
        name="set_member_role",
        description=(
            "Give a member another role (role_uuid from list_roles). You cannot change your "
            "own role or grant more than your own role allows; the organization keeps at "
            "least one admin, and admin seats are limited by plan."
        ),
        params_model=SetMemberRoleParams,
        tier=ActionTier.EDIT,
        rights_bucket="organizations",
        access_action=AccessAction.UPDATE,
        execute=_set_member_role,
        access="admin",
        approval=True,
        idempotent=True,
        target_param="member",
        target_kind="user",
        summarize=lambda p: f"Change the role of {p.member} to {_role_label(p.role_uuid)}",
        title="Set member role",
    ),
    ToolSpec(
        name="remove_member",
        description=(
            "Remove a member from the organization. Their account is kept; their access "
            "here, group memberships, API tokens and AI app connections end. The last "
            "admin cannot be removed, and only admins can remove staff."
        ),
        params_model=RemoveMemberParams,
        tier=ActionTier.DESTRUCTIVE,
        rights_bucket="organizations",
        access_action=AccessAction.DELETE,
        execute=_remove_member,
        access="admin",
        # The HTTP route refuses API tokens for removals.
        api_tokens=False,
        target_param="member",
        target_kind="user",
        summarize=lambda p: f"Remove {p.member} from the organization",
        title="Remove member",
    ),
]
