"""
Personal calendar event service.

Per-user CRUD over ``CalendarEvent``. Events are private to the owning
user — only the owner (or a superadmin) can read or modify them. Events
are not org-scoped: if the user belongs to multiple organizations, the
same calendar follows them across all orgs.
"""

from datetime import datetime
from typing import List, Optional
from uuid import uuid4

from fastapi import HTTPException, Request, status
from sqlmodel import Session, select, or_, and_

from src.db.calendar_events import (
    CalendarEvent,
    CalendarEventCreate,
    CalendarEventRead,
    CalendarEventType,
    CalendarEventUpdate,
)
from src.db.users import AnonymousUser, PublicUser
from src.security.superadmin import is_user_superadmin


def _require_authenticated(current_user: PublicUser | AnonymousUser) -> int:
    """Reject anonymous callers and return the authenticated user id."""
    if isinstance(current_user, AnonymousUser) or current_user.id == 0:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
        )
    return current_user.id


def _user_can_access_event(
    event: CalendarEvent,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
) -> bool:
    """Owner or superadmin may access the event."""
    if isinstance(current_user, AnonymousUser) or current_user.id == 0:
        return False
    if event.user_id == current_user.id:
        return True
    return is_user_superadmin(current_user.id, db_session)


async def create_calendar_event(
    request: Request,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
    event_data: CalendarEventCreate,
) -> CalendarEventRead:
    user_id = _require_authenticated(current_user)

    now = str(datetime.now())
    event = CalendarEvent(
        user_id=user_id,
        event_uuid=f"calevent_{uuid4()}",
        name=event_data.name,
        description=event_data.description,
        start_date=event_data.start_date,
        end_date=event_data.end_date,
        event_type=event_data.event_type,
        color=event_data.color,
        creation_date=now,
        update_date=now,
    )
    db_session.add(event)
    db_session.commit()
    db_session.refresh(event)

    return CalendarEventRead.model_validate(event)


async def list_my_calendar_events(
    request: Request,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    event_type: Optional[CalendarEventType] = None,
) -> List[CalendarEventRead]:
    user_id = _require_authenticated(current_user)

    query = select(CalendarEvent).where(CalendarEvent.user_id == user_id)

    # ``from_date`` matches events that overlap that boundary: either start
    # on/after ``from_date`` or, for multi-day events, end on/after it.
    if from_date is not None:
        query = query.where(
            or_(
                CalendarEvent.start_date >= from_date,
                and_(
                    CalendarEvent.end_date.is_not(None),  # type: ignore[union-attr]
                    CalendarEvent.end_date >= from_date,
                ),
            )
        )
    if to_date is not None:
        query = query.where(CalendarEvent.start_date <= to_date)
    if event_type is not None:
        query = query.where(CalendarEvent.event_type == event_type)

    query = query.order_by(CalendarEvent.start_date.asc())  # type: ignore[attr-defined]
    events = db_session.exec(query).all()
    return [CalendarEventRead.model_validate(e) for e in events]


async def get_calendar_event(
    request: Request,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
    event_uuid: str,
) -> CalendarEventRead:
    event = db_session.exec(
        select(CalendarEvent).where(CalendarEvent.event_uuid == event_uuid)
    ).first()
    if not event:
        raise HTTPException(status_code=404, detail="Calendar event not found")

    if not _user_can_access_event(event, current_user, db_session):
        # SECURITY: don't leak existence to other users — return 404, not 403
        raise HTTPException(status_code=404, detail="Calendar event not found")

    return CalendarEventRead.model_validate(event)


async def update_calendar_event(
    request: Request,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
    event_uuid: str,
    update_data: CalendarEventUpdate,
) -> CalendarEventRead:
    event = db_session.exec(
        select(CalendarEvent).where(CalendarEvent.event_uuid == event_uuid)
    ).first()
    if not event:
        raise HTTPException(status_code=404, detail="Calendar event not found")
    if not _user_can_access_event(event, current_user, db_session):
        raise HTTPException(status_code=404, detail="Calendar event not found")

    changes = update_data.model_dump(exclude_unset=True)
    if not changes:
        return CalendarEventRead.model_validate(event)

    for key, value in changes.items():
        setattr(event, key, value)

    if event.end_date is not None and event.end_date < event.start_date:
        raise HTTPException(
            status_code=400,
            detail="end_date must be on or after start_date",
        )

    event.update_date = str(datetime.now())
    db_session.add(event)
    db_session.commit()
    db_session.refresh(event)
    return CalendarEventRead.model_validate(event)


async def delete_calendar_event(
    request: Request,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
    event_uuid: str,
) -> dict:
    event = db_session.exec(
        select(CalendarEvent).where(CalendarEvent.event_uuid == event_uuid)
    ).first()
    if not event:
        raise HTTPException(status_code=404, detail="Calendar event not found")
    if not _user_can_access_event(event, current_user, db_session):
        raise HTTPException(status_code=404, detail="Calendar event not found")

    db_session.delete(event)
    db_session.commit()
    return {"detail": "Calendar event deleted"}
