from datetime import datetime
import json
from typing import List
from uuid import uuid4
from pydantic import BaseModel
from src.services.courses.courses import Course, CourseInDB
from src.services.courses.activities.activities import Activity, ActivityInDB
from src.services.security import verify_user_rights_with_roles
from src.services.users.users import PublicUser
from fastapi import HTTPException, status, Request, Response, BackgroundTasks, UploadFile, File


class CourseChapter(BaseModel):
    name: str
    description: str
    activities: list


class CourseChapterInDB(CourseChapter):
    coursechapter_id: str
    course_id: str
    creationDate: str
    updateDate: str


# Frontend
class CourseChapterMetaData(BaseModel):
    chapterOrder: List[str]
    chapters: dict
    activities: object

#### Classes ####################################################

####################################################
# CRUD
####################################################


async def create_coursechapter(request: Request,coursechapter_object: CourseChapter, course_id: str, current_user: PublicUser):
    coursechapters = request.app.db["coursechapters"]
    courses = request.app.db["courses"]

    # get course org_id and verify rights
    course = await courses.find_one({"course_id": course_id})

    # generate coursechapter_id with uuid4
    coursechapter_id = str(f"coursechapter_{uuid4()}")

    hasRoleRights = await verify_user_rights_with_roles(request, "create", current_user.user_id, coursechapter_id, course["org_id"])

    if not hasRoleRights:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Roles : Insufficient rights to perform this action")

    coursechapter = CourseChapterInDB(coursechapter_id=coursechapter_id, creationDate=str(
        datetime.now()), updateDate=str(datetime.now()), course_id=course_id, **coursechapter_object.dict())

    coursechapter_in_db = await coursechapters.insert_one(coursechapter.dict())
    courses.update_one({"course_id": course_id}, {
                       "$addToSet": {"chapters": coursechapter_id}})

    if not coursechapter_in_db:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Unavailable database")

    return coursechapter.dict()


async def get_coursechapter(request: Request,coursechapter_id: str, current_user: PublicUser):
    coursechapters = request.app.db["coursechapters"]

    coursechapter = await coursechapters.find_one(
        {"coursechapter_id": coursechapter_id})

    if coursechapter:
        # verify course rights
        await verify_rights(request, coursechapter["course_id"], current_user, "read")
        coursechapter = CourseChapter(**coursechapter)

        return coursechapter

    else:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="CourseChapter does not exist")


async def update_coursechapter(request: Request,coursechapter_object: CourseChapter,  coursechapter_id: str, current_user: PublicUser):
    coursechapters = request.app.db["coursechapters"]

    coursechapter = await coursechapters.find_one(
        {"coursechapter_id": coursechapter_id})

    if coursechapter:
        # verify course rights
        await verify_rights(request, coursechapter["course_id"], current_user, "update")
        creationDate = coursechapter["creationDate"]

        # get today's date
        datetime_object = datetime.now()

        updated_coursechapter = CourseChapterInDB(
            coursechapter_id=coursechapter_id, creationDate=creationDate, course_id=coursechapter["course_id"], updateDate=str(datetime_object), **coursechapter_object.dict())

        await coursechapters.update_one({"coursechapter_id": coursechapter_id}, {
            "$set": updated_coursechapter.dict()})

        return CourseChapterInDB(**updated_coursechapter.dict())

    else:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Coursechapter does not exist")


async def delete_coursechapter(request: Request,coursechapter_id: str,  current_user: PublicUser):

    coursechapters = request.app.db["coursechapters"]
    courses = request.app.db["courses"]

    coursechapter = await coursechapters.find_one(
        {"coursechapter_id": coursechapter_id})

    if coursechapter:
        # verify course rights
        await verify_rights(request, coursechapter["course_id"], current_user, "delete")

        isDeleted = await coursechapters.delete_one(
            {"coursechapter_id": coursechapter_id})

        # Remove coursechapter from course
        await courses.update_one({"course_id": coursechapter["course_id"]}, {
            "$pull": {"chapters": coursechapter_id}})

        if isDeleted:
            return {"detail": "coursechapter deleted"}
        else:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Unavailable database")

    else:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Course does not exist")

####################################################
# Misc
####################################################


async def get_coursechapters(request: Request,course_id: str, page: int = 1, limit: int = 10):
    courses = request.app.db["coursechapters"]
    # TODO : Get only courses that user is admin/has roles of
    # get all courses from database
    all_coursechapters = courses.find({"course_id": course_id}).sort(
        "name", 1).skip(10 * (page - 1)).limit(limit)

    return [json.loads(json.dumps(coursechapter, default=str)) for coursechapter in await all_coursechapters.to_list(length=100)]


async def get_coursechapters_meta(request: Request, course_id: str, current_user: PublicUser):
    coursechapters = request.app.db["coursechapters"]
    courses = request.app.db["courses"]
    activities = request.app.db["activities"]

    coursechapters = coursechapters.find(
        {"course_id": course_id}).sort("name", 1)

    course = await courses.find_one({"course_id": course_id})
    course = Course(**course)  # type: ignore

    # activities
    coursechapter_activityIds_global = []

    # chapters
    chapters = {}
    for coursechapter in await coursechapters.to_list(length=100):
        coursechapter = CourseChapterInDB(**coursechapter)
        coursechapter_activityIds = []

        for activity in coursechapter.activities:
            coursechapter_activityIds.append(activity)
            coursechapter_activityIds_global.append(activity)

        chapters[coursechapter.coursechapter_id] = {
            "id": coursechapter.coursechapter_id, "name": coursechapter.name,  "activityIds": coursechapter_activityIds
        }

    # activities
    activities_list = {}
    for activity in await activities.find({"activity_id": {"$in": coursechapter_activityIds_global}}).to_list(length=100):
        activity = ActivityInDB(**activity)
        activities_list[activity.activity_id] = {
            "id": activity.activity_id, "name": activity.name, "type": activity.type, "content": activity.content
        }

    final = {
        "chapters": chapters,
        "chapterOrder": course.chapters,
        "activities": activities_list
    }

    return final


async def update_coursechapters_meta(request: Request,course_id: str, coursechapters_metadata: CourseChapterMetaData, current_user: PublicUser):
    coursechapters = request.app.db["coursechapters"]
    courses = request.app.db["courses"]

    # update chapters in course
    courseInDB = await courses.update_one({"course_id": course_id}, {
                                    "$set": {"chapters": coursechapters_metadata.chapterOrder}})

    if coursechapters_metadata.chapters is not None:
        for coursechapter_id, chapter_metadata in coursechapters_metadata.chapters.items():
            filter_query = {"coursechapter_id": coursechapter_id}
            update_query = {"$set": {"activities": chapter_metadata["activityIds"]}}
            result = await coursechapters.update_one(filter_query, update_query)
            if result.matched_count == 0:
                # handle error when no documents are matched by the filter query
                print(f"No documents found for course chapter ID {coursechapter_id}")


    return {"detail": "coursechapters metadata updated"}

#### Security ####################################################


async def verify_rights(request: Request,course_id: str, current_user: PublicUser, action: str):
    courses = request.app.db["courses"]

    course = await courses.find_one({"course_id": course_id})

    if not course:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=f"Course does not exist")

    hasRoleRights = await verify_user_rights_with_roles(request, action, current_user.user_id, course_id, course["org_id"])
    isAuthor = current_user.user_id in course["authors"]

    if not hasRoleRights and not isAuthor:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Roles/Ownership : Insufficient rights to perform this action")

    return True

#### Security ####################################################
