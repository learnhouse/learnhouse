"""One gate for "may this caller consume this activity".

Reading a course is not the same as being allowed every activity in it: an
activity can be unpublished, behind a paid offer, or locked to a user group.
Every path that hands out activity content or its files (the activity read,
the chapter tree, media streams, ``/content`` files, trail progress,
assignments) must go through here, or the files become a way around the
checks the activity read itself applies.
"""

from typing import Literal

from fastapi import HTTPException, Request
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.ee_hooks import check_ee_activity_paid_access
from src.db.courses.activities import Activity, ActivityRead
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.chapters import Chapter
from src.db.courses.courses import Course
from src.db.users import AnonymousUser
from src.security.auth import resolve_acting_user_id
from src.security.rbac.resource_access import (
    AccessAction,
    AccessContext,
    check_resource_access,
)
from src.services.courses.locks import (
    batch_accessible_restricted_uuids,
    is_locked_for_user,
    is_org_admin,
)

ReaderState = Literal["ok", "draft", "unpaid", "locked"]


async def can_edit_course(request: Request, course_uuid: str, current_user, db_session: AsyncSession) -> bool:
    decision = await check_resource_access(
        request, db_session, current_user, course_uuid, AccessAction.UPDATE,
        raise_on_deny=False,
    )
    return decision.allowed


async def apply_activity_lock(
    activity_read: ActivityRead,
    activity: Activity,
    course: Course,
    current_user,
    db_session: AsyncSession,
    *,
    parent_chapter: Chapter | None = None,
) -> None:
    """Enforce chapter/activity lock_type on a single-activity read.

    Admins/maintainers bypass. A usergroup attached at the course level also
    unlocks every restricted chapter/activity inside that course (same
    inheritance rule as the TOC read). For everyone else, if either the
    activity or its parent chapter is locked, we scrub content/details and set
    ``is_locked=True`` so the client renders a gate instead of an empty page.
    """
    is_anon = isinstance(current_user, AnonymousUser)
    acting_user_id = resolve_acting_user_id(current_user)
    admin = False if is_anon else await is_org_admin(acting_user_id, course.org_id, db_session)
    if admin:
        return

    # Caller may have already fetched the parent chapter (e.g. via the editor
    # bootstrap join); only run the extra query when it wasn't supplied.
    if parent_chapter is not None:
        parent_chapter_row = parent_chapter
    else:
        parent_chapter_row = (await db_session.execute(
            select(Chapter)
            .join(ChapterActivity, ChapterActivity.chapter_id == Chapter.id)  # type: ignore
            .where(ChapterActivity.activity_id == activity.id)
        )).scalars().first()

    check_uuids: list[str] = [course.course_uuid]
    if (activity.lock_type or "public") == "restricted":
        check_uuids.append(activity.activity_uuid)
    if parent_chapter_row and (parent_chapter_row.lock_type or "public") == "restricted":
        check_uuids.append(parent_chapter_row.chapter_uuid)

    accessible: set[str] = set()
    if not is_anon:
        accessible = await batch_accessible_restricted_uuids(
            acting_user_id, check_uuids, db_session
        )

    # Course-level usergroup membership unlocks everything below it.
    if course.course_uuid in accessible:
        return

    chapter_locked = False
    if parent_chapter_row:
        chapter_locked = await is_locked_for_user(
            parent_chapter_row.lock_type,
            parent_chapter_row.chapter_uuid,
            course.org_id,
            current_user,
            db_session,
            accessible_restricted_uuids=accessible,
            is_admin=admin,
        )

    activity_locked = chapter_locked or await is_locked_for_user(
        activity.lock_type,
        activity.activity_uuid,
        course.org_id,
        current_user,
        db_session,
        accessible_restricted_uuids=accessible,
        is_admin=admin,
    )

    if activity_locked:
        activity_read.content = {}
        activity_read.details = None
        activity_read.is_locked = True


async def _reader_state(
    request: Request,
    activity_read: ActivityRead,
    activity: Activity,
    course: Course,
    current_user,
    db_session: AsyncSession,
    *,
    parent_chapter: Chapter | None = None,
) -> ReaderState:
    """Classify ``current_user``'s access to ``activity``; applies the lock
    scrub to ``activity_read`` as a side effect so both callers share it."""
    if not activity.published:
        return "ok" if await can_edit_course(request, course.course_uuid, current_user, db_session) else "draft"
    paid = await check_ee_activity_paid_access(request, activity.id, current_user, db_session)
    await apply_activity_lock(
        activity_read, activity, course, current_user, db_session, parent_chapter=parent_chapter
    )
    if not paid:
        return "unpaid"
    return "locked" if activity_read.is_locked else "ok"


async def verify_activity_reader_access(
    request: Request,
    activity: Activity,
    course: Course,
    current_user,
    db_session: AsyncSession,
) -> None:
    """Raise unless ``current_user`` may consume ``activity``.

    401/403 when the course itself can't be read, 404 for an unpublished
    activity the caller can't edit, 402 when the course is paid and unpaid
    for, 403 when a chapter/activity lock applies. Editors pass everything.
    """
    decision = await check_resource_access(
        request, db_session, current_user, course.course_uuid,
        AccessAction.READ, AccessContext.PUBLIC_VIEW, raise_on_deny=False,
    )
    if not decision.allowed:
        if isinstance(current_user, AnonymousUser):
            raise HTTPException(status_code=401, detail="Authentication required")
        raise HTTPException(status_code=403, detail=decision.reason)

    state = await _reader_state(
        request, ActivityRead.model_validate(activity), activity, course, current_user, db_session
    )
    if state == "draft":
        raise HTTPException(status_code=404, detail="Activity not found")
    if state == "unpaid":
        raise HTTPException(status_code=402, detail="This activity requires a purchase")
    if state == "locked":
        raise HTTPException(status_code=403, detail="This activity is locked")


async def verify_activity_reader_access_by_uuid(
    request: Request,
    activity_uuid: str,
    current_user,
    db_session: AsyncSession,
    *,
    course_uuid: str | None = None,
) -> tuple[Activity, Course]:
    """Load the activity and its course, then run the reader gate.

    When ``course_uuid`` is given the activity must belong to that course, so a
    path like ``courses/{c}/activities/{a}`` can't mix one course's grant with
    another course's activity.
    """
    row = (await db_session.execute(
        select(Activity, Course)
        .join(Course, Course.id == Activity.course_id)  # type: ignore[arg-type]
        .where(Activity.activity_uuid == activity_uuid)
    )).first()
    if not row:
        raise HTTPException(status_code=404, detail="Activity not found")
    activity, course = row
    if course_uuid is not None and course.course_uuid != course_uuid:
        raise HTTPException(status_code=404, detail="Activity not found")
    await verify_activity_reader_access(request, activity, course, current_user, db_session)
    return activity, course


async def redact_activity_for_reader(
    request: Request,
    activity_read: ActivityRead,
    activity: Activity,
    course: Course,
    current_user,
    db_session: AsyncSession,
    *,
    parent_chapter: Chapter | None = None,
) -> ActivityRead:
    """Same policy as ``verify_activity_reader_access`` for a read that still
    answers: drafts 404, unpaid content is replaced by a paywall marker, locked
    content is scrubbed with ``is_locked`` set. The caller has already checked
    course READ."""
    state = await _reader_state(
        request, activity_read, activity, course, current_user, db_session, parent_chapter=parent_chapter
    )
    if state == "draft":
        raise HTTPException(status_code=404, detail="Activity not found")
    if state == "unpaid":
        activity_read.content = {"paid_access": False}
        activity_read.details = None
    return activity_read
