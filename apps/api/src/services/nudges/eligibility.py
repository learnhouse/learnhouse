"""
Build one :class:`OrgSnapshot` per organization, cheaply.

The shape that matters here is "a fixed number of grouped queries per batch of
orgs", not "a few queries per org". The existing cross-org billing sweep calls
a per-org summary in a loop, which is fine at its call frequency and would not
be fine here: this runs against every organization, every day.

Orgs are walked by keyset pagination so memory stays flat no matter how many
there are.
"""

import asyncio
import logging
from datetime import datetime, timezone
from typing import AsyncIterator, Optional, Sequence

from sqlalchemy import case, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from src.db.courses.activities import Activity
from src.db.courses.assignments import (
    Assignment,
    AssignmentTask,
    AssignmentTaskSubmission,
)
from src.db.courses.chapters import Chapter
from src.db.courses.courses import Course
from src.db.organization_config import OrganizationConfig
from src.db.organizations import Organization
from src.db.trail_runs import StatusEnum, TrailRun
from src.db.user_activity import UserActivityDay
from src.db.user_organizations import UserOrganization
from src.db.users import User
from src.security.features_utils.usage import _plan_from_config_dict
from src.security.rbac.constants import ADMIN_ROLE_ID
from src.services.nudges.snapshot import AdminRow, OrgSnapshot, parse_ts
from src.services.orgs.orgs import get_org_default_language

logger = logging.getLogger(__name__)

ORG_CHUNK_SIZE = 500


def _rows_by_org(rows) -> dict:
    return {row[0]: row for row in rows}


async def _course_facts(db_session: AsyncSession, org_ids: Sequence[int]) -> dict:
    """Counts and timestamps per org, plus the courses worth deep-linking to."""
    rows = (
        await db_session.execute(
            select(
                Course.org_id,
                func.count().label("course_count"),
                func.sum(case((Course.published.is_(True), 1), else_=0)).label("published"),
                func.sum(case((Course.public.is_(True), 1), else_=0)).label("public"),
                func.max(Course.creation_date).label("last_created"),
                func.max(Course.update_date).label("last_updated"),
                func.min(
                    case((Course.published.is_(True), Course.update_date), else_=None)
                ).label("first_published"),
            )
            .where(Course.org_id.in_(org_ids))
            .group_by(Course.org_id)
        )
    ).all()
    facts = _rows_by_org(rows)

    # The newest course, and the oldest still-unpublished one — nudges link to
    # a specific course by name, never to a generic list.
    newest: dict[int, tuple[str, str]] = {}
    drafts: dict[int, tuple[str, str]] = {}
    detail_rows = (
        await db_session.execute(
            select(
                Course.org_id,
                Course.course_uuid,
                Course.name,
                Course.published,
                Course.creation_date,
            )
            .where(Course.org_id.in_(org_ids))
            .order_by(Course.org_id, Course.creation_date)
        )
    ).all()
    for org_id, uuid, name, published, _created in detail_rows:
        newest[org_id] = (uuid, name)  # ordered ascending, so the last wins
        if not published and org_id not in drafts:
            drafts[org_id] = (uuid, name)

    return {"agg": facts, "newest": newest, "drafts": drafts}


async def _membership_facts(db_session: AsyncSession, org_ids: Sequence[int]) -> dict:
    """Admin and member counts in a single pass, split by role."""
    non_admin = UserOrganization.role_id != ADMIN_ROLE_ID
    rows = (
        await db_session.execute(
            select(
                UserOrganization.org_id,
                func.sum(
                    case((UserOrganization.role_id == ADMIN_ROLE_ID, 1), else_=0)
                ).label("admin_count"),
                func.sum(case((non_admin, 1), else_=0)).label("member_count"),
                func.min(
                    case((non_admin, UserOrganization.creation_date), else_=None)
                ).label("first_member"),
                func.max(
                    case((non_admin, UserOrganization.creation_date), else_=None)
                ).label("last_member"),
            )
            .where(UserOrganization.org_id.in_(org_ids))
            .group_by(UserOrganization.org_id)
        )
    ).all()
    return _rows_by_org(rows)


async def _admin_rows(db_session: AsyncSession, org_ids: Sequence[int]) -> dict:
    """Every org admin, with the fields needed to address and gate an email."""
    rows = (
        await db_session.execute(
            select(
                UserOrganization.org_id,
                User.id,
                User.user_uuid,
                User.email,
                User.first_name,
                User.username,
                User.email_verified,
                User.last_login_at,
            )
            .join(User, User.id == UserOrganization.user_id)
            .where(
                UserOrganization.org_id.in_(org_ids),
                UserOrganization.role_id == ADMIN_ROLE_ID,
            )
        )
    ).all()

    by_org: dict[int, list[AdminRow]] = {}
    for org_id, uid, uuid, email, first, username, verified, last_login in rows:
        by_org.setdefault(org_id, []).append(
            AdminRow(
                user_id=uid,
                user_uuid=uuid or "",
                email=str(email or ""),
                first_name=first,
                username=username,
                email_verified=bool(verified),
                last_login_at=parse_ts(last_login),
            )
        )
    return by_org


async def _simple_count_facts(db_session: AsyncSession, org_ids: Sequence[int]) -> dict:
    """Chapters, activities and trail runs — three small grouped queries."""
    chapters = _rows_by_org(
        (
            await db_session.execute(
                select(
                    Chapter.org_id,
                    func.count().label("n"),
                    func.max(Chapter.creation_date).label("last_created"),
                )
                .where(Chapter.org_id.in_(org_ids))
                .group_by(Chapter.org_id)
            )
        ).all()
    )

    activities = _rows_by_org(
        (
            await db_session.execute(
                select(
                    Activity.org_id,
                    func.count().label("n"),
                    func.sum(case((Activity.published.is_(True), 1), else_=0)).label("published"),
                    func.max(Activity.creation_date).label("last_created"),
                )
                .where(Activity.org_id.in_(org_ids))
                .group_by(Activity.org_id)
            )
        ).all()
    )

    trailruns = _rows_by_org(
        (
            await db_session.execute(
                select(
                    TrailRun.org_id,
                    func.count().label("n"),
                    func.count(func.distinct(TrailRun.user_id)).label("learners"),
                    func.sum(
                        case((TrailRun.status == StatusEnum.STATUS_IN_PROGRESS, 1), else_=0)
                    ).label("in_progress"),
                    func.sum(
                        case((TrailRun.status == StatusEnum.STATUS_COMPLETED, 1), else_=0)
                    ).label("completed"),
                    func.min(TrailRun.creation_date).label("first"),
                    func.max(TrailRun.update_date).label("last_updated"),
                    func.min(
                        case(
                            (
                                TrailRun.status == StatusEnum.STATUS_COMPLETED,
                                TrailRun.update_date,
                            ),
                            else_=None,
                        )
                    ).label("first_completed"),
                )
                .where(TrailRun.org_id.in_(org_ids))
                .group_by(TrailRun.org_id)
            )
        ).all()
    )

    return {"chapters": chapters, "activities": activities, "trailruns": trailruns}


async def _assignment_facts(db_session: AsyncSession, org_ids: Sequence[int]) -> dict:
    """Assignments per org, and how many submissions they have attracted.

    Submissions carry no ``org_id`` of their own, so they are counted through
    ``AssignmentTask``, which does.
    """
    assignments = _rows_by_org(
        (
            await db_session.execute(
                select(
                    Assignment.org_id,
                    func.count().label("n"),
                    func.max(Assignment.creation_date).label("last_created"),
                )
                .where(Assignment.org_id.in_(org_ids))
                .group_by(Assignment.org_id)
            )
        ).all()
    )

    submissions = _rows_by_org(
        (
            await db_session.execute(
                select(AssignmentTask.org_id, func.count().label("n"))
                .join(
                    AssignmentTaskSubmission,
                    AssignmentTaskSubmission.assignment_task_id == AssignmentTask.id,
                )
                .where(AssignmentTask.org_id.in_(org_ids))
                .group_by(AssignmentTask.org_id)
            )
        ).all()
    )

    return {"assignments": assignments, "submissions": submissions}


async def _ai_credit_usage(org_ids: Sequence[int]) -> dict[int, int]:
    """Credits consumed per org, read from Redis in one round trip.

    Deliberately degrades to "no usage recorded" when Redis is unavailable:
    the credit nudge then simply never fires, which is the right failure for a
    background job that must not depend on a cache being up.
    """
    try:
        from src.core.redis import get_redis_client

        client = get_redis_client()
        if client is None:
            return {}

        keys = [f"ai_credits_used:{org_id}" for org_id in org_ids]
        values = await asyncio.to_thread(client.mget, keys)
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("AI credit usage unavailable for this nudge run: %s", exc)
        return {}

    usage: dict[int, int] = {}
    for org_id, raw in zip(org_ids, values or []):
        try:
            usage[org_id] = int(raw) if raw else 0
        except (TypeError, ValueError):
            usage[org_id] = 0
    return usage


async def _activity_day_facts(db_session: AsyncSession, org_ids: Sequence[int]) -> dict:
    """Newest recorded activity day per org.

    The best freshness signal we have, and absent for most orgs — the table is
    SaaS-gated and only recently populated, so it refines ``last_touch`` rather
    than defining it.
    """
    rows = (
        await db_session.execute(
            select(
                UserActivityDay.org_id,
                func.max(UserActivityDay.activity_date).label("last_day"),
            )
            .where(UserActivityDay.org_id.in_(org_ids))
            .group_by(UserActivityDay.org_id)
        )
    ).all()
    return _rows_by_org(rows)


async def _first_nudge_facts(db_session: AsyncSession, org_ids: Sequence[int]) -> dict:
    """When each org first received a nudge.

    The reactivation ladder measures from this instead of from last activity —
    a long-dormant org's last-touch figure never moves, so nothing anchored on
    it can advance through a sequence.
    """
    from src.db.nudges import NudgeSend, NudgeSendStatus

    rows = (
        await db_session.execute(
            select(NudgeSend.org_id, func.min(NudgeSend.sent_at).label("first_sent"))
            .where(
                NudgeSend.org_id.in_(org_ids),
                NudgeSend.status == NudgeSendStatus.SENT,
                NudgeSend.sent_at.is_not(None),
            )
            .group_by(NudgeSend.org_id)
        )
    ).all()
    return _rows_by_org(rows)


async def _config_facts(db_session: AsyncSession, org_ids: Sequence[int]) -> dict:
    rows = (
        await db_session.execute(
            select(OrganizationConfig).where(OrganizationConfig.org_id.in_(org_ids))
        )
    ).scalars().all()
    return {c.org_id: c for c in rows}


async def _admin_login_facts(db_session: AsyncSession, org_ids: Sequence[int]) -> dict:
    rows = (
        await db_session.execute(
            select(
                UserOrganization.org_id,
                func.max(User.last_login_at).label("last_login"),
            )
            .join(User, User.id == UserOrganization.user_id)
            .where(
                UserOrganization.org_id.in_(org_ids),
                UserOrganization.role_id == ADMIN_ROLE_ID,
            )
            .group_by(UserOrganization.org_id)
        )
    ).all()
    return _rows_by_org(rows)


def _org_is_active(config: Optional[OrganizationConfig]) -> bool:
    """v2 configs can mark an org inactive; absent means active."""
    if config is None or not config.config:
        return True
    value = config.config.get("active")
    return True if value is None else bool(value)


async def build_snapshots(
    db_session: AsyncSession,
    orgs: Sequence[Organization],
    now: Optional[datetime] = None,
) -> list[OrgSnapshot]:
    """Assemble snapshots for one batch of orgs using grouped queries only."""
    if not orgs:
        return []

    now = now or datetime.now(timezone.utc)
    org_ids = [o.id for o in orgs if o.id is not None]
    if not org_ids:
        return []

    courses = await _course_facts(db_session, org_ids)
    memberships = await _membership_facts(db_session, org_ids)
    admins = await _admin_rows(db_session, org_ids)
    counts = await _simple_count_facts(db_session, org_ids)
    assignments = await _assignment_facts(db_session, org_ids)
    activity_days = await _activity_day_facts(db_session, org_ids)
    configs = await _config_facts(db_session, org_ids)
    admin_logins = await _admin_login_facts(db_session, org_ids)
    first_nudges = await _first_nudge_facts(db_session, org_ids)
    ai_usage = await _ai_credit_usage(org_ids)

    snapshots: list[OrgSnapshot] = []
    for org in orgs:
        oid = org.id
        course_agg = courses["agg"].get(oid)
        member_agg = memberships.get(oid)
        chapter_agg = counts["chapters"].get(oid)
        activity_agg = counts["activities"].get(oid)
        trail_agg = counts["trailruns"].get(oid)
        config = configs.get(oid)
        newest = courses["newest"].get(oid)
        draft = courses["drafts"].get(oid)
        login_agg = admin_logins.get(oid)
        day_agg = activity_days.get(oid)
        first_nudge_agg = first_nudges.get(oid)
        assignment_agg = assignments["assignments"].get(oid)
        submission_agg = assignments["submissions"].get(oid)

        snapshots.append(
            OrgSnapshot(
                org_id=oid,
                org_slug=org.slug,
                org_name=org.name,
                org_uuid=org.org_uuid,
                logo_image=getattr(org, "logo_image", None),
                plan=_plan_from_config_dict(config.config if config else {}),
                lang=get_org_default_language(config),
                org_active_flag=_org_is_active(config),
                created_at=parse_ts(org.creation_date),
                org_updated_at=parse_ts(org.update_date),
                member_count=int(member_agg[2] or 0) if member_agg else 0,
                admin_count=int(member_agg[1] or 0) if member_agg else 0,
                first_member_joined_at=parse_ts(member_agg[3]) if member_agg else None,
                last_member_joined_at=parse_ts(member_agg[4]) if member_agg else None,
                course_count=int(course_agg[1] or 0) if course_agg else 0,
                published_course_count=int(course_agg[2] or 0) if course_agg else 0,
                public_course_count=int(course_agg[3] or 0) if course_agg else 0,
                last_course_created_at=parse_ts(course_agg[4]) if course_agg else None,
                last_course_updated_at=parse_ts(course_agg[5]) if course_agg else None,
                first_published_at=parse_ts(course_agg[6]) if course_agg else None,
                newest_course_uuid=newest[0] if newest else None,
                newest_course_name=newest[1] if newest else None,
                oldest_draft_course_uuid=draft[0] if draft else None,
                oldest_draft_course_name=draft[1] if draft else None,
                chapter_count=int(chapter_agg[1] or 0) if chapter_agg else 0,
                last_chapter_created_at=parse_ts(chapter_agg[2]) if chapter_agg else None,
                activity_count=int(activity_agg[1] or 0) if activity_agg else 0,
                published_activity_count=int(activity_agg[2] or 0) if activity_agg else 0,
                last_activity_created_at=parse_ts(activity_agg[3]) if activity_agg else None,
                trailrun_count=int(trail_agg[1] or 0) if trail_agg else 0,
                learner_count=int(trail_agg[2] or 0) if trail_agg else 0,
                in_progress_trailrun_count=int(trail_agg[3] or 0) if trail_agg else 0,
                completed_trailrun_count=int(trail_agg[4] or 0) if trail_agg else 0,
                first_trailrun_at=parse_ts(trail_agg[5]) if trail_agg else None,
                last_trailrun_updated_at=parse_ts(trail_agg[6]) if trail_agg else None,
                first_completed_trailrun_at=(
                    parse_ts(trail_agg[7]) if trail_agg else None
                ),
                assignment_count=int(assignment_agg[1] or 0) if assignment_agg else 0,
                last_assignment_created_at=(
                    parse_ts(assignment_agg[2]) if assignment_agg else None
                ),
                assignment_submission_count=(
                    int(submission_agg[1] or 0) if submission_agg else 0
                ),
                ai_credits_used=ai_usage.get(oid, 0),
                last_admin_login_at=parse_ts(login_agg[1]) if login_agg else None,
                last_activity_day=parse_ts(day_agg[1]) if day_agg else None,
                first_nudged_at=(
                    parse_ts(first_nudge_agg[1]) if first_nudge_agg else None
                ),
                admins=tuple(admins.get(oid, ())),
                now=now,
            )
        )
    return snapshots


async def iter_snapshots(
    db_session: AsyncSession,
    now: Optional[datetime] = None,
    org_id: Optional[int] = None,
    chunk_size: int = ORG_CHUNK_SIZE,
) -> AsyncIterator[OrgSnapshot]:
    """Yield a snapshot for every org, a batch at a time.

    Keyset pagination on the primary key rather than OFFSET: the scan holds one
    chunk in memory regardless of how many organizations exist.
    """
    cursor = 0
    while True:
        query = select(Organization).order_by(Organization.id).limit(chunk_size)
        if org_id is not None:
            query = query.where(Organization.id == org_id)
        else:
            query = query.where(Organization.id > cursor)

        orgs = (await db_session.execute(query)).scalars().all()
        if not orgs:
            return

        # Read the cursor before yielding. The consumer commits between
        # snapshots, which expires these instances; touching one afterwards
        # triggers a lazy refresh from inside the generator and blows up in
        # async context.
        next_cursor = orgs[-1].id
        snapshots = await build_snapshots(db_session, orgs, now=now)

        for snapshot in snapshots:
            yield snapshot

        if org_id is not None:
            return
        cursor = next_cursor
