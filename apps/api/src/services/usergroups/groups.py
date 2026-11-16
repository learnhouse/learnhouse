"""The group list, a group's detail and settings, members, managers,
scheduled memberships and history."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Literal, Optional

from fastapi import HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.user_organizations import UserOrganization
from src.db.usergroup_extras import UserGroupEvent, UserGroupJoinCode, UserGroupManager, UserGroupSchedule
from src.db.usergroup_resources import UserGroupResource
from src.db.usergroup_user import UserGroupUser
from src.db.usergroups import USERGROUP_KINDS, UserGroup, UserGroupCreate
from src.db.users import User
from src.services.security.rate_limiting import enforce_batch_size_limit
from src.services.usergroups.common import (
    DEFAULT_SETTINGS,
    actor_id,
    advanced_enabled,
    aware,
    capabilities_for,
    group_settings,
    is_org_admin,
    iso,
    load_group,
    load_group_by_uuid,
    managed_group_ids,
    org_groups,
    parse_when,
    person_id,
    record,
    require_advanced,
    require_group_access,
    require_org_admin,
    require_person,
    utcnow,
)
from src.services.usergroups.membership import (
    DIRECT_SOURCES,
    add_source,
    describe,
    notify_members,
    org_member_ids,
    refresh_ancestors,
    remove_sources,
    rows_for,
    sources_of,
)
from src.services.usergroups import rules as rules_mod
from src.services.usergroups import sync as sync_mod

MAX_MANAGED_CARDS = 20
COLORS = ("violet", "sky", "emerald", "amber", "rose", "indigo", "teal", "orange")


def user_brief(u: User, *, email: bool = False) -> dict:
    out = {
        "id": u.id, "user_uuid": u.user_uuid, "username": u.username,
        "first_name": u.first_name, "last_name": u.last_name, "avatar_image": u.avatar_image,
    }
    if email:
        out["email"] = u.email
    return out


async def users_by_id(db: AsyncSession, ids) -> dict[int, User]:
    ids = list({i for i in ids if i})
    if not ids:
        return {}
    return {u.id: u for u in (await db.execute(select(User).where(User.id.in_(ids)))).scalars().all()}  # type: ignore[union-attr]


def group_type(group: UserGroup, has_children: bool) -> list[str]:
    """Chips the list shows: Manual / Smart (rules) and Nested."""
    chips = ["smart" if group.kind in ("smart", "hybrid") else "manual"]
    if group.kind == "hybrid":
        chips.append("manual")
    if group.parent_id or has_children:
        chips.append("nested")
    return chips


async def features(db: AsyncSession, org_id: int) -> dict:
    adv = await advanced_enabled(db, org_id)
    return {"smart": adv, "nesting": adv, "managers": adv, "space": adv, "messaging": adv}


# ── list ────────────────────────────────────────────────────────────────


async def overview(request: Request, db: AsyncSession, user: Any, org_id: int) -> dict:
    """Every group of the org for admins; managers get only the groups they
    manage. With counts, managers, parent and type chips."""
    admin = await is_org_admin(request, db, user, org_id, "read")
    groups = await org_groups(db, org_id)
    if not admin:
        # Only a person can be a manager; a token without usergroups rights
        # (or from another org) stops here.
        uid = person_id(user)
        allowed = await managed_group_ids(db, uid, org_id) if uid and await advanced_enabled(db, org_id) else set()
        if not allowed:
            raise HTTPException(status_code=403, detail="You don't have permission to view groups")
        groups = [g for g in groups if g.id in allowed]
    ids = [g.id for g in groups]
    counts = dict((await db.execute(
        select(UserGroupUser.usergroup_id, func.count()).where(UserGroupUser.usergroup_id.in_(ids))  # type: ignore[attr-defined]
        .group_by(UserGroupUser.usergroup_id)
    )).all()) if ids else {}
    inherited_rows = (await db.execute(
        select(UserGroupUser.usergroup_id, UserGroupUser.sources).where(UserGroupUser.usergroup_id.in_(ids))  # type: ignore[attr-defined]
    )).all() if ids else []
    via_sub: dict[int, int] = {}
    for gid, sources in inherited_rows:
        if isinstance(sources, list) and sources == ["inherited"]:
            via_sub[gid] = via_sub.get(gid, 0) + 1
    resources = (await db.execute(
        select(UserGroupResource.usergroup_id, UserGroupResource.resource_uuid).where(UserGroupResource.usergroup_id.in_(ids))  # type: ignore[attr-defined]
    )).all() if ids else []
    res_counts: dict[int, dict[str, int]] = {}
    for gid, uuid in resources:
        kind = (uuid or "").split("_", 1)[0]
        bucket = res_counts.setdefault(gid, {})
        bucket[kind] = bucket.get(kind, 0) + 1
    mgr_rows = (await db.execute(
        select(UserGroupManager).where(UserGroupManager.usergroup_id.in_(ids))  # type: ignore[attr-defined]
    )).scalars().all() if ids else []
    people = await users_by_id(db, [m.user_id for m in mgr_rows])
    managers: dict[int, list[dict]] = {}
    for m in mgr_rows:
        if m.user_id in people:
            managers.setdefault(m.usergroup_id, []).append(user_brief(people[m.user_id]))
    codes = dict((await db.execute(
        select(UserGroupJoinCode.usergroup_id, func.count()).where(
            UserGroupJoinCode.usergroup_id.in_(ids), UserGroupJoinCode.active == True  # type: ignore[attr-defined]  # noqa: E712
        ).group_by(UserGroupJoinCode.usergroup_id)
    )).all()) if ids else {}
    parents = {g.parent_id for g in groups if g.parent_id}
    by_id = {g.id: g for g in groups}
    items = []
    for g in groups:
        settings = group_settings(g)
        items.append({
            "id": g.id, "usergroup_uuid": g.usergroup_uuid, "name": g.name, "description": g.description,
            "kind": g.kind, "types": group_type(g, g.id in parents), "color": g.color,
            "parent_id": g.parent_id, "parent_name": by_id[g.parent_id].name if g.parent_id in by_id else None,
            "member_count": int(counts.get(g.id, 0)), "inherited_count": via_sub.get(g.id, 0),
            "resource_counts": res_counts.get(g.id, {}), "managers": managers.get(g.id, []),
            "active_codes": int(codes.get(g.id, 0)), "space_enabled": bool(settings["space_enabled"]),
            "creation_date": g.creation_date, "last_synced_at": iso(g.last_synced_at),
        })
    return {"items": items, "features": await features(db, org_id), "can_admin": admin}


# ── create / detail / settings ──────────────────────────────────────────


class GroupCreateBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: str = Field("", max_length=500)
    kind: Literal["manual", "smart", "hybrid"] = "manual"
    rules: Optional[dict] = None
    parent_uuid: Optional[str] = None
    color: Optional[str] = None


class GroupSettingsBody(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    kind: Optional[Literal["manual", "smart", "hybrid"]] = None
    rules: Optional[dict] = None
    # "" un-nests; None leaves the parent alone.
    parent_uuid: Optional[str] = None
    color: Optional[str] = None
    settings: Optional[dict] = None


def _clean_settings(raw: Optional[dict], current: dict) -> dict:
    out = dict(current)
    for key, value in (raw or {}).items():
        if key not in DEFAULT_SETTINGS:
            continue
        if key == "auto_join_domains":
            vals = value if isinstance(value, list) else []
            vals = sorted({str(v).strip().lower().lstrip("@") for v in vals if str(v or "").strip()})
            if len(vals) > 20 or any("." not in v or " " in v for v in vals):
                raise HTTPException(status_code=422, detail="auto_join_domains must be up to 20 domains like school.edu")
            out[key] = vals
        else:
            out[key] = bool(value)
    return out


async def _gates_for(db: AsyncSession, org_id: int, *, kind: Optional[str], rules: Any, parent: bool,
                     settings: Optional[dict]) -> None:
    if kind in ("smart", "hybrid") or rules:
        await require_advanced(db, org_id, "Smart groups")
    if parent:
        await require_advanced(db, org_id, "Nested groups")
    if settings and settings.get("space_enabled"):
        await require_advanced(db, org_id, "Group spaces")


async def create_group(request: Request, db: AsyncSession, user: Any, org_id: int, body: GroupCreateBody) -> dict:
    from src.services.users.usergroups import create_usergroup

    clean_rules = rules_mod.validate_rules(body.rules) if body.rules else None
    await _gates_for(db, org_id, kind=body.kind, rules=clean_rules and clean_rules["conditions"],
                     parent=bool(body.parent_uuid), settings=None)
    parent = await load_group_by_uuid(db, org_id, body.parent_uuid) if body.parent_uuid else None
    created = await create_usergroup(
        request, db, user, UserGroupCreate(name=body.name.strip(), description=body.description.strip(), org_id=org_id)
    )
    group = await load_group(db, created.id)
    group.kind = body.kind
    group.rules = clean_rules
    group.color = body.color if body.color in COLORS else None
    if parent is not None:
        await sync_mod.set_parent(db, group, parent)
    db.add(group)
    record(db, request, group, "settings_updated", user, details={"kind": group.kind, "parent_id": group.parent_id})
    await db.commit()
    if group.kind != "manual" or group.parent_id:
        await sync_mod.sync_org(db, org_id, request=request)
    return await detail(request, db, user, group.id)


async def detail(request: Request, db: AsyncSession, user: Any, group_id: int) -> dict:
    group = await load_group(db, group_id)
    await require_group_access(request, db, user, group, "view")
    caps = await capabilities_for(request, db, user, group)
    groups = await org_groups(db, group.org_id)
    children = [{"id": g.id, "usergroup_uuid": g.usergroup_uuid, "name": g.name} for g in groups if g.parent_id == group.id]
    parent = next((g for g in groups if g.id == group.parent_id), None)
    rows = await rows_for(db, group.id)
    by_source: dict[str, int] = {}
    for row in rows.values():
        for s in sources_of(row):
            by_source[s] = by_source.get(s, 0) + 1
    mgr_rows = (await db.execute(select(UserGroupManager).where(UserGroupManager.usergroup_id == group.id))).scalars().all()
    people = await users_by_id(db, [m.user_id for m in mgr_rows])
    pending = int((await db.execute(select(func.count()).select_from(UserGroupSchedule).where(
        UserGroupSchedule.usergroup_id == group.id, UserGroupSchedule.status == "pending"
    ))).scalar() or 0)
    return {
        "id": group.id, "usergroup_uuid": group.usergroup_uuid, "org_id": group.org_id, "name": group.name,
        "description": group.description, "kind": group.kind, "rules": group.rules or {"match": "all", "conditions": []},
        "types": group_type(group, bool(children)), "color": group.color,
        "parent": {"id": parent.id, "usergroup_uuid": parent.usergroup_uuid, "name": parent.name} if parent else None,
        "children": children, "settings": group_settings(group), "member_count": len(rows),
        "members_by_source": by_source, "pending_schedules": pending,
        "managers": [{**user_brief(people[m.user_id]), "can_manage_members": m.can_manage_members,
                      "can_view_progress": m.can_view_progress, "can_post": m.can_post, "digest": m.digest}
                     for m in mgr_rows if m.user_id in people],
        "creation_date": group.creation_date, "last_synced_at": iso(group.last_synced_at),
        "capabilities": caps, "features": await features(db, group.org_id),
    }


async def update_settings(request: Request, db: AsyncSession, user: Any, group_id: int, body: GroupSettingsBody) -> dict:
    group = await load_group(db, group_id)
    await require_org_admin(request, db, user, group.org_id)
    clean_rules = rules_mod.validate_rules(body.rules) if body.rules is not None else None
    settings = _clean_settings(body.settings, group_settings(group)) if body.settings is not None else None
    await _gates_for(db, group.org_id, kind=body.kind if body.kind != group.kind else None,
                     rules=clean_rules and clean_rules["conditions"], parent=bool(body.parent_uuid),
                     settings=settings if settings and not group_settings(group)["space_enabled"] else None)
    before = {"name": group.name, "description": group.description, "kind": group.kind,
              "parent_id": group.parent_id, "rules": group.rules, "settings": group_settings(group), "color": group.color}
    old_parent = group.parent_id
    if body.name is not None:
        group.name = body.name.strip()
    if body.description is not None:
        group.description = body.description.strip()
    if body.kind is not None and body.kind in USERGROUP_KINDS:
        group.kind = body.kind
    if clean_rules is not None:
        group.rules = clean_rules
    if body.color is not None:
        group.color = body.color if body.color in COLORS else None
    if settings is not None:
        group.settings = settings
    if body.parent_uuid is not None:
        parent = await load_group_by_uuid(db, group.org_id, body.parent_uuid) if body.parent_uuid else None
        await sync_mod.set_parent(db, group, parent)
    group.update_date = str(datetime.now())
    db.add(group)
    after = {"name": group.name, "description": group.description, "kind": group.kind,
             "parent_id": group.parent_id, "rules": group.rules, "settings": group_settings(group), "color": group.color}
    changed = sorted(k for k in after if after[k] != before[k])
    if changed:
        record(db, request, group, "settings_updated", user, details={"fields": changed})
    await db.commit()
    if old_parent != group.parent_id and old_parent:
        old = await db.get(UserGroup, old_parent)
        if old is not None:
            from src.services.usergroups.membership import recompute_inherited

            await recompute_inherited(db, old)
            await refresh_ancestors(db, old)
    if {"kind", "rules", "parent_id", "settings"} & set(changed):
        await sync_mod.sync_org(db, group.org_id, request=request)
    return await detail(request, db, user, group.id)


async def preview_rules(request: Request, db: AsyncSession, user: Any, org_id: int, rules: Any,
                        group_id: Optional[int] = None) -> dict:
    await require_org_admin(request, db, user, org_id, "read")
    await require_advanced(db, org_id, "Smart groups")
    if group_id is not None:
        group = await load_group(db, group_id)
        if group.org_id != org_id:
            raise HTTPException(status_code=404, detail="UserGroup not found")
    return await rules_mod.preview(db, org_id, rules, self_group_id=group_id)


async def rule_options(request: Request, db: AsyncSession, user: Any, org_id: int) -> dict:
    """What the rule builder offers: courses, paths, roles, companies, SCIM
    groups, people fields with their values, signup fields, other groups."""
    from src.core.ee_hooks import get_ee_module
    from src.db.courses.courses import Course
    from src.db.org_member_profile import OrgMemberProfile
    from src.db.paths import Path
    from src.db.roles import Role

    await require_org_admin(request, db, user, org_id, "read")
    courses = (await db.execute(select(Course.course_uuid, Course.name).where(Course.org_id == org_id).order_by(Course.name))).all()
    paths = (await db.execute(select(Path.path_uuid, Path.name).where(Path.org_id == org_id).order_by(Path.name))).all()
    roles = (await db.execute(select(Role.id, Role.name).where(or_(Role.org_id == org_id, Role.org_id.is_(None))).order_by(Role.id))).all()  # type: ignore[union-attr]
    groups = await org_groups(db, org_id)
    people: dict[str, list[str]] = {}
    for field in rules_mod.PEOPLE_FIELDS:
        col = getattr(OrgMemberProfile, field)
        vals = (await db.execute(select(col).where(OrgMemberProfile.org_id == org_id, col.is_not(None)).distinct().limit(100))).scalars().all()
        people[field] = sorted({str(v) for v in vals if v})
    companies, scim_groups = [], []
    seats = get_ee_module("ee.db.payments.payments_company_seats")
    if seats is not None:
        companies = [{"uuid": u, "name": n} for u, n in (await db.execute(
            select(seats.CompanyAccount.company_uuid, seats.CompanyAccount.name).where(seats.CompanyAccount.org_id == org_id)
        )).all()]
    scim = get_ee_module("ee.db.scim")
    if scim is not None:
        names = {g.id: g.name for g in groups}
        scim_groups = [{"scim_id": s, "name": names.get(local, s)} for s, local in (await db.execute(
            select(scim.ScimResource.scim_id, scim.ScimResource.local_id).where(
                scim.ScimResource.org_id == org_id, scim.ScimResource.resource_type == "Group")
        )).all()]
    from src.services.orgs.signup_fields import get_org_signup_fields

    signup_keys = [{"key": f.key, "label": getattr(f, "label", None) or f.key}
                   for f in await get_org_signup_fields(org_id, db) if f.key]
    return {
        "condition_types": list(rules_mod.CONDITION_TYPES),
        "courses": [{"uuid": u, "name": n} for u, n in courses],
        "paths": [{"uuid": u, "name": n} for u, n in paths],
        "roles": [{"id": i, "name": n} for i, n in roles],
        "groups": [{"uuid": g.usergroup_uuid, "name": g.name} for g in groups],
        "people_fields": people, "companies": companies, "scim_groups": scim_groups, "signup_fields": signup_keys,
    }


# ── members ─────────────────────────────────────────────────────────────


async def list_members(request: Request, db: AsyncSession, user: Any, group_id: int, *, q: str = "",
                       source: str = "", page: int = 1, per_page: int = 50) -> dict:
    group = await load_group(db, group_id)
    role = await require_group_access(request, db, user, group, "view")
    rows = await rows_for(db, group.id)
    people = await users_by_id(db, rows.keys())
    last = await rules_mod.last_active(db, group.org_id)
    items = []
    needle = q.strip().lower()
    for uid, row in rows.items():
        u = people.get(uid)
        if u is None:
            continue
        srcs = sources_of(row)
        if source and source not in srcs:
            continue
        if needle and not any(needle in (v or "").lower() for v in (u.username, u.first_name, u.last_name, u.email)):
            continue
        items.append({**user_brief(u, email=True), **describe(row),
                      "last_active": (lambda d: d.isoformat() if d else None)(last.get(uid))})
    items.sort(key=lambda i: ((i.get("first_name") or i.get("username") or "").lower()))
    total = len(items)
    start = max(0, (page - 1) * per_page)
    schedules = (await db.execute(select(UserGroupSchedule).where(
        UserGroupSchedule.usergroup_id == group.id, UserGroupSchedule.status == "pending"
    ).order_by(UserGroupSchedule.starts_at))).scalars().all()
    sched_people = await users_by_id(db, [s.user_id for s in schedules])
    return {
        "items": items[start:start + per_page], "total": total, "page": page, "per_page": per_page, "viewer": role,
        "scheduled": [{"id": s.id, "user": user_brief(sched_people[s.user_id], email=True), "starts_at": iso(s.starts_at),
                       "ends_at": iso(s.ends_at)} for s in schedules if s.user_id in sched_people],
    }


class MembersBody(BaseModel):
    user_ids: list[int] = Field(default_factory=list, max_length=500)
    starts_at: Optional[str] = None
    expires_at: Optional[str] = None


async def add_members(request: Request, db: AsyncSession, user: Any, group_id: int, body: MembersBody,
                      *, source: str = "manual", via: str = "") -> dict:
    """Add members by hand (or with a start date, as a schedule). Admins and
    managers with the members right. Not on smart-only groups. Per-person
    results; people outside the org are skipped."""
    group = await load_group(db, group_id)
    await require_group_access(request, db, user, group, "members")
    if group.kind == "smart" and source == "manual":
        raise HTTPException(status_code=409, detail="Members of this group come from its rules. Switch it to 'Rules and manual' to add people by hand.")
    ids = list(dict.fromkeys(int(i) for i in body.user_ids))
    enforce_batch_size_limit(len(ids), "users", 500)
    now = utcnow()
    starts = parse_when(body.starts_at, "starts_at")
    ends = parse_when(body.expires_at, "expires_at")
    if ends is not None and ends <= (starts or now):
        raise HTTPException(status_code=422, detail="The end date must be after the start date")
    members = await org_member_ids(db, group.org_id)
    rows = await rows_for(db, group.id)
    results: dict[str, list[int]] = {"added": [], "scheduled": [], "updated": [], "already": [], "not_in_org": []}
    for uid in ids:
        if uid not in members:
            results["not_in_org"].append(uid)
            continue
        if starts is not None and starts > now:
            db.add(UserGroupSchedule(usergroup_id=group.id, org_id=group.org_id, user_id=uid, starts_at=starts,
                                     ends_at=ends, created_by_id=actor_id(user)))
            results["scheduled"].append(uid)
            continue
        out = await add_source(db, group, uid, source, expires_at=ends, actor_id=actor_id(user), row=rows.get(uid), lookup=False)
        results["added" if out == "added" else "updated" if out == "source_added" else "already"].append(uid)
    if results["added"] or results["scheduled"] or results["updated"]:
        record(db, request, group, "members_added" if results["added"] or results["updated"] else "members_scheduled", user,
               via=via, details={"user_ids": (results["added"] + results["updated"] + results["scheduled"])[:100],
                                 "count": len(results["added"]) + len(results["updated"]) + len(results["scheduled"]),
                                 **({"starts_at": iso(starts)} if results["scheduled"] else {}),
                                 **({"expires_at": iso(ends)} if ends else {})})
    await db.commit()
    if results["added"]:
        await refresh_ancestors(db, group)
        await notify_members(db, group, results["added"], "joined")
        from src.services.webhooks.dispatch import dispatch_webhooks

        await dispatch_webhooks(event_name="usergroup_users_added", org_id=group.org_id, data={
            "usergroup_id": group.id, "usergroup_uuid": group.usergroup_uuid, "user_ids": results["added"]})
    return {k: v for k, v in results.items()}


async def remove_members(request: Request, db: AsyncSession, user: Any, group_id: int, user_ids: list[int], *, via: str = "") -> dict:
    group = await load_group(db, group_id)
    await require_group_access(request, db, user, group, "members")
    ids = list(dict.fromkeys(int(i) for i in user_ids))
    enforce_batch_size_limit(len(ids), "users", 500)
    rows = await rows_for(db, group.id)
    results: dict[str, list] = {"removed": [], "kept": [], "absent": []}
    for uid in ids:
        out = await remove_sources(db, group, uid, DIRECT_SOURCES, row=rows.get(uid), lookup=False)
        if out == "kept":
            results["kept"].append({"user_id": uid, "sources": sources_of(rows[uid])})
        else:
            results[out].append(uid)
    # Cancel pending schedules for the same people.
    for s in (await db.execute(select(UserGroupSchedule).where(
        UserGroupSchedule.usergroup_id == group.id, UserGroupSchedule.status == "pending",
        UserGroupSchedule.user_id.in_(ids),  # type: ignore[attr-defined]
    ))).scalars().all():
        s.status = "cancelled"
        db.add(s)
    if results["removed"]:
        record(db, request, group, "members_removed", user, via=via,
               details={"user_ids": results["removed"][:100], "count": len(results["removed"])})
    await db.commit()
    if results["removed"]:
        await refresh_ancestors(db, group)
    return results


class MemberPatchBody(BaseModel):
    expires_at: Optional[str] = None


async def update_member(request: Request, db: AsyncSession, user: Any, group_id: int, user_id: int, body: MemberPatchBody) -> dict:
    group = await load_group(db, group_id)
    await require_group_access(request, db, user, group, "members")
    row = (await rows_for(db, group.id)).get(user_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Not a member of this group")
    ends = parse_when(body.expires_at, "expires_at")
    if ends is not None and ends <= utcnow():
        raise HTTPException(status_code=422, detail="The end date must be in the future")
    if ends is not None and not set(sources_of(row)) & set(DIRECT_SOURCES):
        raise HTTPException(status_code=409, detail="This person is in the group through its rules or a sub-group; their membership has no end date of its own")
    row.expires_at = ends
    db.add(row)
    record(db, request, group, "member_updated", user, details={"user_id": user_id, "expires_at": iso(ends)})
    await db.commit()
    return describe(row)


async def cancel_schedule(request: Request, db: AsyncSession, user: Any, group_id: int, schedule_id: int) -> dict:
    group = await load_group(db, group_id)
    await require_group_access(request, db, user, group, "members")
    s = await db.get(UserGroupSchedule, schedule_id)
    if s is None or s.usergroup_id != group.id:
        raise HTTPException(status_code=404, detail="Schedule not found")
    s.status = "cancelled"
    db.add(s)
    record(db, request, group, "schedule_cancelled", user, details={"user_id": s.user_id})
    await db.commit()
    return {"ok": True}


# ── managers ────────────────────────────────────────────────────────────


class ManagerBody(BaseModel):
    user_id: int
    can_manage_members: bool = True
    can_view_progress: bool = True
    can_post: bool = True
    digest: bool = False


async def set_manager(request: Request, db: AsyncSession, user: Any, group_id: int, body: ManagerBody) -> dict:
    group = await load_group(db, group_id)
    await require_org_admin(request, db, user, group.org_id)
    await require_advanced(db, group.org_id, "Group managers")
    member = (await db.execute(select(UserOrganization.id).where(
        UserOrganization.user_id == body.user_id, UserOrganization.org_id == group.org_id
    ))).first()
    if member is None:
        raise HTTPException(status_code=404, detail="That person is not a member of this organization")
    row = (await db.execute(select(UserGroupManager).where(
        UserGroupManager.usergroup_id == group.id, UserGroupManager.user_id == body.user_id
    ))).scalars().first()
    created = row is None
    if row is None:
        row = UserGroupManager(usergroup_id=group.id, user_id=body.user_id, org_id=group.org_id, created_by_id=actor_id(user))
    row.can_manage_members = body.can_manage_members
    row.can_view_progress = body.can_view_progress
    row.can_post = body.can_post
    row.digest = body.digest
    db.add(row)
    record(db, request, group, "manager_added" if created else "manager_updated", user, details={"user_id": body.user_id})
    await db.commit()
    return {"ok": True, "created": created}


async def remove_manager(request: Request, db: AsyncSession, user: Any, group_id: int, user_id: int) -> dict:
    group = await load_group(db, group_id)
    await require_org_admin(request, db, user, group.org_id)
    row = (await db.execute(select(UserGroupManager).where(
        UserGroupManager.usergroup_id == group.id, UserGroupManager.user_id == user_id
    ))).scalars().first()
    if row is None:
        raise HTTPException(status_code=404, detail="Not a manager of this group")
    await db.delete(row)
    record(db, request, group, "manager_removed", user, details={"user_id": user_id})
    await db.commit()
    return {"ok": True}


# ── history ─────────────────────────────────────────────────────────────


async def history(request: Request, db: AsyncSession, user: Any, group_id: int, page: int = 1, per_page: int = 30) -> dict:
    group = await load_group(db, group_id)
    await require_group_access(request, db, user, group, "view")
    total = int((await db.execute(select(func.count()).select_from(UserGroupEvent).where(UserGroupEvent.usergroup_id == group.id))).scalar() or 0)
    rows = (await db.execute(
        select(UserGroupEvent).where(UserGroupEvent.usergroup_id == group.id)
        .order_by(UserGroupEvent.id.desc()).offset((page - 1) * per_page).limit(per_page)  # type: ignore[union-attr]
    )).scalars().all()
    ref_ids: set[int] = {r.actor_id for r in rows if r.actor_id}
    for r in rows:
        d = r.details or {}
        ref_ids |= {i for i in (d.get("user_ids") or d.get("added") or [])[:5] if isinstance(i, int)}
        if isinstance(d.get("user_id"), int):
            ref_ids.add(d["user_id"])
    people = await users_by_id(db, ref_ids)
    names = {uid: (" ".join(p for p in (u.first_name, u.last_name) if p) or u.username) for uid, u in people.items()}
    return {
        "items": [{
            "id": r.id, "action": r.action, "via": r.via, "created_at": iso(r.created_at), "details": r.details or {},
            "actor": user_brief(people[r.actor_id]) if r.actor_id in people else None,
        } for r in rows],
        "names": {str(k): v for k, v in names.items()}, "total": total, "page": page, "per_page": per_page,
    }


# ── the person's side ───────────────────────────────────────────────────


async def groups_of_user(db: AsyncSession, org_id: int, user_id: int) -> list[dict]:
    rows = (await db.execute(
        select(UserGroup, UserGroupUser).join(UserGroupUser, UserGroupUser.usergroup_id == UserGroup.id)
        .where(UserGroupUser.user_id == user_id, UserGroup.org_id == org_id).order_by(UserGroup.name)
    )).all()
    out, seen = [], set()
    for g, row in rows:
        if g.id in seen:
            continue
        seen.add(g.id)
        out.append({"id": g.id, "usergroup_uuid": g.usergroup_uuid, "name": g.name, "color": g.color, "kind": g.kind,
                    "space_enabled": bool(group_settings(g)["space_enabled"]), **describe(row)})
    return out


async def my_groups(request: Request, db: AsyncSession, user: Any, org_id: int) -> dict:
    from src.security.org_auth import require_org_membership

    uid = require_person(user)
    await require_org_membership(uid, org_id, db)
    mine = await groups_of_user(db, org_id, uid)
    managed = await managed_group_ids(db, uid, org_id) if await advanced_enabled(db, org_id) else set()
    groups = {g.id: g for g in await org_groups(db, org_id)}
    from src.services.usergroups.progress import card_stats

    manages = []
    for gid in sorted(managed)[:MAX_MANAGED_CARDS]:
        g = groups.get(gid)
        if g is None:  # pragma: no cover - managed ids come from this org's groups
            continue
        caps = await capabilities_for(request, db, user, g)
        manages.append({
            "id": g.id, "usergroup_uuid": g.usergroup_uuid, "name": g.name, "description": g.description,
            "color": g.color, "kind": g.kind, "space_enabled": bool(group_settings(g)["space_enabled"]),
            "rights": {k: caps[k] for k in ("members", "progress", "post")},
            "stats": await card_stats(db, g) if caps["progress"] else None,
        })
    return {"member_of": mine, "manages": manages, "managed_total": len(managed), "features": await features(db, org_id)}


async def membership_map(request: Request, db: AsyncSession, user: Any, org_id: int) -> dict:
    """{user_id: [group ids]} for the Users table's group column and filter."""
    await require_org_admin(request, db, user, org_id, "read")
    rows = (await db.execute(select(UserGroupUser.user_id, UserGroupUser.usergroup_id).where(UserGroupUser.org_id == org_id))).all()
    out: dict[str, list[int]] = {}
    for uid, gid in rows:
        lst = out.setdefault(str(uid), [])
        if gid not in lst:
            lst.append(gid)
    groups = await org_groups(db, org_id)
    return {"map": out, "groups": [{"id": g.id, "name": g.name, "color": g.color, "usergroup_uuid": g.usergroup_uuid} for g in groups]}


def default_expiry(days: Optional[int]) -> Optional[datetime]:
    return utcnow() + timedelta(days=days) if days else None


__all__ = ["aware"]
