"""AI grading of assignment submissions: runs, drafts, applying, bulk, auto.

Flow of one run (``_grade_one``):
  1. read the learner's work locally (files, documents to text, media probed,
     audio extracted, frames sampled), with no model call yet;
  2. price it (``material.credit_cost``) and reserve that many AI credits,
     which refuses with the usual 403 when the org has run out;
  3. transcribe audio/video and ask the model for a grade;
  4. on any failure, refund the reservation and record a FAILED row;
  5. store the result as a DRAFT, or apply it as the grade (AUTO mode).

Only someone who can grade the assignment (course UPDATE) may run, read,
accept or discard AI grades; learners never see a draft. An applied grade goes
through the same ``_apply_grade_and_finalize`` as a manual one, so the learner
gets the same webhook, audit trail and certificate check.
"""

from __future__ import annotations

import asyncio
import logging
import os
import tempfile
from datetime import datetime
from typing import Any, Optional
from uuid import uuid4

from fastapi import HTTPException, Request
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm.attributes import flag_modified
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.activities import Activity
from src.db.courses.assignment_ai_grades import (
    AIGradeStatusEnum,
    AssignmentAIGrade,
    AssignmentAIGradeAccept,
    AssignmentAIGradeRead,
)
from src.db.courses.assignments import (
    AIGradingModeEnum,
    Assignment,
    AssignmentTask,
    AssignmentTaskSubmission,
    AssignmentUserSubmission,
    AssignmentUserSubmissionStatus,
)
from src.db.courses.courses import Course
from src.db.organizations import Organization
from src.db.users import AnonymousUser, APITokenUser, PublicUser
from src.security.features_utils.usage import get_ai_credits_summary
from src.services.ai import metering
from src.security.rbac import AccessAction
from src.services.ai.grading import material as mat
from src.services.ai.grading.grader import grade_with_model, normalize
from src.services.ai.llm import AINotConfiguredError, resolve_model_for_org
from src.services.security.rate_limiting import enforce_ai_rate_limit

logger = logging.getLogger(__name__)

# Submissions graded per bulk request; the dashboard calls again for the next
# batch, so one HTTP request never holds minutes of model calls.
BULK_BATCH_SIZE = 5
MAX_BULK_BATCH_SIZE = 10
# The bulk estimate reads every file it prices; past this many submissions it
# extrapolates from the ones it read.
MAX_ESTIMATE_SUBMISSIONS = 100
_HANDED_IN = (AssignmentUserSubmissionStatus.SUBMITTED, AssignmentUserSubmissionStatus.LATE)
_GRADABLE = (*_HANDED_IN, AssignmentUserSubmissionStatus.GRADED)

_background_tasks: set[asyncio.Task] = set()


def _now() -> str:
    return str(datetime.now())


def _read(row: AssignmentAIGrade) -> AssignmentAIGradeRead:
    return AssignmentAIGradeRead.model_validate(row, from_attributes=True)


def _native_pdf() -> bool:
    """Whether the configured provider reads PDFs (and so scans) natively."""
    from config.config import get_learnhouse_config
    from src.services.ai.llm.provider import _GOOGLE_ALIASES, DEFAULT_PROVIDER

    provider = (getattr(get_learnhouse_config().ai_config, "provider", None) or "").strip().lower()
    return (provider or DEFAULT_PROVIDER) in _GOOGLE_ALIASES


# ── Loading + authorization ─────────────────────────────────────────────────


class _Ctx:
    def __init__(self, assignment: Assignment, course: Course, org: Organization, activity: Activity, tasks: list):
        self.assignment = assignment
        self.course = course
        self.org = org
        self.activity = activity
        self.tasks = tasks


async def _load_ctx(db: AsyncSession, *, assignment_uuid: str | None = None, assignment_id: int | None = None) -> _Ctx:
    stmt = select(Assignment)
    stmt = stmt.where(Assignment.assignment_uuid == assignment_uuid) if assignment_uuid else stmt.where(Assignment.id == assignment_id)
    assignment = (await db.execute(stmt)).scalars().first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    course = (await db.execute(select(Course).where(Course.id == assignment.course_id))).scalars().first()
    org = (await db.execute(select(Organization).where(Organization.id == assignment.org_id))).scalars().first()
    activity = (await db.execute(select(Activity).where(Activity.id == assignment.activity_id))).scalars().first()
    if not course or not org or not activity:
        raise HTTPException(status_code=404, detail="Course not found")
    tasks = list(
        (await db.execute(select(AssignmentTask).where(AssignmentTask.assignment_id == assignment.id))).scalars().all()
    )
    tasks.sort(key=lambda t: (t.order is None, t.order if t.order is not None else 0, t.id or 0))
    return _Ctx(assignment, course, org, activity, tasks)


async def _authorize(request: Request, db: AsyncSession, current_user, ctx: _Ctx) -> None:
    """Course graders only (UPDATE), and only as a signed-in person: an AI run
    spends the org's credits, so API tokens and anonymous callers are refused."""
    from src.services.courses.activities.assignments import _block_api_tokens, authorize_assignment_access

    _block_api_tokens(current_user)
    if isinstance(current_user, AnonymousUser):
        raise HTTPException(status_code=401, detail="Authentication required")
    await authorize_assignment_access(request, db, current_user, ctx.course.course_uuid, AccessAction.UPDATE)


def _require_enabled(assignment: Assignment) -> None:
    if assignment.ungraded:
        raise HTTPException(status_code=400, detail="This assignment is ungraded (formative) and cannot be graded.")
    if (assignment.ai_grading_mode or AIGradingModeEnum.SUGGEST) == AIGradingModeEnum.OFF:
        raise HTTPException(status_code=400, detail="AI grading is turned off for this assignment.")


async def _user_submission(db: AsyncSession, assignment_id: int, user_id: int) -> AssignmentUserSubmission:
    sub = (
        await db.execute(
            select(AssignmentUserSubmission).where(
                AssignmentUserSubmission.assignment_id == assignment_id,
                AssignmentUserSubmission.user_id == user_id,
            )
        )
    ).scalars().first()
    if not sub:
        raise HTTPException(status_code=404, detail="Assignment User Submission not found")
    return sub


async def _task_submissions(db: AsyncSession, tasks: list, user_id: int) -> dict:
    ids = [t.id for t in tasks if t.id is not None]
    if not ids:
        return {}
    rows = (
        await db.execute(
            select(AssignmentTaskSubmission).where(
                AssignmentTaskSubmission.user_id == user_id,
                AssignmentTaskSubmission.assignment_task_id.in_(ids),  # type: ignore[attr-defined]
            )
        )
    ).scalars().all()
    return {r.assignment_task_id: r for r in rows}


async def _row(db: AsyncSession, assignment_id: int, user_id: int) -> Optional[AssignmentAIGrade]:
    return (
        await db.execute(
            select(AssignmentAIGrade).where(
                AssignmentAIGrade.assignment_id == assignment_id,
                AssignmentAIGrade.user_id == user_id,
            )
        )
    ).scalars().first()


async def applied_ai_grade(
    db: AsyncSession, assignment_id: int, user_id: int, user_sub: AssignmentUserSubmission
) -> Optional[AssignmentAIGrade]:
    """The applied AI grade behind the learner's current, graded attempt."""
    if user_sub.submission_status != AssignmentUserSubmissionStatus.GRADED:
        return None
    row = await _row(db, assignment_id, user_id)
    if (
        row is None
        or row.status != AIGradeStatusEnum.APPLIED.value
        or int(row.attempt_number or 1) != int(user_sub.attempt_number or 1)
    ):
        return None
    return row


async def _save_row(db: AsyncSession, ctx: _Ctx, user_sub: AssignmentUserSubmission, **fields: Any) -> AssignmentAIGrade:
    """Insert or replace the (assignment, learner) row."""
    row = await _row(db, ctx.assignment.id, user_sub.user_id)  # type: ignore[arg-type]
    now = _now()
    if row is None:
        row = AssignmentAIGrade(
            assignment_ai_grade_uuid=f"aigrade_{uuid4()}",
            assignment_id=ctx.assignment.id,  # type: ignore[arg-type]
            user_id=user_sub.user_id,
            org_id=ctx.org.id,  # type: ignore[arg-type]
            creation_date=now,
        )
    defaults = {
        "overall_feedback": None, "tasks": [], "confidence": None, "notes": None, "sources": [],
        "credits_charged": 0, "model": None, "error": None, "applied_by": None,
    }
    for key, value in {**defaults, **fields}.items():
        setattr(row, key, value)
    row.attempt_number = int(user_sub.attempt_number or 1)
    row.update_date = now
    flag_modified(row, "tasks")
    flag_modified(row, "sources")
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


async def _record_failure(db: AsyncSession, ctx: _Ctx, user_sub: AssignmentUserSubmission, **fields: Any) -> None:
    """Record a failed run, unless the learner already has a draft or an applied
    AI grade for this attempt: a failed retry must not wipe those."""
    row = await _row(db, ctx.assignment.id, user_sub.user_id)  # type: ignore[arg-type]
    if (
        row is not None
        and row.status in (AIGradeStatusEnum.DRAFT.value, AIGradeStatusEnum.APPLIED.value)
        and int(row.attempt_number or 1) == int(user_sub.attempt_number or 1)
    ):
        return
    await _save_row(db, ctx, user_sub, status=AIGradeStatusEnum.FAILED.value, **fields)


# ── One run ─────────────────────────────────────────────────────────────────


async def _grade_one(
    db: AsyncSession,
    ctx: _Ctx,
    user_sub: AssignmentUserSubmission,
    *,
    triggered_by: Optional[int],
    apply: bool,
    request: Optional[Request],
) -> AssignmentAIGrade:
    mode = AIGradingModeEnum.AUTO.value if apply else AIGradingModeEnum.SUGGEST.value
    subs = await _task_submissions(db, ctx.tasks, user_sub.user_id)
    org_id = int(ctx.org.id)  # type: ignore[arg-type]
    # Read before any rollback below expires the loaded rows.
    assignment_uuid = ctx.assignment.assignment_uuid
    with tempfile.TemporaryDirectory(prefix="lh-aigrade-") as work_dir:
        material = await mat.load_material(
            tasks=ctx.tasks,
            submissions_by_task_id=subs,
            org_uuid=ctx.org.org_uuid,
            course_uuid=ctx.course.course_uuid,
            activity_uuid=ctx.activity.activity_uuid,
            assignment_uuid=ctx.assignment.assignment_uuid,
            work_dir=work_dir,
            native_pdf=_native_pdf(),
        )
        cost = mat.credit_cost(material)
        try:
            meter = await metering.start(
                "ai_grading", org_id=org_id, db=db, user_id=triggered_by, minimum=cost
            )
        except HTTPException as e:
            await _record_failure(
                db, ctx, user_sub, mode=mode,
                error=str(e.detail), sources=material.sources(), triggered_by=triggered_by,
            )
            raise
        model_name = None
        try:
            model_name = await resolve_model_for_org(org_id, db)
            with metering.use_meter(meter):
                await mat.transcribe_media(material, model_name)
                output = await grade_with_model(ctx.assignment, material, model_name, mat.MAX_IMAGES)
            rows = normalize(output, material)
            # Never less than the published price; more if the run cost more.
            cost = meter.credits_due()
        except Exception as e:
            await meter.settle(failed=True)
            not_configured = isinstance(e, AINotConfiguredError)
            if not not_configured:
                logger.exception("AI grading failed for assignment %s user %s", assignment_uuid, user_sub.user_id)
            await _record_failure(
                db, ctx, user_sub, mode=mode, model=model_name,
                error=str(e) if not_configured else "The AI grader could not grade this submission.",
                sources=material.sources(), triggered_by=triggered_by,
            )
            if not_configured:
                raise HTTPException(status_code=403, detail=str(e))
            raise HTTPException(status_code=502, detail="AI grading failed. No credits were used; please try again.")

    try:
        row = await _save_row(
            db, ctx, user_sub,
            status=AIGradeStatusEnum.DRAFT.value, mode=mode,
            overall_feedback=output.overall_feedback.strip(), tasks=rows,
            confidence=output.confidence, notes=output.notes.strip() or None,
            sources=material.sources(), credits_charged=cost, model=model_name,
            triggered_by=triggered_by,
        )
    except Exception:
        await db.rollback()
        await meter.settle(failed=True)
        logger.exception("Saving the AI grade failed for assignment %s", assignment_uuid)
        raise HTTPException(status_code=502, detail="AI grading failed. No credits were used; please try again.")
    await meter.settle()

    if apply:
        await _apply(db, ctx, row, user_sub, applied_by=None, body=None, request=request)
    return row


async def _apply(
    db: AsyncSession,
    ctx: _Ctx,
    row: AssignmentAIGrade,
    user_sub: AssignmentUserSubmission,
    *,
    applied_by: Optional[int],
    body: Optional[AssignmentAIGradeAccept],
    request: Optional[Request],
) -> dict:
    """Write the AI grade (with a teacher's edits) onto the submission."""
    from src.services.courses.activities.assignments import _apply_grade_and_finalize
    from src.services.courses.certifications import (
        are_course_assignments_passed,
        check_course_completion_and_create_certificate,
        revoke_user_certificate,
    )

    overrides = {o.assignment_task_uuid: o for o in (body.tasks or [])} if body else {}
    tasks_by_uuid = {t.assignment_task_uuid: t for t in ctx.tasks}
    subs = await _task_submissions(db, ctx.tasks, user_sub.user_id)
    final_rows = []
    for item in row.tasks or []:
        item = dict(item)
        task = tasks_by_uuid.get(item.get("assignment_task_uuid"))
        ts = subs.get(task.id) if task is not None else None
        override = overrides.get(item.get("assignment_task_uuid"))
        if override is not None and override.feedback is not None:
            item["feedback"] = override.feedback
        if override is not None and override.score is not None and item.get("scored_by") == "ai" and task is not None:
            item["score"] = int(round(min(max(float(override.score), 0.0), float(task.max_grade_value or 0))))
        if ts is not None:
            # AI-scored tasks are flagged like a teacher's grade so the
            # aggregate pass does not re-verify them back to an exact match;
            # checker tasks keep the checker's score (re-verified as usual).
            ts.grade = int(item.get("score") or 0)
            if item.get("scored_by") == "ai":
                ts.manually_graded = True
            if item.get("feedback"):
                ts.task_submission_grade_feedback = item["feedback"]
            ts.update_date = _now()
            db.add(ts)
        final_rows.append(item)

    overall = body.overall_feedback if body and body.overall_feedback is not None else row.overall_feedback
    row.tasks = final_rows
    row.overall_feedback = overall
    row.status = AIGradeStatusEnum.APPLIED.value
    row.applied_by = applied_by
    row.update_date = _now()
    flag_modified(row, "tasks")
    db.add(row)
    await db.commit()

    computed = await _apply_grade_and_finalize(
        assignment=ctx.assignment,
        course=ctx.course,
        user_id=user_sub.user_id,
        assignment_user_submission=user_sub,
        db_session=db,
        overall_feedback=overall or "",
        auto_graded=applied_by is None,
        assignment_tasks=ctx.tasks,
        # AI grading lands after the learner has left: tell them either way.
        notify_learner=True,
    )
    try:
        await check_course_completion_and_create_certificate(request, user_sub.user_id, ctx.course.id, db)  # type: ignore[arg-type]
        if not await are_course_assignments_passed(user_sub.user_id, ctx.course.id, db):  # type: ignore[arg-type]
            await revoke_user_certificate(user_sub.user_id, ctx.course.id, db, reason="regraded_below_threshold")  # type: ignore[arg-type]
    except Exception:
        logger.warning("Certificate check after AI grading failed", exc_info=True)
    return computed


# ── Endpoints' services ─────────────────────────────────────────────────────


async def run_ai_grading(
    request: Request,
    assignment_uuid: str,
    user_id: int,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db: AsyncSession,
) -> AssignmentAIGradeRead:
    """Grade one learner's submission. SUGGEST mode stores a draft; AUTO mode
    applies it, except on an already graded submission, which only gets a
    draft so a teacher's grade is never silently replaced."""
    ctx = await _load_ctx(db, assignment_uuid=assignment_uuid)
    await _authorize(request, db, current_user, ctx)
    _require_enabled(ctx.assignment)
    user_sub = await _user_submission(db, ctx.assignment.id, user_id)  # type: ignore[arg-type]
    if user_sub.submission_status not in _GRADABLE:
        raise HTTPException(status_code=400, detail="This learner has not handed in an attempt yet; nothing to grade.")
    enforce_ai_rate_limit(current_user.id, int(ctx.org.id))  # type: ignore[arg-type]
    apply = (
        ctx.assignment.ai_grading_mode == AIGradingModeEnum.AUTO
        and user_sub.submission_status in _HANDED_IN
    )
    row = await _grade_one(db, ctx, user_sub, triggered_by=current_user.id, apply=apply, request=request)
    return _read(row)


async def get_ai_grade(
    request: Request, assignment_uuid: str, user_id: int, current_user, db: AsyncSession
) -> Optional[AssignmentAIGradeRead]:
    ctx = await _load_ctx(db, assignment_uuid=assignment_uuid)
    await _authorize(request, db, current_user, ctx)
    user_sub = await _user_submission(db, ctx.assignment.id, user_id)  # type: ignore[arg-type]
    row = await _row(db, ctx.assignment.id, user_id)  # type: ignore[arg-type]
    if row is None or int(row.attempt_number or 1) != int(user_sub.attempt_number or 1):
        return None
    return _read(row)


async def accept_ai_grade(
    request: Request,
    assignment_uuid: str,
    user_id: int,
    body: Optional[AssignmentAIGradeAccept],
    current_user,
    db: AsyncSession,
) -> dict:
    ctx = await _load_ctx(db, assignment_uuid=assignment_uuid)
    await _authorize(request, db, current_user, ctx)
    if ctx.assignment.ungraded:
        raise HTTPException(status_code=400, detail="This assignment is ungraded (formative) and cannot be graded.")
    user_sub = await _user_submission(db, ctx.assignment.id, user_id)  # type: ignore[arg-type]
    row = await _row(db, ctx.assignment.id, user_id)  # type: ignore[arg-type]
    if (
        row is None
        or row.status != AIGradeStatusEnum.DRAFT.value
        or int(row.attempt_number or 1) != int(user_sub.attempt_number or 1)
    ):
        raise HTTPException(status_code=404, detail="No AI draft to accept for this submission")
    if user_sub.submission_status not in _GRADABLE:
        raise HTTPException(status_code=400, detail="This learner has not handed in an attempt yet; nothing to grade.")
    computed = await _apply(db, ctx, row, user_sub, applied_by=current_user.id, body=body, request=request)
    return {"message": f"Assignment User Submission graded: {computed['display_grade']}", **computed, "ai_grade": _read(row).model_dump()}


async def discard_ai_grade(request: Request, assignment_uuid: str, user_id: int, current_user, db: AsyncSession) -> dict:
    ctx = await _load_ctx(db, assignment_uuid=assignment_uuid)
    await _authorize(request, db, current_user, ctx)
    row = await _row(db, ctx.assignment.id, user_id)  # type: ignore[arg-type]
    if row is None or row.status not in (AIGradeStatusEnum.DRAFT.value, AIGradeStatusEnum.FAILED.value):
        raise HTTPException(status_code=404, detail="No AI draft to discard for this submission")
    row.status = AIGradeStatusEnum.DISCARDED.value
    row.update_date = _now()
    db.add(row)
    await db.commit()
    return {"detail": "discarded"}


async def _bulk_targets(db: AsyncSession, assignment_id: int) -> list[AssignmentUserSubmission]:
    """Handed-in, ungraded submissions with no AI draft for this attempt yet."""
    subs = (
        await db.execute(
            select(AssignmentUserSubmission)
            .where(
                AssignmentUserSubmission.assignment_id == assignment_id,
                AssignmentUserSubmission.submission_status.in_(_HANDED_IN),  # type: ignore[attr-defined]
            )
            .order_by(AssignmentUserSubmission.id)
        )
    ).scalars().all()
    rows = (
        await db.execute(select(AssignmentAIGrade).where(AssignmentAIGrade.assignment_id == assignment_id))
    ).scalars().all()
    done = {
        (r.user_id, int(r.attempt_number or 1))
        for r in rows
        if r.status in (AIGradeStatusEnum.DRAFT.value, AIGradeStatusEnum.APPLIED.value)
    }
    return [s for s in subs if (s.user_id, int(s.attempt_number or 1)) not in done]


async def estimate_ai_grading(
    request: Request,
    assignment_uuid: str,
    current_user,
    db: AsyncSession,
    user_id: Optional[int] = None,
) -> dict:
    """Credits a run would cost: one learner (``user_id``) or every submission
    the bulk run would grade. Reads the files, calls no model."""
    ctx = await _load_ctx(db, assignment_uuid=assignment_uuid)
    await _authorize(request, db, current_user, ctx)
    if user_id is not None:
        targets = [await _user_submission(db, ctx.assignment.id, user_id)]  # type: ignore[arg-type]
    else:
        targets = await _bulk_targets(db, ctx.assignment.id)  # type: ignore[arg-type]
    sample = targets[:MAX_ESTIMATE_SUBMISSIONS]
    items = []
    with tempfile.TemporaryDirectory(prefix="lh-aigrade-est-") as work_dir:
        for sub in sample:
            sub_dir = os.path.join(work_dir, str(sub.user_id))
            os.makedirs(sub_dir, exist_ok=True)
            material = await mat.load_material(
                tasks=ctx.tasks,
                submissions_by_task_id=await _task_submissions(db, ctx.tasks, sub.user_id),
                org_uuid=ctx.org.org_uuid,
                course_uuid=ctx.course.course_uuid,
                activity_uuid=ctx.activity.activity_uuid,
                assignment_uuid=ctx.assignment.assignment_uuid,
                work_dir=sub_dir,
                light=True,
            )
            items.append(
                {
                    "user_id": sub.user_id,
                    "credits": mat.credit_cost(material),
                    "media_seconds": round(sum(f.billable_seconds for f in material.files()), 1),
                    "files": len(material.files()),
                }
            )
    total = sum(i["credits"] for i in items)
    if len(targets) > len(sample) and sample:
        total = round(total / len(sample) * len(targets))
    summary = await get_ai_credits_summary(int(ctx.org.id), db)  # type: ignore[arg-type]
    return {
        "submissions": len(targets),
        "credits": total,
        "estimated": len(targets) > len(sample),
        "items": items,
        "remaining_credits": summary.get("remaining_credits") if isinstance(summary, dict) else None,
        "mode": (ctx.assignment.ai_grading_mode or AIGradingModeEnum.SUGGEST).value,
        "pricing": {
            "base": mat.BASE_CREDITS,
            "media_seconds_per_credit": mat.MEDIA_SECONDS_PER_CREDIT,
            "document_chars_per_credit": mat.DOC_CHARS_PER_CREDIT,
            "free_images": mat.FREE_IMAGES,
            "images_per_credit": mat.IMAGES_PER_CREDIT,
            "max_media_seconds": mat.MAX_MEDIA_SECONDS,
        },
    }


async def bulk_ai_grade(
    request: Request,
    assignment_uuid: str,
    current_user,
    db: AsyncSession,
    limit: int = BULK_BATCH_SIZE,
) -> dict:
    """Grade the next batch of ungraded submissions. Each one reserves its own
    credits; the batch stops cleanly (``stopped``) when credits run out or the
    AI rate limit is hit. Call again while ``remaining`` > 0."""
    ctx = await _load_ctx(db, assignment_uuid=assignment_uuid)
    await _authorize(request, db, current_user, ctx)
    _require_enabled(ctx.assignment)
    limit = max(1, min(int(limit or BULK_BATCH_SIZE), MAX_BULK_BATCH_SIZE))
    targets = await _bulk_targets(db, ctx.assignment.id)  # type: ignore[arg-type]
    apply = ctx.assignment.ai_grading_mode == AIGradingModeEnum.AUTO
    results: list[dict] = []
    stopped: Optional[str] = None
    stop_detail: Optional[str] = None
    for sub in targets[:limit]:
        try:
            enforce_ai_rate_limit(current_user.id, int(ctx.org.id))  # type: ignore[arg-type]
        except HTTPException as e:
            stopped, stop_detail = "rate_limited", "Too many AI requests. Please wait a minute and continue."
            logger.info("Bulk AI grading paused by the rate limit: %s", e.detail)
            break
        try:
            row = await _grade_one(db, ctx, sub, triggered_by=current_user.id, apply=apply, request=request)
            results.append({"user_id": sub.user_id, "status": row.status, "credits": row.credits_charged})
        except HTTPException as e:
            if e.status_code == 403:
                stopped, stop_detail = "no_credits", str(e.detail)
                break
            results.append({"user_id": sub.user_id, "status": AIGradeStatusEnum.FAILED.value, "credits": 0, "error": str(e.detail)})
    graded = sum(1 for r in results if r["status"] == AIGradeStatusEnum.APPLIED.value)
    drafted = sum(1 for r in results if r["status"] == AIGradeStatusEnum.DRAFT.value)
    failed = sum(1 for r in results if r["status"] == AIGradeStatusEnum.FAILED.value)
    return {
        "results": results,
        "graded": graded,
        "drafted": drafted,
        "failed": failed,
        "credits_used": sum(r["credits"] for r in results),
        "remaining": max(0, len(targets) - len(results)),
        "stopped": stopped,
        "stop_detail": stop_detail,
    }


# ── AUTO mode on hand-in ────────────────────────────────────────────────────


def schedule_auto_ai_grading(assignment_id: int, user_id: int) -> None:
    """Grade a fresh hand-in in the background (AUTO mode)."""
    task = asyncio.create_task(run_auto_ai_grading(assignment_id, user_id))
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)


async def run_auto_ai_grading(assignment_id: int, user_id: int, db: AsyncSession | None = None) -> Optional[AssignmentAIGrade]:
    """The background job. Never raises: when it cannot grade (no credits, AI
    off, model error) a FAILED row tells the teacher why and the submission
    stays SUBMITTED for them."""
    if db is None:
        from src.core.events.database import _async_session_factory

        async with _async_session_factory() as session:
            return await run_auto_ai_grading(assignment_id, user_id, session)
    try:
        ctx = await _load_ctx(db, assignment_id=assignment_id)
        if ctx.assignment.ungraded or ctx.assignment.ai_grading_mode != AIGradingModeEnum.AUTO:
            return None
        user_sub = await _user_submission(db, assignment_id, user_id)
        if user_sub.submission_status not in _HANDED_IN:
            return None
        return await _grade_one(db, ctx, user_sub, triggered_by=None, apply=True, request=None)
    except HTTPException as e:
        logger.info("Auto AI grading skipped for assignment %s user %s: %s", assignment_id, user_id, e.detail)
    except IntegrityError:
        logger.info("Auto AI grading raced another run for assignment %s user %s", assignment_id, user_id)
    except Exception:
        logger.exception("Auto AI grading failed for assignment %s user %s", assignment_id, user_id)
    return None
