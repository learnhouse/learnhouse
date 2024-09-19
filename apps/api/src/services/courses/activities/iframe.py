from typing import Literal
from sqlmodel import Session, select
from fastapi import HTTPException, Request
from uuid import uuid4
from datetime import datetime
from pydantic import BaseModel

from src.db.courses.activities import Activity, ActivityRead, ActivitySubTypeEnum, ActivityTypeEnum
from src.db.courses.chapters import Chapter
from src.db.courses.course_chapters import CourseChapter
from src.db.organizations import Organization
from src.db.courses.courses import Course
from src.db.courses.chapter_activities import ChapterActivity
from src.security.rbac.rbac import authorization_verify_based_on_roles_and_authorship_and_usergroups, authorization_verify_if_user_is_anon
from src.db.users import PublicUser, AnonymousUser

class IframeActivityCreate(BaseModel):
    name: str
    chapter_id: str
    iframe_url: str

async def create_iframe_activity(
    request: Request,
    activity_object: IframeActivityCreate,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
) -> ActivityRead:

    # Extract data from activity_object
    name = activity_object.name
    chapter_id = activity_object.chapter_id
    iframe_url = activity_object.iframe_url


    # RBAC check
    await rbac_check(request, "activity_x", current_user, "create", db_session)

    # Get chapter
    statement = select(Chapter).where(Chapter.id == chapter_id)
    chapter = db_session.exec(statement).first()

    if not chapter:
        raise HTTPException(
            status_code=404,
            detail="Chapter not found",
        )

    # Get CourseChapter
    statement = select(CourseChapter).where(CourseChapter.chapter_id == chapter_id)
    coursechapter = db_session.exec(statement).first()

    if not coursechapter:
        raise HTTPException(
            status_code=404,
            detail="CourseChapter not found",
        )

    # Get organization
    statement = select(Organization).where(Organization.id == coursechapter.org_id)
    organization = db_session.exec(statement).first()

    # Get course
    statement = select(Course).where(Course.id == coursechapter.course_id)
    course = db_session.exec(statement).first()

    # Generate activity_uuid
    activity_uuid = str(f"activity_{uuid4()}")
    print("REACHER HERE !!!!")
    # Create activity
    activity_object = Activity(
        name=name,
        activity_type=ActivityTypeEnum.TYPE_IFRAME,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_IFRAME,
        activity_uuid=activity_uuid,
        org_id=coursechapter.org_id,
        course_id=coursechapter.course_id,
        published_version=1,
        content={
            "iframe_url": iframe_url,
            "activity_uuid": activity_uuid,
        },
        version=1,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    print("Activity Object {activity_object}")

    # Save activity to the database
    activity = Activity.model_validate(activity_object)
    db_session.add(activity)
    db_session.commit()
    db_session.refresh(activity)

    # Update chapter
    chapter_activity_object = ChapterActivity(
        chapter_id=chapter.id,
        activity_id=activity.id,
        course_id=coursechapter.course_id,
        org_id=coursechapter.org_id,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
        order=1,
    )
    print("chapter_activity object {chapter_activity_object}")

    db_session.add(chapter_activity_object)
    db_session.commit()

    return ActivityRead.model_validate(activity)

async def rbac_check(
    request: Request,
    course_id: str,
    current_user: PublicUser | AnonymousUser,
    action: Literal["create", "read", "update", "delete"],
    db_session: Session,
):
    await authorization_verify_if_user_is_anon(current_user.id)

    await authorization_verify_based_on_roles_and_authorship_and_usergroups(
        request,
        current_user.id,
        action,
        course_id,
        db_session,
    )
