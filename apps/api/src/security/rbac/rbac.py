import logging
from typing import Literal, Union
from fastapi import HTTPException, status, Request
from sqlalchemy import null
from sqlmodel import Session, select
from src.db.collections import Collection
from src.db.courses.courses import Course
from src.db.resource_authors import ResourceAuthor, ResourceAuthorshipEnum, ResourceAuthorshipStatusEnum
from src.db.roles import Role
from src.db.user_organizations import UserOrganization
from src.db.users import APITokenUser
from src.db.usergroup_resources import UserGroupResource
from src.db.usergroup_user import UserGroupUser
from src.security.rbac.utils import (
    check_element_type,
    check_course_permissions_with_own,
    get_element_organization_id,
)
from src.security.rbac.constants import ADMIN_OR_MAINTAINER_ROLE_IDS
from src.security.superadmin import is_user_superadmin

logger = logging.getLogger(__name__)


async def check_usergroup_access(
    resource_uuid: str,
    user_id: int,
    db_session: Session,
) -> bool:
    """
    Check if a user has access to a resource via UserGroup membership.

    This checks if:
    1. The resource is linked to any UserGroups
    2. If yes, whether the user is a member of any of those UserGroups

    Args:
        resource_uuid: UUID of the resource (course, podcast, community, etc.)
        user_id: ID of the user to check
        db_session: Database session

    Returns:
        bool: True if user has access (either no UserGroup restrictions or user is a member)
    """
    logger.info(f"[USERGROUP_ACCESS] Checking access for resource_uuid={resource_uuid}, user_id={user_id}")

    # Check if resource has any UserGroups linked
    usergroup_stmt = select(UserGroupResource).where(
        UserGroupResource.resource_uuid == resource_uuid
    )
    usergroup_resources = db_session.exec(usergroup_stmt).all()

    logger.info(f"[USERGROUP_ACCESS] Found {len(usergroup_resources)} UserGroupResource entries for resource")

    # If no UserGroups linked, resource is accessible to all authenticated users
    if not usergroup_resources:
        logger.info("[USERGROUP_ACCESS] No UserGroups linked, granting access")
        return True

    # Check if user is a member of any linked UserGroup
    usergroup_ids = [ugr.usergroup_id for ugr in usergroup_resources]
    logger.info(f"[USERGROUP_ACCESS] UserGroup IDs linked to resource: {usergroup_ids}")

    membership_stmt = select(UserGroupUser).where(
        UserGroupUser.usergroup_id.in_(usergroup_ids),
        UserGroupUser.user_id == user_id
    )
    membership = db_session.exec(membership_stmt).first()

    if membership:
        logger.info(f"[USERGROUP_ACCESS] User {user_id} IS a member of UserGroup {membership.usergroup_id}, granting access")
    else:
        logger.info(f"[USERGROUP_ACCESS] User {user_id} is NOT a member of any linked UserGroups {usergroup_ids}, denying access")

        # Debug: List all UserGroupUser entries for this user
        all_user_memberships = db_session.exec(
            select(UserGroupUser).where(UserGroupUser.user_id == user_id)
        ).all()
        logger.info(f"[USERGROUP_ACCESS] User {user_id} is member of UserGroups: {[m.usergroup_id for m in all_user_memberships]}")

    return membership is not None


# Tested and working
async def authorization_verify_if_element_is_public(
    request,
    element_uuid: str,
    action: Literal["read"],
    db_session: Session,
):
    element_nature = await check_element_type(element_uuid)
    # Verifies if the element is public
    if element_nature == "courses" and action == "read":
        statement = select(Course).where(
            Course.public == True, Course.course_uuid == element_uuid
        )
        course = db_session.exec(statement).first()
        if course:
            return True
        else:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="User rights : You don't have the right to perform this action",
            )

    elif element_nature == "collections" and action == "read":
        statement = select(Collection).where(
            Collection.public == True, Collection.collection_uuid == element_uuid
        )
        collection = db_session.exec(statement).first()
        if collection:
            return True
        else:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="User rights : You don't have the right to perform this action",
            )

    elif element_nature == "podcasts" and action == "read":
        from src.db.podcasts.podcasts import Podcast
        statement = select(Podcast).where(
            Podcast.public == True,
            Podcast.published == True,
            Podcast.podcast_uuid == element_uuid
        )
        podcast = db_session.exec(statement).first()
        if podcast:
            return True
        else:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="User rights : You don't have the right to perform this action",
            )

    elif element_nature == "docspaces" and action == "read":
        from src.db.docs.docspaces import DocSpace
        statement = select(DocSpace).where(
            DocSpace.public == True,
            DocSpace.published == True,
            DocSpace.docspace_uuid == element_uuid
        )
        docspace = db_session.exec(statement).first()
        if docspace:
            return True
        else:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="User rights : You don't have the right to perform this action",
            )

    else:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User rights : You don't have the right to perform this action",
        )


# Tested and working
async def authorization_verify_if_user_is_author(
    request,
    user_id: int,
    action: Literal["read", "update", "delete", "create"],
    element_uuid: str,
    db_session: Session,
):
    # For create action, we don't need to check existing resource
    if action == "create":
        return True  # Allow creation if user is authenticated
        
    if action in ["update", "delete", "read"]:
        # Query for the current user's authorship record specifically
        # FIXED: Previously this only filtered by resource_uuid and got .first(),
        # which would return the first author (usually CREATOR) even if the current
        # user was a different contributor. Now we filter by both resource_uuid AND user_id.
        statement = select(ResourceAuthor).where(
            ResourceAuthor.resource_uuid == element_uuid,
            ResourceAuthor.user_id == int(user_id)
        )
        resource_author = db_session.exec(statement).first()

        if resource_author:
            valid_authorships = [
                ResourceAuthorshipEnum.CREATOR,
                ResourceAuthorshipEnum.MAINTAINER,
                ResourceAuthorshipEnum.CONTRIBUTOR,
            ]
            if (resource_author.authorship in valid_authorships and
                    resource_author.authorship_status == ResourceAuthorshipStatusEnum.ACTIVE):
                return True
            else:
                return False
        else:
            return False
    return False


# Tested and working
async def authorization_verify_based_on_roles(
    request: Request,
    user_id: int,
    action: Literal["read", "update", "delete", "create"],
    element_uuid: str,
    db_session: Session,
):
    # Superadmin bypass - full access to all resources
    if is_user_superadmin(user_id, db_session):
        return True

    element_type = await check_element_type(element_uuid)

    # Get user roles bound to an organization and standard roles
    statement = (
        select(Role)
        .join(UserOrganization)
        .where((UserOrganization.org_id == Role.org_id) | (Role.org_id == null()))
        .where(UserOrganization.user_id == user_id)
    )

    user_roles_in_organization_and_standard_roles = db_session.exec(statement).all()

    
    # Check if user is the author of the resource for "own" permissions
    is_author = False
    if action in ["update", "delete", "read"]:
        is_author = await authorization_verify_if_user_is_author(
            request, user_id, action, element_uuid, db_session
        )

    # Check all roles until we find one that grants the permission
    for role in user_roles_in_organization_and_standard_roles:
        role = Role.model_validate(role)
        if role.rights:
            rights = role.rights
            # Handle both dict (from JSON storage) and Rights object
            if isinstance(rights, dict):
                element_rights = rights.get(element_type)
            else:
                element_rights = getattr(rights, element_type, None)
            if element_rights:
                # Special handling for resources with PermissionsWithOwn
                if element_type in ("courses", "docspaces", "discussions", "podcasts"):
                    if await check_course_permissions_with_own(element_rights, action, is_author):
                        return True
                else:
                    # For non-course resources, only check general permissions
                    # Handle both dict and object access
                    if isinstance(element_rights, dict):
                        if element_rights.get(f"action_{action}", False):
                            return True
                    elif getattr(element_rights, f"action_{action}", False):
                        return True
    
    # If we get here, no role granted the permission
    return False


async def authorization_verify_based_on_org_admin_status(
    request: Request,
    user_id: int,
    action: Literal["read", "update", "delete", "create"],
    element_uuid: str,
    db_session: Session,
):
    """
    Verify if a user has admin status in the SPECIFIC organization being accessed.

    Args:
        request: FastAPI request object
        user_id: ID of the user to check
        action: The action being performed (read, update, delete, create)
        element_uuid: UUID of the element (organization) being accessed
        db_session: Database session

    Returns:
        bool: True if user is admin in the target organization, False otherwise
    """
    # Superadmin bypass - full access to all organizations
    if is_user_superadmin(user_id, db_session):
        return True

    # Get the target organization's ID from the element UUID
    target_org_id = await get_element_organization_id(element_uuid, db_session)

    if target_org_id is None:
        # If we can't determine the organization, deny access for safety
        return False

    # Check if user has admin or maintainer role in the TARGET organization
    # Note: This checks for admin/maintainer role which typically have full permissions
    statement = (
        select(UserOrganization)
        .where(UserOrganization.user_id == user_id)
        .where(UserOrganization.org_id == target_org_id)
        .where(UserOrganization.role_id.in_(ADMIN_OR_MAINTAINER_ROLE_IDS))
    )

    user_org = db_session.exec(statement).first()

    return user_org is not None


# Tested and working
async def authorization_verify_based_on_roles_and_authorship(
    request: Request,
    user_id: int,
    action: Literal["read", "update", "delete", "create"],
    element_uuid: str,
    db_session: Session,
):
    logger.info(f"[RBAC] authorization_verify_based_on_roles_and_authorship: user_id={user_id}, action={action}, element_uuid={element_uuid}")

    # Superadmin bypass - full access to all resources
    if is_user_superadmin(user_id, db_session):
        logger.info(f"[RBAC] Superadmin bypass for user_id={user_id}")
        return True

    isAuthor = await authorization_verify_if_user_is_author(
        request, user_id, action, element_uuid, db_session
    )
    logger.info(f"[RBAC] isAuthor={isAuthor}")

    isRole = await authorization_verify_based_on_roles(
        request, user_id, action, element_uuid, db_session
    )
    logger.info(f"[RBAC] isRole={isRole}")

    # For read actions, also check UserGroup membership
    # UserGroups allow access to resources that are not public but restricted to group members
    hasUserGroupAccess = False
    if action == "read":
        hasUserGroupAccess = await check_usergroup_access(
            element_uuid, user_id, db_session
        )
    logger.info(f"[RBAC] hasUserGroupAccess={hasUserGroupAccess}")

    if isAuthor or isRole or hasUserGroupAccess:
        logger.info(f"[RBAC] Access GRANTED (isAuthor={isAuthor}, isRole={isRole}, hasUserGroupAccess={hasUserGroupAccess})")
        return True
    else:
        logger.info(f"[RBAC] Access DENIED (isAuthor={isAuthor}, isRole={isRole}, hasUserGroupAccess={hasUserGroupAccess})")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User rights (roles & authorship) : You don't have the right to perform this action",
        )


async def authorization_verify_if_user_is_anon(user_id: int):
    if user_id == 0:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You should be logged in to perform this action",
        )


async def authorization_verify_api_token_permissions(
    request: Request,
    api_token_user: APITokenUser,
    action: Literal["read", "update", "delete", "create"],
    element_uuid: str,
    db_session: Session,
) -> bool:
    """
    Verify API token permissions for an action on an element.

    CRITICAL: This function enforces organization boundary - tokens can ONLY
    access resources within their organization.

    API tokens are restricted to these resources:
    - courses, activities, coursechapters, collections, certifications,
    - usergroups, payments, search

    Args:
        request: FastAPI request object
        api_token_user: The authenticated API token user
        action: The action being performed
        element_uuid: The UUID of the element being accessed
        db_session: Database session

    Returns:
        bool: True if permission granted

    Raises:
        HTTPException: If permission denied or org boundary violated
    """
    element_type = await check_element_type(element_uuid)

    # API tokens are restricted to specific resource types
    allowed_resource_types = [
        'courses', 'activities', 'coursechapters', 'collections',
        'certifications', 'usergroups', 'payments', 'search'
    ]

    if element_type not in allowed_resource_types:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"API tokens cannot access '{element_type}' resources",
        )

    # CRITICAL: Verify element belongs to token's organization
    element_org_id = await get_element_organization_id(element_uuid, db_session)

    if element_org_id is not None and element_org_id != api_token_user.org_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="API token cannot access resources outside its organization",
        )

    # Check token's rights for this action
    if not api_token_user.rights:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="API token has no permissions configured",
        )

    # Get the rights for this element type
    rights = api_token_user.rights
    if isinstance(rights, dict):
        element_rights = rights.get(element_type, {})
    else:
        element_rights = getattr(rights, element_type, None)

    if not element_rights:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"API token does not have permissions for {element_type}",
        )

    # Check the specific action permission
    if element_type == "search":
        # Search only allows read action
        if action != "read":
            has_permission = False
        elif isinstance(element_rights, dict):
            has_permission = element_rights.get("action_read", False)
        else:
            has_permission = getattr(element_rights, "action_read", False)
    elif element_type == "courses":
        # For courses, check standard permission (no "own" for API tokens)
        if isinstance(element_rights, dict):
            has_permission = element_rights.get(f"action_{action}", False)
        else:
            has_permission = getattr(element_rights, f"action_{action}", False)
    else:
        # Standard permission check
        if isinstance(element_rights, dict):
            has_permission = element_rights.get(f"action_{action}", False)
        else:
            has_permission = getattr(element_rights, f"action_{action}", False)

    if not has_permission:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"API token does not have '{action}' permission for {element_type}",
        )

    return True


async def authorization_verify_based_on_roles_and_authorship_or_api_token(
    request: Request,
    current_user: Union[APITokenUser, any],
    action: Literal["read", "update", "delete", "create"],
    element_uuid: str,
    db_session: Session,
):
    """
    Combined authorization check that handles both regular users and API tokens.

    For API tokens: Verifies org boundary and token permissions
    For regular users: Falls back to existing role/authorship verification
    """
    # Check if this is an API token request
    if isinstance(current_user, APITokenUser):
        return await authorization_verify_api_token_permissions(
            request, current_user, action, element_uuid, db_session
        )

    # Superadmin bypass - full access to all resources
    if is_user_superadmin(current_user.id, db_session):
        return True

    # Regular user path: use existing logic
    return await authorization_verify_based_on_roles_and_authorship(
        request, current_user.id, action, element_uuid, db_session
    )
