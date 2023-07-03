from typing import Literal

from pydantic import BaseModel
from src.security.security import verify_user_rights_with_roles
from src.services.courses.activities.uploads.videos import upload_video
from src.services.users.users import PublicUser
from src.services.courses.activities.activities import ActivityInDB
from fastapi import HTTPException, status, UploadFile, Request
from uuid import uuid4
from datetime import datetime


async def create_video_activity(
    request: Request,
    name: str,
    coursechapter_id: str,
    current_user: PublicUser,
    video_file: UploadFile | None = None,
):
    activities = request.app.db["activities"]
    courses = request.app.db["courses"]

    # generate activity_id
    activity_id = str(f"activity_{uuid4()}")

    # get org_id from course
    coursechapter = await courses.find_one(
        {"chapters_content.coursechapter_id": coursechapter_id}
    )

    if not coursechapter:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="CourseChapter : No coursechapter found",
        )

    org_id = coursechapter["org_id"]

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

    activity_object = ActivityInDB(
        org_id=org_id,
        activity_id=activity_id,
        coursechapter_id=coursechapter_id,
        course_id=coursechapter["course_id"],
        name=name,
        type="video",
        content={
            "video": {
                "filename": "video." + video_format,
                "activity_id": activity_id,
            }
        },
        creationDate=str(datetime.now()),
        updateDate=str(datetime.now()),
    )

    hasRoleRights = await verify_user_rights_with_roles(
        request, "create", current_user.user_id, activity_id, element_org_id=org_id
    )

    if not hasRoleRights:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Roles : Insufficient rights to perform this action",
        )

    # create activity
    activity = ActivityInDB(**activity_object.dict())
    await activities.insert_one(activity.dict())

    # upload video
    if video_file:
        # get videofile format
        await upload_video(video_file, activity_id, org_id, coursechapter["course_id"])

    # todo : choose whether to update the chapter or not
    # update chapter
    await courses.update_one(
        {"chapters_content.coursechapter_id": coursechapter_id},
        {"$addToSet": {"chapters_content.$.activities": activity_id}},
    )

    return activity


class ExternalVideo(BaseModel):
    name: str
    uri: str
    type: Literal["youtube", "vimeo"]
    coursechapter_id: str


class ExternalVideoInDB(BaseModel):
    activity_id: str


async def create_external_video_activity(
    request: Request,
    current_user: PublicUser,
    data: ExternalVideo,
):
    activities = request.app.db["activities"]
    courses = request.app.db["courses"]

    # generate activity_id
    activity_id = str(f"activity_{uuid4()}")

    # get org_id from course
    coursechapter = await courses.find_one(
        {"chapters_content.coursechapter_id": data.coursechapter_id}
    )

    if not coursechapter:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="CourseChapter : No coursechapter found",
        )

    org_id = coursechapter["org_id"]

    activity_object = ActivityInDB(
        org_id=org_id,
        activity_id=activity_id,
        coursechapter_id=data.coursechapter_id,
        name=data.name,
        type="video",
        content={
            "external_video": {
                "uri": data.uri,
                "activity_id": activity_id,
                "type": data.type,
            }
        },
        course_id=coursechapter["course_id"],
        creationDate=str(datetime.now()),
        updateDate=str(datetime.now()),
    )

    hasRoleRights = await verify_user_rights_with_roles(
        request, "create", current_user.user_id, activity_id, element_org_id=org_id
    )

    if not hasRoleRights:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Roles : Insufficient rights to perform this action",
        )

    # create activity
    activity = ActivityInDB(**activity_object.dict())
    await activities.insert_one(activity.dict())

    # todo : choose whether to update the chapter or not
    # update chapter
    await courses.update_one(
        {"chapters_content.coursechapter_id": data.coursechapter_id},
        {"$addToSet": {"chapters_content.$.activities": activity_id}},
    )

    return activity
