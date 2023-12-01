from datetime import datetime
from typing import List, Literal
from uuid import uuid4
from sqlmodel import Session, select
from src.db.users import AnonymousUser
from src.security.rbac.rbac import (
    authorization_verify_based_on_roles_and_authorship,
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
    DepreceatedChaptersRead,
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

    # RBAC check
    await rbac_check(request, "chapter_x", current_user, "create", db_session)

    # complete chapter object
    chapter.course_id = chapter_object.course_id
    chapter.chapter_uuid = f"chapter_{uuid4()}"
    chapter.creation_date = str(datetime.now())
    chapter.update_date = str(datetime.now())

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

    # RBAC check
    await rbac_check(request, chapter.chapter_uuid, current_user, "read", db_session)

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

    chapter = ChapterRead(**chapter.dict())

    return chapter


async def delete_chapter(
    request: Request,
    chapter_id: int,
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
    statement = select(ChapterActivity).where(ChapterActivity.chapter_id == chapter_id)
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
    statement = select(Chapter).where(Chapter.course_id == course_id)
    chapters = db_session.exec(statement).all()


    chapters = [ChapterRead(**chapter.dict(), activities=[]) for chapter in chapters]

    # RBAC check
    await rbac_check(request, "chapter_x", current_user, "read", db_session)

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


async def get_depreceated_course_chapters(
    request: Request,
    course_id: int,
    current_user: PublicUser,
    db_session: Session,
) -> DepreceatedChaptersRead:
    statement = select(Course).where(Course.id == course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Course does not exist"
        )

    # RBAC check
    await rbac_check(request, course.course_uuid, current_user, "read", db_session)

    # Get chapters that are linked to his course and order them by order, using the order field in the CourseChapter table
    statement = (
        select(Chapter)
        .join(CourseChapter, Chapter.id == CourseChapter.chapter_id)
        .where(CourseChapter.course_id == course_id)
        .order_by(CourseChapter.order)
        .group_by(Chapter.id, CourseChapter.order)
    )
    print("ded", statement)
    chapters = db_session.exec(statement).all()

    chapters = [ChapterRead(**chapter.dict(), activities=[]) for chapter in chapters]

    # Get activities for each chapter
    for chapter in chapters:
        statement = (
            select(Activity)
            .join(ChapterActivity, Activity.id == ChapterActivity.activity_id)
            .where(ChapterActivity.chapter_id == chapter.id)
            .order_by(ChapterActivity.order)
            .distinct(Activity.id, ChapterActivity.order)
        )
        chapter_activities = db_session.exec(statement).all()

        for chapter_activity in chapter_activities:
            statement = (
                select(Activity)
                .join(ChapterActivity, Activity.id == ChapterActivity.activity_id)
                .where(Activity.id == chapter_activity.id)
                .distinct(Activity.id, ChapterActivity.order)
                .order_by(ChapterActivity.order)
            )
            activity = db_session.exec(statement).first()

            if activity:
                chapter.activities.append(ActivityRead(**activity.dict()))

    # Get a list of chapter ids
    chapter_order: List[str] = [str(chapter.id) for chapter in chapters]

    # Get activities for each chapter
    activities = []
    for chapter_id in chapter_order:
        # order by activity order
        statement = (
            select(Activity)
            .join(ChapterActivity, Activity.id == ChapterActivity.activity_id)
            .where(ChapterActivity.chapter_id == chapter_id)
            .order_by(ChapterActivity.order)
            .distinct(Activity.id, ChapterActivity.order)
        )
        chapter_activities = db_session.exec(statement).all()

        activities.extend(chapter_activities)

    result = DepreceatedChaptersRead(
        chapter_order=chapter_order, chapters=chapters, activities=activities
    )

    return result


async def reorder_chapters_and_activities(
    request: Request,
    course_id: int,
    chapters_order: ChapterUpdateOrder,
    current_user: PublicUser,
    db_session: Session,
):
    statement = select(Course).where(Course.id == course_id)
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
            CourseChapter.course_id == course_id, CourseChapter.org_id == course.org_id
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
    statement = select(Chapter).where(Chapter.course_id == course_id)
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
                CourseChapter.course_id == course_id,
            )
            .order_by(CourseChapter.order)
        )
        course_chapter = db_session.exec(statement).first()

        if not course_chapter:
            # Add CourseChapter link
            course_chapter = CourseChapter(
                chapter_id=chapter_order.chapter_id,
                course_id=course_id,
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
                CourseChapter.course_id == course_id,
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

    # Delete ChapterActivities that are not linked to chapter_id and activity_id and org_id and course_id
    statement = (
        select(ChapterActivity)
        .where(
            ChapterActivity.course_id == course_id,
            ChapterActivity.org_id == course.org_id,
        )
        .order_by(ChapterActivity.order)
    )
    chapter_activities = db_session.exec(statement).all()

    activity_ids_to_keep = [
        activity_order.activity_id
        for chapter_order in chapters_order.chapter_order_by_ids
        for activity_order in chapter_order.activities_order_by_ids
    ]

    for chapter_activity in chapter_activities:
        if chapter_activity.activity_id not in activity_ids_to_keep:
            db_session.delete(chapter_activity)
            db_session.commit()

    # If links do not exists, create them
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

            if not chapter_activity:
                # Add ChapterActivity link
                chapter_activity = ChapterActivity(
                    chapter_id=chapter_order.chapter_id,
                    activity_id=activity_order.activity_id,
                    org_id=course.org_id,
                    course_id=course_id,
                    creation_date=str(datetime.now()),
                    update_date=str(datetime.now()),
                    order=activity_order.activity_id,
                )

                # Insert ChapterActivity link in DB
                db_session.add(chapter_activity)
                db_session.commit()

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
    course_id: str,
    current_user: PublicUser | AnonymousUser,
    action: Literal["create", "read", "update", "delete"],
    db_session: Session,
):
    await authorization_verify_if_user_is_anon(current_user.id)

    await authorization_verify_based_on_roles_and_authorship(
        request,
        current_user.id,
        action,
        course_id,
        db_session,
    )


## 🔒 RBAC Utils ##
