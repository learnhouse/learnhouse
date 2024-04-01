from typing import Literal
from uuid import uuid4
from sqlmodel import Session, select
from src.security.rbac.rbac import (
    authorization_verify_based_on_roles_and_authorship_and_usergroups,
    authorization_verify_if_user_is_anon,
)
from src.db.users import AnonymousUser, PublicUser
from src.db.roles import Role, RoleCreate, RoleRead, RoleUpdate
from fastapi import HTTPException, Request
from datetime import datetime


async def create_role(
    request: Request,
    db_session: Session,
    role_object: RoleCreate,
    current_user: PublicUser,
):
    role = Role.model_validate(role_object)

    # RBAC check
    await rbac_check(request, current_user, "create", "role_xxx", db_session)

    # Complete the role object
    role.role_uuid = f"role_{uuid4()}"
    role.creation_date = str(datetime.now())
    role.update_date = str(datetime.now())

    db_session.add(role)
    db_session.commit()
    db_session.refresh(role)

    role = RoleRead(**role.model_dump())

    return role


async def read_role(
    request: Request, db_session: Session, role_id: str, current_user: PublicUser
):
    statement = select(Role).where(Role.id == role_id)
    result = db_session.exec(statement)

    role = result.first()

    if not role:
        raise HTTPException(
            status_code=404,
            detail="Role not found",
        )

    # RBAC check
    await rbac_check(request, current_user, "read", role.role_uuid, db_session)

    role = RoleRead(**role.model_dump())

    return role


async def update_role(
    request: Request,
    db_session: Session,
    role_object: RoleUpdate,
    current_user: PublicUser,
):
    statement = select(Role).where(Role.id == role_object.role_id)
    result = db_session.exec(statement)

    role = result.first()

    if not role:
        raise HTTPException(
            status_code=404,
            detail="Role not found",
        )

    # RBAC check
    await rbac_check(request, current_user, "update", role.role_uuid, db_session)

    # Complete the role object
    role.update_date = str(datetime.now())

    # Remove the role_id from the role_object
    del role_object.role_id

    # Update only the fields that were passed in
    for var, value in vars(role_object).items():
        if value is not None:
            setattr(role, var, value)

    db_session.add(role)
    db_session.commit()
    db_session.refresh(role)

    role = RoleRead(**role.model_dump())

    return role


async def delete_role(
    request: Request, db_session: Session, role_id: str, current_user: PublicUser
):
    # RBAC check
    await rbac_check(request, current_user, "delete", role_id, db_session)

    statement = select(Role).where(Role.id == role_id)
    result = db_session.exec(statement)

    role = result.first()

    if not role:
        raise HTTPException(
            status_code=404,
            detail="Role not found",
        )

    db_session.delete(role)
    db_session.commit()

    return "Role deleted"


## 🔒 RBAC Utils ##


async def rbac_check(
    request: Request,
    current_user: PublicUser | AnonymousUser,
    action: Literal["create", "read", "update", "delete"],
    role_uuid: str,
    db_session: Session,
):
    await authorization_verify_if_user_is_anon(current_user.id)

    await authorization_verify_based_on_roles_and_authorship_and_usergroups(
        request, current_user.id, action, role_uuid, db_session
    )


## 🔒 RBAC Utils ##
