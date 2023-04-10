from urllib.request import Request
from fastapi import Depends, APIRouter, HTTPException, status, Request
from fastapi.security import  OAuth2PasswordRequestForm
from src.security.auth import *
from src.services.users.users import *
from datetime import  timedelta
from fastapi.responses import JSONResponse


router = APIRouter()

@router.post('/refresh')
def refresh(Authorize: AuthJWT = Depends()):
    """
    The jwt_refresh_token_required() function insures a valid refresh
    token is present in the request before running any code below that function.
    we can use the get_jwt_subject() function to get the subject of the refresh
    token, and use the create_access_token() function again to make a new access token
    """
    Authorize.jwt_refresh_token_required()

    current_user = Authorize.get_jwt_subject()
    new_access_token = Authorize.create_access_token(subject=current_user) # type: ignore
    return {"access_token": new_access_token}

@router.post('/login')
async def login(request: Request,Authorize: AuthJWT = Depends(), form_data: OAuth2PasswordRequestForm = Depends()):
    user = await authenticate_user(request, form_data.username, form_data.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect Email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    access_token = Authorize.create_access_token(subject=form_data.username)
    refresh_token = Authorize.create_refresh_token(subject=form_data.username)
    Authorize.set_refresh_cookies(refresh_token)
    Authorize.set_access_cookies(access_token)
    return {"access_token": access_token , "refresh_token": refresh_token}

@router.delete('/logout')
def logout(Authorize: AuthJWT = Depends()):
    """
    Because the JWT are stored in an httponly cookie now, we cannot
    log the user out by simply deleting the cookies in the frontend.
    We need the backend to send us a response to delete the cookies.
    """
    Authorize.jwt_required()

    Authorize.unset_jwt_cookies()
    return {"msg":"Successfully logout"}