from fastapi import APIRouter, Depends, Request, HTTPException
from sqlmodel import Session
from src.core.events.database import get_db_session
from src.db.roles import RoleCreate, RoleRead, RoleUpdate
from src.security.auth import get_current_user
from src.services.roles.roles import create_role, delete_role, read_role, update_role, get_roles_by_organization
from src.db.users import PublicUser
from src.security.features_utils.plan_check import require_plan
from typing import List


router = APIRouter()


@router.post(
    "/org/{org_id}",
    dependencies=[Depends(require_plan("pro", "Create Role"))],
    response_model=RoleRead,
    summary="Create role",
    description="Create a new role for a specific organization. Requires the Pro plan feature flag.",
    responses={
        200: {"description": "Role created successfully.", "model": RoleRead},
        401: {"description": "Authentication required"},
        403: {"description": "Plan does not permit creating roles, or caller lacks permission"},
    },
)
async def api_create_role(
    request: Request,
    org_id: int,
    role_object: RoleCreate,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
)-> RoleRead:
    """
    Create new role for a specific organization
    """
    # Set the org_id in the role object
    role_object.org_id = org_id
    return await create_role(request, db_session, role_object, current_user)


@router.get(
    "/org/{org_id}",
    response_model=List[RoleRead],
    summary="List roles for organization",
    description="Get all roles for a specific organization, including global roles available to every org.",
    responses={
        200: {"description": "List of roles (custom + global) available to the organization."},
        401: {"description": "Authentication required"},
    },
)
async def api_get_roles_by_organization(
    request: Request,
    org_id: int,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
)-> List[RoleRead]:
    """
    Get all roles for a specific organization, including global roles
    """
    return await get_roles_by_organization(request, db_session, org_id, current_user)


@router.get(
    "/{role_id}",
    response_model=RoleRead,
    summary="Get role",
    description="Get a single role by its role_id.",
    responses={
        200: {"description": "Role details.", "model": RoleRead},
        401: {"description": "Authentication required"},
    },
)
async def api_get_role(
    request: Request,
    role_id: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
)-> RoleRead:
    """
    Get single role by role_id
    """
    return await read_role(request, db_session, role_id, current_user)


@router.put(
    "/{role_id}",
    response_model=RoleRead,
    summary="Update role",
    description="Update a role by its role_id. The role_id path parameter must be numeric.",
    responses={
        200: {"description": "Role updated successfully.", "model": RoleRead},
        400: {"description": "Invalid role ID format (must be numeric)"},
        401: {"description": "Authentication required"},
    },
)
async def api_update_role(
    request: Request,
    role_id: str,
    role_object: RoleUpdate,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
)-> RoleRead:
    """
    Update role by role_id
    """
    # Convert role_id to integer and set it in the role_object
    try:
        role_id_int = int(role_id)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail="Invalid role ID format. Role ID must be a number.",
        )
    
    role_object.role_id = role_id_int
    return await update_role(request, db_session, role_object, current_user)


@router.delete(
    "/{role_id}",
    summary="Delete role",
    description="Delete a role by its role_id. Deletion is permanent.",
    responses={
        200: {"description": "Role deleted successfully."},
        401: {"description": "Authentication required"},
    },
)
async def api_delete_role(
    request: Request,
    role_id: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Delete role by ID
    """

    return await delete_role(request, db_session, role_id, current_user)
