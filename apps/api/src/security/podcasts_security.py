"""
SECURITY DOCUMENTATION FOR PODCASTS RBAC SYSTEM

This module provides unified RBAC (Role-Based Access Control) checks for all podcasts-related operations.

SECURITY MEASURES IMPLEMENTED:

1. PODCAST OWNERSHIP REQUIREMENTS:
   - All non-read operations (create, update, delete) require podcast ownership
   - Podcast ownership is determined by ResourceAuthor table with ACTIVE status
   - Valid ownership roles: CREATOR, MAINTAINER, CONTRIBUTOR
   - Admin/maintainer roles are also accepted for podcast operations

2. PODCAST CREATION:
   - PODCAST CREATION: Allow if user has instructor role (3) or higher
   - This distinction allows instructors to create podcasts but prevents them from modifying podcasts they don't own

3. STRICT ACCESS CONTROLS:
   - Episodes: Require podcast ownership for all non-read operations
   - This prevents unauthorized users from creating/modifying podcast episodes

4. ANONYMOUS USER HANDLING:
   - Anonymous users can only read public podcasts
   - All non-read operations require authentication

5. ERROR HANDLING:
   - Clear error messages for security violations
   - Proper HTTP status codes (401, 403, 404)
"""

from typing import Literal, Union
from fastapi import HTTPException, Request, status
from sqlmodel import Session, select
from src.db.users import AnonymousUser, PublicUser, APITokenUser
from src.db.podcasts.podcasts import Podcast
from src.db.resource_authors import ResourceAuthor, ResourceAuthorshipEnum, ResourceAuthorshipStatusEnum
from src.security.rbac.rbac import (
    authorization_verify_based_on_roles_and_authorship,
    authorization_verify_if_element_is_public,
    authorization_verify_if_user_is_anon,
    authorization_verify_based_on_org_admin_status,
    authorization_verify_based_on_roles,
)


async def _check_api_token_podcasts_permission(
    request: Request,
    podcast_uuid: str,
    api_token_user: APITokenUser,
    action: Literal["create", "read", "update", "delete"],
    db_session: Session,
) -> bool:
    """
    Check API token permissions for podcast operations.

    SECURITY NOTES:
    - Enforces organization boundary - token can only access podcasts in its org
    - Uses token's rights directly for permission checks
    - For podcast creation (podcast_x), only checks podcasts.action_create permission
    """
    # For podcast creation, we don't have a real podcast yet
    if podcast_uuid == "podcast_x" and action == "create":
        # Check if token has podcasts.action_create permission
        if not api_token_user.rights:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="API token has no permissions configured",
            )

        rights = api_token_user.rights
        if isinstance(rights, dict):
            podcasts_rights = rights.get("podcasts", {})
            has_permission = podcasts_rights.get("action_create", False)
        else:
            podcasts_rights = getattr(rights, "podcasts", None)
            has_permission = getattr(podcasts_rights, "action_create", False) if podcasts_rights else False

        if not has_permission:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="API token does not have permission to create podcasts",
            )
        return True

    # For existing podcasts, verify org boundary
    statement = select(Podcast).where(Podcast.podcast_uuid == podcast_uuid)
    podcast = db_session.exec(statement).first()

    if not podcast:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Podcast not found",
        )

    # CRITICAL: Verify podcast belongs to token's organization
    if podcast.org_id != api_token_user.org_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="API token cannot access podcasts outside its organization",
        )

    # Check token's rights for this action
    if not api_token_user.rights:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="API token has no permissions configured",
        )

    rights = api_token_user.rights
    if isinstance(rights, dict):
        podcasts_rights = rights.get("podcasts", {})
        has_permission = podcasts_rights.get(f"action_{action}", False)
    else:
        podcasts_rights = getattr(rights, "podcasts", None)
        has_permission = getattr(podcasts_rights, f"action_{action}", False) if podcasts_rights else False

    if not has_permission:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"API token does not have '{action}' permission for podcasts",
        )

    return True


async def podcasts_rbac_check(
    request: Request,
    podcast_uuid: str,
    current_user: Union[PublicUser, AnonymousUser, APITokenUser],
    action: Literal["create", "read", "update", "delete"],
    db_session: Session,
    require_podcast_ownership: bool = False,
) -> bool:
    """
    Unified RBAC check for podcasts-related operations.

    SECURITY NOTES:
    - READ operations: Allow if user has read access to the podcast (public podcasts or user has permissions)
    - PODCAST CREATION: Allow if user has instructor role (3) or higher
    - UPDATE/DELETE operations: Require podcast ownership (CREATOR, MAINTAINER, CONTRIBUTOR) or admin/maintainer role
    - Podcast ownership is determined by ResourceAuthor table with ACTIVE status
    - Admin/maintainer roles are checked via authorization_verify_based_on_org_admin_status
    - API tokens: Use token's rights directly, enforcing org boundary
    """

    # Handle API Token users
    if isinstance(current_user, APITokenUser):
        return await _check_api_token_podcasts_permission(
            request, podcast_uuid, current_user, action, db_session
        )

    if action == "read":
        if current_user.id == 0:  # Anonymous user
            return await authorization_verify_if_element_is_public(
                request, podcast_uuid, action, db_session
            )
        else:
            # For authenticated users, first check if podcast is public+published
            # This allows users to view public content even without specific role permissions
            statement = select(Podcast).where(Podcast.podcast_uuid == podcast_uuid)
            podcast = db_session.exec(statement).first()

            if podcast and podcast.public and podcast.published:
                return True

            # If not public, fall back to role-based authorization
            return await authorization_verify_based_on_roles_and_authorship(
                request, current_user.id, action, podcast_uuid, db_session
            )
    else:
        # For non-read actions, proceed with strict RBAC checks
        await authorization_verify_if_user_is_anon(current_user.id)

        # SECURITY: Special handling for podcast creation
        if action == "create" and podcast_uuid == "podcast_x":
            # This is podcast creation - allow instructors (role 3) or higher
            has_create_permission = await authorization_verify_based_on_roles(
                request, current_user.id, "create", "podcast_x", db_session
            )

            if has_create_permission:
                return True
            else:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="You must have instructor role or higher to create podcasts",
                )

        # SECURITY: For podcast content creation and other operations, require podcast ownership
        if require_podcast_ownership or action in ["create", "update", "delete"]:
            # Check if user is podcast owner (CREATOR, MAINTAINER, or CONTRIBUTOR)
            statement = select(ResourceAuthor).where(
                ResourceAuthor.resource_uuid == podcast_uuid,
                ResourceAuthor.user_id == current_user.id
            )
            resource_author = db_session.exec(statement).first()

            is_podcast_owner = False
            if resource_author:
                if ((resource_author.authorship == ResourceAuthorshipEnum.CREATOR) or
                    (resource_author.authorship == ResourceAuthorshipEnum.MAINTAINER) or
                    (resource_author.authorship == ResourceAuthorshipEnum.CONTRIBUTOR)) and \
                    resource_author.authorship_status == ResourceAuthorshipStatusEnum.ACTIVE:
                    is_podcast_owner = True

            # Check if user has admin or maintainer role
            is_admin_or_maintainer = await authorization_verify_based_on_org_admin_status(
                request, current_user.id, action, podcast_uuid, db_session
            )

            # SECURITY: For creating, updating, and deleting podcast content, user MUST be either:
            # 1. Podcast owner (CREATOR, MAINTAINER, or CONTRIBUTOR with ACTIVE status)
            # 2. Admin or maintainer role
            if not (is_podcast_owner or is_admin_or_maintainer):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"You must be the podcast owner (CREATOR, MAINTAINER, or CONTRIBUTOR) or have admin/maintainer role to {action} this podcast",
                )
            return True
        else:
            # For other actions, use the existing RBAC check
            return await authorization_verify_based_on_roles_and_authorship(
                request,
                current_user.id,
                action,
                podcast_uuid,
                db_session,
            )


async def podcasts_rbac_check_with_podcast_lookup(
    request: Request,
    podcast_uuid: str,
    current_user: PublicUser | AnonymousUser,
    action: Literal["create", "read", "update", "delete"],
    db_session: Session,
    require_podcast_ownership: bool = False,
) -> Podcast:
    """
    Unified RBAC check for podcasts-related operations with podcast lookup.

    SECURITY NOTES:
    - First validates that the podcast exists
    - Then performs RBAC check using podcasts_rbac_check
    - Returns the podcast object if authorized
    """

    # First check if podcast exists
    statement = select(Podcast).where(Podcast.podcast_uuid == podcast_uuid)
    podcast = db_session.exec(statement).first()

    if not podcast:
        raise HTTPException(
            status_code=404,
            detail="Podcast not found",
        )

    # Perform RBAC check
    await podcasts_rbac_check(
        request, podcast_uuid, current_user, action, db_session, require_podcast_ownership
    )

    return podcast


async def podcasts_rbac_check_for_episodes(
    request: Request,
    podcast_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    action: Literal["create", "read", "update", "delete"],
    db_session: Session,
) -> bool:
    """
    Specialized RBAC check for episodes that requires podcast ownership for non-read actions.

    SECURITY NOTES:
    - Episodes are core podcast content and require strict ownership controls
    - READ: Allow if user has read access to the podcast
    - CREATE/UPDATE/DELETE: Require podcast ownership (CREATOR, MAINTAINER, CONTRIBUTOR) or admin/maintainer role
    """

    return await podcasts_rbac_check(
        request, podcast_uuid, current_user, action, db_session, require_podcast_ownership=True
    )
