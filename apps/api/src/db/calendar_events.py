"""
Personal calendar events.

A simple per-user calendar primitive that any LearnHouse user can fill in
with their own events: study reminders, meetings, deadlines, personal
milestones, etc. Each event belongs to a single user; events are private
to that user (only the owner can read or modify them).

Recurrence, reminders/notifications, sharing, and aggregation with
course due dates or org-level events are deliberately out of scope for
the first iteration — the simplest useful primitive is a flat list of
``(user, name, start, end?, type)`` tuples that the owner curates.
"""
from enum import Enum
from typing import Optional

from pydantic import field_validator
from sqlalchemy import Column, ForeignKey, Index, Integer
from sqlmodel import Field, SQLModel


class CalendarEventType(str, Enum):
    """Coarse categorization to help the UI render colours / icons."""
    REMINDER = "reminder"   # study reminder, todo
    MEETING = "meeting"     # 1:1, group call
    DEADLINE = "deadline"   # external deadline tracked on the calendar
    PERSONAL = "personal"   # personal time block, holiday, travel
    OTHER = "other"


class CalendarEventBase(SQLModel):
    name: str
    description: Optional[str] = None
    # ISO-8601 date or datetime strings. Stored as strings to match the
    # convention used by the rest of the codebase (creation_date /
    # update_date are also strings) and to keep the migration trivial.
    start_date: str
    end_date: Optional[str] = None
    event_type: CalendarEventType = Field(default=CalendarEventType.OTHER)
    color: Optional[str] = None  # optional hex like "#ff8800"


class CalendarEvent(CalendarEventBase, table=True):
    __tablename__ = "user_calendar_event"
    __table_args__ = (
        Index("ix_user_calendar_event_user_start", "user_id", "start_date"),
    )
    id: Optional[int] = Field(default=None, primary_key=True)
    event_uuid: str = Field(default="", index=True)
    user_id: int = Field(
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="CASCADE"), index=True)
    )
    creation_date: str = ""
    update_date: str = ""


class CalendarEventCreate(CalendarEventBase):
    """Owner is always the calling user — never accepted from the client."""

    @field_validator("end_date")
    @classmethod
    def _end_after_start(cls, v: Optional[str], info):
        if v is None:
            return v
        start = info.data.get("start_date")
        if start and v < start:
            raise ValueError("end_date must be on or after start_date")
        return v


class CalendarEventUpdate(SQLModel):
    """Partial update — only fields that are explicitly set are applied."""
    name: Optional[str] = None
    description: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    event_type: Optional[CalendarEventType] = None
    color: Optional[str] = None


class CalendarEventRead(CalendarEventBase):
    id: int
    event_uuid: str
    user_id: int
    creation_date: str
    update_date: str
