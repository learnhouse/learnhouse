from typing import Literal
from uuid import uuid4
from sqlalchemy import union
from sqlmodel import Session, select
from src.db.usergroup_resources import UserGroupResource
from src.db.usergroup_user import UserGroupUser
from src.db.organizations import Organization
from src.services.trail.trail import get_user_trail_with_orgid
from src.db.resource_authors import ResourceAuthor, ResourceAuthorshipEnum
from src.db.users import PublicUser, AnonymousUser, User, UserRead
from src.db.courses import (
    Course,
    CourseCreate,
    CourseRead,
    CourseUpdate,
    FullCourseReadWithTrail,
)
from src.security.rbac.rbac import (
    authorization_verify_based_on_roles_and_authorship_and_usergroups,
    authorization_verify_if_element_is_public,
    authorization_verify_if_user_is_anon,
)
from src.services.courses.thumbnails import upload_thumbnail
from fastapi import HTTPException, Request, UploadFile
from datetime import datetime


async def get_course(
    request: Request,
    course_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    statement = select(Course).where(Course.course_uuid == course_uuid)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await rbac_check(request, course.course_uuid, current_user, "read", db_session)

    # Get course authors
    authors_statement = (
        select(User)
        .join(ResourceAuthor)
        .where(ResourceAuthor.resource_uuid == course.course_uuid)
    )
    authors = db_session.exec(authors_statement).all()

    # convert from User to UserRead
    authors = [UserRead.model_validate(author) for author in authors]

    course = CourseRead(**course.model_dump(), authors=authors)

    return course


async def get_course_meta(
    request: Request,
    course_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
) -> FullCourseReadWithTrail:
    # Avoid circular import
    from src.services.courses.chapters import get_course_chapters

    course_statement = select(Course).where(Course.course_uuid == course_uuid)
    course = db_session.exec(course_statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await rbac_check(request, course.course_uuid, current_user, "read", db_session)

    # Get course authors
    authors_statement = (
        select(User)
        .join(ResourceAuthor)
        .where(ResourceAuthor.resource_uuid == course.course_uuid)
    )
    authors = db_session.exec(authors_statement).all()

    # convert from User to UserRead
    authors = [UserRead.model_validate(author) for author in authors]

    course = CourseRead(**course.model_dump(), authors=authors)

    # Get course chapters
    chapters = await get_course_chapters(request, course.id, db_session, current_user)

    # Trail
    trail = None

    if isinstance(current_user, AnonymousUser):
        trail = None
    else:
        trail = await get_user_trail_with_orgid(
            request, current_user, course.org_id, db_session
        )

    return FullCourseReadWithTrail(
        **course.model_dump(),
        chapters=chapters,
        trail=trail if trail else None,
    )


async def create_course(
    request: Request,
    org_id: int,
    course_object: CourseCreate,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
    thumbnail_file: UploadFile | None = None,
):
    course = Course.model_validate(course_object)

    # RBAC check
    await rbac_check(request, "course_x", current_user, "create", db_session)

    # Complete course object
    course.org_id = course.org_id

    # Get org uuid
    org_statement = select(Organization).where(Organization.id == org_id)
    org = db_session.exec(org_statement).first()

    course.course_uuid = str(f"course_{uuid4()}")
    course.creation_date = str(datetime.now())
    course.update_date = str(datetime.now())

    # Upload thumbnail
    if thumbnail_file and thumbnail_file.filename:
        name_in_disk = f"{course.course_uuid}_thumbnail_{uuid4()}.{thumbnail_file.filename.split('.')[-1]}"
        await upload_thumbnail(
            thumbnail_file, name_in_disk, org.org_uuid, course.course_uuid  # type: ignore
        )
        course.thumbnail_image = name_in_disk

    else:
        course.thumbnail_image = ""

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

    # Get course authors
    authors_statement = (
        select(User)
        .join(ResourceAuthor)
        .where(ResourceAuthor.resource_uuid == course.course_uuid)
    )
    authors = db_session.exec(authors_statement).all()

    # convert from User to UserRead
    authors = [UserRead.model_validate(author) for author in authors]

    course = CourseRead(**course.model_dump(), authors=authors)

    return CourseRead.model_validate(course)


async def update_course_thumbnail(
    request: Request,
    course_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
    thumbnail_file: UploadFile | None = None,
):
    statement = select(Course).where(Course.course_uuid == course_uuid)
    course = db_session.exec(statement).first()

    name_in_disk = None

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await rbac_check(request, course.course_uuid, current_user, "update", db_session)

    # Get org uuid
    org_statement = select(Organization).where(Organization.id == course.org_id)
    org = db_session.exec(org_statement).first()

    # Upload thumbnail
    if thumbnail_file and thumbnail_file.filename:
        name_in_disk = f"{course_uuid}_thumbnail_{uuid4()}.{thumbnail_file.filename.split('.')[-1]}"
        await upload_thumbnail(
            thumbnail_file, name_in_disk, org.org_uuid, course.course_uuid  # type: ignore
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

    # Get course authors
    authors_statement = (
        select(User)
        .join(ResourceAuthor)
        .where(ResourceAuthor.resource_uuid == course.course_uuid)
    )
    authors = db_session.exec(authors_statement).all()

    # convert from User to UserRead
    authors = [UserRead.model_validate(author) for author in authors]

    course = CourseRead(**course.model_dump(), authors=authors)

    return course


async def update_course(
    request: Request,
    course_object: CourseUpdate,
    course_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    statement = select(Course).where(Course.course_uuid == course_uuid)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await rbac_check(request, course.course_uuid, current_user, "update", db_session)

    # Update only the fields that were passed in
    for var, value in vars(course_object).items():
        if value is not None:
            setattr(course, var, value)

    # Complete the course object
    course.update_date = str(datetime.now())

    db_session.add(course)
    db_session.commit()
    db_session.refresh(course)

    # Get course authors
    authors_statement = (
        select(User)
        .join(ResourceAuthor)
        .where(ResourceAuthor.resource_uuid == course.course_uuid)
    )
    authors = db_session.exec(authors_statement).all()

    # convert from User to UserRead
    authors = [UserRead.model_validate(author) for author in authors]

    course = CourseRead(**course.model_dump(), authors=authors)

    return course


async def delete_course(
    request: Request,
    course_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
):
    statement = select(Course).where(Course.course_uuid == course_uuid)
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

    # Query for public courses
    statement_public = (
        select(Course)
        .join(Organization)
        .where(Organization.slug == org_slug, Course.public == True)
    )

    # Query for courses where the current user is an author
    statement_author = (
        select(Course)
        .join(Organization)
        .join(ResourceAuthor, ResourceAuthor.user_id == current_user.id)
        .where(
            Organization.slug == org_slug,
            ResourceAuthor.resource_uuid == Course.course_uuid,
        )
    )

    # Query for courses where the current user is in a user group that has access to the course
    statement_usergroup = (
        select(Course)
        .join(Organization)
        .join(UserGroupResource, UserGroupResource.resource_uuid == Course.course_uuid)
        .join(
            UserGroupUser, UserGroupUser.usergroup_id == UserGroupResource.usergroup_id
        )
        .where(Organization.slug == org_slug, UserGroupUser.user_id == current_user.id)
    )

    # Combine the results
    statement_complete = union(
        statement_public, statement_author, statement_usergroup
    ).subquery()

    # TODO: migrate this to exec 
    courses = db_session.execute(select(statement_complete)).all()

    # TODO: I have no idea why this is necessary, but it is
    courses = [CourseRead(**course._asdict(), authors=[]) for course in courses]


    # for every course, get the authors
    for course in courses:
        authors_statement = (
            select(User)
            .join(ResourceAuthor)
            .where(ResourceAuthor.resource_uuid == course.course_uuid)
        )
        authors = db_session.exec(authors_statement).all()

        # convert from User to UserRead
        authors = [UserRead.model_validate(author) for author in authors]

        course.authors = authors

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
            res = await authorization_verify_if_element_is_public(
                request, course_uuid, action, db_session
            )
            return res
        else:
            res = (
                await authorization_verify_based_on_roles_and_authorship_and_usergroups(
                    request, current_user.id, action, course_uuid, db_session
                )
            )
            return res
    else:
        await authorization_verify_if_user_is_anon(current_user.id)

        await authorization_verify_based_on_roles_and_authorship_and_usergroups(
            request,
            current_user.id,
            action,
            course_uuid,
            db_session,
        )


## 🔒 RBAC Utils ##
