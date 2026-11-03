"""Course statistics: how a course and its assignments are going, in numbers.

One tool, two views:

* a course: enrollment and progress figures, then every published activity
  in course order with how many learners completed it (and, for code
  exercises, how many tried and passed), then every published assignment
  with submission counts by status and grade figures;
* one assignment: submission counts by status (not started, in progress,
  handed in, graded, late, overdue), grade average, median, pass rate and
  distribution, per-task scores, per-question correct rates for the answers
  the server can check (quiz, fill in the blanks, short and numeric
  answers), and the learners who have not handed in yet.

Everything is read from Postgres (trail steps, submissions, code attempts),
so it works without the analytics pipeline. Only answers that were handed
in count toward task and question figures; drafts do not.

Who may look: instructors of the course and org admins (the people who see
every submission). API tokens need the ``courses`` read right and a Pro
plan, like the other learner tools, and the ``assignments`` read right for
assignment figures.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from fastapi import HTTPException
from pydantic import Field, model_validator
from sqlalchemy import case, distinct, func
from sqlmodel import select

from src.db.code_submissions import CodeSubmission
from src.db.courses.assignments import (
    Assignment,
    AssignmentTask,
    AssignmentTaskSubmission,
    AssignmentTaskTypeEnum,
    AssignmentUserSubmissionStatus,
)
from src.db.courses.courses import Course
from src.db.trail_steps import TrailStep
from src.db.user_organizations import UserOrganization
from src.security.rbac import AccessAction
from src.services.ai.tools import refs, results
from src.services.ai.tools.base import ActionTier, ToolContext, ToolSpec
from src.services.ai.tools.learners import (
    OPEN_BUCKETS,
    AssignmentWork,
    _is_token,
    _parsed,
    _require_pro_for_token,
    activity_ref,
    assignment_work,
    can_see_course_learners,
    certificate_state,
    completed_by_user,
    course_ref,
    enrolled_runs,
    grade_of,
    is_complete,
    iso,
    last_step_by_user,
    latest,
    mean,
    median,
    member_refs,
    may_see_assignment_work,
    published_activities,
    work_status,
)
from src.services.audit.answers import humanize_task_answer
from src.services.courses.activities.assignments import _is_assignment_past_due

MAX_ASSIGNMENTS = 100
MAX_QUESTIONS = 50
MAX_OPTIONS = 10
CHECKABLE = {
    AssignmentTaskTypeEnum.QUIZ,
    AssignmentTaskTypeEnum.FORM,
    AssignmentTaskTypeEnum.SHORT_ANSWER,
    AssignmentTaskTypeEnum.NUMBER_ANSWER,
}
HANDED_IN = ("submitted", "graded")


class GetCourseStatsParams(results.Paging):
    course_uuid: str | None = Field(
        None, max_length=100, description="The course: activity completion and assignment figures."
    )
    assignment_uuid: str | None = Field(
        None,
        max_length=100,
        description=(
            "Or one assignment: status counts, grades, per-task and per-question results, "
            "and (as items) who has not handed in."
        ),
    )

    @model_validator(mode="after")
    def _a_target(self):
        if not self.course_uuid and not self.assignment_uuid:
            raise ValueError("pass course_uuid, assignment_uuid, or both")
        return self


def _rate(part: int, whole: int) -> float | None:
    return round(part / whole * 100, 1) if whole else None


def _low(value: Any) -> str | None:
    if value is None:
        return None
    return (value.value if hasattr(value, "value") else str(value)).lower()


async def _members(ctx: ToolContext, user_ids: set[int]) -> set[int]:
    if not user_ids:
        return set()
    rows = (
        await ctx.db_session.execute(
            select(UserOrganization.user_id).where(
                UserOrganization.org_id == ctx.org.id,
                UserOrganization.user_id.in_(user_ids),  # type: ignore[attr-defined]
            )
        )
    ).scalars().all()
    return set(rows)


async def _leavers(ctx: ToolContext, enrolled: set[int], work: AssignmentWork) -> set[int]:
    """Members who have a submission but are no longer enrolled."""
    return await _members(ctx, {user_id for (_, user_id) in work.submissions} - enrolled)


def _population(a: Assignment, enrolled: set[int], leavers: set[int], work: AssignmentWork) -> set[int]:
    """Who an assignment is for: enrolled learners, plus members who handed
    something in to it and have since left the course."""
    return enrolled | {u for (aid, u) in work.submissions if aid == a.id and u in leavers}


def _assignment_counts(a: Assignment, work: AssignmentWork, people: set[int]) -> dict:
    counts = {"learners": len(people), "not_started": 0, "in_progress": 0, "submitted": 0, "graded": 0, "late": 0, "overdue": 0}
    past_due = _is_assignment_past_due(a)
    percents, passed = [], 0
    for user_id in people:
        sub = work.submissions.get((a.id, user_id))
        status = work_status(sub)
        counts[status] += 1
        if sub is not None and sub.submission_status == AssignmentUserSubmissionStatus.LATE:
            counts["late"] += 1
        if status in OPEN_BUCKETS and past_due:
            counts["overdue"] += 1
        grade = grade_of(a, work.max_points.get(a.id, 0), sub)
        if grade:
            percents.append(grade["percentage"])
            passed += 1 if grade["passed"] else 0
    grades = {
        "graded": len(percents),
        "average_percent": mean(percents),
        "median_percent": median(percents),
        "pass_rate": _rate(passed, len(percents)),
    }
    return {"counts": counts, "grades": grades, "_percents": percents}


# ─── executor ────────────────────────────────────────────────────────────────


async def _get_course_stats(ctx: ToolContext, p: GetCourseStatsParams):
    assignment = await refs.load(ctx, "assignment", p.assignment_uuid) if p.assignment_uuid else None
    if assignment is not None:
        course = await ctx.db_session.get(Course, assignment.course_id)
        if course is None or course.org_id != ctx.org.id:
            raise refs.not_found("assignment", p.assignment_uuid)
        if p.course_uuid and p.course_uuid != course.course_uuid:
            raise HTTPException(status_code=400, detail="That assignment is not in that course.")
    else:
        course = await refs.load(ctx, "course", p.course_uuid)

    if _is_token(ctx):
        await _require_pro_for_token(ctx)
    elif not await can_see_course_learners(ctx, course):
        raise HTTPException(
            status_code=403,
            detail="Only instructors of this course and admins can see its statistics.",
        )
    see_work = await may_see_assignment_work(ctx, course)
    if assignment is not None:
        if not see_work:
            raise HTTPException(
                status_code=403,
                detail="Assignment statistics need the assignments read right on an API token.",
            )
        return await _assignment_view(ctx, p, course, assignment)
    return await _course_view(ctx, p, course, see_work)


async def _course_view(ctx: ToolContext, p: GetCourseStatsParams, course: Course, see_work: bool) -> dict:
    runs = await enrolled_runs(ctx, course)
    enrolled = {r.user_id for r in runs}
    listed = (await published_activities(ctx, [course.id])).get(course.id, [])
    ids = {a.id for a, _ in listed}
    done = await completed_by_user(ctx, course.id, ids, enrolled) if enrolled else {}
    last_steps = await last_step_by_user(ctx, course.id, enrolled) if enrolled else {}
    with_cert, earned = await certificate_state(ctx, [course.id], enrolled)

    percents, completed, not_started, active_7 = [], 0, 0, 0
    week_ago = datetime.now() - timedelta(days=7)
    for run in runs:
        n = len(done.get(run.user_id, ()))
        percents.append(round(n / len(ids) * 100, 1) if ids else 0.0)
        if is_complete(run, n, len(ids)):
            completed += 1
        elif n == 0:
            not_started += 1
        last = _parsed(latest(last_steps.get(run.user_id), run.update_date))
        if last is not None and last >= week_ago:
            active_7 += 1
    summary: dict[str, Any] = {
        "enrolled": len(runs),
        "completed": completed,
        "completion_rate": _rate(completed, len(runs)),
        "not_started": not_started,
        "average_percent": mean(percents),
        "median_percent": median(percents),
        "active_last_7_days": active_7,
        "published_activities": len(ids),
    }
    if with_cert:
        summary["certificates_earned"] = len(earned)

    # Completions per activity, counting enrolled members only.
    per_activity: dict[int, tuple[int, str | None]] = {}
    if ids and enrolled:
        for activity_id, users, last in (
            await ctx.db_session.execute(
                select(TrailStep.activity_id, func.count(distinct(TrailStep.user_id)), func.max(TrailStep.creation_date))
                .where(
                    TrailStep.course_id == course.id,
                    TrailStep.complete == True,  # noqa: E712
                    TrailStep.activity_id.in_(ids),  # type: ignore[attr-defined]
                    TrailStep.user_id.in_(enrolled),  # type: ignore[attr-defined]
                )
                .group_by(TrailStep.activity_id)
            )
        ).all():
            per_activity[activity_id] = (int(users), last)

    # Code exercise attempts per activity.
    code: dict[str, dict] = {}
    uuids = [a.activity_uuid for a, _ in listed]
    if uuids:
        passed_user = case((CodeSubmission.passed == True, CodeSubmission.user_id))  # noqa: E712
        for activity_uuid, attempts, tried, passed in (
            await ctx.db_session.execute(
                select(
                    CodeSubmission.activity_uuid,
                    func.count(CodeSubmission.id),
                    func.count(distinct(CodeSubmission.user_id)),
                    func.count(distinct(passed_user)),
                )
                .where(CodeSubmission.activity_uuid.in_(uuids))  # type: ignore[attr-defined]
                .group_by(CodeSubmission.activity_uuid)
            )
        ).all():
            code[activity_uuid] = {"attempts": int(attempts), "learners_tried": int(tried), "learners_passed": int(passed)}

    work = await assignment_work(ctx, [course.id]) if see_work else None
    by_activity = {a.activity_id: a for a in work.assignments} if work else {}
    leavers = await _leavers(ctx, enrolled, work) if work else set()

    items = []
    for a, _chapter in listed:
        n, last = per_activity.get(a.id, (0, None))
        item: dict[str, Any] = {
            "activity": await activity_ref(ctx, a, course.course_uuid),
            "completed": n,
            "completion_rate": _rate(n, len(runs)),
            "last_completed_at": iso(last),
        }
        if a.activity_uuid in code:
            item["code_exercise"] = code[a.activity_uuid]
        linked = by_activity.get(a.id)
        if linked is not None:
            item["assignment"] = refs.ref("assignment", linked.assignment_uuid, linked.title)
        items.append(item)

    extra: dict[str, Any] = {"course": await course_ref(ctx, course), "summary": summary}
    if work is not None:
        rows = []
        for a in work.assignments[:MAX_ASSIGNMENTS]:
            figures = _assignment_counts(a, work, _population(a, enrolled, leavers, work))
            rows.append(
                {
                    "assignment": refs.ref(
                        "assignment", a.assignment_uuid, a.title,
                        await refs.web_url(ctx, "assignment", assignment=a.assignment_uuid),
                    ),
                    "due_date": a.due_date or None,
                    "past_due": _is_assignment_past_due(a),
                    "graded": not a.ungraded,
                    "counts": figures["counts"],
                    "grades": figures["grades"] if not a.ungraded else None,
                }
            )
        extra["assignments"] = rows
        if len(work.assignments) > MAX_ASSIGNMENTS:
            extra["assignments_truncated"] = True
    notes = []
    if not runs:
        notes.append("No one is enrolled in this course yet.")
    if not ids:
        notes.append("The course has no published activities.")
    if work is None:
        notes.append("Assignment figures are left out: an API token needs the assignments read right.")
    if notes:
        extra["note"] = " ".join(notes)
    # Activity and assignment names are written by members of the organization.
    return results.untrusted(results.page_of(items, p, **extra), "items")


async def _assignment_view(ctx: ToolContext, p: GetCourseStatsParams, course: Course, a: Assignment) -> dict:
    runs = await enrolled_runs(ctx, course)
    enrolled = {r.user_id for r in runs}
    enrolled_at = {r.user_id: r.creation_date for r in runs}
    work = await assignment_work(ctx, [course.id], only=[a.id])
    people = _population(a, enrolled, await _leavers(ctx, enrolled, work), work)
    figures = _assignment_counts(a, work, people)

    tasks = (
        await ctx.db_session.execute(
            select(AssignmentTask)
            .where(AssignmentTask.assignment_id == a.id)
            .order_by(AssignmentTask.order.asc().nulls_last(), AssignmentTask.id.asc())  # type: ignore[union-attr]
        )
    ).scalars().all()
    handed_in = {u for u in people if work_status(work.submissions.get((a.id, u))) in HANDED_IN}
    graded = {u for u in people if work_status(work.submissions.get((a.id, u))) == "graded"}
    answers: dict[int, list[AssignmentTaskSubmission]] = {}
    if tasks and handed_in:
        for ts in (
            await ctx.db_session.execute(
                select(AssignmentTaskSubmission).where(
                    AssignmentTaskSubmission.assignment_task_id.in_([t.id for t in tasks]),  # type: ignore[attr-defined]
                    AssignmentTaskSubmission.user_id.in_(handed_in),  # type: ignore[attr-defined]
                )
            )
        ).scalars().all():
            answers.setdefault(ts.assignment_task_id, []).append(ts)
    task_rows = [_task_stats(t, answers.get(t.id, []), graded) for t in tasks]

    distribution = None
    if figures["_percents"]:
        buckets = [0] * 10
        for pct in figures["_percents"]:
            buckets[min(int(pct // 10), 9)] += 1
        distribution = [
            {"range": f"{i * 10}-{i * 10 + 9 if i < 9 else 100}%", "count": n} for i, n in enumerate(buckets)
        ]
    grades = dict(figures["grades"])
    if figures["_percents"]:
        grades.update({"min_percent": min(figures["_percents"]), "max_percent": max(figures["_percents"]), "distribution": distribution})

    # Items: who has not handed in, by name.
    waiting = [u for u in people if work_status(work.submissions.get((a.id, u))) in OPEN_BUCKETS]
    names = await member_refs(ctx, set(waiting))
    past_due = _is_assignment_past_due(a)
    rows = []
    for u in waiting:
        sub = work.submissions.get((a.id, u))
        rows.append(
            {
                "learner": names.get(u) or refs.ref("user", None, "Unknown member"),
                "status": work_status(sub),
                "overdue": past_due,
                "started_at": iso(sub.creation_date) if sub is not None else None,
                "enrolled_at": iso(enrolled_at.get(u)),
            }
        )
    rows.sort(key=lambda r: (r["learner"].get("name") or "").lower())

    extra: dict[str, Any] = {
        "assignment": refs.ref(
            "assignment", a.assignment_uuid, a.title, await refs.web_url(ctx, "assignment", assignment=a.assignment_uuid)
        ),
        "course": await course_ref(ctx, course),
        "due_date": a.due_date or None,
        "past_due": past_due,
        "published": bool(a.published),
        "graded": not a.ungraded,
        "total_points": work.max_points.get(a.id, 0),
        "counts": figures["counts"],
        "grades": grades if not a.ungraded else None,
        "tasks": task_rows,
    }
    if not people:
        extra["note"] = "No one is enrolled in this course yet."
    elif not rows:
        extra["note"] = "Everyone has handed this assignment in."
    return results.untrusted(results.page_of(rows, p, **extra), "items", "tasks")


def _task_stats(task: AssignmentTask, answers: list[AssignmentTaskSubmission], graded: set[int]) -> dict:
    """Scores for one task over handed-in answers, and per-question correct
    rates where the server can check the answer."""
    points = int(task.max_grade_value or 0)
    scored = [ts for ts in answers if ts.user_id in graded or ts.manually_graded]
    out: dict[str, Any] = {
        "task": refs.ref("assignment_task", task.assignment_task_uuid, task.title),
        "type": _low(task.assignment_type),
        "points": points,
        "answered": len(answers),
        "average_score_percent": mean([min(int(ts.grade or 0), points) / points * 100 for ts in scored]) if points else None,
    }
    if task.assignment_type not in CHECKABLE or not answers:
        return out
    questions: dict[int, dict] = {}
    for ts in answers:
        rendered = humanize_task_answer(task.assignment_type, task.contents, ts.task_submission, task.title or "")
        for item in rendered.get("items") or []:
            if item.get("correct") is None:
                continue
            q = questions.setdefault(
                item["index"],
                {"question": results.clip(item.get("prompt") or "", 160), "answered": 0, "correct": 0, "_options": {}},
            )
            q["answered"] += 1
            q["correct"] += 1 if item["correct"] else 0
            for opt in item.get("options") or []:
                key = opt.get("letter")
                o = q["_options"].setdefault(
                    key, {"option": results.clip(opt.get("text") or "", 120), "right": opt.get("is_correct"), "picked": 0}
                )
                o["picked"] += 1 if opt.get("selected") else 0
    rows = []
    for index in sorted(questions)[:MAX_QUESTIONS]:
        q = questions[index]
        row = {k: q[k] for k in ("question", "answered", "correct")}
        row["correct_rate"] = _rate(q["correct"], q["answered"])
        if q["_options"]:
            row["options"] = list(q["_options"].values())[:MAX_OPTIONS]
        rows.append(row)
    if rows:
        out["questions"] = rows
    if len(questions) > MAX_QUESTIONS:
        out["questions_truncated"] = True
    return out


SPECS: list[ToolSpec] = [
    ToolSpec(
        name="get_course_stats",
        description=(
            "Numbers for a course or one assignment. Course: enrollment and progress figures, "
            "completion rate per activity (code exercises: tried and passed), and per assignment "
            "submission counts and grades. Assignment: counts by status (not started, in progress, "
            "handed in, graded, late, overdue), grade spread, per-task and per-question correct "
            "rates, and who has not handed in. Instructors of the course and admins."
        ),
        params_model=GetCourseStatsParams,
        tier=ActionTier.READ,
        rights_bucket="courses",
        access_action=AccessAction.READ,
        execute=_get_course_stats,
        target_param="course_uuid",
        target_kind="course",
        title="Get course stats",
    ),
]
