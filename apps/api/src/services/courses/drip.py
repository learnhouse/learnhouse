"""Drip content: when each chapter of a course opens for a learner.

The schedule lives on the course (``drip_settings``) and on each chapter
(``drip_rule``); see ``src/db/courses/drip.py`` for the shapes. This module
answers one question per chapter, "is it released for this reader yet?", and
the read paths act on the answer the same way they act on a chapter lock:

- the course tree (``_apply_locks_to_chapters``) marks the chapter and its
  activities locked and blanks their content;
- the single-activity gate (``apply_activity_lock``) does the same, which also
  covers media streams, ``/content`` files, trail progress and assignments,
  since they all go through ``verify_activity_reader_access``;
- the AI course assistant skips content from unreleased chapters.

Admins and anyone who can edit the course always see everything; callers
decide that bypass before asking.

Releases only ever move forward in time, so a cached anonymous view can open
a chapter late but never early.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Iterable, NamedTuple, Optional, Sequence

from fastapi import HTTPException, Request
from pydantic import ValidationError
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.activities import Activity
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.chapters import Chapter, ChapterRead
from src.db.courses.course_chapters import CourseChapter
from src.db.courses.courses import Course
from src.db.courses.drip import (
    ChapterDripRead,
    ChapterDripRule,
    CourseDripSettings,
    DripAnchor,
    DripLockReason,
    DripReleaseMode,
    DripScheduleRead,
    DripScheduleUpdate,
)
from src.db.trail_runs import TrailRun
from src.db.trail_steps import TrailStep
from src.db.usergroup_user import UserGroupUser
from src.db.usergroups import UserGroup
from src.db.users import AnonymousUser
from src.security.auth import resolve_acting_user_id
from src.security.features_utils.plan_check import check_org_plan
from src.security.features_utils.plans import FEATURE_PLAN_REQUIREMENTS
from src.security.rbac import AccessAction, check_resource_access


@dataclass
class DripState:
    locked: bool = False
    unlock_at: Optional[datetime] = None
    reason: Optional[DripLockReason] = None
    # Open chapters with a limited window: when they close again.
    closes_at: Optional[datetime] = None
    # Open chapters on a time rule: when they opened for this reader.
    opened_at: Optional[datetime] = None

    @property
    def unlock_at_iso(self) -> Optional[str]:
        return self.unlock_at.isoformat() if self.unlock_at else None

    @property
    def closes_at_iso(self) -> Optional[str]:
        return self.closes_at.isoformat() if self.closes_at else None


class DripChapter(NamedTuple):
    """One chapter as the schedule sees it, in course order."""
    id: int
    rule: Optional[dict]
    uuid: Optional[str] = None


def course_drip_settings(course: Course) -> Optional[CourseDripSettings]:
    """The course's schedule when drip is on, else None.

    A stored value that no longer validates turns drip off rather than
    locking everyone out of the course."""
    if not course.drip_settings:
        return None
    try:
        settings = CourseDripSettings.model_validate(course.drip_settings)
    except ValidationError:
        return None
    return settings if settings.enabled else None


def chapter_drip_rule(raw: Optional[dict]) -> ChapterDripRule:
    if not raw:
        return ChapterDripRule()
    try:
        return ChapterDripRule.model_validate(raw)
    except ValidationError:
        return ChapterDripRule()


def _parse_timestamp(value: Optional[str]) -> Optional[datetime]:
    """Trail rows store ``str(datetime.now())``: naive, in the API server's
    local time zone (UTC on most deployments, not all). Read them back in
    that zone, or a server east of UTC would hold every chapter back for a
    few hours after enrolling."""
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed.astimezone(timezone.utc) if parsed.tzinfo is None else parsed


async def enrollment_date(user_id: int, course_id: int, db_session: AsyncSession) -> Optional[datetime]:
    """When the learner first started the course, or None if they haven't."""
    dates = (await db_session.execute(
        select(TrailRun.creation_date).where(
            TrailRun.user_id == user_id, TrailRun.course_id == course_id
        )
    )).scalars().all()
    parsed = [d for d in (_parse_timestamp(v) for v in dates) if d is not None]
    return min(parsed) if parsed else None


async def _completed_activity_ids(user_id: int, course_id: int, db_session: AsyncSession) -> set[int]:
    return set((await db_session.execute(
        select(TrailStep.activity_id).where(
            TrailStep.user_id == user_id,
            TrailStep.course_id == course_id,
            TrailStep.complete == True,  # noqa: E712
        )
    )).scalars().all())


def compute_drip_states(
    settings: CourseDripSettings,
    chapters: Sequence[tuple],
    activity_ids: dict[int, list[int]],
    anchor: Optional[datetime],
    completed: set[int],
    now: datetime,
) -> dict[int, DripState]:
    """Release state for each chapter, in course order.

    ``chapters`` is ``DripChapter``-shaped tuples ``(id, drip_rule[, uuid])``
    in course order; ``activity_ids`` maps a chapter to its published
    activity ids (used by the completion conditions). ``anchor`` is when this
    reader's schedule started: their enrollment, or the cohort start date.
    """
    states: dict[int, DripState] = {}
    # Chapters the learner has finished, by uuid, for "require chapters".
    # Only chapters before the current one are known, so later ones are
    # ignored as prerequisites.
    done_uuids: set[str] = set()
    previous_done = True
    for index, item in enumerate(chapters):
        chapter = DripChapter(*item)
        rule = chapter_drip_rule(chapter.rule)
        state = DripState()

        release: Optional[datetime] = None
        if rule.mode == DripReleaseMode.DATE:
            release = rule.release_at
        elif anchor is not None:
            days = rule.delay_days if rule.mode == DripReleaseMode.DELAY else 0
            release = anchor + timedelta(days=days)
        elif (
            settings.anchor == DripAnchor.ENROLLMENT
            and rule.mode == DripReleaseMode.DELAY
            and rule.delay_days > 0
        ):
            # No enrollment yet: day-0 chapters stay open as a preview, the
            # rest wait for the learner's clock to start.
            state = DripState(locked=True, reason=DripLockReason.ENROLLMENT)

        if release is not None and now < release:
            state = DripState(locked=True, unlock_at=release, reason=DripLockReason.SCHEDULE)

        if not state.locked and rule.require_previous and index > 0 and not previous_done:
            state = DripState(locked=True, reason=DripLockReason.PREVIOUS)

        if not state.locked:
            seen_before = {DripChapter(*c).uuid for c in chapters[:index]}
            missing = [u for u in rule.require_chapters if u in seen_before and u not in done_uuids]
            if missing:
                state = DripState(locked=True, reason=DripLockReason.PREREQUISITES)

        if not state.locked and rule.available_days and release is not None:
            closes = release + timedelta(days=rule.available_days)
            state = (
                DripState(locked=True, reason=DripLockReason.CLOSED, closes_at=closes)
                if now >= closes
                else DripState(closes_at=closes)
            )

        if not state.locked:
            state.opened_at = release
        states[chapter.id] = state
        # A closed chapter the learner finished still counts as done.
        open_once = not state.locked or state.reason == DripLockReason.CLOSED
        previous_done = open_once and set(activity_ids.get(chapter.id, [])) <= completed
        if previous_done and chapter.uuid:
            done_uuids.add(chapter.uuid)
    return states


def _needs_progress(chapters: Sequence[tuple]) -> bool:
    return any(
        (rule := chapter_drip_rule(DripChapter(*c).rule)).require_previous or rule.require_chapters
        for c in chapters
    )


async def _in_early_access(user_id: int, settings: CourseDripSettings, org_id: int, db_session: AsyncSession) -> bool:
    if not settings.early_access_usergroups:
        return False
    member = (await db_session.execute(
        select(UserGroupUser.id)
        .join(UserGroup, UserGroup.id == UserGroupUser.usergroup_id)  # type: ignore[arg-type]
        .where(
            UserGroup.usergroup_uuid.in_(settings.early_access_usergroups),  # type: ignore[attr-defined]
            UserGroup.org_id == org_id,
            UserGroupUser.user_id == user_id,
        )
        .limit(1)
    )).first()
    return member is not None


async def drip_states_for_user(
    course: Course,
    settings: CourseDripSettings,
    chapters: Sequence[tuple],
    activity_ids: dict[int, list[int]],
    user_id: Optional[int],
    db_session: AsyncSession,
    now: Optional[datetime] = None,
) -> dict[int, DripState]:
    """``compute_drip_states`` with one learner's anchor and progress loaded
    (``user_id`` None for an anonymous reader). Empty when they are in one of
    the course's early-access user groups."""
    if user_id is not None and await _in_early_access(user_id, settings, course.org_id, db_session):
        return {}

    if settings.anchor == DripAnchor.FIXED_DATE:
        anchor = settings.start_date
    elif user_id is not None:
        anchor = await enrollment_date(user_id, course.id, db_session)
    else:
        anchor = None

    completed: set[int] = set()
    if user_id is not None and _needs_progress(chapters):
        completed = await _completed_activity_ids(user_id, course.id, db_session)

    return compute_drip_states(
        settings, chapters, activity_ids, anchor, completed, now or datetime.now(timezone.utc)
    )


async def drip_states_for_reader(
    course: Course,
    chapters: Sequence[tuple],
    activity_ids: dict[int, list[int]],
    current_user,
    db_session: AsyncSession,
    now: Optional[datetime] = None,
) -> dict[int, DripState]:
    """Release states for whoever is reading. Empty when the course doesn't
    drip its content."""
    settings = course_drip_settings(course)
    if settings is None or not chapters:
        return {}
    user_id = None if isinstance(current_user, AnonymousUser) else resolve_acting_user_id(current_user)
    return await drip_states_for_user(course, settings, chapters, activity_ids, user_id, db_session, now)


async def apply_drip_to_chapters(
    chapters: list[ChapterRead],
    course: Course,
    current_user,
    db_session: AsyncSession,
    request: Optional[Request],
) -> None:
    """Hold back unreleased chapters in a course tree. The caller has already
    let admins through; course editors are let through here."""
    if course_drip_settings(course) is None or not chapters:
        return
    if request is not None:
        from src.services.courses.activities.access import can_edit_course

        if await can_edit_course(request, course.course_uuid, current_user, db_session):
            return

    states = await drip_states_for_reader(
        course,
        [DripChapter(chapter.id, chapter.drip_rule, chapter.chapter_uuid) for chapter in chapters],
        {chapter.id: [a.id for a in chapter.activities if a.published] for chapter in chapters},
        current_user,
        db_session,
    )
    for chapter in chapters:
        state = states.get(chapter.id)
        if state is None:
            continue
        chapter.drip_closes_at = state.closes_at_iso
        if not state.locked:
            continue
        chapter.is_locked = True
        chapter.drip_locked = True
        chapter.drip_unlock_at = state.unlock_at_iso
        chapter.drip_reason = state.reason.value if state.reason else None
        for activity in chapter.activities:
            activity.is_locked = True
            activity.drip_unlock_at = chapter.drip_unlock_at
            activity.drip_reason = chapter.drip_reason
            activity.content = {}
            activity.details = None


async def _ordered_chapters(course_id: int, db_session: AsyncSession) -> list[DripChapter]:
    rows = (await db_session.execute(
        select(Chapter.id, Chapter.drip_rule, Chapter.chapter_uuid)
        .join(CourseChapter, CourseChapter.chapter_id == Chapter.id)  # type: ignore[arg-type]
        .where(CourseChapter.course_id == course_id, Chapter.course_id == course_id)
        .order_by(CourseChapter.order)  # type: ignore[arg-type]
    )).all()
    seen: set[int] = set()
    ordered = []
    for chapter_id, rule, uuid in rows:
        if chapter_id not in seen:
            seen.add(chapter_id)
            ordered.append(DripChapter(chapter_id, rule, uuid))
    return ordered


async def _published_activity_ids(chapter_ids: Iterable[int], db_session: AsyncSession) -> dict[int, list[int]]:
    ids = list(chapter_ids)
    if not ids:
        return {}
    rows = (await db_session.execute(
        select(ChapterActivity.chapter_id, Activity.id)
        .join(Activity, Activity.id == ChapterActivity.activity_id)  # type: ignore[arg-type]
        .where(ChapterActivity.chapter_id.in_(ids), Activity.published == True)  # type: ignore[attr-defined]  # noqa: E712
    )).all()
    result: dict[int, list[int]] = {}
    for chapter_id, activity_id in rows:
        result.setdefault(chapter_id, []).append(activity_id)
    return result


async def chapter_drip_state(
    course: Course,
    chapter: Chapter,
    current_user,
    db_session: AsyncSession,
    now: Optional[datetime] = None,
) -> Optional[DripState]:
    """Release state of one chapter for this reader, None when the course
    doesn't drip. Editors and admins are the caller's to let through."""
    if course_drip_settings(course) is None:
        return None
    rule = chapter_drip_rule(chapter.drip_rule)
    if rule.require_previous or rule.require_chapters:
        chapters = await _ordered_chapters(course.id, db_session)
        activity_ids = await _published_activity_ids([c.id for c in chapters], db_session)
    else:
        chapters = [DripChapter(chapter.id, chapter.drip_rule, chapter.chapter_uuid)]
        activity_ids = {}
    states = await drip_states_for_reader(course, chapters, activity_ids, current_user, db_session, now)
    return states.get(chapter.id)


# ── Schedule editing ─────────────────────────────────────────────────────────


async def _load_course_for_edit(request: Request, course_uuid: str, current_user, db_session: AsyncSession) -> Course:
    course = (await db_session.execute(
        select(Course).where(Course.course_uuid == course_uuid)
    )).scalars().first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.UPDATE)
    return course


async def _schedule_read(course: Course, db_session: AsyncSession) -> DripScheduleRead:
    rows = (await db_session.execute(
        select(Chapter)
        .join(CourseChapter, CourseChapter.chapter_id == Chapter.id)  # type: ignore[arg-type]
        .where(CourseChapter.course_id == course.id, Chapter.course_id == course.id)
        .order_by(CourseChapter.order)  # type: ignore[arg-type]
    )).scalars().all()
    seen: set[int] = set()
    chapters = []
    for chapter in rows:
        if chapter.id in seen:
            continue
        seen.add(chapter.id)
        chapters.append(ChapterDripRead(
            chapter_uuid=chapter.chapter_uuid, name=chapter.name, rule=chapter_drip_rule(chapter.drip_rule),
        ))
    try:
        settings = CourseDripSettings.model_validate(course.drip_settings or {})
    except ValidationError:
        settings = CourseDripSettings()
    return DripScheduleRead(course_uuid=course.course_uuid, settings=settings, chapters=chapters)


async def get_drip_schedule(
    request: Request, course_uuid: str, current_user, db_session: AsyncSession
) -> DripScheduleRead:
    course = await _load_course_for_edit(request, course_uuid, current_user, db_session)
    return await _schedule_read(course, db_session)


async def update_drip_schedule(
    request: Request,
    course_uuid: str,
    schedule: DripScheduleUpdate,
    current_user,
    db_session: AsyncSession,
) -> DripScheduleRead:
    course = await _load_course_for_edit(request, course_uuid, current_user, db_session)

    # Turning drip on (or editing an active schedule) needs the plan; turning
    # it off never does, so a downgraded org can always release everything.
    if schedule.settings.enabled:
        await check_org_plan(course.org_id, FEATURE_PLAN_REQUIREMENTS["drip"], "Drip content", db_session)

    chapters_by_uuid: dict[str, Chapter] = {}
    if schedule.chapters:
        uuids = [c.chapter_uuid for c in schedule.chapters]
        chapters_by_uuid = {
            chapter.chapter_uuid: chapter
            for chapter in (await db_session.execute(
                select(Chapter).where(Chapter.chapter_uuid.in_(uuids), Chapter.course_id == course.id)  # type: ignore[attr-defined]
            )).scalars().all()
        }
        missing = [u for u in uuids if u not in chapters_by_uuid]
        if missing:
            raise HTTPException(status_code=400, detail="Chapter does not belong to this course")

    required = {u for item in schedule.chapters for u in item.rule.require_chapters}
    if required:
        course_chapters = set((await db_session.execute(
            select(Chapter.chapter_uuid).where(Chapter.course_id == course.id, Chapter.chapter_uuid.in_(required))  # type: ignore[attr-defined]
        )).scalars().all())
        if required - course_chapters or any(item.chapter_uuid in item.rule.require_chapters for item in schedule.chapters):
            raise HTTPException(status_code=400, detail="A required chapter must be another chapter of this course")

    groups = set(schedule.settings.early_access_usergroups)
    if groups:
        # Only the course's own org's groups: a foreign group would expose its
        # name and hand its members the schedule bypass.
        found = set((await db_session.execute(
            select(UserGroup.usergroup_uuid).where(UserGroup.org_id == course.org_id, UserGroup.usergroup_uuid.in_(groups))  # type: ignore[attr-defined]
        )).scalars().all())
        if groups - found:
            raise HTTPException(status_code=400, detail="User group not found")

    now = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    course.drip_settings = schedule.settings.model_dump(mode="json")
    course.update_date = now
    db_session.add(course)
    for item in schedule.chapters:
        chapter = chapters_by_uuid[item.chapter_uuid]
        chapter.drip_rule = item.rule.model_dump(mode="json")
        chapter.update_date = now
        db_session.add(chapter)
    await db_session.commit()
    await db_session.refresh(course)
    return await _schedule_read(course, db_session)
