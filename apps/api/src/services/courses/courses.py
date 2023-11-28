from calendar import c
import json
from queue import Full
import resource
from typing import Literal
from uuid import uuid4
from sqlmodel import Session, select
from src.db import chapters
from src.db.activities import Activity, ActivityRead
from src.db.chapter_activities import ChapterActivity
from src.db.chapters import Chapter, ChapterRead
from src.db.organizations import Organization
from src.db.trails import TrailRead

from src.services.trail.trail import get_user_trail_with_orgid
from src import db
from src.db.resource_authors import ResourceAuthor, ResourceAuthorshipEnum
from src.db.users import PublicUser, AnonymousUser
from src.db.courses import (
    Course,
    CourseCreate,
    CourseRead,
    CourseUpdate,
    FullCourseReadWithTrail,
)
from src.security.rbac.rbac import (
    authorization_verify_based_on_roles_and_authorship,
    authorization_verify_if_element_is_public,
    authorization_verify_if_user_is_anon,
)
from src.services.courses.thumbnails import upload_thumbnail
from fastapi import HTTPException, Request, status, UploadFile
from datetime import datetime


async def get_course(
    request: Request,
    course_id: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    statement = select(Course).where(Course.id == course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await rbac_check(request, course.course_uuid, current_user, "read", db_session)

    return course


async def get_course_meta(
    request: Request,
    course_id: int,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
) -> FullCourseReadWithTrail:
    # Avoid circular import
    from src.services.courses.chapters import get_course_chapters

    course_statement = select(Course).where(Course.id == course_id)
    course = db_session.exec(course_statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await rbac_check(request, course.course_uuid, current_user, "read", db_session)

    course = CourseRead.from_orm(course)

    # Get course chapters
    chapters = await get_course_chapters(request, course.id, db_session, current_user)

    # Trail
    trail = await get_user_trail_with_orgid(
        request, current_user, course.org_id, db_session
    )

    trail = TrailRead.from_orm(trail)

    return FullCourseReadWithTrail(
        **course.dict(),
        chapters=chapters,
        trail=trail,
    )


async def create_course(
    request: Request,
    course_object: CourseCreate,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
    thumbnail_file: UploadFile | None = None,
):
    course = Course.from_orm(course_object)

    # RBAC check
    await rbac_check(request, "course_x", current_user, "create", db_session)

    # Complete course object
    course.org_id = course.org_id
    course.course_uuid = str(f"course_{uuid4()}")
    course.creation_date = str(datetime.now())
    course.update_date = str(datetime.now())

    # Upload thumbnail
    if thumbnail_file and thumbnail_file.filename:
        name_in_disk = f"{course.course_uuid}_thumbnail_{uuid4()}.{thumbnail_file.filename.split('.')[-1]}"
        await upload_thumbnail(
            thumbnail_file, name_in_disk, course_object.org_id, course.course_uuid
        )
        course_object.thumbnail = name_in_disk

    # Insert course
    db_session.add(course)
    db_session.commit()
    db_session.refresh(course)

    # Make the user the creator of the course
    resource_author = ResourceAuthor(
        resource_uuid=course.course_uuid,
        user_id=current_user.id,
        authorship=ResourceAuthorshipEnum.CREATOR,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )

    # Insert course author
    db_session.add(resource_author)
    db_session.commit()
    db_session.refresh(resource_author)

    return CourseRead.from_orm(course)


async def update_course_thumbnail(
    request: Request,
    course_id: str,
    current_user: PublicUser | AnonymousUser,
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

    # RBAC check
    await rbac_check(request, course.course_uuid, current_user, "update", db_session)

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
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    statement = select(Course).where(Course.id == course_object.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await rbac_check(request, course.course_uuid, current_user, "update", db_session)

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
    request: Request,
    course_id: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    statement = select(Course).where(Course.id == course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await rbac_check(request, course.course_uuid, current_user, "delete", db_session)

    db_session.delete(course)
    db_session.commit()

    return {"detail": "Course deleted"}


async def get_courses_orgslug(
    request: Request,
    current_user: PublicUser | AnonymousUser,
    org_slug: str,
    db_session: Session,
    page: int = 1,
    limit: int = 10,
):
    statement_public = (
        select(Course)
        .join(Organization)
        .where(Organization.slug == org_slug, Course.public == True)
    )
    statement_all = (
        select(Course).join(Organization).where(Organization.slug == org_slug)
    )

    if current_user.id == 0:
        statement = statement_public
    else:
        # RBAC check
        await authorization_verify_if_user_is_anon(current_user.id)

        statement = statement_all

    courses = db_session.exec(statement)

    return courses


## 🔒 RBAC Utils ##


async def rbac_check(
    request: Request,
    course_uuid: str,
    current_user: PublicUser | AnonymousUser,
    action: Literal["create", "read", "update", "delete"],
    db_session: Session,
):
    if action == "read":
        if current_user.id == 0:  # Anonymous user
            await authorization_verify_if_element_is_public(
                request, course_uuid, action, db_session
            )
        else:
            await authorization_verify_based_on_roles_and_authorship(
                request, current_user.id, action, course_uuid, db_session
            )
    else:
        await authorization_verify_if_user_is_anon(current_user.id)

        await authorization_verify_based_on_roles_and_authorship(
            request,
            current_user.id,
            action,
            course_uuid,
            db_session,
        )


## 🔒 RBAC Utils ##
