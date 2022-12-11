from pydantic import BaseModel
from src.services.database import check_database,  learnhouseDB
from src.services.security import verify_user_rights_with_roles
from src.services.courses.elements.uploads import upload_video
from src.services.users import PublicUser
from src.services.courses.elements.elements import ElementInDB
from fastapi import HTTPException, status, UploadFile
from uuid import uuid4
from datetime import datetime


async def create_video_element(name: str,  coursechapter_id: str, current_user: PublicUser,  video_file: UploadFile | None = None):
    await check_database()
    elements = learnhouseDB["elements"]
    coursechapters = learnhouseDB["coursechapters"]

    # generate element_id
    element_id = str(f"element_{uuid4()}")

    video_format = video_file.filename.split(".")[-1]
    element_object = ElementInDB(
        element_id=element_id,
        coursechapter_id=coursechapter_id,
        name=name,
        type="video",
        content={
            "video": {
                "filename": "video."+video_format,
                "element_id": element_id,
            }
        },
        creationDate=str(datetime.now()),
        updateDate=str(datetime.now()),
    )

    hasRoleRights = await verify_user_rights_with_roles("create", current_user.user_id, element_id)

    if not hasRoleRights:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Roles : Insufficient rights to perform this action")

    # create element
    element = ElementInDB(**element_object.dict())
    elements.insert_one(element.dict())

    # upload video
    if video_file:
        print("uploading video")
        # get videofile format

        await upload_video(video_file,  element_id)

    # todo : choose whether to update the chapter or not
    # update chapter
    coursechapters.update_one({"coursechapter_id": coursechapter_id}, {
        "$addToSet": {"elements": element_id}})

    return element
