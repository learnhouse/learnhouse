from fastapi import Depends, FastAPI, APIRouter
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel
from src.dependencies.auth import *
from src.services.users import *




router = APIRouter()

# DEPRECATED
@router.get("/me")
async def api_get_current_user_old(current_user: User = Depends(get_current_user)):
    """
    Get current user
    """
    return current_user.dict()

@router.get("/profile")
async def api_get_current_user(current_user: User = Depends(get_current_user)):
    """
    Get current user
    """
    return current_user.dict()


@router.get("/username/{username}")
async def api_get_user_by_username(username: str):
    """
    Get single user by username
    """
    return await get_user(username)


@router.get("/user_id/{user_id}")
async def api_get_user_by_userid(user_id: str):
    """
    Get single user by user_id
    """
    return await get_user_by_userid(user_id)


@router.post("/")
async def api_create_user(user_object: UserWithPassword):
    """
    Create new user
    """
    return await create_user(user_object)


@router.delete("/user_id/{user_id}")
async def api_delete_user(user_id: str):
    """
    Delete user by ID
    """

    return await delete_user(user_id)


@router.put("/user_id/{user_id}")
async def api_update_user(user_object: UserWithPassword, user_id: str):
    """
    Update user by ID
    """
    return await update_user(user_id, user_object)
