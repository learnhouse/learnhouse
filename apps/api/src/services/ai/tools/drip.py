"""Drip schedule tools: read and set when a course's chapters open.

Both wrap the drip service behind the course editor's Schedule tab
(src/services/courses/drip.py), so the rights and the plan check are its own:
reading or editing needs edit rights on the course, and turning drip on
needs the plan that includes it. A partial call keeps what it leaves out
(other chapters' rules, early access groups, required chapters).

Changing the schedule of a published course hides or opens chapters for
learners at once, so it needs a person's approval there. Every change
returns the call that puts the previous schedule back (`undo`).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from fastapi import HTTPException
from pydantic import BaseModel, Field, model_validator

from src.db.courses.drip import (
    MAX_DELAY_DAYS,
    ChapterDripRule,
    ChapterDripRuleUpdate,
    CourseDripSettings,
    DripScheduleRead,
    DripScheduleUpdate,
)
from src.security.rbac import AccessAction
from src.services.ai.tools import refs
from src.services.ai.tools.base import ActionTier, ToolContext, ToolSpec, require_approval
from src.services.ai.tools.chapters import course_ref
from src.services.ai.tools.results import changed
from src.services.courses.drip import get_drip_schedule, update_drip_schedule

MAX_CHAPTERS = 100

_COURSE_UUID = Field(..., min_length=1, max_length=100, description="The course (course_...).")


class GetDripScheduleParams(BaseModel):
    course_uuid: str = _COURSE_UUID


class ChapterRuleIn(BaseModel):
    chapter_uuid: str = Field(..., min_length=1, max_length=100, description="A chapter of the course (chapter_...).")
    mode: Literal["immediate", "delay", "date"] = Field(
        ..., description="immediate: opens when the schedule starts; delay: delay_days later; date: at release_at."
    )
    delay_days: int | None = Field(None, ge=0, le=MAX_DELAY_DAYS, description="Days after the start (mode=delay).")
    release_at: datetime | None = Field(None, description="ISO date and time it opens (mode=date).")
    require_previous: bool | None = Field(
        None, description="Also wait until the learner finished the previous chapter."
    )
    available_days: int | None = Field(
        None, ge=1, le=MAX_DELAY_DAYS, description="Close it again this many days after it opens; omit to keep it open."
    )

    @model_validator(mode="after")
    def _needs(self):
        if self.mode == "delay" and self.delay_days is None:
            raise ValueError("delay_days is required when mode is delay")
        if self.mode == "date" and self.release_at is None:
            raise ValueError("release_at is required when mode is date")
        return self


class SetDripScheduleParams(BaseModel):
    course_uuid: str = _COURSE_UUID
    enabled: bool = Field(..., description="Turn the drip schedule on (true) or off (false).")
    anchor: Literal["enrollment", "fixed_date"] | None = Field(
        None,
        description="enrollment: each learner's clock starts when they enroll (self-paced); "
        "fixed_date: one start date for a cohort (needs start_date).",
    )
    start_date: datetime | None = Field(None, description="Cohort start, ISO date and time (anchor=fixed_date).")
    notify_email: bool | None = Field(None, description="Email learners when a chapter opens for them.")
    chapters: list[ChapterRuleIn] = Field(
        default_factory=list,
        max_length=MAX_CHAPTERS,
        description="Release rules by chapter; chapters left out keep their current rule.",
    )


def _view(schedule: DripScheduleRead) -> dict:
    """The schedule as the agent reads it: settings plus one line per chapter."""
    s = schedule.settings
    return {
        "enabled": s.enabled,
        "anchor": s.anchor.value,
        "start_date": s.start_date.isoformat() if s.start_date else None,
        "notify_email": s.notify_email,
        "early_access_usergroups": len(s.early_access_usergroups),
        "chapters": [
            {
                "chapter_uuid": c.chapter_uuid,
                "name": c.name,
                **c.rule.model_dump(mode="json", exclude_defaults=True),
                "mode": c.rule.mode.value,
            }
            for c in schedule.chapters
        ],
    }


def _undo_args(course_uuid: str, schedule: DripScheduleRead) -> dict:
    s = schedule.settings
    return {
        "course_uuid": course_uuid,
        "enabled": s.enabled,
        "anchor": s.anchor.value,
        "start_date": s.start_date.isoformat() if s.start_date else None,
        "notify_email": s.notify_email,
        "chapters": [
            {
                "chapter_uuid": c.chapter_uuid,
                "mode": c.rule.mode.value,
                "delay_days": c.rule.delay_days,
                "release_at": c.rule.release_at.isoformat() if c.rule.release_at else None,
                "require_previous": c.rule.require_previous,
                "available_days": c.rule.available_days,
            }
            for c in schedule.chapters
        ],
    }


async def _get_drip_schedule(ctx: ToolContext, p: GetDripScheduleParams) -> dict:
    course = await refs.load(ctx, "course", p.course_uuid)
    schedule = await get_drip_schedule(ctx.request, course.course_uuid, ctx.user, ctx.db_session)
    return {"course": await course_ref(ctx, course), **_view(schedule)}


async def _set_drip_schedule(ctx: ToolContext, p: SetDripScheduleParams) -> dict:
    course = await refs.load(ctx, "course", p.course_uuid)
    before = await get_drip_schedule(ctx.request, course.course_uuid, ctx.user, ctx.db_session)
    current = {c.chapter_uuid: c.rule for c in before.chapters}
    unknown = [c.chapter_uuid for c in p.chapters if c.chapter_uuid not in current]
    if unknown:
        raise refs.not_found("chapter", unknown[0])

    settings = before.settings.model_dump()
    settings["enabled"] = p.enabled
    for key in ("anchor", "start_date", "notify_email"):
        value = getattr(p, key)
        if value is not None:
            settings[key] = value
    if p.enabled and settings["anchor"] == "fixed_date" and settings.get("start_date") is None:
        raise HTTPException(status_code=400, detail="A fixed start date needs start_date.")

    rules: list[ChapterDripRuleUpdate] = []
    for item in p.chapters:
        rule = current[item.chapter_uuid].model_dump()
        rule.update(item.model_dump(exclude={"chapter_uuid"}, exclude_none=True))
        if item.mode != "date":
            rule["release_at"] = None
        if item.mode != "delay":
            rule["delay_days"] = 0
        if "available_days" not in item.model_fields_set:
            rule["available_days"] = current[item.chapter_uuid].available_days
        rules.append(ChapterDripRuleUpdate(chapter_uuid=item.chapter_uuid, rule=ChapterDripRule(**rule)))

    if course.published:
        require_approval(ctx, "Learners of this live course see the new release dates at once.")

    after = await update_drip_schedule(
        ctx.request,
        course.course_uuid,
        DripScheduleUpdate(settings=CourseDripSettings(**settings), chapters=rules),
        ctx.user,
        ctx.db_session,
    )
    state = "on" if after.settings.enabled else "off"
    return changed(
        f"Drip schedule of '{course.name}' is {state}; {len(rules)} chapter rule"
        f"{'s' if len(rules) != 1 else ''} updated.",
        course=await course_ref(ctx, course),
        schedule=_view(after),
        undo={"tool": "set_drip_schedule", "args": _undo_args(course.course_uuid, before)},
    )


def _summary(p: SetDripScheduleParams) -> str:
    if not p.enabled:
        return f"Turn off the drip schedule of {p.course_uuid}"
    parts: list[Any] = [f"Turn on the drip schedule of {p.course_uuid}"]
    if p.chapters:
        parts.append(f"with {len(p.chapters)} chapter rule{'s' if len(p.chapters) != 1 else ''}")
    return " ".join(parts)


SPECS: list[ToolSpec] = [
    ToolSpec(
        name="get_drip_schedule",
        description=(
            "Read a course's drip schedule: whether chapters are released over time, what the "
            "clock starts on (each learner's enrollment or a fixed cohort date), and each "
            "chapter's release rule. Needs edit rights on the course."
        ),
        params_model=GetDripScheduleParams,
        tier=ActionTier.READ,
        rights_bucket="courses",
        access_action=AccessAction.UPDATE,
        execute=_get_drip_schedule,
        target_param="course_uuid",
        target_kind="course",
        title="Drip schedule",
        idempotent=True,
    ),
    ToolSpec(
        name="set_drip_schedule",
        description=(
            "Turn a course's drip schedule on or off and set when chapters open: right away, "
            "N days after the start, or on a date, optionally after the previous chapter is "
            "finished or for a limited number of days. Chapters left out keep their rule. Read "
            "get_drip_schedule first. In a published course it needs approval. Returns the "
            "call that restores the previous schedule."
        ),
        params_model=SetDripScheduleParams,
        tier=ActionTier.EDIT,
        rights_bucket="courses",
        access_action=AccessAction.UPDATE,
        execute=_set_drip_schedule,
        target_param="course_uuid",
        target_kind="course",
        approval_in_call=True,
        idempotent=True,
        summarize=_summary,
        title="Set drip schedule",
    ),
]
