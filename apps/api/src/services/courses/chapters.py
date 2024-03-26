from datetime import datetime
from typing import List, Literal
from uuid import uuid4
from sqlmodel import Session, select
from src.db.users import AnonymousUser
from src.security.rbac.rbac import (
    authorization_verify_based_on_roles_and_authorship_and_usergroups,
    authorization_verify_if_element_is_public,
    authorization_verify_if_user_is_anon,
)
from src.db.course_chapters import CourseChapter
from src.db.activities import Activity, ActivityRead
from src.db.chapter_activities import ChapterActivity
from src.db.chapters import (
    Chapter,
    ChapterCreate,
    ChapterRead,
    ChapterUpdate,
    ChapterUpdateOrder,
)
from src.services.courses.courses import Course
from src.services.users.users import PublicUser
from fastapi import HTTPException, status, Request


####################################################
# CRUD
####################################################


async def create_chapter(
    request: Request,
    chapter_object: ChapterCreate,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
) -> ChapterRead:
    chapter = Chapter.from_orm(chapter_object)

    # Get COurse
    statement = select(Course).where(Course.id == chapter_object.course_id)

    course = db_session.exec(statement).one()

    # RBAC check
    await rbac_check(request, "chapter_x", current_user, "create", db_session)

    # complete chapter object
    chapter.course_id = chapter_object.course_id
    chapter.chapter_uuid = f"chapter_{uuid4()}"
    chapter.creation_date = str(datetime.now())
    chapter.update_date = str(datetime.now())
    chapter.org_id = course.org_id

    # Find the last chapter in the course and add it to the list
    statement = (
        select(CourseChapter)
        .where(CourseChapter.course_id == chapter.course_id)
        .order_by(CourseChapter.order)
    )
    course_chapters = db_session.exec(statement).all()

    # get last chapter order
    last_order = course_chapters[-1].order if course_chapters else 0
    to_be_used_order = last_order + 1

    # Add chapter to database
    db_session.add(chapter)
    db_session.commit()
    db_session.refresh(chapter)

    chapter = ChapterRead(**chapter.dict(), activities=[])

    # Check if COurseChapter link exists

    statement = (
        select(CourseChapter)
        .where(CourseChapter.chapter_id == chapter.id)
        .where(CourseChapter.course_id == chapter.course_id)
        .where(CourseChapter.order == to_be_used_order)
    )
    course_chapter = db_session.exec(statement).first()

    if not course_chapter:
        # Add CourseChapter link
        course_chapter = CourseChapter(
            course_id=chapter.course_id,
            chapter_id=chapter.id,
            org_id=chapter.org_id,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
            order=to_be_used_order,
        )

        # Insert CourseChapter link in DB
        db_session.add(course_chapter)
        db_session.commit()

    return chapter


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
            status_code=status.HTTP_409_CONFLICT, detail="Chapter does not exist"
        )

    # get COurse
    statement = select(Course).where(Course.id == chapter.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Course does not exist"
        )

    # RBAC check
    await rbac_check(request, course.course_uuid, current_user, "read", db_session)

    # Get activities for this chapter
    statement = (
        select(Activity)
        .join(ChapterActivity, Activity.id == ChapterActivity.activity_id)
        .where(ChapterActivity.chapter_id == chapter_id)
        .distinct(Activity.id)
    )

    activities = db_session.exec(statement).all()

    chapter = ChapterRead(
        **chapter.dict(),
        activities=[ActivityRead(**activity.dict()) for activity in activities],
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
            status_code=status.HTTP_409_CONFLICT, detail="Chapter does not exist"
        )

    # RBAC check
    await rbac_check(request, chapter.chapter_uuid, current_user, "update", db_session)

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
            status_code=status.HTTP_409_CONFLICT, detail="Chapter does not exist"
        )

    # RBAC check
    await rbac_check(request, chapter.chapter_uuid, current_user, "delete", db_session)

    db_session.delete(chapter)
    db_session.commit()

    # Remove all linked activities
    statement = select(ChapterActivity).where(ChapterActivity.id == chapter.id)
    chapter_activities = db_session.exec(statement).all()

    for chapter_activity in chapter_activities:
        db_session.delete(chapter_activity)
        db_session.commit()

    return {"detail": "chapter deleted"}


async def get_course_chapters(
    request: Request,
    course_id: int,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
    page: int = 1,
    limit: int = 10,
) -> List[ChapterRead]:

    statement = select(Course).where(Course.id == course_id)
    course = db_session.exec(statement).first()

    statement = (
        select(Chapter)
        .join(CourseChapter, Chapter.id == CourseChapter.chapter_id)
        .where(CourseChapter.course_id == course_id)
        .where(Chapter.course_id == course_id)
        .order_by(CourseChapter.order)
        .group_by(Chapter.id, CourseChapter.order)
    )
    chapters = db_session.exec(statement).all()

    chapters = [ChapterRead(**chapter.dict(), activities=[]) for chapter in chapters]

    # RBAC check
    await rbac_check(request, course.course_uuid, current_user, "read", db_session)  # type: ignore

    # Get activities for each chapter
    for chapter in chapters:
        statement = (
            select(ChapterActivity)
            .where(ChapterActivity.chapter_id == chapter.id)
            .order_by(ChapterActivity.order)
            .distinct(ChapterActivity.id, ChapterActivity.order)
        )
        chapter_activities = db_session.exec(statement).all()

        for chapter_activity in chapter_activities:
            statement = (
                select(Activity)
                .where(Activity.id == chapter_activity.activity_id)
                .distinct(Activity.id)
            )
            activity = db_session.exec(statement).first()

            if activity:
                chapter.activities.append(ActivityRead(**activity.dict()))

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
            status_code=status.HTTP_409_CONFLICT, detail="Course does not exist"
        )

    # RBAC check
    await rbac_check(request, course.course_uuid, current_user, "read", db_session)

    chapters_in_db = await get_course_chapters(request, course.id, db_session, current_user)  # type: ignore

    # activities

    # chapters
    chapters = {}

    for chapter in chapters_in_db:
        chapter_activityIds = []

        for activity in chapter.activities:
            print("test", activity)
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
        .join(ChapterActivity, ChapterActivity.activity_id == Activity.id)
        .where(ChapterActivity.activity_id == Activity.id)
        .group_by(Activity.id)
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
        .join(CourseChapter, CourseChapter.chapter_id == Chapter.id)
        .where(CourseChapter.chapter_id == Chapter.id)
        .group_by(Chapter.id, CourseChapter.order)
        .order_by(CourseChapter.order)
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
            status_code=status.HTTP_409_CONFLICT, detail="Course does not exist"
        )

    # RBAC check
    await rbac_check(request, course.course_uuid, current_user, "update", db_session)

    ###########
    # Chapters
    ###########

    # Delete CourseChapters that are not linked to chapter_id and activity_id and org_id and course_id
    statement = (
        select(CourseChapter)
        .where(
            CourseChapter.course_id == course.id, CourseChapter.org_id == course.org_id
        )
        .order_by(CourseChapter.order)
    )
    course_chapters = db_session.exec(statement).all()

    chapter_ids_to_keep = [
        chapter_order.chapter_id
        for chapter_order in chapters_order.chapter_order_by_ids
    ]
    for course_chapter in course_chapters:
        if course_chapter.chapter_id not in chapter_ids_to_keep:
            db_session.delete(course_chapter)
            db_session.commit()

    # Delete Chapters that are not in the list of chapters_order
    statement = select(Chapter).where(Chapter.course_id == course.id)
    chapters = db_session.exec(statement).all()

    chapter_ids_to_keep = [
        chapter_order.chapter_id
        for chapter_order in chapters_order.chapter_order_by_ids
    ]

    for chapter in chapters:
        if chapter.id not in chapter_ids_to_keep:
            db_session.delete(chapter)
            db_session.commit()

    # If links do not exists, create them
    for chapter_order in chapters_order.chapter_order_by_ids:
        statement = (
            select(CourseChapter)
            .where(
                CourseChapter.chapter_id == chapter_order.chapter_id,
                CourseChapter.course_id == course.id,
            )
            .order_by(CourseChapter.order)
        )
        course_chapter = db_session.exec(statement).first()

        if not course_chapter:
            # Add CourseChapter link
            course_chapter = CourseChapter(
                chapter_id=chapter_order.chapter_id,
                course_id=course.id,  # type: ignore
                org_id=course.org_id,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
                order=chapter_order.chapter_id,
            )

            # Insert CourseChapter link in DB
            db_session.add(course_chapter)
            db_session.commit()

    # Update order of chapters
    for chapter_order in chapters_order.chapter_order_by_ids:
        statement = (
            select(CourseChapter)
            .where(
                CourseChapter.chapter_id == chapter_order.chapter_id,
                CourseChapter.course_id == course.id,
            )
            .order_by(CourseChapter.order)
        )
        course_chapter = db_session.exec(statement).first()

        if course_chapter:
            # Get the order from the index of the chapter_order_by_ids list
            course_chapter.order = chapters_order.chapter_order_by_ids.index(
                chapter_order
            )
            db_session.commit()

    ###########
    # Activities
    ###########

    # Delete ChapterActivities that are no longer part of the new order
    statement = (
        select(ChapterActivity)
        .where(
            ChapterActivity.course_id == course.id,
            ChapterActivity.org_id == course.org_id,
        )
        .order_by(ChapterActivity.order)
    )
    chapter_activities = db_session.exec(statement).all()

    activity_ids_to_delete = []
    for chapter_activity in chapter_activities:
        if (
            chapter_activity.chapter_id not in chapter_ids_to_keep
            or chapter_activity.activity_id not in activity_ids_to_delete
        ):
            activity_ids_to_delete.append(chapter_activity.activity_id)

    for activity_id in activity_ids_to_delete:
        statement = (
            select(ChapterActivity)
            .where(
                ChapterActivity.activity_id == activity_id,
                ChapterActivity.course_id == course.id,
            )
            .order_by(ChapterActivity.order)
        )
        chapter_activity = db_session.exec(statement).first()

        db_session.delete(chapter_activity)
        db_session.commit()

    # If links do not exist, create them
    chapter_activity_map = {}
    for chapter_order in chapters_order.chapter_order_by_ids:
        for activity_order in chapter_order.activities_order_by_ids:
            if (
                activity_order.activity_id in chapter_activity_map
                and chapter_activity_map[activity_order.activity_id]
                != chapter_order.chapter_id
            ):
                continue

            statement = (
                select(ChapterActivity)
                .where(
                    ChapterActivity.chapter_id == chapter_order.chapter_id,
                    ChapterActivity.activity_id == activity_order.activity_id,
                )
                .order_by(ChapterActivity.order)
            )
            chapter_activity = db_session.exec(statement).first()

            if not chapter_activity:
                # Add ChapterActivity link
                chapter_activity = ChapterActivity(
                    chapter_id=chapter_order.chapter_id,
                    activity_id=activity_order.activity_id,
                    org_id=course.org_id,
                    course_id=course.id,  # type: ignore
                    creation_date=str(datetime.now()),
                    update_date=str(datetime.now()),
                    order=activity_order.activity_id,
                )

                # Insert ChapterActivity link in DB
                db_session.add(chapter_activity)
                db_session.commit()

            chapter_activity_map[activity_order.activity_id] = chapter_order.chapter_id

    # Update order of activities
    for chapter_order in chapters_order.chapter_order_by_ids:
        for activity_order in chapter_order.activities_order_by_ids:
            statement = (
                select(ChapterActivity)
                .where(
                    ChapterActivity.chapter_id == chapter_order.chapter_id,
                    ChapterActivity.activity_id == activity_order.activity_id,
                )
                .order_by(ChapterActivity.order)
            )
            chapter_activity = db_session.exec(statement).first()

            if chapter_activity:
                # Get the order from the index of the chapter_order_by_ids list
                chapter_activity.order = chapter_order.activities_order_by_ids.index(
                    activity_order
                )
                db_session.commit()

    return {"detail": "Chapters reordered"}


## 🔒 RBAC Utils ##


async def rbac_check(
    request: Request,
    course_uuid: str,
    current_user: PublicUser | AnonymousUser,
    action: Literal["create", "read", "update", "delete"],
    db_session: Session,
):
    if action == "read":
        if current_user.id == 0:  # Anonymous user
            res = await authorization_verify_if_element_is_public(
                request, course_uuid, action, db_session
            )
            print("res", res)
            return res
        else:
            res = await authorization_verify_based_on_roles_and_authorship_and_usergroups(
                request, current_user.id, action, course_uuid, db_session
            )
            return res
    else:
        await authorization_verify_if_user_is_anon(current_user.id)

        await authorization_verify_based_on_roles_and_authorship_and_usergroups(
            request,
            current_user.id,
            action,
            course_uuid,
            db_session,
        )


## 🔒 RBAC Utils ##
