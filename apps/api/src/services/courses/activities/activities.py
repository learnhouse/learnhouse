import stat
from typing import Literal
from pydantic import BaseModel
from sqlmodel import Session, select
from src.db.organizations import Organization
from src import db
from src.db.activities import ActivityCreate, Activity, ActivityRead, ActivityUpdate
from src.db.chapter_activities import ChapterActivity
from src.security.rbac.rbac import (
    authorization_verify_based_on_roles,
    authorization_verify_if_element_is_public,
    authorization_verify_if_user_is_anon,
)
from src.db.users import AnonymousUser, PublicUser
from fastapi import HTTPException, status, Request
from uuid import uuid4
from datetime import datetime


####################################################
# CRUD
####################################################


async def create_activity(
    request: Request,
    activity_object: ActivityCreate,
    current_user: PublicUser,
    db_session: Session,
):
    activity = Activity.from_orm(activity_object)

    # CHeck if org exists
    statement = select(Organization).where(Organization.id == activity_object.org_id)
    org = db_session.exec(statement).first()

    if not org:
        raise HTTPException(
            status_code=404,
            detail="Organization not found",
        )

    activity.activity_uuid = str(f"activity_{uuid4()}")
    activity.creation_date = str(datetime.now())
    activity.update_date = str(datetime.now())

    # Insert Activity in DB
    db_session.add(activity)
    db_session.commit()
    db_session.refresh(activity)

    # Add activity to chapter
    activity_chapter = ChapterActivity(
        chapter_id=activity_object.chapter_id,
        activity_id=activity.id is not None,
        course_id=activity_object.course_id,
        org_id=activity_object.org_id,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
        order=activity_object.order,
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

    return activity


async def update_activity(
    request: Request,
    activity_object: ActivityUpdate,
    current_user: PublicUser,
    db_session: Session,
):
    statement = select(Activity).where(Activity.id == activity_object.activity_id)
    activity = db_session.exec(statement).first()

    if not activity:
        raise HTTPException(
            status_code=404,
            detail="Activity not found",
        )

    del activity_object.activity_id

    # Update only the fields that were passed in
    for var, value in vars(activity_object).items():
        if value is not None:
            setattr(activity, var, value)

    db_session.add(activity)
    db_session.commit()
    db_session.refresh(activity)

    return activity


async def delete_activity(
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
    coursechapter_id: str,
    current_user: PublicUser,
    db_session: Session,
):
    statement = select(ChapterActivity).where(
        ChapterActivity.chapter_id == coursechapter_id
    )
    activities = db_session.exec(statement).all()

    if not activities:
        raise HTTPException(
            status_code=404,
            detail="No activities found",
        )

    return activities
