"""The current learner's assignments across the courses they follow in an org.

Read-only and scoped to the caller: the rows come from courses the user is
enrolled in (a TrailRun in this org), that they may open (the same rule as
course listings), and that are published, as are the assignment and its
activity. Restricted chapters and activities are left out unless one of the
user's groups is attached to them (or to the course).

Two queries in total: one for the assignments with the user's submission and
an "has started" flag, one for the max grade of each returned assignment.
"""

from __future__ import annotations

from datetime import datetime, time, timezone
from typing import Literal, Optional

from fastapi import HTTPException
from pydantic import BaseModel
from sqlalchemy import and_, func, or_
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.activities import Activity, ActivityLockType
from src.db.courses.assignments import (
    Assignment,
    AssignmentTask,
    AssignmentTaskSubmission,
    AssignmentUserSubmission,
    AssignmentUserSubmissionStatus,
)
from src.db.courses.chapters import Chapter, LockType
from src.db.courses.courses import Course
from src.db.trail_runs import TrailRun
from src.db.usergroup_resources import UserGroupResource
from src.db.usergroup_user import UserGroupUser
from src.db.users import APITokenUser, AnonymousUser, PublicUser
from src.services.courses.activities.assignments import compute_assignment_grade
from src.services.courses.courses import accessible_courses_filter

LearnerStatus = Literal["not_started", "in_progress", "submitted", "late", "graded"]


class MyAssignmentCourse(BaseModel):
    course_uuid: str
    name: str
    thumbnail_image: Optional[str] = None


class MyAssignmentGrade(BaseModel):
    display_grade: str
    percentage: float
    passed: bool


class MyAssignmentItem(BaseModel):
    assignment_uuid: str
    title: str
    activity_uuid: str
    course: MyAssignmentCourse
    due_date: Optional[str] = None
    status: LearnerStatus
    attempt: int = 0
    overdue: bool = False
    ungraded: bool = False
    grade: Optional[MyAssignmentGrade] = None
    # When the learner's submission last changed (graded / submitted).
    updated_at: Optional[str] = None


def parse_due_date(value: Optional[str]) -> Optional[datetime]:
    """Due dates are stored as text: a date ("2026-11-20", due at the end of
    that day, UTC) or a full ISO timestamp. Unparseable values count as none."""
    if not value:
        return None
    raw = str(value).strip()
    try:
        if len(raw) == 10:
            return datetime.combine(datetime.fromisoformat(raw).date(), time.max, tzinfo=timezone.utc)
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def learner_status(submission: Optional[AssignmentUserSubmission], started: bool) -> LearnerStatus:
    if submission is not None:
        s = submission.submission_status
        if s == AssignmentUserSubmissionStatus.GRADED:
            return "graded"
        if s == AssignmentUserSubmissionStatus.SUBMITTED:
            return "submitted"
        if s == AssignmentUserSubmissionStatus.LATE:
            return "late"
        # PENDING (a retry reset the row) or NOT_SUBMITTED.
        if started or (submission.attempt_number or 1) > 1:
            return "in_progress"
        return "not_started"
    return "in_progress" if started else "not_started"


def _sort_key(item: MyAssignmentItem, due: Optional[datetime]):
    """For everything not graded yet: overdue first, then due soonest, then
    undated; work already handed in after that."""
    far = datetime.max.replace(tzinfo=timezone.utc)
    if item.status in ("submitted", "late"):
        return (3, due or far, "")
    if item.overdue:
        return (0, due or far, "")
    if due is not None:
        return (1, due, "")
    return (2, far, item.title.lower())


async def get_my_assignments(
    current_user: PublicUser | AnonymousUser | APITokenUser,
    org_id: int,
    db_session: AsyncSession,
    graded_limit: int = 10,
    now: Optional[datetime] = None,
) -> list[MyAssignmentItem]:
    if isinstance(current_user, AnonymousUser) or isinstance(current_user, APITokenUser):
        # Learner data is session-only, like the other /me endpoints.
        raise HTTPException(status_code=403, detail="Sign in to see your assignments.")

    user_id = current_user.id
    now = now or datetime.now(timezone.utc)

    enrolled = (
        select(TrailRun.id)
        .where(TrailRun.user_id == user_id, TrailRun.course_id == Course.id, TrailRun.org_id == org_id)
        .exists()
    )
    started = (
        select(AssignmentTaskSubmission.id)
        .where(
            AssignmentTaskSubmission.user_id == user_id,
            AssignmentTaskSubmission.activity_id == Assignment.activity_id,
        )
        .exists()
    )

    def in_users_group(resource_uuid_col):
        return (
            select(UserGroupUser.id)
            .join(UserGroupResource, UserGroupResource.usergroup_id == UserGroupUser.usergroup_id)  # type: ignore[arg-type]
            .where(UserGroupUser.user_id == user_id, UserGroupResource.resource_uuid == resource_uuid_col)
            .exists()
        )

    course_group = in_users_group(Course.course_uuid)

    statement = (
        select(Assignment, Course, Activity.activity_uuid, AssignmentUserSubmission, started.label("started"))
        .join(Course, Course.id == Assignment.course_id)  # type: ignore[arg-type]
        .join(Activity, Activity.id == Assignment.activity_id)  # type: ignore[arg-type]
        .join(Chapter, Chapter.id == Assignment.chapter_id)  # type: ignore[arg-type]
        .outerjoin(
            AssignmentUserSubmission,
            and_(
                AssignmentUserSubmission.assignment_id == Assignment.id,  # type: ignore[arg-type]
                AssignmentUserSubmission.user_id == user_id,  # type: ignore[arg-type]
            ),
        )
        .where(
            Assignment.org_id == org_id,
            Course.org_id == org_id,
            Assignment.published == True,  # noqa: E712
            Course.published == True,  # noqa: E712
            Activity.published == True,  # noqa: E712
            enrolled,
            accessible_courses_filter(user_id, is_anonymous=False, is_api_token=False, is_superadmin=False),
            or_(Chapter.lock_type != LockType.RESTRICTED, in_users_group(Chapter.chapter_uuid), course_group),
            or_(Activity.lock_type != ActivityLockType.RESTRICTED, in_users_group(Activity.activity_uuid), course_group),
        )
    )
    rows = (await db_session.execute(statement)).all()
    if not rows:
        return []

    assignment_ids = [row[0].id for row in rows]
    max_rows = (
        await db_session.execute(
            select(AssignmentTask.assignment_id, func.coalesce(func.sum(AssignmentTask.max_grade_value), 0))
            .where(AssignmentTask.assignment_id.in_(assignment_ids))  # type: ignore[attr-defined]
            .group_by(AssignmentTask.assignment_id)
        )
    ).all()
    max_by_assignment = {aid: int(total or 0) for aid, total in max_rows}

    items: list[tuple[MyAssignmentItem, Optional[datetime]]] = []
    for assignment, course, activity_uuid, submission, has_started in rows:
        status = learner_status(submission, bool(has_started))
        due = parse_due_date(assignment.due_date)
        grade = None
        if status == "graded" and not assignment.ungraded:
            g = compute_assignment_grade(
                submission.grade,
                max_by_assignment.get(assignment.id, 0),
                assignment.grading_type,
                None,
                assignment.pass_threshold_percentage,
            )
            grade = MyAssignmentGrade(display_grade=g["display_grade"], percentage=g["percentage"], passed=g["passed"])
        item = MyAssignmentItem(
            assignment_uuid=assignment.assignment_uuid,
            title=assignment.title,
            activity_uuid=activity_uuid,
            course=MyAssignmentCourse(
                course_uuid=course.course_uuid,
                name=course.name,
                thumbnail_image=course.thumbnail_image or None,
            ),
            due_date=assignment.due_date or None,
            status=status,
            attempt=(submission.attempt_number or 1) if submission is not None else 0,
            overdue=bool(due and due < now and status in ("not_started", "in_progress")),
            ungraded=bool(assignment.ungraded),
            grade=grade,
            updated_at=submission.update_date if submission is not None else None,
        )
        items.append((item, due))

    open_items = sorted((pair for pair in items if pair[0].status != "graded"), key=lambda pair: _sort_key(*pair))
    # Graded ones last, most recently graded first, capped.
    graded = sorted(
        (item for item, _ in items if item.status == "graded"),
        key=lambda item: item.updated_at or "",
        reverse=True,
    )[: max(graded_limit, 0)]
    return [item for item, _ in open_items] + graded
