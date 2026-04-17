from typing import List
from uuid import uuid4
import logging
from sqlmodel import Session, select, or_, and_, text, func
from src.db.usergroup_resources import UserGroupResource
from src.db.usergroup_user import UserGroupUser
from src.db.organizations import Organization
from src.db.roles import Role
from src.db.user_organizations import UserOrganization
from src.security.features_utils.usage import (
    check_limits_with_usage,
    decrease_feature_usage,
    increase_feature_usage,
)
from src.db.resource_authors import ResourceAuthor, ResourceAuthorshipEnum, ResourceAuthorshipStatusEnum
from src.db.users import PublicUser, AnonymousUser, User, UserRead, APITokenUser
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
from src.security.rbac import (
    AccessAction,
    AccessContext,
    check_resource_access,
)
from src.security.rbac.constants import ADMIN_OR_MAINTAINER_ROLE_IDS
from src.security.superadmin import is_user_superadmin
from src.services.courses.thumbnails import upload_thumbnail
from src.services.webhooks.dispatch import dispatch_webhooks
from fastapi import HTTPException, Request, UploadFile, status
from datetime import datetime

logger = logging.getLogger(__name__)


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

    # DASHBOARD context lets authors/admins/usergroup members access unpublished
    # courses; regular users still fall back to public view rules.
    await check_resource_access(
        request,
        db_session,
        current_user,
        course.course_uuid,
        AccessAction.READ,
        context=AccessContext.DASHBOARD,
    )

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
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.READ)

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
    slim: bool = False,
) -> FullCourseRead:
    # Avoid circular import
    from src.services.courses.chapters import get_course_chapters

    # Get course with authors and organization in a single query using joins
    course_statement = (
        select(Course, ResourceAuthor, User, Organization)
        .outerjoin(ResourceAuthor, ResourceAuthor.resource_uuid == Course.course_uuid)  # type: ignore
        .outerjoin(User, ResourceAuthor.user_id == User.id)  # type: ignore
        .join(Organization, Organization.id == Course.org_id)  # type: ignore
        .where(Course.course_uuid == course_uuid)
        .order_by(ResourceAuthor.id.asc())  # type: ignore
    )
    results = db_session.exec(course_statement).all()

    if not results:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # Extract course, authors, and organization from results
    course = results[0][0]  # First result's Course
    org = results[0][3]  # First result's Organization
    author_results = [(ra, u) for _, ra, u, _ in results if ra is not None and u is not None]

    # DASHBOARD context lets authors/admins/usergroup members access unpublished
    # courses; regular users still fall back to public view rules.
    await check_resource_access(
        request,
        db_session,
        current_user,
        course.course_uuid,
        AccessAction.READ,
        context=AccessContext.DASHBOARD,
    )

    # Permission check passed — try Redis cache for the heavy data
    # (shared across all authorized users for this course)
    if course.published and not with_unpublished_activities:
        from src.services.courses.cache import get_cached_course_meta
        cached = get_cached_course_meta(course_uuid, slim)
        if cached is not None:
            return FullCourseRead.model_validate(cached)

    # Get course chapters — pass the already-loaded course to skip the
    # duplicate SELECT inside get_course_chapters.
    chapters = []
    if course.id is not None:
        chapters = await get_course_chapters(
            request,
            course.id,
            db_session,
            current_user,
            with_unpublished_activities,
            slim=slim,
            course=course,
        )

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

    # Create course read model with chapters and org_uuid
    course_read = FullCourseRead(
        **course.model_dump(),
        org_uuid=org.org_uuid,
        authors=authors,
        chapters=chapters
    )

    # Cache for published courses (safe to share across users)
    if course.published and not with_unpublished_activities:
        from src.services.courses.cache import set_cached_course_meta
        set_cached_course_meta(course_uuid, slim, course_read.model_dump())

    return course_read


async def get_courses_orgslug(
    request: Request,
    current_user: PublicUser | AnonymousUser,
    org_slug: str,
    db_session: Session,
    page: int = 1,
    limit: int = 10,
    include_unpublished: bool = False,
) -> List[CourseRead]:
    # Cap limit to prevent excessive DB reads
    limit = min(limit, 100)

    # For anonymous users viewing public courses, try Redis cache first
    is_anon = isinstance(current_user, AnonymousUser)
    if is_anon and not include_unpublished:
        from src.services.courses.cache import get_cached_courses_list
        cached = get_cached_courses_list(org_slug, page, limit)
        if cached is not None:
            return [CourseRead.model_validate(c) for c in cached]

    offset = (page - 1) * limit

    # Get organization
    org_statement = select(Organization).where(Organization.slug == org_slug)
    org = db_session.exec(org_statement).first()
    if not org:
        return []

    # Check if user can view unpublished courses (must be admin/editor in org)
    can_view_unpublished = False
    if include_unpublished and not isinstance(current_user, AnonymousUser):
        # Superadmins can always view unpublished courses
        if is_user_superadmin(current_user.id, db_session):
            can_view_unpublished = True
        else:
            # Check if user has admin/editor role in this organization
            role_statement = (
                select(Role)
                .join(UserOrganization)
                .where(UserOrganization.org_id == org.id)
                .where(UserOrganization.user_id == current_user.id)
            )
            user_roles = db_session.exec(role_statement).all()
            for role in user_roles:
                if role.id in ADMIN_OR_MAINTAINER_ROLE_IDS:  # Admin role IDs
                    can_view_unpublished = True
                    break

    # Base query
    needs_distinct = False
    query = (
        select(Course)
        .join(Organization)
        .where(Organization.slug == org_slug)
    )

    if isinstance(current_user, AnonymousUser):
        # For anonymous users, only show public AND published courses
        query = query.where(Course.public == True, Course.published == True)
    else:
        # For authenticated users with admin access viewing dashboard, show all courses
        if can_view_unpublished:
            # Admins see all courses in the organization (no additional filter)
            pass
        else:
            # For regular users, show:
            # 1. Published AND public courses
            # 2. Published courses not in any UserGroup
            # 3. Courses (including unpublished) in UserGroups where the user is a member
            # 4. Courses (including unpublished) where the user is a resource author
            #
            # This allows UserGroup members and course authors to see unpublished courses
            # they have access to, while other users only see published courses.
            needs_distinct = True
            query = (
                query
                .outerjoin(UserGroupResource, UserGroupResource.resource_uuid == Course.course_uuid)  # type: ignore
                .outerjoin(UserGroupUser, and_(
                    UserGroupUser.usergroup_id == UserGroupResource.usergroup_id,
                    UserGroupUser.user_id == current_user.id
                ))
                .outerjoin(ResourceAuthor, and_(
                    ResourceAuthor.resource_uuid == Course.course_uuid,
                    ResourceAuthor.user_id == current_user.id,
                    ResourceAuthor.authorship_status == ResourceAuthorshipStatusEnum.ACTIVE
                ))  # type: ignore
                .where(or_(
                    and_(Course.published == True, Course.public == True),  # Published public courses
                    and_(Course.published == True, UserGroupResource.resource_uuid.is_(None)),  # Published courses not in any UserGroup
                    UserGroupUser.user_id == current_user.id,  # Courses in UserGroups where user is a member (including unpublished)
                    ResourceAuthor.user_id.isnot(None)  # Courses where user is an ACTIVE resource author
                ))
            )

    # Apply ordering and pagination — only use DISTINCT when outerjoins may produce duplicates
    query = query.order_by(Course.creation_date.desc()).offset(offset).limit(limit)
    if needs_distinct:
        query = query.distinct()

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
            "published": course.published,
            "open_to_contributors": course.open_to_contributors,
            "course_uuid": course.course_uuid,
            "creation_date": course.creation_date,
            "update_date": course.update_date,
            "authors": course_authors.get(course.course_uuid, [])
        })
        course_reads.append(course_read)

    # Cache the result for anonymous public views
    if is_anon and not include_unpublished and course_reads:
        from src.services.courses.cache import set_cached_courses_list
        set_cached_courses_list(
            org_slug, page, limit,
            [cr.model_dump() for cr in course_reads]
        )

    return course_reads


async def get_courses_count_orgslug(
    request: Request,
    current_user: PublicUser | AnonymousUser,
    org_slug: str,
    db_session: Session,
) -> int:
    """
    Get total count of courses for an organization (respecting visibility rules)
    """
    # Base query
    query = (
        select(func.count(Course.id.distinct()))
        .join(Organization)
        .where(Organization.slug == org_slug)
    )

    if isinstance(current_user, AnonymousUser):
        # For anonymous users, only count public AND published courses
        query = query.where(Course.public == True, Course.published == True)
    elif not isinstance(current_user, AnonymousUser) and is_user_superadmin(current_user.id, db_session):
        # Superadmins see all courses (no additional filter)
        pass
    else:
        # For authenticated users, count:
        # 1. Published AND public courses
        # 2. Published courses not in any UserGroup
        # 3. Courses (including unpublished) in UserGroups where the user is a member
        # 4. Courses (including unpublished) where the user is a resource author
        query = (
            query
            .outerjoin(UserGroupResource, UserGroupResource.resource_uuid == Course.course_uuid)  # type: ignore
            .outerjoin(UserGroupUser, and_(
                UserGroupUser.usergroup_id == UserGroupResource.usergroup_id,
                UserGroupUser.user_id == current_user.id
            ))
            .outerjoin(ResourceAuthor, and_(
                ResourceAuthor.resource_uuid == Course.course_uuid,
                ResourceAuthor.user_id == current_user.id,
                ResourceAuthor.authorship_status == ResourceAuthorshipStatusEnum.ACTIVE
            ))  # type: ignore
            .where(or_(
                and_(Course.published == True, Course.public == True),  # Published public courses
                and_(Course.published == True, UserGroupResource.resource_uuid.is_(None)),  # Published courses not in any UserGroup
                UserGroupUser.user_id == current_user.id,  # Courses in UserGroups where user is a member (including unpublished)
                ResourceAuthor.user_id.isnot(None)  # Courses where user is an ACTIVE resource author
            ))
        )

    count = db_session.exec(query).one()
    return count


async def search_courses(
    request: Request,
    current_user: PublicUser | AnonymousUser,
    org_slug: str,
    search_query: str,
    db_session: Session,
    page: int = 1,
    limit: int = 10,
) -> List[CourseRead]:
    """
    Search courses within an organization.

    SECURITY FIX: Uses parameterized queries to prevent SQL injection.
    Previously used f-string interpolation which was vulnerable.
    """
    # SECURITY: Enforce maximum limit to prevent data dumping
    limit = min(limit, 100)
    offset = (page - 1) * limit

    # SECURITY FIX: Use parameterized queries to prevent SQL injection
    # The search pattern is passed as a parameter, not interpolated into SQL
    search_pattern = f"%{search_query}%"

    # Base query with parameterized search
    needs_distinct = False
    query = (
        select(Course)
        .join(Organization)
        .where(Organization.slug == org_slug)
        .where(
            or_(
                text('LOWER(course.name) LIKE LOWER(:pattern)'),
                text('LOWER(course.description) LIKE LOWER(:pattern)'),
                text('LOWER(course.about) LIKE LOWER(:pattern)'),
                text('LOWER(course.learnings) LIKE LOWER(:pattern)'),
                text('LOWER(course.tags) LIKE LOWER(:pattern)')
            )
        )
        .params(pattern=search_pattern)
    )

    if isinstance(current_user, AnonymousUser):
        # For anonymous users, only show public AND published courses
        query = query.where(Course.public == True, Course.published == True)
    elif is_user_superadmin(current_user.id, db_session):
        # Superadmins see all courses (no additional filter)
        pass
    else:
        # For authenticated users, show:
        # 1. Published AND public courses
        # 2. Published courses not in any UserGroup
        # 3. Courses (including unpublished) in UserGroups where the user is a member
        # 4. Courses (including unpublished) where the user is a resource author
        needs_distinct = True
        query = (
            query
            .outerjoin(UserGroupResource, UserGroupResource.resource_uuid == Course.course_uuid)  # type: ignore
            .outerjoin(UserGroupUser, and_(
                UserGroupUser.usergroup_id == UserGroupResource.usergroup_id,
                UserGroupUser.user_id == current_user.id
            ))
            .outerjoin(ResourceAuthor, and_(
                ResourceAuthor.resource_uuid == Course.course_uuid,
                ResourceAuthor.user_id == current_user.id,
                ResourceAuthor.authorship_status == ResourceAuthorshipStatusEnum.ACTIVE
            ))  # type: ignore
            .where(or_(
                and_(Course.published == True, Course.public == True),  # Published public courses
                and_(Course.published == True, UserGroupResource.resource_uuid.is_(None)),  # Published courses not in any UserGroup
                UserGroupUser.user_id == current_user.id,  # Courses in UserGroups where user is a member (including unpublished)
                ResourceAuthor.user_id.isnot(None)  # Courses where user is an ACTIVE resource author
            ))
        )

    # Apply ordering and pagination — only use DISTINCT when outerjoins may produce duplicates
    query = query.order_by(Course.creation_date.desc()).offset(offset).limit(limit)
    if needs_distinct:
        query = query.distinct()

    courses = db_session.exec(query).all()

    if not courses:
        return []

    # Fetch all authors for all courses in a single query
    course_uuids = [course.course_uuid for course in courses]
    authors_query = (
        select(ResourceAuthor, User)
        .join(User, ResourceAuthor.user_id == User.id)  # type: ignore
        .where(ResourceAuthor.resource_uuid.in_(course_uuids))  # type: ignore
        .order_by(ResourceAuthor.id.asc())  # type: ignore
    )
    author_results = db_session.exec(authors_query).all()

    # Group authors by course_uuid
    course_authors: dict[str, list[AuthorWithRole]] = {}
    for resource_author, user in author_results:
        course_authors.setdefault(resource_author.resource_uuid, []).append(
            AuthorWithRole(
                user=UserRead.model_validate(user),
                authorship=resource_author.authorship,
                authorship_status=resource_author.authorship_status,
                creation_date=resource_author.creation_date,
                update_date=resource_author.update_date
            )
        )

    course_reads = []
    for course in courses:
        course_read = CourseRead.model_validate({
            "id": course.id or 0,
            "org_id": course.org_id,
            "name": course.name,
            "description": course.description or "",
            "about": course.about or "",
            "learnings": course.learnings or "",
            "tags": course.tags or "",
            "thumbnail_image": course.thumbnail_image or "",
            "public": course.public,
            "published": course.published,
            "open_to_contributors": course.open_to_contributors,
            "course_uuid": course.course_uuid,
            "creation_date": course.creation_date,
            "update_date": course.update_date,
            "authors": course_authors.get(course.course_uuid, [])
        })
        course_reads.append(course_read)

    return course_reads


async def create_course(
    request: Request,
    org_id: int,
    course_object: CourseCreate,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
    thumbnail_file: UploadFile | None = None,
    thumbnail_type: ThumbnailType = ThumbnailType.IMAGE,
):
    """
    Create a new course

    SECURITY NOTES:
    - Requires proper permissions to create courses in the organization
    - User becomes the CREATOR of the course automatically
    - For API tokens, the user who created the token becomes the CREATOR
    - Course creation is subject to organization limits and permissions
    """
    course = Course.model_validate(course_object)

    # SECURITY: Check if user has permission to create courses in this organization
    # Since this is a new course, we need to check organization-level permissions
    # For now, we'll use the existing RBAC check but with proper organization context
    await check_resource_access(request, db_session, current_user, "course_x", AccessAction.CREATE)

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
        name_in_disk = await upload_thumbnail(
            thumbnail_file, org.org_uuid, course.course_uuid  # type: ignore
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

    # SECURITY: Make the user the creator of the course
    # For API tokens, use the user who created the token as the author
    if isinstance(current_user, APITokenUser):
        author_user_id = current_user.created_by_user_id
    else:
        author_user_id = current_user.id

    resource_author = ResourceAuthor(
        resource_uuid=course.course_uuid,
        user_id=author_user_id,
        authorship=ResourceAuthorshipEnum.CREATOR,
        authorship_status=ResourceAuthorshipStatusEnum.ACTIVE,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )

    # Insert course and author atomically in a single transaction
    try:
        db_session.add(course)
        db_session.flush()  # Get the ID without committing
        db_session.refresh(course)
        db_session.add(resource_author)
        db_session.commit()  # Single commit for both
        db_session.refresh(resource_author)
    except Exception:
        db_session.rollback()
        raise

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

    await dispatch_webhooks(
        event_name="course_created",
        org_id=course.org_id,
        data={
            "course_uuid": course.course_uuid,
            "name": course.name,
            "org_id": course.org_id,
        },
    )

    course_data = {key: getattr(course, key) for key in course.model_fields}
    return CourseRead.model_validate({**course_data, "authors": authors})


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
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.UPDATE)

    # Get org uuid
    org_statement = select(Organization).where(Organization.id == course.org_id)
    org = db_session.exec(org_statement).first()

    # Upload thumbnail
    if thumbnail_file and thumbnail_file.filename:
        name_in_disk = await upload_thumbnail(
            thumbnail_file, org.org_uuid, course.course_uuid  # type: ignore
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
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.UPDATE)

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

    # Track published state before update for webhook
    old_published = course.published

    # Update only the fields that were passed in
    for var, value in vars(course_object).items():
        if value is not None:
            setattr(course, var, value)

    # Complete the course object
    course.update_date = str(datetime.now())

    db_session.add(course)
    db_session.commit()
    db_session.refresh(course)

    # Dispatch webhook if published state changed
    if course_object.published is not None and course.published != old_published:
        await dispatch_webhooks(
            event_name="course_published",
            org_id=course.org_id,
            data={
                "course_uuid": course.course_uuid,
                "name": course.name,
                "published": course.published,
            },
        )

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
    await check_resource_access(request, db_session, current_user, course.course_uuid, AccessAction.DELETE)

    # Feature usage
    decrease_feature_usage("courses", course.org_id, db_session)

    # Clean up content files from storage
    org_statement = select(Organization).where(Organization.id == course.org_id)
    org = db_session.exec(org_statement).first()
    if org:
        from src.services.courses.transfer.storage_utils import delete_storage_directory
        content_path = f"content/orgs/{org.org_uuid}/courses/{course_uuid}"
        delete_storage_directory(content_path)

    course_uuid_val = course.course_uuid
    course_name_val = course.name
    course_org_id = course.org_id

    db_session.delete(course)
    db_session.commit()

    await dispatch_webhooks(
        event_name="course_deleted",
        org_id=course_org_id,
        data={
            "course_uuid": course_uuid_val,
            "name": course_name_val,
        },
    )

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
    
    # Fetch courses the user has authored using a single JOIN query with pagination
    statement = (
        select(Course)
        .join(ResourceAuthor, ResourceAuthor.resource_uuid == Course.course_uuid)  # type: ignore
        .where(
            ResourceAuthor.user_id == user_id,
            ResourceAuthor.authorship_status == ResourceAuthorshipStatusEnum.ACTIVE,
        )
        .offset((page - 1) * limit)
        .limit(limit)
    )
    
    courses = db_session.exec(statement).all()
    
    if not courses:
        return []

    # Fetch all authors for all courses in a single query
    course_uuids = [course.course_uuid for course in courses]
    authors_query = (
        select(ResourceAuthor, User)
        .join(User, ResourceAuthor.user_id == User.id)  # type: ignore
        .where(ResourceAuthor.resource_uuid.in_(course_uuids))  # type: ignore
        .order_by(ResourceAuthor.id.asc())  # type: ignore
    )
    author_results = db_session.exec(authors_query).all()

    # Group authors by course_uuid
    course_authors: dict[str, list[AuthorWithRole]] = {}
    for resource_author, user in author_results:
        course_authors.setdefault(resource_author.resource_uuid, []).append(
            AuthorWithRole(
                user=UserRead.model_validate(user),
                authorship=resource_author.authorship,
                authorship_status=resource_author.authorship_status,
                creation_date=resource_author.creation_date,
                update_date=resource_author.update_date,
            )
        )

    result = []
    for course in courses:
        course_read = CourseRead.model_validate({
            "id": course.id or 0,
            "org_id": course.org_id,
            "name": course.name,
            "description": course.description or "",
            "about": course.about or "",
            "learnings": course.learnings or "",
            "tags": course.tags or "",
            "thumbnail_image": course.thumbnail_image or "",
            "public": course.public,
            "published": course.published,
            "open_to_contributors": course.open_to_contributors,
            "course_uuid": course.course_uuid,
            "creation_date": course.creation_date,
            "update_date": course.update_date,
            "authors": course_authors.get(course.course_uuid, [])
        })
        result.append(course_read)

    return result


def _copy_storage_file(src_path: str, dst_path: str) -> None:
    """Copy a file using S3 or local filesystem."""
    import os
    import shutil
    from src.services.courses.transfer.storage_utils import (
        is_s3_enabled, read_file_content, upload_to_s3,
    )

    if is_s3_enabled():
        content = read_file_content(src_path)
        if content:
            upload_to_s3(dst_path, content)
    else:
        os.makedirs(os.path.dirname(dst_path), exist_ok=True)
        shutil.copy2(src_path, dst_path)


def _delete_storage_file(file_path: str) -> None:
    """Delete a file from S3 or local filesystem."""
    from src.services.courses.transfer.storage_utils import delete_storage_file
    delete_storage_file(file_path)


def _replace_uuids_in_content(content, uuid_map):
    """Recursively replace UUID values in a nested dict/list structure."""
    if isinstance(content, dict):
        return {k: _replace_uuids_in_content(v, uuid_map) for k, v in content.items()}
    elif isinstance(content, list):
        return [_replace_uuids_in_content(item, uuid_map) for item in content]
    elif isinstance(content, str) and content in uuid_map:
        return uuid_map[content]
    return content


def _copy_storage_directory(src_dir: str, dst_dir: str) -> None:
    """Recursively copy a directory using S3 or local filesystem."""
    import os
    import shutil
    from src.services.courses.transfer.storage_utils import (
        is_s3_enabled, get_storage_client, get_s3_bucket_name,
    )

    if is_s3_enabled():
        s3_client = get_storage_client()
        if not s3_client:
            return
        bucket = get_s3_bucket_name()
        prefix = src_dir if src_dir.endswith('/') else src_dir + '/'

        paginator = s3_client.get_paginator('list_objects_v2')
        try:
            for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
                for obj in page.get('Contents', []):
                    old_key = obj['Key']
                    # Replace src prefix with dst prefix
                    new_key = dst_dir + old_key[len(src_dir):]
                    # Copy object within S3
                    s3_client.copy_object(
                        Bucket=bucket,
                        CopySource={'Bucket': bucket, 'Key': old_key},
                        Key=new_key,
                    )
        except Exception as e:
            logger.error("Error copying S3 directory %s -> %s: %s", src_dir, dst_dir, e, exc_info=True)
    else:
        if os.path.exists(src_dir):
            shutil.copytree(src_dir, dst_dir, dirs_exist_ok=True)


async def clone_course(
    request: Request,
    course_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    db_session: Session,
) -> CourseRead:
    """
    Clone a course with all its chapters, activities, blocks, and files.

    This creates a complete copy of the course including:
    - Course metadata (name, description, about, learnings, tags, SEO, etc.)
    - Thumbnail files
    - Chapters with their ordering
    - Activities with their files (videos, documents, PDFs)
    - Dynamic activity blocks with their files (images, videos, PDFs)

    The cloned course will:
    - Have a new course_uuid
    - Have "(Copy)" appended to the name
    - Be set to private (public=False) by default
    - Have the current user as the creator
    """
    import os
    from src.services.courses.transfer.storage_utils import (
        is_s3_enabled,
        file_exists,
        list_directory,
    )
    from src.db.courses.chapters import Chapter
    from src.db.courses.activities import Activity
    from src.db.courses.blocks import Block
    from src.db.courses.course_chapters import CourseChapter
    from src.db.courses.chapter_activities import ChapterActivity

    # Get the original course
    statement = select(Course).where(Course.course_uuid == course_uuid)
    original_course = db_session.exec(statement).first()

    if not original_course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # RBAC check - user needs read access to clone
    await check_resource_access(request, db_session, current_user, original_course.course_uuid, AccessAction.READ)

    # Also check if user can create courses
    await check_resource_access(request, db_session, current_user, "course_x", AccessAction.CREATE)

    # Usage check for creating new course
    check_limits_with_usage("courses", original_course.org_id, db_session)

    # Get organization for file operations
    org_statement = select(Organization).where(Organization.id == original_course.org_id)
    org = db_session.exec(org_statement).first()

    if not org:
        raise HTTPException(
            status_code=404,
            detail="Organization not found",
        )

    # Create new course UUID
    new_course_uuid = str(f"course_{uuid4()}")

    # Create the new course
    new_course = Course(
        org_id=original_course.org_id,
        name=f"{original_course.name} (Copy)",
        description=original_course.description,
        about=original_course.about,
        learnings=original_course.learnings,
        tags=original_course.tags,
        thumbnail_type=original_course.thumbnail_type,
        thumbnail_image="",
        thumbnail_video="",
        public=False,  # Cloned courses start as private
        published=False,  # Cloned courses start as unpublished
        open_to_contributors=False,
        course_uuid=new_course_uuid,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
        seo=original_course.seo,
    )

    # Copy thumbnail files if they exist
    content_base = "content/orgs"
    original_course_path = f"{content_base}/{org.org_uuid}/courses/{original_course.course_uuid}"
    new_course_path = f"{content_base}/{org.org_uuid}/courses/{new_course_uuid}"

    # Create new course directory and thumbnails subdirectory (needed for local filesystem)
    if not is_s3_enabled():
        os.makedirs(f"{new_course_path}/thumbnails", exist_ok=True)

    # Copy thumbnail image if exists (thumbnails are in a subdirectory)
    if original_course.thumbnail_image:
        original_thumbnail_path = f"{original_course_path}/thumbnails/{original_course.thumbnail_image}"
        if file_exists(original_thumbnail_path):
            new_thumbnail_name = f"{new_course_uuid}_thumbnail_{uuid4()}.{original_course.thumbnail_image.split('.')[-1]}"
            new_thumbnail_path = f"{new_course_path}/thumbnails/{new_thumbnail_name}"
            _copy_storage_file(original_thumbnail_path, new_thumbnail_path)
            new_course.thumbnail_image = new_thumbnail_name

    # Copy thumbnail video if exists (also in thumbnails subdirectory)
    if original_course.thumbnail_video:
        original_video_path = f"{original_course_path}/thumbnails/{original_course.thumbnail_video}"
        if file_exists(original_video_path):
            new_video_name = f"{new_course_uuid}_thumbnail_{uuid4()}.{original_course.thumbnail_video.split('.')[-1]}"
            new_video_path = f"{new_course_path}/thumbnails/{new_video_name}"
            _copy_storage_file(original_video_path, new_video_path)
            new_course.thumbnail_video = new_video_name

    # Insert new course
    db_session.add(new_course)
    db_session.flush()  # Get new_course.id without committing
    db_session.refresh(new_course)

    # Make current user the creator
    if isinstance(current_user, APITokenUser):
        author_user_id = current_user.created_by_user_id
    else:
        author_user_id = current_user.id

    resource_author = ResourceAuthor(
        resource_uuid=new_course.course_uuid,
        user_id=author_user_id,
        authorship=ResourceAuthorshipEnum.CREATOR,
        authorship_status=ResourceAuthorshipStatusEnum.ACTIVE,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db_session.add(resource_author)
    db_session.flush()

    # Get original chapters with order
    statement = (
        select(Chapter, CourseChapter)
        .join(CourseChapter, Chapter.id == CourseChapter.chapter_id)
        .where(CourseChapter.course_id == original_course.id)
        .order_by(CourseChapter.order)
    )
    chapter_results = db_session.exec(statement).all()

    # Map old chapter IDs to new chapters
    chapter_id_map = {}

    for original_chapter, course_chapter in chapter_results:
        new_chapter_uuid = f"chapter_{uuid4()}"

        new_chapter = Chapter(
            name=original_chapter.name,
            description=original_chapter.description,
            thumbnail_image=original_chapter.thumbnail_image,
            chapter_uuid=new_chapter_uuid,
            org_id=original_course.org_id,
            course_id=new_course.id,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )

        db_session.add(new_chapter)
        db_session.flush()  # Get new_chapter.id without committing

        chapter_id_map[original_chapter.id] = new_chapter.id

        # Create CourseChapter link
        new_course_chapter = CourseChapter(
            course_id=new_course.id,
            chapter_id=new_chapter.id,
            org_id=original_course.org_id,
            order=course_chapter.order,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db_session.add(new_course_chapter)

        # Get activities for this chapter with order
        statement = (
            select(Activity, ChapterActivity)
            .join(ChapterActivity, Activity.id == ChapterActivity.activity_id)
            .where(ChapterActivity.chapter_id == original_chapter.id)
            .order_by(ChapterActivity.order)
            .limit(200)
        )
        activity_results = db_session.exec(statement).all()

        for original_activity, chapter_activity in activity_results:
            new_activity_uuid = f"activity_{uuid4()}"

            # Clone activity content (will update file references for blocks)
            new_content = dict(original_activity.content) if original_activity.content else {}
            new_details = dict(original_activity.details) if original_activity.details else {}

            new_activity = Activity(
                name=original_activity.name,
                activity_type=original_activity.activity_type,
                activity_sub_type=original_activity.activity_sub_type,
                content=new_content,
                details=new_details,
                published=original_activity.published,
                org_id=original_course.org_id,
                course_id=new_course.id,
                activity_uuid=new_activity_uuid,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )

            db_session.add(new_activity)
            db_session.flush()  # Get new_activity.id without committing

            # Create ChapterActivity link
            new_chapter_activity = ChapterActivity(
                chapter_id=new_chapter.id,
                activity_id=new_activity.id,
                course_id=new_course.id,
                org_id=original_course.org_id,
                order=chapter_activity.order,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
            db_session.add(new_chapter_activity)

            # Copy all activity files recursively
            original_activity_path = f"{original_course_path}/activities/{original_activity.activity_uuid}"
            new_activity_path = f"{new_course_path}/activities/{new_activity_uuid}"

            # Copy entire activity directory structure if it exists
            # This handles all activity types: videos, documents, SCORM, assignments, etc.
            _copy_storage_directory(original_activity_path, new_activity_path)

            # Clone blocks for dynamic activities
            if original_activity.activity_type.value == "TYPE_DYNAMIC":
                statement = select(Block).where(Block.activity_id == original_activity.id).limit(200)
                original_blocks = db_session.exec(statement).all()

                # Map old block UUIDs to new block UUIDs (for updating activity content references)
                block_uuid_map = {}

                for original_block in original_blocks:
                    new_block_uuid = f"block_{uuid4()}"
                    block_uuid_map[original_block.block_uuid] = new_block_uuid

                    # Clone block content and update file references
                    new_block_content = dict(original_block.content) if original_block.content else {}

                    # Update activity_uuid reference in block content
                    if 'activity_uuid' in new_block_content:
                        new_block_content['activity_uuid'] = new_activity_uuid

                    # Determine block type folder and rename copied folder from old UUID to new UUID
                    block_type_folder = ""
                    if original_block.block_type.value == "BLOCK_VIDEO":
                        block_type_folder = "videoBlock"
                    elif original_block.block_type.value == "BLOCK_IMAGE":
                        block_type_folder = "imageBlock"
                    elif original_block.block_type.value == "BLOCK_DOCUMENT_PDF":
                        block_type_folder = "pdfBlock"

                    if block_type_folder:
                        # The copy already copied files with old UUIDs, we need to rename folders
                        old_copied_block_path = f"{new_activity_path}/dynamic/blocks/{block_type_folder}/{original_block.block_uuid}"
                        new_block_path_str = f"{new_activity_path}/dynamic/blocks/{block_type_folder}/{new_block_uuid}"

                        # Move files from old block path to new block path (rename folder)
                        block_files = list_directory(old_copied_block_path)
                        if block_files:
                            for filename in block_files:
                                old_file_key = f"{old_copied_block_path}/{filename}"
                                # Generate new file ID
                                new_file_id = str(uuid4())
                                file_ext = filename.split('.')[-1] if '.' in filename else ''
                                new_filename = f"block_{new_file_id}.{file_ext}" if file_ext else f"block_{new_file_id}"
                                new_file_key = f"{new_block_path_str}/{new_filename}"

                                # Copy file to new location
                                _copy_storage_file(old_file_key, new_file_key)
                                # Delete old file
                                _delete_storage_file(old_file_key)

                                # Update file reference in block content
                                if 'file_id' in new_block_content:
                                    new_block_content['file_id'] = f"block_{new_file_id}"

                    new_block = Block(
                        block_type=original_block.block_type,
                        content=new_block_content,
                        org_id=original_course.org_id,
                        course_id=new_course.id,
                        chapter_id=new_chapter.id,
                        activity_id=new_activity.id,
                        block_uuid=new_block_uuid,
                        creation_date=str(datetime.now()),
                        update_date=str(datetime.now()),
                    )

                    db_session.add(new_block)

                # Update activity content to reference new block UUIDs
                if new_content and block_uuid_map:
                    new_activity.content = _replace_uuids_in_content(new_content, block_uuid_map)
                    db_session.add(new_activity)

    # Single commit for all chapters, activities, blocks, and links
    db_session.commit()

    # Increase feature usage for the new course
    increase_feature_usage("courses", new_course.org_id, db_session)

    # Get course authors with their roles
    authors_statement = (
        select(ResourceAuthor, User)
        .join(User, ResourceAuthor.user_id == User.id)
        .where(ResourceAuthor.resource_uuid == new_course.course_uuid)
        .order_by(ResourceAuthor.id.asc())
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

    course_read = CourseRead(**new_course.model_dump(), authors=authors)

    return CourseRead.model_validate(course_read)


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
