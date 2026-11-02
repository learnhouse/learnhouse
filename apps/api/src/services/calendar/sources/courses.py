"""Course schedule events: drip releases, course updates and certificates.

All three only look at courses the user is in (enrolled or authoring), and
each course is re-checked with course READ before anything from it shows.

- **Drip**: when a scheduled chapter opens for this user, when a limited-time
  chapter closes, and the start date of a cohort (fixed-date) schedule. Dates
  are this user's own: an enrollment-anchored schedule starts at their
  enrollment, and early-access groups see nothing locked.
- **Course updates**: announcements posted to the course, on the day posted.
- **Certificates**: the day the user earned one.
"""

from __future__ import annotations

from sqlmodel import select

from src.db.courses.certifications import CertificateUser, Certifications
from src.db.courses.chapters import Chapter
from src.db.courses.course_updates import CourseUpdate
from src.db.courses.courses import Course
from src.db.courses.drip import DripAnchor, DripLockReason
from src.services.calendar.sources import register_source
from src.services.calendar.sources.common import parse_stored_timestamp, user_course_ids
from src.services.calendar.types import CalendarContext, CalendarEvent, course_ref, iso_utc
from src.services.courses.drip import (
    _ordered_chapters,
    _published_activity_ids,
    chapter_drip_rule,
    course_drip_settings,
    drip_states_for_user,
)


def _course_path(course: Course) -> str:
    return f"/course/{course.course_uuid.removeprefix('course_')}"


async def _readable_courses(ctx: CalendarContext) -> list[Course]:
    ids = await user_course_ids(ctx)
    if not ids:
        return []
    courses = (await ctx.db_session.execute(
        select(Course).where(Course.id.in_(ids), Course.org_id == ctx.org.id)  # type: ignore[union-attr]
    )).scalars().all()
    return [c for c in courses if await ctx.can_read_course(c)]


async def drip_schedule(ctx: CalendarContext) -> list[CalendarEvent]:
    events: list[CalendarEvent] = []
    for course in await _readable_courses(ctx):
        settings = course_drip_settings(course)
        if settings is None:
            continue

        if settings.anchor == DripAnchor.FIXED_DATE and settings.start_date and ctx.overlaps(settings.start_date):
            events.append(CalendarEvent(
                id=f"course_start:{course.course_uuid}",
                type="course_start",
                title=course.name,
                starts_at=iso_utc(settings.start_date),
                url=_course_path(course),
                course=course_ref(course),
                status="upcoming" if settings.start_date > ctx.now else "started",
            ))

        chapters = await _ordered_chapters(course.id, ctx.db_session)
        if not chapters:
            continue
        needs_progress = any(
            (rule := chapter_drip_rule(c.rule)).require_previous or rule.require_chapters for c in chapters
        )
        activity_ids = await _published_activity_ids([c.id for c in chapters], ctx.db_session) if needs_progress else {}
        states = await drip_states_for_user(
            course, settings, chapters, activity_ids, ctx.user_id, ctx.db_session, now=ctx.now
        )
        if not states:
            continue
        names = dict((await ctx.db_session.execute(
            select(Chapter.id, Chapter.name).where(Chapter.id.in_(list(states)))  # type: ignore[union-attr]
        )).all())

        for chapter in chapters:
            state = states.get(chapter.id)
            if state is None:
                continue
            name = names.get(chapter.id) or ""
            meta = {"chapter_uuid": chapter.uuid}
            opens = state.unlock_at if state.locked and state.reason == DripLockReason.SCHEDULE else state.opened_at
            if opens is not None and ctx.overlaps(opens):
                events.append(CalendarEvent(
                    id=f"chapter_open:{chapter.uuid}",
                    type="chapter_release",
                    title=name,
                    starts_at=iso_utc(opens),
                    url=_course_path(course),
                    course=course_ref(course),
                    status="upcoming" if state.locked else "unlocked",
                    meta=meta,
                ))
            if state.closes_at is not None and ctx.overlaps(state.closes_at):
                events.append(CalendarEvent(
                    id=f"chapter_close:{chapter.uuid}",
                    type="chapter_close",
                    title=name,
                    starts_at=iso_utc(state.closes_at),
                    url=_course_path(course),
                    course=course_ref(course),
                    status="closed" if state.locked else "closing",
                    meta=meta,
                ))
    return events


async def course_updates(ctx: CalendarContext) -> list[CalendarEvent]:
    courses = {c.id: c for c in await _readable_courses(ctx)}
    if not courses:
        return []
    rows = (await ctx.db_session.execute(
        select(CourseUpdate).where(
            CourseUpdate.course_id.in_(list(courses)),  # type: ignore[attr-defined]
            CourseUpdate.org_id == ctx.org.id,
        )
    )).scalars().all()
    events = []
    for update in rows:
        posted = parse_stored_timestamp(update.creation_date)
        if posted is None or not ctx.overlaps(posted):
            continue
        course = courses[update.course_id]
        events.append(CalendarEvent(
            id=f"course_update:{update.courseupdate_uuid}",
            type="course_update",
            title=update.title,
            starts_at=iso_utc(posted),
            url=_course_path(course),
            course=course_ref(course),
        ))
    return events


async def certificates_earned(ctx: CalendarContext) -> list[CalendarEvent]:
    rows = (await ctx.db_session.execute(
        select(CertificateUser, Course)
        .join(Certifications, Certifications.id == CertificateUser.certification_id)  # type: ignore[arg-type]
        .join(Course, Course.id == Certifications.course_id)  # type: ignore[arg-type]
        .where(CertificateUser.user_id == ctx.user_id, Course.org_id == ctx.org.id)
    )).all()
    events = []
    for awarded, course in rows:
        earned = parse_stored_timestamp(awarded.created_at)
        if earned is None or not ctx.overlaps(earned):
            continue
        events.append(CalendarEvent(
            id=f"certificate:{awarded.user_certification_uuid}",
            type="certificate",
            title=course.name,
            starts_at=iso_utc(earned),
            url=f"/certificates/{awarded.user_certification_uuid}/verify",
            course=course_ref(course),
            status="earned",
        ))
    return events


register_source(drip_schedule, key="drip")
register_source(course_updates, key="course_updates")
register_source(certificates_earned, key="certificates")
