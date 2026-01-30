from datetime import timedelta
from typing import Literal, Optional
from fastapi import Depends, APIRouter, HTTPException, Response, status, Request, Form
from pydantic import BaseModel, EmailStr
from sqlmodel import Session
from src.db.users import AnonymousUser, UserRead
from src.core.events.database import get_db_session
from config.config import get_learnhouse_config
from src.security.auth import (
    authenticate_user,
    get_current_user,
    create_access_token,
    create_refresh_token,
    decode_refresh_token,
    extract_jwt_from_request,
    JWT_ACCESS_TOKEN_EXPIRES,
    JWT_REFRESH_COOKIE_NAME,
    JWT_COOKIE_NAME,
)
from src.services.auth.utils import signWithGoogle


router = APIRouter()


def set_auth_cookies(response: Response, access_token: str, refresh_token: str):
    """Helper to set authentication cookies."""
    cookie_domain = get_learnhouse_config().hosting_config.cookie_config.domain

    response.set_cookie(
        key=JWT_COOKIE_NAME,
        value=access_token,
        httponly=False,
        domain=cookie_domain,
        expires=int(timedelta(hours=8).total_seconds()),
    )
    response.set_cookie(
        key=JWT_REFRESH_COOKIE_NAME,
        value=refresh_token,
        httponly=True,
        domain=cookie_domain,
        expires=int(timedelta(days=30).total_seconds()),
    )


def unset_auth_cookies(response: Response):
    """Helper to unset authentication cookies."""
    cookie_domain = get_learnhouse_config().hosting_config.cookie_config.domain

    response.delete_cookie(key=JWT_COOKIE_NAME, domain=cookie_domain)
    response.delete_cookie(key=JWT_REFRESH_COOKIE_NAME, domain=cookie_domain)


@router.get("/refresh")
def refresh(request: Request, response: Response):
    """
    Validates the refresh token and issues a new access token.
    The refresh token is read from cookies.
    """
    refresh_token = request.cookies.get(JWT_REFRESH_COOKIE_NAME)
    if not refresh_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token missing",
            headers={"WWW-Authenticate": "Bearer"},
        )

    payload = decode_refresh_token(refresh_token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    current_user = payload.get("sub")
    new_access_token = create_access_token(
        data={"sub": current_user},
        expires_delta=JWT_ACCESS_TOKEN_EXPIRES
    )

    cookie_domain = get_learnhouse_config().hosting_config.cookie_config.domain
    response.set_cookie(
        key=JWT_COOKIE_NAME,
        value=new_access_token,
        httponly=False,
        domain=cookie_domain,
        expires=int(timedelta(hours=8).total_seconds()),
    )
    return {"access_token": new_access_token}


@router.post("/login")
async def login(
    request: Request,
    response: Response,
    username: str = Form(...),
    password: str = Form(...),
    db_session: Session = Depends(get_db_session),
):
    user = await authenticate_user(
        request, username, password, db_session
    )
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect Email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    access_token = create_access_token(
        data={"sub": username},
        expires_delta=JWT_ACCESS_TOKEN_EXPIRES
    )
    refresh_token = create_refresh_token(data={"sub": username})

    set_auth_cookies(response, access_token, refresh_token)

    user = UserRead.model_validate(user)

    result = {
        "user": user,
        "tokens": {"access_token": access_token, "refresh_token": refresh_token},
    }
    return result


class ThirdPartyLogin(BaseModel):
    email: EmailStr
    provider: Literal["google"]
    access_token: str


@router.post("/oauth")
async def third_party_login(
    request: Request,
    response: Response,
    body: ThirdPartyLogin,
    org_id: Optional[int] = None,
    current_user: AnonymousUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    # Google
    if body.provider == "google":

        user = await signWithGoogle(
            request, body.access_token, body.email, org_id, current_user, db_session
        )

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect Email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    access_token = create_access_token(
        data={"sub": user.email},
        expires_delta=JWT_ACCESS_TOKEN_EXPIRES
    )
    refresh_token = create_refresh_token(data={"sub": user.email})

    set_auth_cookies(response, access_token, refresh_token)

    user = UserRead.model_validate(user)

    result = {
        "user": user,
        "tokens": {"access_token": access_token, "refresh_token": refresh_token},
    }
    return result


@router.delete("/logout")
def logout(request: Request, response: Response):
    """
    Because the JWT are stored in an httponly cookie now, we cannot
    log the user out by simply deleting the cookies in the frontend.
    We need the backend to send us a response to delete the cookies.
    """
    token = extract_jwt_from_request(request)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    unset_auth_cookies(response)
    return {"msg": "Successfully logout"}
