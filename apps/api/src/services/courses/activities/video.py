from typing import Literal
import json

from sqlalchemy import func
from src.db.courses.courses import Course
from src.db.organizations import Organization

from pydantic import BaseModel
from sqlmodel import Session, select
from src.db.courses.chapters import Chapter
from src.db.courses.activities import (
    Activity,
    ActivityRead,
    ActivitySubTypeEnum,
    ActivityTypeEnum,
)
from src.db.courses.chapter_activities import ChapterActivity
from src.db.courses.course_chapters import CourseChapter
from src.db.users import AnonymousUser, PublicUser
from src.services.courses.activities.uploads.videos import upload_video
from fastapi import HTTPException, status, UploadFile, Request
from uuid import uuid4
from datetime import datetime
from src.security.courses_security import courses_rbac_check_for_activities


async def create_video_activity(
    request: Request,
    name: str,
    chapter_id: str,
    current_user: PublicUser,
    db_session: Session,
    video_file: UploadFile | None = None,
    details: str = "{}",
):
    # get chapter_id
    statement = select(Chapter).where(Chapter.id == chapter_id)
    chapter = db_session.exec(statement).first()

    # convert details to dict
    details = json.loads(details)

    if not chapter:
        raise HTTPException(
            status_code=404,
            detail="Chapter not found",
        )

    statement = select(CourseChapter).where(CourseChapter.chapter_id == chapter_id)
    coursechapter = db_session.exec(statement).first()

    if not coursechapter:
        raise HTTPException(
            status_code=404,
            detail="CourseChapter not found",
        )

    # Get course_uuid for RBAC check
    statement = select(Course).where(Course.id == coursechapter.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await courses_rbac_check_for_activities(request, course.course_uuid, current_user, "create", db_session)

    # Get org_uuid
    statement = select(Organization).where(Organization.id == coursechapter.org_id)
    organization = db_session.exec(statement).first()

    # generate activity_uuid
    activity_uuid = str(f"activity_{uuid4()}")

    # check if video_file is not None
    if not video_file:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Video : No video file provided",
        )

    if video_file.content_type not in ["video/mp4", "video/webm"]:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Video : Wrong video format"
        )

    # get video format
    if video_file.filename:
        video_format = video_file.filename.split(".")[-1]

    else:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Video : No video file provided",
        )

    activity_object = Activity(
        name=name,
        activity_type=ActivityTypeEnum.TYPE_VIDEO,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_VIDEO_HOSTED,
        activity_uuid=activity_uuid,
        org_id=coursechapter.org_id,
        course_id=coursechapter.course_id,
        content={
            "filename": "video." + video_format,
            "activity_uuid": activity_uuid,
        },
        details=details if isinstance(details, dict) else json.loads(details),
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )

    try:
        # 1. Create activity in DB (not committed yet)
        activity = Activity.model_validate(activity_object)
        db_session.add(activity)
        db_session.flush()  # Flush to get activity.id, not commit yet
        
        # 2. Upload video - Raise HTTPException if upload fails
        if video_file and organization and course:
            await upload_video(
                video_file,
                activity.activity_uuid,
                organization.org_uuid,
                course.course_uuid,
            )
        
        # 3. Create ChapterActivity link - Lock the rows for this chapter to prevent race conditions
        chapter_lock_stmt = (
            select(Chapter)
            .where(Chapter.id == chapter.id)
            .with_for_update()  # Lock chapter table
        )
        db_session.exec(chapter_lock_stmt).first()

        # 4. Get MAX ORDER after locking
        max_order_stmt = (
            select(func.coalesce(func.max(ChapterActivity.order), 0))
            .where(ChapterActivity.chapter_id == chapter.id)
        )
        max_order = db_session.exec(max_order_stmt).one()
        next_order = max_order + 1
        
        # 5. Create ChapterActivity with guaranteed unique order
        chapter_activity_object = ChapterActivity(
            chapter_id=chapter.id,
            activity_id=activity.id,
            course_id=coursechapter.course_id,
            org_id=coursechapter.org_id,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
            order=next_order,
        )
        db_session.add(chapter_activity_object)
        
        # 6. Commit transaction
        db_session.commit()
        db_session.refresh(activity)
        
        return ActivityRead.model_validate(activity)

    except HTTPException:
        # Upload failure - rollback DB
        db_session.rollback()
        raise  # Re-raise HTTPException to be handled by FastAPI

    except Exception as e:
        # Unexpected failure - rollback and raise
        db_session.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to create video activity: {str(e)}"
        )


class ExternalVideo(BaseModel):
    name: str
    uri: str
    type: Literal["youtube", "vimeo"]
    chapter_id: str
    details: str = "{}"


class ExternalVideoInDB(BaseModel):
    activity_id: str


async def create_external_video_activity(
    request: Request,
    current_user: PublicUser | AnonymousUser,
    data: ExternalVideo,
    db_session: Session,
):
    # get chapter_id
    statement = select(Chapter).where(Chapter.id == data.chapter_id)
    chapter = db_session.exec(statement).first()

    if not chapter:
        raise HTTPException(
            status_code=404,
            detail="Chapter not found",
        )

    statement = select(CourseChapter).where(CourseChapter.chapter_id == data.chapter_id)
    coursechapter = db_session.exec(statement).first()

    if not coursechapter:
        raise HTTPException(
            status_code=404,
            detail="CourseChapter not found",
        )

    # Get course_uuid for RBAC check
    statement = select(Course).where(Course.id == coursechapter.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await courses_rbac_check_for_activities(request, course.course_uuid, current_user, "create", db_session)

    # generate activity_uuid
    activity_uuid = str(f"activity_{uuid4()}")

    # convert details to dict
    details = json.loads(data.details)

    activity_object = Activity(
        name=data.name,
        activity_type=ActivityTypeEnum.TYPE_VIDEO,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_VIDEO_YOUTUBE,
        activity_uuid=activity_uuid,
        course_id=coursechapter.course_id,
        org_id=coursechapter.org_id,
        content={
            "uri": data.uri,
            "type": data.type,
            "activity_uuid": activity_uuid,
        },
        details=details,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )

    try:
        # 1. Create activity and flush to get activity.id
        activity = Activity.model_validate(activity_object)
        db_session.add(activity)
        db_session.flush()
        
        # 2. Lock chapter and get next order atomically
        chapter_lock_stmt = (
            select(Chapter)
            .where(Chapter.id == chapter.id)
            .with_for_update()
        )
        db_session.exec(chapter_lock_stmt).first()

        max_order_stmt = (
            select(func.coalesce(func.max(ChapterActivity.order), 0))
            .where(ChapterActivity.chapter_id == coursechapter.chapter_id)
        )
        next_order = db_session.exec(max_order_stmt).one() + 1
        
        # 3. Create ChapterActivity link
        chapter_activity_object = ChapterActivity(
            chapter_id=coursechapter.chapter_id,
            activity_id=activity.id,
            course_id=coursechapter.course_id,
            org_id=coursechapter.org_id,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
            order=next_order,
        )
        db_session.add(chapter_activity_object)
        
        # 4. Commit all in one transaction
        db_session.commit()
        db_session.refresh(activity)
        
        return ActivityRead.model_validate(activity)

    except Exception as e:
        # Rollback on any error
        db_session.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to create external video activity: {str(e)}"
        )


## 🔒 RBAC Utils ##
