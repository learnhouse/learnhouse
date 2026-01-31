from sqlmodel import Session, select
from src.db.courses.courses import Course
from src.db.courses.chapters import Chapter
from src.db.courses.activities import ActivityCreate, Activity, ActivityRead, ActivityUpdate
from src.db.courses.chapter_activities import ChapterActivity
from src.db.users import AnonymousUser, PublicUser, User
from fastapi import HTTPException, Request
from uuid import uuid4
from datetime import datetime

from src.core.ee_hooks import check_ee_activity_paid_access
from src.security.courses_security import courses_rbac_check_for_activities
from src.services.courses.activities.versioning import create_activity_version


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

    await courses_rbac_check_for_activities(request, course.course_uuid, current_user, "create", db_session)

    # Create Activity
    activity = Activity(**activity_object.model_dump())

    activity.activity_uuid = str(f"activity_{uuid4()}")
    activity.creation_date = str(datetime.now())
    activity.update_date = str(datetime.now())
    activity.org_id = chapter.org_id
    activity.course_id = chapter.course_id

    # Insert Activity in DB
    db_session.add(activity)
    db_session.commit()
    db_session.refresh(activity)

    # Find the last activity in the Chapter and add it to the list
    statement = (
        select(ChapterActivity)
        .where(ChapterActivity.chapter_id == activity_object.chapter_id)
        .order_by(ChapterActivity.order) # type: ignore
    )
    chapter_activities = db_session.exec(statement).all()

    last_order = chapter_activities[-1].order if chapter_activities else 0
    to_be_used_order = last_order + 1

    # Add activity to chapter
    activity_chapter = ChapterActivity(
        chapter_id=activity_object.chapter_id,
        activity_id=activity.id if activity.id else 0,
        course_id=chapter.course_id,
        org_id=chapter.org_id,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
        order=to_be_used_order,
    )

    # Insert ChapterActivity link in DB
    db_session.add(activity_chapter)
    db_session.commit()
    db_session.refresh(activity_chapter)

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
    await courses_rbac_check_for_activities(request, course.course_uuid, current_user, "read", db_session)

    # Paid access check (via EE hook with fallback to True if EE not available)
    has_paid_access = await check_ee_activity_paid_access(
        request=request,
        activity_id=activity.id if activity.id else 0,
        user=current_user,
        db_session=db_session
    )

    activity_read = ActivityRead.model_validate(activity)
    activity_read.content = activity_read.content if has_paid_access else { "paid_access": False }
    # Include last modified user info
    activity_read.last_modified_by_username = last_modified_user.username if last_modified_user else None

    return activity_read

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
    await courses_rbac_check_for_activities(request, course.course_uuid, current_user, "read", db_session)

    return ActivityRead.model_validate(activity)


async def update_activity(
    request: Request,
    activity_object: ActivityUpdate,
    activity_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    import logging
    import json
    logger = logging.getLogger(__name__)

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

    await courses_rbac_check_for_activities(request, course.course_uuid, current_user, "update", db_session)

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

    # Debug logging for content updates
    if 'content' in update_data:
        content = update_data['content']
        logger.info(f"[Activity Update] Activity UUID: {activity_uuid}")
        logger.info(f"[Activity Update] Content type: {type(content)}")
        if isinstance(content, dict):
            logger.info(f"[Activity Update] Content has 'type' key: {'type' in content}")
            logger.info(f"[Activity Update] Content 'type' value: {content.get('type')}")
            try:
                # Test serialization with ensure_ascii=False to preserve Unicode
                content_json = json.dumps(content, ensure_ascii=False)
                logger.info(f"[Activity Update] Content JSON size: {len(content_json)} bytes")
                logger.info(f"[Activity Update] Content JSON valid: {content_json.startswith('{') and content_json.endswith('}')}")
                # Try to parse it back to verify round-trip
                json.loads(content_json)
                logger.info("[Activity Update] Content JSON round-trip: SUCCESS")
            except Exception as e:
                logger.error(f"[Activity Update] Content JSON serialization error: {e}")
        elif isinstance(content, str):
            logger.warning(f"[Activity Update] Content is STRING not dict! Length: {len(content)}")
            logger.warning(f"[Activity Update] Content preview: {content[:200]}")

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

    # Verify the save worked
    if 'content' in update_data:
        logger.info(f"[Activity Update] Post-save content type: {type(activity.content)}")
        if isinstance(activity.content, dict):
            logger.info(f"[Activity Update] Post-save content 'type': {activity.content.get('type')}")

    activity = ActivityRead.model_validate(activity)

    return activity


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

    await courses_rbac_check_for_activities(request, course.course_uuid, current_user, "delete", db_session)

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
    # Get activities that are published and belong to the chapter
    statement = (
        select(Activity)
        .join(ChapterActivity)
        .where(
            ChapterActivity.chapter_id == coursechapter_id,
            Activity.published == True
        )
    )
    activities = db_session.exec(statement).all()

    if not activities:
        raise HTTPException(
            status_code=404,
            detail="No published activities found",
        )

    # RBAC check
    statement = select(Chapter).where(Chapter.id == coursechapter_id)
    chapter = db_session.exec(statement).first()
    
    if not chapter:
        raise HTTPException(
            status_code=404,
            detail="Chapter not found",
        )

    statement = select(Course).where(Course.id == chapter.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    await courses_rbac_check_for_activities(request, course.course_uuid, current_user, "read", db_session)

    activities = [ActivityRead.model_validate(activity) for activity in activities]

    return activities
