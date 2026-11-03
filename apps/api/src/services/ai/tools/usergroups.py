"""User group tools: who is in a group and what the group unlocks.

A user group gates the resources linked to it (courses, communities,
folders, media, boards, podcasts): its members can see them. Changing a
group's members or links changes who can see what, so those changes need the
admin scope and a person's approval on MCP. Groups and members are always
loaded from the connected organization first, and every add or link is
reported per item: a person who is not a member, or a resource from another
organization, is named as such instead of being silently skipped.
"""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlmodel import select

from src.db.usergroup_resources import UserGroupResource
from src.db.usergroup_user import UserGroupUser
from src.db.usergroups import UserGroupCreate, UserGroupUpdate
from src.security.rbac import AccessAction
from src.services.ai.tools import refs
from src.services.ai.tools.base import ActionTier, ToolContext, ToolSpec
from src.services.ai.tools.results import (
    DETAIL_TEXT,
    Paging,
    changed,
    clip,
    page_of,
    untrusted,
)
from src.services.users.usergroups import (
    add_resources_to_usergroup,
    add_users_to_usergroup,
    create_usergroup,
    delete_usergroup_by_id,
    get_resources_by_usergroup,
    get_users_linked_to_usergroup,
    rbac_check as usergroup_rbac_check,
    read_usergroups_by_org_id,
    remove_resources_from_usergroup,
    remove_users_from_usergroup,
    update_usergroup_by_id,
)

MAX_MEMBERS_PER_CALL = 100
MAX_RESOURCES_PER_CALL = 50
MAX_RESOURCES_SHOWN = 100

# Resource kinds a group can gate, by uuid prefix. Podcasts have no refs kind.
_LINKABLE = {
    "course_": "course",
    "community_": "community",
    "folder_": "folder",
    "media_": "media",
    "board_": "board",
    "podcast_": "podcast",
}
_PAGES = {"course": "course", "community": "community", "folder": "folder", "board": "board"}

_MEMBER_LIST = Field(
    None,
    max_length=MAX_MEMBERS_PER_CALL,
    description="Members by user_uuid, username or email; they must already belong to the organization.",
)
_RESOURCE_LIST = Field(
    None,
    max_length=MAX_RESOURCES_PER_CALL,
    description="Resource uuids: course_, community_, folder_, media_, board_ or podcast_.",
)


# ─── helpers ─────────────────────────────────────────────────────────────────


def _name(user) -> str | None:
    full = " ".join(p for p in (user.first_name, user.last_name) if p)
    return full or None


async def _group_ref(ctx: ToolContext, group, **extra) -> dict:
    return refs.ref(
        "usergroup", group.usergroup_uuid, group.name, await refs.web_url(ctx, "usergroup"), **extra
    )


def _kind_for(uuid: str) -> str | None:
    for prefix, kind in _LINKABLE.items():
        if uuid.startswith(prefix):
            return kind
    return None


async def _resource_ref(ctx: ToolContext, uuid: str) -> dict | None:
    """A pointer to a linkable resource of this organization, or None."""
    kind = _kind_for(uuid)
    if kind is None:
        return None
    if kind == "podcast":
        from src.db.podcasts.podcasts import Podcast

        row = (
            await ctx.db_session.execute(
                select(Podcast).where(Podcast.podcast_uuid == uuid, Podcast.org_id == ctx.org.id)
            )
        ).scalars().first()
        return refs.ref("podcast", uuid, row.name) if row else None
    try:
        row = await refs.load(ctx, kind, uuid)
    except HTTPException:
        return None
    url = await refs.web_url(ctx, _PAGES[kind], **{kind: uuid}) if kind in _PAGES else None
    return refs.ref(kind, uuid, refs.label(kind, row), url)


async def _member_ids(ctx: ToolContext, group_id: int) -> set[int]:
    return set(
        (
            await ctx.db_session.execute(
                select(UserGroupUser.user_id).where(UserGroupUser.usergroup_id == group_id)
            )
        ).scalars().all()
    )


async def _linked_uuids(ctx: ToolContext, group_id: int) -> set[str]:
    return set(
        (
            await ctx.db_session.execute(
                select(UserGroupResource.resource_uuid).where(
                    UserGroupResource.usergroup_id == group_id
                )
            )
        ).scalars().all()
    )


async def _apply_members(
    ctx: ToolContext, group, add: list[str], remove: list[str]
) -> list[dict]:
    results: list[dict] = []
    current = await _member_ids(ctx, group.id)

    async def resolve(who: str):
        try:
            return await refs.load_member(ctx, who)
        except HTTPException as e:
            if e.status_code == 403:
                raise  # an email lookup this caller may not make
            results.append({"member": who, "result": "not_a_member"})
            return None

    to_add: dict[int, tuple[str, Any]] = {}
    for who in add:
        user = await resolve(who)
        if user is None:
            continue
        if user.id in current or user.id in to_add:
            results.append({"member": who, "user_uuid": user.user_uuid, "result": "already_in_group"})
            continue
        to_add[user.id] = (who, user)
    if to_add:
        await add_users_to_usergroup(
            ctx.request, ctx.db_session, ctx.user, group.id, ",".join(str(i) for i in to_add)
        )
        current = await _member_ids(ctx, group.id)
        for user_id, (who, user) in to_add.items():
            results.append(
                {
                    "member": who,
                    "user_uuid": user.user_uuid,
                    "result": "added" if user_id in current else "not_added",
                }
            )

    to_remove: dict[int, tuple[str, Any]] = {}
    for who in remove:
        user = await resolve(who)
        if user is None:
            continue
        if user.id not in current:
            results.append({"member": who, "user_uuid": user.user_uuid, "result": "not_in_group"})
            continue
        to_remove[user.id] = (who, user)
    if to_remove:
        await remove_users_from_usergroup(
            ctx.request, ctx.db_session, ctx.user, group.id, ",".join(str(i) for i in to_remove)
        )
        current = await _member_ids(ctx, group.id)
        for user_id, (who, user) in to_remove.items():
            results.append(
                {
                    "member": who,
                    "user_uuid": user.user_uuid,
                    "result": "removed" if user_id not in current else "not_removed",
                }
            )
    return results


async def _apply_resources(
    ctx: ToolContext, group, link: list[str], unlink: list[str]
) -> list[dict]:
    results: list[dict] = []
    linked = await _linked_uuids(ctx, group.id)

    to_link: list[str] = []
    for uuid in dict.fromkeys(link):
        if _kind_for(uuid) is None:
            results.append({"resource_uuid": uuid, "result": "not_linkable"})
            continue
        if await _resource_ref(ctx, uuid) is None:
            results.append({"resource_uuid": uuid, "result": "not_found"})
            continue
        if uuid in linked:
            results.append({"resource_uuid": uuid, "result": "already_linked"})
            continue
        to_link.append(uuid)
    if to_link:
        await add_resources_to_usergroup(
            ctx.request, ctx.db_session, ctx.user, group.id, ",".join(to_link)
        )
        linked = await _linked_uuids(ctx, group.id)
        results += [
            {"resource_uuid": u, "result": "linked" if u in linked else "not_linked"} for u in to_link
        ]

    to_unlink = []
    for uuid in dict.fromkeys(unlink):
        if uuid not in linked:
            results.append({"resource_uuid": uuid, "result": "was_not_linked"})
            continue
        to_unlink.append(uuid)
    if to_unlink:
        await remove_resources_from_usergroup(
            ctx.request, ctx.db_session, ctx.user, group.id, ",".join(to_unlink)
        )
        linked = await _linked_uuids(ctx, group.id)
        results += [
            {"resource_uuid": u, "result": "unlinked" if u not in linked else "not_unlinked"}
            for u in to_unlink
        ]
    return results


def _change_summary(member_results: list[dict], resource_results: list[dict]) -> str:
    rows = member_results + resource_results
    labels = {
        "added": "member(s) added",
        "removed": "member(s) removed",
        "linked": "resource(s) linked",
        "unlinked": "resource(s) unlinked",
    }
    parts = []
    for result, label in labels.items():
        n = sum(1 for r in rows if r["result"] == result)
        if n:
            parts.append(f"{n} {label}")
    skipped = sum(1 for r in rows if r["result"] not in labels)
    if skipped:
        parts.append(f"{skipped} item(s) skipped, see the results")
    return "; ".join(parts)


# ─── list_usergroups ─────────────────────────────────────────────────────────


class ListUserGroupsParams(Paging):
    pass


async def _list_usergroups(ctx: ToolContext, p: ListUserGroupsParams):
    groups = await read_usergroups_by_org_id(ctx.request, ctx.db_session, ctx.user, ctx.org.id)
    ids = [g.id for g in groups]
    members = dict(
        (
            await ctx.db_session.execute(
                select(UserGroupUser.usergroup_id, func.count())
                .where(UserGroupUser.usergroup_id.in_(ids))
                .group_by(UserGroupUser.usergroup_id)
            )
        ).all()
    ) if ids else {}
    resources = dict(
        (
            await ctx.db_session.execute(
                select(UserGroupResource.usergroup_id, func.count())
                .where(UserGroupResource.usergroup_id.in_(ids))
                .group_by(UserGroupResource.usergroup_id)
            )
        ).all()
    ) if ids else {}
    items = [
        await _group_ref(
            ctx,
            g,
            description=clip(g.description) or None,
            members=members.get(g.id, 0),
            linked_resources=resources.get(g.id, 0),
        )
        for g in groups
    ]
    return page_of(items, p)


# ─── get_usergroup ───────────────────────────────────────────────────────────


class GetUserGroupParams(Paging):
    usergroup_uuid: str = Field(..., max_length=80, description="The group (usergroup_...).")


async def _get_usergroup(ctx: ToolContext, p: GetUserGroupParams):
    group = await refs.load(ctx, "usergroup", p.usergroup_uuid)
    # The roster is a management view (usergroups update right), as over HTTP.
    users = await get_users_linked_to_usergroup(ctx.request, ctx.db_session, ctx.user, group.id)
    uuids = await get_resources_by_usergroup(ctx.request, ctx.db_session, ctx.user, group.id)

    member_items = [
        refs.ref(
            "user",
            u.user_uuid,
            _name(u) or u.username,
            await refs.web_url(ctx, "user", username=u.username),
            username=u.username,
        )
        for u in sorted(users, key=lambda u: (u.username or "").lower())
    ]
    resource_items = []
    for uuid in uuids[:MAX_RESOURCES_SHOWN]:
        resource_items.append(await _resource_ref(ctx, uuid) or refs.ref(_kind_for(uuid) or "resource", uuid))
    out = await _group_ref(ctx, group, description=clip(group.description, DETAIL_TEXT) or None)
    out["members"] = page_of(member_items, p)
    out["resources"] = {
        "items": resource_items,
        "total": len(uuids),
        "truncated": len(uuids) > MAX_RESOURCES_SHOWN,
    }
    # Member names are written by the members themselves.
    return untrusted(out, "members")


# ─── create_usergroup ────────────────────────────────────────────────────────


class CreateUserGroupParams(BaseModel):
    name: str = Field(..., min_length=1, max_length=100, description="Group name.")
    description: str = Field("", max_length=500, description="What the group is for.")
    members: list[str] | None = _MEMBER_LIST
    resource_uuids: list[str] | None = _RESOURCE_LIST


async def _create_usergroup(ctx: ToolContext, p: CreateUserGroupParams):
    created = await create_usergroup(
        ctx.request,
        ctx.db_session,
        ctx.user,
        UserGroupCreate(name=p.name.strip(), description=p.description.strip(), org_id=ctx.org.id),
    )
    group = await refs.load(ctx, "usergroup", created.usergroup_uuid)
    member_results = await _apply_members(ctx, group, p.members or [], [])
    resource_results = await _apply_resources(ctx, group, p.resource_uuids or [], [])
    detail = _change_summary(member_results, resource_results)
    return changed(
        f"Created user group '{group.name}'" + (f": {detail}." if detail else "."),
        usergroup=await _group_ref(ctx, group),
        member_results=member_results or None,
        resource_results=resource_results or None,
    )


# ─── update_usergroup ────────────────────────────────────────────────────────


class UpdateUserGroupParams(BaseModel):
    usergroup_uuid: str = Field(..., max_length=80, description="The group (usergroup_...).")
    name: str | None = Field(None, min_length=1, max_length=100, description="New name.")
    description: str | None = Field(None, max_length=500, description="New description.")
    add_members: list[str] | None = _MEMBER_LIST
    remove_members: list[str] | None = _MEMBER_LIST
    link_resources: list[str] | None = _RESOURCE_LIST
    unlink_resources: list[str] | None = _RESOURCE_LIST


def _changes_access(p) -> bool:
    return bool(
        getattr(p, "members", None)
        or getattr(p, "resource_uuids", None)
        or getattr(p, "add_members", None)
        or getattr(p, "remove_members", None)
        or getattr(p, "link_resources", None)
        or getattr(p, "unlink_resources", None)
    )


async def _update_usergroup(ctx: ToolContext, p: UpdateUserGroupParams):
    group = await refs.load(ctx, "usergroup", p.usergroup_uuid)
    if not (p.name or p.description is not None or _changes_access(p)):
        raise HTTPException(status_code=400, detail="Nothing to change: pass at least one field.")
    # Authorize once up front, so per-item results never reveal anything to
    # someone who may not manage this group.
    await usergroup_rbac_check(
        ctx.request,
        usergroup_uuid=group.usergroup_uuid,
        current_user=ctx.user,
        action="update",
        db_session=ctx.db_session,
        org_id=group.org_id,
    )
    fields = []
    if p.name or p.description is not None:
        await update_usergroup_by_id(
            ctx.request,
            ctx.db_session,
            ctx.user,
            group.id,
            UserGroupUpdate(
                name=p.name.strip() if p.name else None,
                description=p.description.strip() if p.description is not None else None,
            ),
        )
        fields = [f for f in ("name", "description") if getattr(p, f) is not None]
        group = await refs.load(ctx, "usergroup", p.usergroup_uuid)
    member_results = await _apply_members(ctx, group, p.add_members or [], p.remove_members or [])
    resource_results = await _apply_resources(
        ctx, group, p.link_resources or [], p.unlink_resources or []
    )
    parts = [f"renamed or described ({', '.join(fields)})"] if fields else []
    detail = _change_summary(member_results, resource_results)
    if detail:
        parts.append(detail)
    return changed(
        f"Updated user group '{group.name}': " + "; ".join(parts or ["no change"]) + ".",
        usergroup=await _group_ref(ctx, group),
        member_results=member_results or None,
        resource_results=resource_results or None,
    )


# ─── delete_usergroup ────────────────────────────────────────────────────────


class DeleteUserGroupParams(BaseModel):
    usergroup_uuid: str = Field(..., max_length=80, description="The group to delete (usergroup_...).")


async def _delete_usergroup(ctx: ToolContext, p: DeleteUserGroupParams):
    group = await refs.load(ctx, "usergroup", p.usergroup_uuid)
    ref = await _group_ref(ctx, group)
    await delete_usergroup_by_id(ctx.request, ctx.db_session, ctx.user, group.id)
    return changed(
        f"Deleted user group '{group.name}'. Its members lost access granted only through it; "
        "the people and resources themselves are untouched.",
        usergroup=ref,
    )


def _summarize_update(p: UpdateUserGroupParams) -> str:
    bits = []
    if p.name:
        bits.append(f"rename to '{p.name}'")
    if p.description is not None:
        bits.append("change the description")
    for label, items in (
        ("add", p.add_members),
        ("remove", p.remove_members),
    ):
        if items:
            bits.append(f"{label} {len(items)} member(s)")
    for label, items in (("link", p.link_resources), ("unlink", p.unlink_resources)):
        if items:
            bits.append(f"{label} {len(items)} resource(s)")
    return f"User group {p.usergroup_uuid}: " + ", ".join(bits or ["no change"])


# ─── specs ───────────────────────────────────────────────────────────────────

SPECS: list[ToolSpec] = [
    ToolSpec(
        name="list_usergroups",
        description=(
            "The organization's user groups with member and linked-resource counts. Groups "
            "gate the resources linked to them: only their members see those."
        ),
        params_model=ListUserGroupsParams,
        tier=ActionTier.READ,
        rights_bucket="usergroups",
        access_action=AccessAction.READ,
        execute=_list_usergroups,
        access="admin",
        title="List user groups",
    ),
    ToolSpec(
        name="get_usergroup",
        description=(
            "One user group: its members (paged) and the resources it gates (courses, "
            "communities, folders, media, boards, podcasts)."
        ),
        params_model=GetUserGroupParams,
        tier=ActionTier.READ,
        rights_bucket="usergroups",
        access_action=AccessAction.READ,
        execute=_get_usergroup,
        access="admin",
        target_param="usergroup_uuid",
        target_kind="usergroup",
        title="Get user group",
    ),
    ToolSpec(
        name="create_usergroup",
        description=(
            "Create a user group, optionally with members (who must already belong to the "
            "organization) and linked resources they will be able to see. Reports a "
            "result per member and per resource."
        ),
        params_model=CreateUserGroupParams,
        tier=ActionTier.CREATE,
        rights_bucket="usergroups",
        access_action=AccessAction.CREATE,
        execute=_create_usergroup,
        access="admin",
        approval_if=_changes_access,
        target_kind="usergroup",
        summarize=lambda p: f"Create user group '{p.name}'"
        + (f" with {len(p.members)} member(s)" if p.members else "")
        + (f" gating {len(p.resource_uuids)} resource(s)" if p.resource_uuids else ""),
        title="Create user group",
    ),
    ToolSpec(
        name="update_usergroup",
        description=(
            "Rename a user group, change its members, or link and unlink the resources it "
            "gates, in one call. Members must already belong to the organization. Reports "
            "a result per member and per resource (added, already_in_group, not_a_member, "
            "linked, not_found, ...)."
        ),
        params_model=UpdateUserGroupParams,
        tier=ActionTier.EDIT,
        rights_bucket="usergroups",
        access_action=AccessAction.UPDATE,
        execute=_update_usergroup,
        access="admin",
        approval_if=_changes_access,
        idempotent=True,
        target_param="usergroup_uuid",
        target_kind="usergroup",
        summarize=_summarize_update,
        title="Update user group",
    ),
    ToolSpec(
        name="delete_usergroup",
        description=(
            "Delete a user group. Its members lose access granted only through it; the "
            "people and the resources themselves stay."
        ),
        params_model=DeleteUserGroupParams,
        tier=ActionTier.DESTRUCTIVE,
        rights_bucket="usergroups",
        access_action=AccessAction.DELETE,
        execute=_delete_usergroup,
        access="admin",
        target_param="usergroup_uuid",
        target_kind="usergroup",
        summarize=lambda p: f"Delete user group {p.usergroup_uuid}",
        title="Delete user group",
    ),
]
