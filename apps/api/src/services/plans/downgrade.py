"""What a move to the Free plan changes, and how an upgrade puts it back.

Feature access needs no work here: every gate reads the plan, so Standard+
features lock the moment the plan string changes. What the plan string can't
express is content that is already out in the world:

- **Courses.** Free allows one public course. The one that stays public is the
  public course with the most learners (ties: published first, then the most
  recently updated), because that is the course people are actually using.
  Every other public course becomes private (members only). Nothing is
  deleted or unpublished, and the previous visibility is recorded so an
  upgrade restores it.
- **Members and admins over the Free limits** are kept. Adding more is refused
  by the usage limits with a message naming the limit (see usage.py).

Restoring only touches courses that are still private: if an admin changed a
course after the downgrade, their choice stands.
"""

import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import func
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.courses import Course
from src.db.org_plan_state import OrgDowngrade
from src.db.trail_runs import TrailRun
from src.db.user_organizations import UserOrganization
from src.security.features_utils.plans import PLAN_LIMITS
from src.security.rbac.constants import ADMIN_ROLE_ID

logger = logging.getLogger(__name__)


def public_course_cap(plan: str) -> int:
    """How many courses may be public on a plan (0 = unlimited). Free's course
    limit doubles as its public course cap: an org that kept several courses
    from a paid plan may hold them, but only one can be public."""
    return PLAN_LIMITS.get(plan, PLAN_LIMITS["free"]).get("courses", 0)


async def _learner_counts(db_session: AsyncSession, course_ids: list[int]) -> dict[int, int]:
    if not course_ids:
        return {}
    rows = (
        await db_session.execute(
            select(TrailRun.course_id, func.count(TrailRun.id))
            .where(TrailRun.course_id.in_(course_ids))
            .group_by(TrailRun.course_id)
        )
    ).all()
    return {course_id: count for course_id, count in rows}


async def rank_public_courses(db_session: AsyncSession, org_id: int) -> list[Course]:
    """The org's public courses, the one to keep first."""
    courses = list(
        (
            await db_session.execute(
                select(Course).where(Course.org_id == org_id, Course.public == True)  # noqa: E712
            )
        ).scalars().all()
    )
    learners = await _learner_counts(db_session, [c.id for c in courses])
    courses.sort(
        key=lambda c: (learners.get(c.id, 0), bool(c.published), c.update_date or "", c.id or 0),
        reverse=True,
    )
    return courses


async def _pause_drip(db_session: AsyncSession, org_id: int, to_plan: str) -> list[int]:
    """Drip schedules are a Standard feature: on a plan without them every
    chapter opens. The schedules are kept, switched off, and switched back on
    by the restore. Returns the ids of the courses paused."""
    from src.security.features_utils.plans import FEATURE_PLAN_REQUIREMENTS, PLAN_HIERARCHY

    required = FEATURE_PLAN_REQUIREMENTS["drip"]
    rank = PLAN_HIERARCHY.index(to_plan) if to_plan in PLAN_HIERARCHY else 0
    if rank >= PLAN_HIERARCHY.index(required):
        return []
    paused: list[int] = []
    courses = (await db_session.execute(select(Course).where(Course.org_id == org_id))).scalars().all()
    for course in courses:
        settings = course.drip_settings or {}
        if isinstance(settings, dict) and settings.get("enabled"):
            course.drip_settings = {**settings, "enabled": False}
            db_session.add(course)
            paused.append(course.id)
    return paused


def _course_ref(course: Course) -> dict:
    return {"id": course.id, "uuid": course.course_uuid, "name": course.name}


async def enforce_downgrade(
    db_session: AsyncSession,
    org_id: int,
    from_plan: str,
    to_plan: str = "free",
    reason: str = "other",
) -> Optional[OrgDowngrade]:
    """Apply the Free plan's content rules and record what changed. Returns
    the record, or None when the target plan has no public course cap."""
    cap = public_course_cap(to_plan)
    if cap <= 0:
        return None
    ranked = await rank_public_courses(db_session, org_id)
    kept, demoted = ranked[:cap], ranked[cap:]
    for course in demoted:
        course.public = False
        course.update_date = str(datetime.now())
        db_session.add(course)
    drip_paused = await _pause_drip(db_session, org_id, to_plan)
    record = OrgDowngrade(
        org_id=org_id,
        from_plan=from_plan,
        to_plan=to_plan,
        reason=reason,
        changes={
            "courses": [{**_course_ref(c), "public": True} for c in demoted],
            "kept_course": _course_ref(kept[0]) if kept else None,
            "drip_paused": drip_paused,
        },
    )
    db_session.add(record)
    await db_session.commit()
    await db_session.refresh(record)
    _reindex([c["id"] for c in record.changes["courses"]])
    return record


async def restore_after_upgrade(
    db_session: AsyncSession, org_id: int, to_plan: str
) -> tuple[list[OrgDowngrade], int]:
    """Undo every downgrade not yet restored, oldest first. Returns the
    records closed (empty when there was nothing to undo) and how many
    courses were made public again."""
    cap = public_course_cap(to_plan)
    records = list(
        (
            await db_session.execute(
                select(OrgDowngrade)
                .where(OrgDowngrade.org_id == org_id, OrgDowngrade.restored_at.is_(None))
                .order_by(OrgDowngrade.created_at, OrgDowngrade.id)
            )
        ).scalars().all()
    )
    if not records:
        return [], 0
    public_now = len(await rank_public_courses(db_session, org_id))
    touched: list[int] = []
    now = datetime.now(timezone.utc)
    for record in records:
        for entry in (record.changes or {}).get("courses", []):
            if cap and public_now >= cap:
                break
            course = await db_session.get(Course, entry.get("id"))
            if course is None or course.org_id != org_id or course.public or not entry.get("public"):
                continue
            course.public = True
            course.update_date = str(datetime.now())
            db_session.add(course)
            touched.append(course.id)
            public_now += 1
        for course_id in (record.changes or {}).get("drip_paused", []):
            course = await db_session.get(Course, course_id)
            settings = dict(course.drip_settings or {}) if course is not None else {}
            if course is None or course.org_id != org_id or settings.get("enabled"):
                continue
            course.drip_settings = {**settings, "enabled": True}
            db_session.add(course)
        record.restored_at = now
        record.restored_to_plan = to_plan
        db_session.add(record)
    await db_session.commit()
    _reindex(touched)
    return records, len(touched)


async def latest_downgrade(db_session: AsyncSession, org_id: int) -> Optional[OrgDowngrade]:
    return (
        await db_session.execute(
            select(OrgDowngrade)
            .where(OrgDowngrade.org_id == org_id)
            .order_by(OrgDowngrade.created_at.desc(), OrgDowngrade.id.desc())
            .limit(1)
        )
    ).scalars().first()


def downgrade_state(record: Optional[OrgDowngrade]) -> Optional[dict]:
    """The last downgrade as the plan page shows it."""
    if record is None:
        return None
    changes = record.changes or {}
    created = record.created_at if record.created_at.tzinfo else record.created_at.replace(tzinfo=timezone.utc)
    return {
        "from_plan": record.from_plan,
        "to_plan": record.to_plan,
        "reason": record.reason,
        "created_at": created.isoformat(),
        "restored": record.restored_at is not None,
        "courses_made_private": len(changes.get("courses", [])),
        "drip_paused": len(changes.get("drip_paused", [])),
        "kept_course": changes.get("kept_course"),
    }


async def preview_downgrade(
    db_session: AsyncSession, org_id: int, from_plan: str, to_plan: str = "free"
) -> dict:
    """What moving from ``from_plan`` to ``to_plan`` would change, before it
    happens: features that lock, courses that turn private, members and
    admins over the new limits (kept, but no new ones can be added)."""
    from src.services.orgs.plan_overview import FEATURE_AREAS, _plan_has

    features = [
        key
        for keys in FEATURE_AREAS.values()
        for key in keys
        if _plan_has(from_plan, key) and not _plan_has(to_plan, key)
    ]
    cap = public_course_cap(to_plan)
    ranked = await rank_public_courses(db_session, org_id)
    kept = ranked[:cap] if cap else ranked
    made_private = ranked[cap:] if cap else []

    drip_courses = 0
    if "drip" not in features:
        from src.security.features_utils.plans import FEATURE_PLAN_REQUIREMENTS, PLAN_HIERARCHY

        if PLAN_HIERARCHY.index(to_plan) < PLAN_HIERARCHY.index(FEATURE_PLAN_REQUIREMENTS["drip"]):
            all_courses = (await db_session.execute(select(Course).where(Course.org_id == org_id))).scalars().all()
            drip_courses = sum(1 for c in all_courses if isinstance(c.drip_settings, dict) and c.drip_settings.get("enabled"))
    limits = PLAN_LIMITS.get(to_plan, PLAN_LIMITS["free"])
    members = (
        await db_session.execute(
            select(func.count(UserOrganization.id)).where(UserOrganization.org_id == org_id)
        )
    ).scalar_one()
    admins = (
        await db_session.execute(
            select(func.count(UserOrganization.id)).where(
                UserOrganization.org_id == org_id, UserOrganization.role_id == ADMIN_ROLE_ID
            )
        )
    ).scalar_one()

    def _over(count: int, limit: int) -> dict:
        return {"count": count, "limit": limit, "over": bool(limit) and count > limit}

    return {
        "to_plan": to_plan,
        "features": features,
        "courses": {
            "public": len(ranked),
            "public_cap": cap,
            "kept": _course_ref(kept[0]) if cap and kept else None,
            "made_private": [_course_ref(c) for c in made_private],
            "drip_paused": drip_courses,
        },
        "members": _over(members, limits.get("members", 0)),
        "admins": _over(admins, limits.get("admin_seats", 0)),
    }


def _reindex(course_ids: list[int]) -> None:
    """Search and the AI index carry a course's visibility."""
    if not course_ids:
        return
    try:
        from src.services.ai.rag.queue import index_course

        for course_id in course_ids:
            index_course(course_id)
    except Exception:  # pragma: no cover - indexing is best-effort
        logger.warning("Reindexing courses after a plan change failed", exc_info=True)
