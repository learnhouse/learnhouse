"""Shapes shared by the calendar service and its sources."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Optional

from fastapi import Request
from pydantic import BaseModel, Field
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.courses import Course
from src.db.organization_config import OrganizationConfig
from src.db.organizations import Organization
from src.security.features_utils.resolve import resolve_feature
from src.security.rbac import AccessAction, check_resource_access


class CalendarCourseRef(BaseModel):
    course_uuid: str
    name: str


class CalendarEvent(BaseModel):
    """One dated thing on the user's calendar.

    ``starts_at`` is an ISO 8601 UTC datetime, or a bare ``YYYY-MM-DD`` when
    ``all_day`` is set: an all-day event belongs to a calendar date, not to an
    instant, so the client places it on that date in whatever zone it is in.
    """

    id: str
    type: str
    title: str
    starts_at: str
    ends_at: Optional[str] = None
    all_day: bool = False
    # Org-relative frontend path, e.g. ``/course/abc/activity/def``.
    url: Optional[str] = None
    course: Optional[CalendarCourseRef] = None
    status: Optional[str] = None
    meta: dict[str, Any] = Field(default_factory=dict)


def as_utc(value: datetime) -> datetime:
    """Aware UTC datetime. Naive values are read as UTC (how the API stores them)."""
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def iso_utc(value: datetime) -> str:
    return as_utc(value).isoformat().replace("+00:00", "Z")


@dataclass
class CalendarContext:
    """Everything a source needs to answer for one user and one window.

    ``start``/``end`` are aware UTC datetimes, ``end`` exclusive. Course access
    decisions are memoized so several sources asking about the same course do
    not repeat the RBAC queries.
    """

    request: Request
    db_session: AsyncSession
    current_user: Any
    user_id: int
    org: Organization
    start: datetime
    end: datetime
    # One clock for every source in a request, so "upcoming" and "open" agree.
    now: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    _config: dict = field(default_factory=dict)
    _features: Optional[dict[str, bool]] = None
    _course_read: dict[str, bool] = field(default_factory=dict)
    _course_edit: dict[str, bool] = field(default_factory=dict)
    # The user's course ids, shared by every course-based source.
    _user_course_ids: Optional[set[int]] = None

    def overlaps(self, starts_at: datetime, ends_at: Optional[datetime] = None) -> bool:
        starts_at = as_utc(starts_at)
        ends_at = as_utc(ends_at) if ends_at else starts_at
        if ends_at == starts_at:
            return self.start <= starts_at < self.end
        return starts_at < self.end and ends_at > self.start

    def overlaps_day(self, day: date) -> bool:
        """Whether a calendar date touches the window. The UTC day is used, so
        a client asking for its local month should pad the window by a day."""
        day_start = datetime.combine(day, time.min, tzinfo=timezone.utc)
        return day_start < self.end and day_start + timedelta(days=1) > self.start

    async def feature_enabled(self, feature: str) -> bool:
        """Whether the org has ``feature`` on (plan, admin toggle, edition)."""
        if self._features is None:
            row = (await self.db_session.execute(
                select(OrganizationConfig).where(OrganizationConfig.org_id == self.org.id)
            )).scalars().first()
            self._config = (row.config if row else None) or {}
            self._features = {}
        if feature not in self._features:
            self._features[feature] = bool(resolve_feature(feature, self._config, self.org.id).get("enabled"))
        return self._features[feature]

    async def can_read_course(self, course: Course) -> bool:
        if course.org_id != self.org.id:
            return False
        key = course.course_uuid
        if key not in self._course_read:
            decision = await check_resource_access(
                self.request, self.db_session, self.current_user, key, AccessAction.READ, raise_on_deny=False
            )
            self._course_read[key] = bool(decision.allowed)
        return self._course_read[key]

    async def can_edit_course(self, course: Course) -> bool:
        if course.org_id != self.org.id:
            return False
        key = course.course_uuid
        if key not in self._course_edit:
            decision = await check_resource_access(
                self.request, self.db_session, self.current_user, key, AccessAction.UPDATE, raise_on_deny=False
            )
            self._course_edit[key] = bool(decision.allowed)
        return self._course_edit[key]


def course_ref(course: Optional[Course]) -> Optional[CalendarCourseRef]:
    if course is None:
        return None
    return CalendarCourseRef(course_uuid=course.course_uuid, name=course.name)
