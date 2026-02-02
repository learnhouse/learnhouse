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
from src.security.rbac.utils import (
    check_element_type,
    check_course_permissions_with_own,
    get_element_organization_id,
)


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
        statement = select(ResourceAuthor).where(
            ResourceAuthor.resource_uuid == element_uuid
        )
        resource_author = db_session.exec(statement).first()

        if resource_author:
            if resource_author.user_id == int(user_id):
                if ((resource_author.authorship == ResourceAuthorshipEnum.CREATOR) or 
                    (resource_author.authorship == ResourceAuthorshipEnum.MAINTAINER) or 
                    (resource_author.authorship == ResourceAuthorshipEnum.CONTRIBUTOR)) and \
                    resource_author.authorship_status == ResourceAuthorshipStatusEnum.ACTIVE:
                    return True
                else:
                    return False
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
            element_rights = getattr(rights, element_type, None)
            if element_rights:
                # Special handling for courses with PermissionsWithOwn
                if element_type == "courses":
                    if await check_course_permissions_with_own(element_rights, action, is_author):
                        return True
                else:
                    # For non-course resources, only check general permissions
                    # (regular Permission class no longer has "own" permissions)
                    if getattr(element_rights, f"action_{action}", False):
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
    await check_element_type(element_uuid)

    # Get user roles bound to an organization and standard roles
    statement = (
        select(Role)
        .join(UserOrganization)
        .where((UserOrganization.org_id == Role.org_id) | (Role.org_id == null()))
        .where(UserOrganization.user_id == user_id)
    )

    user_roles_in_organization_and_standard_roles = db_session.exec(statement).all()

    # Check if user has admin role (role_id 1 or 2) in any organization
    for role in user_roles_in_organization_and_standard_roles:
        role = Role.model_validate(role)
        if role.id in [1, 2]:  # Assuming 1 and 2 are admin role IDs
            return True
    
    return False


# Tested and working
async def authorization_verify_based_on_roles_and_authorship(
    request: Request,
    user_id: int,
    action: Literal["read", "update", "delete", "create"],
    element_uuid: str,
    db_session: Session,
):
    isAuthor = await authorization_verify_if_user_is_author(
        request, user_id, action, element_uuid, db_session
    )

    isRole = await authorization_verify_based_on_roles(
        request, user_id, action, element_uuid, db_session
    )

    if isAuthor or isRole:
        return True
    else:
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

    # Regular user path: use existing logic
    return await authorization_verify_based_on_roles_and_authorship(
        request, current_user.id, action, element_uuid, db_session
    )
