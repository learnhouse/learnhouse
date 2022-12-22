from datetime import datetime
import json
from typing import List
from uuid import uuid4
from pydantic import BaseModel
from src.services.courses.courses import Course, CourseInDB
from src.services.courses.elements.elements import Element, ElementInDB
from src.services.database import create_config_collection, check_database, create_database, learnhouseDB, learnhouseDB
from src.services.security import verify_user_rights_with_roles
from src.services.users import PublicUser
from fastapi import FastAPI, HTTPException, status, Request, Response, BackgroundTasks, UploadFile, File



class CourseChapter(BaseModel):
    name: str
    description: str
    elements: list


class CourseChapterInDB(CourseChapter):
    coursechapter_id: str
    course_id: str
    creationDate: str
    updateDate: str


# Frontend
class CourseChapterMetaData(BaseModel):
    chapterOrder: List[str]
    chapters: object
    elements: object

#### Classes ####################################################

####################################################
# CRUD
####################################################


async def create_coursechapter(coursechapter_object: CourseChapter, course_id: str, current_user: PublicUser):
    await check_database()
    coursechapters = learnhouseDB["coursechapters"]
    courses = learnhouseDB["courses"]

    # generate coursechapter_id with uuid4
    coursechapter_id = str(f"coursechapter_{uuid4()}")

    hasRoleRights = await verify_user_rights_with_roles("create", current_user.user_id, coursechapter_id)

    if not hasRoleRights:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Roles : Insufficient rights to perform this action")

    coursechapter = CourseChapterInDB(coursechapter_id=coursechapter_id, creationDate=str(
        datetime.now()), updateDate=str(datetime.now()), course_id=course_id, **coursechapter_object.dict())

    coursechapter_in_db = coursechapters.insert_one(coursechapter.dict())
    courses.update_one({"course_id": course_id}, {
                       "$addToSet": {"chapters": coursechapter_id}})

    if not coursechapter_in_db:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Unavailable database")

    return coursechapter.dict()


async def get_coursechapter(coursechapter_id: str, current_user: PublicUser):
    await check_database()
    coursechapters = learnhouseDB["coursechapters"]

    coursechapter = coursechapters.find_one(
        {"coursechapter_id": coursechapter_id})

    if coursechapter:
        # verify course rights
        await verify_rights(coursechapter["course_id"], current_user, "read")
        coursechapter = CourseChapter(**coursechapter)

        return coursechapter

    else:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="CourseChapter does not exist")


async def update_coursechapter(coursechapter_object: CourseChapter,  coursechapter_id: str, current_user: PublicUser):
    await check_database()
    coursechapters = learnhouseDB["coursechapters"]

    coursechapter = coursechapters.find_one(
        {"coursechapter_id": coursechapter_id})

    if coursechapter:
        # verify course rights
        await verify_rights(coursechapter["course_id"], current_user, "update")
        creationDate = coursechapter["creationDate"]

        # get today's date
        datetime_object = datetime.now()

        updated_coursechapter = CourseChapterInDB(
            coursechapter_id=coursechapter_id, creationDate=creationDate, course_id=coursechapter["course_id"], updateDate=str(datetime_object), **coursechapter_object.dict())

        coursechapters.update_one({"coursechapter_id": coursechapter_id}, {
            "$set": updated_coursechapter.dict()})

        return CourseChapterInDB(**updated_coursechapter.dict())

    else:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Coursechapter does not exist")


async def delete_coursechapter(coursechapter_id: str,  current_user: PublicUser):
    await check_database()

    coursechapters = learnhouseDB["coursechapters"]
    courses = learnhouseDB["courses"]

    coursechapter = coursechapters.find_one(
        {"coursechapter_id": coursechapter_id})

    if coursechapter:
        # verify course rights
        await verify_rights(coursechapter["course_id"], current_user, "delete")

        isDeleted = coursechapters.delete_one(
            {"coursechapter_id": coursechapter_id})

        # Remove coursechapter from course
        courses.update_one({"course_id": coursechapter["course_id"]}, {
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


async def get_coursechapters(course_id: str, page: int = 1, limit: int = 10):
    await check_database()
    courses = learnhouseDB["coursechapters"]
    # TODO : Get only courses that user is admin/has roles of
    # get all courses from database
    all_coursechapters = courses.find({"course_id": course_id}).sort(
        "name", 1).skip(10 * (page - 1)).limit(limit)

    return [json.loads(json.dumps(coursechapter, default=str)) for coursechapter in all_coursechapters]


async def get_coursechapters_meta(course_id: str, current_user: PublicUser):
    await check_database()
    coursechapters = learnhouseDB["coursechapters"]
    courses = learnhouseDB["courses"]
    elements = learnhouseDB["elements"]

    coursechapters = coursechapters.find(
        {"course_id": course_id}).sort("name", 1)

    course = courses.find_one({"course_id": course_id})
    course = Course(**course)  # type: ignore

    # elements
    coursechapter_elementIds_global = []

    # chapters
    chapters = {}
    for coursechapter in coursechapters:
        coursechapter = CourseChapterInDB(**coursechapter)
        coursechapter_elementIds = []

        for element in coursechapter.elements:
            coursechapter_elementIds.append(element)
            coursechapter_elementIds_global.append(element)

        chapters[coursechapter.coursechapter_id] = {
            "id": coursechapter.coursechapter_id, "name": coursechapter.name,  "elementIds": coursechapter_elementIds
        }
    
    # elements 
    elements_list = {}
    for element in elements.find({"element_id": {"$in": coursechapter_elementIds_global}}):
        element = ElementInDB(**element)
        elements_list[element.element_id] = {
            "id": element.element_id, "name": element.name, "type": element.type , "content": element.content
        }
    


    final = {
        "chapters": chapters,
        "chapterOrder": course.chapters,
        "elements" : elements_list
    }

    return final


async def update_coursechapters_meta(course_id: str, coursechapters_metadata: CourseChapterMetaData, current_user: PublicUser):
    await check_database()
    coursechapters = learnhouseDB["coursechapters"]
    courses = learnhouseDB["courses"]

    # update chapters in course
    courseInDB = courses.update_one({"course_id": course_id}, {
                                    "$set": {"chapters": coursechapters_metadata.chapterOrder}})


    # update elements in coursechapters
    # TODO : performance/optimization improvement
    for coursechapter in coursechapters_metadata.chapters:
        coursechapters.update_one({"coursechapter_id": coursechapter}, {
            "$set": {"elements": coursechapters_metadata.chapters[coursechapter]["elementIds"]}})
    
    

    return {"ok"}

#### Security ####################################################


async def verify_rights(course_id: str, current_user: PublicUser, action: str):
    await check_database()
    courses = learnhouseDB["courses"]

    course = courses.find_one({"course_id": course_id})

    if not course:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=f"Course does not exist")

    hasRoleRights = await verify_user_rights_with_roles(action, current_user.user_id, course_id)
    isAuthor = current_user.user_id in course["authors"]

    if not hasRoleRights and not isAuthor:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Roles/Ownership : Insufficient rights to perform this action")

    return True

#### Security ####################################################
