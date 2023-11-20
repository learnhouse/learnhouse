from typing import Literal

from pydantic import BaseModel
from sqlmodel import Session, select
from src.db.chapters import Chapter
from src.db.activities import Activity, ActivityRead, ActivitySubTypeEnum, ActivityTypeEnum
from src.db.chapter_activities import ChapterActivity
from src.db.course_chapters import CourseChapter
from src.db.users import PublicUser
from src.services.courses.activities.uploads.videos import upload_video
from fastapi import HTTPException, status, UploadFile, Request
from uuid import uuid4
from datetime import datetime


async def create_video_activity(
    request: Request,
    name: str,
    chapter_id: str,
    current_user: PublicUser,
    db_session: Session,
    video_file: UploadFile | None = None,
):
    # get chapter_id
    statement = select(Chapter).where(Chapter.id == chapter_id)
    chapter = db_session.exec(statement).first()

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
        published_version=1,
        content={
            "filename": "video." + video_format,
            "activity_uuid": activity_uuid,
        },
        version=1,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )

    # create activity
    activity = Activity.from_orm(activity_object)
    db_session.add(activity)
    db_session.commit()
    db_session.refresh(activity)

    # upload video
    if video_file:
        # get videofile format
        await upload_video(
            video_file, activity.id, coursechapter.org_id, coursechapter.course_id
        )

    # update chapter
    chapter_activity_object = ChapterActivity(
        chapter_id=coursechapter.id is not None,
        activity_id=activity.id is not None,
        course_id=coursechapter.course_id,
        org_id=coursechapter.org_id,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
        order=1,
    )

    # Insert ChapterActivity link in DB
    db_session.add(chapter_activity_object)
    db_session.commit()
    db_session.refresh(chapter_activity_object)

    return ActivityRead.from_orm(activity)

class ExternalVideo(BaseModel):
    name: str
    uri: str
    type: Literal["youtube", "vimeo"]
    chapter_id: str


class ExternalVideoInDB(BaseModel):
    activity_id: str


async def create_external_video_activity(
    request: Request,
    current_user: PublicUser,
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

    # generate activity_uuid
    activity_uuid = str(f"activity_{uuid4()}")

    activity_object = Activity(
        name=data.name,
        activity_type=ActivityTypeEnum.TYPE_VIDEO,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_VIDEO_YOUTUBE,
        activity_uuid=activity_uuid,
        published_version=1,
        content={
            "uri": data.uri,
            "type": data.type,
            "activity_uuid": activity_uuid,
        },
        version=1,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )

    # create activity
    activity = Activity.from_orm(activity_object)
    db_session.add(activity)
    db_session.commit()
    db_session.refresh(activity)

    # update chapter
    chapter_activity_object = ChapterActivity(
        chapter_id=coursechapter.id is not None,
        activity_id=activity.id is not None,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
        order=1,
    )

    # Insert ChapterActivity link in DB
    db_session.add(chapter_activity_object)
    db_session.commit()

    return ActivityRead.from_orm(activity)
