"""More user group tools: smart rules, nesting, managers, access windows,
scheduled memberships, join codes, progress, CSV import, bulk moves,
announcements and history.

Everything goes through the same services as the dashboard, so the same
permission checks (org admin rights on ``usergroups``; managers only on their
own groups) and plan gates apply. Anything that takes people out of a group,
takes access away, changes rules (which can remove people), hands out
manager rights, emails members or touches more than a handful of people at
once needs a person's approval on MCP.
"""

from __future__ import annotations

from typing import Literal

from fastapi import HTTPException
from pydantic import BaseModel, Field

from src.security.rbac import AccessAction
from src.services.ai.tools import refs
from src.services.ai.tools.base import ActionTier, ToolContext, ToolSpec
from src.services.ai.tools.results import changed, untrusted
from src.services.usergroups import access, bulk, codes, groups, progress, space
from src.services.usergroups.common import load_group_by_uuid
from src.services.usergroups.sync import sync_org

BULK_THRESHOLD = 5
_GROUP = Field(..., max_length=80, description="The group (usergroup_...).")
_PEOPLE = Field(default_factory=list, max_length=100,
                description="Members by user_uuid, username or email; they must already belong to the organization.")


async def _group(ctx: ToolContext, uuid: str):
    return await load_group_by_uuid(ctx.db_session, ctx.org.id, uuid)


async def _user_ids(ctx: ToolContext, people: list[str]) -> tuple[list[int], list[dict]]:
    ids, missing = [], []
    for who in people:
        try:
            ids.append((await refs.load_member(ctx, who)).id)
        except HTTPException as e:
            if e.status_code == 403:
                raise
            missing.append({"member": who, "result": "not_a_member"})
    return ids, missing


async def _ref(ctx: ToolContext, group) -> dict:
    return refs.ref("usergroup", group.usergroup_uuid, group.name, await refs.web_url(ctx, "usergroup"))


# ── reading ─────────────────────────────────────────────────────────────


class OverviewParams(BaseModel):
    pass


async def _overview(ctx: ToolContext, p: OverviewParams):
    data = await groups.overview(ctx.request, ctx.db_session, ctx.user, ctx.org.id)
    items = [{k: g[k] for k in ("usergroup_uuid", "name", "kind", "types", "parent_name", "member_count",
                                 "inherited_count", "resource_counts", "active_codes", "space_enabled")}
             | {"managers": [m["username"] for m in g["managers"]]} for g in data["items"]]
    return untrusted({"items": items, "features": data["features"]}, "items")


class GroupParams(BaseModel):
    usergroup_uuid: str = _GROUP


async def _progress(ctx: ToolContext, p: GroupParams):
    group = await _group(ctx, p.usergroup_uuid)
    data = await progress.group_progress(ctx.request, ctx.db_session, ctx.user, group.id)
    members = [{k: r[k] for k in ("username", "enrolled", "completed", "avg_progress", "last_active", "at_risk")}
               for r in data["members"][:100]]
    return untrusted({"usergroup": await _ref(ctx, group), "summary": data["summary"], "courses": data["courses"],
                      "activity": data["activity"], "members": members, "members_total": len(data["members"])}, "members")


class HistoryParams(GroupParams):
    page: int = Field(1, ge=1, le=100)


async def _history(ctx: ToolContext, p: HistoryParams):
    group = await _group(ctx, p.usergroup_uuid)
    data = await groups.history(ctx.request, ctx.db_session, ctx.user, group.id, p.page)
    return {"usergroup": await _ref(ctx, group), "total": data["total"], "names": data["names"],
            "items": [{"action": r["action"], "via": r["via"], "at": r["created_at"], "details": r["details"],
                       "by": (r["actor"] or {}).get("username")} for r in data["items"]]}


class PreviewRulesParams(BaseModel):
    rules: dict = Field(..., description='{"match": "all"|"any", "conditions": [{"type": "email_domain", "values": ["school.edu"]}, ...]}. '
                                         "Types: email_domain, role, signup_field, people_field, tag, enrolled, completed, "
                                         "progress_at_least, progress_below, path_enrolled, path_completed, company, joined_after, "
                                         "joined_before, joined_within_days, active_within_days, inactive_days, scim_group, in_group; "
                                         "any condition takes negate: true.")


async def _preview_rules(ctx: ToolContext, p: PreviewRulesParams):
    out = await groups.preview_rules(ctx.request, ctx.db_session, ctx.user, ctx.org.id, p.rules)
    return untrusted({"count": out["count"], "sample": [s["username"] for s in out["sample"]]}, "sample")


# ── rules, nesting, managers ────────────────────────────────────────────


class SetRulesParams(GroupParams):
    kind: Literal["manual", "smart", "hybrid"] = Field(..., description="manual: by hand; smart: rules only; hybrid: rules plus people added by hand.")
    rules: dict | None = Field(None, description="The rule set (see preview_usergroup_rules); omit to keep the current rules.")
    auto_join_domains: list[str] | None = Field(None, max_length=20, description="Email domains whose members join automatically.")


async def _set_rules(ctx: ToolContext, p: SetRulesParams):
    group = await _group(ctx, p.usergroup_uuid)
    body = groups.GroupSettingsBody(kind=p.kind, rules=p.rules,
                                    settings={"auto_join_domains": p.auto_join_domains} if p.auto_join_domains is not None else None)
    out = await groups.update_settings(ctx.request, ctx.db_session, ctx.user, group.id, body)
    return changed(f"Group '{group.name}' is now {p.kind} with {out['member_count']} member(s).",
                   usergroup=await _ref(ctx, group), members_by_source=out["members_by_source"])


class SetParentParams(GroupParams):
    parent_uuid: str = Field(..., max_length=80, description="The parent group, or an empty string to un-nest.")


async def _set_parent(ctx: ToolContext, p: SetParentParams):
    group = await _group(ctx, p.usergroup_uuid)
    out = await groups.update_settings(ctx.request, ctx.db_session, ctx.user, group.id, groups.GroupSettingsBody(parent_uuid=p.parent_uuid))
    parent = out["parent"]["name"] if out["parent"] else None
    return changed(f"Group '{group.name}' " + (f"is now inside '{parent}': its members get what '{parent}' unlocks." if parent else "is no longer nested."),
                   usergroup=await _ref(ctx, group))


class ManagerParams(GroupParams):
    member: str = Field(..., max_length=320, description="The member (user_uuid, username or email).")
    remove: bool = Field(False, description="Take the manager role away instead.")
    can_manage_members: bool = True
    can_view_progress: bool = True
    can_post: bool = True
    digest: bool = Field(False, description="Weekly progress email to this manager.")


async def _manager(ctx: ToolContext, p: ManagerParams):
    group = await _group(ctx, p.usergroup_uuid)
    user = await refs.load_member(ctx, p.member)
    if p.remove:
        await groups.remove_manager(ctx.request, ctx.db_session, ctx.user, group.id, user.id)
        return changed(f"{user.username} no longer manages '{group.name}'.", usergroup=await _ref(ctx, group))
    await groups.set_manager(ctx.request, ctx.db_session, ctx.user, group.id, groups.ManagerBody(
        user_id=user.id, can_manage_members=p.can_manage_members, can_view_progress=p.can_view_progress,
        can_post=p.can_post, digest=p.digest))
    return changed(f"{user.username} manages '{group.name}'.", usergroup=await _ref(ctx, group))


# ── members with dates, bulk, import ────────────────────────────────────


class MembersParams(GroupParams):
    add: list[str] = _PEOPLE
    remove: list[str] = _PEOPLE
    starts_at: str | None = Field(None, max_length=40, description="ISO date: added people join on this date (scheduled).")
    expires_at: str | None = Field(None, max_length=40, description="ISO date: added people leave on this date.")


async def _members(ctx: ToolContext, p: MembersParams):
    group = await _group(ctx, p.usergroup_uuid)
    add_ids, missing = await _user_ids(ctx, p.add)
    remove_ids, missing2 = await _user_ids(ctx, p.remove)
    out: dict = {"skipped": missing + missing2}
    if add_ids:
        out["added"] = await groups.add_members(ctx.request, ctx.db_session, ctx.user, group.id,
                                                groups.MembersBody(user_ids=add_ids, starts_at=p.starts_at, expires_at=p.expires_at))
    if remove_ids:
        out["removed"] = await groups.remove_members(ctx.request, ctx.db_session, ctx.user, group.id, remove_ids)
    a = out.get("added", {})
    r = out.get("removed", {})
    summary = (f"'{group.name}': {len(a.get('added', [])) + len(a.get('updated', []))} added, "
               f"{len(a.get('scheduled', []))} scheduled, {len(r.get('removed', []))} removed")
    if r.get("kept"):
        summary += f", {len(r['kept'])} kept by rules or sub-groups"
    return changed(summary + ".", usergroup=await _ref(ctx, group), results=out)


class BulkParams(BaseModel):
    action: Literal["add", "remove", "move"]
    members: list[str] = _PEOPLE
    usergroup_uuids: list[str] = Field(..., min_length=1, max_length=20, description="Target groups (one for move).")
    from_usergroup_uuid: str | None = Field(None, max_length=80, description="For move: the group they leave.")


async def _bulk(ctx: ToolContext, p: BulkParams):
    ids, missing = await _user_ids(ctx, p.members)
    out = await bulk.bulk(ctx.request, ctx.db_session, ctx.user, ctx.org.id, bulk.BulkBody(
        action=p.action, user_ids=ids, usergroup_uuids=p.usergroup_uuids, from_usergroup_uuid=p.from_usergroup_uuid))
    parts = [f"{g['name']}: {g['count']} {g['action'].replace('members_', '').replace('_', ' ')}" for g in out["groups"].values()]
    return changed("Bulk " + p.action + ": " + "; ".join(parts) + ".", results=out, skipped=missing or None)


class ImportParams(BaseModel):
    csv: str = Field(..., max_length=bulk.MAX_BYTES, description="CSV with a header row: email (required), group, starts_at, expires_at.")
    usergroup_uuid: str | None = Field(None, max_length=80, description="Import everyone into this group (the group column is then optional).")
    dry_run: bool = Field(True, description="Check every row without changing anything (default).")


async def _import(ctx: ToolContext, p: ImportParams):
    body = bulk.ImportBody(csv=p.csv, usergroup_uuid=p.usergroup_uuid)
    fn = bulk.import_preview if p.dry_run else bulk.import_apply
    out = await fn(ctx.request, ctx.db_session, ctx.user, ctx.org.id, body)
    errors = [r for r in out["rows"] if r["status"] == "error"][:50]
    head = "Dry run" if p.dry_run else "Imported"
    return changed(f"{head}: {out['ok']} row(s) ok, {out['errors']} with errors.", ok=out["ok"], errors=errors, total=out["total"])


# ── access windows ──────────────────────────────────────────────────────


class AccessParams(GroupParams):
    add: list[str] = Field(default_factory=list, max_length=50, description="Resource uuids: course_, path_ (links its courses), community_, podcast_, livesession_, board_, folder_, media_.")
    remove: list[str] = Field(default_factory=list, max_length=50)
    starts_at: str | None = Field(None, max_length=40, description="ISO date the group's access starts.")
    expires_at: str | None = Field(None, max_length=40, description="ISO date the group's access ends.")


async def _access(ctx: ToolContext, p: AccessParams):
    group = await _group(ctx, p.usergroup_uuid)
    out: dict = {}
    if p.add:
        out["added"] = (await access.add_access(ctx.request, ctx.db_session, ctx.user, group.id, access.AccessBody(
            resource_uuids=p.add, starts_at=p.starts_at, expires_at=p.expires_at)))["results"]
    if p.remove:
        out["removed"] = (await access.remove_access(ctx.request, ctx.db_session, ctx.user, group.id, p.remove))["removed"]
    linked = sum(1 for r in out.get("added", []) if r["result"] in ("linked", "window_updated"))
    return changed(f"'{group.name}': {linked} resource(s) unlocked, {len(out.get('removed', []))} removed.",
                   usergroup=await _ref(ctx, group), results=out)


# ── join codes ──────────────────────────────────────────────────────────


class CodeParams(GroupParams):
    revoke_code: str | None = Field(None, max_length=20, description="Revoke this code instead of creating one.")
    label: str = Field("", max_length=120)
    max_uses: int | None = Field(None, ge=1, le=100000)
    expires_at: str | None = Field(None, max_length=40)
    membership_days: int | None = Field(None, ge=1, le=3650, description="Memberships made with the code end after this many days.")


async def _code(ctx: ToolContext, p: CodeParams):
    group = await _group(ctx, p.usergroup_uuid)
    if p.revoke_code:
        listed = (await codes.list_codes(ctx.request, ctx.db_session, ctx.user, group.id))["items"]
        match = next((c for c in listed if c["code"] == codes.normalize(p.revoke_code)), None)
        if match is None:
            raise HTTPException(status_code=404, detail="Code not found in this group")
        await codes.update_code(ctx.request, ctx.db_session, ctx.user, group.id, match["id"], codes.CodePatchBody(active=False))
        return changed(f"Revoked code {match['code']} of '{group.name}'.", usergroup=await _ref(ctx, group))
    out = await codes.create_code(ctx.request, ctx.db_session, ctx.user, group.id, codes.CodeBody(
        label=p.label, max_uses=p.max_uses, expires_at=p.expires_at, membership_days=p.membership_days))
    base = await refs.web_base(ctx)
    return changed(f"Join code {out['code']} for '{group.name}'.", usergroup=await _ref(ctx, group), code=out,
                   join_link=f"{base}/groups/join?code={out['code']}" if base else None)


# ── announcements, sync ─────────────────────────────────────────────────


class AnnounceParams(GroupParams):
    title: str = Field(..., min_length=1, max_length=200)
    body: str = Field("", max_length=10000)
    pinned: bool = False
    email: bool = Field(False, description="Also email it to every member (newsletter rules apply).")


async def _announce(ctx: ToolContext, p: AnnounceParams):
    group = await _group(ctx, p.usergroup_uuid)
    out = await space.post_announcement(ctx.request, ctx.db_session, ctx.user, group.id, space.AnnouncementBody(
        title=p.title, body=p.body, pinned=p.pinned, email=p.email))
    return changed(f"Posted '{p.title}' to '{group.name}'" + (f", emailed {out['emailed']}" if p.email else "") + ".",
                   usergroup=await _ref(ctx, group))


class SyncParams(BaseModel):
    pass


async def _sync(ctx: ToolContext, p: SyncParams):
    from src.services.usergroups.common import require_org_admin

    await require_org_admin(ctx.request, ctx.db_session, ctx.user, ctx.org.id)
    stats = (await sync_org(ctx.db_session, ctx.org.id, request=ctx.request)).as_dict()
    return changed(f"Synced {stats['groups']} group(s): {stats['added']} added, {stats['removed']} removed, "
                   f"{stats['expired']} expired, {stats['scheduled_started']} scheduled starts.", stats=stats)


def _many(*lists) -> bool:
    return sum(len(x or []) for x in lists) > BULK_THRESHOLD


def _spec(name: str, title: str, description: str, params, execute, tier: ActionTier, **kw) -> ToolSpec:
    action = {ActionTier.READ: AccessAction.READ, ActionTier.CREATE: AccessAction.CREATE}.get(tier, AccessAction.UPDATE)
    return ToolSpec(name=name, title=title, description=description, params_model=params, tier=tier,
                    rights_bucket="usergroups", access_action=action, execute=execute, access="admin",
                    target_kind="usergroup", **kw)


SPECS: list[ToolSpec] = [
    _spec("get_usergroups_overview", "User groups overview",
          "Every user group with its type (manual, smart, nested), member count (and how many come from sub-groups), "
          "managers, what it unlocks and active join codes; plus which advanced features the plan allows.",
          OverviewParams, _overview, ActionTier.READ),
    _spec("get_usergroup_progress", "User group progress",
          "A group's progress: completion by course, members at risk (quiet 14+ days with unfinished courses), "
          "weekly active members, and a per-member table.",
          GroupParams, _progress, ActionTier.READ, target_param="usergroup_uuid"),
    _spec("get_usergroup_history", "User group history",
          "A group's history: members in and out (by hand, rules, codes, imports, expiry), access, settings and managers.",
          HistoryParams, _history, ActionTier.READ, target_param="usergroup_uuid"),
    _spec("preview_usergroup_rules", "Preview smart group rules",
          "Count the organization members a smart group rule set would match, with a few names. Changes nothing.",
          PreviewRulesParams, _preview_rules, ActionTier.READ),
    _spec("set_usergroup_rules", "Set smart group rules",
          "Make a group manual, smart (members come from rules) or hybrid (rules plus people added by hand), set its "
          "rules and auto-join email domains, and sync it now. Can add and remove many members.",
          SetRulesParams, _set_rules, ActionTier.EDIT, approval=True, target_param="usergroup_uuid",
          summarize=lambda p: f"Make {p.usergroup_uuid} {p.kind}" + (f" with {len((p.rules or {}).get('conditions') or [])} rule(s)" if p.rules else "")),
    _spec("set_usergroup_parent", "Nest a user group",
          "Put a group inside another (its members then get everything the parent unlocks), or un-nest it with an "
          "empty parent. Loops and nesting deeper than 5 levels are refused.",
          SetParentParams, _set_parent, ActionTier.EDIT, approval=True, target_param="usergroup_uuid",
          summarize=lambda p: f"Nest {p.usergroup_uuid} under {p.parent_uuid or '(nothing)'}"),
    _spec("set_usergroup_manager", "Set a group manager",
          "Make a member a group manager (manage members, see progress, post announcements, weekly digest) without "
          "making them an org admin, or take the role away.",
          ManagerParams, _manager, ActionTier.EDIT, approval=True, target_param="usergroup_uuid",
          summarize=lambda p: ("Remove" if p.remove else "Make") + f" {p.member} manager of {p.usergroup_uuid}"),
    _spec("update_usergroup_members", "Add or remove group members with dates",
          "Add members (optionally joining on a future date and leaving on a date) or remove them. People who are in the "
          "group through its rules or a sub-group stay and are reported as kept.",
          MembersParams, _members, ActionTier.EDIT, target_param="usergroup_uuid",
          approval_if=lambda p: bool(p.remove) or _many(p.add),
          summarize=lambda p: f"{p.usergroup_uuid}: add {len(p.add)}, remove {len(p.remove)}"),
    _spec("bulk_usergroup_members", "Bulk add, remove or move members",
          "Add many members to several groups, remove them, or move them from one group to another.",
          BulkParams, _bulk, ActionTier.EDIT, approval=True,
          summarize=lambda p: f"Bulk {p.action} {len(p.members)} member(s) for {len(p.usergroup_uuids)} group(s)"),
    _spec("import_usergroup_members", "Import group members from CSV",
          "Check (dry_run, the default) or apply a CSV of memberships: email, group, starts_at, expires_at. Rows with "
          "errors are listed and never applied.",
          ImportParams, _import, ActionTier.EDIT, approval_if=lambda p: not p.dry_run,
          summarize=lambda p: ("Check" if p.dry_run else "Apply") + " a CSV of group members"),
    _spec("set_usergroup_access", "Set what a group unlocks",
          "Unlock courses, paths, communities, podcasts, live sessions, boards and library items for a group, optionally "
          "from a start date and until an end date, or stop unlocking them.",
          AccessParams, _access, ActionTier.EDIT, target_param="usergroup_uuid",
          approval_if=lambda p: bool(p.remove) or _many(p.add),
          summarize=lambda p: f"{p.usergroup_uuid}: unlock {len(p.add)}, remove {len(p.remove)}"),
    _spec("manage_usergroup_join_code", "Create or revoke a join code",
          "Create a join code (optional use limit, expiry and membership length) that adds whoever redeems it to the "
          "group, or revoke one.",
          CodeParams, _code, ActionTier.CREATE, target_param="usergroup_uuid", approval_if=lambda p: bool(p.revoke_code),
          summarize=lambda p: (f"Revoke code {p.revoke_code}" if p.revoke_code else "Create a join code") + f" for {p.usergroup_uuid}"),
    _spec("post_usergroup_announcement", "Post a group announcement",
          "Post an announcement to a group's space and notify its members; optionally email it (newsletter rules apply).",
          AnnounceParams, _announce, ActionTier.CREATE, target_param="usergroup_uuid", approval_if=lambda p: p.email,
          summarize=lambda p: f"Post '{p.title}' to {p.usergroup_uuid}" + (" and email members" if p.email else "")),
    _spec("sync_usergroups", "Sync user groups now",
          "Re-run smart rules, auto-join domains, nesting, scheduled starts and expiries for every group now (they also "
          "run every 15 minutes).",
          SyncParams, _sync, ActionTier.EDIT, idempotent=True, approval=True,
          summarize=lambda p: "Sync every user group now"),
]
