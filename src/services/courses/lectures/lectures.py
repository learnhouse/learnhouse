from pydantic import BaseModel
from src.services.security import verify_user_rights_with_roles
from src.services.users import PublicUser, User
from fastapi import FastAPI, HTTPException, status, Request, Response, BackgroundTasks, UploadFile, File
from uuid import uuid4
from datetime import datetime

#### Classes ####################################################


class Lecture(BaseModel):
    name: str
    type: str
    content: object


class LectureInDB(Lecture):
    lecture_id: str
    coursechapter_id: str
    creationDate: str
    updateDate: str

#### Classes ####################################################


####################################################
# CRUD
####################################################


async def create_lecture(request: Request,lecture_object: Lecture, coursechapter_id: str, current_user: PublicUser):
    lectures = request.app.db["lectures"]
    coursechapters = request.app.db["coursechapters"]

    # generate lecture_id
    lecture_id = str(f"lecture_{uuid4()}")

    hasRoleRights = await verify_user_rights_with_roles(request, "create", current_user.user_id, lecture_id)

    if not hasRoleRights:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Roles : Insufficient rights to perform this action")

    # create lecture
    lecture = LectureInDB(**lecture_object.dict(), creationDate=str(
        datetime.now()), coursechapter_id=coursechapter_id, updateDate=str(datetime.now()), lecture_id=lecture_id)
    await lectures.insert_one(lecture.dict())

    # update chapter
    await coursechapters.update_one({"coursechapter_id": coursechapter_id}, {
                       "$addToSet": {"lectures": lecture_id}})

    return lecture


async def get_lecture(request: Request,lecture_id: str, current_user: PublicUser):
    lectures = request.app.db["lectures"]

    lecture = await lectures.find_one({"lecture_id": lecture_id})

    # verify course rights
    hasRoleRights = await verify_user_rights_with_roles(request,"read", current_user.user_id, lecture_id)

    if not hasRoleRights:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Roles : Insufficient rights to perform this action")

    if not lecture:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Course does not exist")

    lecture = LectureInDB(**lecture)
    return lecture


async def update_lecture(request: Request,lecture_object: Lecture, lecture_id: str, current_user: PublicUser):

    # verify course rights
    await verify_user_rights_with_roles(request, "update", current_user.user_id, lecture_id)

    lectures = request.app.db["lectures"]

    lecture = await lectures.find_one({"lecture_id": lecture_id})

    if lecture:
        creationDate = lecture["creationDate"]

        # get today's date
        datetime_object = datetime.now()

        updated_course = LectureInDB(
            lecture_id=lecture_id, coursechapter_id=lecture["coursechapter_id"], creationDate=creationDate, updateDate=str(datetime_object), **lecture_object.dict())

        await lectures.update_one({"lecture_id": lecture_id}, {
            "$set": updated_course.dict()})

        return LectureInDB(**updated_course.dict())

    else:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="lecture does not exist")


async def delete_lecture(request: Request,lecture_id: str, current_user: PublicUser):

    # verify course rights
    await verify_user_rights_with_roles(request,"delete", current_user.user_id, lecture_id)

    lectures = request.app.db["lectures"]

    lecture = await lectures.find_one({"lecture_id": lecture_id})

    if not lecture:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="lecture does not exist")

    isDeleted = await lectures.delete_one({"lecture_id": lecture_id})

    if isDeleted:
        return {"detail": "lecture deleted"}
    else:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Unavailable database")

####################################################
# Misc
####################################################


async def get_lectures(request: Request,coursechapter_id: str, current_user: PublicUser):
    lectures = request.app.db["lectures"]

    # verify course rights
    await verify_user_rights_with_roles(request,"read", current_user.user_id, coursechapter_id)

    lectures = lectures.find({"coursechapter_id": coursechapter_id})

    if not lectures:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Course does not exist")
    
    lectures = [LectureInDB(**lecture) for lecture in await lectures.to_list(length=100)]

    return lectures
