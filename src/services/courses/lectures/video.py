from pydantic import BaseModel
from src.services.security import verify_user_rights_with_roles
from src.services.courses.lectures.uploads.videos import upload_video
from src.services.users import PublicUser
from src.services.courses.lectures.lectures import LectureInDB
from fastapi import HTTPException, status, UploadFile, Request
from uuid import uuid4
from datetime import datetime


async def create_video_lecture(request: Request,name: str,  coursechapter_id: str, current_user: PublicUser,  video_file: UploadFile | None = None):
    lectures = request.app.db["lectures"]
    coursechapters = request.app.db["coursechapters"]

    # generate lecture_id
    lecture_id = str(f"lecture_{uuid4()}")

    # check if video_file is not None
    if not video_file:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Video : No video file provided")

    video_format = video_file.filename.split(".")[-1]
    lecture_object = LectureInDB(
        lecture_id=lecture_id,
        coursechapter_id=coursechapter_id,
        name=name,
        type="video",
        content={
            "video": {
                "filename": "video."+video_format,
                "lecture_id": lecture_id,
            }
        },
        creationDate=str(datetime.now()),
        updateDate=str(datetime.now()),
    )

    hasRoleRights = await verify_user_rights_with_roles(request,"create", current_user.user_id, lecture_id)

    if not hasRoleRights:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Roles : Insufficient rights to perform this action")

    # create lecture
    lecture = LectureInDB(**lecture_object.dict())
    lectures.insert_one(lecture.dict())

    # upload video
    if video_file:
        print("uploading video")
        # get videofile format

        await upload_video(video_file,  lecture_id)

    # todo : choose whether to update the chapter or not
    # update chapter
    coursechapters.update_one({"coursechapter_id": coursechapter_id}, {
        "$addToSet": {"lectures": lecture_id}})

    return lecture
