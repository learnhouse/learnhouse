"""
SECURITY DOCUMENTATION FOR COURSES RBAC SYSTEM

This module provides unified RBAC (Role-Based Access Control) checks for all courses-related operations.

SECURITY MEASURES IMPLEMENTED:

1. COURSE OWNERSHIP REQUIREMENTS:
   - All non-read operations (create, update, delete) require course ownership
   - Course ownership is determined by ResourceAuthor table with ACTIVE status
   - Valid ownership roles: CREATOR, MAINTAINER, CONTRIBUTOR
   - Admin/maintainer roles are also accepted for course operations

2. COURSE CREATION VS COURSE CONTENT CREATION:
   - COURSE CREATION: Allow if user has instructor role (3) or higher
   - COURSE CONTENT CREATION (activities, assignments, chapters, etc.): Require course ownership (CREATOR, MAINTAINER, CONTRIBUTOR) or admin/maintainer role
   - This distinction allows instructors to create courses but prevents them from creating content in courses they don't own

3. STRICT ACCESS CONTROLS:
   - Activities: Require course ownership for all non-read operations
   - Assignments: Require course ownership for all non-read operations
   - Chapters: Require course ownership for all non-read operations
   - Certifications: Require course ownership for all non-read operations
   - Collections: Use organization-level permissions

4. GRADING AND SUBMISSION SECURITY:
   - Only course owners or instructors can grade assignments
   - Users can only submit their own work
   - Users cannot update grades unless they are instructors
   - Users can only update their own submissions

5. CERTIFICATE SECURITY:
   - Certificates can only be created by course owners or instructors
   - System-generated certificates (from course completion) are properly secured
   - Certificate creation requires proper RBAC checks

6. ACTIVITY MARKING SECURITY:
   - Only course owners or instructors can mark activities as done for other users
   - Users can only mark their own activities as done

7. COLLECTION SECURITY:
   - Users can only add courses to collections if they have read access to those courses
   - Collection operations require appropriate organization-level permissions

8. ANONYMOUS USER HANDLING:
   - Anonymous users can only read public courses
   - All non-read operations require authentication

9. ERROR HANDLING:
   - Clear error messages for security violations
   - Proper HTTP status codes (401, 403, 404)
   - Comprehensive logging of security events

10. COURSE ACCESS MANAGEMENT SECURITY:
    - Sensitive fields (public, open_to_contributors) require additional validation
    - Only course owners (CREATOR, MAINTAINER) or admins can change access settings
    - Course creation requires proper organization-level permissions
    - Course updates require course ownership or admin role

11. CONTRIBUTOR MANAGEMENT SECURITY:
    - Only course owners (CREATOR, MAINTAINER) or admins can add/remove contributors
    - Only course owners (CREATOR, MAINTAINER) or admins can update contributor roles
    - Cannot modify the role of the course creator
    - Contributor applications are created with PENDING status
    - Only course owners or admins can approve contributor applications

SECURITY BEST PRACTICES:
- Always check course ownership before allowing modifications
- Validate user permissions at multiple levels
- Use proper RBAC checks for all operations
- Implement principle of least privilege
- Provide clear error messages for security violations
- Log security events for audit purposes
- Additional validation for sensitive access control fields
- Strict ownership requirements for contributor management
- Distinguish between course creation and course content creation permissions

CRITICAL SECURITY FIXES:
- Fixed: Users could create certifications for courses they don't own
- Fixed: Users could grade assignments without proper permissions
- Fixed: Users could mark activities as done for other users without permissions
- Fixed: Collections could be created with courses the user doesn't have access to
- Fixed: Assignment submissions could be modified by unauthorized users
- Fixed: Users could change course access settings (public, open_to_contributors) without proper permissions
- Fixed: Users could add/remove contributors from courses they don't own
- Fixed: Users could update contributor roles without course ownership
- Fixed: Course creation used hardcoded RBAC check
- Fixed: Contributor management used permissive RBAC checks instead of strict ownership requirements
- Fixed: Instructors could create content in courses they don't own (now they can only create courses)
"""

from typing import Literal
from fastapi import HTTPException, Request, status
from sqlmodel import Session, select
from src.db.users import AnonymousUser, PublicUser
from src.db.courses.courses import Course
from src.db.resource_authors import ResourceAuthor, ResourceAuthorshipEnum, ResourceAuthorshipStatusEnum
from src.security.rbac.rbac import (
    authorization_verify_based_on_roles_and_authorship,
    authorization_verify_if_element_is_public,
    authorization_verify_if_user_is_anon,
    authorization_verify_based_on_org_admin_status,
)


async def courses_rbac_check(
    request: Request,
    course_uuid: str,
    current_user: PublicUser | AnonymousUser,
    action: Literal["create", "read", "update", "delete"],
    db_session: Session,
    require_course_ownership: bool = False,
) -> bool:
    """
    Unified RBAC check for courses-related operations.
    
    SECURITY NOTES:
    - READ operations: Allow if user has read access to the course (public courses or user has permissions)
    - COURSE CREATION: Allow if user has instructor role (3) or higher
    - COURSE CONTENT CREATION (activities, assignments, chapters, etc.): Require course ownership (CREATOR, MAINTAINER, CONTRIBUTOR) or admin/maintainer role
    - UPDATE/DELETE operations: Require course ownership (CREATOR, MAINTAINER, CONTRIBUTOR) or admin/maintainer role
    - Course ownership is determined by ResourceAuthor table with ACTIVE status
    - Admin/maintainer roles are checked via authorization_verify_based_on_org_admin_status
    
    Args:
        request: FastAPI request object
        course_uuid: UUID of the course (or "course_x" for course creation)
        current_user: Current user (PublicUser or AnonymousUser)
        action: Action to perform (create, read, update, delete)
        db_session: Database session
        require_course_ownership: If True, requires course ownership for non-read actions
    
    Returns:
        bool: True if authorized, raises HTTPException otherwise
    
    Raises:
        HTTPException: 403 Forbidden if user lacks required permissions
        HTTPException: 401 Unauthorized if user is anonymous for non-read actions
    """
    
    if action == "read":
        if current_user.id == 0:  # Anonymous user
            return await authorization_verify_if_element_is_public(
                request, course_uuid, action, db_session
            )
        else:
            return await authorization_verify_based_on_roles_and_authorship(
                request, current_user.id, action, course_uuid, db_session
            )
    else:
        # For non-read actions, proceed with strict RBAC checks
        await authorization_verify_if_user_is_anon(current_user.id)
        
        # SECURITY: Special handling for course creation vs course content creation
        if action == "create" and course_uuid == "course_x":
            # This is course creation - allow instructors (role 3) or higher
            # Check if user has instructor role or higher
            from src.security.rbac.rbac import authorization_verify_based_on_roles
            
            has_create_permission = await authorization_verify_based_on_roles(
                request, current_user.id, "create", "course_x", db_session
            )
            
            if has_create_permission:
                return True
            else:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="You must have instructor role or higher to create courses",
                )
        
        # SECURITY: For course content creation and other operations, require course ownership
        # This prevents users without course ownership from creating/modifying course content
        if require_course_ownership or action in ["create", "update", "delete"]:
            # Check if user is course owner (CREATOR, MAINTAINER, or CONTRIBUTOR)
            statement = select(ResourceAuthor).where(
                ResourceAuthor.resource_uuid == course_uuid,
                ResourceAuthor.user_id == current_user.id
            )
            resource_author = db_session.exec(statement).first()
            
            is_course_owner = False
            if resource_author:
                if ((resource_author.authorship == ResourceAuthorshipEnum.CREATOR) or 
                    (resource_author.authorship == ResourceAuthorshipEnum.MAINTAINER) or 
                    (resource_author.authorship == ResourceAuthorshipEnum.CONTRIBUTOR)) and \
                    resource_author.authorship_status == ResourceAuthorshipStatusEnum.ACTIVE:
                    is_course_owner = True
            
            # Check if user has admin or maintainer role
            is_admin_or_maintainer = await authorization_verify_based_on_org_admin_status(
                request, current_user.id, action, course_uuid, db_session
            )
            
            # SECURITY: For creating, updating, and deleting course content, user MUST be either:
            # 1. Course owner (CREATOR, MAINTAINER, or CONTRIBUTOR with ACTIVE status)
            # 2. Admin or maintainer role
            # General role permissions are NOT sufficient for these actions
            if not (is_course_owner or is_admin_or_maintainer):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"You must be the course owner (CREATOR, MAINTAINER, or CONTRIBUTOR) or have admin/maintainer role to {action} in this course",
                )
            return True
        else:
            # For other actions, use the existing RBAC check
            return await authorization_verify_based_on_roles_and_authorship(
                request,
                current_user.id,
                action,
                course_uuid,
                db_session,
            )


async def courses_rbac_check_with_course_lookup(
    request: Request,
    course_uuid: str,
    current_user: PublicUser | AnonymousUser,
    action: Literal["create", "read", "update", "delete"],
    db_session: Session,
    require_course_ownership: bool = False,
) -> Course:
    """
    Unified RBAC check for courses-related operations with course lookup.
    
    SECURITY NOTES:
    - First validates that the course exists
    - Then performs RBAC check using courses_rbac_check
    - Returns the course object if authorized
    
    Args:
        request: FastAPI request object
        course_uuid: UUID of the course
        current_user: Current user (PublicUser or AnonymousUser)
        action: Action to perform (create, read, update, delete)
        db_session: Database session
        require_course_ownership: If True, requires course ownership for non-read actions
    
    Returns:
        Course: The course object if authorized, raises HTTPException otherwise
    
    Raises:
        HTTPException: 404 Not Found if course doesn't exist
        HTTPException: 403 Forbidden if user lacks required permissions
    """
    
    # First check if course exists
    statement = select(Course).where(Course.course_uuid == course_uuid)
    course = db_session.exec(statement).first()
    
    if not course:
        raise HTTPException(
            status_code=404,
            detail="Course not found",
        )
    
    # Perform RBAC check
    await courses_rbac_check(
        request, course_uuid, current_user, action, db_session, require_course_ownership
    )
    
    return course


async def courses_rbac_check_for_activities(
    request: Request,
    course_uuid: str,
    current_user: PublicUser | AnonymousUser,
    action: Literal["create", "read", "update", "delete"],
    db_session: Session,
) -> bool:
    """
    Specialized RBAC check for activities that requires course ownership for non-read actions.
    
    SECURITY NOTES:
    - Activities are core course content and require strict ownership controls
    - READ: Allow if user has read access to the course
    - CREATE/UPDATE/DELETE: Require course ownership (CREATOR, MAINTAINER, CONTRIBUTOR) or admin/maintainer role
    - This prevents unauthorized users from creating/modifying course activities
    - Instructors can create courses but cannot create activities in courses they don't own
    """
    
    return await courses_rbac_check(
        request, course_uuid, current_user, action, db_session, require_course_ownership=True
    )


async def courses_rbac_check_for_assignments(
    request: Request,
    course_uuid: str,
    current_user: PublicUser | AnonymousUser,
    action: Literal["create", "read", "update", "delete"],
    db_session: Session,
) -> bool:
    """
    Specialized RBAC check for assignments that requires course ownership for non-read actions.
    
    SECURITY NOTES:
    - Assignments are course content and require strict ownership controls
    - READ: Allow if user has read access to the course
    - CREATE/UPDATE/DELETE: Require course ownership (CREATOR, MAINTAINER, CONTRIBUTOR) or admin/maintainer role
    - This prevents unauthorized users from creating/modifying course assignments
    - Instructors can create courses but cannot create assignments in courses they don't own
    """
    
    return await courses_rbac_check(
        request, course_uuid, current_user, action, db_session, require_course_ownership=True
    )


async def courses_rbac_check_for_chapters(
    request: Request,
    course_uuid: str,
    current_user: PublicUser | AnonymousUser,
    action: Literal["create", "read", "update", "delete"],
    db_session: Session,
) -> bool:
    """
    Specialized RBAC check for chapters that requires course ownership for non-read actions.
    
    SECURITY NOTES:
    - Chapters are course structure and require strict ownership controls
    - READ: Allow if user has read access to the course
    - CREATE/UPDATE/DELETE: Require course ownership (CREATOR, MAINTAINER, CONTRIBUTOR) or admin/maintainer role
    - This prevents unauthorized users from creating/modifying course chapters
    - Instructors can create courses but cannot create chapters in courses they don't own
    """
    
    return await courses_rbac_check(
        request, course_uuid, current_user, action, db_session, require_course_ownership=True
    )


async def courses_rbac_check_for_certifications(
    request: Request,
    course_uuid: str,
    current_user: PublicUser | AnonymousUser,
    action: Literal["create", "read", "update", "delete"],
    db_session: Session,
) -> bool:
    """
    Specialized RBAC check for certifications that requires course ownership for non-read actions.
    
    SECURITY NOTES:
    - Certifications are course credentials and require strict ownership controls
    - READ: Allow if user has read access to the course
    - CREATE/UPDATE/DELETE: Require course ownership (CREATOR, MAINTAINER, CONTRIBUTOR) or admin/maintainer role
    - This prevents unauthorized users from creating/modifying course certifications
    - CRITICAL: Without this check, users could create certifications for courses they don't own
    - Instructors can create courses but cannot create certifications in courses they don't own
    """
    
    return await courses_rbac_check(
        request, course_uuid, current_user, action, db_session, require_course_ownership=True
    )


async def courses_rbac_check_for_collections(
    request: Request,
    collection_uuid: str,
    current_user: PublicUser | AnonymousUser,
    action: Literal["create", "read", "update", "delete"],
    db_session: Session,
) -> bool:
    """
    Specialized RBAC check for collections.
    
    SECURITY NOTES:
    - Collections are course groupings and require appropriate access controls
    - READ: Allow if collection is public or user has read access
    - CREATE/UPDATE/DELETE: Require appropriate permissions based on collection ownership
    - Collections may have different ownership models than courses
    
    Args:
        request: FastAPI request object
        collection_uuid: UUID of the collection
        current_user: Current user (PublicUser or AnonymousUser)
        action: Action to perform (create, read, update, delete)
        db_session: Database session
    
    Returns:
        bool: True if authorized, raises HTTPException otherwise
    """
    
    if action == "read":
        if current_user.id == 0:  # Anonymous user
            res = await authorization_verify_if_element_is_public(
                request, collection_uuid, action, db_session
            )
            if res == False:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="User rights : You are not allowed to read this collection",
                )
            return res
        else:
            return await authorization_verify_based_on_roles_and_authorship(
                request, current_user.id, action, collection_uuid, db_session
            )
    else:
        await authorization_verify_if_user_is_anon(current_user.id)
        
        return await authorization_verify_based_on_roles_and_authorship(
            request,
            current_user.id,
            action,
            collection_uuid,
            db_session,
        ) 