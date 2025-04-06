from typing import List, TypeVar
from fastapi import Request
from sqlmodel import Session, select, or_, text, and_
from sqlalchemy import true as sa_true
from pydantic import BaseModel
from src.db.users import PublicUser, AnonymousUser, UserRead, User
from src.db.courses.courses import Course, CourseRead
from src.db.collections import Collection, CollectionRead
from src.db.collections_courses import CollectionCourse
from src.db.organizations import Organization
from src.services.courses.courses import search_courses

T = TypeVar('T')

class SearchResult(BaseModel):
    courses: List[CourseRead]
    collections: List[CollectionRead]
    users: List[UserRead]

    class Config:
        arbitrary_types_allowed = True

async def search_across_org(
    request: Request,
    current_user: PublicUser | AnonymousUser,
    org_slug: str,
    search_query: str,
    db_session: Session,
    page: int = 1,
    limit: int = 10,
) -> SearchResult:
    """
    Search across courses, collections and users within an organization
    """
    offset = (page - 1) * limit

    # Get organization
    org_statement = select(Organization).where(Organization.slug == org_slug)
    org = db_session.exec(org_statement).first()
    
    if not org:
        return SearchResult(courses=[], collections=[], users=[])

    # Search courses using existing search_courses function
    courses = await search_courses(request, current_user, org_slug, search_query, db_session, page, limit)

    # Search collections
    collections_query = (
        select(Collection)
        .where(Collection.org_id == org.id)
        .where(
            or_(
                text('LOWER("collection".name) LIKE LOWER(:pattern)'),
                text('LOWER("collection".description) LIKE LOWER(:pattern)')
            )
        )
        .params(pattern=f"%{search_query}%")
    )

    # Search users
    users_query = (
        select(User)
        .where(
            or_(
                text('LOWER("user".username) LIKE LOWER(:pattern) OR ' +
                     'LOWER("user".first_name) LIKE LOWER(:pattern) OR ' +
                     'LOWER("user".last_name) LIKE LOWER(:pattern) OR ' +
                     'LOWER("user".bio) LIKE LOWER(:pattern)')
            )
        )
        .params(pattern=f"%{search_query}%")
    )

    if isinstance(current_user, AnonymousUser):
        # For anonymous users, only show public collections
        collections_query = collections_query.where(Collection.public == sa_true())
    else:
        # For authenticated users, show public collections and those in their org
        collections_query = (
            collections_query
            .where(
                or_(
                    Collection.public == sa_true(),
                    Collection.org_id == org.id
                )
            )
        )

    # Apply pagination to queries
    collections = db_session.exec(collections_query.offset(offset).limit(limit)).all()
    users = db_session.exec(users_query.offset(offset).limit(limit)).all()

    # Convert collections to CollectionRead objects with courses
    collection_reads = []
    for collection in collections:
        # Get courses in collection
        statement = (
            select(Course)
            .select_from(Course)
            .join(CollectionCourse, and_(
                CollectionCourse.course_id == Course.id,
                CollectionCourse.collection_id == collection.id,
                CollectionCourse.org_id == collection.org_id
            ))
            .distinct()
        )
        collection_courses = list(db_session.exec(statement).all())
        collection_read = CollectionRead(**collection.model_dump(), courses=collection_courses)
        collection_reads.append(collection_read)

    # Convert users to UserRead objects
    user_reads = [UserRead.model_validate(user) for user in users]

    return SearchResult(
        courses=courses,
        collections=collection_reads,
        users=user_reads
    ) 