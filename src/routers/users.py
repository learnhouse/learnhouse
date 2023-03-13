from fastapi import Depends, FastAPI, APIRouter
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel
from src.dependencies.auth import *
from src.services.users import *




router = APIRouter()


@router.get("/profile")
async def api_get_current_user(current_user: User = Depends(get_current_user)):
    """
    Get current user
    """
    return current_user.dict()

@router.get("/profile_metadata")
async def api_get_current_user_metadata(request: Request,current_user: User = Depends(get_current_user)):
    """
    Get current user
    """
    return await get_profile_metadata(request , current_user.dict())


@router.get("/username/{username}")
async def api_get_user_by_username(request: Request, username: str):
    """
    Get single user by username
    """
    return await get_user(request, username)


@router.get("/user_id/{user_id}")
async def api_get_user_by_userid(request: Request,user_id: str):
    """
    Get single user by user_id
    """
    return await get_user_by_userid(request, user_id)


@router.post("/")
async def api_create_user(request: Request,user_object: UserWithPassword):
    """
    Create new user
    """
    return await create_user(request, user_object)


@router.delete("/user_id/{user_id}")
async def api_delete_user(request: Request, user_id: str):
    """
    Delete user by ID
    """

    return await delete_user(request, user_id)


@router.put("/user_id/{user_id}")
async def api_update_user(request: Request, user_object: User, user_id: str):
    """
    Update user by ID
    """
    return await update_user(request, user_id, user_object)
