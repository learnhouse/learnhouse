"""The user's calendar: every registered source, merged and sorted."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta

from fastapi import HTTPException, Request
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.organizations import Organization
from src.db.users import AnonymousUser, APITokenUser
from src.services.calendar.sources import registered_sources
from src.services.calendar.types import CalendarContext, CalendarEvent, as_utc

logger = logging.getLogger(__name__)

# A year and a bit: enough for any month grid or agenda, small enough that a
# single request cannot make every source scan the whole history.
MAX_RANGE = timedelta(days=400)
MAX_EVENTS = 2000


def _sort_key(event: CalendarEvent) -> tuple[str, int, str]:
    # Bare dates sort before any instant on the same day (all-day rows lead).
    day = event.starts_at[:10]
    return (day, 0 if event.all_day else 1, event.starts_at + event.title)


async def get_calendar_events(
    request: Request,
    org_id: int,
    start: datetime,
    end: datetime,
    current_user,
    db_session: AsyncSession,
) -> list[CalendarEvent]:
    if current_user is None or isinstance(current_user, (AnonymousUser, APITokenUser)) or not getattr(current_user, "id", None):
        raise HTTPException(status_code=401, detail="Sign in to see your calendar")

    start, end = as_utc(start), as_utc(end)
    if end <= start:
        raise HTTPException(status_code=400, detail="end must be after start")
    if end - start > MAX_RANGE:
        raise HTTPException(status_code=400, detail="The requested range is too long")

    org = (await db_session.execute(select(Organization).where(Organization.id == org_id))).scalars().first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    ctx = CalendarContext(
        request=request,
        db_session=db_session,
        current_user=current_user,
        user_id=current_user.id,
        org=org,
        start=start,
        end=end,
    )

    events: list[CalendarEvent] = []
    seen: set[str] = set()
    for key, source in registered_sources().items():
        try:
            produced = await source(ctx)
        except HTTPException:
            raise
        except Exception:
            # One broken source must not take the whole calendar down.
            logger.exception("Calendar source %s failed", key)
            continue
        for event in produced or []:
            if event.id in seen:
                continue
            seen.add(event.id)
            events.append(event)

    events.sort(key=_sort_key)
    return events[:MAX_EVENTS]
