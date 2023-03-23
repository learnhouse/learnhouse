from pydantic import BaseModel
from src.services.security import verify_user_rights_with_roles
from src.services.courses.activities.uploads.videos import upload_video
from src.services.users.users import PublicUser
from src.services.courses.activities.activities import ActivityInDB
from fastapi import HTTPException, status, UploadFile, Request
from uuid import uuid4
from datetime import datetime


async def create_video_activity(request: Request,name: str,  coursechapter_id: str, current_user: PublicUser,  video_file: UploadFile | None = None):
    activities = request.app.db["activities"]
    coursechapters = request.app.db["coursechapters"]

    # generate activity_id
    activity_id = str(f"activity_{uuid4()}")

    # check if video_file is not None
    if not video_file:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Video : No video file provided")

    video_format = video_file.filename.split(".")[-1]
    activity_object = ActivityInDB(
        activity_id=activity_id,
        coursechapter_id=coursechapter_id,
        name=name,
        type="video",
        content={
            "video": {
                "filename": "video."+video_format,
                "activity_id": activity_id,
            }
        },
        creationDate=str(datetime.now()),
        updateDate=str(datetime.now()),
    )

    hasRoleRights = await verify_user_rights_with_roles(request,"create", current_user.user_id, activity_id)

    if not hasRoleRights:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Roles : Insufficient rights to perform this action")

    # create activity
    activity = ActivityInDB(**activity_object.dict())
    await activities.insert_one(activity.dict())

    # upload video
    if video_file:
        # get videofile format
        await upload_video(video_file,  activity_id)

    # todo : choose whether to update the chapter or not
    # update chapter
    await coursechapters.update_one({"coursechapter_id": coursechapter_id}, {
        "$addToSet": {"activities": activity_id}})

    return activity
