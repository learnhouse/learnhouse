from datetime import datetime
import json
import pprint
from typing import List
from uuid import uuid4
from pydantic import BaseModel
from src.security.auth import non_public_endpoint
from src.services.courses.courses import Course, CourseInDB
from src.services.courses.activities.activities import Activity, ActivityInDB
from src.security.security import verify_user_rights_with_roles
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


async def create_coursechapter(request: Request, coursechapter_object: CourseChapter, course_id: str, current_user: PublicUser):
    courses = request.app.db["courses"]
    print(course_id)
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

    courses.update_one({"course_id": course_id}, {
                       "$addToSet": {"chapters": coursechapter_id, "chapters_content": coursechapter.dict()}})

    return coursechapter.dict()


async def get_coursechapter(request: Request, coursechapter_id: str, current_user: PublicUser):
    courses = request.app.db["courses"]

    coursechapter = await courses.find_one(
        {"chapters_content.coursechapter_id": coursechapter_id})

    if coursechapter:
        # verify course rights
        await verify_rights(request, coursechapter["course_id"], current_user, "read")
        coursechapter = CourseChapter(**coursechapter)

        return coursechapter

    else:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="CourseChapter does not exist")


async def update_coursechapter(request: Request, coursechapter_object: CourseChapter,  coursechapter_id: str, current_user: PublicUser):
    courses = request.app.db["courses"]

    coursechapter = await courses.find_one(
        {"chapters_content.coursechapter_id": coursechapter_id})

    if coursechapter:

        # verify course rights
        await verify_rights(request, coursechapter["course_id"], current_user, "update")

        coursechapter = CourseChapterInDB(coursechapter_id=coursechapter_id, creationDate=str(
            datetime.now()), updateDate=str(datetime.now()), course_id=coursechapter["course_id"], **coursechapter_object.dict())

        courses.update_one({"chapters_content.coursechapter_id": coursechapter_id}, {
            "$set": {"chapters_content.$": coursechapter.dict()}})

        return coursechapter

    else:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Coursechapter does not exist")


async def delete_coursechapter(request: Request, coursechapter_id: str,  current_user: PublicUser):
    courses = request.app.db["courses"]

    course = await courses.find_one(
        {"chapters_content.coursechapter_id": coursechapter_id})

    if course:
        # verify course rights
        await verify_rights(request, course["course_id"], current_user, "delete")

        # Remove coursechapter from course
        res = await courses.update_one({"course_id": course["course_id"]}, {
            "$pull": {"chapters": coursechapter_id}})

        await courses.update_one({"chapters_content.coursechapter_id": coursechapter_id}, {
            "$pull": {"chapters_content": {"coursechapter_id": coursechapter_id}}})
        
        

        return {"message": "Coursechapter deleted"}

    else:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Course does not exist")

####################################################
# Misc
####################################################


async def get_coursechapters(request: Request, course_id: str, page: int = 1, limit: int = 10):
    courses = request.app.db["courses"]

    course = await courses.find_one({"course_id": course_id})

    if course:
        course = Course(**course)
        coursechapters = course.chapters_content

        return coursechapters


async def get_coursechapters_meta(request: Request, course_id: str, current_user: PublicUser):
    courses = request.app.db["courses"]
    activities = request.app.db["activities"]

    await non_public_endpoint(current_user)

    coursechapters = await courses.find_one({"course_id": course_id}, {"chapters": 1, "chapters_content": 1, "_id": 0})

    coursechapters = coursechapters

    if not coursechapters:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Course does not exist")

    # activities
    coursechapter_activityIds_global = []

    # chapters
    chapters = {}
    if coursechapters["chapters_content"]:
        for coursechapter in coursechapters["chapters_content"]:

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
        "chapterOrder": coursechapters["chapters"],
        "activities": activities_list
    }

    return final


async def update_coursechapters_meta(request: Request, course_id: str, coursechapters_metadata: CourseChapterMetaData, current_user: PublicUser):
    courses = request.app.db["courses"]

    # update chapters in course
    courseInDB = await courses.update_one({"course_id": course_id}, {
        "$set": {"chapters": coursechapters_metadata.chapterOrder}})

    if coursechapters_metadata.chapters is not None:
        for coursechapter_id, chapter_metadata in coursechapters_metadata.chapters.items():
            filter_query = {
                "chapters_content.coursechapter_id": coursechapter_id}
            update_query = {
                "$set": {
                    "chapters_content.$.activities": chapter_metadata["activityIds"]
                }
            }
            result = await courses.update_one(filter_query, update_query)
            if result.matched_count == 0:
                # handle error when no documents are matched by the filter query
                print(
                    f"No documents found for course chapter ID {coursechapter_id}")

    return {"detail": "coursechapters metadata updated"}

#### Security ####################################################


async def verify_rights(request: Request, course_id: str, current_user: PublicUser, action: str):
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
