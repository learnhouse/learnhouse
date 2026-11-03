"""Helpers shared by the course-based calendar sources."""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlmodel import select

from src.db.courses.courses import Course
from src.db.resource_authors import ResourceAuthor, ResourceAuthorshipStatusEnum
from src.db.trail_runs import TrailRun
from src.services.calendar.types import CalendarContext, as_utc


async def user_course_ids(ctx: CalendarContext) -> set[int]:
    """Courses the user is in: enrolled (a trail run) or an active author.

    A public course the user never started is not on their calendar. Callers
    still re-check course READ, since an enrollment can outlive access.
    """
    db = ctx.db_session
    enrolled = (await db.execute(
        select(TrailRun.course_id).where(TrailRun.user_id == ctx.user_id, TrailRun.org_id == ctx.org.id)
    )).scalars().all()
    authored_uuids = (await db.execute(
        select(ResourceAuthor.resource_uuid).where(
            ResourceAuthor.user_id == ctx.user_id,
            ResourceAuthor.authorship_status == ResourceAuthorshipStatusEnum.ACTIVE,
        )
    )).scalars().all()
    ids = set(enrolled)
    course_uuids = [u for u in authored_uuids if u and u.startswith("course_")]
    if course_uuids:
        ids |= set((await db.execute(
            select(Course.id).where(Course.course_uuid.in_(course_uuids), Course.org_id == ctx.org.id)  # type: ignore[union-attr]
        )).scalars().all())
    return ids


def parse_stored_timestamp(value: Optional[str]) -> Optional[datetime]:
    """The ``creation_date``-style strings models store (``str(datetime.now())``
    or ISO 8601), as aware UTC. Naive values are read as UTC like the rest of
    the API; unparseable ones are None."""
    if not value:
        return None
    try:
        return as_utc(datetime.fromisoformat(value.strip().replace("Z", "+00:00")))
    except ValueError:
        return None
