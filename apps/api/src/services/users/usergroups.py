from datetime import datetime
import logging
from uuid import uuid4
from fastapi import HTTPException, Request
from sqlmodel import Session, select
from src.db.usergroup_ressources import UserGroupRessource
from src.db.usergroup_user import UserGroupUser
from src.db.organizations import Organization
from src.db.usergroups import UserGroup, UserGroupCreate, UserGroupRead, UserGroupUpdate
from src.db.users import AnonymousUser, PublicUser, User


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


async def add_users_to_usergroup(
    request: Request,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
    usergroup_id: int,
    user_ids: str,
) -> str:

    statement = select(UserGroup).where(UserGroup.id == usergroup_id)
    usergroup = db_session.exec(statement).first()

    if not usergroup:
        raise HTTPException(
            status_code=404,
            detail="UserGroup not found",
        )

    user_ids_array = user_ids.split(",")

    for user_id in user_ids_array:
        statement = select(User).where(User.id == user_id)
        user = db_session.exec(statement).first()

        if user:
            # Add user to UserGroup
            if user.id is not None:
                usergroup_obj = UserGroupUser(
                    usergroup_id=usergroup_id,
                    user_id=user.id,
                    org_id=usergroup.org_id,
                    creation_date=str(datetime.now()),
                    update_date=str(datetime.now()),
                )

                db_session.add(usergroup_obj)
                db_session.commit()
                db_session.refresh(usergroup_obj)
        else:
            logging.error(f"User with id {user_id} not found")

    return "Users added to UserGroup successfully"


async def remove_users_from_usergroup(
    request: Request,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
    usergroup_id: int,
    user_ids: str,
) -> str:

    statement = select(UserGroup).where(UserGroup.id == usergroup_id)
    usergroup = db_session.exec(statement).first()

    if not usergroup:
        raise HTTPException(
            status_code=404,
            detail="UserGroup not found",
        )

    user_ids_array = user_ids.split(",")

    for user_id in user_ids_array:
        statement = select(UserGroupUser).where(UserGroupUser.user_id == user_id)
        usergroup_user = db_session.exec(statement).first()

        if usergroup_user:
            db_session.delete(usergroup_user)
            db_session.commit()
        else:
            logging.error(f"User with id {user_id} not found in UserGroup")

    return "Users removed from UserGroup successfully"


async def add_ressources_to_usergroup(
    request: Request,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
    usergroup_id: int,
    ressources_uuids: str,
) -> str:

    statement = select(UserGroup).where(UserGroup.id == usergroup_id)
    usergroup = db_session.exec(statement).first()

    if not usergroup:
        raise HTTPException(
            status_code=404,
            detail="UserGroup not found",
        )

    ressources_uuids_array = ressources_uuids.split(",")

    for ressource_uuid in ressources_uuids_array:
        # TODO : Find a way to check if ressource exists

        usergroup_obj = UserGroupRessource(
            usergroup_id=usergroup_id,
            ressource_uuid=ressource_uuid,
            org_id=usergroup.org_id,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )

        db_session.add(usergroup_obj)
        db_session.commit()
        db_session.refresh(usergroup_obj)

    return "Ressources added to UserGroup successfully"


async def remove_ressources_from_usergroup(
    request: Request,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
    usergroup_id: int,
    ressources_uuids: str,
) -> str:

    statement = select(UserGroup).where(UserGroup.id == usergroup_id)
    usergroup = db_session.exec(statement).first()

    if not usergroup:
        raise HTTPException(
            status_code=404,
            detail="UserGroup not found",
        )

    ressources_uuids_array = ressources_uuids.split(",")

    for ressource_uuid in ressources_uuids_array:
        statement = select(UserGroupRessource).where(
            UserGroupRessource.ressource_uuid == ressource_uuid
        )
        usergroup_ressource = db_session.exec(statement).first()

        if usergroup_ressource:
            db_session.delete(usergroup_ressource)
            db_session.commit()
        else:
            logging.error(
                f"Ressource with uuid {ressource_uuid} not found in UserGroup"
            )

    return "Ressources removed from UserGroup successfully"
