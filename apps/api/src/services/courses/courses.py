from typing import Literal, List
from uuid import uuid4
from sqlmodel import Session, select, or_, and_, text
from src.db.usergroup_resources import UserGroupResource
from src.db.usergroup_user import UserGroupUser
from src.db.organizations import Organization
from src.security.features_utils.usage import (
    check_limits_with_usage,
    decrease_feature_usage,
    increase_feature_usage,
)
from src.services.trail.trail import get_user_trail_with_orgid
from src.db.resource_authors import ResourceAuthor, ResourceAuthorshipEnum, ResourceAuthorshipStatusEnum
from src.db.users import PublicUser, AnonymousUser, User, UserRead
from src.db.courses.courses import (
    Course,
    CourseCreate,
    CourseRead,
    CourseUpdate,
    FullCourseReadWithTrail,
    AuthorWithRole,
)
from src.security.rbac.rbac import (
    authorization_verify_based_on_roles_and_authorship,
    authorization_verify_if_element_is_public,
    authorization_verify_if_user_is_anon,
)
from src.services.courses.thumbnails import upload_thumbnail
from fastapi import HTTPException, Request, UploadFile
from datetime import datetime
import asyncio


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

    # Get course authors with their roles
    authors_statement = (
        select(ResourceAuthor, User)
        .join(User, ResourceAuthor.user_id == User.id)
        .where(ResourceAuthor.resource_uuid == course.course_uuid)
        .order_by(
            ResourceAuthor.id.asc()
        )
    )
    author_results = db_session.exec(authors_statement).all()

    # Convert to AuthorWithRole objects
    authors = [
        AuthorWithRole(
            user=UserRead.model_validate(user),
            authorship=resource_author.authorship,
            authorship_status=resource_author.authorship_status,
            creation_date=resource_author.creation_date,
            update_date=resource_author.update_date
        )
        for resource_author, user in author_results
    ]

    course = CourseRead(**course.model_dump(), authors=authors)

    return course


async def get_course_by_id(
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

    # Get course authors with their roles
    authors_statement = (
        select(ResourceAuthor, User)
        .join(User, ResourceAuthor.user_id == User.id)
        .where(ResourceAuthor.resource_uuid == course.course_uuid)
        .order_by(
            ResourceAuthor.id.asc()
        )
    )
    author_results = db_session.exec(authors_statement).all()

    # Convert to AuthorWithRole objects
    authors = [
        AuthorWithRole(
            user=UserRead.model_validate(user),
            authorship=resource_author.authorship,
            authorship_status=resource_author.authorship_status,
            creation_date=resource_author.creation_date,
            update_date=resource_author.update_date
        )
        for resource_author, user in author_results
    ]

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

    # Get course with a single query
    course_statement = select(Course).where(Course.course_uuid == course_uuid)
    course = db_session.exec(course_statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check
    await rbac_check(request, course.course_uuid, current_user, "read", db_session)

    # Start async tasks concurrently
    tasks = []
    
    # Task 1: Get course authors with their roles
    async def get_authors():
        authors_statement = (
            select(ResourceAuthor, User)
            .join(User, ResourceAuthor.user_id == User.id)  # type: ignore  
            .where(ResourceAuthor.resource_uuid == course.course_uuid)
            .order_by(
                ResourceAuthor.id.asc()  # type: ignore
            )
        )
        return db_session.exec(authors_statement).all()
    
    # Task 2: Get course chapters
    async def get_chapters():
        # Ensure course.id is not None
        if course.id is None:
            return []
        return await get_course_chapters(request, course.id, db_session, current_user)
    
    # Task 3: Get user trail (only for authenticated users)
    async def get_trail():
        if isinstance(current_user, AnonymousUser):
            return None
        return await get_user_trail_with_orgid(
            request, current_user, course.org_id, db_session
        )
    
    # Add tasks to the list
    tasks.append(get_authors())
    tasks.append(get_chapters())
    tasks.append(get_trail())
    
    # Run all tasks concurrently
    author_results, chapters, trail = await asyncio.gather(*tasks)
    
    # Convert to AuthorWithRole objects
    authors = [
        AuthorWithRole(
            user=UserRead.model_validate(user),
            authorship=resource_author.authorship,
            authorship_status=resource_author.authorship_status,
            creation_date=resource_author.creation_date,
            update_date=resource_author.update_date
        )
        for resource_author, user in author_results
    ]
    
    # Create course read model
    course_read = CourseRead(**course.model_dump(), authors=authors)
    
    return FullCourseReadWithTrail(
        **course_read.model_dump(),
        chapters=chapters,
        trail=trail,
    )


async def get_courses_orgslug(
    request: Request,
    current_user: PublicUser | AnonymousUser,
    org_slug: str,
    db_session: Session,
    page: int = 1,
    limit: int = 10,
) -> List[CourseRead]:
    offset = (page - 1) * limit

    # Base query
    query = (
        select(Course)
        .join(Organization)
        .where(Organization.slug == org_slug)
    )

    if isinstance(current_user, AnonymousUser):
        # For anonymous users, only show public courses
        query = query.where(Course.public == True)
    else:
        # For authenticated users, show:
        # 1. Public courses
        # 2. Courses not in any UserGroup
        # 3. Courses in UserGroups where the user is a member
        # 4. Courses where the user is a resource author
        query = (
            query
            .outerjoin(UserGroupResource, UserGroupResource.resource_uuid == Course.course_uuid)  # type: ignore
            .outerjoin(UserGroupUser, and_(
                UserGroupUser.usergroup_id == UserGroupResource.usergroup_id,
                UserGroupUser.user_id == current_user.id
            ))
            .outerjoin(ResourceAuthor, ResourceAuthor.resource_uuid == Course.course_uuid)  # type: ignore
            .where(or_(
                Course.public == True,
                UserGroupResource.resource_uuid == None,  # Courses not in any UserGroup # noqa: E711
                UserGroupUser.user_id == current_user.id,  # Courses in UserGroups where user is a member
                ResourceAuthor.user_id == current_user.id  # Courses where user is a resource author
            ))
        )

    # Apply pagination
    query = query.offset(offset).limit(limit).distinct()

    courses = db_session.exec(query).all()
    
    if not courses:
        return []
        
    # Get all course UUIDs
    course_uuids = [course.course_uuid for course in courses]
    
    # Fetch all authors for all courses in a single query
    authors_query = (
        select(ResourceAuthor, User)
        .join(User, ResourceAuthor.user_id == User.id)  # type: ignore
        .where(ResourceAuthor.resource_uuid.in_(course_uuids))  # type: ignore
        .order_by(
            ResourceAuthor.id.asc()
        )
    )
    
    author_results = db_session.exec(authors_query).all()
    
    # Create a dictionary mapping course_uuid to list of authors
    course_authors = {}
    for resource_author, user in author_results:
        if resource_author.resource_uuid not in course_authors:
            course_authors[resource_author.resource_uuid] = []
        course_authors[resource_author.resource_uuid].append(
            AuthorWithRole(
                user=UserRead.model_validate(user),
                authorship=resource_author.authorship,
                authorship_status=resource_author.authorship_status,
                creation_date=resource_author.creation_date,
                update_date=resource_author.update_date
            )
        )
    
    # Create CourseRead objects with authors
    course_reads = []
    for course in courses:
        course_read = CourseRead(
            **course.model_dump(),
            authors=course_authors.get(course.course_uuid, [])
        )
        course_reads.append(course_read)

    return course_reads


async def search_courses(
    request: Request,
    current_user: PublicUser | AnonymousUser,
    org_slug: str,
    search_query: str,
    db_session: Session,
    page: int = 1,
    limit: int = 10,
) -> List[CourseRead]:
    offset = (page - 1) * limit

    # Base query
    query = (
        select(Course)
        .join(Organization)
        .where(Organization.slug == org_slug)
        .where(
            or_(
                text(f"LOWER(course.name) LIKE LOWER('%{search_query}%')"),
                text(f"LOWER(course.description) LIKE LOWER('%{search_query}%')"),
                text(f"LOWER(course.about) LIKE LOWER('%{search_query}%')"),
                text(f"LOWER(course.learnings) LIKE LOWER('%{search_query}%')"),
                text(f"LOWER(course.tags) LIKE LOWER('%{search_query}%')")
            )
        )
    )

    if isinstance(current_user, AnonymousUser):
        # For anonymous users, only show public courses
        query = query.where(Course.public == True)
    else:
        # For authenticated users, show:
        # 1. Public courses
        # 2. Courses not in any UserGroup
        # 3. Courses in UserGroups where the user is a member
        # 4. Courses where the user is a resource author
        query = (
            query
            .outerjoin(UserGroupResource, UserGroupResource.resource_uuid == Course.course_uuid)  # type: ignore
            .outerjoin(UserGroupUser, and_(
                UserGroupUser.usergroup_id == UserGroupResource.usergroup_id,
                UserGroupUser.user_id == current_user.id
            ))
            .outerjoin(ResourceAuthor, ResourceAuthor.resource_uuid == Course.course_uuid)  # type: ignore
            .where(or_(
                Course.public == True,
                UserGroupResource.resource_uuid == None,  # Courses not in any UserGroup # noqa: E711
                UserGroupUser.user_id == current_user.id,  # Courses in UserGroups where user is a member
                ResourceAuthor.user_id == current_user.id  # Courses where user is a resource author
            ))
        )

    # Apply pagination
    query = query.offset(offset).limit(limit).distinct()

    courses = db_session.exec(query).all()

    # Fetch authors for each course
    course_reads = []
    for course in courses:
        # Get course authors with their roles
        authors_statement = (
            select(ResourceAuthor, User)
            .join(User, ResourceAuthor.user_id == User.id)
            .where(ResourceAuthor.resource_uuid == course.course_uuid)
            .order_by(
                ResourceAuthor.id.asc()
            )
        )
        author_results = db_session.exec(authors_statement).all()

        # Convert to AuthorWithRole objects
        authors = [
            AuthorWithRole(
                user=UserRead.model_validate(user),
                authorship=resource_author.authorship,
                authorship_status=resource_author.authorship_status,
                creation_date=resource_author.creation_date,
                update_date=resource_author.update_date
            )
            for resource_author, user in author_results
        ]
        
        course_read = CourseRead.model_validate(course)
        course_read.authors = authors
        course_reads.append(course_read)

    return course_reads


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

    # Usage check
    check_limits_with_usage("courses", org_id, db_session)

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
        authorship_status=ResourceAuthorshipStatusEnum.ACTIVE,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )

    # Insert course author
    db_session.add(resource_author)
    db_session.commit()
    db_session.refresh(resource_author)

    # Get course authors with their roles
    authors_statement = (
        select(ResourceAuthor, User)
        .join(User, ResourceAuthor.user_id == User.id)
        .where(ResourceAuthor.resource_uuid == course.course_uuid)
        .order_by(
            ResourceAuthor.id.asc()
        )
    )
    author_results = db_session.exec(authors_statement).all()

    # Convert to AuthorWithRole objects
    authors = [
        AuthorWithRole(
            user=UserRead.model_validate(user),
            authorship=resource_author.authorship,
            authorship_status=resource_author.authorship_status,
            creation_date=resource_author.creation_date,
            update_date=resource_author.update_date
        )
        for resource_author, user in author_results
    ]

    # Feature usage
    increase_feature_usage("courses", course.org_id, db_session)

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

    # Get course authors with their roles
    authors_statement = (
        select(ResourceAuthor, User)
        .join(User, ResourceAuthor.user_id == User.id)
        .where(ResourceAuthor.resource_uuid == course.course_uuid)
        .order_by(
            ResourceAuthor.id.asc()
        )
    )
    author_results = db_session.exec(authors_statement).all()

    # Convert to AuthorWithRole objects
    authors = [
        AuthorWithRole(
            user=UserRead.model_validate(user),
            authorship=resource_author.authorship,
            authorship_status=resource_author.authorship_status,
            creation_date=resource_author.creation_date,
            update_date=resource_author.update_date
        )
        for resource_author, user in author_results
    ]

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

    # Get course authors with their roles
    authors_statement = (
        select(ResourceAuthor, User)
        .join(User, ResourceAuthor.user_id == User.id)
        .where(ResourceAuthor.resource_uuid == course.course_uuid)
        .order_by(
            ResourceAuthor.id.asc()
        )
    )
    author_results = db_session.exec(authors_statement).all()

    # Convert to AuthorWithRole objects
    authors = [
        AuthorWithRole(
            user=UserRead.model_validate(user),
            authorship=resource_author.authorship,
            authorship_status=resource_author.authorship_status,
            creation_date=resource_author.creation_date,
            update_date=resource_author.update_date
        )
        for resource_author, user in author_results
    ]

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

    # Feature usage
    decrease_feature_usage("courses", course.org_id, db_session)

    db_session.delete(course)
    db_session.commit()

    return {"detail": "Course deleted"}


async def get_user_courses(
    request: Request,
    current_user: PublicUser | AnonymousUser,
    user_id: int,
    db_session: Session,
    page: int = 1,
    limit: int = 10,
) -> List[CourseRead]:
    # Verify user is not anonymous
    await authorization_verify_if_user_is_anon(current_user.id)
    
    # Get all resource authors for the user
    statement = select(ResourceAuthor).where(
        and_(
            ResourceAuthor.user_id == user_id,
            ResourceAuthor.authorship_status == ResourceAuthorshipStatusEnum.ACTIVE
        )
    )
    resource_authors = db_session.exec(statement).all()
    
    # Extract course UUIDs from resource authors
    course_uuids = [author.resource_uuid for author in resource_authors]
    
    if not course_uuids:
        return []
    
    # Get courses with the extracted UUIDs
    statement = select(Course).where(Course.course_uuid.in_(course_uuids))
    
    # Apply pagination
    statement = statement.offset((page - 1) * limit).limit(limit)
    
    courses = db_session.exec(statement).all()
    
    # Convert to CourseRead objects
    result = []
    for course in courses:
        # Get authors for the course
        authors_statement = select(ResourceAuthor).where(
            ResourceAuthor.resource_uuid == course.course_uuid
        )
        authors = db_session.exec(authors_statement).all()
        
        # Convert authors to AuthorWithRole objects
        authors_with_role = []
        for author in authors:
            # Get user for the author
            user_statement = select(User).where(User.id == author.user_id)
            user = db_session.exec(user_statement).first()
            
            if user:
                authors_with_role.append(
                    AuthorWithRole(
                        user=UserRead.model_validate(user),
                        authorship=author.authorship,
                        authorship_status=author.authorship_status,
                        creation_date=author.creation_date,
                        update_date=author.update_date,
                    )
                )
        
        # Create CourseRead object
        course_read = CourseRead(
            id=course.id,
            org_id=course.org_id,
            name=course.name,
            description=course.description,
            about=course.about,
            learnings=course.learnings,
            tags=course.tags,
            thumbnail_image=course.thumbnail_image,
            public=course.public,
            open_to_contributors=course.open_to_contributors,
            course_uuid=course.course_uuid,
            creation_date=course.creation_date,
            update_date=course.update_date,
            authors=authors_with_role,
        )
        
        result.append(course_read)
    
    return result


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
                await authorization_verify_based_on_roles_and_authorship(
                    request, current_user.id, action, course_uuid, db_session
                )
            )
            return res
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
