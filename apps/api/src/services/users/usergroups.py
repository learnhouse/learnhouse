from datetime import datetime
from uuid import uuid4
from fastapi import HTTPException, Request
from sqlmodel import Session, select
from src.db.organizations import Organization
from src.db.usergroups import UserGroup, UserGroupCreate, UserGroupRead, UserGroupUpdate
from src.db.users import AnonymousUser, PublicUser


async def create_usergroup(
    request: Request,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
    usergroup_create: UserGroupCreate,
) -> UserGroupRead:

    usergroup = UserGroup.from_orm(usergroup_create)

    # Check if Organization exists
    statement = select(Organization).where(Organization.id == usergroup_create.org_id)
    result = db_session.exec(statement)

    if not result.first():
        raise HTTPException(
            status_code=400,
            detail="Organization does not exist",
        )

    # Complete the object
    usergroup.usergroup_uuid = f"usergroup_{uuid4()}"
    usergroup.creation_date = str(datetime.now())
    usergroup.update_date = str(datetime.now())

    # Save the object
    db_session.add(usergroup)
    db_session.commit()
    db_session.refresh(usergroup)

    usergroup = UserGroupRead.from_orm(usergroup)

    return usergroup


async def read_usergroup_by_id(
    request: Request,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
    usergroup_id: int,
) -> UserGroupRead:

    statement = select(UserGroup).where(UserGroup.id == usergroup_id)
    usergroup = db_session.exec(statement).first()

    if not usergroup:
        raise HTTPException(
            status_code=404,
            detail="UserGroup not found",
        )

    usergroup = UserGroupRead.from_orm(usergroup)

    return usergroup


async def update_usergroup_by_id(
    request: Request,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
    usergroup_id: int,
    usergroup_update: UserGroupUpdate,
) -> UserGroupRead:

    statement = select(UserGroup).where(UserGroup.id == usergroup_id)
    usergroup = db_session.exec(statement).first()

    if not usergroup:
        raise HTTPException(
            status_code=404,
            detail="UserGroup not found",
        )

    usergroup.name = usergroup_update.name
    usergroup.description = usergroup_update.description
    usergroup.update_date = str(datetime.now())

    db_session.add(usergroup)
    db_session.commit()
    db_session.refresh(usergroup)

    usergroup = UserGroupRead.from_orm(usergroup)

    return usergroup


async def delete_usergroup_by_id(
    request: Request,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
    usergroup_id: int,
) -> str:

    statement = select(UserGroup).where(UserGroup.id == usergroup_id)
    usergroup = db_session.exec(statement).first()

    if not usergroup:
        raise HTTPException(
            status_code=404,
            detail="UserGroup not found",
        )

    db_session.delete(usergroup)
    db_session.commit()

    return "UserGroup deleted successfully"
