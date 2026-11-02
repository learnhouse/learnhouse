"""Drip content: release a course's chapters on a schedule.

A course opts in through ``course.drip_settings``; each chapter then carries
its own ``chapter.drip_rule``. Both are JSONB so the schedule can grow new
rule kinds without a migration, and both are validated through the models
below on every write.

Schedules are anchored either on each learner's enrollment (the first time
they start the course) or on one fixed start date shared by a cohort.
"""

from datetime import datetime, timezone
from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, Field, field_validator, model_validator


# Ten years: long enough for any real schedule, short enough that a typo
# (an extra zero) is caught instead of silently hiding a chapter forever.
MAX_DELAY_DAYS = 3650


class DripAnchor(str, Enum):
    ENROLLMENT = "enrollment"  # each learner's clock starts when they enroll
    FIXED_DATE = "fixed_date"  # one start date for everyone (cohorts)


class DripReleaseMode(str, Enum):
    IMMEDIATE = "immediate"  # available as soon as the schedule starts
    DELAY = "delay"          # N days after the schedule starts
    DATE = "date"            # at a fixed date and time


class DripLockReason(str, Enum):
    SCHEDULE = "schedule"      # release time not reached yet
    ENROLLMENT = "enrollment"  # learner has not started the course, so no clock yet
    PREVIOUS = "previous"      # previous chapter not completed yet


def _as_utc(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


class CourseDripSettings(BaseModel):
    enabled: bool = False
    anchor: DripAnchor = DripAnchor.ENROLLMENT
    # Required when anchor is fixed_date.
    start_date: Optional[datetime] = None

    @field_validator("start_date")
    @classmethod
    def _normalize_start(cls, value):
        return _as_utc(value)

    @model_validator(mode="after")
    def _start_date_for_fixed_anchor(self):
        if self.enabled and self.anchor == DripAnchor.FIXED_DATE and self.start_date is None:
            raise ValueError("start_date is required when the schedule starts on a fixed date")
        return self


class ChapterDripRule(BaseModel):
    mode: DripReleaseMode = DripReleaseMode.IMMEDIATE
    delay_days: int = Field(default=0, ge=0, le=MAX_DELAY_DAYS)
    release_at: Optional[datetime] = None
    # Also wait until every published activity of the previous chapter is done.
    require_previous: bool = False

    @field_validator("release_at")
    @classmethod
    def _normalize_release(cls, value):
        return _as_utc(value)

    @model_validator(mode="after")
    def _release_at_for_date_mode(self):
        if self.mode == DripReleaseMode.DATE and self.release_at is None:
            raise ValueError("release_at is required when a chapter is released on a date")
        return self


class ChapterDripRuleUpdate(BaseModel):
    chapter_uuid: str
    rule: ChapterDripRule


class DripScheduleUpdate(BaseModel):
    settings: CourseDripSettings
    # Chapters left out keep their current rule.
    chapters: List[ChapterDripRuleUpdate] = Field(default_factory=list)


class ChapterDripRead(BaseModel):
    chapter_uuid: str
    name: str
    rule: ChapterDripRule


class DripScheduleRead(BaseModel):
    course_uuid: str
    settings: CourseDripSettings
    chapters: List[ChapterDripRead]
