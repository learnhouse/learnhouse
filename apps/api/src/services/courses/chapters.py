from datetime import datetime
from typing import List
from uuid import uuid4
from sqlalchemy import func
from sqlmodel import Session, select
from src.db.users import AnonymousUser, PublicUser
from src.db.courses.course_chapters import CourseChapter
from src.db.courses.activities import Activity, ActivityRead
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.chapters import (
    Chapter,
    ChapterCreate,
    ChapterRead,
    ChapterUpdate,
    ChapterUpdateOrder,
)
from src.db.courses.courses import Course
from fastapi import HTTPException, status, Request
from src.security.rbac import check_resource_access, AccessAction


####################################################
# CRUD
####################################################


async def create_chapter(
    request: Request,
    chapter_object: ChapterCreate,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
) -> ChapterRead:
    chapter = Chapter.model_validate(chapter_object)

    # Get COurse
    statement = select(Course).where(Course.id == chapter_object.course_id)

    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.CREATE)

    # complete chapter object
    chapter.course_id = chapter_object.course_id
    chapter.chapter_uuid = f"chapter_{uuid4()}"
    chapter.creation_date = str(datetime.now())
    chapter.update_date = str(datetime.now())
    chapter.org_id = course.org_id

    # Determine insertion order atomically to prevent duplicate order values
    # under concurrent chapter creation for the same course
    max_order = db_session.exec(
        select(func.max(CourseChapter.order)).where(
            CourseChapter.course_id == chapter.course_id
        )
    ).first()
    to_be_used_order = (max_order or 0) + 1

    # Flush to get the DB-assigned ID without committing yet
    db_session.add(chapter)
    db_session.flush()

    chapter_read = ChapterRead(**chapter.model_dump(), activities=[])

    # Create CourseChapter link atomically with the chapter insert
    course_chapter = CourseChapter(
        course_id=chapter.course_id,
        chapter_id=chapter.id,
        org_id=chapter.org_id,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
        order=to_be_used_order,
    )

    # Single atomic commit for both Chapter and CourseChapter
    db_session.add(course_chapter)
    db_session.commit()

    return chapter_read


async def get_chapter(
    request: Request,
    chapter_id: int,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
) -> ChapterRead:
    statement = select(Chapter).where(Chapter.id == chapter_id)
    chapter = db_session.exec(statement).first()

    if not chapter:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Chapter does not exist"
        )

    # get COurse
    statement = select(Course).where(Course.id == chapter.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Course does not exist"
        )

    # RBAC check
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.READ)

    # Get activities for this chapter
    statement = (
        select(Activity)
        .join(ChapterActivity, Activity.id == ChapterActivity.activity_id) # type: ignore
        .where(ChapterActivity.chapter_id == chapter_id)
        .distinct(Activity.id) # type: ignore
    )

    activities = db_session.exec(statement).all()

    chapter = ChapterRead(
        **chapter.model_dump(),
        activities=[ActivityRead(**activity.model_dump()) for activity in activities],
    )

    return chapter


async def update_chapter(
    request: Request,
    chapter_object: ChapterUpdate,
    chapter_id: int,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
) -> ChapterRead:
    statement = select(Chapter).where(Chapter.id == chapter_id)
    chapter = db_session.exec(statement).first()

    if not chapter:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Chapter does not exist"
        )

    # RBAC check — use course_uuid (not chapter_uuid) to be consistent with create/get
    statement = select(Course).where(Course.id == chapter.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Course does not exist"
        )

    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.UPDATE)

    # Update only the fields that were passed in
    for var, value in vars(chapter_object).items():
        if value is not None:
            setattr(chapter, var, value)

    chapter.update_date = str(datetime.now())

    db_session.commit()
    db_session.refresh(chapter)

    if chapter:
        chapter = await get_chapter(
            request, chapter.id, current_user, db_session  # type: ignore
        )

    return chapter


async def delete_chapter(
    request: Request,
    chapter_id: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    statement = select(Chapter).where(Chapter.id == chapter_id)
    chapter = db_session.exec(statement).first()

    if not chapter:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Chapter does not exist"
        )

    # RBAC check — permissions are held at the course level, not the chapter level
    statement = select(Course).where(Course.id == chapter.course_id)
    course = db_session.exec(statement).first()
    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Course not found"
        )
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.DELETE)


    # Remove all linked chapter activities
    statement = select(ChapterActivity).where(ChapterActivity.chapter_id == chapter.id)
    chapter_activities = db_session.exec(statement).all()

    for chapter_activity in chapter_activities:
        db_session.delete(chapter_activity)

    # Delete the chapter
    db_session.delete(chapter)
    db_session.commit()

    return {"detail": "chapter deleted"}


async def get_course_chapters(
    request: Request,
    course_id: int,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
    with_unpublished_activities: bool,
    page: int = 1,
    limit: int = 10,
    slim: bool = False,
    course: "Course | None" = None,
) -> List[ChapterRead]:

    # Skip the duplicate Course lookup when the caller (e.g. get_course_meta)
    # already has the course in hand.
    if course is None:
        statement = select(Course).where(Course.id == course_id)
        course = db_session.exec(statement).first()

    statement = (
        select(Chapter)
        .join(CourseChapter, Chapter.id == CourseChapter.chapter_id) # type: ignore
        .where(CourseChapter.course_id == course_id)
        .where(Chapter.course_id == course_id)
        .order_by(CourseChapter.order) # type: ignore
        .group_by(Chapter.id, CourseChapter.order) # type: ignore
    )
    chapters = db_session.exec(statement).all()

    chapters = [ChapterRead(**chapter.model_dump(), activities=[]) for chapter in chapters]

    # RBAC check — cheap when the caller already ran it on this request
    # (the checker is memoized on request.state).
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.READ)  # type: ignore

    chapter_ids = [chapter.id for chapter in chapters]
    if chapter_ids:
        if slim:
            # SQL-level slim: project only the navigation columns. Activity.content
            # (TipTap JSON) and Activity.details can be very large; excluding them
            # from the SELECT is the biggest single win for course-tree payload.
            activity_statement = (
                select(
                    ChapterActivity.chapter_id,
                    Activity.id,
                    Activity.org_id,
                    Activity.course_id,
                    Activity.name,
                    Activity.activity_type,
                    Activity.activity_sub_type,
                    Activity.activity_uuid,
                    Activity.published,
                    Activity.creation_date,
                    Activity.update_date,
                    Activity.current_version,
                    Activity.last_modified_by_id,
                    ChapterActivity.order,
                )
                .join(Activity, Activity.id == ChapterActivity.activity_id)  # type: ignore
                .where(ChapterActivity.chapter_id.in_(chapter_ids))  # type: ignore
                .order_by(ChapterActivity.chapter_id, ChapterActivity.order)  # type: ignore
            )
            if not with_unpublished_activities:
                activity_statement = activity_statement.where(Activity.published == True)

            rows = db_session.exec(activity_statement).all()

            chapter_activities_map: dict[int, list[ActivityRead]] = {}
            seen: set[tuple[int, int]] = set()
            for row in rows:
                (
                    chapter_id_val,
                    a_id,
                    a_org_id,
                    a_course_id,
                    a_name,
                    a_type,
                    a_sub_type,
                    a_uuid,
                    a_published,
                    a_creation,
                    a_update,
                    a_version,
                    a_last_modified_by,
                    _order,
                ) = row
                key = (chapter_id_val, a_id)
                if key in seen:
                    continue
                seen.add(key)
                chapter_activities_map.setdefault(chapter_id_val, []).append(
                    ActivityRead(
                        id=a_id,
                        org_id=a_org_id,
                        course_id=a_course_id,
                        name=a_name,
                        activity_type=a_type,
                        activity_sub_type=a_sub_type,
                        content={},
                        details=None,
                        published=a_published,
                        activity_uuid=a_uuid,
                        creation_date=a_creation,
                        update_date=a_update,
                        current_version=a_version,
                        last_modified_by_id=a_last_modified_by,
                    )
                )
        else:
            activity_statement = (
                select(ChapterActivity, Activity)
                .join(Activity, Activity.id == ChapterActivity.activity_id)  # type: ignore
                .where(ChapterActivity.chapter_id.in_(chapter_ids))  # type: ignore
                .order_by(ChapterActivity.chapter_id, ChapterActivity.order)  # type: ignore
            )
            if not with_unpublished_activities:
                activity_statement = activity_statement.where(Activity.published == True)

            activity_results = db_session.exec(activity_statement).all()

            chapter_activities_map = {}
            seen = set()
            for chapter_activity, activity in activity_results:
                key = (chapter_activity.chapter_id, activity.id)
                if key in seen:
                    continue
                seen.add(key)
                chapter_activities_map.setdefault(chapter_activity.chapter_id, []).append(
                    ActivityRead(**activity.model_dump())
                )

        for chapter in chapters:
            chapter.activities = chapter_activities_map.get(chapter.id, [])

    return chapters


# Important Note : this is legacy code that has been used because
# the frontend is still not adapted for the new data structure, this implementation is absolutely not the best one
# and should not be used for future features
async def DEPRECEATED_get_course_chapters(
    request: Request,
    course_uuid: str,
    current_user: PublicUser,
    db_session: Session,
):
    statement = select(Course).where(Course.course_uuid == course_uuid)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Course does not exist"
        )

    # RBAC check
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.READ)

    chapters_in_db = await get_course_chapters(request, course.id, db_session, current_user)  # type: ignore

    # activities

    # chapters
    chapters = {}

    for chapter in chapters_in_db:
        chapter_activityIds = []

        for activity in chapter.activities:
            chapter_activityIds.append(activity.activity_uuid)

        chapters[chapter.chapter_uuid] = {
            "uuid": chapter.chapter_uuid,
            "id": chapter.id,
            "name": chapter.name,
            "activityIds": chapter_activityIds,
        }

    # activities
    activities_list = {}
    statement = (
        select(Activity)
        .join(ChapterActivity, ChapterActivity.activity_id == Activity.id) # type: ignore
        .where(ChapterActivity.activity_id == Activity.id)
        .group_by(Activity.id) # type: ignore
    )
    activities_in_db = db_session.exec(statement).all()

    for activity in activities_in_db:
        activities_list[activity.activity_uuid] = {
            "uuid": activity.activity_uuid,
            "id": activity.id,
            "name": activity.name,
            "type": activity.activity_type,
            "content": activity.content,
        }

    # get chapter order
    statement = (
        select(Chapter)
        .join(CourseChapter, CourseChapter.chapter_id == Chapter.id) # type: ignore
        .where(CourseChapter.chapter_id == Chapter.id)
        .group_by(Chapter.id, CourseChapter.order) # type: ignore
        .order_by(CourseChapter.order) # type: ignore
    )
    chapters_in_db = db_session.exec(statement).all()

    chapterOrder = []

    for chapter in chapters_in_db:
        chapterOrder.append(chapter.chapter_uuid)

    final = {
        "chapters": chapters,
        "chapterOrder": chapterOrder,
        "activities": activities_list,
    }

    return final


async def reorder_chapters_and_activities(
    request: Request,
    course_uuid: str,
    chapters_order: ChapterUpdateOrder,
    current_user: PublicUser,
    db_session: Session,
):
    statement = select(Course).where(Course.course_uuid == course_uuid)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Course does not exist"
        )

    # RBAC check
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.UPDATE)

    ###########
    # Chapters
    ###########

    # Get all existing course chapters
    statement = select(CourseChapter).where(
        CourseChapter.course_id == course.id,
        CourseChapter.org_id == course.org_id
    )
    existing_course_chapters = db_session.exec(statement).all()

    # Create a map of existing chapters for faster lookup
    existing_chapter_map = {cc.chapter_id: cc for cc in existing_course_chapters}

    # Update or create course chapters based on new order
    for index, chapter_order in enumerate(chapters_order.chapter_order_by_ids):
        if chapter_order.chapter_id in existing_chapter_map:
            # Update existing chapter order
            course_chapter = existing_chapter_map[chapter_order.chapter_id]
            course_chapter.order = index
            db_session.add(course_chapter)
        else:
            # Create new course chapter
            course_chapter = CourseChapter(
                chapter_id=chapter_order.chapter_id,
                course_id=course.id, # type: ignore
                org_id=course.org_id,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
                order=index,
            )
            db_session.add(course_chapter)

    # Remove chapters that are no longer in the order
    chapter_ids_to_keep = {co.chapter_id for co in chapters_order.chapter_order_by_ids}
    for cc in existing_course_chapters:
        if cc.chapter_id not in chapter_ids_to_keep:
            db_session.delete(cc)
    db_session.commit()

    ###########
    # Activities
    ###########

    # Get all existing chapter activities
    statement = select(ChapterActivity).where(
        ChapterActivity.course_id == course.id,
        ChapterActivity.org_id == course.org_id
    )
    existing_chapter_activities = db_session.exec(statement).all()

    # Create a map for faster lookup
    existing_activity_map = {
        (ca.chapter_id, ca.activity_id): ca 
        for ca in existing_chapter_activities
    }

    # Track which activities we want to keep
    activities_to_keep = set()

    # Update or create chapter activities based on new order
    for chapter_order in chapters_order.chapter_order_by_ids:
        for index, activity_order in enumerate(chapter_order.activities_order_by_ids):
            activity_key = (chapter_order.chapter_id, activity_order.activity_id)
            activities_to_keep.add(activity_key)

            if activity_key in existing_activity_map:
                # Update existing activity order
                chapter_activity = existing_activity_map[activity_key]
                chapter_activity.order = index
                db_session.add(chapter_activity)
            else:
                # Create new chapter activity
                chapter_activity = ChapterActivity(
                    chapter_id=chapter_order.chapter_id,
                    activity_id=activity_order.activity_id,
                    org_id=course.org_id,
                    course_id=course.id, # type: ignore
                    creation_date=str(datetime.now()),
                    update_date=str(datetime.now()),
                    order=index,
                )
                db_session.add(chapter_activity)

    # Remove activities that are no longer in any chapter
    for ca in existing_chapter_activities:
        if (ca.chapter_id, ca.activity_id) not in activities_to_keep:
            db_session.delete(ca)
    db_session.commit()

    return {"detail": "Chapters and activities reordered successfully"}
