from fastapi import Depends, FastAPI, APIRouter
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel
from src.services.auth import *
from src.services.users import *

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/token")


router = APIRouter()


@router.get("/me")
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


@router.post("/")
async def api_create_user(user_object: UserInDB):
    """
    Create new user
    """
    return await create_user(user_object)


@router.delete("/username/{username}")
async def api_delete_user(username: str):
    """
    Delete user by ID
    """
    
    return await delete_user(username)


@router.put("/username/{username}")
async def api_update_user(user_object: UserInDB):
    """
    Update user by ID
    """
    return await update_user(user_object)
