"""Email learners when a scheduled chapter opens for them.

Opt-in per course (``drip_settings.notify_email``). The scheduler runs this
every hour; for each enrolled learner it looks for chapters on a time rule
(a delay or a date) that opened within the last ``NOTIFY_WINDOW``, and sends
one email per learner and course naming them.

The window keeps a course that turns notifications on late from mailing
everyone about chapters that opened weeks ago. Chapters that open because a
prerequisite was completed are not announced: the learner just did that.

Each (chapter, learner) pair is recorded in ``drip_notification`` before the
email is sent, so retries and parallel replicas never send twice.
"""

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlalchemy.exc import IntegrityError
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.chapters import Chapter
from src.db.courses.courses import Course
from src.db.courses.drip import DripReleaseMode
from src.db.courses.drip_notifications import DripNotification
from src.db.organization_config import OrganizationConfig
from src.db.organizations import Organization
from src.db.trail_runs import TrailRun
from src.db.users import User
from src.services.courses.drip import (
    _ordered_chapters,
    _published_activity_ids,
    chapter_drip_rule,
    course_drip_settings,
    drip_states_for_user,
)

logger = logging.getLogger(__name__)

NOTIFY_WINDOW = timedelta(days=2)


@dataclass
class DripNotifyStats:
    courses: int = 0
    emails: int = 0
    chapters: int = 0
    failed: int = 0


def _timed(raw_rule: Optional[dict]) -> bool:
    rule = chapter_drip_rule(raw_rule)
    return rule.mode == DripReleaseMode.DATE or (rule.mode == DripReleaseMode.DELAY and rule.delay_days > 0)


async def _claim(db_session: AsyncSession, course: Course, user_id: int, chapter_ids: list[int], now: datetime) -> bool:
    for chapter_id in chapter_ids:
        db_session.add(DripNotification(
            chapter_id=chapter_id, user_id=user_id, course_id=course.id, org_id=course.org_id,
            sent_at=now.isoformat(),
        ))
    try:
        await db_session.commit()
        return True
    except IntegrityError:
        await db_session.rollback()
        return False


async def run_drip_notifications(db_session: AsyncSession, now: Optional[datetime] = None) -> DripNotifyStats:
    now = now or datetime.now(timezone.utc)
    stats = DripNotifyStats()

    candidates = (await db_session.execute(
        select(Course).where(Course.drip_settings.is_not(None))  # type: ignore[union-attr]
    )).scalars().all()

    for course in candidates:
        settings = course_drip_settings(course)
        if settings is None or not settings.notify_email:
            continue
        chapters = await _ordered_chapters(course.id, db_session)
        timed = {c.id for c in chapters if _timed(c.rule)}
        if not timed:
            continue
        stats.courses += 1

        names = dict((await db_session.execute(
            select(Chapter.id, Chapter.name).where(Chapter.id.in_(timed))  # type: ignore[attr-defined]
        )).all())
        activity_ids = await _published_activity_ids([c.id for c in chapters], db_session)
        already = set((await db_session.execute(
            select(DripNotification.chapter_id, DripNotification.user_id).where(DripNotification.course_id == course.id)
        )).all())
        # Not SELECT DISTINCT on user rows: Postgres can't compare their JSON columns.
        learners = (await db_session.execute(
            select(User).where(User.id.in_(  # type: ignore[union-attr]
                select(TrailRun.user_id).where(TrailRun.course_id == course.id)
            ))
        )).scalars().all()
        if not learners:
            continue

        org = await db_session.get(Organization, course.org_id)
        org_config = (await db_session.execute(
            select(OrganizationConfig).where(OrganizationConfig.org_id == course.org_id)
        )).scalars().first()

        # Imported here: these pull in org services that import course modules.
        from src.services.email.branding import resolve_org_email_branding
        from src.services.nudges.links import org_base_url, public_course_url
        from src.services.users.emails import send_drip_unlocked_email

        branding = resolve_org_email_branding(org, org_config, None)
        cta_url = public_course_url(await org_base_url(org.slug, db_session, org.id), course.course_uuid)

        for learner in learners:
            states = await drip_states_for_user(course, settings, chapters, activity_ids, learner.id, db_session, now)
            opened = [
                c.id for c in chapters
                if c.id in timed
                and (c.id, learner.id) not in already
                and (state := states.get(c.id)) is not None
                and not state.locked
                and state.opened_at is not None
                and now - NOTIFY_WINDOW < state.opened_at <= now
            ]
            if not opened or not await _claim(db_session, course, learner.id, opened, now):
                continue
            try:
                send_drip_unlocked_email(
                    email=learner.email,
                    username=learner.username,
                    course_name=course.name,
                    chapter_names=[names[cid] for cid in opened],
                    cta_url=cta_url,
                    org_name=branding.org_name,
                    **branding.as_kwargs(),
                )
                stats.emails += 1
                stats.chapters += len(opened)
            except Exception:
                stats.failed += 1
                logger.warning("Drip email failed for user %s, course %s", learner.id, course.id, exc_info=True)
    return stats
