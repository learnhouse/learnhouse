from datetime import datetime
from uuid import uuid4
from fastapi import HTTPException, Request, status
from sqlmodel import Session, select
from src.db.organizations import Organization
from src.db.users import (
    PublicUser,
    User,
    UserCreate,
    UserRead,
    UserUpdate,
    UserUpdatePassword,
)
from src.db.user_organizations import UserOrganization
from src.security.security import security_hash_password, security_verify_password


async def create_user(
    request: Request,
    db_session: Session,
    current_user: PublicUser | None,
    user_object: UserCreate,
    org_id: int,
):
    user = User.from_orm(user_object)

    # Complete the user object
    user.user_uuid = f"user_{uuid4()}"
    user.password = await security_hash_password(user_object.password)
    user.email_verified = False
    user.creation_date = str(datetime.now())
    user.update_date = str(datetime.now())

    # Verifications

    # Check if Organization exists
    statement = select(Organization).where(Organization.id == org_id)
    result = db_session.exec(statement)

    if not result.first():
        raise HTTPException(
            status_code=400,
            detail="Organization does not exist",
        )

    # Username
    statement = select(User).where(User.username == user.username)
    result = db_session.exec(statement)

    if result.first():
        raise HTTPException(
            status_code=400,
            detail="Username already exists",
        )

    # Email
    statement = select(User).where(User.email == user.email)
    result = db_session.exec(statement)

    if result.first():
        raise HTTPException(
            status_code=400,
            detail="Email already exists",
        )

    # Exclude unset values
    user_data = user.dict(exclude_unset=True)
    for key, value in user_data.items():
        setattr(user, key, value)

    # Add user to database
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    # Link user and organization
    user_organization = UserOrganization(
        user_id=user.id if user.id else 0,
        org_id=int(org_id),
        role_id=3,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )

    db_session.add(user_organization)
    db_session.commit()
    db_session.refresh(user_organization)

    user = UserRead.from_orm(user)

    return user


async def create_user_without_org(
    request: Request,
    db_session: Session,
    current_user: PublicUser | None,
    user_object: UserCreate,
):
    user = User.from_orm(user_object)

    # Complete the user object
    user.user_uuid = f"user_{uuid4()}"
    user.password = await security_hash_password(user_object.password)
    user.email_verified = False
    user.creation_date = str(datetime.now())
    user.update_date = str(datetime.now())

    # Verifications

    # Username
    statement = select(User).where(User.username == user.username)
    result = db_session.exec(statement)

    if result.first():
        raise HTTPException(
            status_code=400,
            detail="Username already exists",
        )

    # Email
    statement = select(User).where(User.email == user.email)
    result = db_session.exec(statement)

    if result.first():
        raise HTTPException(
            status_code=400,
            detail="Email already exists",
        )

    # Exclude unset values
    user_data = user.dict(exclude_unset=True)
    for key, value in user_data.items():
        setattr(user, key, value)

    # Add user to database
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    user = UserRead.from_orm(user)

    return user


async def update_user(
    request: Request,
    db_session: Session,
    current_user: PublicUser | None,
    user_object: UserUpdate,
):
    # Get user
    statement = select(User).where(User.username == user_object.username)
    user = db_session.exec(statement).first()

    if not user:
        raise HTTPException(
            status_code=400,
            detail="User does not exist",
        )

    # Update user
    user_data = user_object.dict(exclude_unset=True)
    for key, value in user_data.items():
        setattr(user, key, value)

    user.update_date = str(datetime.now())

    # Update user in database
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    user = UserRead.from_orm(user)

    return user


async def update_user_password(
    request: Request,
    db_session: Session,
    current_user: PublicUser | None,
    form: UserUpdatePassword,
):
    # Get user
    statement = select(User).where(User.username == form.user_id)
    user = db_session.exec(statement).first()

    if not user:
        raise HTTPException(
            status_code=400,
            detail="User does not exist",
        )

    if not await security_verify_password(form.old_password, user.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Wrong password"
        )

    # Update user
    user.password = await security_hash_password(form.new_password)
    user.update_date = str(datetime.now())

    # Update user in database
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    user = UserRead.from_orm(user)

    return user


async def read_user_by_id(
    request: Request,
    db_session: Session,
    current_user: PublicUser | None,
    user_id: int,
):
    # Get user
    statement = select(User).where(User.id == user_id)
    user = db_session.exec(statement).first()

    if not user:
        raise HTTPException(
            status_code=400,
            detail="User does not exist",
        )

    user = UserRead.from_orm(user)

    return user


async def read_user_by_uuid(
    request: Request,
    db_session: Session,
    current_user: PublicUser | None,
    uuid: str,
):
    # Get user
    statement = select(User).where(User.user_uuid == uuid)
    user = db_session.exec(statement).first()

    if not user:
        raise HTTPException(
            status_code=400,
            detail="User does not exist",
        )

    user = UserRead.from_orm(user)

    return user


async def delete_user_by_id(
    request: Request,
    db_session: Session,
    current_user: PublicUser | None,
    user_id: int,
):
    # Get user
    statement = select(User).where(User.id == user_id)
    user = db_session.exec(statement).first()

    if not user:
        raise HTTPException(
            status_code=400,
            detail="User does not exist",
        )

    # Delete user
    db_session.delete(user)
    db_session.commit()

    return "User deleted"


# Utils & Security functions


async def security_get_user(request: Request, db_session: Session, email: str) -> User:
    # Check if user exists
    statement = select(User).where(User.email == email)
    user = db_session.exec(statement).first()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="User with Email does not exist",
        )

    user = User(**user.dict())

    return user
