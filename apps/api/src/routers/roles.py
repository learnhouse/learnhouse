from fastapi import APIRouter, Depends, Request
from sqlmodel import Session
from src.core.events.database import get_db_session
from src.db.roles import RoleCreate, RoleUpdate
from src.security.auth import get_current_user
from src.services.roles.schemas.roles import Role
from src.services.roles.roles import create_role, delete_role, read_role, update_role
from src.services.users.schemas.users import PublicUser


router = APIRouter()


@router.post("/")
async def api_create_role(
    request: Request,
    role_object: RoleCreate,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Create new role
    """
    return await create_role(request, db_session, role_object, current_user)


@router.get("/{role_id}")
async def api_get_role(
    request: Request,
    role_id: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Get single role by role_id
    """
    return await read_role(request, db_session, role_id, current_user)


@router.put("/{role_id}")
async def api_update_role(
    request: Request,
    role_object: RoleUpdate,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Update role by role_id
    """
    return await update_role(request, db_session, role_object, current_user)


@router.delete("/{role_id}")
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
