from typing import Optional
from fastapi import HTTPException, Request
from sqlmodel import Session, select
from sqlalchemy import text

from src.db.courses.courses import Course, CourseRead, AuthorWithRole
from src.db.organizations import Organization, OrganizationRead
from src.db.users import User, UserRead
from src.db.resource_authors import ResourceAuthor


def _get_sort_expression(salt: str):
    """Helper function to create consistent sort expression"""
    if not salt:
        return Organization.name
    
    # Create a deterministic ordering using md5(salt + id)
    return text(
        f"md5('{salt}' || id)"
    )

async def get_orgs_for_explore(
    request: Request,
    db_session: Session,
    page: int = 1,
    limit: int = 10,
    label: str = "",
    salt: str = "",
) -> list[OrganizationRead]:

    statement = (
        select(Organization)
        .where(
            Organization.explore == True,
        )
    )

    # Add label filter if provided
    if label:
        statement = statement.where(Organization.label == label)  #type: ignore

    # Add deterministic ordering based on salt
    statement = statement.order_by(_get_sort_expression(salt))

    # Add pagination
    statement = (
        statement
        .offset((page - 1) * limit)
        .limit(limit)
    )

    result = db_session.exec(statement)
    orgs = result.all()

    return [OrganizationRead.model_validate(org) for org in orgs]



async def get_courses_for_an_org_explore(
    request: Request,
    db_session: Session,
    org_uuid: str,
) -> list[CourseRead]:
    statement = select(Organization).where(Organization.org_uuid == org_uuid)
    result = db_session.exec(statement)
    org = result.first()

    if not org:
        raise HTTPException(
            status_code=404,
            detail="Organization not found",
        )
    
    statement = select(Course).where(Course.org_id == org.id, Course.public == True)
    result = db_session.exec(statement)
    courses = result.all()

    courses_list = []

    for course in courses:
        courses_list.append(course)

    return courses_list

async def get_course_for_explore(
    request: Request,
    course_id: str,
    db_session: Session,
) -> CourseRead:
    statement = select(Course).where(Course.id == course_id)
    result = db_session.exec(statement)
    
    course = result.first()

    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )

    # Get course authors with their roles
    authors_statement = (
        select(ResourceAuthor, User)
        .join(User, ResourceAuthor.user_id == User.id)
        .where(ResourceAuthor.resource_uuid == course.course_uuid)
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

    return CourseRead(**course.model_dump(), authors=authors)

async def search_orgs_for_explore(
    request: Request,
    db_session: Session,
    search_query: str,
    label: Optional[str] = None,
    page: int = 1,
    limit: int = 10,
    salt: str = "",
) -> list[OrganizationRead]:
    # Create a combined search vector
    search_terms = search_query.split()
    search_conditions = []
    
    for term in search_terms:
        term_pattern = f"%{term}%"
        search_conditions.append(
            (Organization.name.ilike(term_pattern)) | #type: ignore
            (Organization.about.ilike(term_pattern)) | #type: ignore
            (Organization.description.ilike(term_pattern)) | #type: ignore
            (Organization.label.ilike(term_pattern)) #type: ignore
        )
    
    statement = (
        select(Organization)
        .where(Organization.explore == True)
    )

    if label and label != "all":
        statement = statement.where(Organization.label == label)  #type: ignore

    if search_conditions:
        statement = statement.where(*search_conditions)

    # Add deterministic ordering based on salt
    statement = statement.order_by(_get_sort_expression(salt))

    # Add pagination
    statement = (
        statement
        .offset((page - 1) * limit)
        .limit(limit)
    )
    
    result = db_session.exec(statement)
    orgs = result.all()

    return [OrganizationRead.model_validate(org) for org in orgs]

async def get_org_for_explore(
    request: Request,
    org_slug: str,
    db_session: Session,
 ) -> OrganizationRead:
    statement = select(Organization).where(Organization.slug == org_slug)
    result = db_session.exec(statement)
    org = result.first()

    if not org:
        raise HTTPException(
            status_code=404,
            detail="Organization not found",
        )
    
    return OrganizationRead.model_validate(org)
    