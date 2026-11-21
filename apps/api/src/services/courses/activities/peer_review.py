"""Peer review on assignments.

Learners review each other's submitted work against an instructor rubric,
optionally after a self-review and a practice (calibration) round, then read
the feedback they received once they have done their share of reviews (or
the review deadline passed).

Rules this module keeps:

- Opt-in per assignment. Without a settings row, or with ``enabled = False``,
  every learner endpoint answers 404 and nothing about the assignment changes.
- Plan gate ``peer_review`` (Standard and up on SaaS, always on self-hosted).
  Enabling needs it; an org that lost it gets a 403 on learner endpoints while
  the assignment itself keeps working.
- Peer review only ever reads ``AssignmentUserSubmission``; it never writes a
  grade or a status.
- A reviewer sees exactly the submission they were assigned, with answer keys
  stripped and the other party's identity hidden as the anonymity mode says,
  including file names (files are streamed through the review endpoint).
- Every query is scoped to the assignment's organization.
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass
from datetime import datetime, timedelta
from types import SimpleNamespace
from typing import Any, Iterable, Optional
from uuid import uuid4

from fastapi import HTTPException, Request
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.activities import Activity
from src.db.courses.assignments import (
    Assignment,
    AssignmentTask,
    AssignmentTaskSubmission,
    AssignmentTaskTypeEnum,
    AssignmentUserSubmission,
    AssignmentUserSubmissionStatus,
)
from src.db.courses.courses import Course
from src.db.courses.peer_reviews import (
    DEFAULT_PROMPTS,
    MAX_COMMENT_CHARS,
    MAX_CRITERION_COMMENT_CHARS,
    AssignmentPeerReflection,
    AssignmentPeerReview,
    AssignmentPeerReviewSettings,
    PeerCalibrationBody,
    PeerDiscardBody,
    PeerFlagBody,
    PeerRateBody,
    PeerReflectionBody,
    PeerReviewSaveBody,
    PeerReviewSettingsUpdate,
    PeerSelfReviewBody,
)
from src.db.organizations import Organization
from src.db.users import AnonymousUser, APITokenUser, PublicUser, User
from src.security.rbac import AccessAction
from src.security.submission_file_access import submission_file_owner
from src.services.courses.activities.assignments import (
    _block_api_tokens,
    _is_assignment_instructor,
    _is_assignment_past_due,
    _strip_answer_key,
    authorize_assignment_access,
)

FEATURE = "peer_review"
REVIEWABLE_STATUSES = (
    AssignmentUserSubmissionStatus.SUBMITTED,
    AssignmentUserSubmissionStatus.GRADED,
    AssignmentUserSubmissionStatus.LATE,
)
# An assigned review older than this stops counting toward a submission's
# target, so others can pick that submission up. Its reviewer may still finish.
STALE_AFTER = timedelta(hours=24)
# Keys a FILE_SUBMISSION answer stores its on-disk file name under. The name
# carries the uploader's user id, so it never goes to a reviewer.
_FILE_KEYS = ("fileUUID", "file_uuid", "file_name", "fileName")
SUBMISSION_CHANGED = "submission_changed"
REVIEWER_RETRYING = "Hand in your new attempt before reviewing again"

User_ = PublicUser | AnonymousUser | APITokenUser


def _now() -> str:
    return str(datetime.now())


def _parse(ts: Optional[str]) -> Optional[datetime]:
    if not ts:
        return None
    try:
        parsed = datetime.fromisoformat(str(ts))
    except ValueError:
        return None
    return parsed.replace(tzinfo=None) if parsed.tzinfo else parsed


def _round(value: Optional[float]) -> Optional[float]:
    return None if value is None else round(float(value), 2)


# ---------------------------------------------------------------------------
# Context loading and access
# ---------------------------------------------------------------------------


@dataclass
class _Ctx:
    assignment: Assignment
    course: Course
    activity: Optional[Activity]
    settings: Optional[AssignmentPeerReviewSettings]


async def _load(db: AsyncSession, assignment: Optional[Assignment]) -> _Ctx:
    if assignment is None:
        raise HTTPException(status_code=404, detail="Assignment not found")
    course = (await db.execute(
        select(Course).where(Course.id == assignment.course_id, Course.org_id == assignment.org_id)
    )).scalars().first()
    if course is None:
        raise HTTPException(status_code=404, detail="Course not found")
    activity = (await db.execute(
        select(Activity).where(Activity.id == assignment.activity_id)
    )).scalars().first()
    settings = (await db.execute(
        select(AssignmentPeerReviewSettings).where(
            AssignmentPeerReviewSettings.assignment_id == assignment.id,
            AssignmentPeerReviewSettings.org_id == assignment.org_id,
        )
    )).scalars().first()
    return _Ctx(assignment, course, activity, settings)


async def _load_by_uuid(db: AsyncSession, assignment_uuid: str) -> _Ctx:
    assignment = (await db.execute(
        select(Assignment).where(Assignment.assignment_uuid == assignment_uuid)
    )).scalars().first()
    return await _load(db, assignment)


async def feature_available(db: AsyncSession, org_id: int) -> bool:
    """Whether the org's plan includes peer review (always, self-hosted).
    Same resolution as ``resolved_features.peer_review.enabled`` on the web."""
    from src.security.features_utils.resolve import resolve_feature
    from src.services.orgs.org_config_lookup import get_session_org_config

    row = await get_session_org_config(db, org_id)
    config = (row.config if row is not None else None) or {}
    return bool(resolve_feature(FEATURE, config, org_id)["enabled"])


async def _require_feature(db: AsyncSession, org_id: int) -> None:
    if not await feature_available(db, org_id):
        raise HTTPException(
            status_code=403,
            detail="Peer review requires the Standard plan or higher. Upgrade the organization's plan to use it.",
        )


def _is_enabled(settings: Optional[AssignmentPeerReviewSettings]) -> bool:
    return bool(settings is not None and settings.enabled)


async def _learner_ctx(request: Request, db: AsyncSession, user: User_, ctx: _Ctx) -> _Ctx:
    """Session learner on an assignment with peer review on and in plan."""
    _block_api_tokens(user)
    if isinstance(user, AnonymousUser):
        raise HTTPException(status_code=401, detail="Authentication required")
    await authorize_assignment_access(
        request, db, user, ctx.course.course_uuid, AccessAction.READ,
        activity_id=ctx.assignment.activity_id,
    )
    if not _is_enabled(ctx.settings):
        raise HTTPException(status_code=404, detail="Peer review is not enabled for this assignment")
    await _require_feature(db, ctx.assignment.org_id)
    return ctx


async def _instructor_ctx(request: Request, db: AsyncSession, user: User_, assignment_uuid: str) -> _Ctx:
    ctx = await _load_by_uuid(db, assignment_uuid)
    await authorize_assignment_access(
        request, db, user, ctx.course.course_uuid, AccessAction.UPDATE,
    )
    if not await _is_assignment_instructor(request, user, ctx.course.course_uuid, db):
        raise HTTPException(status_code=403, detail="Only course instructors can do this")
    return ctx


async def _not_instructor(request: Request, db: AsyncSession, user: User_, ctx: _Ctx) -> None:
    if await _is_assignment_instructor(request, user, ctx.course.course_uuid, db):
        raise HTTPException(status_code=403, detail="Instructors can't take peer review steps as learners")


async def _review_ctx(
    request: Request, db: AsyncSession, user: User_, review_uuid: str
) -> tuple[AssignmentPeerReview, _Ctx]:
    """A review by uuid plus its assignment, after the course READ check."""
    review = (await db.execute(
        select(AssignmentPeerReview).where(AssignmentPeerReview.review_uuid == review_uuid)
    )).scalars().first()
    if review is None:
        raise HTTPException(status_code=404, detail="Review not found")
    assignment = (await db.execute(
        select(Assignment).where(Assignment.id == review.assignment_id, Assignment.org_id == review.org_id)
    )).scalars().first()
    ctx = await _load(db, assignment)
    await authorize_assignment_access(
        request, db, user, ctx.course.course_uuid, AccessAction.READ,
        activity_id=ctx.assignment.activity_id,
    )
    return review, ctx


async def _gate_learner_review(db: AsyncSession, ctx: _Ctx) -> None:
    if not _is_enabled(ctx.settings):
        raise HTTPException(status_code=404, detail="Peer review is not enabled for this assignment")
    await _require_feature(db, ctx.assignment.org_id)


# ---------------------------------------------------------------------------
# Rubric, prompts and scoring
# ---------------------------------------------------------------------------


def effective_prompts(settings: Optional[AssignmentPeerReviewSettings]) -> list[dict]:
    prompts = settings.prompts if settings is not None else None
    return list(prompts) if prompts else [dict(p) for p in DEFAULT_PROMPTS]


def _rubric(settings: Optional[AssignmentPeerReviewSettings]) -> list[dict]:
    return list(settings.rubric or []) if settings is not None else []


def _level_points(rubric: list[dict]) -> dict[str, dict[str, float]]:
    return {
        c["id"]: {lv["id"]: float(lv.get("points") or 0) for lv in c.get("levels") or []}
        for c in rubric
    }


def _max_points(rubric: list[dict]) -> dict[str, float]:
    return {cid: (max(levels.values()) if levels else 0.0) for cid, levels in _level_points(rubric).items()}


def review_percentage(scores: Optional[dict], rubric: list[dict]) -> Optional[float]:
    """sum(points) / sum(max points) × 100 over the criteria this review scored
    with a level the rubric still has."""
    points = _level_points(rubric)
    maxes = _max_points(rubric)
    got = total = 0.0
    for cid, level_id in (scores or {}).items():
        if cid in points and level_id in points[cid]:
            got += points[cid][level_id]
            total += maxes[cid]
    if total <= 0:
        return None
    return got / total * 100


def peer_score(reviews: list[AssignmentPeerReview], rubric: list[dict], min_reviews: int) -> Optional[dict]:
    """Median per criterion across the given (submitted, kept) peer reviews.
    None until there are at least ``min_reviews`` of them."""
    if len(reviews) < max(1, int(min_reviews or 1)) or not rubric:
        return None
    points = _level_points(rubric)
    maxes = _max_points(rubric)
    criteria = []
    got = total = 0.0
    for criterion in rubric:
        cid = criterion["id"]
        values = [
            points[cid][r.scores[cid]]
            for r in reviews
            if r.scores and r.scores.get(cid) in points[cid]
        ]
        if not values:
            continue
        median = float(statistics.median(values))
        criteria.append({"criterion_id": cid, "median": _round(median), "max_points": _round(maxes[cid])})
        got += median
        total += maxes[cid]
    return {
        "criteria": criteria,
        "percentage": _round(got / total * 100) if total > 0 else None,
        "review_count": len(reviews),
        "spread": score_spread(reviews, rubric),
    }


def score_spread(reviews: list[AssignmentPeerReview], rubric: list[dict]) -> Optional[float]:
    """max − min percentage across reviews; None with fewer than two."""
    pcts = [p for p in (review_percentage(r.scores, rubric) for r in reviews) if p is not None]
    if len(pcts) < 2:
        return None
    return _round(max(pcts) - min(pcts))


def _validate_scores(scores: dict, rubric: list[dict], *, require_all: bool) -> dict:
    points = _level_points(rubric)
    for cid, level_id in scores.items():
        if cid not in points:
            raise HTTPException(status_code=422, detail=f"Unknown rubric criterion: {cid}")
        if level_id not in points[cid]:
            raise HTTPException(status_code=422, detail=f"Unknown level for criterion {cid}")
    if require_all:
        missing = [c.get("title") or c["id"] for c in rubric if c["id"] not in scores]
        if missing or not rubric:
            raise HTTPException(status_code=422, detail="Score every rubric criterion before submitting")
    return dict(scores)


def _validate_comments(comments: dict, prompts: list[dict], *, enforce_min: bool) -> dict:
    by_key = {p["key"]: p for p in prompts}
    for key, value in comments.items():
        if key not in by_key:
            raise HTTPException(status_code=422, detail=f"Unknown comment prompt: {key}")
        if len(value) > MAX_COMMENT_CHARS:
            raise HTTPException(status_code=422, detail=f"Comments are limited to {MAX_COMMENT_CHARS} characters")
    if enforce_min:
        for prompt in prompts:
            need = int(prompt.get("min_chars") or 0)
            if need and len((comments.get(prompt["key"]) or "").strip()) < need:
                raise HTTPException(
                    status_code=422,
                    detail=f"\"{prompt.get('label') or prompt['key']}\" needs at least {need} characters",
                )
    return dict(comments)


def _validate_criterion_comments(comments: Optional[dict], rubric: list[dict]) -> dict:
    ids = {c["id"] for c in rubric}
    for key, value in (comments or {}).items():
        if key not in ids:
            raise HTTPException(status_code=422, detail=f"Unknown rubric criterion: {key}")
        if len(value) > MAX_CRITERION_COMMENT_CHARS:
            raise HTTPException(
                status_code=422,
                detail=f"Criterion notes are limited to {MAX_CRITERION_COMMENT_CHARS} characters",
            )
    return dict(comments or {})


# ---------------------------------------------------------------------------
# Serialization
# ---------------------------------------------------------------------------


def _hide_reviewer(settings: Optional[AssignmentPeerReviewSettings]) -> bool:
    return (settings.anonymity if settings is not None else "double_blind") != "named"


def _hide_reviewee(settings: Optional[AssignmentPeerReviewSettings]) -> bool:
    return (settings.anonymity if settings is not None else "double_blind") == "double_blind"


def _party(user: Optional[User], *, label: Optional[str] = None, hidden: bool = False) -> Optional[dict]:
    if hidden:
        return {"label": label, "user_id": None, "username": None, "first_name": None,
                "last_name": None, "avatar_image": None, "user_uuid": None}
    if user is None:
        return {"label": label, "user_id": None, "username": None, "first_name": None,
                "last_name": None, "avatar_image": None, "user_uuid": None} if label else None
    return {
        "label": label,
        "user_id": user.id,
        "username": user.username,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "avatar_image": user.avatar_image or None,
        "user_uuid": user.user_uuid,
    }


def _review_dict(
    review: AssignmentPeerReview,
    rubric: list[dict],
    *,
    audience: str,
    reviewer: Optional[dict] = None,
    reviewee: Optional[dict] = None,
    reviewer_label: Optional[str] = None,
) -> dict:
    """``audience`` is ``reviewer`` (the author of the review), ``reviewee``
    (the learner it is about), ``self`` or ``instructor``. Moderation fields
    reach instructors only; the reviewer never sees a flag."""
    data: dict[str, Any] = {
        "review_uuid": review.review_uuid,
        "kind": review.kind,
        "status": review.status,
        "attempt_number": review.attempt_number,
        "calibration_sample_id": review.calibration_sample_id,
        "scores": dict(review.scores or {}),
        "comments": dict(review.comments or {}),
        "criterion_comments": dict(review.criterion_comments or {}),
        "helpfulness": review.helpfulness,
        "helpfulness_note": review.helpfulness_note if audience in ("reviewee", "instructor") else None,
        "flagged": bool(review.flagged) if audience in ("reviewee", "instructor") else False,
        "flag_reason": review.flag_reason if audience in ("reviewee", "instructor") else None,
        "discarded_by": review.discarded_by if audience == "instructor" else None,
        "discard_reason": review.discard_reason if audience == "instructor" else None,
        "assigned_at": review.assigned_at,
        "submitted_at": review.submitted_at,
        "creation_date": review.creation_date,
        "update_date": review.update_date,
        "reviewer_label": reviewer_label,
        "reviewer": reviewer,
        "reviewee": reviewee,
        "percentage": _round(review_percentage(review.scores, rubric)),
    }
    return data


def _sample_for_learner(sample: dict, mine: Optional[AssignmentPeerReview]) -> dict:
    out = {
        "id": sample.get("id"),
        "title": sample.get("title"),
        "content": sample.get("content") or "",
        "done": mine is not None,
        "my_scores": dict(mine.scores or {}) if mine is not None else None,
        "explanation": None,
    }
    if mine is not None:
        out["explanation"] = sample.get("explanation")
        out["scores"] = dict(sample.get("scores") or {})
    return out


def settings_view(
    ctx: _Ctx, *, for_instructor: bool, available: bool
) -> dict:
    s = ctx.settings
    default = AssignmentPeerReviewSettings(
        assignment_id=ctx.assignment.id, org_id=ctx.assignment.org_id, creation_date="", update_date=""
    )
    row = s if s is not None else default
    samples = list(row.calibration_samples or [])
    if not for_instructor:
        samples = [
            {"id": smp.get("id"), "title": smp.get("title"), "content": smp.get("content") or ""}
            for smp in samples
        ]
    return {
        "id": row.id,
        "assignment_id": ctx.assignment.id,
        "assignment_uuid": ctx.assignment.assignment_uuid,
        "org_id": ctx.assignment.org_id,
        "enabled": bool(row.enabled),
        "reviews_required": row.reviews_required,
        "require_reviews_to_see_feedback": bool(row.require_reviews_to_see_feedback),
        "review_due_date": row.review_due_date,
        "anonymity": row.anonymity,
        "self_review_enabled": bool(row.self_review_enabled),
        "calibration_enabled": bool(row.calibration_enabled),
        "helpfulness_enabled": bool(row.helpfulness_enabled),
        "revision_plan_enabled": bool(row.revision_plan_enabled),
        "prompts": list(row.prompts) if row.prompts else None,
        "effective_prompts": effective_prompts(row),
        "rubric": list(row.rubric or []),
        "score_mode": row.score_mode,
        "min_reviews_for_score": row.min_reviews_for_score,
        "calibration_samples": samples,
        "creation_date": row.creation_date or None,
        "update_date": row.update_date or None,
        "feature_available": available,
    }


async def _users(db: AsyncSession, ids: Iterable[Optional[int]]) -> dict[int, User]:
    wanted = {i for i in ids if i}
    if not wanted:
        return {}
    rows = (await db.execute(select(User).where(User.id.in_(wanted)))).scalars().all()  # type: ignore[attr-defined]
    return {u.id: u for u in rows if u.id is not None}


# ---------------------------------------------------------------------------
# Queries
# ---------------------------------------------------------------------------


async def _reviews(db: AsyncSession, assignment: Assignment, **where) -> list[AssignmentPeerReview]:
    stmt = select(AssignmentPeerReview).where(
        AssignmentPeerReview.assignment_id == assignment.id,
        AssignmentPeerReview.org_id == assignment.org_id,
    )
    for key, value in where.items():
        stmt = stmt.where(getattr(AssignmentPeerReview, key) == value)
    stmt = stmt.order_by(AssignmentPeerReview.id.asc())  # type: ignore[union-attr]
    return list((await db.execute(stmt)).scalars().all())


async def _submissions(db: AsyncSession, assignment: Assignment) -> list[AssignmentUserSubmission]:
    return list((await db.execute(
        select(AssignmentUserSubmission)
        .where(AssignmentUserSubmission.assignment_id == assignment.id)
        .order_by(AssignmentUserSubmission.id.asc())  # type: ignore[union-attr]
    )).scalars().all())


async def _my_submission(db: AsyncSession, assignment: Assignment, user_id: int) -> Optional[AssignmentUserSubmission]:
    return (await db.execute(
        select(AssignmentUserSubmission).where(
            AssignmentUserSubmission.assignment_id == assignment.id,
            AssignmentUserSubmission.user_id == user_id,
        )
    )).scalars().first()


def _reviewable(sub: Optional[AssignmentUserSubmission]) -> bool:
    return sub is not None and sub.submission_status in REVIEWABLE_STATUSES


def _kept_received(reviews: list[AssignmentPeerReview], user_id: int, attempt: int) -> list[AssignmentPeerReview]:
    """Submitted, non-discarded peer reviews of one attempt, oldest first."""
    rows = [
        r for r in reviews
        if r.kind == "peer" and r.reviewee_user_id == user_id and r.attempt_number == attempt
        and r.status == "submitted"
    ]
    return sorted(rows, key=lambda r: (r.submitted_at or "", r.id or 0))


def _is_fresh(review: AssignmentPeerReview, now: datetime) -> bool:
    assigned = _parse(review.assigned_at)
    return assigned is not None and now - assigned < STALE_AFTER


def _is_current(review: AssignmentPeerReview, subs_by_user: dict[int, AssignmentUserSubmission]) -> bool:
    sub = subs_by_user.get(review.reviewee_user_id or 0)
    return _reviewable(sub) and sub.attempt_number == review.attempt_number  # type: ignore[union-attr]


def _close_superseded(review: AssignmentPeerReview) -> None:
    """The reviewee started a new attempt: the assigned review is moot."""
    review.status = "discarded"
    review.discard_reason = SUBMISSION_CHANGED
    review.discarded_by = None
    review.update_date = _now()


def _candidates(
    subs: list[AssignmentUserSubmission],
    reviews: list[AssignmentPeerReview],
    reviewer_id: int,
    now: datetime,
) -> list[AssignmentUserSubmission]:
    """Who this reviewer may pick up next, best first: fewest (submitted +
    fresh assigned) reviews on the current attempt, then earliest submitted."""
    already = {
        (r.reviewee_user_id, r.attempt_number)
        for r in reviews if r.kind == "peer" and r.reviewer_user_id == reviewer_id
    }
    load: dict[tuple, int] = {}
    for r in reviews:
        if r.kind != "peer":
            continue
        if r.status == "submitted" or (r.status == "assigned" and _is_fresh(r, now)):
            key = (r.reviewee_user_id, r.attempt_number)
            load[key] = load.get(key, 0) + 1
    pool = [
        s for s in subs
        if _reviewable(s) and s.user_id != reviewer_id and (s.user_id, s.attempt_number) not in already
    ]
    return sorted(
        pool,
        key=lambda s: (
            load.get((s.user_id, s.attempt_number), 0),
            _parse(s.creation_date) or datetime.max,
            s.user_id,
        ),
    )


async def _lock_allocation(db: AsyncSession, assignment_id: int) -> None:
    """Serialize picks per assignment (Postgres). SQLite is single-writer."""
    if db.get_bind().dialect.name == "postgresql":
        await db.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:key))"),
            {"key": f"peer_review:{assignment_id}"},
        )


def _effective_required(settings: AssignmentPeerReviewSettings, subs: list[AssignmentUserSubmission], user_id: int) -> int:
    """The configured number of reviews, capped by how many classmates have
    submitted: a learner in a small cohort can't be held to reviews that can't
    exist. The review deadline also unlocks feedback."""
    others = sum(1 for s in subs if _reviewable(s) and s.user_id != user_id)
    return min(int(settings.reviews_required or 0), others)


def _due_passed(settings: AssignmentPeerReviewSettings) -> bool:
    return _is_assignment_past_due(SimpleNamespace(due_date=settings.review_due_date))  # type: ignore[arg-type]


def feedback_state(settings: AssignmentPeerReviewSettings, done: int, required: int) -> tuple[bool, Optional[str]]:
    if not settings.require_reviews_to_see_feedback:
        return True, None
    if done >= required:
        return True, "reviews"
    if _due_passed(settings):
        return True, "due_date"
    return False, None


def _calibration_state(settings: AssignmentPeerReviewSettings, mine: list[AssignmentPeerReview]) -> tuple[bool, int, int]:
    samples = list(settings.calibration_samples or [])
    enabled = bool(settings.calibration_enabled) and bool(samples)
    ids = {smp.get("id") for smp in samples}
    done = len({r.calibration_sample_id for r in mine if r.kind == "calibration" and r.calibration_sample_id in ids})
    return enabled, len(samples) if enabled else 0, done if enabled else 0


def _labels(received: list[AssignmentPeerReview]) -> dict[int, str]:
    return {r.id: f"Reviewer {i}" for i, r in enumerate(received, start=1) if r.id is not None}


def _avg(values: list[float]) -> Optional[float]:
    return _round(sum(values) / len(values)) if values else None


def _reflection_dict(row: Optional[AssignmentPeerReflection]) -> Optional[dict]:
    if row is None:
        return None
    return {"plan": row.plan, "creation_date": row.creation_date, "update_date": row.update_date}


async def _reflection(db: AsyncSession, assignment: Assignment, user_id: int) -> Optional[AssignmentPeerReflection]:
    return (await db.execute(
        select(AssignmentPeerReflection).where(
            AssignmentPeerReflection.assignment_id == assignment.id,
            AssignmentPeerReflection.org_id == assignment.org_id,
            AssignmentPeerReflection.user_id == user_id,
        )
    )).scalars().first()


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------


async def get_settings(request: Request, db: AsyncSession, user: User_, assignment_uuid: str) -> dict:
    ctx = await _load_by_uuid(db, assignment_uuid)
    await authorize_assignment_access(
        request, db, user, ctx.course.course_uuid, AccessAction.READ,
        activity_id=ctx.assignment.activity_id,
    )
    is_instructor = await _is_assignment_instructor(request, user, ctx.course.course_uuid, db)
    available = await feature_available(db, ctx.assignment.org_id)
    return settings_view(ctx, for_instructor=is_instructor, available=available)


def _check_samples(samples: list[dict], rubric: list[dict]) -> None:
    points = _level_points(rubric)
    for sample in samples:
        for cid, level_id in (sample.get("scores") or {}).items():
            if cid not in points or level_id not in points[cid]:
                raise HTTPException(
                    status_code=422,
                    detail=f"Practice sample \"{sample.get('title')}\" uses a criterion or level that is not in the rubric",
                )


async def update_settings(
    request: Request, db: AsyncSession, user: User_, assignment_uuid: str, body: PeerReviewSettingsUpdate
) -> dict:
    ctx = await _instructor_ctx(request, db, user, assignment_uuid)
    row = ctx.settings
    if row is None:
        row = AssignmentPeerReviewSettings(
            assignment_id=ctx.assignment.id, org_id=ctx.assignment.org_id,
            creation_date=_now(), update_date=_now(),
        )
    data = body.model_dump(exclude_unset=True)
    for key, value in data.items():
        if key == "prompts":
            row.prompts = value  # None resets to the defaults
        elif value is not None:
            setattr(row, key, value)
    if "review_due_date" in data and data["review_due_date"] is None:
        row.review_due_date = None

    rubric = list(row.rubric or [])
    if row.enabled and not 1 <= len(rubric) <= 10:
        raise HTTPException(status_code=422, detail="Add 1 to 10 rubric criteria before turning peer review on")
    _check_samples(list(row.calibration_samples or []), rubric)
    if row.enabled:
        await _require_feature(db, ctx.assignment.org_id)

    row.update_date = _now()
    db.add(row)
    await db.commit()
    await db.refresh(row)
    ctx.settings = row
    return settings_view(ctx, for_instructor=True, available=await feature_available(db, ctx.assignment.org_id))


# ---------------------------------------------------------------------------
# Instructor views
# ---------------------------------------------------------------------------


def _bias(
    reviewer_id: int, reviews: list[AssignmentPeerReview], rubric: list[dict]
) -> Optional[float]:
    """Mean |reviewer % − median % of the other reviewers of the same attempt|."""
    deviations = []
    kept = [r for r in reviews if r.kind == "peer" and r.status == "submitted"]
    for r in kept:
        if r.reviewer_user_id != reviewer_id:
            continue
        mine = review_percentage(r.scores, rubric)
        others = [
            p for p in (
                review_percentage(o.scores, rubric) for o in kept
                if o.id != r.id and o.reviewee_user_id == r.reviewee_user_id
                and o.attempt_number == r.attempt_number
            ) if p is not None
        ]
        if mine is not None and others:
            deviations.append(abs(mine - statistics.median(others)))
    return _avg(deviations)


def _calibration_deviation(
    reviewer_id: int, reviews: list[AssignmentPeerReview], settings: Optional[AssignmentPeerReviewSettings]
) -> Optional[float]:
    """Mean |reviewer level points − instructor level points| per criterion."""
    if settings is None:
        return None
    points = _level_points(_rubric(settings))
    samples = {smp.get("id"): smp for smp in settings.calibration_samples or []}
    diffs = []
    for r in reviews:
        if r.kind != "calibration" or r.reviewer_user_id != reviewer_id:
            continue
        sample = samples.get(r.calibration_sample_id)
        if sample is None:
            continue
        for cid, inst_level in (sample.get("scores") or {}).items():
            mine = (r.scores or {}).get(cid)
            if cid in points and inst_level in points[cid] and mine in points[cid]:
                diffs.append(abs(points[cid][mine] - points[cid][inst_level]))
    return _avg(diffs)


async def get_overview(request: Request, db: AsyncSession, user: User_, assignment_uuid: str) -> dict:
    ctx = await _instructor_ctx(request, db, user, assignment_uuid)
    settings = ctx.settings
    rubric = _rubric(settings)
    required = int(settings.reviews_required) if settings is not None else 3
    min_reviews = int(settings.min_reviews_for_score) if settings is not None else 3
    subs = await _submissions(db, ctx.assignment)
    reviews = await _reviews(db, ctx.assignment)
    reviewable = [s for s in subs if _reviewable(s)]
    reviewer_ids = {s.user_id for s in reviewable} | {r.reviewer_user_id for r in reviews if r.kind == "peer"}
    users = await _users(db, reviewer_ids | {r.reviewee_user_id for r in reviews})

    submissions = []
    below = 0
    for s in reviewable:
        received = _kept_received(reviews, s.user_id, s.attempt_number)
        if len(received) < required:
            below += 1
        self_row = next(
            (r for r in reviews if r.kind == "self" and r.reviewer_user_id == s.user_id
             and r.attempt_number == s.attempt_number and r.status == "submitted"),
            None,
        )
        submissions.append({
            "user": _party(users.get(s.user_id)),
            "user_id": s.user_id,
            "submission_status": s.submission_status.value if hasattr(s.submission_status, "value") else s.submission_status,
            "attempt_number": s.attempt_number,
            "reviews_received": len(received),
            "reviews_target": required,
            "peer_score": peer_score(received, rubric, min_reviews),
            "spread": score_spread(received, rubric),
            "self_score": _round(review_percentage(self_row.scores, rubric)) if self_row else None,
            "flagged_count": sum(
                1 for r in reviews
                if r.kind == "peer" and r.reviewee_user_id == s.user_id
                and r.attempt_number == s.attempt_number and r.flagged and r.status != "discarded"
            ),
        })

    reviewers = []
    for uid in sorted(reviewer_ids):
        given = [r for r in reviews if r.kind == "peer" and r.reviewer_user_id == uid and r.status == "submitted"]
        reviewers.append({
            "user": _party(users.get(uid)),
            "user_id": uid,
            "reviews_done": len(given),
            "reviews_required": required,
            "avg_helpfulness": _avg([float(r.helpfulness) for r in given if r.helpfulness]),
            "bias": _bias(uid, reviews, rubric),
            "calibration_deviation": _calibration_deviation(uid, reviews, settings),
        })

    flagged_rows = [r for r in reviews if r.kind == "peer" and r.flagged and r.status != "discarded"]
    return {
        "totals": {
            "submitted_learners": len(reviewable),
            "reviews_submitted": sum(1 for r in reviews if r.kind == "peer" and r.status == "submitted"),
            "reviews_assigned": sum(1 for r in reviews if r.kind == "peer" and r.status == "assigned"),
            "flagged": len(flagged_rows),
            "below_target": below,
        },
        "submissions": submissions,
        "reviewers": reviewers,
        "flagged": [
            _review_dict(
                r, rubric, audience="instructor",
                reviewer=_party(users.get(r.reviewer_user_id)),
                reviewee=_party(users.get(r.reviewee_user_id or 0)),
            )
            for r in flagged_rows
        ],
    }


async def get_submission_detail(
    request: Request, db: AsyncSession, user: User_, assignment_uuid: str, user_id: int
) -> dict:
    ctx = await _instructor_ctx(request, db, user, assignment_uuid)
    sub = await _my_submission(db, ctx.assignment, user_id)
    if sub is None:
        raise HTTPException(status_code=404, detail="Submission not found")
    rubric = _rubric(ctx.settings)
    min_reviews = int(ctx.settings.min_reviews_for_score) if ctx.settings is not None else 3
    reviews = await _reviews(db, ctx.assignment)
    current = [
        r for r in reviews
        if r.kind == "peer" and r.reviewee_user_id == user_id and r.attempt_number == sub.attempt_number
    ]
    users = await _users(db, [user_id] + [r.reviewer_user_id for r in current])
    self_row = next((r for r in reviews if r.kind == "self" and r.reviewer_user_id == user_id), None)
    reflection = await _reflection(db, ctx.assignment, user_id)
    return {
        "user": _party(users.get(user_id)),
        "user_id": user_id,
        "submission_status": sub.submission_status.value if hasattr(sub.submission_status, "value") else sub.submission_status,
        "attempt_number": sub.attempt_number,
        "reviews": [
            _review_dict(r, rubric, audience="instructor", reviewer=_party(users.get(r.reviewer_user_id)))
            for r in current
        ],
        "self_review": _review_dict(self_row, rubric, audience="instructor") if self_row else None,
        "peer_score": peer_score(_kept_received(reviews, user_id, sub.attempt_number), rubric, min_reviews),
        "reflection": _reflection_dict(reflection),
    }


async def _instructor_review(db: AsyncSession, ctx: _Ctx, review_uuid: str) -> AssignmentPeerReview:
    review = (await db.execute(
        select(AssignmentPeerReview).where(
            AssignmentPeerReview.review_uuid == review_uuid,
            AssignmentPeerReview.assignment_id == ctx.assignment.id,
            AssignmentPeerReview.org_id == ctx.assignment.org_id,
        )
    )).scalars().first()
    if review is None:
        raise HTTPException(status_code=404, detail="Review not found")
    if review.kind != "peer":
        raise HTTPException(status_code=400, detail="Only peer reviews can be discarded or restored")
    return review


async def _instructor_review_out(db: AsyncSession, ctx: _Ctx, review: AssignmentPeerReview) -> dict:
    users = await _users(db, [review.reviewer_user_id, review.reviewee_user_id])
    return _review_dict(
        review, _rubric(ctx.settings), audience="instructor",
        reviewer=_party(users.get(review.reviewer_user_id)),
        reviewee=_party(users.get(review.reviewee_user_id or 0)),
    )


async def discard_review(
    request: Request, db: AsyncSession, user: User_, assignment_uuid: str, review_uuid: str, body: PeerDiscardBody
) -> dict:
    ctx = await _instructor_ctx(request, db, user, assignment_uuid)
    review = await _instructor_review(db, ctx, review_uuid)
    review.status = "discarded"
    review.discarded_by = None if isinstance(user, APITokenUser) else user.id
    review.discard_reason = (body.reason or "").strip() or None
    review.update_date = _now()
    db.add(review)
    await db.commit()
    await db.refresh(review)
    return await _instructor_review_out(db, ctx, review)


async def restore_review(
    request: Request, db: AsyncSession, user: User_, assignment_uuid: str, review_uuid: str
) -> dict:
    ctx = await _instructor_ctx(request, db, user, assignment_uuid)
    review = await _instructor_review(db, ctx, review_uuid)
    if review.status != "discarded":
        raise HTTPException(status_code=409, detail="This review is not discarded")
    review.status = "submitted" if review.submitted_at else "assigned"
    review.discarded_by = None
    review.discard_reason = None
    review.update_date = _now()
    db.add(review)
    await db.commit()
    await db.refresh(review)
    return await _instructor_review_out(db, ctx, review)


# ---------------------------------------------------------------------------
# Learner state
# ---------------------------------------------------------------------------


async def get_learner_state(request: Request, db: AsyncSession, user: User_, assignment_uuid: str) -> dict:
    ctx = await _learner_ctx(request, db, user, await _load_by_uuid(db, assignment_uuid))
    settings: AssignmentPeerReviewSettings = ctx.settings  # type: ignore[assignment]
    rubric = _rubric(settings)
    uid = int(user.id)  # type: ignore[union-attr]
    now = datetime.now()
    is_instructor = await _is_assignment_instructor(request, user, ctx.course.course_uuid, db)

    subs = await _submissions(db, ctx.assignment)
    subs_by_user = {s.user_id: s for s in subs}
    mine = subs_by_user.get(uid)
    reviews = await _reviews(db, ctx.assignment)
    my_rows = [r for r in reviews if r.reviewer_user_id == uid]

    given = [r for r in my_rows if r.kind == "peer" and r.status == "submitted"]
    open_row = next(
        (r for r in my_rows if r.kind == "peer" and r.status == "assigned" and _is_current(r, subs_by_user)),
        None,
    )
    self_row = next((r for r in my_rows if r.kind == "self"), None)
    self_done = bool(
        self_row and mine and self_row.status == "submitted" and self_row.attempt_number == mine.attempt_number
    )
    cal_enabled, cal_total, cal_done = _calibration_state(settings, my_rows)
    required = _effective_required(settings, subs, uid)
    can_pick = _reviewable(mine) and not is_instructor and (not cal_enabled or cal_done >= cal_total)
    available = _reviewable(mine) and (
        open_row is not None or (can_pick and bool(_candidates(subs, reviews, uid, now)))
    )

    received = _kept_received(reviews, uid, mine.attempt_number) if mine else []
    unlocked, reason = feedback_state(settings, len(given), required)
    hide = _hide_reviewer(settings)
    labels = _labels(received)
    reviewer_users = await _users(db, [] if hide else [r.reviewer_user_id for r in received])

    reflection = await _reflection(db, ctx.assignment, uid)
    return {
        "enabled": True,
        "is_instructor": is_instructor,
        "settings": {
            "rubric": rubric,
            "prompts": list(settings.prompts) if settings.prompts else None,
            "effective_prompts": effective_prompts(settings),
            "reviews_required": settings.reviews_required,
            "require_reviews_to_see_feedback": bool(settings.require_reviews_to_see_feedback),
            "review_due_date": settings.review_due_date,
            "anonymity": settings.anonymity,
            "self_review_enabled": bool(settings.self_review_enabled),
            "calibration_enabled": cal_enabled,
            "helpfulness_enabled": bool(settings.helpfulness_enabled),
            "revision_plan_enabled": bool(settings.revision_plan_enabled),
            "score_mode": settings.score_mode,
            "min_reviews_for_score": settings.min_reviews_for_score,
        },
        "my_submission_status": (
            mine.submission_status.value if hasattr(mine.submission_status, "value") else mine.submission_status
        ) if mine else None,
        "attempt_number": mine.attempt_number if mine else None,
        "steps": {
            "self": {"enabled": bool(settings.self_review_enabled), "done": self_done},
            "calibration": {"enabled": cal_enabled, "total": cal_total, "done": cal_done},
            "reviews": {
                "required": required,
                "configured": settings.reviews_required,
                "done": len(given),
                "open_review_uuid": open_row.review_uuid if open_row else None,
                "available": available,
            },
            "feedback": {"unlocked": unlocked, "reason": reason, "count": len(received)},
        },
        "received": [
            _review_dict(
                r, rubric, audience="reviewee",
                reviewer_label=labels.get(r.id or 0) if hide else None,
                reviewer=_party(
                    reviewer_users.get(r.reviewer_user_id), label=labels.get(r.id or 0) if hide else None,
                    hidden=hide,
                ),
            )
            for r in received
        ] if unlocked else [],
        "self_review": _review_dict(self_row, rubric, audience="self") if self_done and self_row else None,
        "peer_score": peer_score(received, rubric, settings.min_reviews_for_score) if unlocked else None,
        "reflection": _reflection_dict(reflection),
        "given_stats": {
            "done": len(given),
            "avg_helpfulness": _avg([float(r.helpfulness) for r in given if r.helpfulness]),
        },
    }


# ---------------------------------------------------------------------------
# Reviewing classmates
# ---------------------------------------------------------------------------


async def _reviewee_party(db: AsyncSession, settings, review: AssignmentPeerReview) -> dict:
    if _hide_reviewee(settings):
        return _party(None, label="Classmate", hidden=True)  # type: ignore[return-value]
    users = await _users(db, [review.reviewee_user_id])
    return _party(users.get(review.reviewee_user_id or 0), label="Classmate")  # type: ignore[return-value]


async def next_review(request: Request, db: AsyncSession, user: User_, assignment_uuid: str) -> dict:
    ctx = await _learner_ctx(request, db, user, await _load_by_uuid(db, assignment_uuid))
    await _not_instructor(request, db, user, ctx)
    settings: AssignmentPeerReviewSettings = ctx.settings  # type: ignore[assignment]
    uid = int(user.id)  # type: ignore[union-attr]
    mine = await _my_submission(db, ctx.assignment, uid)
    if mine is None:
        raise HTTPException(status_code=403, detail="Submit your own work before reviewing classmates")
    if not _reviewable(mine):
        raise HTTPException(status_code=409, detail=REVIEWER_RETRYING)
    my_rows = await _reviews(db, ctx.assignment, reviewer_user_id=uid)
    cal_enabled, cal_total, cal_done = _calibration_state(settings, my_rows)
    if cal_enabled and cal_done < cal_total:
        raise HTTPException(status_code=409, detail="Finish the practice round before reviewing classmates")

    await _lock_allocation(db, ctx.assignment.id)  # type: ignore[arg-type]
    subs = await _submissions(db, ctx.assignment)
    subs_by_user = {s.user_id: s for s in subs}
    reviews = await _reviews(db, ctx.assignment)
    rubric = _rubric(settings)

    chosen: Optional[AssignmentPeerReview] = None
    closed = False
    for r in reviews:
        if r.kind == "peer" and r.reviewer_user_id == uid and r.status == "assigned":
            if _is_current(r, subs_by_user):
                chosen = chosen or r
            else:
                _close_superseded(r)
                db.add(r)
                closed = True
    if chosen is None:
        now = datetime.now()
        candidates = _candidates(subs, reviews, uid, now)
        if not candidates:
            if closed:
                await db.commit()
            return {"review": None, "reason": "none_available"}
        pick = candidates[0]
        chosen = AssignmentPeerReview(
            review_uuid=f"peerreview_{uuid4()}",
            assignment_id=ctx.assignment.id,  # type: ignore[arg-type]
            org_id=ctx.assignment.org_id,
            reviewer_user_id=uid,
            reviewee_user_id=pick.user_id,
            kind="peer",
            attempt_number=pick.attempt_number,
            status="assigned",
            scores={}, comments={}, criterion_comments={},
            assigned_at=str(now), creation_date=str(now), update_date=str(now),
        )
        db.add(chosen)
        closed = True
    if closed:
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            raise HTTPException(status_code=409, detail="Another review was just assigned. Try again.")
        await db.refresh(chosen)
    return {
        "review": _review_dict(
            chosen, rubric, audience="reviewer", reviewee=await _reviewee_party(db, settings, chosen),
        ),
        "reason": None,
    }


def is_auto_graded(task: AssignmentTask) -> bool:
    """Whether the task has an objective answer the server grades. A reviewer
    never sees a classmate's answer to such a task: they could retry and copy
    it. Mirrors ``_server_verified_task_grade``: a short answer, form blank or
    code task only counts when it actually has an answer key or tests."""
    kind = task.assignment_type.value if hasattr(task.assignment_type, "value") else task.assignment_type
    contents = task.contents if isinstance(task.contents, dict) else {}
    if kind in ("QUIZ", "NUMBER_ANSWER"):
        return True
    if kind == "SHORT_ANSWER":
        accepted = contents.get("correct_answers")
        has_key = isinstance(accepted, list) and any(isinstance(a, str) and a.strip() for a in accepted)
        return has_key and contents.get("match_mode") != "manual"
    if kind == "FORM":
        return any(
            isinstance(blank, dict) and str(blank.get("correctAnswer") or "").strip()
            for q in contents.get("questions") or [] if isinstance(q, dict)
            for blank in q.get("blanks") or []
        )
    if kind == "CODE":
        return bool(contents.get("test_cases"))
    return False


async def _require_reviewer_submission(db: AsyncSession, assignment: Assignment, user_id: int) -> None:
    """A reviewer who started a retry can't use their review tasks until they
    hand the new attempt in (otherwise: submit junk, read, retry, copy)."""
    if not _reviewable(await _my_submission(db, assignment, user_id)):
        raise HTTPException(status_code=409, detail=REVIEWER_RETRYING)


def _sanitize_answer(task_submission: Any) -> tuple[Any, bool]:
    """Drop the stored file name (it names the uploader); report if one was there."""
    if not isinstance(task_submission, dict):
        return task_submission, False
    has_file = any(task_submission.get(k) for k in _FILE_KEYS)
    return {k: v for k, v in task_submission.items() if k not in _FILE_KEYS}, has_file


def file_path(review_uuid: str, task_uuid: str) -> str:
    return f"assignments/peer-review/reviews/{review_uuid}/files/{task_uuid}"


async def _own_review(request: Request, db: AsyncSession, user: User_, review_uuid: str):
    _block_api_tokens(user)
    if isinstance(user, AnonymousUser):
        raise HTTPException(status_code=401, detail="Authentication required")
    review, ctx = await _review_ctx(request, db, user, review_uuid)
    if review.kind != "peer" or review.reviewer_user_id != user.id:
        raise HTTPException(status_code=404, detail="Review not found")
    await _gate_learner_review(db, ctx)
    await _require_reviewer_submission(db, ctx.assignment, int(user.id))
    return review, ctx


async def get_review(request: Request, db: AsyncSession, user: User_, review_uuid: str) -> dict:
    review, ctx = await _own_review(request, db, user, review_uuid)
    settings = ctx.settings
    rubric = _rubric(settings)
    reviewee_sub = await _my_submission(db, ctx.assignment, review.reviewee_user_id or 0)
    current = _reviewable(reviewee_sub) and reviewee_sub.attempt_number == review.attempt_number  # type: ignore[union-attr]

    tasks = list((await db.execute(
        select(AssignmentTask)
        .where(AssignmentTask.assignment_id == ctx.assignment.id, AssignmentTask.org_id == ctx.assignment.org_id)
        .order_by(AssignmentTask.order.asc().nulls_last(), AssignmentTask.id.asc())  # type: ignore[union-attr]
    )).scalars().all())
    answers: dict[int, AssignmentTaskSubmission] = {}
    if current and tasks:
        rows = (await db.execute(
            select(AssignmentTaskSubmission).where(
                AssignmentTaskSubmission.user_id == review.reviewee_user_id,
                AssignmentTaskSubmission.assignment_task_id.in_([t.id for t in tasks]),  # type: ignore[attr-defined]
            )
        )).scalars().all()
        answers = {a.assignment_task_id: a for a in rows}

    out_tasks = []
    for task in tasks:
        answer = answers.get(task.id)  # type: ignore[arg-type]
        hidden = is_auto_graded(task)
        cleaned, has_file = _sanitize_answer(answer.task_submission if answer and not hidden else None)
        out_tasks.append({
            "assignment_task_uuid": task.assignment_task_uuid,
            "title": task.title,
            "description": task.description,
            "assignment_type": task.assignment_type.value if hasattr(task.assignment_type, "value") else task.assignment_type,
            "contents": _strip_answer_key(task.contents),
            "task_submission": cleaned,
            "file_url": file_path(review.review_uuid, task.assignment_task_uuid) if has_file else None,
            "order": task.order,
            "answer_hidden": hidden,
        })
    reviewee = await _reviewee_party(db, settings, review)
    return {
        "review": _review_dict(review, rubric, audience="reviewer", reviewee=reviewee),
        "tasks": out_tasks,
        "reviewee": reviewee,
        "assignment_uuid": ctx.assignment.assignment_uuid,
        "assignment_title": ctx.assignment.title,
        "rubric": rubric,
        "prompts": list(settings.prompts) if settings and settings.prompts else None,
        "effective_prompts": effective_prompts(settings),
        "submission_changed": not current,
    }


async def get_review_file(
    request: Request, db: AsyncSession, user: User_, review_uuid: str, task_uuid: str
) -> tuple[bytes, str]:
    """The reviewee's uploaded file for one task, for the assigned reviewer or
    a course instructor. Returns (bytes, neutral download name): the stored
    name carries the uploader's id, so it is never echoed."""
    from src.services.utils.upload_content import read_content

    _block_api_tokens(user)
    if isinstance(user, AnonymousUser):
        raise HTTPException(status_code=401, detail="Authentication required")
    review, ctx = await _review_ctx(request, db, user, review_uuid)
    if review.kind != "peer":
        raise HTTPException(status_code=404, detail="File not found")
    is_instructor = await _is_assignment_instructor(request, user, ctx.course.course_uuid, db)
    if not is_instructor:
        if review.reviewer_user_id != user.id:
            raise HTTPException(status_code=404, detail="File not found")
        await _gate_learner_review(db, ctx)
        await _require_reviewer_submission(db, ctx.assignment, int(user.id))  # type: ignore[union-attr]
        reviewee_sub = await _my_submission(db, ctx.assignment, review.reviewee_user_id or 0)
        if not (_reviewable(reviewee_sub) and reviewee_sub.attempt_number == review.attempt_number):  # type: ignore[union-attr]
            raise HTTPException(status_code=404, detail="File not found")

    task = (await db.execute(
        select(AssignmentTask).where(
            AssignmentTask.assignment_task_uuid == task_uuid,
            AssignmentTask.assignment_id == ctx.assignment.id,
        )
    )).scalars().first()
    answer = None
    if task is not None and (is_instructor or not is_auto_graded(task)):
        answer = (await db.execute(
            select(AssignmentTaskSubmission).where(
                AssignmentTaskSubmission.assignment_task_id == task.id,
                AssignmentTaskSubmission.user_id == review.reviewee_user_id,
            )
        )).scalars().first()
    data = answer.task_submission if answer is not None and isinstance(answer.task_submission, dict) else {}
    name = next((data.get(k) for k in _FILE_KEYS if isinstance(data.get(k), str) and data.get(k)), None)
    owner = submission_file_owner(name)
    if not name or (owner is not None and owner != review.reviewee_user_id):
        raise HTTPException(status_code=404, detail="File not found")
    org = (await db.execute(select(Organization).where(Organization.id == ctx.assignment.org_id))).scalars().first()
    if org is None or ctx.activity is None:
        raise HTTPException(status_code=404, detail="File not found")
    content = await read_content(
        f"courses/{ctx.course.course_uuid}/activities/{ctx.activity.activity_uuid}"
        f"/assignments/{ctx.assignment.assignment_uuid}/tasks/{task_uuid}/subs",
        "orgs", org.org_uuid, name,
    )
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    position = (task.order if task.order is not None else 0) + 1  # type: ignore[union-attr]
    return content, f"submission-{position}.{ext}" if ext else f"submission-{position}"


async def save_review(
    request: Request, db: AsyncSession, user: User_, review_uuid: str, body: PeerReviewSaveBody
) -> dict:
    review, ctx = await _own_review(request, db, user, review_uuid)
    settings: AssignmentPeerReviewSettings = ctx.settings  # type: ignore[assignment]
    rubric = _rubric(settings)
    if review.status == "discarded":
        raise HTTPException(status_code=409, detail="This review was withdrawn")
    if review.status == "submitted":
        raise HTTPException(status_code=409, detail="This review is already submitted")
    reviewee_sub = await _my_submission(db, ctx.assignment, review.reviewee_user_id or 0)
    if not (_reviewable(reviewee_sub) and reviewee_sub.attempt_number == review.attempt_number):  # type: ignore[union-attr]
        _close_superseded(review)
        db.add(review)
        await db.commit()
        raise HTTPException(status_code=409, detail="Your classmate started a new attempt, so this review is no longer needed")

    review.scores = _validate_scores(body.scores, rubric, require_all=body.submit)
    review.comments = _validate_comments(body.comments, effective_prompts(settings), enforce_min=body.submit)
    review.criterion_comments = _validate_criterion_comments(body.criterion_comments, rubric)
    review.update_date = _now()
    if body.submit:
        review.status = "submitted"
        review.submitted_at = _now()
    db.add(review)
    await db.commit()
    await db.refresh(review)

    if body.submit and ctx.activity is not None:
        from src.services.feature_notifications import notify_peer_review_received

        await notify_peer_review_received(
            db, assignment=ctx.assignment, course=ctx.course, activity=ctx.activity,
            reviewee_id=int(review.reviewee_user_id),  # type: ignore[arg-type]
        )
    return _review_dict(review, rubric, audience="reviewer", reviewee=await _reviewee_party(db, settings, review))


async def close_superseded_reviews(db: AsyncSession, assignment_id: int, reviewee_id: int, attempt: int) -> int:
    """Called after a learner retries: their older attempt's task answers are
    wiped, so open (assigned) reviews of it are closed with a system reason.
    Submitted ones stay as history. Never raises."""
    try:
        rows = (await db.execute(
            select(AssignmentPeerReview).where(
                AssignmentPeerReview.assignment_id == assignment_id,
                AssignmentPeerReview.reviewee_user_id == reviewee_id,
                AssignmentPeerReview.kind == "peer",
                AssignmentPeerReview.status == "assigned",
                AssignmentPeerReview.attempt_number < attempt,
            )
        )).scalars().all()
        for row in rows:
            _close_superseded(row)
            db.add(row)
        if rows:
            await db.commit()
        return len(rows)
    except Exception:
        await db.rollback()
        return 0


# ---------------------------------------------------------------------------
# Self review, calibration, reflection
# ---------------------------------------------------------------------------


async def submit_self_review(
    request: Request, db: AsyncSession, user: User_, assignment_uuid: str, body: PeerSelfReviewBody
) -> dict:
    ctx = await _learner_ctx(request, db, user, await _load_by_uuid(db, assignment_uuid))
    await _not_instructor(request, db, user, ctx)
    settings: AssignmentPeerReviewSettings = ctx.settings  # type: ignore[assignment]
    if not settings.self_review_enabled:
        raise HTTPException(status_code=400, detail="Self-review is turned off for this assignment")
    uid = int(user.id)  # type: ignore[union-attr]
    mine = await _my_submission(db, ctx.assignment, uid)
    if not _reviewable(mine):
        raise HTTPException(status_code=403, detail="Submit your work before reviewing it")
    rubric = _rubric(settings)
    scores = _validate_scores(body.scores, rubric, require_all=True)
    comments = _validate_comments(body.comments, effective_prompts(settings), enforce_min=False)
    notes = _validate_criterion_comments(body.criterion_comments, rubric)

    rows = await _reviews(db, ctx.assignment, reviewer_user_id=uid, kind="self")
    row = rows[0] if rows else AssignmentPeerReview(
        review_uuid=f"peerreview_{uuid4()}",
        assignment_id=ctx.assignment.id,  # type: ignore[arg-type]
        org_id=ctx.assignment.org_id,
        reviewer_user_id=uid,
        reviewee_user_id=uid,
        kind="self",
        creation_date=_now(),
        update_date=_now(),
        assigned_at=_now(),
    )
    row.attempt_number = mine.attempt_number  # type: ignore[union-attr]
    row.scores, row.comments, row.criterion_comments = scores, comments, notes
    row.status = "submitted"
    row.submitted_at = _now()
    row.update_date = _now()
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _review_dict(row, rubric, audience="self")


async def list_calibration(request: Request, db: AsyncSession, user: User_, assignment_uuid: str) -> dict:
    ctx = await _learner_ctx(request, db, user, await _load_by_uuid(db, assignment_uuid))
    settings: AssignmentPeerReviewSettings = ctx.settings  # type: ignore[assignment]
    mine = {
        r.calibration_sample_id: r
        for r in await _reviews(db, ctx.assignment, reviewer_user_id=int(user.id), kind="calibration")  # type: ignore[union-attr]
    }
    enabled, _total, _done = _calibration_state(settings, list(mine.values()))
    samples = list(settings.calibration_samples or []) if enabled else []
    return {
        "enabled": enabled,
        "samples": [_sample_for_learner(smp, mine.get(smp.get("id"))) for smp in samples],
    }


def calibration_comparison(sample: dict, scores: dict, rubric: list[dict]) -> dict:
    points = _level_points(rubric)
    instructor = sample.get("scores") or {}
    rows = []
    for criterion in rubric:
        cid = criterion["id"]
        mine, theirs = scores.get(cid), instructor.get(cid)
        rows.append({
            "criterion_id": cid,
            "title": criterion.get("title"),
            "your_level_id": mine,
            "instructor_level_id": theirs,
            "your_points": _round(points[cid].get(mine)) if mine in points[cid] else None,
            "instructor_points": _round(points[cid].get(theirs)) if theirs in points[cid] else None,
            "match": mine is not None and mine == theirs,
        })
    return {"sample_id": sample.get("id"), "criteria": rows, "explanation": sample.get("explanation")}


async def submit_calibration(
    request: Request, db: AsyncSession, user: User_, assignment_uuid: str, sample_id: str, body: PeerCalibrationBody
) -> dict:
    ctx = await _learner_ctx(request, db, user, await _load_by_uuid(db, assignment_uuid))
    await _not_instructor(request, db, user, ctx)
    settings: AssignmentPeerReviewSettings = ctx.settings  # type: ignore[assignment]
    samples = list(settings.calibration_samples or [])
    if not (settings.calibration_enabled and samples):
        raise HTTPException(status_code=400, detail="The practice round is turned off for this assignment")
    sample = next((smp for smp in samples if smp.get("id") == sample_id), None)
    if sample is None:
        raise HTTPException(status_code=404, detail="Practice sample not found")
    uid = int(user.id)  # type: ignore[union-attr]
    rubric = _rubric(settings)
    existing = [
        r for r in await _reviews(db, ctx.assignment, reviewer_user_id=uid, kind="calibration")
        if r.calibration_sample_id == sample_id
    ]
    if existing:
        raise HTTPException(status_code=409, detail="You already scored this practice sample")
    scores = _validate_scores(body.scores, rubric, require_all=True)
    row = AssignmentPeerReview(
        review_uuid=f"peerreview_{uuid4()}",
        assignment_id=ctx.assignment.id,  # type: ignore[arg-type]
        org_id=ctx.assignment.org_id,
        reviewer_user_id=uid,
        reviewee_user_id=None,
        kind="calibration",
        calibration_sample_id=sample_id,
        attempt_number=1,
        status="submitted",
        scores=scores, comments={}, criterion_comments={},
        assigned_at=_now(), submitted_at=_now(), creation_date=_now(), update_date=_now(),
    )
    db.add(row)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="You already scored this practice sample")
    return calibration_comparison(sample, scores, rubric)


async def save_reflection(
    request: Request, db: AsyncSession, user: User_, assignment_uuid: str, body: PeerReflectionBody
) -> dict:
    ctx = await _learner_ctx(request, db, user, await _load_by_uuid(db, assignment_uuid))
    settings: AssignmentPeerReviewSettings = ctx.settings  # type: ignore[assignment]
    if not settings.revision_plan_enabled:
        raise HTTPException(status_code=400, detail="The revision plan is turned off for this assignment")
    uid = int(user.id)  # type: ignore[union-attr]
    if not _reviewable(await _my_submission(db, ctx.assignment, uid)):
        raise HTTPException(status_code=403, detail="Submit your work before writing a revision plan")
    row = await _reflection(db, ctx.assignment, uid)
    if row is None:
        row = AssignmentPeerReflection(
            assignment_id=ctx.assignment.id,  # type: ignore[arg-type]
            org_id=ctx.assignment.org_id,
            user_id=uid,
            creation_date=_now(),
            update_date=_now(),
        )
    row.plan = body.plan
    row.update_date = _now()
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _reflection_dict(row)  # type: ignore[return-value]


# ---------------------------------------------------------------------------
# Back-evaluation by the reviewee
# ---------------------------------------------------------------------------


async def _received_review(request: Request, db: AsyncSession, user: User_, review_uuid: str):
    """A submitted peer review the caller received and may read right now."""
    _block_api_tokens(user)
    if isinstance(user, AnonymousUser):
        raise HTTPException(status_code=401, detail="Authentication required")
    review, ctx = await _review_ctx(request, db, user, review_uuid)
    if review.kind != "peer" or review.reviewee_user_id != user.id:
        raise HTTPException(status_code=404, detail="Review not found")
    await _gate_learner_review(db, ctx)
    if review.status != "submitted":
        raise HTTPException(status_code=409, detail="This review can't be rated or flagged")
    settings: AssignmentPeerReviewSettings = ctx.settings  # type: ignore[assignment]
    subs = await _submissions(db, ctx.assignment)
    given = await _reviews(db, ctx.assignment, reviewer_user_id=int(user.id), kind="peer", status="submitted")  # type: ignore[union-attr]
    unlocked, _ = feedback_state(settings, len(given), _effective_required(settings, subs, int(user.id)))  # type: ignore[union-attr]
    if not unlocked:
        raise HTTPException(status_code=403, detail="Finish your reviews to unlock your feedback first")
    return review, ctx


async def _received_out(db: AsyncSession, ctx: _Ctx, review: AssignmentPeerReview) -> dict:
    settings = ctx.settings
    rubric = _rubric(settings)
    hide = _hide_reviewer(settings)
    received = _kept_received(await _reviews(db, ctx.assignment), review.reviewee_user_id or 0, review.attempt_number)
    label = _labels(received).get(review.id or 0) if hide else None
    users = await _users(db, [] if hide else [review.reviewer_user_id])
    return _review_dict(
        review, rubric, audience="reviewee", reviewer_label=label,
        reviewer=_party(users.get(review.reviewer_user_id), label=label, hidden=hide),
    )


async def rate_review(request: Request, db: AsyncSession, user: User_, review_uuid: str, body: PeerRateBody) -> dict:
    review, ctx = await _received_review(request, db, user, review_uuid)
    if not ctx.settings.helpfulness_enabled:  # type: ignore[union-attr]
        raise HTTPException(status_code=400, detail="Helpfulness ratings are turned off for this assignment")
    review.helpfulness = body.helpfulness
    review.helpfulness_note = (body.note or "").strip() or None
    review.update_date = _now()
    db.add(review)
    await db.commit()
    await db.refresh(review)
    return await _received_out(db, ctx, review)


async def flag_review(request: Request, db: AsyncSession, user: User_, review_uuid: str, body: PeerFlagBody) -> dict:
    review, ctx = await _received_review(request, db, user, review_uuid)
    reason = body.reason.strip()
    if not reason:
        raise HTTPException(status_code=422, detail="Say what is wrong with this review")
    newly = not review.flagged
    review.flagged = True
    review.flag_reason = reason
    review.update_date = _now()
    db.add(review)
    await db.commit()
    await db.refresh(review)
    if newly:
        from src.services.feature_notifications import notify_peer_review_flagged

        await notify_peer_review_flagged(
            db, assignment=ctx.assignment, course=ctx.course, reviewee_id=int(user.id), reason=reason,  # type: ignore[union-attr]
        )
    return await _received_out(db, ctx, review)


__all__ = [
    "AssignmentTaskTypeEnum",
    "calibration_comparison",
    "discard_review",
    "feature_available",
    "feedback_state",
    "file_path",
    "flag_review",
    "get_learner_state",
    "get_overview",
    "get_review",
    "get_review_file",
    "get_settings",
    "get_submission_detail",
    "list_calibration",
    "next_review",
    "peer_score",
    "rate_review",
    "restore_review",
    "review_percentage",
    "save_reflection",
    "save_review",
    "settings_view",
    "submit_calibration",
    "submit_self_review",
    "update_settings",
]
