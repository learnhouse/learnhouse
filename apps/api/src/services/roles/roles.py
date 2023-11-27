from uuid import uuid4
from sqlmodel import Session, select
from src.db.users import PublicUser
from src.db.roles import Role, RoleCreate, RoleUpdate
from fastapi import HTTPException, Request
from datetime import datetime


async def create_role(
    request: Request,
    db_session: Session,
    role_object: RoleCreate,
    current_user: PublicUser,
):
    role = Role.from_orm(role_object)

    # Complete the role object
    role.role_uuid = f"role_{uuid4()}"
    role.creation_date = str(datetime.now())
    role.update_date = str(datetime.now())

    db_session.add(role)
    db_session.commit()
    db_session.refresh(role)

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

    return role


async def delete_role(
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

    db_session.delete(role)
    db_session.commit()

    return "Role deleted"
