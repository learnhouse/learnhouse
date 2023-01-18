from fastapi import APIRouter, Depends, Request
from src.dependencies.auth import get_current_user
from src.services.roles import Role, create_role, delete_role, get_role, get_roles, update_role
from src.services.users import PublicUser, User


router = APIRouter()


@router.post("/")
async def api_create_role(request: Request,role_object: Role, current_user: PublicUser = Depends(get_current_user)):
    """
    Create new role
    """
    return await create_role(request, role_object, current_user)


@router.get("/{role_id}")
async def api_get_role(request: Request,role_id: str):
    """
    Get single role by role_id
    """
    return await get_role(request, role_id)


@router.get("/page/{page}/limit/{limit}")
async def api_get_role_by(request: Request,page: int, limit: int):
    """
    Get roles by page and limit
    """
    return await get_roles(request, page, limit)


@router.put("/{role_id}")
async def api_update_role(request: Request,role_object: Role, role_id: str, current_user: PublicUser = Depends(get_current_user)):
    """
    Update role by role_id
    """
    return await update_role(request, role_object, role_id, current_user)


@router.delete("/{role_id}")
async def api_delete_role(request: Request,role_id: str, current_user: PublicUser = Depends(get_current_user)):
    """
    Delete role by ID
    """

    return await delete_role(request, role_id, current_user)
