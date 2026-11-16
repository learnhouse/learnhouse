"""Smart group rules: membership decided by who people are and what they do.

A rule set is ``{"match": "all" | "any", "conditions": [...]}``. Each
condition picks a set of org members; ``negate`` flips it within the org.
Evaluation is set-based (a handful of queries per condition, not one per
person), so previews and the background sync stay cheap.

Conditions
----------
- ``email_domain`` {values: ["school.edu"]}
- ``role`` {role_ids: [..]}
- ``signup_field`` {key, value}: an answer given at signup
- ``people_field`` {field: department|title|location|cost_center|employment_status, value}
- ``tag`` {value}: a tag on the member's people data (attributes.tags)
- ``enrolled`` / ``completed`` {course_uuid}
- ``progress_at_least`` / ``progress_below`` {course_uuid, pct}
- ``path_enrolled`` / ``path_completed`` {path_uuid}
- ``company`` {company_uuid}: an active seat in a company account (EE)
- ``joined_after`` / ``joined_before`` {date}; ``joined_within_days`` {days}
- ``active_within_days`` / ``inactive_days`` {days}
- ``scim_group`` {scim_id}: members of a group pushed by the identity provider (EE)
- ``in_group`` {usergroup_uuid}: members of another group of the org
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any, Optional

from fastapi import HTTPException
from sqlalchemy import case, func
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.user_organizations import UserOrganization
from src.db.users import User
from src.services.usergroups.common import parse_when, utcnow
from src.services.usergroups.membership import org_member_ids

MAX_CONDITIONS = 20
PEOPLE_FIELDS = ("department", "title", "location", "cost_center", "employment_status")

# type -> the fields it takes
CONDITION_FIELDS: dict[str, tuple[str, ...]] = {
    "email_domain": ("values",),
    "role": ("role_ids",),
    "signup_field": ("key", "value"),
    "people_field": ("field", "value"),
    "tag": ("value",),
    "enrolled": ("course_uuid",),
    "completed": ("course_uuid",),
    "progress_at_least": ("course_uuid", "pct"),
    "progress_below": ("course_uuid", "pct"),
    "path_enrolled": ("path_uuid",),
    "path_completed": ("path_uuid",),
    "company": ("company_uuid",),
    "joined_after": ("date",),
    "joined_before": ("date",),
    "joined_within_days": ("days",),
    "active_within_days": ("days",),
    "inactive_days": ("days",),
    "scim_group": ("scim_id",),
    "in_group": ("usergroup_uuid",),
}
CONDITION_TYPES = tuple(CONDITION_FIELDS)


def _bad(msg: str) -> HTTPException:
    return HTTPException(status_code=422, detail=msg)


def validate_rules(rules: Any) -> dict:
    """Normalize a rule set, refusing anything malformed with a 422."""
    if rules in (None, {}):
        return {"match": "all", "conditions": []}
    if not isinstance(rules, dict):
        raise _bad("rules must be an object")
    match = rules.get("match", "all")
    if match not in ("all", "any"):
        raise _bad("match must be 'all' or 'any'")
    conds = rules.get("conditions") or []
    if not isinstance(conds, list) or len(conds) > MAX_CONDITIONS:
        raise _bad(f"conditions must be a list of at most {MAX_CONDITIONS}")
    clean = []
    for c in conds:
        kind = c.get("type") if isinstance(c, dict) else None
        if kind not in CONDITION_FIELDS:
            raise _bad(f"Unknown condition type: {kind}")
        out: dict[str, Any] = {"type": kind}
        for field in CONDITION_FIELDS[kind]:
            value = c.get(field)
            if field == "values":
                vals = value if isinstance(value, list) else [value] if value else []
                vals = [str(v).strip().lower().lstrip("@") for v in vals if str(v or "").strip()]
                if not vals or len(vals) > 50:
                    raise _bad("email_domain needs between 1 and 50 domains")
                out[field] = vals
            elif field == "role_ids":
                ids = value if isinstance(value, list) else [value] if value is not None else []
                try:
                    out[field] = [int(v) for v in ids][:20]
                except (TypeError, ValueError):
                    raise _bad("role_ids must be integers")
                if not out[field]:
                    raise _bad("role needs at least one role")
            elif field in ("pct", "days"):
                try:
                    n = float(value) if field == "pct" else int(value)
                except (TypeError, ValueError):
                    raise _bad(f"{kind}: {field} must be a number")
                if field == "pct" and not 0 <= n <= 100:
                    raise _bad("pct must be between 0 and 100")
                if field == "days" and not 1 <= n <= 3650:
                    raise _bad("days must be between 1 and 3650")
                out[field] = n
            elif field == "date":
                when = parse_when(value, "date")
                if when is None:
                    raise _bad(f"{kind} needs a date")
                out[field] = when.date().isoformat()
            elif field == "field":
                if value not in PEOPLE_FIELDS:
                    raise _bad(f"people_field must be one of {', '.join(PEOPLE_FIELDS)}")
                out[field] = value
            else:
                text = str(value or "").strip()
                if not text and field != "value":
                    raise _bad(f"{kind} needs {field}")
                out[field] = text[:200]
        if c.get("negate"):
            out["negate"] = True
        clean.append(out)
    return {"match": match, "conditions": clean}


# ── condition sets ──────────────────────────────────────────────────────


async def _course_progress(db: AsyncSession, org_id: int, course_uuid: str) -> dict[int, tuple[int, bool]]:
    """{user_id: (progress %, completed)} for everyone enrolled in a course of the org."""
    from src.db.courses.activities import Activity
    from src.db.courses.courses import Course
    from src.db.trail_runs import StatusEnum, TrailRun
    from src.db.trail_steps import TrailStep

    course = (await db.execute(
        select(Course).where(Course.course_uuid == course_uuid, Course.org_id == org_id)
    )).scalars().first()
    if course is None:
        return {}
    total = int((await db.execute(select(func.count(Activity.id)).where(Activity.course_id == course.id))).scalar() or 0)
    runs = (await db.execute(select(TrailRun.user_id, TrailRun.status).where(TrailRun.course_id == course.id))).all()
    done = dict((await db.execute(
        select(TrailStep.user_id, func.sum(case((TrailStep.complete == True, 1), else_=0)))  # noqa: E712
        .where(TrailStep.course_id == course.id).group_by(TrailStep.user_id)
    )).all())
    out: dict[int, tuple[int, bool]] = {}
    for user_id, status in runs:
        d = min(int(done.get(user_id) or 0), total) if total else 0
        completed = str(getattr(status, "value", status)) == StatusEnum.STATUS_COMPLETED.value or (total > 0 and d >= total)
        pct = 100 if completed else (round(d / total * 100) if total else 0)
        out[user_id] = (pct, completed)
    return out


async def last_active(db: AsyncSession, org_id: int) -> dict[int, date]:
    from src.db.user_activity import UserActivityDay

    return dict((await db.execute(
        select(UserActivityDay.user_id, func.max(UserActivityDay.activity_date))
        .where(UserActivityDay.org_id == org_id).group_by(UserActivityDay.user_id)
    )).all())


def _to_date(value: Any) -> Optional[date]:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return datetime.fromisoformat(str(value)[:19]).date()
    except (TypeError, ValueError):
        return None


async def _joined(db: AsyncSession, org_id: int) -> dict[int, date]:
    rows = (await db.execute(
        select(UserOrganization.user_id, UserOrganization.creation_date).where(UserOrganization.org_id == org_id)
    )).all()
    return {uid: d for uid, raw in rows if (d := _to_date(raw)) is not None}


async def _profiles(db: AsyncSession, org_id: int):
    from src.db.org_member_profile import OrgMemberProfile

    return (await db.execute(select(OrgMemberProfile).where(OrgMemberProfile.org_id == org_id))).scalars().all()


async def condition_set(db: AsyncSession, org_id: int, c: dict, members: set[int], *, self_group_id: Optional[int] = None) -> set[int]:
    kind = c["type"]
    today = utcnow().date()
    if kind == "email_domain":
        domains = set(c["values"])
        rows = (await db.execute(select(User.id, User.email).where(User.id.in_(list(members))))).all() if members else []  # type: ignore[union-attr]
        return {uid for uid, email in rows if email and email.rsplit("@", 1)[-1].lower() in domains}
    if kind == "role":
        return set((await db.execute(select(UserOrganization.user_id).where(
            UserOrganization.org_id == org_id, UserOrganization.role_id.in_(c["role_ids"])  # type: ignore[attr-defined]
        ))).scalars().all())
    if kind == "signup_field":
        key, value = c["key"], str(c.get("value") or "").strip().lower()
        rows = (await db.execute(select(User.id, User.extra_metadata).where(User.id.in_(list(members))))).all() if members else []  # type: ignore[union-attr]
        out = set()
        for uid, meta in rows:
            if not isinstance(meta, dict):
                continue
            answers = meta.get("signup_fields") if isinstance(meta.get("signup_fields"), dict) else meta
            if key not in answers:
                continue
            got = answers.get(key)
            got_text = ", ".join(map(str, got)) if isinstance(got, list) else str(got or "")
            if not value or got_text.strip().lower() == value or (isinstance(got, list) and value in [str(g).lower() for g in got]):
                out.add(uid)
        return out
    if kind == "people_field":
        field, value = c["field"], str(c.get("value") or "").strip().lower()
        return {p.user_id for p in await _profiles(db, org_id)
                if (str(getattr(p, field) or "").strip().lower() == value if value else bool(getattr(p, field)))}
    if kind == "tag":
        value = str(c.get("value") or "").strip().lower()
        out = set()
        for p in await _profiles(db, org_id):
            tags = (p.attributes or {}).get("tags") if isinstance(p.attributes, dict) else None
            if isinstance(tags, str):
                tags = [t.strip() for t in tags.split(",")]
            if isinstance(tags, list) and value in [str(t).strip().lower() for t in tags]:
                out.add(p.user_id)
        return out
    if kind in ("enrolled", "completed", "progress_at_least", "progress_below"):
        prog = await _course_progress(db, org_id, c["course_uuid"])
        if kind == "enrolled":
            return set(prog)
        if kind == "completed":
            return {u for u, (_, done) in prog.items() if done}
        pct = float(c.get("pct") or 0)
        if kind == "progress_at_least":
            return {u for u, (p, _) in prog.items() if p >= pct}
        return {u for u, (p, _) in prog.items() if p < pct}
    if kind in ("path_enrolled", "path_completed"):
        from src.db.paths import Path, PathCertificate, PathEnrollment

        path = (await db.execute(select(Path).where(Path.path_uuid == c["path_uuid"], Path.org_id == org_id))).scalars().first()
        if path is None:
            return set()
        if kind == "path_enrolled":
            return set((await db.execute(select(PathEnrollment.user_id).where(PathEnrollment.path_id == path.id))).scalars().all())
        return set((await db.execute(select(PathCertificate.user_id).where(PathCertificate.path_id == path.id))).scalars().all())
    if kind == "company":
        from src.core.ee_hooks import get_ee_module

        mod = get_ee_module("ee.db.payments.payments_company_seats")
        if mod is None:
            return set()
        return {u for u in (await db.execute(
            select(mod.CompanySeat.user_id).join(mod.CompanyAccount, mod.CompanyAccount.id == mod.CompanySeat.company_id)
            .where(mod.CompanyAccount.company_uuid == c["company_uuid"], mod.CompanySeat.org_id == org_id,
                   mod.CompanySeat.status == "active")
        )).scalars().all() if u}
    if kind in ("joined_after", "joined_before", "joined_within_days"):
        joined = await _joined(db, org_id)
        if kind == "joined_within_days":
            cutoff = today - timedelta(days=int(c["days"]))
            return {u for u, d in joined.items() if d >= cutoff}
        pivot = date.fromisoformat(c["date"])
        return {u for u, d in joined.items() if (d >= pivot if kind == "joined_after" else d < pivot)}
    if kind in ("active_within_days", "inactive_days"):
        last = await last_active(db, org_id)
        cutoff = today - timedelta(days=int(c["days"]))
        active = {u for u, d in last.items() if (_to_date(d) or date.min) >= cutoff}
        return active if kind == "active_within_days" else members - active
    if kind == "scim_group":
        from src.core.ee_hooks import get_ee_module

        mod = get_ee_module("ee.db.scim")
        if mod is None:
            return set()
        local = (await db.execute(select(mod.ScimResource.local_id).where(
            mod.ScimResource.org_id == org_id, mod.ScimResource.resource_type == "Group",
            mod.ScimResource.scim_id == c["scim_id"],
        ))).scalars().first()
        if local is None or local == self_group_id:
            return set()
        from src.db.usergroup_user import UserGroupUser

        return set((await db.execute(select(UserGroupUser.user_id).where(UserGroupUser.usergroup_id == local))).scalars().all())
    if kind == "in_group":
        from src.db.usergroup_user import UserGroupUser
        from src.db.usergroups import UserGroup

        other = (await db.execute(select(UserGroup.id).where(
            UserGroup.usergroup_uuid == c["usergroup_uuid"], UserGroup.org_id == org_id
        ))).scalars().first()
        if other is None or other == self_group_id:
            return set()
        return set((await db.execute(select(UserGroupUser.user_id).where(UserGroupUser.usergroup_id == other))).scalars().all())
    return set()  # pragma: no cover - validate_rules refuses unknown types


async def evaluate(db: AsyncSession, org_id: int, rules: Any, *, self_group_id: Optional[int] = None,
                   members: Optional[set[int]] = None) -> set[int]:
    """Org members matching a rule set. An empty rule set matches nobody (a
    smart group with no rules is empty, never "everyone")."""
    rules = validate_rules(rules)
    if not rules["conditions"]:
        return set()
    members = members if members is not None else await org_member_ids(db, org_id)
    sets = []
    for c in rules["conditions"]:
        hit = await condition_set(db, org_id, c, members, self_group_id=self_group_id) & members
        sets.append(members - hit if c.get("negate") else hit)
    return set.intersection(*sets) if rules["match"] == "all" else set.union(*sets)


async def preview(db: AsyncSession, org_id: int, rules: Any, *, self_group_id: Optional[int] = None, sample: int = 8) -> dict:
    ids = await evaluate(db, org_id, rules, self_group_id=self_group_id)
    people = []
    if ids:
        rows = (await db.execute(
            select(User).where(User.id.in_(sorted(ids)[:sample]))  # type: ignore[union-attr]
        )).scalars().all()
        people = [{
            "id": u.id, "user_uuid": u.user_uuid, "username": u.username,
            "first_name": u.first_name, "last_name": u.last_name, "avatar_image": u.avatar_image,
        } for u in rows]
    return {"count": len(ids), "sample": people}
