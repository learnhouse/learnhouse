from typing import Literal, Optional
import json
from src.db.courses.courses import Course
from src.db.organizations import Organization

from pydantic import BaseModel
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession
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
from src.security.rbac import check_resource_access, AccessAction


async def create_video_activity(
    request: Request,
    name: str,
    chapter_id: int,
    current_user: PublicUser,
    db_session: AsyncSession,
    video_file: UploadFile | None = None,
    details: str = "{}",
    extra_metadata: Optional[dict] = None,
):
    # get chapter_id
    statement = select(Chapter).where(Chapter.id == chapter_id)
    chapter = (await db_session.execute(statement)).scalars().first()

    # convert details to dict
    details = json.loads(details)

    if not chapter:
        raise HTTPException(
            status_code=404,
            detail="Chapter not found",
        )

    statement = select(CourseChapter).where(CourseChapter.chapter_id == chapter_id)
    coursechapter = (await db_session.execute(statement)).scalars().first()

    if not coursechapter:
        raise HTTPException(
            status_code=404,
            detail="CourseChapter not found",
        )

    # Get course_uuid for RBAC check
    statement = select(Course).where(Course.id == coursechapter.course_id)
    course = (await db_session.execute(statement)).scalars().first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await check_resource_access(
        request, db_session, current_user, course.course_uuid, AccessAction.CREATE
    )

    # Get org_uuid
    statement = select(Organization).where(Organization.id == coursechapter.org_id)
    organization = (await db_session.execute(statement)).scalars().first()

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

    if not video_file.filename:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Video : No video file provided",
        )

    # Upload video first to get safe filename
    saved_filename = None
    if video_file and organization and course:
        saved_filename = await upload_video(
            video_file,
            activity_uuid,
            organization.org_uuid,
            course.course_uuid,
        )

    activity_object = Activity(
        name=name,
        activity_type=ActivityTypeEnum.TYPE_VIDEO,
        activity_sub_type=ActivitySubTypeEnum.SUBTYPE_VIDEO_HOSTED,
        activity_uuid=activity_uuid,
        org_id=coursechapter.org_id,
        course_id=coursechapter.course_id,
        content={
            "filename": saved_filename or "video",
            "activity_uuid": activity_uuid,
        },
        details=details if isinstance(details, dict) else json.loads(details),
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
        extra_metadata=extra_metadata,
    )

    # create activity
    activity = Activity.model_validate(activity_object)
    db_session.add(activity)
    await db_session.commit()
    await db_session.refresh(activity)

    # Find the last activity order in the chapter
    statement = (
        select(ChapterActivity)
        .where(ChapterActivity.chapter_id == chapter.id)
        .order_by(ChapterActivity.order)  # type: ignore
    )
    chapter_activities = (await db_session.execute(statement)).scalars().all()
    last_order = chapter_activities[-1].order if chapter_activities else 0
    to_be_used_order = last_order + 1

    # update chapter
    chapter_activity_object = ChapterActivity(
        chapter_id=chapter.id,  # type: ignore
        activity_id=activity.id,  # type: ignore
        course_id=coursechapter.course_id,
        org_id=coursechapter.org_id,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
        order=to_be_used_order,
    )

    # Insert ChapterActivity link in DB
    db_session.add(chapter_activity_object)
    await db_session.commit()
    await db_session.refresh(chapter_activity_object)

    return ActivityRead.model_validate(activity)


class ExternalVideo(BaseModel):
    name: str
    uri: str
    type: Literal["youtube", "vimeo"]
    chapter_id: int
    details: str = "{}"
    extra_metadata: Optional[dict] = None


class ExternalVideoInDB(BaseModel):
    activity_id: int


async def create_external_video_activity(
    request: Request,
    current_user: PublicUser | AnonymousUser,
    data: ExternalVideo,
    db_session: AsyncSession,
):
    # get chapter_id
    statement = select(Chapter).where(Chapter.id == data.chapter_id)
    chapter = (await db_session.execute(statement)).scalars().first()

    if not chapter:
        raise HTTPException(
            status_code=404,
            detail="Chapter not found",
        )

    statement = select(CourseChapter).where(CourseChapter.chapter_id == data.chapter_id)
    coursechapter = (await db_session.execute(statement)).scalars().first()

    if not coursechapter:
        raise HTTPException(
            status_code=404,
            detail="CourseChapter not found",
        )

    # Get course_uuid for RBAC check
    statement = select(Course).where(Course.id == coursechapter.course_id)
    course = (await db_session.execute(statement)).scalars().first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await check_resource_access(
        request, db_session, current_user, course.course_uuid, AccessAction.CREATE
    )

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
        extra_metadata=data.extra_metadata,
    )

    # create activity
    activity = Activity.model_validate(activity_object)
    db_session.add(activity)
    await db_session.commit()
    await db_session.refresh(activity)

    # Find the last activity order in the chapter
    statement = (
        select(ChapterActivity)
        .where(ChapterActivity.chapter_id == coursechapter.chapter_id)
        .order_by(ChapterActivity.order)  # type: ignore
    )
    chapter_activities = (await db_session.execute(statement)).scalars().all()
    last_order = chapter_activities[-1].order if chapter_activities else 0
    to_be_used_order = last_order + 1

    # update chapter
    chapter_activity_object = ChapterActivity(
        chapter_id=coursechapter.chapter_id,  # type: ignore
        activity_id=activity.id,  # type: ignore
        course_id=coursechapter.course_id,
        org_id=coursechapter.org_id,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
        order=to_be_used_order,
    )

    # Insert ChapterActivity link in DB
    db_session.add(chapter_activity_object)
    await db_session.commit()

    return ActivityRead.model_validate(activity)


async def update_video_activity(
    request: Request,
    activity_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
    name: Optional[str] = None,
    video_file: UploadFile | None = None,
    details: Optional[str] = None,
) -> ActivityRead:
    statement = select(Activity).where(Activity.activity_uuid == activity_uuid)
    activity = db_session.exec(statement).first()

    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")

    statement = select(Course).where(Course.id == activity.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    await check_resource_access(
        request, db_session, current_user, course.course_uuid, AccessAction.UPDATE
    )

    if name is not None:
        activity.name = name

    if details:
        activity.details = json.loads(details)

    if video_file and video_file.filename:
        if video_file.content_type not in ["video/mp4", "video/webm"]:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Video : Wrong video format",
            )

        statement = select(Organization).where(Organization.id == activity.org_id)
        organization = db_session.exec(statement).first()

        if organization and course:
            saved_filename = await upload_video(
                video_file,
                activity_uuid,
                organization.org_uuid,
                course.course_uuid,
            )
            new_content = dict(activity.content) if activity.content else {}
            new_content["filename"] = saved_filename
            activity.content = new_content
            from sqlalchemy.orm.attributes import flag_modified

            flag_modified(activity, "content")

    activity.update_date = str(datetime.now())
    db_session.add(activity)
    db_session.commit()
    db_session.refresh(activity)

    return ActivityRead.model_validate(activity)


async def update_external_video_activity(
    request: Request,
    activity_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
    uri: Optional[str] = None,
    name: Optional[str] = None,
    details: Optional[str] = None,
) -> ActivityRead:
    statement = select(Activity).where(Activity.activity_uuid == activity_uuid)
    activity = db_session.exec(statement).first()

    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")

    statement = select(Course).where(Course.id == activity.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    await check_resource_access(
        request, db_session, current_user, course.course_uuid, AccessAction.UPDATE
    )

    if name is not None:
        activity.name = name

    if uri:
        content = dict(activity.content) if activity.content else {}
        content["uri"] = uri
        activity.content = content
        from sqlalchemy.orm.attributes import flag_modified

        flag_modified(activity, "content")

    if details:
        activity.details = json.loads(details)

    activity.update_date = str(datetime.now())
    db_session.add(activity)
    db_session.commit()
    db_session.refresh(activity)

    return ActivityRead.model_validate(activity)


## 🔒 RBAC Utils ##
