import json
from typing import List, Literal, Optional
from uuid import uuid4
from pydantic import BaseModel
from sqlmodel import Session, select
from src.db.course_authors import CourseAuthor, CourseAuthorshipEnum
from src.db.users import PublicUser, AnonymousUser
from src.db.courses import Course, CourseCreate, CourseRead, CourseUpdate
from src.security.rbac.rbac import (
    authorization_verify_based_on_roles,
    authorization_verify_based_on_roles_and_authorship,
    authorization_verify_if_element_is_public,
    authorization_verify_if_user_is_anon,
)
from src.services.courses.activities.activities import ActivityInDB
from src.services.courses.thumbnails import upload_thumbnail
from fastapi import HTTPException, Request, status, UploadFile
from datetime import datetime


async def get_course(
    request: Request, course_id: str, current_user: PublicUser, db_session: Session
):
    statement = select(Course).where(Course.id == course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    return course


async def get_course_meta(
    request: Request, course_id: str, current_user: PublicUser, db_session: Session
):
    course_statement = select(Course).where(Course.id == course_id)
    course = db_session.exec(course_statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # todo : get course chapters
    # todo : get course activities
    # todo : get trail

    return course


async def create_course(
    request: Request,
    course_object: CourseCreate,
    org_id: int,
    current_user: PublicUser,
    db_session: Session,
    thumbnail_file: UploadFile | None = None,
):
    course = Course.from_orm(course_object)

    # Complete course object
    course.org_id = org_id
    course.course_uuid = str(uuid4())
    course.creation_date = str(datetime.now())
    course.update_date = str(datetime.now())

    # Upload thumbnail
    if thumbnail_file and thumbnail_file.filename:
        name_in_disk = f"{course.course_uuid}_thumbnail_{uuid4()}.{thumbnail_file.filename.split('.')[-1]}"
        await upload_thumbnail(thumbnail_file, name_in_disk, org_id, course.course_uuid)
        course_object.thumbnail = name_in_disk

    # Insert course
    db_session.add(course)
    db_session.commit()
    db_session.refresh(course)

    # Make the user the creator of the course
    course_author = CourseAuthor(
        course_id=course.id is not None,
        user_id=current_user.id,
        authorship=CourseAuthorshipEnum.CREATOR,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )

    # Insert course author
    db_session.add(course_author)
    db_session.commit()
    db_session.refresh(course_author)

    return CourseRead.from_orm(course)


async def update_course_thumbnail(
    request: Request,
    course_id: str,
    current_user: PublicUser,
    db_session: Session,
    thumbnail_file: UploadFile | None = None,
):
    statement = select(Course).where(Course.id == course_id)
    course = db_session.exec(statement).first()

    name_in_disk = None

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # Upload thumbnail
    if thumbnail_file and thumbnail_file.filename:
        name_in_disk = (
            f"{course_id}_thumbnail_{uuid4()}.{thumbnail_file.filename.split('.')[-1]}"
        )
        await upload_thumbnail(
            thumbnail_file, name_in_disk, course.org_id, course.course_uuid
        )

    # Update course
    if name_in_disk:
        course.thumbnail_image = name_in_disk
    else:
        raise HTTPException(
            status_code=500,
            detail="Issue with thumbnail upload",
        )

    # Complete the course object
    course.update_date = str(datetime.now())

    db_session.add(course)
    db_session.commit()
    db_session.refresh(course)

    return course


async def update_course(
    request: Request,
    course_object: CourseUpdate,
    current_user: PublicUser,
    db_session: Session,
):
    statement = select(Course).where(Course.id == course_object.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )
    
    del course_object.course_id

    # Update only the fields that were passed in
    for var, value in vars(course_object).items():
        if value is not None:
            setattr(course, var, value)

    # Complete the course object
    course.update_date = str(datetime.now())

    db_session.add(course)
    db_session.commit()
    db_session.refresh(course)

    return course


async def delete_course(
    request: Request, course_id: str, current_user: PublicUser, db_session: Session
):
    statement = select(Course).where(Course.id == course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    db_session.delete(course)
    db_session.commit()

    return {"detail": "Course deleted"}


####################################################
# Misc
####################################################


async def get_courses_orgslug(
    request: Request,
    current_user: PublicUser,
    page: int = 1,
    limit: int = 10,
    org_slug: str | None = None,
):
    courses = request.app.db["courses"]
    orgs = request.app.db["organizations"]

    # get org_id from slug
    org = await orgs.find_one({"slug": org_slug})

    if not org:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Organization does not exist"
        )

    # show only public courses if user is not logged in
    if current_user.id == "anonymous":
        all_courses = (
            courses.find({"org_id": org["org_id"], "public": True})
            .sort("name", 1)
            .skip(10 * (page - 1))
            .limit(limit)
        )
    else:
        all_courses = (
            courses.find({"org_id": org["org_id"]})
            .sort("name", 1)
            .skip(10 * (page - 1))
            .limit(limit)
        )

    return [
        json.loads(json.dumps(course, default=str))
        for course in await all_courses.to_list(length=100)
    ]


#### Security ####################################################


async def verify_rights(
    request: Request,
    course_id: str,
    current_user: PublicUser | AnonymousUser,
    action: Literal["create", "read", "update", "delete"],
):
    if action == "read":
        if current_user.id == "anonymous":
            await authorization_verify_if_element_is_public(
                request, course_id, str(current_user.id), action
            )
        else:
            users = request.app.db["users"]
            user = await users.find_one({"user_id": str(current_user.id)})

            await authorization_verify_based_on_roles_and_authorship(
                request,
                str(current_user.id),
                action,
                user["roles"],
                course_id,
            )
    else:
        users = request.app.db["users"]
        user = await users.find_one({"user_id": str(current_user.id)})

        await authorization_verify_if_user_is_anon(str(current_user.id))

        await authorization_verify_based_on_roles_and_authorship(
            request,
            str(current_user.id),
            action,
            user["roles"],
            course_id,
        )


#### Security ####################################################
