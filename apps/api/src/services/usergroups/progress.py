"""A group's progress: completion by course, members at risk, activity over
time, a per-member table and its CSV export.

Courses shown are the ones the group unlocks plus the ones most of its
members are enrolled in (up to 12), so a group with no linked courses still
shows what its people are doing.
"""

from __future__ import annotations

import csv
import io
from datetime import date, timedelta
from typing import Any

from fastapi import Request
from sqlalchemy import func, or_
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.usergroup_resources import UserGroupResource
from src.services.usergroups.common import aware, iso, load_group, require_group_access, utcnow
from src.services.usergroups.groups import user_brief, users_by_id
from src.services.usergroups.membership import member_ids
from src.services.usergroups.rules import _course_progress, last_active

AT_RISK_DAYS = 14
MAX_COURSES = 12
WEEKS = 12


async def _courses_for(db: AsyncSession, group_id: int, org_id: int, members: set[int]) -> list:
    from src.db.courses.courses import Course
    from src.db.trail_runs import TrailRun

    linked = set((await db.execute(select(UserGroupResource.resource_uuid).where(
        UserGroupResource.usergroup_id == group_id, UserGroupResource.resource_uuid.like("course_%")  # type: ignore[attr-defined]
    ))).scalars().all())
    popular = []
    if members:
        popular = [cid for cid, _ in (await db.execute(
            select(TrailRun.course_id, func.count()).where(TrailRun.user_id.in_(list(members)), TrailRun.org_id == org_id)  # type: ignore[attr-defined]
            .group_by(TrailRun.course_id).order_by(func.count().desc()).limit(MAX_COURSES)
        )).all()]
    clauses = []
    if linked:
        clauses.append(Course.course_uuid.in_(linked))  # type: ignore[attr-defined]
    if popular:
        clauses.append(Course.id.in_(popular))  # type: ignore[union-attr]
    rows = list((await db.execute(select(Course).where(Course.org_id == org_id, or_(*clauses)))).scalars().all()) if clauses else []
    rows.sort(key=lambda c: (c.course_uuid not in linked, c.name.lower()))
    return [(c, c.course_uuid in linked) for c in rows[:MAX_COURSES]]


async def compute(db: AsyncSession, group) -> dict:
    from src.db.user_activity import UserActivityDay

    members = await member_ids(db, group.id)
    courses = await _courses_for(db, group.id, group.org_id, members)
    last = await last_active(db, group.org_id)
    today = utcnow().date()

    per_member: dict[int, dict] = {uid: {"enrolled": 0, "completed": 0, "progress_sum": 0, "unfinished": 0} for uid in members}
    course_rows = []
    for course, linked in courses:
        prog = await _course_progress(db, group.org_id, course.course_uuid)
        mine = {u: v for u, v in prog.items() if u in members}
        completed = sum(1 for _, done in mine.values() if done)
        avg = round(sum(p for p, _ in mine.values()) / len(mine)) if mine else 0
        course_rows.append({
            "course_uuid": course.course_uuid, "name": course.name, "thumbnail_image": course.thumbnail_image or None,
            "linked": linked, "enrolled": len(mine), "completed": completed, "avg_progress": avg,
            "not_started": max(0, len(members) - len(mine)) if linked else None,
            "completion_rate": round(completed / len(mine) * 100) if mine else 0,
        })
        for uid, (pct, done) in mine.items():
            m = per_member[uid]
            m["enrolled"] += 1
            m["completed"] += 1 if done else 0
            m["progress_sum"] += pct
            m["unfinished"] += 0 if done else 1

    people = await users_by_id(db, members)
    member_rows = []
    at_risk = []
    for uid in members:
        u = people.get(uid)
        if u is None:
            continue
        m = per_member[uid]
        seen = last.get(uid)
        idle = (today - seen).days if isinstance(seen, date) else None
        risky = m["unfinished"] > 0 and (idle is None or idle >= AT_RISK_DAYS)
        row = {**user_brief(u, email=True), "enrolled": m["enrolled"], "completed": m["completed"],
               "avg_progress": round(m["progress_sum"] / m["enrolled"]) if m["enrolled"] else 0,
               "last_active": seen.isoformat() if isinstance(seen, date) else None, "idle_days": idle, "at_risk": risky}
        member_rows.append(row)
        if risky:
            at_risk.append(row)
    member_rows.sort(key=lambda r: (not r["at_risk"], -(r["idle_days"] if r["idle_days"] is not None else 9999),
                                    (r.get("first_name") or r["username"] or "").lower()))

    # Weekly active members over the last WEEKS weeks.
    start = today - timedelta(days=today.weekday()) - timedelta(weeks=WEEKS - 1)
    activity = []
    if members:
        rows = (await db.execute(select(UserActivityDay.user_id, UserActivityDay.activity_date).where(
            UserActivityDay.org_id == group.org_id, UserActivityDay.user_id.in_(list(members)),  # type: ignore[attr-defined]
            UserActivityDay.activity_date >= start,
        ))).all()
        weeks: dict[date, set[int]] = {}
        for uid, d in rows:
            d = d if isinstance(d, date) else date.fromisoformat(str(d)[:10])
            wk = d - timedelta(days=d.weekday())
            weeks.setdefault(wk, set()).add(uid)
        activity = [{"week": (start + timedelta(weeks=i)).isoformat(), "active": len(weeks.get(start + timedelta(weeks=i), set()))}
                    for i in range(WEEKS)]
    active_7 = sum(1 for uid in members if isinstance(last.get(uid), date) and (today - last[uid]).days < 7)
    total_enrolled = sum(r["enrolled"] for r in course_rows)
    total_completed = sum(r["completed"] for r in course_rows)
    return {
        "summary": {
            "members": len(members), "active_7d": active_7, "at_risk": len(at_risk),
            "completion_rate": round(total_completed / total_enrolled * 100) if total_enrolled else 0,
            "courses": len(course_rows),
        },
        "courses": course_rows, "at_risk": at_risk[:50], "members": member_rows, "activity": activity,
    }


async def group_progress(request: Request, db: AsyncSession, user: Any, group_id: int) -> dict:
    group = await load_group(db, group_id)
    await require_group_access(request, db, user, group, "progress")
    return await compute(db, group)


def to_csv(data: dict) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["username", "first_name", "last_name", "email", "courses_enrolled", "courses_completed",
                "avg_progress_pct", "last_active", "at_risk"])
    for r in data["members"]:
        w.writerow([_safe(r["username"]), _safe(r.get("first_name")), _safe(r.get("last_name")), _safe(r.get("email")),
                    r["enrolled"], r["completed"], r["avg_progress"], r["last_active"] or "", "yes" if r["at_risk"] else "no"])
    return buf.getvalue()


def _safe(value: Any) -> str:
    """Neutralize spreadsheet formulas in exported cells."""
    text = str(value or "")
    return "'" + text if text[:1] in ("=", "+", "-", "@", "\t", "\r") else text


async def group_progress_csv(request: Request, db: AsyncSession, user: Any, group_id: int) -> tuple[str, str]:
    group = await load_group(db, group_id)
    await require_group_access(request, db, user, group, "progress")
    data = await compute(db, group)
    slug = "".join(ch if ch.isalnum() else "-" for ch in group.name.lower()).strip("-")[:40] or "group"
    return to_csv(data), f"{slug}-progress.csv"


async def next_deadline(db: AsyncSession, group, course_uuids: list[str]) -> dict | None:
    """The soonest upcoming date that matters to the group's manager: an
    assignment due in one of its courses, the end of its access to something,
    or a membership ending."""
    from src.db.courses.assignments import Assignment
    from src.db.courses.courses import Course
    from src.db.usergroup_user import UserGroupUser
    from src.services.notifications.events import _due_instant
    from src.services.usergroups.access import describe_resources

    now = utcnow()
    found: list[tuple] = []
    if course_uuids:
        rows = (await db.execute(
            select(Assignment.title, Assignment.due_date, Course.name).join(Course, Course.id == Assignment.course_id)
            .where(Course.course_uuid.in_(course_uuids), Course.org_id == group.org_id, Assignment.published == True)  # type: ignore[attr-defined]  # noqa: E712
        )).all()
        for title, due, course in rows:
            at = _due_instant(due)
            if at is not None and at > now:
                found.append((at, {"kind": "assignment", "title": title, "context": course}))
    links = (await db.execute(select(UserGroupResource.resource_uuid, UserGroupResource.expires_at).where(
        UserGroupResource.usergroup_id == group.id, UserGroupResource.expires_at.is_not(None)  # type: ignore[union-attr]
    ))).all()
    names = await describe_resources(db, group.org_id, [u for u, _ in links]) if links else {}
    for uuid, ends in links:
        ends = aware(ends)
        if ends and ends > now:
            found.append((ends, {"kind": "access_ends", "title": (names.get(uuid) or {}).get("name", uuid), "context": None}))
    ends = (await db.execute(select(func.min(UserGroupUser.expires_at)).where(
        UserGroupUser.usergroup_id == group.id, UserGroupUser.expires_at > now  # type: ignore[operator]
    ))).scalar()
    if ends is not None:
        found.append((aware(ends), {"kind": "membership_ends", "title": "", "context": None}))
    if not found:
        return None
    at, item = min(found, key=lambda f: f[0])
    return {**item, "at": iso(at)}


async def card_stats(db: AsyncSession, group) -> dict:
    """What a manager sees on a group's card in "My groups"."""
    data = await compute(db, group)
    s = data["summary"]
    return {
        "members": s["members"], "completion_rate": s["completion_rate"], "at_risk": s["at_risk"],
        "active_7d": s["active_7d"],
        "next_deadline": await next_deadline(db, group, [c["course_uuid"] for c in data["courses"]]),
    }
