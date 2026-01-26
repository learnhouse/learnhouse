from typing import List, Union
from uuid import uuid4
from datetime import datetime
from sqlmodel import Session, select
from fastapi import HTTPException, Request

from src.db.users import PublicUser, AnonymousUser, APITokenUser
from src.db.organizations import Organization
from src.db.courses.courses import Course
from src.db.communities.communities import (
    Community,
    CommunityCreate,
    CommunityRead,
    CommunityUpdate,
)
from src.security.communities_security import (
    communities_rbac_check,
    communities_rbac_check_with_lookup,
)
from src.security.rbac.rbac import (
    authorization_verify_if_user_is_anon,
    authorization_verify_based_on_org_admin_status,
)


async def create_community(
    request: Request,
    org_id: int,
    community_object: CommunityCreate,
    current_user: Union[PublicUser, AnonymousUser, APITokenUser],
    db_session: Session,
) -> CommunityRead:
    """
    Create a new community in an organization.

    Requires admin/maintainer role in the organization.
    """
    # Verify user is not anonymous
    await authorization_verify_if_user_is_anon(current_user.id)

    # Verify org exists
    org_statement = select(Organization).where(Organization.id == org_id)
    org = db_session.exec(org_statement).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    # Check if user has admin/maintainer role for the organization
    is_admin_or_maintainer = await authorization_verify_based_on_org_admin_status(
        request, current_user.id, "create", f"org_{org.org_uuid}", db_session
    )

    if not is_admin_or_maintainer:
        raise HTTPException(
            status_code=403,
            detail="You must have admin/maintainer role to create communities",
        )

    # Create community
    community = Community(
        name=community_object.name,
        description=community_object.description,
        public=community_object.public,
        org_id=org_id,
        course_id=community_object.course_id,
        community_uuid=f"community_{uuid4()}",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )

    db_session.add(community)
    db_session.commit()
    db_session.refresh(community)

    return CommunityRead.model_validate(community.model_dump())


async def get_community(
    request: Request,
    community_uuid: str,
    current_user: Union[PublicUser, AnonymousUser, APITokenUser],
    db_session: Session,
) -> CommunityRead:
    """
    Get a community by UUID.
    """
    community = await communities_rbac_check_with_lookup(
        request, community_uuid, current_user, "read", db_session
    )

    return CommunityRead.model_validate(community.model_dump())


async def get_communities_by_org(
    request: Request,
    org_id: int,
    current_user: Union[PublicUser, AnonymousUser, APITokenUser],
    db_session: Session,
    page: int = 1,
    limit: int = 10,
) -> List[CommunityRead]:
    """
    Get paginated list of communities for an organization.
    """
    offset = (page - 1) * limit

    # Base query
    query = select(Community).where(Community.org_id == org_id)

    # For anonymous users, only show public communities
    if isinstance(current_user, AnonymousUser) or current_user.id == 0:
        query = query.where(Community.public == True)

    # Apply pagination and ordering
    query = query.order_by(Community.creation_date.desc()).offset(offset).limit(limit)  # type: ignore

    communities = db_session.exec(query).all()

    return [CommunityRead.model_validate(c.model_dump()) for c in communities]


async def get_community_by_course(
    request: Request,
    course_uuid: str,
    current_user: Union[PublicUser, AnonymousUser, APITokenUser],
    db_session: Session,
) -> CommunityRead | None:
    """
    Get the community linked to a specific course.
    """
    # Get the course first
    course_statement = select(Course).where(Course.course_uuid == course_uuid)
    course = db_session.exec(course_statement).first()

    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    # Find community linked to this course
    community_statement = select(Community).where(Community.course_id == course.id)
    community = db_session.exec(community_statement).first()

    if not community:
        return None

    # Check if user can read the community
    await communities_rbac_check(
        request, community.community_uuid, current_user, "read", db_session
    )

    return CommunityRead.model_validate(community.model_dump())


async def update_community(
    request: Request,
    community_uuid: str,
    community_object: CommunityUpdate,
    current_user: Union[PublicUser, AnonymousUser, APITokenUser],
    db_session: Session,
) -> CommunityRead:
    """
    Update a community.

    Requires admin/maintainer role.
    """
    community = await communities_rbac_check_with_lookup(
        request, community_uuid, current_user, "update", db_session
    )

    # Update fields
    if community_object.name is not None:
        community.name = community_object.name
    if community_object.description is not None:
        community.description = community_object.description
    if community_object.public is not None:
        community.public = community_object.public
    if community_object.moderation_words is not None:
        community.moderation_words = community_object.moderation_words

    community.update_date = str(datetime.now())

    db_session.add(community)
    db_session.commit()
    db_session.refresh(community)

    return CommunityRead.model_validate(community.model_dump())


async def delete_community(
    request: Request,
    community_uuid: str,
    current_user: Union[PublicUser, AnonymousUser, APITokenUser],
    db_session: Session,
) -> dict:
    """
    Delete a community.

    Requires admin/maintainer role.
    """
    community = await communities_rbac_check_with_lookup(
        request, community_uuid, current_user, "delete", db_session
    )

    db_session.delete(community)
    db_session.commit()

    return {"detail": "Community deleted"}


async def link_community_to_course(
    request: Request,
    community_uuid: str,
    course_uuid: str,
    current_user: Union[PublicUser, AnonymousUser, APITokenUser],
    db_session: Session,
) -> CommunityRead:
    """
    Link a community to a course.

    Requires admin/maintainer role.
    """
    community = await communities_rbac_check_with_lookup(
        request, community_uuid, current_user, "update", db_session
    )

    # Get the course
    course_statement = select(Course).where(Course.course_uuid == course_uuid)
    course = db_session.exec(course_statement).first()

    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    # Check if course belongs to same org
    if course.org_id != community.org_id:
        raise HTTPException(
            status_code=400,
            detail="Course must belong to the same organization as the community",
        )

    # Check if another community is already linked to this course
    existing_statement = select(Community).where(
        Community.course_id == course.id,
        Community.id != community.id
    )
    existing = db_session.exec(existing_statement).first()

    if existing:
        raise HTTPException(
            status_code=400,
            detail="This course already has a linked community",
        )

    community.course_id = course.id
    community.update_date = str(datetime.now())

    db_session.add(community)
    db_session.commit()
    db_session.refresh(community)

    return CommunityRead.model_validate(community.model_dump())


async def unlink_community_from_course(
    request: Request,
    community_uuid: str,
    current_user: Union[PublicUser, AnonymousUser, APITokenUser],
    db_session: Session,
) -> CommunityRead:
    """
    Unlink a community from its course.

    Requires admin/maintainer role.
    """
    community = await communities_rbac_check_with_lookup(
        request, community_uuid, current_user, "update", db_session
    )

    community.course_id = None
    community.update_date = str(datetime.now())

    db_session.add(community)
    db_session.commit()
    db_session.refresh(community)

    return CommunityRead.model_validate(community.model_dump())


async def get_community_user_rights(
    request: Request,
    community_uuid: str,
    current_user: Union[PublicUser, AnonymousUser, APITokenUser],
    db_session: Session,
) -> dict:
    """
    Get detailed user rights for a specific community.

    Returns comprehensive rights information for UI feature toggling.
    """
    # Check if community exists
    statement = select(Community).where(Community.community_uuid == community_uuid)
    community = db_session.exec(statement).first()

    if not community:
        raise HTTPException(status_code=404, detail="Community not found")

    # Initialize rights object
    rights = {
        "community_uuid": community_uuid,
        "user_id": current_user.id,
        "is_anonymous": current_user.id == 0,
        "permissions": {
            "read": False,
            "create": False,
            "update": False,
            "delete": False,
            "create_discussion": False,
        },
        "ownership": {
            "is_admin": False,
            "is_maintainer_role": False,
        },
    }

    # Handle anonymous users
    if current_user.id == 0:
        if community.public:
            rights["permissions"]["read"] = True
        return rights

    # Authenticated users can read communities
    rights["permissions"]["read"] = True
    rights["permissions"]["create_discussion"] = True

    # Check admin/maintainer role
    is_admin_or_maintainer = await authorization_verify_based_on_org_admin_status(
        request, current_user.id, "update", community_uuid, db_session
    )

    if is_admin_or_maintainer:
        rights["ownership"]["is_admin"] = True
        rights["ownership"]["is_maintainer_role"] = True
        rights["permissions"]["create"] = True
        rights["permissions"]["update"] = True
        rights["permissions"]["delete"] = True

    return rights
