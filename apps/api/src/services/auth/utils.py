import random
from typing import Optional
from fastapi import Depends, HTTPException, Request
import httpx
from sqlmodel import Session, select
from src.core.events.database import get_db_session
from src.db.users import User, UserCreate, UserRead
from src.security.auth import get_current_user
from src.services.users.users import create_user, create_user_without_org


async def get_google_user_info(access_token: str):
    url = "https://www.googleapis.com/oauth2/v3/userinfo"
    headers = {"Authorization": f"Bearer {access_token}"}
    async with httpx.AsyncClient() as client:
        response = await client.get(url, headers=headers)

    if response.status_code != 200:
        raise HTTPException(
            status_code=response.status_code,
            detail="Failed to fetch user info from Google",
        )

    return response.json()


async def signWithGoogle(
    request: Request,
    access_token: str,
    email: str,
    org_id: Optional[int] = None,
    current_user=Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    # Google
    google_user = await get_google_user_info(access_token)

    user = db_session.exec(
        select(User).where(User.email == google_user["email"])
    ).first()

    if not user:
        username = (
            google_user["given_name"]
            + google_user["family_name"]
            + str(random.randint(10, 99))
        )
        user_object = UserCreate(
            email=google_user["email"],
            username=username,
            password="",
            first_name=google_user["given_name"],
            last_name=google_user["family_name"],
            avatar_image=google_user["picture"],
        )

        if org_id is not None:
            user = await create_user(
                request, db_session, current_user, user_object, org_id
            )

            return user
        else:
            user = await create_user_without_org(
                request, db_session, current_user, user_object
            )

            return user

    return UserRead.model_validate(user)
