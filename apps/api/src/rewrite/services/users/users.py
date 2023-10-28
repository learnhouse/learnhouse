from datetime import datetime
from uuid import uuid4
from fastapi import Depends, Request
from sqlmodel import Session
from src.rewrite.services.db.users import User, UserCreate
from src.security.security import security_hash_password
from src.services.users.schemas.users import PublicUser


async def create_user(
    request: Request,
    db_session: Session,
    current_user: PublicUser | None,
    user_object: UserCreate,
    org_slug: str,
):
    user = User.from_orm(user_object)

    # Complete the user object
    user.user_uuid = f"user_{uuid4()}"
    user.password = await security_hash_password(user_object.password)
    user.email_verified = False
    user.creation_date = str(datetime.now())
    user.update_date = str(datetime.now())

    # Verifications 
    #todo: add username uniqueness verification
    #todo: add email uniqueness verification
    

    #todo: add user to org as member if org is not None

    # Exclude unset values
    user_data = user.dict(exclude_unset=True)
    for key, value in user_data.items():
        setattr(user, key, value)

    # Add user to database
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    return user
