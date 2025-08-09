from typing import Literal, List
from uuid import uuid4
from sqlmodel import Session, select, text
from sqlalchemy.exc import IntegrityError
from src.security.rbac.rbac import (
    authorization_verify_based_on_roles_and_authorship,
    authorization_verify_if_user_is_anon,
)
from src.db.users import AnonymousUser, PublicUser
from src.db.roles import Role, RoleCreate, RoleRead, RoleUpdate, RoleTypeEnum
from src.db.organizations import Organization
from src.db.user_organizations import UserOrganization
from fastapi import HTTPException, Request
from datetime import datetime


async def create_role(
    request: Request,
    db_session: Session,
    role_object: RoleCreate,
    current_user: PublicUser,
):
    role = Role.model_validate(role_object)

    # RBAC check
    await rbac_check(request, current_user, "create", "role_xxx", db_session)

    # ============================================================================
    # VERIFICATION 1: Ensure the role is created as TYPE_ORGANIZATION and has an org_id
    # ============================================================================
    if not role.org_id:
        raise HTTPException(
            status_code=400,
            detail="Organization ID is required for role creation",
        )
    
    # Force the role type to be TYPE_ORGANIZATION for user-created roles
    role.role_type = RoleTypeEnum.TYPE_ORGANIZATION

    # ============================================================================
    # VERIFICATION 2: Check if the organization exists
    # ============================================================================
    statement = select(Organization).where(Organization.id == role.org_id)
    organization = db_session.exec(statement).first()
    
    if not organization:
        raise HTTPException(
            status_code=404,
            detail="Organization not found",
        )

    # ============================================================================
    # VERIFICATION 3: Check if the current user is a member of the organization
    # ============================================================================
    statement = select(UserOrganization).where(
        UserOrganization.user_id == current_user.id,
        UserOrganization.org_id == role.org_id
    )
    user_org = db_session.exec(statement).first()
    
    if not user_org:
        raise HTTPException(
            status_code=403,
            detail="You are not a member of this organization",
        )

    # ============================================================================
    # VERIFICATION 4: Check if the user has permission to create roles in this organization
    # ============================================================================
    # Get the user's role in this organization
    statement = select(Role).where(Role.id == user_org.role_id)
    user_role = db_session.exec(statement).first()
    
    if not user_role:
        raise HTTPException(
            status_code=403,
            detail="Your role in this organization could not be determined",
        )

    # Check if the user has role creation permissions
    if user_role.rights and isinstance(user_role.rights, dict):
        roles_rights = user_role.rights.get('roles', {})
        if not roles_rights.get('action_create', False):
            raise HTTPException(
                status_code=403,
                detail="You don't have permission to create roles in this organization",
            )
    else:
        # If no rights are defined, check if user has admin role (role_id 1 or 2)
        if user_role.id not in [1, 2]:  # Admin and Maintainer roles
            raise HTTPException(
                status_code=403,
                detail="You don't have permission to create roles in this organization. Admin or Maintainer role required.",
            )

    # ============================================================================
    # VERIFICATION 5: Check if a role with the same name already exists in this organization
    # ============================================================================
    statement = select(Role).where(
        Role.name == role.name,
        Role.org_id == role.org_id,
        Role.role_type == RoleTypeEnum.TYPE_ORGANIZATION
    )
    existing_role = db_session.exec(statement).first()
    
    if existing_role:
        raise HTTPException(
            status_code=409,
            detail=f"A role with the name '{role.name}' already exists in this organization",
        )

    # ============================================================================
    # VERIFICATION 6: Validate role name and description
    # ============================================================================
    if not role.name or role.name.strip() == "":
        raise HTTPException(
            status_code=400,
            detail="Role name is required and cannot be empty",
        )
    
    if len(role.name.strip()) > 100:  # Assuming a reasonable limit
        raise HTTPException(
            status_code=400,
            detail="Role name cannot exceed 100 characters",
        )

    # ============================================================================
    # VERIFICATION 7: Validate rights structure if provided
    # ============================================================================
    if role.rights:
        # Convert Rights model to dict if needed
        if isinstance(role.rights, dict):
            # It's already a dict
            rights_dict = role.rights
        else:
            # It's likely a Pydantic model, try to convert to dict
            try:
                # Try dict() method first (for Pydantic v1)
                rights_dict = role.rights.dict()
            except AttributeError:
                try:
                    # Try model_dump() method (for Pydantic v2)
                    rights_dict = role.rights.model_dump()  # type: ignore
                except AttributeError:
                    raise HTTPException(
                        status_code=400,
                        detail="Rights must be provided as a JSON object",
                    )
        
        # Validate rights structure - check for required top-level keys
        required_rights = [
            'courses', 'users', 'usergroups', 'collections', 
            'organizations', 'coursechapters', 'activities', 
            'roles', 'dashboard'
        ]
        
        for required_right in required_rights:
            if required_right not in rights_dict:
                raise HTTPException(
                    status_code=400,
                    detail=f"Missing required right: {required_right}",
                )
            
            # Validate the structure of each right
            right_data = rights_dict[required_right]
            if not isinstance(right_data, dict):
                raise HTTPException(
                    status_code=400,
                    detail=f"Right '{required_right}' must be a JSON object",
                )
            
            # Validate courses permissions (has additional 'own' permissions)
            if required_right == 'courses':
                required_course_permissions = [
                    'action_create', 'action_read', 'action_read_own', 
                    'action_update', 'action_update_own', 'action_delete', 'action_delete_own'
                ]
                for perm in required_course_permissions:
                    if perm not in right_data:
                        raise HTTPException(
                            status_code=400,
                            detail=f"Missing required course permission: {perm}",
                        )
                    if not isinstance(right_data[perm], bool):
                        raise HTTPException(
                            status_code=400,
                            detail=f"Course permission '{perm}' must be a boolean",
                        )
            
            # Validate other permissions (standard permissions)
            elif required_right in ['users', 'usergroups', 'collections', 'organizations', 'coursechapters', 'activities', 'roles']:
                required_permissions = ['action_create', 'action_read', 'action_update', 'action_delete']
                for perm in required_permissions:
                    if perm not in right_data:
                        raise HTTPException(
                            status_code=400,
                            detail=f"Missing required permission '{perm}' for '{required_right}'",
                        )
                    if not isinstance(right_data[perm], bool):
                        raise HTTPException(
                            status_code=400,
                            detail=f"Permission '{perm}' for '{required_right}' must be a boolean",
                        )
            
            # Validate dashboard permissions
            elif required_right == 'dashboard':
                if 'action_access' not in right_data:
                    raise HTTPException(
                        status_code=400,
                        detail="Missing required dashboard permission: action_access",
                    )
                if not isinstance(right_data['action_access'], bool):
                    raise HTTPException(
                        status_code=400,
                        detail="Dashboard permission 'action_access' must be a boolean",
                    )
        
        # Convert back to dict if it was a model
        if not isinstance(role.rights, dict):
            role.rights = rights_dict

    # ============================================================================
    # VERIFICATION 8: Ensure user cannot create a role with higher permissions than they have
    # ============================================================================
    if role.rights and isinstance(role.rights, dict) and user_role.rights and isinstance(user_role.rights, dict):
        # Check if the new role has any permissions that the user doesn't have
        for right_key, right_permissions in role.rights.items():
            if right_key in user_role.rights:
                user_right_permissions = user_role.rights[right_key]
                
                # Check each permission in the right
                for perm_key, perm_value in right_permissions.items():
                    if isinstance(perm_value, bool) and perm_value:  # If the new role has this permission enabled
                        if isinstance(user_right_permissions, dict) and perm_key in user_right_permissions:
                            user_has_perm = user_right_permissions[perm_key]
                            if not user_has_perm:
                                raise HTTPException(
                                    status_code=403,
                                    detail=f"You cannot create a role with '{perm_key}' permission for '{right_key}' as you don't have this permission yourself",
                                )
                        else:
                            raise HTTPException(
                                status_code=403,
                                detail=f"You cannot create a role with '{perm_key}' permission for '{right_key}' as you don't have this permission yourself",
                            )

    # Complete the role object
    role.role_uuid = f"role_{uuid4()}"
    role.creation_date = str(datetime.now())
    role.update_date = str(datetime.now())

    # ============================================================================
    # VERIFICATION 9: Handle ID sequence issue (existing logic)
    # ============================================================================
    try:
        db_session.add(role)
        db_session.commit()
        db_session.refresh(role)
    except IntegrityError as e:
        if "duplicate key value violates unique constraint" in str(e) and "role_pkey" in str(e):
            # Handle the sequence issue by finding the next available ID
            db_session.rollback()
            
            # Get the maximum ID from the role table using raw SQL
            result = db_session.execute(text("SELECT COALESCE(MAX(id), 0) as max_id FROM role"))
            max_id_result = result.scalar()
            max_id = max_id_result if max_id_result is not None else 0
            
            # Set the next available ID
            role.id = max_id + 1
            
            # Try to insert again
            db_session.add(role)
            db_session.commit()
            db_session.refresh(role)
            
            # Update the sequence to the correct value for future inserts
            try:
                # Use raw SQL to update the sequence
                db_session.execute(text(f"SELECT setval('role_id_seq', {max_id + 1}, true)"))
                db_session.commit()
            except Exception:
                # If sequence doesn't exist or can't be updated, that's okay
                # The manual ID assignment above will handle it
                pass
        else:
            # Re-raise the original exception if it's not the sequence issue
            raise e

    # Create RoleRead object with all required fields
    role_data = role.model_dump()
    # Ensure org_id is properly handled
    if role_data.get('org_id') is None:
        role_data['org_id'] = 0
    role = RoleRead(**role_data)

    return role


async def get_roles_by_organization(
    request: Request,
    db_session: Session,
    org_id: int,
    current_user: PublicUser,
) -> List[RoleRead]:
    """
    Get all roles for a specific organization, including global roles.
    
    Args:
        request: FastAPI request object
        db_session: Database session
        org_id: Organization ID
        current_user: Current authenticated user
        
    Returns:
        List[RoleRead]: List of roles for the organization (including global roles)
        
    Raises:
        HTTPException: If organization not found or user lacks permissions
    """
    # ============================================================================
    # VERIFICATION 1: Check if the organization exists
    # ============================================================================
    statement = select(Organization).where(Organization.id == org_id)
    organization = db_session.exec(statement).first()
    
    if not organization:
        raise HTTPException(
            status_code=404,
            detail="Organization not found",
        )

    # ============================================================================
    # VERIFICATION 2: Check if the current user is a member of the organization
    # ============================================================================
    statement = select(UserOrganization).where(
        UserOrganization.user_id == current_user.id,
        UserOrganization.org_id == org_id
    )
    user_org = db_session.exec(statement).first()
    
    if not user_org:
        raise HTTPException(
            status_code=403,
            detail="You are not a member of this organization",
        )

    # ============================================================================
    # VERIFICATION 3: Check if the user has permission to read roles in this organization
    # ============================================================================
    # Get the user's role in this organization
    statement = select(Role).where(Role.id == user_org.role_id)
    user_role = db_session.exec(statement).first()
    
    if not user_role:
        raise HTTPException(
            status_code=403,
            detail="Your role in this organization could not be determined",
        )

    # Check if the user has role reading permissions
    if user_role.rights and isinstance(user_role.rights, dict):
        roles_rights = user_role.rights.get('roles', {})
        if not roles_rights.get('action_read', False):
            raise HTTPException(
                status_code=403,
                detail="You don't have permission to read roles in this organization",
            )
    else:
        # If no rights are defined, check if user has admin role (role_id 1 or 2)
        if user_role.id not in [1, 2]:  # Admin and Maintainer roles
            raise HTTPException(
                status_code=403,
                detail="You don't have permission to read roles in this organization. Admin or Maintainer role required.",
            )

    # ============================================================================
    # GET ROLES: Fetch all roles for the organization AND global roles
    # ============================================================================
    # Get global roles first
    global_roles_statement = select(Role).where(
        Role.role_type == RoleTypeEnum.TYPE_GLOBAL
    ).order_by(Role.id)  # type: ignore
    
    global_roles = list(db_session.exec(global_roles_statement).all())
    
    # Get organization-specific roles
    org_roles_statement = select(Role).where(
        Role.org_id == org_id,
        Role.role_type == RoleTypeEnum.TYPE_ORGANIZATION
    ).order_by(Role.id)  # type: ignore
    
    org_roles = list(db_session.exec(org_roles_statement).all())
    
    # Combine lists with global roles first, then organization roles
    all_roles = global_roles + org_roles
    
    # Convert to RoleRead objects
    role_reads = []
    for role in all_roles:
        role_data = role.model_dump()
        # Ensure org_id is properly handled
        if role_data.get('org_id') is None:
            role_data['org_id'] = 0
        role_reads.append(RoleRead(**role_data))
    
    return role_reads


async def read_role(
    request: Request, db_session: Session, role_id: str, current_user: PublicUser
):
    # Convert role_id to integer
    try:
        role_id_int = int(role_id)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail="Invalid role ID format. Role ID must be a number.",
        )
    
    statement = select(Role).where(Role.id == role_id_int)
    result = db_session.exec(statement)

    role = result.first()

    if not role:
        raise HTTPException(
            status_code=404,
            detail="Role not found",
        )

    # RBAC check
    await rbac_check(request, current_user, "read", role.role_uuid, db_session)

    role = RoleRead(**role.model_dump())

    return role


async def update_role(
    request: Request,
    db_session: Session,
    role_object: RoleUpdate,
    current_user: PublicUser,
):
    statement = select(Role).where(Role.id == role_object.role_id)
    result = db_session.exec(statement)

    role = result.first()

    if not role:
        raise HTTPException(
            status_code=404,
            detail="Role not found",
        )

    # ============================================================================
    # VERIFICATION: Prevent updating TYPE_GLOBAL roles
    # ============================================================================
    if role.role_type == RoleTypeEnum.TYPE_GLOBAL:
        raise HTTPException(
            status_code=403,
            detail="Global roles cannot be updated. These are system-defined roles that must remain unchanged.",
        )

    # RBAC check
    await rbac_check(request, current_user, "update", role.role_uuid, db_session)

    # Complete the role object
    role.update_date = str(datetime.now())

    # Remove the role_id from the role_object
    del role_object.role_id

    # Update only the fields that were passed in
    # Use model_dump() to get the data as a dictionary
    try:
        update_data = role_object.model_dump(exclude_unset=True)
    except AttributeError:
        # Fallback to dict() method for older Pydantic versions
        try:
            update_data = role_object.dict(exclude_unset=True)
        except AttributeError:
            # Fallback to vars() for SQLModel
            update_data = {k: v for k, v in vars(role_object).items() if v is not None}
    
    # Update the role with the new data
    for key, value in update_data.items():
        if value is not None:
            setattr(role, key, value)

    # ============================================================================
    # VALIDATE RIGHTS STRUCTURE if rights are being updated
    # ============================================================================
    if role.rights:
        # Convert Rights model to dict if needed
        if isinstance(role.rights, dict):
            # It's already a dict
            rights_dict = role.rights
        else:
            # It's likely a Pydantic model, try to convert to dict
            try:
                # Try dict() method first (for Pydantic v1)
                rights_dict = role.rights.dict()
            except AttributeError:
                try:
                    # Try model_dump() method (for Pydantic v2)
                    rights_dict = role.rights.model_dump()  # type: ignore
                except AttributeError:
                    raise HTTPException(
                        status_code=400,
                        detail="Rights must be provided as a JSON object",
                    )
        
        # Validate rights structure - check for required top-level keys
        required_rights = [
            'courses', 'users', 'usergroups', 'collections', 
            'organizations', 'coursechapters', 'activities', 
            'roles', 'dashboard'
        ]
        
        for required_right in required_rights:
            if required_right not in rights_dict:
                raise HTTPException(
                    status_code=400,
                    detail=f"Missing required right: {required_right}",
                )
            
            # Validate the structure of each right
            right_data = rights_dict[required_right]
            if not isinstance(right_data, dict):
                raise HTTPException(
                    status_code=400,
                    detail=f"Right '{required_right}' must be a JSON object",
                )
            
            # Validate courses permissions (has additional 'own' permissions)
            if required_right == 'courses':
                required_course_permissions = [
                    'action_create', 'action_read', 'action_read_own', 
                    'action_update', 'action_update_own', 'action_delete', 'action_delete_own'
                ]
                for perm in required_course_permissions:
                    if perm not in right_data:
                        raise HTTPException(
                            status_code=400,
                            detail=f"Missing required course permission: {perm}",
                        )
                    if not isinstance(right_data[perm], bool):
                        raise HTTPException(
                            status_code=400,
                            detail=f"Course permission '{perm}' must be a boolean",
                        )
            
            # Validate other permissions (standard permissions)
            elif required_right in ['users', 'usergroups', 'collections', 'organizations', 'coursechapters', 'activities', 'roles']:
                required_permissions = ['action_create', 'action_read', 'action_update', 'action_delete']
                for perm in required_permissions:
                    if perm not in right_data:
                        raise HTTPException(
                            status_code=400,
                            detail=f"Missing required permission '{perm}' for '{required_right}'",
                        )
                    if not isinstance(right_data[perm], bool):
                        raise HTTPException(
                            status_code=400,
                            detail=f"Permission '{perm}' for '{required_right}' must be a boolean",
                        )
            
            # Validate dashboard permissions
            elif required_right == 'dashboard':
                if 'action_access' not in right_data:
                    raise HTTPException(
                        status_code=400,
                        detail="Missing required dashboard permission: action_access",
                    )
                if not isinstance(right_data['action_access'], bool):
                    raise HTTPException(
                        status_code=400,
                        detail="Dashboard permission 'action_access' must be a boolean",
                    )
        
        # Convert back to dict if it was a model
        if not isinstance(role.rights, dict):
            role.rights = rights_dict

    db_session.add(role)
    db_session.commit()
    db_session.refresh(role)

    role = RoleRead(**role.model_dump())

    return role


async def delete_role(
    request: Request, db_session: Session, role_id: str, current_user: PublicUser
):
    # Convert role_id to integer
    try:
        role_id_int = int(role_id)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail="Invalid role ID format. Role ID must be a number.",
        )
    
    # First, get the role to check if it exists and get its UUID
    statement = select(Role).where(Role.id == role_id_int)
    result = db_session.exec(statement)

    role = result.first()

    if not role:
        raise HTTPException(
            status_code=404,
            detail="Role not found",
        )

    # ============================================================================
    # VERIFICATION: Prevent deleting TYPE_GLOBAL roles
    # ============================================================================
    if role.role_type == RoleTypeEnum.TYPE_GLOBAL:
        raise HTTPException(
            status_code=403,
            detail="Global roles cannot be deleted. These are system-defined roles that must remain unchanged.",
        )

    # RBAC check using the role's UUID
    await rbac_check(request, current_user, "delete", role.role_uuid, db_session)

    db_session.delete(role)
    db_session.commit()

    return "Role deleted"


## 🔒 RBAC Utils ##


async def rbac_check(
    request: Request,
    current_user: PublicUser | AnonymousUser,
    action: Literal["create", "read", "update", "delete"],
    role_uuid: str,
    db_session: Session,
):
    await authorization_verify_if_user_is_anon(current_user.id)

    await authorization_verify_based_on_roles_and_authorship(
        request, current_user.id, action, role_uuid, db_session
    )


## 🔒 RBAC Utils ##
