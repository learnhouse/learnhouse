"""
Calendar router — per-user personal calendar events.

All endpoints operate on the authenticated user's own events. Owner is
always derived from the session, never accepted from the client, so
there is no path to read or modify another user's calendar.
"""

from typing import List, Optional

from fastapi import APIRouter, Depends, Query, Request
from sqlmodel import Session

from src.core.events.database import get_db_session
from src.db.calendar_events import (
    CalendarEventCreate,
    CalendarEventRead,
    CalendarEventType,
    CalendarEventUpdate,
)
from src.db.users import PublicUser
from src.security.auth import get_current_user
from src.services.calendar.events import (
    create_calendar_event,
    delete_calendar_event,
    get_calendar_event,
    list_my_calendar_events,
    update_calendar_event,
)


router = APIRouter()


@router.post(
    "/me/events",
    response_model=CalendarEventRead,
    summary="Create a calendar event for the current user",
    description=(
        "Create a personal calendar event. The owner is always the calling "
        "user — there is no path to create an event on someone else's "
        "calendar. Returns 401 for anonymous callers."
    ),
    responses={
        200: {"description": "Event created", "model": CalendarEventRead},
        401: {"description": "Authentication required"},
        422: {"description": "Validation error (e.g. end_date before start_date)"},
    },
)
async def api_create_my_calendar_event(
    request: Request,
    event_data: CalendarEventCreate,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> CalendarEventRead:
    return await create_calendar_event(request, db_session, current_user, event_data)


@router.get(
    "/me/events",
    response_model=List[CalendarEventRead],
    summary="List the current user's calendar events",
    description=(
        "List the caller's events ordered by start_date ascending. Use "
        "`from_date` and `to_date` (ISO-8601) to scope to a window — "
        "multi-day events that overlap the window are included. "
        "`event_type` filters by category."
    ),
    responses={
        200: {"description": "Events for the current user", "model": List[CalendarEventRead]},
        401: {"description": "Authentication required"},
    },
)
async def api_list_my_calendar_events(
    request: Request,
    from_date: Optional[str] = Query(
        None, description="ISO-8601 lower bound (events on/after this date)"
    ),
    to_date: Optional[str] = Query(
        None, description="ISO-8601 upper bound (events starting on/before this date)"
    ),
    event_type: Optional[CalendarEventType] = Query(
        None, description="Filter by event_type"
    ),
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> List[CalendarEventRead]:
    return await list_my_calendar_events(
        request, db_session, current_user, from_date, to_date, event_type,
    )


@router.get(
    "/me/events/{event_uuid}",
    response_model=CalendarEventRead,
    summary="Get a single calendar event of the current user",
    description=(
        "Read a single event from the caller's calendar. Returns 404 if "
        "the event doesn't exist or belongs to another user (existence is "
        "intentionally not leaked across users)."
    ),
    responses={
        200: {"description": "Event", "model": CalendarEventRead},
        401: {"description": "Authentication required"},
        404: {"description": "Event not found (or owned by another user)"},
    },
)
async def api_get_my_calendar_event(
    request: Request,
    event_uuid: str,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> CalendarEventRead:
    return await get_calendar_event(request, db_session, current_user, event_uuid)


@router.put(
    "/me/events/{event_uuid}",
    response_model=CalendarEventRead,
    summary="Update one of the current user's calendar events",
    description=(
        "Partial update — only fields explicitly set on the request body "
        "are applied. Returns 404 if the event isn't owned by the caller."
    ),
    responses={
        200: {"description": "Updated event", "model": CalendarEventRead},
        400: {"description": "Validation error (e.g. end_date before start_date)"},
        401: {"description": "Authentication required"},
        404: {"description": "Event not found (or owned by another user)"},
    },
)
async def api_update_my_calendar_event(
    request: Request,
    event_uuid: str,
    update_data: CalendarEventUpdate,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> CalendarEventRead:
    return await update_calendar_event(
        request, db_session, current_user, event_uuid, update_data,
    )


@router.delete(
    "/me/events/{event_uuid}",
    summary="Delete one of the current user's calendar events",
    description="Permanently delete an event owned by the caller.",
    responses={
        200: {"description": "Event deleted"},
        401: {"description": "Authentication required"},
        404: {"description": "Event not found (or owned by another user)"},
    },
)
async def api_delete_my_calendar_event(
    request: Request,
    event_uuid: str,
    db_session: Session = Depends(get_db_session),
    current_user: PublicUser = Depends(get_current_user),
) -> dict:
    return await delete_calendar_event(request, db_session, current_user, event_uuid)
