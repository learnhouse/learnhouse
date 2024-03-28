from datetime import datetime
import logging
from typing import Literal
from uuid import uuid4
from fastapi import HTTPException, Request
from sqlmodel import Session, select
from src.security.rbac.rbac import (
    authorization_verify_based_on_roles_and_authorship_and_usergroups,
    authorization_verify_if_element_is_public,
    authorization_verify_if_user_is_anon,
)
from src.db.usergroup_resources import UserGroupResource
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

    # RBAC check
    await rbac_check(
        request,
        usergroup_uuid="usergroup_X",
        current_user=current_user,
        action="create",
        db_session=db_session,
    )

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

    # RBAC check
    await rbac_check(
        request,
        usergroup_uuid=usergroup.usergroup_uuid,
        current_user=current_user,
        action="read",
        db_session=db_session,
    )

    usergroup = UserGroupRead.from_orm(usergroup)

    return usergroup


async def read_usergroups_by_org_id(
    request: Request,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
    org_id: int,
) -> list[UserGroupRead]:

    statement = select(UserGroup).where(UserGroup.org_id == org_id)
    usergroups = db_session.exec(statement).all()

    if not usergroups:
        raise HTTPException(
            status_code=404,
            detail="UserGroups not found",
        )

    # RBAC check
    await rbac_check(
        request,
        usergroup_uuid="usergroup_X",
        current_user=current_user,
        action="read",
        db_session=db_session,
    )

    usergroups = [UserGroupRead.from_orm(usergroup) for usergroup in usergroups]

    return usergroups


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

    # RBAC check
    await rbac_check(
        request,
        usergroup_uuid=usergroup.usergroup_uuid,
        current_user=current_user,
        action="update",
        db_session=db_session,
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

    # RBAC check
    await rbac_check(
        request,
        usergroup_uuid=usergroup.usergroup_uuid,
        current_user=current_user,
        action="delete",
        db_session=db_session,
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

    # RBAC check
    await rbac_check(
        request,
        usergroup_uuid=usergroup.usergroup_uuid,
        current_user=current_user,
        action="create",
        db_session=db_session,
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

    # RBAC check
    # RBAC check
    await rbac_check(
        request,
        usergroup_uuid=usergroup.usergroup_uuid,
        current_user=current_user,
        action="delete",
        db_session=db_session,
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


async def add_resources_to_usergroup(
    request: Request,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
    usergroup_id: int,
    resources_uuids: str,
) -> str:

    statement = select(UserGroup).where(UserGroup.id == usergroup_id)
    usergroup = db_session.exec(statement).first()

    if not usergroup:
        raise HTTPException(
            status_code=404,
            detail="UserGroup not found",
        )

    # RBAC check
    await rbac_check(
        request,
        usergroup_uuid=usergroup.usergroup_uuid,
        current_user=current_user,
        action="create",
        db_session=db_session,
    )

    resources_uuids_array = resources_uuids.split(",")

    for resource_uuid in resources_uuids_array:
        # TODO : Find a way to check if resource exists

        usergroup_obj = UserGroupResource(
            usergroup_id=usergroup_id,
            resource_uuid=resource_uuid,
            org_id=usergroup.org_id,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )

        db_session.add(usergroup_obj)
        db_session.commit()
        db_session.refresh(usergroup_obj)

    return "Resources added to UserGroup successfully"


async def remove_resources_from_usergroup(
    request: Request,
    db_session: Session,
    current_user: PublicUser | AnonymousUser,
    usergroup_id: int,
    resources_uuids: str,
) -> str:

    statement = select(UserGroup).where(UserGroup.id == usergroup_id)
    usergroup = db_session.exec(statement).first()

    if not usergroup:
        raise HTTPException(
            status_code=404,
            detail="UserGroup not found",
        )

    # RBAC check
    await rbac_check(
        request,
        usergroup_uuid=usergroup.usergroup_uuid,
        current_user=current_user,
        action="delete",
        db_session=db_session,
    )

    resources_uuids_array = resources_uuids.split(",")

    for resource_uuid in resources_uuids_array:
        statement = select(UserGroupResource).where(
            UserGroupResource.resource_uuid == resource_uuid
        )
        usergroup_resource = db_session.exec(statement).first()

        if usergroup_resource:
            db_session.delete(usergroup_resource)
            db_session.commit()
        else:
            logging.error(f"resource with uuid {resource_uuid} not found in UserGroup")

    return "Resources removed from UserGroup successfully"


## 🔒 RBAC Utils ##


async def rbac_check(
    request: Request,
    usergroup_uuid: str,
    current_user: PublicUser | AnonymousUser,
    action: Literal["create", "read", "update", "delete"],
    db_session: Session,
):
    await authorization_verify_if_user_is_anon(current_user.id)

    await authorization_verify_based_on_roles_and_authorship_and_usergroups(
        request,
        current_user.id,
        action,
        usergroup_uuid,
        db_session,
    )


## 🔒 RBAC Utils ##
