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

    # Use Google email with fallback to parameter email
    user_email = google_user.get("email", email)
    
    # Validate we have a valid email
    if not user_email:
        raise HTTPException(
            status_code=400,
            detail="No email address available from Google or request"
        )

    user = db_session.exec(
        select(User).where(User.email == user_email)
    ).first()

    if not user:
        # Extract user data with safe defaults
        given_name = google_user.get("given_name", "")
        family_name = google_user.get("family_name", "")
        picture = google_user.get("picture", "")
        
        # Generate username more robustly
        username_parts = []
        if given_name:
            username_parts.append(given_name)
        if family_name:
            username_parts.append(family_name)
        
        # If no name parts available, use part of email
        if not username_parts and user_email and "@" in user_email:
            email_prefix = user_email.split("@")[0]
            if email_prefix:  # Make sure it's not empty
                username_parts.append(email_prefix)
        
        # If still no parts, use a default
        if not username_parts:
            username_parts.append("user")
        
        username = "".join(username_parts) + str(random.randint(10, 99))
        
        user_object = UserCreate(
            email=user_email,
            username=username,
            password="",
            first_name=given_name,
            last_name=family_name,
            avatar_image=picture,
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
