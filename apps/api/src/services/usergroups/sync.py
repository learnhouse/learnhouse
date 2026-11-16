"""Keeping groups true over time: rules, email domains, schedules, expiry and
nesting.

:func:`sync_org` is the one entry point. It is idempotent (every step reads
the current state and only writes the difference), so it runs from the
background scheduler every 15 minutes, after a change in the dashboard, and,
debounced, after events that can move someone in or out of a rule (joining
the org, enrolling, finishing a course).
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

from fastapi import HTTPException
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.usergroup_extras import UserGroupSchedule
from src.db.usergroup_user import UserGroupUser
from src.db.usergroups import UserGroup
from src.services.usergroups.common import (
    MAX_DEPTH,
    advanced_enabled,
    aware,
    group_settings,
    org_groups,
    record,
    utcnow,
)
from src.services.usergroups.membership import (
    DIRECT_SOURCES,
    add_source,
    notify_members,
    org_member_ids,
    recompute_inherited,
    remove_sources,
    rows_for,
    sources_of,
)
from src.services.usergroups import rules as rules_mod

logger = logging.getLogger(__name__)


@dataclass
class SyncStats:
    groups: int = 0
    added: int = 0
    removed: int = 0
    scheduled_started: int = 0
    scheduled_ended: int = 0
    expired: int = 0
    by_group: dict = field(default_factory=dict)

    def bump(self, group_id: int, key: str, n: int) -> None:
        if not n:
            return
        g = self.by_group.setdefault(group_id, {"added": 0, "removed": 0})
        g[key] = g.get(key, 0) + n

    def as_dict(self) -> dict:
        return {k: v for k, v in self.__dict__.items() if k != "by_group"}


# ── nesting ─────────────────────────────────────────────────────────────


def depth_map(groups: list[UserGroup]) -> dict[int, int]:
    by_id = {g.id: g for g in groups}
    out: dict[int, int] = {}
    for g in groups:
        d, seen, cur = 0, set(), g
        while cur.parent_id and cur.parent_id in by_id and cur.id not in seen and d <= MAX_DEPTH * 2:
            seen.add(cur.id)
            cur = by_id[cur.parent_id]
            d += 1
        out[g.id] = d  # type: ignore[index]
    return out


async def set_parent(db: AsyncSession, group: UserGroup, parent: Optional[UserGroup]) -> None:
    """Nest ``group`` under ``parent`` (or un-nest it). Refuses another
    org's group, itself, a descendant (a loop) and chains deeper than
    MAX_DEPTH. Does not commit."""
    if parent is None:
        group.parent_id = None
        return
    if parent.org_id != group.org_id:
        raise HTTPException(status_code=404, detail="Parent group not found")
    if parent.id == group.id:
        raise HTTPException(status_code=409, detail="A group can't be its own parent")
    groups = await org_groups(db, group.org_id)
    by_id = {g.id: g for g in groups}
    cur, hops = parent, 0
    while cur is not None:
        if cur.id == group.id:
            raise HTTPException(status_code=409, detail="That would put the group inside one of its own sub-groups")
        hops += 1
        if hops > MAX_DEPTH * 2:  # a loop already stored in the data
            break
        cur = by_id.get(cur.parent_id) if cur.parent_id else None
    # Depth of the new chain: parent's depth + 1 + the group's own subtree height.
    depths = depth_map(groups)
    children: dict[int, list[int]] = {}
    for g in groups:
        if g.parent_id:
            children.setdefault(g.parent_id, []).append(g.id)  # type: ignore[arg-type]

    def height(gid: int, guard: int = 0) -> int:
        if guard > MAX_DEPTH * 2:
            return guard
        kids = children.get(gid, [])
        return 0 if not kids else 1 + max(height(k, guard + 1) for k in kids)

    if depths.get(parent.id, 0) + 1 + height(group.id) >= MAX_DEPTH:  # type: ignore[arg-type]
        raise HTTPException(status_code=409, detail=f"Groups can be nested at most {MAX_DEPTH} levels deep")
    group.parent_id = parent.id


# ── per-group steps ─────────────────────────────────────────────────────


async def _sync_rule_sources(db: AsyncSession, group: UserGroup, members: set[int], advanced: bool) -> tuple[set[int], set[int]]:
    """Make the ``rule`` and ``domain`` reasons match the group's rules and
    auto-join domains."""
    rows = await rows_for(db, group.id)
    added: set[int] = set()
    removed: set[int] = set()

    wanted: dict[str, set[int]] = {"rule": set(), "domain": set()}
    if group.kind in ("smart", "hybrid") and group.rules:
        if not advanced:
            # Below the plan the rules stop running; their members stay
            # frozen until the plan comes back or the group turns manual.
            wanted.pop("rule")
        else:
            try:
                wanted["rule"] = await rules_mod.evaluate(db, group.org_id, group.rules, self_group_id=group.id, members=members)
            except HTTPException:
                logger.warning("Group %s has invalid rules; leaving rule members as they are", group.id)
                wanted.pop("rule")
    domains = set(group_settings(group)["auto_join_domains"])
    if domains:
        wanted["domain"] = await rules_mod.condition_set(
            db, group.org_id, {"type": "email_domain", "values": sorted(domains)}, members
        ) & members

    for source, desired in wanted.items():
        for uid in desired:
            row = rows.get(uid)
            if await add_source(db, group, uid, source, row=row, lookup=False) == "added":
                added.add(uid)
        for uid, row in rows.items():
            if uid not in desired and source in sources_of(row):
                if await remove_sources(db, group, uid, [source], row=row, lookup=False) == "removed":
                    removed.add(uid)
        await db.flush()
        rows = await rows_for(db, group.id)
    return added, removed


async def apply_schedules(db: AsyncSession, org_id: int, now: datetime, stats: SyncStats, request=None) -> None:
    due = (await db.execute(select(UserGroupSchedule).where(
        UserGroupSchedule.org_id == org_id, UserGroupSchedule.status == "pending", UserGroupSchedule.starts_at <= now,
    ))).scalars().all()
    members = await org_member_ids(db, org_id) if due else set()
    started: dict[int, set[int]] = {}
    for s in due:
        group = await db.get(UserGroup, s.usergroup_id)
        if group is None or s.user_id not in members:
            s.status = "cancelled"
            db.add(s)
            continue
        ends = aware(s.ends_at)
        if ends is not None and ends <= now:
            s.status = "done"
            db.add(s)
            continue
        await add_source(db, group, s.user_id, "manual", expires_at=ends, actor_id=s.created_by_id)
        s.status = "active" if ends else "done"
        db.add(s)
        started.setdefault(group.id, set()).add(s.user_id)  # type: ignore[arg-type]
        stats.scheduled_started += 1
    await db.flush()
    for gid, uids in started.items():
        group = await db.get(UserGroup, gid)
        if group is not None:
            record(db, request, group, "members_added", via="schedule", details={"user_ids": sorted(uids)[:100], "count": len(uids)})
            stats.bump(gid, "added", len(uids))
            await notify_members(db, group, uids, "joined")
    # Scheduled memberships whose end has passed are handled by expiry
    # (their row carries expires_at); close the bookkeeping rows.
    for s in (await db.execute(select(UserGroupSchedule).where(
        UserGroupSchedule.org_id == org_id, UserGroupSchedule.status == "active",
        UserGroupSchedule.ends_at.is_not(None), UserGroupSchedule.ends_at <= now,  # type: ignore[union-attr]
    ))).scalars().all():
        s.status = "done"
        db.add(s)
        stats.scheduled_ended += 1


async def apply_expiry(db: AsyncSession, org_id: int, now: datetime, stats: SyncStats, request=None) -> None:
    rows = (await db.execute(select(UserGroupUser).where(
        UserGroupUser.org_id == org_id, UserGroupUser.expires_at.is_not(None), UserGroupUser.expires_at <= now,  # type: ignore[union-attr]
    ))).scalars().all()
    ended: dict[int, set[int]] = {}
    for row in rows:
        group = await db.get(UserGroup, row.usergroup_id)
        if group is None:
            continue
        result = await remove_sources(db, group, row.user_id, DIRECT_SOURCES, row=row, lookup=False)
        if result == "kept":
            row.expires_at = None
            db.add(row)
        if result == "removed":
            ended.setdefault(group.id, set()).add(row.user_id)  # type: ignore[arg-type]
            stats.expired += 1
    await db.flush()
    for gid, uids in ended.items():
        group = await db.get(UserGroup, gid)
        if group is not None:
            record(db, request, group, "members_expired", via="expiry", details={"user_ids": sorted(uids)[:100], "count": len(uids)})
            stats.bump(gid, "removed", len(uids))
            await notify_members(db, group, uids, "left")


# ── org sync ────────────────────────────────────────────────────────────


async def sync_org(db: AsyncSession, org_id: int, now: Optional[datetime] = None, *, request=None,
                   only_group_id: Optional[int] = None) -> SyncStats:
    """Bring every group of an org (or one group and its parents) in line.
    Commits."""
    now = now or utcnow()
    stats = SyncStats()
    groups = await org_groups(db, org_id)
    if not groups:
        return stats
    advanced = await advanced_enabled(db, org_id)
    await apply_schedules(db, org_id, now, stats, request)
    await apply_expiry(db, org_id, now, stats, request)
    members = await org_member_ids(db, org_id)

    for group in groups:
        if only_group_id is not None and group.id != only_group_id:
            continue
        added, removed = await _sync_rule_sources(db, group, members, advanced)
        if added or removed:
            details = {"added": sorted(added)[:100], "removed": sorted(removed)[:100],
                       "added_count": len(added), "removed_count": len(removed)}
            record(db, request, group, "rules_synced", via="rules", details=details)
            stats.added += len(added)
            stats.removed += len(removed)
            stats.bump(group.id, "added", len(added))  # type: ignore[arg-type]
            stats.bump(group.id, "removed", len(removed))  # type: ignore[arg-type]
            await notify_members(db, group, added, "joined")
        group.last_synced_at = now
        db.add(group)
        stats.groups += 1
    await db.flush()

    # Nesting, deepest groups first so a grandchild reaches the grandparent
    # in one pass. Nesting is a Pro feature: on a lower plan the inherited
    # reasons are cleared (and come back when the plan does).
    depths = depth_map(groups)
    for group in sorted(groups, key=lambda g: -depths.get(g.id, 0)):  # type: ignore[arg-type]
        if advanced:
            await recompute_inherited(db, group)
        else:
            for uid, row in (await rows_for(db, group.id)).items():
                if "inherited" in sources_of(row):
                    await remove_sources(db, group, uid, ["inherited"], row=row, lookup=False)
        await db.flush()
    await db.commit()
    return stats


async def sync_all(db: AsyncSession, now: Optional[datetime] = None) -> SyncStats:
    """Every org that has groups needing upkeep: rules, domains, nesting,
    pending schedules or expiring memberships."""
    now = now or utcnow()
    org_ids = set((await db.execute(select(UserGroup.org_id).where(
        (UserGroup.kind != "manual") | UserGroup.parent_id.is_not(None) | UserGroup.settings.is_not(None)  # type: ignore[union-attr]
    ))).scalars().all())
    org_ids |= set((await db.execute(select(UserGroupSchedule.org_id).where(
        UserGroupSchedule.status.in_(("pending", "active"))  # type: ignore[attr-defined]
    ))).scalars().all())
    org_ids |= set((await db.execute(select(UserGroupUser.org_id).where(
        UserGroupUser.expires_at.is_not(None), UserGroupUser.expires_at <= now  # type: ignore[union-attr]
    ))).scalars().all())
    total = SyncStats()
    for org_id in sorted(org_ids):
        try:
            s = await sync_org(db, org_id, now)
        except Exception:
            await db.rollback()
            logger.exception("User group sync failed for org %s", org_id)
            continue
        for k, v in s.as_dict().items():
            setattr(total, k, getattr(total, k) + v)
    # Heads-up a few days before a membership ends (deduped per membership).
    from src.services.feature_notifications import warn_group_access_expiring

    await warn_group_access_expiring(db, now)
    return total


# ── event-driven sync (debounced) ───────────────────────────────────────

_pending: dict[int, asyncio.Task] = {}
DEBOUNCE_SECONDS = 5.0


async def _run_later(org_id: int) -> None:
    try:
        await asyncio.sleep(DEBOUNCE_SECONDS)
        from src.core.events.database import _async_session_factory

        async with _async_session_factory() as db:
            await sync_org(db, org_id)
    except asyncio.CancelledError:  # pragma: no cover - shutdown
        raise
    except Exception:  # pragma: no cover - logged, retried by the scheduler
        logger.exception("Debounced group sync failed for org %s", org_id)
    finally:
        _pending.pop(org_id, None)


def queue_org_sync(org_id: Optional[int]) -> None:
    """Sync an org's groups a few seconds from now; repeated calls inside
    the window coalesce. Never raises. Off under tests (they call sync_org)."""
    import os

    if not org_id or os.environ.get("TESTING") == "true":
        return
    try:
        if org_id in _pending:
            return
        _pending[org_id] = asyncio.get_running_loop().create_task(_run_later(org_id))
    except Exception:  # pragma: no cover - no running loop
        logger.debug("Group sync not queued for org %s", org_id)


def on_member_event(org_id: Optional[int], user_id: Optional[int] = None) -> None:
    """Hook for events that can change rule matches (joined the org,
    enrolled, progressed, profile changed)."""
    queue_org_sync(org_id)


async def _org_of_course_then_sync(course_id: int) -> None:
    try:
        from src.core.events.database import _async_session_factory
        from src.db.courses.courses import Course

        async with _async_session_factory() as db:
            course = await db.get(Course, course_id)
            org_id = course.org_id if course else None
            smart = org_id is not None and (await db.execute(select(UserGroup.id).where(
                UserGroup.org_id == org_id, UserGroup.kind != "manual"
            ).limit(1))).first() is not None
        if smart:
            queue_org_sync(org_id)
    except Exception:  # pragma: no cover - logged, retried by the scheduler
        logger.debug("Group sync lookup failed for course %s", course_id, exc_info=True)


def on_course_progress(course_id: Optional[int]) -> None:
    """Hook for learner progress (enrolled, completed an activity or a
    course): orgs with smart groups re-sync, debounced. Never raises."""
    import os

    if not course_id or os.environ.get("TESTING") == "true":
        return
    try:
        asyncio.get_running_loop().create_task(_org_of_course_then_sync(course_id))
    except Exception:  # pragma: no cover - no running loop
        logger.debug("Group sync not queued for course %s", course_id)
