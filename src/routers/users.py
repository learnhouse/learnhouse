from fastapi import Depends, FastAPI, APIRouter
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel
from src.dependencies.auth import *
from src.services.users.schemas.users import PasswordChangeForm, PublicUser, User, UserWithPassword
from src.services.users.users import create_user, delete_user, get_profile_metadata, get_user_by_userid, read_user, update_user, update_user_password





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



@router.get("/user_id/{user_id}")
async def api_get_user_by_userid(request: Request,user_id: str):
    """
    Get single user by user_id
    """
    return await get_user_by_userid(request, user_id)


@router.post("/")
async def api_create_user(request: Request,user_object: UserWithPassword, org_id: str ):
    """
    Create new user
    """
    return await create_user(request, None, user_object, org_id)


@router.delete("/user_id/{user_id}")
async def api_delete_user(request: Request, user_id: str, current_user: PublicUser = Depends(get_current_user)):
    """
    Delete user by ID
    """

    return await delete_user(request, current_user, user_id)


@router.put("/user_id/{user_id}")
async def api_update_user(request: Request, user_object: User, user_id: str, current_user: PublicUser = Depends(get_current_user)):
    """
    Update user by ID
    """
    return await update_user(request, user_id, user_object, current_user)

@router.put("/password/user_id/{user_id}")
async def api_update_user_password(request: Request, user_id: str , passwordChangeForm : PasswordChangeForm, current_user: PublicUser = Depends(get_current_user)):
    """
    Update user password by ID
    """
    return await update_user_password(request,current_user,  user_id, passwordChangeForm)
