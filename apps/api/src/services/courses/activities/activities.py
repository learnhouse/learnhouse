from typing import Literal
from sqlmodel import Session, select
from src.db.chapters import Chapter
from src.security.rbac.rbac import (
    authorization_verify_based_on_roles_and_authorship,
    authorization_verify_if_user_is_anon,
)
from src.db.activities import ActivityCreate, Activity, ActivityRead, ActivityUpdate
from src.db.chapter_activities import ChapterActivity
from src.db.users import AnonymousUser, PublicUser
from fastapi import HTTPException, Request
from uuid import uuid4
from datetime import datetime


####################################################
# CRUD
####################################################


async def create_activity(
    request: Request,
    activity_object: ActivityCreate,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    activity = Activity.from_orm(activity_object)

    # CHeck if org exists
    statement = select(Chapter).where(Chapter.id == activity_object.chapter_id)
    chapter = db_session.exec(statement).first()

    if not chapter:
        raise HTTPException(
            status_code=404,
            detail="Chapter not found",
        )

    # RBAC check
    await rbac_check(request, chapter.chapter_uuid, current_user, "create", db_session)

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
        .order_by(ChapterActivity.order)
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

    return ActivityRead.from_orm(activity)


async def get_activity(
    request: Request,
    activity_id: str,
    current_user: PublicUser,
    db_session: Session,
):
    statement = select(Activity).where(Activity.id == activity_id)
    activity = db_session.exec(statement).first()

    if not activity:
        raise HTTPException(
            status_code=404,
            detail="Activity not found",
        )

    # RBAC check
    await rbac_check(request, activity.activity_uuid, current_user, "read", db_session)

    activity = ActivityRead.from_orm(activity)

    return activity


async def update_activity(
    request: Request,
    activity_object: ActivityUpdate,
    activity_id: int,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    statement = select(Activity).where(Activity.id == activity_id)
    activity = db_session.exec(statement).first()

    if not activity:
        raise HTTPException(
            status_code=404,
            detail="Activity not found",
        )

    # RBAC check
    await rbac_check(
        request, activity.activity_uuid, current_user, "update", db_session
    )

    # Update only the fields that were passed in
    for var, value in vars(activity_object).items():
        if value is not None:
            setattr(activity, var, value)

    db_session.add(activity)
    db_session.commit()
    db_session.refresh(activity)

    activity = ActivityRead.from_orm(activity)

    return activity


async def delete_activity(
    request: Request,
    activity_id: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    statement = select(Activity).where(Activity.id == activity_id)
    activity = db_session.exec(statement).first()

    if not activity:
        raise HTTPException(
            status_code=404,
            detail="Activity not found",
        )

    # RBAC check
    await rbac_check(
        request, activity.activity_uuid, current_user, "delete", db_session
    )

    # Delete activity from chapter
    statement = select(ChapterActivity).where(
        ChapterActivity.activity_id == activity_id
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
    statement = select(ChapterActivity).where(
        ChapterActivity.chapter_id == coursechapter_id
    )
    activities = db_session.exec(statement).all()

    if not activities:
        raise HTTPException(
            status_code=404,
            detail="No activities found",
        )

    # RBAC check
    await rbac_check(request, "activity_x", current_user, "read", db_session)

    activities = [ActivityRead.from_orm(activity) for activity in activities]

    return activities


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
