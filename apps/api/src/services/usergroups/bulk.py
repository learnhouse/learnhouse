"""Bulk tools: CSV import with a dry run, and add / remove / move many
members across groups at once.

CSV columns (header row required, case-insensitive): ``email`` (required),
``group`` (a group name or usergroup uuid; optional when importing into one
group), ``starts_at`` and ``expires_at`` (optional ISO dates). The dry run
returns every row with ``ok`` or the reason it would be skipped; applying
runs the same checks and writes only the ``ok`` rows.
"""

from __future__ import annotations

import csv
import io
from typing import Any, Literal, Optional

from fastapi import HTTPException, Request
from pydantic import BaseModel, Field
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.users import User
from src.db.usergroup_extras import UserGroupSchedule
from src.db.usergroups import UserGroup
from src.services.security.rate_limiting import enforce_batch_size_limit
from src.services.usergroups.common import (
    actor_id,
    org_groups,
    parse_when,
    record,
    require_group_access,
    require_org_admin,
    utcnow,
)
from src.services.usergroups.membership import (
    DIRECT_SOURCES,
    add_source,
    notify_members,
    org_member_ids,
    refresh_ancestors,
    remove_sources,
    rows_for,
)

MAX_ROWS = 2000
MAX_BYTES = 1_000_000


class ImportBody(BaseModel):
    csv: str = Field(..., max_length=MAX_BYTES)
    usergroup_uuid: Optional[str] = None


def _parse(text: str) -> list[dict[str, str]]:
    reader = csv.DictReader(io.StringIO(text.lstrip("﻿")))
    if not reader.fieldnames or "email" not in {(f or "").strip().lower() for f in reader.fieldnames}:
        raise HTTPException(status_code=422, detail="The CSV needs a header row with an 'email' column")
    rows = []
    for i, raw in enumerate(reader):
        if i >= MAX_ROWS:
            raise HTTPException(status_code=422, detail=f"Import at most {MAX_ROWS} rows at a time")
        rows.append({(k or "").strip().lower(): (v or "").strip() for k, v in raw.items() if k})
    return rows


async def _plan(db: AsyncSession, org_id: int, body: ImportBody) -> list[dict]:
    rows = _parse(body.csv)
    groups = await org_groups(db, org_id)
    by_uuid = {g.usergroup_uuid: g for g in groups}
    by_name: dict[str, list[UserGroup]] = {}
    for g in groups:
        by_name.setdefault(g.name.strip().lower(), []).append(g)
    target = by_uuid.get(body.usergroup_uuid) if body.usergroup_uuid else None
    if body.usergroup_uuid and target is None:
        raise HTTPException(status_code=404, detail="UserGroup not found")
    emails = list({r.get("email", "").lower() for r in rows if r.get("email")})
    users = {}
    for chunk in range(0, len(emails), 500):
        for u in (await db.execute(select(User).where(User.email.in_(emails[chunk:chunk + 500])))).scalars().all():  # type: ignore[union-attr]
            users[(u.email or "").lower()] = u
    members = await org_member_ids(db, org_id)
    seen: set[tuple[int, int]] = set()
    now = utcnow()
    plan = []
    for n, r in enumerate(rows, start=2):
        email = r.get("email", "").lower()
        out: dict[str, Any] = {"line": n, "email": email, "group": r.get("group") or (target.name if target else ""),
                               "starts_at": r.get("starts_at") or None, "expires_at": r.get("expires_at") or None}
        group = target
        ref = r.get("group", "")
        if ref:
            group = by_uuid.get(ref)
            if group is None:
                matches = by_name.get(ref.lower(), [])
                group = matches[0] if len(matches) == 1 else None
                if len(matches) > 1:
                    plan.append({**out, "status": "error", "error": "ambiguous_group"})
                    continue
        if group is None:
            plan.append({**out, "status": "error", "error": "unknown_group" if ref else "no_group"})
            continue
        out["usergroup_uuid"] = group.usergroup_uuid
        out["group"] = group.name
        if group.kind == "smart":
            plan.append({**out, "status": "error", "error": "smart_group"})
            continue
        if not email or "@" not in email:
            plan.append({**out, "status": "error", "error": "invalid_email"})
            continue
        u = users.get(email)
        if u is None:
            plan.append({**out, "status": "error", "error": "unknown_email"})
            continue
        if u.id not in members:
            plan.append({**out, "status": "error", "error": "not_in_org"})
            continue
        try:
            starts = parse_when(out["starts_at"], "starts_at")
            ends = parse_when(out["expires_at"], "expires_at")
        except HTTPException:
            plan.append({**out, "status": "error", "error": "bad_date"})
            continue
        if ends is not None and ends <= (starts or now):
            plan.append({**out, "status": "error", "error": "bad_date"})
            continue
        key = (u.id, group.id)
        if key in seen:
            plan.append({**out, "status": "error", "error": "duplicate"})
            continue
        seen.add(key)  # type: ignore[arg-type]
        plan.append({**out, "status": "ok", "user_id": u.id, "_group": group, "_starts": starts, "_ends": ends,
                     "action": "schedule" if starts and starts > now else "add"})
    return plan


def _public(plan: list[dict]) -> dict:
    rows = [{k: v for k, v in p.items() if not k.startswith("_")} for p in plan]
    ok = sum(1 for p in plan if p["status"] == "ok")
    return {"rows": rows, "ok": ok, "errors": len(plan) - ok, "total": len(plan)}


async def import_preview(request: Request, db: AsyncSession, user: Any, org_id: int, body: ImportBody) -> dict:
    await require_org_admin(request, db, user, org_id)
    return _public(await _plan(db, org_id, body))


async def import_apply(request: Request, db: AsyncSession, user: Any, org_id: int, body: ImportBody) -> dict:
    await require_org_admin(request, db, user, org_id)
    plan = await _plan(db, org_id, body)
    touched: dict[int, UserGroup] = {}
    added: dict[int, list[int]] = {}
    for p in plan:
        if p["status"] != "ok":
            continue
        group: UserGroup = p["_group"]
        if p["action"] == "schedule":
            db.add(UserGroupSchedule(usergroup_id=group.id, org_id=org_id, user_id=p["user_id"], starts_at=p["_starts"],
                                     ends_at=p["_ends"], created_by_id=actor_id(user)))
            p["result"] = "scheduled"
        else:
            p["result"] = await add_source(db, group, p["user_id"], "import", expires_at=p["_ends"], actor_id=actor_id(user))
            if p["result"] == "added":
                added.setdefault(group.id, []).append(p["user_id"])  # type: ignore[arg-type]
        touched[group.id] = group  # type: ignore[index]
    for gid, group in touched.items():
        ids = [p["user_id"] for p in plan if p["status"] == "ok" and p["_group"].id == gid]
        record(db, request, group, "members_imported", user, via="import", details={"user_ids": ids[:100], "count": len(ids)})
    await db.commit()
    for gid, group in touched.items():
        await refresh_ancestors(db, group)
        await notify_members(db, group, added.get(gid, []), "joined")
    out = _public(plan)
    out["applied"] = True
    return out


class BulkBody(BaseModel):
    action: Literal["add", "remove", "move"]
    user_ids: list[int] = Field(default_factory=list, max_length=500)
    usergroup_uuids: list[str] = Field(default_factory=list, max_length=20)
    from_usergroup_uuid: Optional[str] = None
    expires_at: Optional[str] = None


async def bulk(request: Request, db: AsyncSession, user: Any, org_id: int, body: BulkBody) -> dict:
    """From the Users table: add the selected people to groups, remove them,
    or move them from one group to another. Admins, or managers on groups
    they manage (each group is checked)."""
    ids = list(dict.fromkeys(body.user_ids))
    enforce_batch_size_limit(len(ids), "users", 500)
    groups = {g.usergroup_uuid: g for g in await org_groups(db, org_id)}
    targets = [groups[u] for u in body.usergroup_uuids if u in groups]
    if len(targets) != len(set(body.usergroup_uuids)):
        raise HTTPException(status_code=404, detail="UserGroup not found")
    source_group = None
    if body.action == "move":
        if not body.from_usergroup_uuid or body.from_usergroup_uuid not in groups or len(targets) != 1:
            raise HTTPException(status_code=422, detail="Moving needs one group to move from and one to move to")
        source_group = groups[body.from_usergroup_uuid]
        if source_group.id == targets[0].id:
            raise HTTPException(status_code=422, detail="Pick a different group to move to")
    if not targets:
        raise HTTPException(status_code=422, detail="Pick at least one group")
    for g in targets + ([source_group] if source_group else []):
        await require_group_access(request, db, user, g, "members")
    ends = parse_when(body.expires_at, "expires_at")
    members = await org_member_ids(db, org_id)
    valid = [i for i in ids if i in members]
    summary: dict[str, Any] = {"skipped_not_in_org": [i for i in ids if i not in members], "groups": {}}

    async def add_to(g: UserGroup) -> list[int]:
        if g.kind == "smart":
            raise HTTPException(status_code=409, detail=f"'{g.name}' takes its members from rules")
        rows = await rows_for(db, g.id)
        done = []
        for uid in valid:
            if await add_source(db, g, uid, "manual", expires_at=ends, actor_id=actor_id(user), row=rows.get(uid), lookup=False) == "added":
                done.append(uid)
        return done

    async def remove_from(g: UserGroup) -> list[int]:
        rows = await rows_for(db, g.id)
        done = []
        for uid in valid:
            if await remove_sources(db, g, uid, DIRECT_SOURCES, row=rows.get(uid), lookup=False) == "removed":
                done.append(uid)
        return done

    changes: list[tuple[UserGroup, str, list[int]]] = []
    if body.action in ("add", "move"):
        for g in targets:
            changes.append((g, "members_added", await add_to(g)))
    if body.action == "remove":
        for g in targets:
            changes.append((g, "members_removed", await remove_from(g)))
    if source_group is not None:
        changes.append((source_group, "members_moved_out", await remove_from(source_group)))
    for g, action, done in changes:
        summary["groups"][g.usergroup_uuid] = {"name": g.name, "action": action, "count": len(done)}
        if done:
            record(db, request, g, action, user, via="bulk", details={
                "user_ids": done[:100], "count": len(done),
                **({"to": targets[0].usergroup_uuid} if action == "members_moved_out" else {})})
    await db.commit()
    for g, action, done in changes:
        if done:
            await refresh_ancestors(db, g)
            if action == "members_added":
                await notify_members(db, g, done, "joined")
    return summary
