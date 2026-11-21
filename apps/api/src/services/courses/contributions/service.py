"""Course contributions: who may suggest, suggestions, review, credit.

Off unless a course owner turns it on (``course_contribution_settings``), and
only on plans that include it (``FEATURE_PLAN_REQUIREMENTS["contributions"]``).

Who does what:
- **Contributors** (the audience the course picks: enrolled learners, org
  members, or anyone signed in who can open the course) suggest edits and
  give feedback from the learner page. API tokens and anonymous visitors
  can't: a contribution is made by a person.
- **Reviewers** are the people who may edit the course (course UPDATE): they
  accept, edit-then-accept, reject or ask for changes.
- **Managers** (course creator/maintainer, org admins) change the settings and
  mark contributors trusted or blocked.

Accepting replaces the suggestion's blocks in the page as it is now (located
by fingerprint, see ``blocks.py``), snapshots the previous content as a
version first so it can be restored, and credits the author on the blocks
they wrote.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Optional
from uuid import uuid4

from fastapi import HTTPException, Request
from sqlalchemy import func
from sqlalchemy.orm.attributes import flag_modified
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.activities import Activity
from src.db.courses.activity_comments import ActivityComment, ActivityCommentThread, QUOTE_MAX
from src.db.courses.contributions import (
    MAX_PAYLOAD_BYTES,
    OPEN_STATUSES,
    ActivityContributionContext,
    BlockCredit,
    ContentAttribution,
    ContentSuggestion,
    ContributionSummary,
    ContributorList,
    ContributorRead,
    ContributorUpdate,
    ContributorUser,
    CourseContributionSettings,
    CourseContributor,
    FeedbackComment,
    FeedbackCreate,
    FeedbackList,
    FeedbackRead,
    FeedbackReply,
    FeedbackStatus,
    SettingsRead,
    SettingsUpdate,
    SuggestionAccept,
    SuggestionCreate,
    SuggestionDecision,
    SuggestionList,
    SuggestionPlacement,
    SuggestionRead,
    SuggestionRevise,
    UserContributionCourse,
    UserContributions,
)
from src.db.courses.courses import Course
from src.db.trail_runs import TrailRun
from src.db.users import AnonymousUser, PublicUser, User
from src.security.features_utils.plans import FEATURE_PLAN_REQUIREMENTS
from src.security.rbac import AccessAction, check_resource_access
from src.services.courses.contributions import blocks as B

logger = logging.getLogger(__name__)

# Per person, across courses: a person improving a page, not a script.
SUGGEST_LIMIT = 20
FEEDBACK_LIMIT = 20
WINDOW_SECONDS = 3600
# Open (pending or sent back) suggestions one person may have on a course.
MAX_OPEN_PER_COURSE = 25
PAGE_MAX = 100


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ─── loading and permissions ─────────────────────────────────────────────────


def _person(current_user) -> Optional[PublicUser]:
    """The signed-in person, or None (anonymous visitor, API token)."""
    if isinstance(current_user, AnonymousUser) or not isinstance(current_user, PublicUser):
        return None
    return current_user


def _require_person(current_user) -> PublicUser:
    user = _person(current_user)
    if user is None:
        raise HTTPException(status_code=401, detail="Sign in to contribute")
    return user


def _check_rate(kind: str, user_id: int, limit: int) -> None:
    """Fail open when Redis is unreachable, like comments."""
    from src.services.security.rate_limiting import check_rate_limit

    try:
        allowed, _count, retry_after = check_rate_limit(
            key=f"contributions:{kind}:{user_id}", max_attempts=limit, window_seconds=WINDOW_SECONDS
        )
    except Exception:
        logger.warning("Contribution rate limit unavailable", exc_info=True)
        return
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail="You've sent a lot of contributions, try again later",
            headers={"Retry-After": str(retry_after)},
        )


async def _plan_allows(org_id: int, db_session: AsyncSession) -> bool:
    from src.security.features_utils.plan_check import check_org_plan

    try:
        return await check_org_plan(org_id, FEATURE_PLAN_REQUIREMENTS["contributions"], "Contributions", db_session)
    except HTTPException:
        return False


async def _course_by_uuid(course_uuid: str, db_session: AsyncSession) -> Course:
    course = (await db_session.execute(select(Course).where(Course.course_uuid == course_uuid))).scalars().first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    return course


async def _activity_and_course(activity_uuid: str, db_session: AsyncSession) -> tuple[Activity, Course]:
    row = (await db_session.execute(
        select(Activity, Course)
        .join(Course, Course.id == Activity.course_id)  # type: ignore[arg-type]
        .where(Activity.activity_uuid == activity_uuid)
    )).first()
    if not row:
        raise HTTPException(status_code=404, detail="Activity not found")
    return row[0], row[1]


async def _can(request: Request, user, course: Course, action: AccessAction, db_session: AsyncSession) -> bool:
    decision = await check_resource_access(
        request, db_session, user, course.course_uuid, action, raise_on_deny=False
    )
    return bool(decision.allowed)


def _is_page(activity: Activity) -> bool:
    """Contributions are for block pages (the editor's documents)."""
    from src.db.courses.activities import ActivitySubTypeEnum, ActivityTypeEnum

    return (
        activity.activity_type == ActivityTypeEnum.TYPE_DYNAMIC
        and activity.activity_sub_type == ActivitySubTypeEnum.SUBTYPE_DYNAMIC_PAGE
    )


async def _can_read_activity(request: Request, user, activity: Activity, course: Course, db_session: AsyncSession) -> bool:
    """The learner page's own gate: published (or editable), paid for, not
    locked. Course editors pass it."""
    from src.services.courses.activities.access import verify_activity_reader_access

    try:
        await verify_activity_reader_access(request, activity, course, user, db_session)
    except HTTPException:
        return False
    return True


async def _require_reader(request: Request, user, activity: Activity, course: Course, db_session: AsyncSession) -> None:
    if not await _can_read_activity(request, user, activity, course, db_session):
        raise HTTPException(status_code=404, detail="Activity not found")


async def _require_reviewer(request: Request, current_user, course: Course, db_session: AsyncSession) -> PublicUser:
    user = _require_person(current_user)
    await check_resource_access(request, db_session, user, course.course_uuid, AccessAction.UPDATE)
    return user


async def _settings_row(course: Course, db_session: AsyncSession) -> Optional[CourseContributionSettings]:
    return (await db_session.execute(
        select(CourseContributionSettings).where(CourseContributionSettings.course_id == course.id)
    )).scalars().first()


async def _contributor(course: Course, user_id: int, db_session: AsyncSession) -> Optional[CourseContributor]:
    return (await db_session.execute(
        select(CourseContributor).where(
            CourseContributor.course_id == course.id, CourseContributor.user_id == user_id
        )
    )).scalars().first()


def _settings_read(row: Optional[CourseContributionSettings], plan_allowed: bool) -> SettingsRead:
    if row is None:
        return SettingsRead(plan_allowed=plan_allowed)
    return SettingsRead(
        enabled=row.enabled,
        audience=row.audience if row.audience in ("enrolled", "members", "signed_in") else "enrolled",  # type: ignore[arg-type]
        allow_suggestions=row.allow_suggestions,
        allow_feedback=row.allow_feedback,
        trusted_publish=row.trusted_publish,
        plan_allowed=plan_allowed,
    )


async def _active_settings(course: Course, db_session: AsyncSession) -> Optional[CourseContributionSettings]:
    """The course's settings when contributions are on and the plan has them."""
    row = await _settings_row(course, db_session)
    if row is None or not row.enabled:
        return None
    if not await _plan_allows(course.org_id, db_session):
        return None
    return row


class _Eligibility:
    def __init__(self) -> None:
        self.enabled = False
        self.can_suggest = False
        self.can_feedback = False
        self.can_review = False
        self.publishes_directly = False
        self.reason: Optional[str] = None
        self.settings: Optional[CourseContributionSettings] = None
        self.user: Optional[PublicUser] = None


async def _eligibility(request: Request, current_user, course: Course, db_session: AsyncSession) -> _Eligibility:
    out = _Eligibility()
    settings = await _active_settings(course, db_session)
    if settings is None:
        return out
    out.enabled = True
    out.settings = settings
    # Who can't open the course learns nothing about it, signed in or not.
    if not await _can(request, current_user, course, AccessAction.READ, db_session):
        out.reason = "access"
        return out
    user = _person(current_user)
    if user is None:
        out.reason = "signin"
        return out
    out.user = user
    out.can_review = await _can(request, user, course, AccessAction.UPDATE, db_session)
    record = await _contributor(course, user.id, db_session)
    if record is not None and record.blocked and not out.can_review:
        out.reason = "blocked"
        return out
    allowed = out.can_review
    if not allowed:
        if settings.audience == "signed_in":
            allowed = True
        elif settings.audience == "members":
            from src.security.org_auth import is_org_member

            allowed = await is_org_member(user.id, course.org_id, db_session)
            out.reason = None if allowed else "members"
        else:
            enrolled = (await db_session.execute(
                select(TrailRun.id).where(TrailRun.course_id == course.id, TrailRun.user_id == user.id).limit(1)
            )).first()
            allowed = enrolled is not None
            out.reason = None if allowed else "enroll"
    if not allowed:
        return out
    out.can_suggest = settings.allow_suggestions
    out.can_feedback = settings.allow_feedback
    out.publishes_directly = bool(
        settings.trusted_publish and record is not None and record.trusted and not out.can_review
    )
    return out


# ─── users ───────────────────────────────────────────────────────────────────


def _user_read(user: Optional[User]) -> Optional[ContributorUser]:
    if user is None or user.id is None:
        return None
    return ContributorUser(
        id=user.id,
        user_uuid=user.user_uuid,
        username=user.username,
        first_name=user.first_name or "",
        last_name=user.last_name or "",
        avatar_image=user.avatar_image or "",
    )


async def _users(ids, db_session: AsyncSession) -> dict[int, User]:
    wanted = {i for i in ids if i}
    if not wanted:
        return {}
    rows = (await db_session.execute(select(User).where(User.id.in_(wanted)))).scalars().all()  # type: ignore[union-attr]
    return {u.id: u for u in rows if u.id is not None}


def _display(user: Optional[User]) -> str:
    if user is None:
        return ""
    return f"{user.first_name or ''} {user.last_name or ''}".strip() or user.username


# ─── settings ────────────────────────────────────────────────────────────────


async def get_settings(request: Request, course_uuid: str, current_user, db_session: AsyncSession) -> SettingsRead:
    course = await _course_by_uuid(course_uuid, db_session)
    await _require_reviewer(request, current_user, course, db_session)
    return _settings_read(await _settings_row(course, db_session), await _plan_allows(course.org_id, db_session))


async def update_settings(
    request: Request, course_uuid: str, payload: SettingsUpdate, current_user, db_session: AsyncSession
) -> SettingsRead:
    from src.services.courses.contributors import _require_contributor_manager

    course = await _course_by_uuid(course_uuid, db_session)
    user = _require_person(current_user)
    await _require_contributor_manager(request, course_uuid, user, db_session)
    plan_allowed = await _plan_allows(course.org_id, db_session)
    if payload.enabled and not plan_allowed:
        raise HTTPException(
            status_code=403,
            detail=f"Contributions require a {FEATURE_PLAN_REQUIREMENTS['contributions'].capitalize()} plan or higher",
        )
    row = await _settings_row(course, db_session)
    now = _now()
    if row is None:
        row = CourseContributionSettings(course_id=course.id, org_id=course.org_id, created_at=now)
    for field in ("enabled", "audience", "allow_suggestions", "allow_feedback", "trusted_publish"):
        value = getattr(payload, field)
        if value is not None:
            setattr(row, field, value)
    row.updated_at = now
    row.updated_by = user.id
    db_session.add(row)
    await db_session.commit()
    await db_session.refresh(row)
    return _settings_read(row, plan_allowed)


# ─── placement ───────────────────────────────────────────────────────────────


def _loose_match(stored: dict, sent: dict) -> bool:
    """Same block, allowing for attributes the learner's editor filled in with
    their defaults: same type, and every setting the stored block has is the
    same in the sent one."""
    if stored.get("type") != sent.get("type"):
        return False
    if B.text_of(stored) != B.text_of(sent) and B._norm(B.text_of(stored)) != B._norm(B.text_of(sent)):
        return False
    sattrs = stored.get("attrs") if isinstance(stored.get("attrs"), dict) else {}
    tattrs = sent.get("attrs") if isinstance(sent.get("attrs"), dict) else {}
    for k, v in sattrs.items():
        if k in B.VOLATILE_ATTRS or v is None or v == "":
            continue
        if tattrs.get(k) != v:
            return False
    return True


def _locate(blocks: list[dict], before: list[dict], prev_fp: Optional[str], target: int) -> Optional[int]:
    fps = B.fingerprints(blocks)
    if not before:
        if prev_fp is None:
            # A new insert with no anchor: the index the learner picked.
            return target if target <= len(blocks) else None
        return B.locate_insert(fps, prev_fp, target)
    at = B.locate_run(fps, B.fingerprints(before), target)
    if at is not None:
        return at
    n = len(before)
    starts = [
        i for i in range(len(blocks) - n + 1)
        if all(_loose_match(blocks[i + k], before[k]) for k in range(n))
    ]
    return B._nearest(starts, target)


def _placement(activity: Activity, s: ContentSuggestion) -> SuggestionPlacement:
    blocks = B.blocks_of(activity.content)
    version = activity.current_version or 1
    at = _locate(blocks, list(s.before or []), s.prev_fp, s.start_index)
    if at is not None:
        return SuggestionPlacement(
            state="clean" if at == s.start_index else "moved",
            current_version=version,
            start_index=at,
            current=blocks[at:at + len(s.before or [])],
        )
    start, region = B.best_region(blocks, list(s.before or []), s.start_index)
    return SuggestionPlacement(state="conflict", current_version=version, start_index=start, current=region)


def _check_restricted(before: list[dict], after: list[dict]) -> None:
    """Blocks that carry raw HTML or third-party code (embeds, magic blocks,
    H5P) can be kept, moved or removed by a contributor, never created or
    changed: only the course team edits them."""
    if B.new_restricted_nodes(before, after):
        raise HTTPException(status_code=400, detail="This kind of block can only be changed by the course team")


def _payload_size(nodes: list) -> int:
    try:
        return len(json.dumps(nodes))
    except (TypeError, ValueError):
        return MAX_PAYLOAD_BYTES + 1


# ─── reads ───────────────────────────────────────────────────────────────────


async def _suggestion_reads(
    rows: list[ContentSuggestion], db_session: AsyncSession, *, with_placement: bool = False
) -> list[SuggestionRead]:
    if not rows:
        return []
    users = await _users([r.author_id for r in rows] + [r.reviewed_by for r in rows], db_session)
    activity_ids = {r.activity_id for r in rows}
    pairs = (await db_session.execute(
        select(Activity, Course)
        .join(Course, Course.id == Activity.course_id)  # type: ignore[arg-type]
        .where(Activity.id.in_(activity_ids))  # type: ignore[union-attr]
    )).all()
    by_activity = {a.id: (a, c) for a, c in pairs}
    out = []
    for r in rows:
        activity, course = by_activity[r.activity_id]
        out.append(SuggestionRead(
            suggestion_uuid=r.suggestion_uuid,
            status=r.status,  # type: ignore[arg-type]
            author=_user_read(users.get(r.author_id or 0)),
            reviewer=_user_read(users.get(r.reviewed_by or 0)),
            course_uuid=course.course_uuid,
            course_name=course.name,
            activity_uuid=activity.activity_uuid,
            activity_name=activity.name,
            base_version=r.base_version,
            start_index=r.start_index,
            before=list(r.before or []),
            after=list(r.after or []),
            note=r.note,
            summary=r.summary,
            review_note=r.review_note,
            reviewed_at=r.reviewed_at,
            applied_version=r.applied_version,
            auto_published=r.auto_published,
            created_at=r.created_at,
            updated_at=r.updated_at,
            placement=_placement(activity, r) if with_placement and r.status in OPEN_STATUSES else None,
        ))
    return out


async def _load_suggestion(suggestion_uuid: str, db_session: AsyncSession) -> tuple[ContentSuggestion, Activity, Course]:
    row = (await db_session.execute(
        select(ContentSuggestion, Activity, Course)
        .join(Activity, Activity.id == ContentSuggestion.activity_id)  # type: ignore[arg-type]
        .join(Course, Course.id == ContentSuggestion.course_id)  # type: ignore[arg-type]
        .where(ContentSuggestion.suggestion_uuid == suggestion_uuid)
    )).first()
    if not row:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    return row[0], row[1], row[2]


async def _credits(activity: Activity, db_session: AsyncSession) -> list[BlockCredit]:
    rows = (await db_session.execute(
        select(ContentAttribution).where(ContentAttribution.activity_id == activity.id)
        .order_by(ContentAttribution.id)
    )).scalars().all()
    if not rows:
        return []
    fps = B.fingerprints(B.blocks_of(activity.content))
    users = await _users([r.user_id for r in rows], db_session)
    by_index: dict[int, list[int]] = {}
    for r in rows:
        at = B.fuzzy_locate(fps, r.block_fp, r.block_index)
        if at is None:
            continue
        ids = by_index.setdefault(at, [])
        if r.user_id not in ids:
            ids.append(r.user_id)
    out = []
    for index in sorted(by_index):
        people = [u for u in (_user_read(users.get(i)) for i in by_index[index]) if u is not None]
        if people:
            out.append(BlockCredit(block_index=index, block_fp=fps[index], users=people))
    return out


async def get_activity_context(
    request: Request, activity_uuid: str, current_user, db_session: AsyncSession
) -> ActivityContributionContext:
    activity, course = await _activity_and_course(activity_uuid, db_session)
    # Not someone who can open this page: say nothing about it, not even
    # whether it takes contributions.
    await _require_reader(request, current_user, activity, course, db_session)
    elig = await _eligibility(request, current_user, course, db_session)
    if not elig.enabled or not _is_page(activity):
        return ActivityContributionContext(current_version=activity.current_version or 1)
    mine = 0
    if elig.user is not None:
        mine = (await db_session.execute(
            select(func.count()).select_from(ContentSuggestion).where(
                ContentSuggestion.activity_id == activity.id,
                ContentSuggestion.author_id == elig.user.id,
                ContentSuggestion.status.in_(OPEN_STATUSES),  # type: ignore[attr-defined]
            )
        )).scalar_one()
    return ActivityContributionContext(
        enabled=True,
        can_suggest=elig.can_suggest,
        can_feedback=elig.can_feedback,
        can_review=elig.can_review,
        publishes_directly=elig.publishes_directly,
        current_version=activity.current_version or 1,
        reason=elig.reason,
        credits=await _credits(activity, db_session),
        my_open_suggestions=int(mine),
    )


# ─── suggestions ─────────────────────────────────────────────────────────────


async def create_suggestion(
    request: Request, activity_uuid: str, payload: SuggestionCreate, current_user, db_session: AsyncSession
) -> SuggestionRead:
    activity, course = await _activity_and_course(activity_uuid, db_session)
    elig = await _eligibility(request, current_user, course, db_session)
    if not elig.enabled:
        raise HTTPException(status_code=403, detail="This course doesn't take contributions")
    if elig.reason == "access" or not await _can_read_activity(request, current_user, activity, course, db_session):
        raise HTTPException(status_code=404, detail="Activity not found")
    if not _is_page(activity):
        raise HTTPException(status_code=400, detail="Only pages take suggested edits")
    if not elig.can_suggest or elig.user is None:
        raise HTTPException(status_code=401 if elig.reason == "signin" else 403, detail="You can't suggest edits on this course")
    user = elig.user
    before = B.clean_blocks(payload.before)
    after = B.clean_blocks(payload.after)
    if not before and not after:
        raise HTTPException(status_code=400, detail="A suggestion needs a change")
    if _payload_size(before) + _payload_size(after) > MAX_PAYLOAD_BYTES:
        raise HTTPException(status_code=413, detail="This suggestion is too large")
    if before and B.same_blocks(before, after):
        raise HTTPException(status_code=400, detail="Nothing changed")
    blocks = B.blocks_of(activity.content)
    at = _locate(blocks, before, payload.prev_fp, payload.start_index)
    if at is not None:
        _check_restricted(blocks[at:at + len(before)], after)
    if at is None:
        raise HTTPException(
            status_code=409,
            detail="This part of the page changed since you opened it. Reload the page and try again.",
        )
    # Store what the page holds (not the learner's copy of it), so review and
    # placement compare like with like.
    before = blocks[at:at + len(before)]
    open_count = (await db_session.execute(
        select(func.count()).select_from(ContentSuggestion).where(
            ContentSuggestion.course_id == course.id,
            ContentSuggestion.author_id == user.id,
            ContentSuggestion.status.in_(OPEN_STATUSES),  # type: ignore[attr-defined]
        )
    )).scalar_one()
    if open_count >= MAX_OPEN_PER_COURSE:
        raise HTTPException(status_code=429, detail="You have many suggestions waiting for review on this course")
    _check_rate("suggest", user.id, SUGGEST_LIMIT)
    now = _now()
    s = ContentSuggestion(
        suggestion_uuid=f"suggestion_{uuid4()}",
        org_id=course.org_id,
        course_id=course.id,
        activity_id=activity.id,
        author_id=user.id,
        status="pending",
        base_version=activity.current_version or 1,
        start_index=at,
        before=before,
        after=after,
        prev_fp=(B.fingerprint(blocks[at - 1]) if at > 0 else "") if not before else None,
        note=payload.note.strip(),
        summary=B.summarize(before, after)[:300],
        created_at=now,
        updated_at=now,
    )
    db_session.add(s)
    await db_session.commit()
    await db_session.refresh(s)
    if elig.publishes_directly:
        await _apply(s, activity, course, after, at, reviewer_id=None, db_session=db_session, current_user=user)
        s.auto_published = True
        db_session.add(s)
        await db_session.commit()
        await db_session.refresh(s)
    else:
        from src.services.courses.contributions.notify import suggestion_submitted

        await suggestion_submitted(db_session, course=course, activity=activity, suggestion=s, author=user)
    return (await _suggestion_reads([s], db_session))[0]


async def list_course_suggestions(
    request: Request,
    course_uuid: str,
    current_user,
    db_session: AsyncSession,
    status: Optional[str] = None,
    page: int = 1,
    limit: int = 20,
) -> SuggestionList:
    course = await _course_by_uuid(course_uuid, db_session)
    await _require_reviewer(request, current_user, course, db_session)
    limit = max(1, min(limit, PAGE_MAX))
    q = select(ContentSuggestion).where(ContentSuggestion.course_id == course.id)
    if status == "open":
        q = q.where(ContentSuggestion.status.in_(OPEN_STATUSES))  # type: ignore[attr-defined]
    elif status:
        q = q.where(ContentSuggestion.status == status)
    total = (await db_session.execute(select(func.count()).select_from(q.subquery()))).scalar_one()
    rows = (await db_session.execute(
        q.order_by(ContentSuggestion.id.desc()).offset((max(page, 1) - 1) * limit).limit(limit)  # type: ignore[union-attr]
    )).scalars().all()
    return SuggestionList(items=await _suggestion_reads(list(rows), db_session, with_placement=True), total=int(total))


async def list_my_suggestions(
    request: Request, current_user, db_session: AsyncSession, activity_uuid: Optional[str] = None
) -> SuggestionList:
    user = _require_person(current_user)
    q = select(ContentSuggestion).where(ContentSuggestion.author_id == user.id)
    if activity_uuid:
        activity, _course = await _activity_and_course(activity_uuid, db_session)
        q = q.where(ContentSuggestion.activity_id == activity.id)
    rows = (await db_session.execute(q.order_by(ContentSuggestion.id.desc()).limit(PAGE_MAX))).scalars().all()  # type: ignore[union-attr]
    return SuggestionList(items=await _suggestion_reads(list(rows), db_session), total=len(rows))


async def get_suggestion(request: Request, suggestion_uuid: str, current_user, db_session: AsyncSession) -> SuggestionRead:
    user = _require_person(current_user)
    s, activity, course = await _load_suggestion(suggestion_uuid, db_session)
    reviewer = await _can(request, user, course, AccessAction.UPDATE, db_session)
    if not reviewer and s.author_id != user.id:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    return (await _suggestion_reads([s], db_session, with_placement=reviewer))[0]


async def _rekey_attributions(
    activity: Activity, removed: list[dict], added: list[dict], start: int, db_session: AsyncSession
) -> None:
    """Credit on replaced blocks follows them to what they became (pairwise);
    credit on removed blocks without a counterpart goes."""
    if not removed:
        return
    removed_fps = B.fingerprints(removed)
    added_fps = B.fingerprints(added)
    rows = (await db_session.execute(
        select(ContentAttribution).where(
            ContentAttribution.activity_id == activity.id,
            ContentAttribution.block_fp.in_(set(removed_fps)),  # type: ignore[attr-defined]
        )
    )).scalars().all()
    seen: set[tuple[int, str]] = set()
    now = _now()
    for r in rows:
        k = removed_fps.index(r.block_fp)
        if k >= len(added_fps):
            await db_session.delete(r)
            continue
        new_fp = added_fps[k]
        key = (r.user_id, new_fp)
        if key in seen:
            await db_session.delete(r)
            continue
        seen.add(key)
        r.block_fp = new_fp
        r.block_type = str(added[k].get("type") or "")[:64]
        r.block_index = start + k
        r.updated_at = now
        db_session.add(r)
    await db_session.flush()


async def _credit(
    s: ContentSuggestion, activity: Activity, course: Course, added: list[dict], start: int, db_session: AsyncSession
) -> None:
    if s.author_id is None:
        return
    now = _now()
    for k, node in enumerate(added):
        fp = B.fingerprint(node)
        existing = (await db_session.execute(
            select(ContentAttribution).where(
                ContentAttribution.activity_id == activity.id,
                ContentAttribution.user_id == s.author_id,
                ContentAttribution.block_fp == fp,
            )
        )).scalars().first()
        if existing is None:
            existing = ContentAttribution(
                org_id=course.org_id, course_id=course.id, activity_id=activity.id,
                user_id=s.author_id, block_fp=fp, created_at=now,
            )
        existing.suggestion_id = s.id
        existing.block_type = str(node.get("type") or "")[:64]
        existing.block_index = start + k
        existing.updated_at = now
        db_session.add(existing)
    record = await _contributor(course, s.author_id, db_session)
    if record is None:
        record = CourseContributor(
            org_id=course.org_id, course_id=course.id, user_id=s.author_id, first_contribution_at=now,
        )
    record.accepted_count = (record.accepted_count or 0) + 1
    record.last_contribution_at = now
    db_session.add(record)


async def _apply(
    s: ContentSuggestion,
    activity: Activity,
    course: Course,
    after: list[dict],
    at: int,
    *,
    reviewer_id: Optional[int],
    db_session: AsyncSession,
    current_user,
    length: Optional[int] = None,
) -> None:
    """Replace the blocks at ``at`` with ``after`` as a new page version."""
    from src.services.ai.rag.queue import index_activity
    from src.services.courses.activities.collab_notify import notify_collab_content_changed
    from src.services.courses.activities.versioning import create_activity_version

    blocks = B.blocks_of(activity.content)
    n = len(s.before or []) if length is None else length
    removed = blocks[at:at + n]
    acting_id = reviewer_id or s.author_id
    # The page as it was, restorable from version history.
    version = await create_activity_version(activity, acting_id, db_session)
    author = (await _users([s.author_id], db_session)).get(s.author_id or 0)
    version.label = f"Before suggestion by {_display(author) or 'a contributor'}"[:120]
    db_session.add(version)
    content = dict(activity.content or {"type": "doc"})
    content["content"] = blocks[:at] + list(after) + blocks[at + n:]
    content.setdefault("type", "doc")
    activity.content = content
    activity.current_version = (activity.current_version or 1) + 1
    activity.update_date = str(datetime.now())
    activity.last_modified_by_id = acting_id
    flag_modified(activity, "content")
    db_session.add(activity)
    s.status = "accepted"
    s.after = list(after)
    s.reviewed_by = reviewer_id
    s.reviewed_at = _now()
    s.updated_at = s.reviewed_at
    s.applied_version = activity.current_version
    db_session.add(s)
    await _rekey_attributions(activity, removed, list(after), at, db_session)
    await _credit(s, activity, course, list(after), at, db_session)
    await db_session.commit()
    await db_session.refresh(activity)
    await db_session.refresh(s)
    index_activity(activity.id)
    notify_collab_content_changed(activity, current_user)
    from src.services.courses.contributions.notify import suggestion_decided

    await suggestion_decided(db_session, course=course, activity=activity, suggestion=s, reviewer_id=reviewer_id)


def _require_open(s: ContentSuggestion) -> None:
    if s.status not in OPEN_STATUSES:
        raise HTTPException(status_code=409, detail="This suggestion was already decided")


async def accept_suggestion(
    request: Request, suggestion_uuid: str, payload: SuggestionAccept, current_user, db_session: AsyncSession
) -> SuggestionRead:
    s, activity, course = await _load_suggestion(suggestion_uuid, db_session)
    user = await _require_reviewer(request, current_user, course, db_session)
    _require_open(s)
    if payload.expected_updated_at is not None and payload.expected_updated_at != s.updated_at:
        # Revised by its author while the reviewer was looking at it.
        raise HTTPException(
            status_code=409,
            detail={"code": "revised", "message": "The contributor changed this suggestion; review it again"},
        )
    after = B.clean_blocks(payload.after) if payload.after is not None else list(s.after or [])
    if _payload_size(after) > MAX_PAYLOAD_BYTES:
        raise HTTPException(status_code=413, detail="This suggestion is too large")
    blocks = B.blocks_of(activity.content)
    length: Optional[int] = None
    if payload.target is not None:
        t = payload.target
        if t.version != (activity.current_version or 1):
            raise HTTPException(status_code=409, detail="The page changed again; review the latest version")
        if t.start_index > len(blocks) or t.start_index + t.length > len(blocks):
            raise HTTPException(status_code=400, detail="That part of the page doesn't exist")
        at, length = t.start_index, t.length
    else:
        located = _locate(blocks, list(s.before or []), s.prev_fp, s.start_index)
        if located is None:
            raise HTTPException(
                status_code=409,
                detail={"code": "conflict", "message": "The page changed since this suggestion was made"},
            )
        at = located
    s.review_note = payload.note.strip()
    await _apply(s, activity, course, after, at, reviewer_id=user.id, db_session=db_session, current_user=user, length=length)
    return (await _suggestion_reads([s], db_session))[0]


async def _decide(
    request: Request, suggestion_uuid: str, status: str, payload: SuggestionDecision, current_user, db_session: AsyncSession
) -> SuggestionRead:
    s, activity, course = await _load_suggestion(suggestion_uuid, db_session)
    user = await _require_reviewer(request, current_user, course, db_session)
    _require_open(s)
    now = _now()
    s.status = status
    s.review_note = payload.note.strip()
    s.reviewed_by = user.id
    s.reviewed_at = now
    s.updated_at = now
    db_session.add(s)
    await db_session.commit()
    await db_session.refresh(s)
    from src.services.courses.contributions.notify import suggestion_decided

    await suggestion_decided(db_session, course=course, activity=activity, suggestion=s, reviewer_id=user.id)
    return (await _suggestion_reads([s], db_session))[0]


async def reject_suggestion(request, suggestion_uuid, payload, current_user, db_session) -> SuggestionRead:
    return await _decide(request, suggestion_uuid, "rejected", payload, current_user, db_session)


async def request_changes(request, suggestion_uuid, payload, current_user, db_session) -> SuggestionRead:
    if not payload.note.strip():
        raise HTTPException(status_code=400, detail="Say what should change")
    return await _decide(request, suggestion_uuid, "changes_requested", payload, current_user, db_session)


async def withdraw_suggestion(request: Request, suggestion_uuid: str, current_user, db_session: AsyncSession) -> SuggestionRead:
    user = _require_person(current_user)
    s, _activity, _course = await _load_suggestion(suggestion_uuid, db_session)
    if s.author_id != user.id:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    _require_open(s)
    s.status = "withdrawn"
    s.updated_at = _now()
    db_session.add(s)
    await db_session.commit()
    await db_session.refresh(s)
    return (await _suggestion_reads([s], db_session))[0]


async def revise_suggestion(
    request: Request, suggestion_uuid: str, payload: SuggestionRevise, current_user, db_session: AsyncSession
) -> SuggestionRead:
    """The author's new version after a reviewer asked for changes (or while
    it is still pending). Goes back to the queue."""
    user = _require_person(current_user)
    s, activity, course = await _load_suggestion(suggestion_uuid, db_session)
    if s.author_id != user.id:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    _require_open(s)
    elig = await _eligibility(request, user, course, db_session)
    if not elig.can_suggest or not await _can_read_activity(request, user, activity, course, db_session):
        raise HTTPException(status_code=403, detail="You can't suggest edits on this course")
    after = B.clean_blocks(payload.after)
    if not s.before and not after:
        raise HTTPException(status_code=400, detail="A suggestion needs a change")
    _check_restricted(list(s.before or []), after)
    if _payload_size(after) > MAX_PAYLOAD_BYTES:
        raise HTTPException(status_code=413, detail="This suggestion is too large")
    _check_rate("suggest", user.id, SUGGEST_LIMIT)
    was = s.status
    s.after = after
    if payload.note is not None:
        s.note = payload.note.strip()
    s.summary = B.summarize(list(s.before or []), after)[:300]
    s.status = "pending"
    s.updated_at = _now()
    db_session.add(s)
    await db_session.commit()
    await db_session.refresh(s)
    if was == "changes_requested":
        from src.services.courses.contributions.notify import suggestion_submitted

        await suggestion_submitted(db_session, course=course, activity=activity, suggestion=s, author=user)
    return (await _suggestion_reads([s], db_session))[0]


# ─── feedback (comment threads of kind "feedback") ───────────────────────────


async def _feedback_reads(threads: list[ActivityCommentThread], db_session: AsyncSession) -> list[FeedbackRead]:
    if not threads:
        return []
    ids = [t.id for t in threads]
    comments = (await db_session.execute(
        select(ActivityComment).where(ActivityComment.thread_id.in_(ids)).order_by(ActivityComment.id)  # type: ignore[attr-defined]
    )).scalars().all()
    by_thread: dict[int, list[ActivityComment]] = {i: [] for i in ids if i is not None}
    for c in comments:
        by_thread[c.thread_id].append(c)
    users = await _users([t.created_by for t in threads] + [c.author_id for c in comments], db_session)
    pairs = (await db_session.execute(
        select(Activity, Course)
        .join(Course, Course.id == Activity.course_id)  # type: ignore[arg-type]
        .where(Activity.id.in_({t.activity_id for t in threads}))  # type: ignore[union-attr]
    )).all()
    by_activity = {a.id: (a, c) for a, c in pairs}
    out = []
    for t in threads:
        activity, course = by_activity[t.activity_id]
        out.append(FeedbackRead(
            thread_uuid=t.thread_uuid,
            feedback_type=t.feedback_type or "suggestion",
            status="resolved" if t.status == "resolved" else "open",
            quote=t.quote,
            anchor=t.anchor if isinstance(t.anchor, dict) else None,
            author=_user_read(users.get(t.created_by or 0)),
            course_uuid=course.course_uuid,
            activity_uuid=activity.activity_uuid,
            activity_name=activity.name,
            created_at=t.created_at,
            updated_at=t.updated_at,
            comments=[
                FeedbackComment(
                    comment_uuid=c.comment_uuid,
                    author=_user_read(users.get(c.author_id or 0)),
                    body=c.body,
                    created_at=c.created_at,
                    from_team=c.author_id != t.created_by,
                )
                for c in by_thread.get(t.id or 0, []) if not c.deleted
            ],
        ))
    return out


async def create_feedback(
    request: Request, activity_uuid: str, payload: FeedbackCreate, current_user, db_session: AsyncSession
) -> FeedbackRead:
    activity, course = await _activity_and_course(activity_uuid, db_session)
    elig = await _eligibility(request, current_user, course, db_session)
    if not elig.enabled:
        raise HTTPException(status_code=403, detail="This course doesn't take feedback")
    if elig.reason == "access" or not await _can_read_activity(request, current_user, activity, course, db_session):
        raise HTTPException(status_code=404, detail="Activity not found")
    if not elig.can_feedback or elig.user is None:
        raise HTTPException(status_code=401 if elig.reason == "signin" else 403, detail="You can't give feedback on this course")
    user = elig.user
    body = payload.body.replace("\r\n", "\n").strip()
    if not body:
        raise HTTPException(status_code=400, detail="Feedback cannot be empty")
    _check_rate("feedback", user.id, FEEDBACK_LIMIT)
    now = _now()
    anchor = None
    if payload.block_index is not None or payload.block_fp:
        anchor = {"block_index": payload.block_index, "block_fp": (payload.block_fp or "")[:600]}
    thread = ActivityCommentThread(
        thread_uuid=f"thread_{uuid4()}",
        activity_id=activity.id,
        org_id=course.org_id,
        created_by=user.id,
        quote=" ".join(payload.quote.split())[:QUOTE_MAX],
        status="open",
        created_at=now,
        updated_at=now,
        kind="feedback",
        feedback_type=payload.feedback_type,
        anchor=anchor,
    )
    db_session.add(thread)
    await db_session.flush()
    db_session.add(ActivityComment(
        comment_uuid=f"comment_{uuid4()}", thread_id=thread.id, author_id=user.id, body=body, created_at=now,
    ))
    await db_session.commit()
    await db_session.refresh(thread)
    from src.services.courses.contributions.notify import feedback_submitted

    await feedback_submitted(db_session, course=course, activity=activity, thread=thread, author=user, body=body)
    return (await _feedback_reads([thread], db_session))[0]


async def list_course_feedback(
    request: Request,
    course_uuid: str,
    current_user,
    db_session: AsyncSession,
    status: Optional[str] = None,
    page: int = 1,
    limit: int = 20,
) -> FeedbackList:
    course = await _course_by_uuid(course_uuid, db_session)
    await _require_reviewer(request, current_user, course, db_session)
    limit = max(1, min(limit, PAGE_MAX))
    q = (
        select(ActivityCommentThread)
        .join(Activity, Activity.id == ActivityCommentThread.activity_id)  # type: ignore[arg-type]
        .where(Activity.course_id == course.id, ActivityCommentThread.kind == "feedback")
    )
    if status in ("open", "resolved"):
        q = q.where(ActivityCommentThread.status == status)
    total = (await db_session.execute(select(func.count()).select_from(q.subquery()))).scalar_one()
    rows = (await db_session.execute(
        q.order_by(ActivityCommentThread.id.desc()).offset((max(page, 1) - 1) * limit).limit(limit)  # type: ignore[union-attr]
    )).scalars().all()
    return FeedbackList(items=await _feedback_reads(list(rows), db_session), total=int(total))


async def list_my_feedback(
    request: Request, activity_uuid: str, current_user, db_session: AsyncSession
) -> FeedbackList:
    user = _require_person(current_user)
    activity, _course = await _activity_and_course(activity_uuid, db_session)
    rows = (await db_session.execute(
        select(ActivityCommentThread).where(
            ActivityCommentThread.activity_id == activity.id,
            ActivityCommentThread.kind == "feedback",
            ActivityCommentThread.created_by == user.id,
        ).order_by(ActivityCommentThread.id.desc()).limit(PAGE_MAX)  # type: ignore[union-attr]
    )).scalars().all()
    return FeedbackList(items=await _feedback_reads(list(rows), db_session), total=len(rows))


async def _load_feedback(
    request: Request, thread_uuid: str, current_user, db_session: AsyncSession
) -> tuple[ActivityCommentThread, Activity, Course, PublicUser, bool]:
    user = _require_person(current_user)
    row = (await db_session.execute(
        select(ActivityCommentThread, Activity, Course)
        .join(Activity, Activity.id == ActivityCommentThread.activity_id)  # type: ignore[arg-type]
        .join(Course, Course.id == Activity.course_id)  # type: ignore[arg-type]
        .where(ActivityCommentThread.thread_uuid == thread_uuid, ActivityCommentThread.kind == "feedback")
    )).first()
    if not row:
        raise HTTPException(status_code=404, detail="Feedback not found")
    thread, activity, course = row
    reviewer = await _can(request, user, course, AccessAction.UPDATE, db_session)
    if not reviewer and thread.created_by != user.id:
        raise HTTPException(status_code=404, detail="Feedback not found")
    return thread, activity, course, user, reviewer


async def _require_feedback_author_eligible(
    request: Request, user: PublicUser, reviewer: bool, activity: Activity, course: Course, db_session: AsyncSession
) -> None:
    """The learner keeps their thread only while they may still give
    feedback here (contributions on, not blocked, page still readable)."""
    if reviewer:
        return
    elig = await _eligibility(request, user, course, db_session)
    if not elig.can_feedback or not await _can_read_activity(request, user, activity, course, db_session):
        raise HTTPException(status_code=403, detail="You can't give feedback on this course")


async def reply_feedback(
    request: Request, thread_uuid: str, payload: FeedbackReply, current_user, db_session: AsyncSession
) -> FeedbackRead:
    thread, activity, course, user, reviewer = await _load_feedback(request, thread_uuid, current_user, db_session)
    await _require_feedback_author_eligible(request, user, reviewer, activity, course, db_session)
    body = payload.body.replace("\r\n", "\n").strip()
    if not body:
        raise HTTPException(status_code=400, detail="A reply cannot be empty")
    _check_rate("feedback", user.id, FEEDBACK_LIMIT)
    now = _now()
    db_session.add(ActivityComment(
        comment_uuid=f"comment_{uuid4()}", thread_id=thread.id, author_id=user.id, body=body, created_at=now,
    ))
    thread.updated_at = now
    if thread.status == "resolved" and not reviewer:
        # The learner answered: back on the team's list.
        thread.status = "open"
        thread.resolved_by = None
        thread.resolved_at = None
    db_session.add(thread)
    await db_session.commit()
    await db_session.refresh(thread)
    from src.services.courses.contributions.notify import feedback_replied

    await feedback_replied(db_session, course=course, activity=activity, thread=thread, author=user, body=body, from_team=reviewer)
    return (await _feedback_reads([thread], db_session))[0]


async def set_feedback_status(
    request: Request, thread_uuid: str, payload: FeedbackStatus, current_user, db_session: AsyncSession
) -> FeedbackRead:
    thread, activity, course, user, reviewer = await _load_feedback(request, thread_uuid, current_user, db_session)
    await _require_feedback_author_eligible(request, user, reviewer, activity, course, db_session)
    now = _now()
    thread.status = payload.status
    thread.resolved_by = user.id if payload.status == "resolved" else None
    thread.resolved_at = now if payload.status == "resolved" else None
    thread.updated_at = now
    db_session.add(thread)
    await db_session.commit()
    await db_session.refresh(thread)
    return (await _feedback_reads([thread], db_session))[0]


# ─── contributors ────────────────────────────────────────────────────────────


async def list_contributors(
    request: Request, course_uuid: str, current_user, db_session: AsyncSession, manage: bool = False
) -> ContributorList:
    """People credited on the course. Everyone who can open the course sees
    the public list; ``manage`` (reviewers) adds blocked people and flags."""
    course = await _course_by_uuid(course_uuid, db_session)
    if manage:
        await _require_reviewer(request, current_user, course, db_session)
    else:
        await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.READ)
    q = select(CourseContributor).where(CourseContributor.course_id == course.id)
    if not manage:
        q = q.where(CourseContributor.blocked == False, CourseContributor.accepted_count > 0)  # noqa: E712
    rows = (await db_session.execute(
        q.order_by(CourseContributor.accepted_count.desc(), CourseContributor.id)  # type: ignore[attr-defined]
    )).scalars().all()
    users = await _users([r.user_id for r in rows], db_session)
    items = []
    for r in rows:
        u = _user_read(users.get(r.user_id))
        if u is None:
            continue
        items.append(ContributorRead(
            user=u,
            accepted_count=r.accepted_count,
            trusted=r.trusted if manage else False,
            blocked=r.blocked if manage else False,
            first_contribution_at=r.first_contribution_at,
            last_contribution_at=r.last_contribution_at,
        ))
    return ContributorList(items=items, total=len(items))


async def _belongs_to_course(course: Course, user_id: int, db_session: AsyncSession) -> bool:
    from src.security.org_auth import get_user_org

    if await get_user_org(user_id, course.org_id, db_session) is not None:
        return True
    suggested = (await db_session.execute(
        select(ContentSuggestion.id).where(ContentSuggestion.course_id == course.id, ContentSuggestion.author_id == user_id).limit(1)
    )).first()
    if suggested:
        return True
    gave_feedback = (await db_session.execute(
        select(ActivityCommentThread.id)
        .join(Activity, Activity.id == ActivityCommentThread.activity_id)  # type: ignore[arg-type]
        .where(Activity.course_id == course.id, ActivityCommentThread.created_by == user_id, ActivityCommentThread.kind == "feedback")
        .limit(1)
    )).first()
    return gave_feedback is not None


async def update_contributor(
    request: Request, course_uuid: str, user_id: int, payload: ContributorUpdate, current_user, db_session: AsyncSession
) -> ContributorRead:
    from src.services.courses.contributors import _require_contributor_manager

    course = await _course_by_uuid(course_uuid, db_session)
    acting = _require_person(current_user)
    await _require_contributor_manager(request, course_uuid, acting, db_session)
    target = (await _users([user_id], db_session)).get(user_id)
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")
    record = await _contributor(course, user_id, db_session)
    if record is None:
        # Blocking someone who only gave feedback, or trusting someone ahead
        # of their first accepted edit, needs a row; only for people who
        # belong here (org members, or who already contributed to the course).
        if not await _belongs_to_course(course, user_id, db_session):
            raise HTTPException(status_code=404, detail="User not found")
        record = CourseContributor(org_id=course.org_id, course_id=course.id, user_id=user_id)
    if payload.trusted is not None:
        record.trusted = payload.trusted
    if payload.blocked is not None:
        record.blocked = payload.blocked
        if payload.blocked:
            record.trusted = False
    db_session.add(record)
    await db_session.commit()
    await db_session.refresh(record)
    return ContributorRead(
        user=_user_read(target),  # type: ignore[arg-type]
        accepted_count=record.accepted_count,
        trusted=record.trusted,
        blocked=record.blocked,
        first_contribution_at=record.first_contribution_at,
        last_contribution_at=record.last_contribution_at,
    )


async def get_summary(request: Request, course_uuid: str, current_user, db_session: AsyncSession) -> ContributionSummary:
    course = await _course_by_uuid(course_uuid, db_session)
    await _require_reviewer(request, current_user, course, db_session)
    pending = (await db_session.execute(
        select(func.count()).select_from(ContentSuggestion).where(
            ContentSuggestion.course_id == course.id, ContentSuggestion.status == "pending"
        )
    )).scalar_one()
    feedback = (await db_session.execute(
        select(func.count()).select_from(ActivityCommentThread)
        .join(Activity, Activity.id == ActivityCommentThread.activity_id)  # type: ignore[arg-type]
        .where(
            Activity.course_id == course.id,
            ActivityCommentThread.kind == "feedback",
            ActivityCommentThread.status == "open",
        )
    )).scalar_one()
    people = (await db_session.execute(
        select(func.count()).select_from(CourseContributor).where(
            CourseContributor.course_id == course.id, CourseContributor.accepted_count > 0
        )
    )).scalar_one()
    return ContributionSummary(pending_suggestions=int(pending), open_feedback=int(feedback), contributors=int(people))


async def get_user_contributions(
    request: Request, user_uuid: str, org_id: int, current_user, db_session: AsyncSession
) -> UserContributions:
    """Courses a person improved, for their profile: only courses the viewer
    can open."""
    target = (await db_session.execute(select(User).where(User.user_uuid == user_uuid))).scalars().first()
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")
    rows = (await db_session.execute(
        select(CourseContributor, Course)
        .join(Course, Course.id == CourseContributor.course_id)  # type: ignore[arg-type]
        .where(
            CourseContributor.user_id == target.id,
            CourseContributor.org_id == org_id,
            CourseContributor.accepted_count > 0,
            CourseContributor.blocked == False,  # noqa: E712
        )
        .order_by(CourseContributor.last_contribution_at.desc())  # type: ignore[union-attr]
        .limit(PAGE_MAX)
    )).all()
    items = []
    for record, course in rows:
        if not await _can(request, current_user, course, AccessAction.READ, db_session):
            continue
        items.append(UserContributionCourse(
            course_uuid=course.course_uuid,
            course_name=course.name,
            thumbnail_image=course.thumbnail_image or "",
            accepted_count=record.accepted_count,
            last_contribution_at=record.last_contribution_at,
        ))
    return UserContributions(items=items, total_accepted=sum(i.accepted_count for i in items))

