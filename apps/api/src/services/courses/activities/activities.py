from sqlalchemy import func
from sqlmodel import Session, select
from src.db.courses.courses import Course
from src.db.courses.chapters import Chapter
from src.db.courses.activities import ActivityCreate, Activity, ActivityRead, ActivityUpdate
from src.db.courses.chapter_activities import ChapterActivity
from src.db.users import AnonymousUser, PublicUser, User
from src.security.auth import resolve_acting_user_id
from fastapi import HTTPException, Request
from uuid import uuid4
from datetime import datetime

import asyncio
import logging

from src.core.ee_hooks import check_ee_activity_paid_access
from src.security.rbac import check_resource_access, AccessAction
from src.services.courses.activities.versioning import create_activity_version
from src.services.courses.locks import (
    batch_accessible_restricted_uuids,
    is_locked_for_user,
    is_org_admin,
)

logger = logging.getLogger(__name__)

# Module-level set to hold strong references to background embedding tasks,
# preventing them from being garbage-collected before they complete.
_embedding_tasks: set = set()


####################################################
# CRUD
####################################################


async def create_activity(
    request: Request,
    activity_object: ActivityCreate,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):

    # CHeck if org exists
    statement = select(Chapter).where(Chapter.id == activity_object.chapter_id)
    chapter = db_session.exec(statement).first()

    if not chapter:
        raise HTTPException(
            status_code=404,
            detail="Chapter not found",
        )

    # RBAC check
    statement = select(Course).where(Course.id == chapter.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.CREATE)

    # Create Activity
    activity = Activity(**activity_object.model_dump())

    activity.activity_uuid = str(f"activity_{uuid4()}")
    activity.creation_date = str(datetime.now())
    activity.update_date = str(datetime.now())
    activity.org_id = chapter.org_id
    activity.course_id = chapter.course_id

    # Flush to get the DB-assigned ID without committing yet
    db_session.add(activity)
    db_session.flush()

    if activity.id is None:
        raise HTTPException(
            status_code=500,
            detail="Activity creation failed: could not retrieve activity ID",
        )

    # Determine insertion order using MAX to avoid loading all rows
    max_order = db_session.exec(
        select(func.max(ChapterActivity.order)).where(
            ChapterActivity.chapter_id == activity_object.chapter_id
        )
    ).first()
    to_be_used_order = (max_order or 0) + 1

    # Add activity to chapter
    activity_chapter = ChapterActivity(
        chapter_id=activity_object.chapter_id,
        activity_id=activity.id,
        course_id=chapter.course_id,
        org_id=chapter.org_id,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
        order=to_be_used_order,
    )

    # Single atomic commit for both Activity and ChapterActivity
    db_session.add(activity_chapter)
    db_session.commit()
    db_session.refresh(activity)

    return ActivityRead.model_validate(activity)


async def get_activity(
    request: Request,
    activity_uuid: str,
    current_user: PublicUser,
    db_session: Session,
):
    # Optimize by joining Activity with Course and last modified user in a single query
    statement = (
        select(Activity, Course, User)
        .join(Course)
        .outerjoin(User, Activity.last_modified_by_id == User.id)
        .where(Activity.activity_uuid == activity_uuid)
    )
    result = db_session.exec(statement).first()

    if not result:
        raise HTTPException(
            status_code=404,
            detail="Activity not found",
        )

    activity, course, last_modified_user = result

    # RBAC check
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.READ)

    # Paid access check (via EE hook with fallback to True if EE not available)
    has_paid_access = await check_ee_activity_paid_access(
        request=request,
        activity_id=activity.id,
        user=current_user,
        db_session=db_session
    )

    activity_read = ActivityRead.model_validate(activity)
    activity_read.content = activity_read.content if has_paid_access else { "paid_access": False }
    # Include last modified user info
    activity_read.last_modified_by_username = last_modified_user.username if last_modified_user else None

    _apply_activity_lock(activity_read, activity, course, current_user, db_session)

    return activity_read


def _apply_activity_lock(
    activity_read: ActivityRead,
    activity: Activity,
    course: Course,
    current_user,
    db_session: Session,
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
    admin = False if is_anon else is_org_admin(acting_user_id, course.org_id, db_session)
    if admin:
        return

    parent_chapter_row = db_session.exec(
        select(Chapter)
        .join(ChapterActivity, ChapterActivity.chapter_id == Chapter.id)  # type: ignore
        .where(ChapterActivity.activity_id == activity.id)
    ).first()

    check_uuids: list[str] = [course.course_uuid]
    if (activity.lock_type or "public") == "restricted":
        check_uuids.append(activity.activity_uuid)
    if parent_chapter_row and (parent_chapter_row.lock_type or "public") == "restricted":
        check_uuids.append(parent_chapter_row.chapter_uuid)

    accessible: set[str] = set()
    if not is_anon:
        accessible = batch_accessible_restricted_uuids(
            acting_user_id, check_uuids, db_session
        )

    # Course-level usergroup membership unlocks everything below it.
    if course.course_uuid in accessible:
        return

    chapter_locked = False
    if parent_chapter_row:
        chapter_locked = is_locked_for_user(
            parent_chapter_row.lock_type,
            parent_chapter_row.chapter_uuid,
            course.org_id,
            current_user,
            db_session,
            accessible_restricted_uuids=accessible,
            is_admin=admin,
        )

    activity_locked = chapter_locked or is_locked_for_user(
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

async def get_activityby_id(
    request: Request,
    activity_id: str,
    current_user: PublicUser,
    db_session: Session,
):
    # Optimize by joining Activity with Course in a single query
    statement = (
        select(Activity, Course)
        .join(Course)
        .where(Activity.id == activity_id)
    )
    result = db_session.exec(statement).first()

    if not result:
        raise HTTPException(
            status_code=404,
            detail="Activity not found",
        )
    
    activity, course = result

    # RBAC check
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.READ)

    return ActivityRead.model_validate(activity)


async def update_activity(
    request: Request,
    activity_object: ActivityUpdate,
    activity_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    statement = select(Activity).where(Activity.activity_uuid == activity_uuid)
    activity = db_session.exec(statement).first()

    if not activity:
        raise HTTPException(
            status_code=404,
            detail="Activity not found",
        )

    # RBAC check
    statement = select(Course).where(Course.id == activity.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.UPDATE)

    # Update only the fields that were explicitly set (not default values)
    # Using model_dump(exclude_unset=True) to get only the fields that were passed in
    update_data = activity_object.model_dump(exclude_unset=True)

    # Create a version snapshot before updating content
    # This preserves the current state for version history
    if 'content' in update_data and activity.content:
        user_id = current_user.id if hasattr(current_user, 'id') else None
        await create_activity_version(activity, user_id, db_session)
        # Increment version number
        activity.current_version = (activity.current_version or 1) + 1
        # Track who made the change
        activity.last_modified_by_id = user_id

    if 'content' in update_data and isinstance(update_data['content'], str):
        logger.warning("[Activity Update] Content is STRING not dict for %s", activity_uuid)

    for field, value in update_data.items():
        setattr(activity, field, value)

    # Update the update_date timestamp
    activity.update_date = str(datetime.now())

    # Mark content as modified if it was updated (important for JSON fields)
    if 'content' in update_data:
        from sqlalchemy.orm.attributes import flag_modified
        flag_modified(activity, "content")

    db_session.add(activity)
    db_session.commit()
    db_session.refresh(activity)

    # Trigger background re-indexing for RAG when content changes
    if 'content' in update_data:
        task = asyncio.create_task(_trigger_course_embedding(activity.course_id, activity.org_id))
        _embedding_tasks.add(task)
        task.add_done_callback(_embedding_tasks.discard)
        task.add_done_callback(
            lambda t: logger.error("Embedding task failed: %s", t.exception()) if t.exception() else None
        )

    activity = ActivityRead.model_validate(activity)

    return activity


async def _trigger_course_embedding(course_id: int, org_id: int) -> None:
    """Background task to re-index course embeddings after content update."""
    try:
        from src.core.events.database import get_db_session
        from src.services.ai.rag.embedding_service import embed_course_content

        for session in get_db_session():
            course = session.exec(select(Course).where(Course.id == course_id)).first()
            if not course:
                logger.warning("Skipping embedding for deleted course %d", course_id)
                return
            await embed_course_content(course_id, org_id, session)
    except Exception as e:
        logger.warning("Background embedding update failed (non-critical): %s", e)


async def delete_activity(
    request: Request,
    activity_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    statement = select(Activity).where(Activity.activity_uuid == activity_uuid)
    activity = db_session.exec(statement).first()

    if not activity:
        raise HTTPException(
            status_code=404,
            detail="Activity not found",
        )

    # RBAC check
    statement = select(Course).where(Course.id == activity.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.DELETE)

    # Clean up content files from storage
    from src.db.organizations import Organization
    org_statement = select(Organization).where(Organization.id == course.org_id)
    org = db_session.exec(org_statement).first()
    if org:
        from src.services.courses.transfer.storage_utils import delete_storage_directory
        content_path = f"content/orgs/{org.org_uuid}/courses/{course.course_uuid}/activities/{activity_uuid}"
        delete_storage_directory(content_path)

    # Delete activity from chapter
    statement = select(ChapterActivity).where(
        ChapterActivity.activity_id == activity.id
    )
    activity_chapter = db_session.exec(statement).first()

    if not activity_chapter:
        raise HTTPException(
            status_code=404,
            detail="Activity not found in chapter",
        )

    db_session.delete(activity_chapter)
    db_session.delete(activity)
    db_session.commit()

    return {"detail": "Activity deleted"}


####################################################
# Misc
####################################################


async def get_activities(
    request: Request,
    coursechapter_id: int,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
) -> list[ActivityRead]:
    # Single query joining Activity, Chapter, and Course to avoid 3 sequential queries
    statement = (
        select(Activity, Chapter, Course)
        .join(ChapterActivity, Activity.id == ChapterActivity.activity_id)
        .join(Chapter, ChapterActivity.chapter_id == Chapter.id)
        .join(Course, Chapter.course_id == Course.id)
        .where(
            ChapterActivity.chapter_id == coursechapter_id,
            Activity.published == True,
        )
    )
    results = db_session.exec(statement).all()

    if not results:
        raise HTTPException(
            status_code=404,
            detail="No published activities found",
        )

    _, chapter, course = results[0]
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.READ)

    return [ActivityRead.model_validate(activity) for activity, _, _ in results]
