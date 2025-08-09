from typing import List
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
from src.db.resource_authors import ResourceAuthor, ResourceAuthorshipEnum, ResourceAuthorshipStatusEnum
from src.db.users import PublicUser, AnonymousUser, User, UserRead
from src.db.courses.courses import (
    Course,
    CourseCreate,
    CourseRead,
    CourseUpdate,
    FullCourseRead,
    AuthorWithRole,
    ThumbnailType,
)
from src.security.rbac.rbac import (
    authorization_verify_if_user_is_anon,
    authorization_verify_based_on_org_admin_status,
)
from src.services.courses.thumbnails import upload_thumbnail
from fastapi import HTTPException, Request, UploadFile, status
from datetime import datetime
from src.security.courses_security import courses_rbac_check


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
    await courses_rbac_check(request, course.course_uuid, current_user, "read", db_session)

    # Get course authors with their roles
    authors_statement = (
        select(ResourceAuthor, User)
        .join(User, ResourceAuthor.user_id == User.id) # type: ignore
        .where(ResourceAuthor.resource_uuid == course.course_uuid)
        .order_by(
            ResourceAuthor.id.asc() # type: ignore  
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
    await courses_rbac_check(request, course.course_uuid, current_user, "read", db_session)

    # Get course authors with their roles
    authors_statement = (
        select(ResourceAuthor, User)
        .join(User, ResourceAuthor.user_id == User.id) # type: ignore
        .where(ResourceAuthor.resource_uuid == course.course_uuid)
        .order_by(
            ResourceAuthor.id.asc() # type: ignore
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
    with_unpublished_activities: bool,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
) -> FullCourseRead:
    # Avoid circular import
    from src.services.courses.chapters import get_course_chapters

    # Get course with authors in a single query using joins
    course_statement = (
        select(Course, ResourceAuthor, User)
        .outerjoin(ResourceAuthor, ResourceAuthor.resource_uuid == Course.course_uuid)  # type: ignore
        .outerjoin(User, ResourceAuthor.user_id == User.id)  # type: ignore
        .where(Course.course_uuid == course_uuid)
        .order_by(ResourceAuthor.id.asc())  # type: ignore
    )
    results = db_session.exec(course_statement).all()

    if not results:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # Extract course and authors from results
    course = results[0][0]  # First result's Course
    author_results = [(ra, u) for _, ra, u in results if ra is not None and u is not None]

    # RBAC check
    await courses_rbac_check(request, course.course_uuid, current_user, "read", db_session)

    # Get course chapters
    chapters = []
    if course.id is not None:
        chapters = await get_course_chapters(request, course.id, db_session, current_user, with_unpublished_activities)
    
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
    
    # Create course read model with chapters
    course_read = FullCourseRead(
        **course.model_dump(),
        authors=authors,
        chapters=chapters
    )
    
    return course_read


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
            ResourceAuthor.id.asc() # type: ignore
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
        course_read = CourseRead.model_validate({
            "id": course.id or 0,  # Ensure id is never None
            "org_id": course.org_id,
            "name": course.name,
            "description": course.description or "",
            "about": course.about or "",
            "learnings": course.learnings or "",
            "tags": course.tags or "",
            "thumbnail_image": course.thumbnail_image or "",
            "public": course.public,
            "open_to_contributors": course.open_to_contributors,
            "course_uuid": course.course_uuid,
            "creation_date": course.creation_date,
            "update_date": course.update_date,
            "authors": course_authors.get(course.course_uuid, [])
        })
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
            .join(User, ResourceAuthor.user_id == User.id) # type: ignore
            .where(ResourceAuthor.resource_uuid == course.course_uuid)
            .order_by(
                ResourceAuthor.id.asc() # type: ignore
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
        
        course_read = CourseRead.model_validate({
            "id": course.id or 0,  # Ensure id is never None
            "org_id": course.org_id,
            "name": course.name,
            "description": course.description or "",
            "about": course.about or "",
            "learnings": course.learnings or "",
            "tags": course.tags or "",
            "thumbnail_image": course.thumbnail_image or "",
            "public": course.public,
            "open_to_contributors": course.open_to_contributors,
            "course_uuid": course.course_uuid,
            "creation_date": course.creation_date,
            "update_date": course.update_date,
            "authors": authors
        })
        course_reads.append(course_read)

    return course_reads


async def create_course(
    request: Request,
    org_id: int,
    course_object: CourseCreate,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
    thumbnail_file: UploadFile | None = None,
    thumbnail_type: ThumbnailType = ThumbnailType.IMAGE,
):
    """
    Create a new course
    
    SECURITY NOTES:
    - Requires proper permissions to create courses in the organization
    - User becomes the CREATOR of the course automatically
    - Course creation is subject to organization limits and permissions
    """
    course = Course.model_validate(course_object)

    # SECURITY: Check if user has permission to create courses in this organization
    # Since this is a new course, we need to check organization-level permissions
    # For now, we'll use the existing RBAC check but with proper organization context
    await courses_rbac_check(request, "course_x", current_user, "create", db_session)

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
        if thumbnail_type == ThumbnailType.IMAGE:
            course.thumbnail_image = name_in_disk
            course.thumbnail_type = ThumbnailType.IMAGE
        elif thumbnail_type == ThumbnailType.VIDEO:
            course.thumbnail_video = name_in_disk
            course.thumbnail_type = ThumbnailType.VIDEO
    else:
        course.thumbnail_image = ""
        course.thumbnail_video = ""
        course.thumbnail_type = ThumbnailType.IMAGE

    # Insert course
    db_session.add(course)
    db_session.commit()
    db_session.refresh(course)

    # SECURITY: Make the user the creator of the course
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
        .join(User, ResourceAuthor.user_id == User.id) # type: ignore
        .where(ResourceAuthor.resource_uuid == course.course_uuid)
        .order_by(
            ResourceAuthor.id.asc() # type: ignore
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
    thumbnail_type: ThumbnailType = ThumbnailType.IMAGE,
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
    await courses_rbac_check(request, course.course_uuid, current_user, "update", db_session)

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
        if thumbnail_type == ThumbnailType.IMAGE:
            course.thumbnail_image = name_in_disk
            course.thumbnail_type = ThumbnailType.IMAGE if not course.thumbnail_video else ThumbnailType.BOTH
        elif thumbnail_type == ThumbnailType.VIDEO:
            course.thumbnail_video = name_in_disk
            course.thumbnail_type = ThumbnailType.VIDEO if not course.thumbnail_image else ThumbnailType.BOTH
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
        .join(User, ResourceAuthor.user_id == User.id) # type: ignore
        .where(ResourceAuthor.resource_uuid == course.course_uuid)
        .order_by(
            ResourceAuthor.id.asc() # type: ignore
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
    """
    Update a course
    
    SECURITY NOTES:
    - Requires course ownership (CREATOR, MAINTAINER) or admin role
    - Sensitive fields (public, open_to_contributors) require additional validation
    - Cannot change course access settings without proper permissions
    """
    statement = select(Course).where(Course.course_uuid == course_uuid)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # SECURITY: Require course ownership or admin role for updating courses
    await courses_rbac_check(request, course.course_uuid, current_user, "update", db_session)

    # SECURITY: Additional checks for sensitive access control fields
    sensitive_fields_updated = []
    
    # Check if sensitive fields are being updated
    if course_object.public is not None:
        sensitive_fields_updated.append("public")
    if course_object.open_to_contributors is not None:
        sensitive_fields_updated.append("open_to_contributors")
    
    # If sensitive fields are being updated, require additional validation
    if sensitive_fields_updated:
        # SECURITY: For sensitive access control changes, require CREATOR or MAINTAINER role
        # Check if user is course owner (CREATOR or MAINTAINER)
        statement = select(ResourceAuthor).where(
            ResourceAuthor.resource_uuid == course_uuid,
            ResourceAuthor.user_id == current_user.id
        )
        resource_author = db_session.exec(statement).first()
        
        is_course_owner = False
        if resource_author:
            if ((resource_author.authorship == ResourceAuthorshipEnum.CREATOR) or 
                (resource_author.authorship == ResourceAuthorshipEnum.MAINTAINER)) and \
                resource_author.authorship_status == ResourceAuthorshipStatusEnum.ACTIVE:
                is_course_owner = True
        
        # Check if user has admin or maintainer role
        is_admin_or_maintainer = await authorization_verify_based_on_org_admin_status(
            request, current_user.id, "update", course_uuid, db_session
        )
        
        # SECURITY: Only course owners (CREATOR, MAINTAINER) or admins can change access settings
        if not (is_course_owner or is_admin_or_maintainer):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"You must be the course owner (CREATOR or MAINTAINER) or have admin role to change access settings: {', '.join(sensitive_fields_updated)}",
            )

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
        .join(User, ResourceAuthor.user_id == User.id) # type: ignore
        .where(ResourceAuthor.resource_uuid == course.course_uuid)
        .order_by(
            ResourceAuthor.id.asc() # type: ignore
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
    await courses_rbac_check(request, course.course_uuid, current_user, "delete", db_session)

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
    statement = select(Course).where(Course.course_uuid.in_(course_uuids)) # type: ignore
    
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
        course_read = CourseRead.model_validate({
            "id": course.id or 0,  # Ensure id is never None
            "org_id": course.org_id,
            "name": course.name,
            "description": course.description or "",
            "about": course.about or "",
            "learnings": course.learnings or "",
            "tags": course.tags or "",
            "thumbnail_image": course.thumbnail_image or "",
            "public": course.public,
            "open_to_contributors": course.open_to_contributors,
            "course_uuid": course.course_uuid,
            "creation_date": course.creation_date,
            "update_date": course.update_date,
            "authors": authors_with_role
        })
        
        result.append(course_read)
    
    return result


async def get_course_user_rights(
    request: Request,
    course_uuid: str,
    current_user: PublicUser | AnonymousUser,
    db_session: Session,
) -> dict:
    """
    Get detailed user rights for a specific course.
    
    This function returns comprehensive rights information that can be used
    by the UI to enable/disable features based on user permissions.
    
    SECURITY NOTES:
    - Returns rights based on course ownership and user roles
    - Includes both course-level and content-level permissions
    - Safe to expose to UI as it only returns permission information
    """
    # Check if course exists
    statement = select(Course).where(Course.course_uuid == course_uuid)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # Initialize rights object
    rights = {
        "course_uuid": course_uuid,
        "user_id": current_user.id,
        "is_anonymous": current_user.id == 0,
        "permissions": {
            "read": False,
            "create": False,
            "update": False,
            "delete": False,
            "create_content": False,
            "update_content": False,
            "delete_content": False,
            "manage_contributors": False,
            "manage_access": False,
            "grade_assignments": False,
            "mark_activities_done": False,
            "create_certifications": False,
        },
        "ownership": {
            "is_owner": False,
            "is_creator": False,
            "is_maintainer": False,
            "is_contributor": False,
            "authorship_status": None,
        },
        "roles": {
            "is_admin": False,
            "is_maintainer_role": False,
            "is_instructor": False,
            "is_user": False,
        }
    }

    # Handle anonymous users
    if current_user.id == 0:
        # Anonymous users can only read public courses
        if course.public:
            rights["permissions"]["read"] = True
        return rights

    # Check course ownership
    statement = select(ResourceAuthor).where(
        ResourceAuthor.resource_uuid == course_uuid,
        ResourceAuthor.user_id == current_user.id
    )
    resource_author = db_session.exec(statement).first()
    
    if resource_author:
        rights["ownership"]["authorship_status"] = resource_author.authorship_status
        
        if resource_author.authorship_status == ResourceAuthorshipStatusEnum.ACTIVE:
            if resource_author.authorship == ResourceAuthorshipEnum.CREATOR:
                rights["ownership"]["is_creator"] = True
                rights["ownership"]["is_owner"] = True
            elif resource_author.authorship == ResourceAuthorshipEnum.MAINTAINER:
                rights["ownership"]["is_maintainer"] = True
                rights["ownership"]["is_owner"] = True
            elif resource_author.authorship == ResourceAuthorshipEnum.CONTRIBUTOR:
                rights["ownership"]["is_contributor"] = True
                rights["ownership"]["is_owner"] = True

    # Check user roles
    from src.security.rbac.rbac import authorization_verify_based_on_org_admin_status
    from src.security.rbac.rbac import authorization_verify_based_on_roles
    
    # Check admin/maintainer role
    is_admin_or_maintainer = await authorization_verify_based_on_org_admin_status(
        request, current_user.id, "update", course_uuid, db_session
    )
    
    if is_admin_or_maintainer:
        rights["roles"]["is_admin"] = True
        rights["roles"]["is_maintainer_role"] = True

    # Check instructor role
    has_instructor_permissions = await authorization_verify_based_on_roles(
        request, current_user.id, "create", "course_x", db_session
    )
    
    if has_instructor_permissions:
        rights["roles"]["is_instructor"] = True

    # Check user role (basic permissions)
    has_user_permissions = await authorization_verify_based_on_roles(
        request, current_user.id, "read", course_uuid, db_session
    )
    
    if has_user_permissions:
        rights["roles"]["is_user"] = True

    # Determine permissions based on ownership and roles
    is_course_owner = rights["ownership"]["is_owner"]
    is_admin = rights["roles"]["is_admin"]
    is_maintainer_role = rights["roles"]["is_maintainer_role"]
    is_instructor = rights["roles"]["is_instructor"]

    # READ permissions
    if course.public or is_course_owner or is_admin or is_maintainer_role or is_instructor or has_user_permissions:
        rights["permissions"]["read"] = True

    # CREATE permissions (course creation)
    if is_instructor or is_admin or is_maintainer_role:
        rights["permissions"]["create"] = True

    # UPDATE permissions (course-level updates)
    if is_course_owner or is_admin or is_maintainer_role:
        rights["permissions"]["update"] = True

    # DELETE permissions (course deletion)
    if is_course_owner or is_admin or is_maintainer_role:
        rights["permissions"]["delete"] = True

    # CONTENT CREATION permissions (activities, assignments, chapters, etc.)
    if is_course_owner or is_admin or is_maintainer_role:
        rights["permissions"]["create_content"] = True

    # CONTENT UPDATE permissions
    if is_course_owner or is_admin or is_maintainer_role:
        rights["permissions"]["update_content"] = True

    # CONTENT DELETE permissions
    if is_course_owner or is_admin or is_maintainer_role:
        rights["permissions"]["delete_content"] = True

    # CONTRIBUTOR MANAGEMENT permissions
    if is_course_owner or is_admin or is_maintainer_role:
        rights["permissions"]["manage_contributors"] = True

    # ACCESS MANAGEMENT permissions (public, open_to_contributors)
    if (rights["ownership"]["is_creator"] or rights["ownership"]["is_maintainer"] or 
        is_admin or is_maintainer_role):
        rights["permissions"]["manage_access"] = True

    # GRADING permissions
    if is_course_owner or is_admin or is_maintainer_role:
        rights["permissions"]["grade_assignments"] = True

    # ACTIVITY MARKING permissions
    if is_course_owner or is_admin or is_maintainer_role:
        rights["permissions"]["mark_activities_done"] = True

    # CERTIFICATION permissions
    if is_course_owner or is_admin or is_maintainer_role:
        rights["permissions"]["create_certifications"] = True

    return rights
