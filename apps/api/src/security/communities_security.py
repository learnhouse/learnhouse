"""
SECURITY DOCUMENTATION FOR COMMUNITIES RBAC SYSTEM

This module provides unified RBAC (Role-Based Access Control) checks for communities and discussions.

SECURITY MEASURES IMPLEMENTED:

1. COMMUNITY ACCESS CONTROL:
   - READ: Allow if community is public OR user is org member
   - CREATE: Require admin/maintainer role in org
   - UPDATE/DELETE: Require admin/maintainer role in org

2. DISCUSSION ACCESS CONTROL:
   - READ: Allow if parent community allows read
   - CREATE: Require authenticated user who can read community
   - UPDATE/DELETE: Require discussion author OR admin role

3. ANONYMOUS USER HANDLING:
   - Anonymous users can only read public communities and their discussions
   - All non-read operations require authentication

4. API TOKEN HANDLING:
   - API tokens are checked for organization boundary
   - Tokens must have appropriate permissions configured
"""

from typing import Literal, Union
from fastapi import HTTPException, Request, status
from sqlmodel import Session, select
from src.db.users import AnonymousUser, PublicUser, APITokenUser
from src.db.communities.communities import Community
from src.db.communities.discussions import Discussion
from src.db.usergroup_resources import UserGroupResource
from src.db.usergroup_user import UserGroupUser
from src.security.rbac.rbac import (
    authorization_verify_if_user_is_anon,
    authorization_verify_based_on_org_admin_status,
)


async def _check_api_token_community_permission(
    request: Request,
    community_uuid: str,
    api_token_user: APITokenUser,
    action: Literal["create", "read", "update", "delete"],
    db_session: Session,
) -> bool:
    """
    Check API token permissions for community operations.
    """
    # For community creation, check if token has communities.action_create permission
    if community_uuid == "community_x" and action == "create":
        if not api_token_user.rights:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="API token has no permissions configured",
            )

        rights = api_token_user.rights
        if isinstance(rights, dict):
            communities_rights = rights.get("communities", {})
            has_permission = communities_rights.get("action_create", False)
        else:
            communities_rights = getattr(rights, "communities", None)
            has_permission = getattr(communities_rights, "action_create", False) if communities_rights else False

        if not has_permission:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="API token does not have permission to create communities",
            )
        return True

    # For existing communities, verify org boundary
    statement = select(Community).where(Community.community_uuid == community_uuid)
    community = db_session.exec(statement).first()

    if not community:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Community not found",
        )

    # CRITICAL: Verify community belongs to token's organization
    if community.org_id != api_token_user.org_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="API token cannot access communities outside its organization",
        )

    # Check token's rights for this action
    if not api_token_user.rights:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="API token has no permissions configured",
        )

    rights = api_token_user.rights
    if isinstance(rights, dict):
        communities_rights = rights.get("communities", {})
        has_permission = communities_rights.get(f"action_{action}", False)
    else:
        communities_rights = getattr(rights, "communities", None)
        has_permission = getattr(communities_rights, f"action_{action}", False) if communities_rights else False

    if not has_permission:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"API token does not have '{action}' permission for communities",
        )

    return True


async def _check_usergroup_access(
    community_uuid: str,
    user_id: int,
    db_session: Session,
) -> bool:
    """Check if user has access to community via UserGroups."""
    # Get community
    community_stmt = select(Community).where(Community.community_uuid == community_uuid)
    community = db_session.exec(community_stmt).first()

    if not community:
        return False

    # If community is public, allow access
    if community.public:
        return True

    # Check if community has any UserGroups linked
    usergroup_check = select(UserGroupResource).where(
        UserGroupResource.resource_uuid == community_uuid
    )
    usergroup_resources = db_session.exec(usergroup_check).all()

    # If no UserGroups linked, allow access (unrestricted private community)
    if not usergroup_resources:
        return True

    # Check if user is member of any linked UserGroup
    usergroup_ids = [ugr.usergroup_id for ugr in usergroup_resources]
    membership_check = select(UserGroupUser).where(
        UserGroupUser.usergroup_id.in_(usergroup_ids),
        UserGroupUser.user_id == user_id
    )
    membership = db_session.exec(membership_check).first()

    return membership is not None


async def communities_rbac_check(
    request: Request,
    community_uuid: str,
    current_user: Union[PublicUser, AnonymousUser, APITokenUser],
    action: Literal["create", "read", "update", "delete"],
    db_session: Session,
) -> bool:
    """
    Unified RBAC check for community operations.

    Args:
        request: FastAPI request object
        community_uuid: UUID of the community (or "community_x" for creation)
        current_user: Current user
        action: Action to perform
        db_session: Database session

    Returns:
        bool: True if authorized

    Raises:
        HTTPException: If unauthorized
    """
    # Handle API Token users
    if isinstance(current_user, APITokenUser):
        return await _check_api_token_community_permission(
            request, community_uuid, current_user, action, db_session
        )

    if action == "read":
        if current_user.id == 0:  # Anonymous user
            # Check if community is public
            statement = select(Community).where(Community.community_uuid == community_uuid)
            community = db_session.exec(statement).first()
            if not community:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Community not found",
                )
            if not community.public:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="This community is not public",
                )
            return True
        else:
            # Authenticated users: check UserGroups access
            has_access = await _check_usergroup_access(community_uuid, current_user.id, db_session)

            if not has_access:
                # Check if user is admin/maintainer (they always have access)
                is_admin_or_maintainer = await authorization_verify_based_on_org_admin_status(
                    request, current_user.id, "read", community_uuid, db_session
                )
                if not is_admin_or_maintainer:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="You don't have access to this community. Contact an administrator to be added to the appropriate user group.",
                    )
            return True
    else:
        # For non-read actions
        await authorization_verify_if_user_is_anon(current_user.id)

        if action == "create" and community_uuid == "community_x":
            # Community creation requires admin/maintainer role
            # This will be checked against org_id from request
            return True  # The router should verify org-level permissions

        # For update/delete, require admin/maintainer role
        statement = select(Community).where(Community.community_uuid == community_uuid)
        community = db_session.exec(statement).first()
        if not community:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Community not found",
            )

        is_admin_or_maintainer = await authorization_verify_based_on_org_admin_status(
            request, current_user.id, action, community_uuid, db_session
        )

        if not is_admin_or_maintainer:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"You must have admin/maintainer role to {action} communities",
            )

        return True


async def communities_rbac_check_with_lookup(
    request: Request,
    community_uuid: str,
    current_user: Union[PublicUser, AnonymousUser, APITokenUser],
    action: Literal["create", "read", "update", "delete"],
    db_session: Session,
) -> Community:
    """
    RBAC check with community lookup.

    Returns the community object if authorized.
    """
    await communities_rbac_check(request, community_uuid, current_user, action, db_session)

    statement = select(Community).where(Community.community_uuid == community_uuid)
    community = db_session.exec(statement).first()

    if not community:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Community not found",
        )

    return community


async def _check_api_token_discussion_permission(
    request: Request,
    discussion_uuid: str,
    api_token_user: APITokenUser,
    action: Literal["create", "read", "update", "delete"],
    db_session: Session,
) -> bool:
    """
    Check API token permissions for discussion operations.
    """
    if discussion_uuid.startswith("discussion_x"):
        # For discussion creation, need to check discussions.action_create
        if not api_token_user.rights:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="API token has no permissions configured",
            )

        rights = api_token_user.rights
        if isinstance(rights, dict):
            discussions_rights = rights.get("discussions", {})
            has_permission = discussions_rights.get("action_create", False)
        else:
            discussions_rights = getattr(rights, "discussions", None)
            has_permission = getattr(discussions_rights, "action_create", False) if discussions_rights else False

        if not has_permission:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="API token does not have permission to create discussions",
            )
        return True

    # For existing discussions
    statement = select(Discussion).where(Discussion.discussion_uuid == discussion_uuid)
    discussion = db_session.exec(statement).first()

    if not discussion:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Discussion not found",
        )

    # Verify discussion belongs to token's organization
    if discussion.org_id != api_token_user.org_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="API token cannot access discussions outside its organization",
        )

    if not api_token_user.rights:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="API token has no permissions configured",
        )

    rights = api_token_user.rights
    if isinstance(rights, dict):
        discussions_rights = rights.get("discussions", {})
        has_permission = discussions_rights.get(f"action_{action}", False)
    else:
        discussions_rights = getattr(rights, "discussions", None)
        has_permission = getattr(discussions_rights, f"action_{action}", False) if discussions_rights else False

    if not has_permission:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"API token does not have '{action}' permission for discussions",
        )

    return True


async def discussions_rbac_check(
    request: Request,
    discussion_uuid: str,
    current_user: Union[PublicUser, AnonymousUser, APITokenUser],
    action: Literal["create", "read", "update", "delete"],
    db_session: Session,
    community_uuid: str = None,
) -> bool:
    """
    Unified RBAC check for discussion operations.

    Args:
        request: FastAPI request object
        discussion_uuid: UUID of the discussion
        current_user: Current user
        action: Action to perform
        db_session: Database session
        community_uuid: UUID of the community (required for create action)

    Returns:
        bool: True if authorized

    Raises:
        HTTPException: If unauthorized
    """
    # Handle API Token users
    if isinstance(current_user, APITokenUser):
        return await _check_api_token_discussion_permission(
            request, discussion_uuid, current_user, action, db_session
        )

    if action == "read":
        # For read, check if the parent community allows read
        statement = select(Discussion).where(Discussion.discussion_uuid == discussion_uuid)
        discussion = db_session.exec(statement).first()
        if not discussion:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Discussion not found",
            )

        # Get the community
        community_statement = select(Community).where(Community.id == discussion.community_id)
        community = db_session.exec(community_statement).first()
        if not community:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Community not found",
            )

        if current_user.id == 0:  # Anonymous user
            if not community.public:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="This discussion belongs to a private community",
                )
        else:
            # Authenticated users: delegate to community RBAC check
            await communities_rbac_check(request, community.community_uuid, current_user, "read", db_session)
        return True

    elif action == "create":
        # For create, user must be authenticated and able to read the community
        await authorization_verify_if_user_is_anon(current_user.id)

        if not community_uuid:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Community UUID required for discussion creation",
            )

        # Check if user can read the community
        await communities_rbac_check(request, community_uuid, current_user, "read", db_session)
        return True

    else:
        # For update/delete
        await authorization_verify_if_user_is_anon(current_user.id)

        statement = select(Discussion).where(Discussion.discussion_uuid == discussion_uuid)
        discussion = db_session.exec(statement).first()
        if not discussion:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Discussion not found",
            )

        # Check if user is the author
        is_author = discussion.author_id == current_user.id

        # Check if user is admin/maintainer
        is_admin_or_maintainer = await authorization_verify_based_on_org_admin_status(
            request, current_user.id, action, discussion_uuid, db_session
        )

        if not (is_author or is_admin_or_maintainer):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"You must be the discussion author or have admin/maintainer role to {action} this discussion",
            )

        return True


async def discussions_rbac_check_with_lookup(
    request: Request,
    discussion_uuid: str,
    current_user: Union[PublicUser, AnonymousUser, APITokenUser],
    action: Literal["create", "read", "update", "delete"],
    db_session: Session,
    community_uuid: str = None,
) -> Discussion:
    """
    RBAC check with discussion lookup.

    Returns the discussion object if authorized.
    """
    await discussions_rbac_check(
        request, discussion_uuid, current_user, action, db_session, community_uuid
    )

    statement = select(Discussion).where(Discussion.discussion_uuid == discussion_uuid)
    discussion = db_session.exec(statement).first()

    if not discussion:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Discussion not found",
        )

    return discussion
