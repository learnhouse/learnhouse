"""Learner tools: who is enrolled in a course, how far each learner got, and
everything LearnHouse records about one learner's work.

Progress is read straight from the learning trail (trail runs and steps) and
never written: looking at progress must not enroll anyone or create a trail.
Percentages count completed published activities against every published
activity of the course, so they stay within 0 to 100.

Assignment work is read from the submission tables: per assignment a status
(not_started, in_progress, submitted, graded), the grade as the learner sees
it, and whether the deadline passed without the work being handed in
(overdue). Certificates come from the course's certification.

Who may look:
- your own progress and work: any member (a person, not an API token);
- someone else's: an org admin, or an instructor of the course named
  (the same people who see every submission of its assignments);
- a course roster: instructors of that course and admins. API tokens follow
  the admin API: the ``courses`` read right and a Pro plan, plus the
  ``assignments`` read right to see assignment work;
- the audit sections of a learner report (event timeline, time spent and
  active days, code exercise attempts): the per-student audit gate, an org
  admin on a Pro plan, people only. Your own code attempts are always yours.
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Any, Literal

from fastapi import HTTPException
from pydantic import Field
from sqlalchemy import func
from sqlmodel import select

from src.db.code_submissions import CodeSubmission
from src.db.courses.activities import Activity
from src.db.courses.assignments import (
    Assignment,
    AssignmentTask,
    AssignmentTaskSubmission,
    AssignmentUserSubmission,
    AssignmentUserSubmissionStatus,
)
from src.db.courses.certifications import CertificateUser, Certifications
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.chapters import Chapter
from src.db.courses.course_chapters import CourseChapter
from src.db.courses.courses import Course
from src.db.trail_runs import StatusEnum, TrailRun
from src.db.trail_steps import TrailStep
from src.db.user_activity import UserActivityDay
from src.db.user_audit_events import UserAuditEvent, UserAuditEventType
from src.db.user_organizations import UserOrganization
from src.db.users import APITokenUser, User
from src.core.ee_hooks import get_ee_user_behavior
from src.security.auth import resolve_acting_user_id
from src.security.features_utils import plan_check
from src.security.features_utils.plan_check import get_org_plan
from src.security.features_utils.plans import plan_meets_requirement
from src.security.org_auth import is_org_admin, verify_org_admin, verify_org_membership
from src.security.rbac import AccessAction, authorization_verify_based_on_roles
from src.services.ai.tools import refs, results
from src.services.ai.tools.base import ActionTier, ToolContext, ToolSpec
from src.services.audit.answers import humanize_task_answer, judge0_language_name
from src.services.courses.activities.assignments import (
    _is_assignment_past_due,
    compute_assignment_grade,
)
from src.services.demo.guards import hide_other_visitors, is_demo_org

MAX_ACTIVITIES = 300
MAX_ASSIGNMENTS = 50
MAX_TIMELINE = 50
MAX_CODE = 50
MAX_DAILY = 14
MAX_SEARCHES = 10


# ─── shared helpers (also used by the assignment and course stats tools) ────


def iso(value: Any) -> str | None:
    """Stored timestamps are ``str(datetime.now())``; return ISO 8601."""
    if not value:
        return None
    text = str(value).strip()
    try:
        return datetime.fromisoformat(text).isoformat(timespec="seconds")
    except ValueError:
        return text


def _parsed(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).strip())
    except ValueError:
        return None
    return parsed.replace(tzinfo=None)


def display_name(user: Any) -> str:
    full = f"{user.first_name or ''} {user.last_name or ''}".strip()
    return full or user.username


async def member_refs(ctx: ToolContext, user_ids: set[int] | list[int]) -> dict[int, dict]:
    """``{user_id: user ref}`` for the ids that are members of this org.

    Never includes email: none of the matching HTTP views show it. In the
    shared demo organization only the seeded students and the caller are
    named, as on the dashboard (every visitor there is an admin)."""
    ids = {i for i in user_ids if i is not None}
    if not ids:
        return {}
    statement = (
        select(User)
        .join(UserOrganization, UserOrganization.user_id == User.id)  # type: ignore[arg-type]
        .where(User.id.in_(ids), UserOrganization.org_id == ctx.org.id)  # type: ignore[union-attr]
    )
    if await is_demo_org(ctx.org.id, ctx.db_session):
        statement = hide_other_visitors(statement, resolve_acting_user_id(ctx.user))
    rows = (await ctx.db_session.execute(statement)).scalars().all()
    out = {}
    for user in rows:
        out[user.id] = refs.ref(
            "user",
            user.user_uuid,
            display_name(user),
            await refs.web_url(ctx, "user", username=user.username),
            username=user.username,
        )
    return out


async def _check_visible(ctx: ToolContext, learner: User) -> None:
    """In the demo organization, other visitors are not answerable (the
    dashboard and the audit dossier hide them the same way)."""
    if not await is_demo_org(ctx.org.id, ctx.db_session):
        return
    from src.services.demo.flags import DEMO_SIGNUP_METHOD  # noqa: PLC0415

    if learner.signup_method != DEMO_SIGNUP_METHOD and learner.id != resolve_acting_user_id(ctx.user):
        raise HTTPException(
            status_code=404,
            detail=f"No member '{learner.user_uuid}' in this organization. Find people with list_members.",
        )


def _is_token(ctx: ToolContext) -> bool:
    return isinstance(ctx.user, APITokenUser)


def token_may(ctx: ToolContext, bucket: str, action: AccessAction = AccessAction.READ) -> bool:
    """Whether the API token's rights grant `action` on `bucket`."""
    from src.services.ai.tools.registry import _token_bucket_allows  # noqa: PLC0415

    return _is_token(ctx) and _token_bucket_allows(ctx.user.rights, bucket, action)


async def _require_pro_for_token(ctx: ToolContext) -> None:
    """The admin API (the only HTTP way a token reads progress) needs Pro."""
    plan = await get_org_plan(ctx.org.id, ctx.db_session)
    if not plan_meets_requirement(plan, "pro"):
        raise HTTPException(
            status_code=403,
            detail="Reading learner progress with an API token needs a Pro plan or higher.",
        )


async def can_see_course_learners(ctx: ToolContext, course: Course) -> bool:
    """Instructors of the course (course update right) and org admins."""
    if _is_token(ctx):
        return True  # bucket right checked by the pipeline, plan by the caller
    acting = resolve_acting_user_id(ctx.user)
    if await is_org_admin(acting, ctx.org.id, ctx.db_session):
        return True
    return await authorization_verify_based_on_roles(
        ctx.request, acting, "update", course.course_uuid, ctx.db_session
    )


async def may_see_assignment_work(ctx: ToolContext, course: Course | None) -> bool:
    """Everyone's assignment work: the people who see every submission of the
    course's assignments (instructors and admins). A token also needs the
    ``assignments`` read right, as on the assignment routes."""
    if _is_token(ctx):
        return token_may(ctx, "assignments")
    if course is None:
        return await is_org_admin(resolve_acting_user_id(ctx.user), ctx.org.id, ctx.db_session)
    return await can_see_course_learners(ctx, course)


async def published_activities(ctx: ToolContext, course_ids: list[int]) -> dict[int, list[tuple]]:
    """``{course_id: [(activity, chapter_id), ...]}`` in course order."""
    if not course_ids:
        return {}
    rows = (
        await ctx.db_session.execute(
            select(Activity, ChapterActivity.chapter_id, ChapterActivity.course_id)
            .join(ChapterActivity, ChapterActivity.activity_id == Activity.id)  # type: ignore[arg-type]
            .join(
                CourseChapter,
                (CourseChapter.chapter_id == ChapterActivity.chapter_id)  # type: ignore[arg-type]
                & (CourseChapter.course_id == ChapterActivity.course_id),
                isouter=True,
            )
            .where(
                ChapterActivity.course_id.in_(course_ids),  # type: ignore[attr-defined]
                Activity.published == True,  # noqa: E712
            )
            .order_by(CourseChapter.order, ChapterActivity.order, Activity.id)
        )
    ).all()
    out: dict[int, list[tuple]] = {}
    for activity, chapter_id, course_id in rows:
        out.setdefault(course_id, []).append((activity, chapter_id))
    return out


_published_activities = published_activities  # older name, kept for callers


async def completed_by_user(
    ctx: ToolContext, course_id: int, activity_ids: set[int], user_ids: set[int] | None = None
) -> dict[int, set[int]]:
    """``{user_id: {completed published activity ids}}`` for one course."""
    if not activity_ids:
        return {}
    statement = select(TrailStep.user_id, TrailStep.activity_id).where(
        TrailStep.course_id == course_id,
        TrailStep.complete == True,  # noqa: E712
        TrailStep.activity_id.in_(activity_ids),  # type: ignore[attr-defined]
    )
    if user_ids is not None:
        statement = statement.where(TrailStep.user_id.in_(user_ids))  # type: ignore[attr-defined]
    out: dict[int, set[int]] = {}
    for user_id, activity_id in (await ctx.db_session.execute(statement)).all():
        out.setdefault(user_id, set()).add(activity_id)
    return out


_completed_by_user = completed_by_user


async def last_step_by_user(
    ctx: ToolContext, course_id: int, user_ids: set[int] | None = None
) -> dict[int, str]:
    statement = (
        select(TrailStep.user_id, func.max(TrailStep.update_date))
        .where(TrailStep.course_id == course_id)
        .group_by(TrailStep.user_id)
    )
    if user_ids is not None:
        statement = statement.where(TrailStep.user_id.in_(user_ids))  # type: ignore[attr-defined]
    return {row[0]: row[1] for row in (await ctx.db_session.execute(statement)).all()}


_last_step_by_user = last_step_by_user


async def enrolled_runs(ctx: ToolContext, course: Course) -> list[TrailRun]:
    """Trail runs of the course's learners who are still members here."""
    return list(
        (
            await ctx.db_session.execute(
                select(TrailRun)
                .join(
                    UserOrganization,
                    (UserOrganization.user_id == TrailRun.user_id)  # type: ignore[arg-type]
                    & (UserOrganization.org_id == ctx.org.id),
                )
                .where(TrailRun.course_id == course.id, TrailRun.org_id == ctx.org.id)
            )
        ).scalars().all()
    )


def progress_of(done: int, total: int) -> dict:
    return {
        "completed_activities": done,
        "total_activities": total,
        "percent": round(done / total * 100, 1) if total else 0.0,
    }


_progress = progress_of


def run_status(run: TrailRun) -> str:
    value = run.status.value if hasattr(run.status, "value") else str(run.status)
    return value.removeprefix("STATUS_").lower()


_status = run_status


def is_complete(run: TrailRun, done: int, total: int) -> bool:
    return run.status == StatusEnum.STATUS_COMPLETED or (total > 0 and done >= total)


def latest(*values: Any) -> str | None:
    found = [v for v in values if v]
    return max(found, key=lambda v: _parsed(v) or datetime.min) if found else None


_latest = latest


def activity_type(activity: Activity) -> str:
    value = activity.activity_type.value if hasattr(activity.activity_type, "value") else str(activity.activity_type)
    return value.removeprefix("TYPE_").lower()


_activity_type = activity_type


async def course_ref(ctx: ToolContext, course: Course) -> dict:
    return refs.ref(
        "course", course.course_uuid, course.name, await refs.web_url(ctx, "course", course=course.course_uuid)
    )


async def activity_ref(ctx: ToolContext, activity: Activity, course_uuid: str | None) -> dict:
    return refs.ref(
        "activity",
        activity.activity_uuid,
        activity.name,
        await refs.web_url(ctx, "activity", course=course_uuid, activity=activity.activity_uuid),
        type=activity_type(activity),
    )


def median(values: list[float]) -> float | None:
    return round(statistics.median(values), 1) if values else None


def mean(values: list[float]) -> float | None:
    return round(sum(values) / len(values), 1) if values else None


# ─── assignment work ─────────────────────────────────────────────────────────


_BUCKET = {
    AssignmentUserSubmissionStatus.PENDING: "in_progress",
    AssignmentUserSubmissionStatus.SUBMITTED: "submitted",
    AssignmentUserSubmissionStatus.LATE: "submitted",
    AssignmentUserSubmissionStatus.GRADED: "graded",
}
OPEN_BUCKETS = ("not_started", "in_progress")


def work_status(sub: AssignmentUserSubmission | None) -> str:
    """not_started, in_progress (saved, not handed in), submitted (handed in,
    no grade yet, or an ungraded assignment) or graded."""
    if sub is None:
        return "not_started"
    return _BUCKET.get(sub.submission_status, "not_started")


def grade_of(assignment: Assignment, max_points: int, sub: AssignmentUserSubmission | None) -> dict | None:
    """The final grade as the learner sees it, or None when there is none."""
    if sub is None or sub.submission_status != AssignmentUserSubmissionStatus.GRADED or assignment.ungraded:
        return None
    computed = compute_assignment_grade(
        int(sub.grade or 0),
        max_points,
        assignment.grading_type,
        pass_threshold_percentage=assignment.pass_threshold_percentage,
    )
    return {
        "display": computed["display_grade"],
        "points": computed["points_summary"],
        "percentage": computed["percentage"],
        "passed": computed["passed"],
    }


@dataclass
class AssignmentWork:
    assignments: list[Assignment] = field(default_factory=list)
    max_points: dict[int, int] = field(default_factory=dict)
    # (assignment_id, user_id) -> the learner's submission row
    submissions: dict[tuple[int, int], AssignmentUserSubmission] = field(default_factory=dict)

    def summary(self, user_id: int, course_id: int | None = None) -> dict:
        counts = {"assigned": 0, "not_started": 0, "in_progress": 0, "submitted": 0, "graded": 0, "overdue": 0}
        percents = []
        for a in self.assignments:
            if course_id is not None and a.course_id != course_id:
                continue
            sub = self.submissions.get((a.id, user_id))
            status = work_status(sub)
            counts["assigned"] += 1
            counts[status] += 1
            if status in OPEN_BUCKETS and _is_assignment_past_due(a):
                counts["overdue"] += 1
            grade = grade_of(a, self.max_points.get(a.id, 0), sub)
            if grade:
                percents.append(grade["percentage"])
        counts["average_grade_percent"] = mean(percents)
        return counts


async def assignment_work(
    ctx: ToolContext,
    course_ids: list[int],
    user_ids: set[int] | None = None,
    *,
    only: list[int] | None = None,
) -> AssignmentWork:
    """Published assignments of the courses, their point totals, and the
    submissions of `user_ids` (everyone when None). `only` loads just those
    assignments, drafts included."""
    work = AssignmentWork()
    if not course_ids:
        return work
    statement = select(Assignment).where(
        Assignment.course_id.in_(course_ids),  # type: ignore[attr-defined]
        Assignment.org_id == ctx.org.id,
    )
    if only is not None:
        statement = statement.where(Assignment.id.in_(only))  # type: ignore[union-attr]
    else:
        statement = statement.where(Assignment.published == True)  # noqa: E712
    work.assignments = list((await ctx.db_session.execute(statement.order_by(Assignment.id))).scalars().all())
    ids = [a.id for a in work.assignments]
    if not ids:
        return work
    work.max_points = {
        row[0]: int(row[1] or 0)
        for row in (
            await ctx.db_session.execute(
                select(AssignmentTask.assignment_id, func.sum(AssignmentTask.max_grade_value))
                .where(AssignmentTask.assignment_id.in_(ids))  # type: ignore[attr-defined]
                .group_by(AssignmentTask.assignment_id)
            )
        ).all()
    }
    statement = select(AssignmentUserSubmission).where(
        AssignmentUserSubmission.assignment_id.in_(ids)  # type: ignore[attr-defined]
    )
    if user_ids is not None:
        if not user_ids:
            return work
        statement = statement.where(AssignmentUserSubmission.user_id.in_(user_ids))  # type: ignore[attr-defined]
    for sub in (await ctx.db_session.execute(statement)).scalars().all():
        work.submissions[(sub.assignment_id, sub.user_id)] = sub
    return work


async def certificate_state(
    ctx: ToolContext, course_ids: list[int], user_ids: set[int] | None = None
) -> tuple[set[int], dict[tuple[int, int], str | None]]:
    """(courses that award a certificate, {(course_id, user_id): issued_at})."""
    if not course_ids:
        return set(), {}
    certs = (
        await ctx.db_session.execute(
            select(Certifications.id, Certifications.course_id).where(
                Certifications.course_id.in_(course_ids)  # type: ignore[attr-defined]
            )
        )
    ).all()
    if not certs:
        return set(), {}
    by_cert = {cert_id: course_id for cert_id, course_id in certs}
    statement = select(CertificateUser.certification_id, CertificateUser.user_id, CertificateUser.created_at).where(
        CertificateUser.certification_id.in_(list(by_cert))  # type: ignore[attr-defined]
    )
    if user_ids is not None:
        statement = statement.where(CertificateUser.user_id.in_(user_ids))  # type: ignore[attr-defined]
    earned = {
        (by_cert[cert_id], user_id): created_at
        for cert_id, user_id, created_at in (await ctx.db_session.execute(statement)).all()
    }
    return set(by_cert.values()), earned


def certificate_view(course_id: int, user_id: int, with_cert: set[int], earned: dict) -> dict | None:
    if course_id not in with_cert:
        return None
    key = (course_id, user_id)
    return {"earned": key in earned, "issued_at": iso(earned.get(key))}


# ─── params ────────────────────────────────────────────────────────────────


class ListCourseLearnersParams(results.Paging):
    course_uuid: str = Field(..., max_length=100, description="The course to list learners of.")
    sort: Literal["progress_asc", "progress_desc", "last_active_asc", "grade_asc", "name"] = Field(
        "progress_asc",
        description=(
            "progress_asc puts learners who are furthest behind first; last_active_asc "
            "puts the longest inactive first; grade_asc the lowest average assignment grade."
        ),
    )
    status: Literal["not_started", "in_progress", "completed", "behind"] | None = Field(
        None,
        description=(
            "Only learners in this state. behind: not completed and below the course's "
            "median progress."
        ),
    )
    inactive_days: int | None = Field(
        None,
        ge=1,
        le=365,
        description="Only learners with no activity in this many days (never active counts).",
    )
    overdue_only: bool = Field(
        False,
        description="Only learners with an assignment past its due date that they have not handed in.",
    )


class GetLearnerProgressParams(results.Paging):
    user_uuid: str | None = Field(
        None,
        max_length=100,
        description="Whose progress to read; omit for your own.",
    )
    course_uuid: str | None = Field(
        None,
        max_length=100,
        description=(
            "Limit to one course and also list its activities (done, when) and each "
            "assignment with status, grade, feedback and per-task scores."
        ),
    )
    include: list[Literal["timeline", "engagement", "code"]] = Field(
        default_factory=list,
        max_length=3,
        description=(
            "Extra audit sections (org admin, Pro plan): timeline of learning events, "
            "engagement (active days, time spent, views), code exercise attempts."
        ),
    )
    days: int = Field(90, ge=1, le=365, description="Window in days for timeline and engagement.")


# ─── executors ─────────────────────────────────────────────────────────────


async def _list_course_learners(ctx: ToolContext, p: ListCourseLearnersParams):
    course = await refs.load(ctx, "course", p.course_uuid)
    if _is_token(ctx):
        await _require_pro_for_token(ctx)
    elif not await can_see_course_learners(ctx, course):
        raise HTTPException(
            status_code=403,
            detail="Only instructors of this course and admins can see its learners.",
        )

    runs = await enrolled_runs(ctx, course)
    activities = (await published_activities(ctx, [course.id])).get(course.id, [])
    activity_ids = {a.id for a, _ in activities}
    completed = await completed_by_user(ctx, course.id, activity_ids)
    last_steps = await last_step_by_user(ctx, course.id)
    total = len(activity_ids)
    user_ids = {run.user_id for run in runs}
    show_work = await may_see_assignment_work(ctx, course)
    work = await assignment_work(ctx, [course.id], user_ids) if show_work and runs else None
    with_cert, earned = await certificate_state(ctx, [course.id], user_ids)

    rows = []
    for run in runs:
        done = len(completed.get(run.user_id, ()))
        last = latest(last_steps.get(run.user_id), run.update_date)
        row = {
            "user_id": run.user_id,
            "status": run_status(run),
            "progress": progress_of(done, total),
            "completed": is_complete(run, done, total),
            "enrolled_at": iso(run.creation_date),
            "last_active_at": iso(last),
            "_last": _parsed(last),
        }
        if work is not None:
            row["assignments"] = work.summary(run.user_id)
        cert = certificate_view(course.id, run.user_id, with_cert, earned)
        if cert is not None:
            row["certificate"] = cert
        rows.append(row)

    # Course-wide numbers, before any filter, so "behind" has a reference.
    percents = [r["progress"]["percent"] for r in rows]
    middle = median(percents)
    cutoff_14 = datetime.now() - timedelta(days=14)
    summary: dict[str, Any] = {
        "enrolled": len(rows),
        "completed": sum(1 for r in rows if r["completed"]),
        "not_started": sum(1 for r in rows if not r["completed"] and r["progress"]["completed_activities"] == 0),
        "average_percent": mean(percents),
        "median_percent": middle,
        "inactive_14_days": sum(1 for r in rows if r["_last"] is None or r["_last"] < cutoff_14),
    }
    if work is not None:
        summary["with_overdue_work"] = sum(1 for r in rows if r["assignments"]["overdue"])
        summary["awaiting_grade"] = sum(r["assignments"]["submitted"] for r in rows)
    if with_cert:
        summary["certificates_earned"] = sum(1 for r in rows if r.get("certificate", {}).get("earned"))

    if p.status == "completed":
        rows = [r for r in rows if r["completed"]]
    elif p.status == "not_started":
        rows = [r for r in rows if not r["completed"] and r["progress"]["completed_activities"] == 0]
    elif p.status == "in_progress":
        rows = [r for r in rows if not r["completed"] and r["progress"]["completed_activities"] > 0]
    elif p.status == "behind":
        rows = [r for r in rows if not r["completed"] and middle is not None and r["progress"]["percent"] < middle]
    if p.inactive_days:
        cutoff = datetime.now() - timedelta(days=p.inactive_days)
        rows = [r for r in rows if r["_last"] is None or r["_last"] < cutoff]
    if p.overdue_only:
        if work is None:
            raise HTTPException(
                status_code=403,
                detail="overdue_only reads assignment work: an API token needs the assignments read right.",
            )
        rows = [r for r in rows if r["assignments"]["overdue"]]

    people = await member_refs(ctx, {r["user_id"] for r in rows})
    for r in rows:
        r["learner"] = people.get(r["user_id"]) or refs.ref("user", None, "Unknown member")
    if p.sort == "progress_asc":
        rows.sort(key=lambda r: (r["progress"]["percent"], r["learner"].get("name") or ""))
    elif p.sort == "progress_desc":
        rows.sort(key=lambda r: (-r["progress"]["percent"], r["learner"].get("name") or ""))
    elif p.sort == "last_active_asc":
        rows.sort(key=lambda r: (r["_last"] or datetime.min))
    elif p.sort == "grade_asc":
        def _grade_key(r):
            avg = (r.get("assignments") or {}).get("average_grade_percent")
            return (avg is None, avg or 0.0, r["learner"].get("name") or "")
        rows.sort(key=_grade_key)
    else:
        rows.sort(key=lambda r: (r["learner"].get("name") or "").lower())

    keys = ("learner", "status", "progress", "completed", "enrolled_at", "last_active_at", "assignments", "certificate")
    items = [{k: r[k] for k in keys if k in r} for r in rows]
    out = results.page_of(items, p, course=await course_ref(ctx, course), total_activities=total, summary=summary)
    # An empty answer says why, so an agent does not mistake it for missing access.
    notes = []
    if not runs:
        notes.append("No one is enrolled in this course yet.")
    elif not items:
        notes.append("No enrolled learner matches these filters.")
    if not total:
        notes.append("The course has no published activities, so progress cannot be measured yet.")
    if not show_work:
        notes.append("Assignment work is left out: an API token needs the assignments read right to see it.")
    if notes:
        out["note"] = " ".join(notes)
    # Learner names are written by the learners themselves.
    return results.untrusted(out, "items") if items else out


async def _get_learner_progress(ctx: ToolContext, p: GetLearnerProgressParams):
    course = await refs.load(ctx, "course", p.course_uuid) if p.course_uuid else None

    if p.user_uuid:
        learner = await refs.load_member(ctx, p.user_uuid)
    elif _is_token(ctx):
        raise HTTPException(
            status_code=400,
            detail="An API token is not a learner. Pass user_uuid to read a member's progress.",
        )
    else:
        learner = await ctx.db_session.get(User, ctx.user.id)

    own = not _is_token(ctx) and learner.id == ctx.user.id
    if not own:
        if _is_token(ctx):
            await _require_pro_for_token(ctx)
        elif not await is_org_admin(resolve_acting_user_id(ctx.user), ctx.org.id, ctx.db_session):
            if course is None:
                raise HTTPException(
                    status_code=403,
                    detail=(
                        "Only admins can read another member's progress across courses. "
                        "Pass a course_uuid you teach."
                    ),
                )
            if not await can_see_course_learners(ctx, course):
                raise HTTPException(
                    status_code=403,
                    detail="Only instructors of this course and admins can read a learner's progress in it.",
                )
        await _check_visible(ctx, learner)

    statement = select(TrailRun, Course).join(Course, Course.id == TrailRun.course_id).where(  # type: ignore[arg-type]
        TrailRun.user_id == learner.id, TrailRun.org_id == ctx.org.id
    )
    if course is not None:
        statement = statement.where(TrailRun.course_id == course.id)
    pairs = (await ctx.db_session.execute(statement.order_by(TrailRun.id))).all()
    course_ids = [c.id for _, c in pairs]

    activities = await published_activities(ctx, course_ids)
    done_at = await _completion_times(ctx, learner.id, course_ids)
    last_by_course = await _last_step_by_course(ctx, learner.id, course_ids)
    # Your own work, or everyone's for the people who grade it.
    see_work = own or await may_see_assignment_work(ctx, course)
    staff_view = see_work and not own
    work = await assignment_work(ctx, course_ids, {learner.id}) if see_work and course_ids else None
    with_cert, earned = await certificate_state(ctx, course_ids, {learner.id})

    items = []
    for run, c in pairs:
        ids = {a.id for a, _ in activities.get(c.id, [])}
        done = {aid for aid in done_at.get(c.id, {}) if aid in ids}
        item: dict[str, Any] = {
            "course": await course_ref(ctx, c),
            "status": run_status(run),
            "progress": progress_of(len(done), len(ids)),
            "completed": is_complete(run, len(done), len(ids)),
            "enrolled_at": iso(run.creation_date),
            "last_active_at": iso(latest(last_by_course.get(c.id), run.update_date)),
        }
        if work is not None:
            item["assignments"] = work.summary(learner.id, c.id)
        cert = certificate_view(c.id, learner.id, with_cert, earned)
        if cert is not None:
            item["certificate"] = cert
        items.append(item)

    summary: dict[str, Any] = {
        "courses_enrolled": len(items),
        "courses_completed": sum(1 for i in items if i["completed"]),
        "average_percent": mean([i["progress"]["percent"] for i in items]),
    }
    if work is not None:
        totals = work.summary(learner.id)
        summary["assignments"] = totals
    if with_cert:
        summary["certificates_earned"] = sum(1 for key in earned if key[1] == learner.id)

    offset = results.offset_of(p.cursor)
    chunk = items[offset : offset + p.limit]
    if course is not None and chunk:
        item = chunk[0]
        listed = activities.get(course.id, [])
        chapters = await _chapter_names(ctx, {chapter_id for _, chapter_id in listed})
        times = done_at.get(course.id, {})
        item["activities"] = [
            {
                "activity": await activity_ref(ctx, a, course.course_uuid),
                "chapter": chapters.get(chapter_id),
                "done": a.id in times,
                "completed_at": iso(times.get(a.id)),
            }
            for a, chapter_id in listed[:MAX_ACTIVITIES]
        ]
        if len(listed) > MAX_ACTIVITIES:
            item["activities_truncated"] = True
        if work is not None:
            item["assignment_details"] = await _assignment_details(ctx, course, learner.id, work, staff_view)
            if len(work.assignments) > MAX_ASSIGNMENTS:
                item["assignment_details_truncated"] = True

    people = await member_refs(ctx, {learner.id})
    learner_ref = people.get(learner.id) or refs.ref("user", learner.user_uuid, display_name(learner))
    extra: dict[str, Any] = {"learner": learner_ref, "summary": summary}
    notes = []
    if course is not None and not pairs:
        notes.append("Not enrolled in this course yet.")
    if work is None and not own and pairs:
        notes.append("Assignment work is left out: an API token needs the assignments read right to see it.")

    if p.include:
        unavailable: dict[str, str] = {}
        gate = await _audit_gate(ctx)
        for section in dict.fromkeys(p.include):
            allowed = gate is None or (section == "code" and own)
            if not allowed:
                unavailable[section] = gate
                continue
            if section == "timeline":
                extra["timeline"] = await _timeline(ctx, learner.id, p.days, course)
            elif section == "engagement":
                extra["engagement"] = await _engagement(ctx, learner.id, p.days, course)
            else:
                extra["code_exercises"] = await _code_exercises(ctx, learner.id, course)
        if unavailable:
            extra["unavailable"] = unavailable

    if notes:
        extra["note"] = " ".join(notes)
    out = results.page(chunk, offset=offset, limit=p.limit, total=len(items), **extra)
    # Names, feedback and searches are written by members.
    audit = any(k in extra for k in ("timeline", "engagement", "code_exercises"))
    return results.untrusted(out, "items") if (chunk or audit) else out


# ─── learner report pieces ──────────────────────────────────────────────────


async def _completion_times(ctx: ToolContext, user_id: int, course_ids: list[int]) -> dict[int, dict[int, str]]:
    """``{course_id: {activity_id: completed_at}}`` for one learner."""
    if not course_ids:
        return {}
    rows = (
        await ctx.db_session.execute(
            select(TrailStep.course_id, TrailStep.activity_id, TrailStep.creation_date).where(
                TrailStep.user_id == user_id,
                TrailStep.complete == True,  # noqa: E712
                TrailStep.course_id.in_(course_ids),  # type: ignore[attr-defined]
            )
        )
    ).all()
    out: dict[int, dict[int, str]] = {}
    for course_id, activity_id, created in rows:
        out.setdefault(course_id, {})[activity_id] = created
    return out


async def _last_step_by_course(ctx: ToolContext, user_id: int, course_ids: list[int]) -> dict[int, str]:
    if not course_ids:
        return {}
    rows = (
        await ctx.db_session.execute(
            select(TrailStep.course_id, func.max(TrailStep.update_date))
            .where(TrailStep.user_id == user_id, TrailStep.course_id.in_(course_ids))  # type: ignore[attr-defined]
            .group_by(TrailStep.course_id)
        )
    ).all()
    return {row[0]: row[1] for row in rows}


async def _chapter_names(ctx: ToolContext, chapter_ids: set[int]) -> dict[int, str]:
    ids = {i for i in chapter_ids if i is not None}
    if not ids:
        return {}
    rows = (
        await ctx.db_session.execute(select(Chapter.id, Chapter.name).where(Chapter.id.in_(ids)))  # type: ignore[union-attr]
    ).all()
    return {row[0]: row[1] for row in rows}


def _low(value: Any) -> str | None:
    if value is None:
        return None
    return (value.value if hasattr(value, "value") else str(value)).lower()


async def _assignment_details(
    ctx: ToolContext, course: Course, user_id: int, work: AssignmentWork, staff_view: bool
) -> list[dict]:
    """Each published assignment of the course with the learner's status,
    grade, feedback and per-task scores. Instructors also get how many
    auto-checkable answers were right (never shown to the learner, who could
    use it to probe the answer key before handing in)."""
    shown = [a for a in work.assignments if a.course_id == course.id][:MAX_ASSIGNMENTS]
    if not shown:
        return []
    tasks = (
        await ctx.db_session.execute(
            select(AssignmentTask)
            .where(AssignmentTask.assignment_id.in_([a.id for a in shown]))  # type: ignore[attr-defined]
            .order_by(AssignmentTask.order.asc().nulls_last(), AssignmentTask.id.asc())  # type: ignore[union-attr]
        )
    ).scalars().all()
    by_assignment: dict[int, list[AssignmentTask]] = {}
    for t in tasks:
        by_assignment.setdefault(t.assignment_id, []).append(t)
    answers: dict[int, AssignmentTaskSubmission] = {}
    if tasks:
        for ts in (
            await ctx.db_session.execute(
                select(AssignmentTaskSubmission).where(
                    AssignmentTaskSubmission.user_id == user_id,
                    AssignmentTaskSubmission.assignment_task_id.in_([t.id for t in tasks]),  # type: ignore[attr-defined]
                )
            )
        ).scalars().all():
            answers[ts.assignment_task_id] = ts
    activities = {
        a.id: a
        for a in (
            await ctx.db_session.execute(
                select(Activity).where(Activity.id.in_({a.activity_id for a in shown}))  # type: ignore[union-attr]
            )
        ).scalars().all()
    }

    out = []
    for a in shown:
        sub = work.submissions.get((a.id, user_id))
        status = work_status(sub)
        activity = activities.get(a.activity_id)
        if staff_view:
            url = await refs.web_url(ctx, "assignment", assignment=a.assignment_uuid)
        elif activity is not None:
            url = await refs.web_url(ctx, "activity", course=course.course_uuid, activity=activity.activity_uuid)
        else:
            url = None
        task_rows = []
        for t in by_assignment.get(a.id, []):
            ts = answers.get(t.id)
            row: dict[str, Any] = {
                "task": refs.ref("assignment_task", t.assignment_task_uuid, t.title),
                "type": _low(t.assignment_type),
                "points": t.max_grade_value,
                "answered": ts is not None,
                "score": f"{int(ts.grade or 0)}/{int(t.max_grade_value or 0)}" if ts is not None else None,
                "answered_at": iso(ts.update_date) if ts is not None else None,
            }
            if ts is not None and ts.task_submission_grade_feedback:
                row["feedback"] = results.clip(ts.task_submission_grade_feedback)
            if staff_view and ts is not None:
                rendered = humanize_task_answer(t.assignment_type, t.contents, ts.task_submission, t.title or "")
                if rendered.get("total_count"):
                    row["auto_check"] = f"{rendered['correct_count']}/{rendered['total_count']} correct"
            task_rows.append(row)
        entry: dict[str, Any] = {
            "assignment": refs.ref("assignment", a.assignment_uuid, a.title, url),
            "due_date": a.due_date or None,
            "status": status,
            "overdue": status in OPEN_BUCKETS and _is_assignment_past_due(a),
            "graded": not a.ungraded,
            "attempt": sub.attempt_number if sub is not None else None,
            "started_at": iso(sub.creation_date) if sub is not None else None,
            "updated_at": iso(sub.update_date) if sub is not None else None,
            "grade": grade_of(a, work.max_points.get(a.id, 0), sub),
            "tasks": task_rows,
        }
        if sub is not None and sub.overall_feedback:
            entry["feedback"] = results.clip(sub.overall_feedback, results.DETAIL_TEXT)
        out.append(entry)
    return out


async def _audit_gate(ctx: ToolContext) -> str | None:
    """None when the caller passes the per-student audit gate (the same
    checks as the EE /audit routes: org admin of this org, Pro plan), else
    why not."""
    if _is_token(ctx):
        return "Not available to API tokens (the per-student audit routes refuse them)."
    acting_id = resolve_acting_user_id(ctx.user)
    try:
        await verify_org_membership(acting_id, ctx.org.id, ctx.db_session)
        await verify_org_admin(acting_id, ctx.org.id, ctx.db_session)
        # Looked up on the module so tests can pin the deployment mode.
        if plan_check._check_mode_bypass("analytics_advanced") is None:
            if not plan_meets_requirement(await get_org_plan(ctx.org.id, ctx.db_session), "pro"):
                return "Student audit & analytics requires a Pro plan or higher."
    except HTTPException as e:
        return str(e.detail)
    return None


_EVENT_LABELS = {
    UserAuditEventType.COURSE_ENROLLED: "Enrolled in a course",
    UserAuditEventType.ACTIVITY_COMPLETED: "Completed an activity",
    UserAuditEventType.COURSE_COMPLETED: "Completed a course",
    UserAuditEventType.ASSIGNMENT_SUBMITTED: "Submitted an assignment",
    UserAuditEventType.ASSIGNMENT_GRADED: "Assignment graded",
    UserAuditEventType.CERTIFICATE_CLAIMED: "Claimed a certificate",
}


async def _org_rows(ctx: ToolContext, model: Any, uuid_field: str, uuids: set[str]) -> dict[str, Any]:
    uuids = {u for u in uuids if u}
    if not uuids:
        return {}
    column = getattr(model, uuid_field)
    rows = (
        await ctx.db_session.execute(select(model).where(column.in_(uuids), model.org_id == ctx.org.id))
    ).scalars().all()
    return {getattr(r, uuid_field): r for r in rows}


async def _timeline(ctx: ToolContext, user_id: int, days: int, course: Course | None) -> list[dict]:
    """Recent learning events from the durable audit log of this organization.

    Sign-ins are left out (they are recorded account-wide, with addresses);
    attempts that a retry overwrote in the live tables still show here."""
    since = datetime.now(timezone.utc) - timedelta(days=days)
    rows = (
        await ctx.db_session.execute(
            select(UserAuditEvent)
            .where(
                UserAuditEvent.org_id == ctx.org.id,
                UserAuditEvent.user_id == user_id,
                UserAuditEvent.event_type.in_(list(_EVENT_LABELS)),  # type: ignore[attr-defined]
                UserAuditEvent.created_at >= since,  # type: ignore[operator]
            )
            .order_by(UserAuditEvent.created_at.desc())  # type: ignore[union-attr]
            .limit(500)
        )
    ).scalars().all()
    if course is not None:
        rows = [
            r for r in rows
            if (r.audit_metadata or {}).get("course_uuid") == course.course_uuid or r.target_uuid == course.course_uuid
        ]
    rows = rows[:MAX_TIMELINE]

    targets = {r.target_uuid for r in rows if r.target_uuid}
    course_uuids = {(r.audit_metadata or {}).get("course_uuid") for r in rows} | {
        t for t in targets if t.startswith("course_")
    }
    courses = await _org_rows(ctx, Course, "course_uuid", course_uuids)
    activities = await _org_rows(ctx, Activity, "activity_uuid", {t for t in targets if t.startswith("activity_")})
    assignments = await _org_rows(ctx, Assignment, "assignment_uuid", {t for t in targets if t.startswith("assignment_")})

    out = []
    for r in rows:
        meta = r.audit_metadata or {}
        c = courses.get(meta.get("course_uuid") or r.target_uuid or "")
        entry: dict[str, Any] = {
            "event": r.event_type,
            "label": _EVENT_LABELS.get(r.event_type, r.event_type),
            "at": iso(r.created_at),
            "course": await course_ref(ctx, c) if c is not None else None,
        }
        target = r.target_uuid or ""
        if target in activities:
            entry["activity"] = await activity_ref(ctx, activities[target], c.course_uuid if c else None)
        elif target in assignments:
            entry["assignment"] = refs.ref("assignment", target, assignments[target].title)
        if meta.get("attempt_number"):
            entry["attempt"] = meta["attempt_number"]
        if r.event_type == UserAuditEventType.ASSIGNMENT_GRADED:
            entry["grade"] = {
                "display": meta.get("display_grade"),
                "percentage": meta.get("percentage"),
                "passed": meta.get("passed"),
            }
        out.append(entry)
    return out


async def _engagement(ctx: ToolContext, user_id: int, days: int, course: Course | None) -> dict:
    """Active days (always recorded) and, when EE analytics is available,
    time spent, views and recent searches, as the audit dossier reads them."""
    since = date.today() - timedelta(days=days)
    active = (
        await ctx.db_session.execute(
            select(UserActivityDay.activity_date).where(
                UserActivityDay.org_id == ctx.org.id,
                UserActivityDay.user_id == user_id,
                UserActivityDay.activity_date >= since,  # type: ignore[operator]
            )
        )
    ).scalars().all()
    out: dict[str, Any] = {
        "window_days": days,
        "active_days": len(set(active)),
        "last_active_day": max(active).isoformat() if active else None,
    }

    try:
        behavior = await get_ee_user_behavior(user_id, ctx.org.id, days)
    except Exception:
        behavior = {}
    if not behavior:
        out["time_spent"] = None
        out["note"] = (
            "Time spent, views and searches come from analytics, which needs the Enterprise "
            "Edition (or did not answer). Active days are still counted."
        )
        return out

    by_course_rows = [r for r in behavior.get("user_time_by_course") or [] if isinstance(r, dict)]
    courses = await _org_rows(ctx, Course, "course_uuid", {r.get("course_uuid") for r in by_course_rows})
    by_course = []
    for r in by_course_rows:
        c = courses.get(r.get("course_uuid") or "")
        if c is None or (course is not None and c.id != course.id):
            continue
        by_course.append({"course": await course_ref(ctx, c), "seconds": int(r.get("total_seconds") or 0)})
    total = next(iter(behavior.get("user_time_total") or []), {}) or {}
    out["time_spent"] = {
        "total_seconds": int(total.get("total_seconds") or 0),
        "activities_touched": int(total.get("activities_touched") or 0),
        "by_course": by_course,
    }
    if course is not None:
        out["time_spent"]["course_seconds"] = sum(r["seconds"] for r in by_course)
    out["views"] = {
        str(r.get("event_name")): int(r.get("count") or 0)
        for r in behavior.get("user_views") or []
        if isinstance(r, dict)
    }
    daily = [r for r in behavior.get("user_daily_activity") or [] if isinstance(r, dict)]
    out["recent_days"] = [
        {"day": str(r.get("day")), "events": int(r.get("events") or 0), "seconds": int(r.get("seconds") or 0)}
        for r in daily[-MAX_DAILY:]
    ]
    out["searches"] = [
        {"query": results.clip(str(r.get("query") or ""), 120), "count": int(r.get("count") or 0)}
        for r in (behavior.get("user_searches") or [])[:MAX_SEARCHES]
        if isinstance(r, dict)
    ]
    return out


async def _code_exercises(ctx: ToolContext, user_id: int, course: Course | None) -> list[dict]:
    """Code exercise attempts per exercise: how many, passed or not, best test
    result and when. Source code is not returned."""
    statement = select(Activity).where(Activity.org_id == ctx.org.id)
    if course is not None:
        statement = statement.where(Activity.course_id == course.id)
    activities = {a.activity_uuid: a for a in (await ctx.db_session.execute(statement)).scalars().all()}
    if not activities:
        return []
    subs = (
        await ctx.db_session.execute(
            select(CodeSubmission)
            .where(
                CodeSubmission.user_id == user_id,
                CodeSubmission.activity_uuid.in_(list(activities)),  # type: ignore[attr-defined]
            )
            .order_by(CodeSubmission.id.desc())  # type: ignore[union-attr]
            .limit(2000)
        )
    ).scalars().all()
    groups: dict[tuple[str, str], dict] = {}
    for s in subs:
        g = groups.setdefault(
            (s.activity_uuid, s.block_id),
            {"attempts": 0, "passed": False, "best": None, "last": s.created_at, "language": s.language_id},
        )
        g["attempts"] += 1
        g["passed"] = g["passed"] or bool(s.passed)
        if g["best"] is None or (s.passed_tests or 0) > g["best"][0]:
            g["best"] = (s.passed_tests or 0, s.total_tests or 0)
    course_uuids = {
        c.id: c.course_uuid
        for c in (
            await ctx.db_session.execute(
                select(Course).where(Course.id.in_({a.course_id for a in activities.values()}))  # type: ignore[union-attr]
            )
        ).scalars().all()
    }
    out = []
    for (activity_uuid, block_id), g in list(groups.items())[:MAX_CODE]:
        a = activities[activity_uuid]
        out.append(
            {
                "activity": await activity_ref(ctx, a, course_uuids.get(a.course_id)),
                "block_id": block_id,
                "attempts": g["attempts"],
                "passed": g["passed"],
                "best_tests": f"{g['best'][0]}/{g['best'][1]}",
                "last_attempt_at": iso(g["last"]),
                "language": judge0_language_name(g["language"]),
            }
        )
    return out


# ─── specs ─────────────────────────────────────────────────────────────────

SPECS: list[ToolSpec] = [
    ToolSpec(
        name="list_course_learners",
        description=(
            "List a course's learners with progress (published activities done), last activity, "
            "enrollment date, assignment work (handed in, graded, overdue, average grade) and "
            "certificate, plus course-wide numbers. Filter by status (not_started, in_progress, "
            "completed, behind), inactive_days or overdue_only to find who needs help. "
            "Instructors of the course and admins only."
        ),
        params_model=ListCourseLearnersParams,
        tier=ActionTier.READ,
        rights_bucket="courses",
        access_action=AccessAction.READ,
        execute=_list_course_learners,
        target_param="course_uuid",
        target_kind="course",
        title="List course learners",
    ),
    ToolSpec(
        name="get_learner_progress",
        description=(
            "A learner's report per enrolled course: progress, last activity, assignment work and "
            "certificate. With course_uuid also each activity (done, when) and each assignment "
            "(status, grade, feedback, task scores). include adds the event timeline, engagement "
            "(time spent, active days) and code attempts. Omit user_uuid for your own; others need "
            "admin, or instructor rights on the course."
        ),
        params_model=GetLearnerProgressParams,
        tier=ActionTier.READ,
        rights_bucket="courses",
        access_action=AccessAction.READ,
        execute=_get_learner_progress,
        target_param="course_uuid",
        target_kind="course",
        title="Get learner progress",
    ),
]
