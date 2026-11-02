"""Assignment due dates.

Only courses the user is enrolled in (a trail run) or authors are considered:
an assignment in a public course the user never started is not something they
have to act on. Each of those courses is then re-checked with course READ, and
for learners every assignment goes through the same gate as the assignment
read itself (published, activity draft/paywall/locks).
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from fastapi import HTTPException
from sqlmodel import select

from src.db.courses.activities import Activity
from src.db.courses.assignments import (
    Assignment,
    AssignmentUserSubmission,
    AssignmentUserSubmissionStatus,
)
from src.db.courses.courses import Course
from src.services.calendar.sources import register_source
from src.services.calendar.sources.common import user_course_ids
from src.services.calendar.types import (
    CalendarContext,
    CalendarEvent,
    as_utc,
    course_ref,
    iso_utc,
)
from src.services.courses.activities.access import verify_activity_reader_access
from src.services.courses.activities.assignments import _is_assignment_past_due


def parse_due_date(raw: Optional[str]) -> tuple[Optional[date | datetime], bool]:
    """``(value, all_day)`` for a stored ``due_date``.

    A bare date (what the editor's ``<input type="date">`` stores) is an
    all-day deadline. Anything with a time is an instant; naive values are
    read as UTC. Empty or unparseable values mean "no deadline", the same as
    every deadline check in the assignments service.
    """
    if not raw or not str(raw).strip():
        return None, False
    text = str(raw).strip()
    if "T" not in text and ":" not in text:
        try:
            return date.fromisoformat(text[:10]), True
        except ValueError:
            return None, False
    try:
        return as_utc(datetime.fromisoformat(text.replace("Z", "+00:00"))), False
    except ValueError:
        return None, False


def _learner_status(assignment: Assignment, submission: Optional[AssignmentUserSubmission]) -> str:
    if submission is not None:
        s = submission.submission_status
        if s == AssignmentUserSubmissionStatus.GRADED:
            return "graded"
        if s == AssignmentUserSubmissionStatus.SUBMITTED:
            return "submitted"
        if s == AssignmentUserSubmissionStatus.LATE:
            return "late"
    return "overdue" if _is_assignment_past_due(assignment) else "open"


def _activity_path(course: Course, activity: Activity) -> str:
    return (
        f"/course/{course.course_uuid.removeprefix('course_')}"
        f"/activity/{activity.activity_uuid.removeprefix('activity_')}"
    )


async def assignment_due_dates(ctx: CalendarContext) -> list[CalendarEvent]:
    if not await ctx.feature_enabled("assignments"):
        return []
    db = ctx.db_session
    course_ids = await user_course_ids(ctx)
    if not course_ids:
        return []

    rows = (await db.execute(
        select(Assignment, Activity, Course)
        .join(Activity, Activity.id == Assignment.activity_id)  # type: ignore[arg-type]
        .join(Course, Course.id == Assignment.course_id)  # type: ignore[arg-type]
        .where(
            Assignment.course_id.in_(course_ids),  # type: ignore[attr-defined]
            Assignment.org_id == ctx.org.id,
            Course.org_id == ctx.org.id,
            Assignment.due_date.is_not(None),  # type: ignore[union-attr]
            Assignment.due_date != "",
        )
    )).all()

    # Window first: the access checks below cost queries, the date parse does not.
    in_range = []
    for assignment, activity, course in rows:
        due, all_day = parse_due_date(assignment.due_date)
        if due is None:
            continue
        if all_day:
            if not ctx.overlaps_day(due):  # type: ignore[arg-type]
                continue
        elif not ctx.overlaps(due):  # type: ignore[arg-type]
            continue
        in_range.append((assignment, activity, course, due, all_day))
    if not in_range:
        return []

    submissions = {
        s.assignment_id: s
        for s in (await db.execute(
            select(AssignmentUserSubmission).where(
                AssignmentUserSubmission.user_id == ctx.user_id,
                AssignmentUserSubmission.assignment_id.in_([a.id for a, *_ in in_range]),  # type: ignore[attr-defined]
            )
        )).scalars().all()
    }

    events: list[CalendarEvent] = []
    for assignment, activity, course, due, all_day in in_range:
        if not await ctx.can_read_course(course):
            continue
        editor = await ctx.can_edit_course(course)
        submission = submissions.get(assignment.id)
        if editor and submission is None:
            if not assignment.published:
                status = "draft"
            else:
                status = "closed" if _is_assignment_past_due(assignment) else "open"
        else:
            if not editor:
                if not assignment.published:
                    continue
                try:
                    await verify_activity_reader_access(ctx.request, activity, course, ctx.current_user, db)
                except HTTPException:
                    continue
            status = _learner_status(assignment, submission)

        events.append(CalendarEvent(
            id=f"assignment:{assignment.assignment_uuid}",
            type="assignment",
            title=assignment.title,
            starts_at=due.isoformat() if all_day else iso_utc(due),  # type: ignore[arg-type]
            ends_at=None,
            all_day=all_day,
            url=_activity_path(course, activity),
            course=course_ref(course),
            status=status,
            meta={
                "assignment_uuid": assignment.assignment_uuid,
                "activity_uuid": activity.activity_uuid,
                "instructor": editor,
            },
        ))
    return events


register_source(assignment_due_dates, key="assignments")
