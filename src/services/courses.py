import json
from typing import List
from uuid import uuid4
from pydantic import BaseModel
from src.services.users import User
from ..services.database import create_config_collection, check_database, create_database, learnhouseDB, learnhouseDB
from ..services.security import *
from fastapi import FastAPI, HTTPException, status, Request, Response, BackgroundTasks
from datetime import datetime

#### Classes ####################################################


class Course(BaseModel):
    name: str
    mini_description: str
    description: str
    photo: str
    cover_photo: str
    public: bool
    chapters: List[str]


class CourseInDB(Course):
    course_id: str
    creationDate: str
    updateDate: str
    authors: List[str]

#### Classes ####################################################


async def get_course(course_id: str, current_user: User):
    await check_database()
    courses = learnhouseDB["courses"]

    course = courses.find_one({"course_id": course_id})

    # verify course rights
    await verify_rights(course_id, current_user, "read")

    if not course:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Course does not exist")

    course = Course(**course)
    return course


async def create_course(course_object: Course, current_user: User):
    await check_database()
    courses = learnhouseDB["courses"]

    

    # generate course_id with uuid4
    course_id = str(f"course_{uuid4()}")

    hasRoleRights = await verify_user_rights_with_roles("create", current_user.username, course_id)

    if not hasRoleRights:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Roles : Insufficient rights to perform this action")

    course = CourseInDB(course_id=course_id, authors=[
                      current_user.username], creationDate= str(datetime.now()), updateDate= str(datetime.now()), **course_object.dict())

    course_in_db = courses.insert_one(course.dict())

    if not course_in_db:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Unavailable database")

    return course.dict()


async def update_course(course_object: Course, course_id: str, current_user: User):
    await check_database()

    # verify course rights
    await verify_rights(course_id, current_user, "update")

    courses = learnhouseDB["courses"]

    course = courses.find_one({"course_id": course_id})

    creationDate = course["creationDate"]
    authors = course["authors"]
    
    # get today's date
    datetime_object = datetime.now()

    if not course:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Course does not exist")

    updated_course = CourseInDB(
        course_id=course_id, creationDate=creationDate, authors=authors, updateDate=str(datetime_object), **course_object.dict())

    courses.update_one({"course_id": course_id}, {"$set": updated_course.dict()})

    return CourseInDB(**updated_course.dict())


async def delete_course(course_id: str, current_user: User):
    await check_database()

    # verify course rights
    await verify_rights(course_id, current_user, "delete")

    courses = learnhouseDB["courses"]

    course = courses.find_one({"course_id": course_id})

    if not course:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Course does not exist")

    isDeleted = courses.delete_one({"course_id": course_id})

    if isDeleted:
        return {"detail": "Course deleted"}
    else:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Unavailable database")


async def get_courses(page: int = 1, limit: int = 10):
    await check_database()
    courses = learnhouseDB["courses"]
    # TODO : Get only courses that user is admin/has roles of
    # get all courses from database
    all_courses = courses.find().sort("name", 1).skip(10 * (page - 1)).limit(limit)

    return [json.loads(json.dumps(course, default=str)) for course in all_courses]


#### Security ####################################################

async def verify_rights(course_id: str, current_user: User, action: str):
    await check_database()
    courses = learnhouseDB["courses"]

    course = courses.find_one({"course_id": course_id})

    if not course:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Course does not exist")

    hasRoleRights = await verify_user_rights_with_roles(action, current_user.username, course_id)
    isAuthor = current_user.username in course["authors"]

    if not hasRoleRights and not isAuthor:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Roles/Ownership : Insufficient rights to perform this action")

    return True

#### Security ####################################################
