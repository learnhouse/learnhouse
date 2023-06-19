from typing import Literal
from uuid import uuid4
from src.services.roles.schemas.roles import Role, RoleInDB
from src.services.users.schemas.users import PublicUser
from fastapi import HTTPException, status, Request
from datetime import datetime


async def create_role(request: Request, role_object: Role, current_user: PublicUser):
    roles = request.app.db["roles"]

    await verify_user_permissions_on_roles(request, current_user, "create", None)

    # create the role object in the database and return the object
    role_id = "role_" + str(uuid4())

    role = RoleInDB(
        role_id=role_id,
        created_at=str(datetime.now()),
        updated_at=str(datetime.now()),
        **role_object.dict()
    )

    await roles.insert_one(role.dict())

    return role


async def read_role(request: Request, role_id: str, current_user: PublicUser):
    roles = request.app.db["roles"]

    await verify_user_permissions_on_roles(request, current_user, "read", role_id)

    role = RoleInDB(**await roles.find_one({"role_id": role_id}))

    return role


async def update_role(
    request: Request, role_id: str, role_object: Role, current_user: PublicUser
):
    roles = request.app.db["roles"]

    await verify_user_permissions_on_roles(request, current_user, "update", role_id)

    role_object.updated_at = datetime.now()

    # Update the role object in the database and return the object
    updated_role = RoleInDB(
        **await roles.find_one_and_update(
            {"role_id": role_id}, {"$set": role_object.dict()}, return_document=True
        )
    )

    return updated_role


async def delete_role(request: Request, role_id: str, current_user: PublicUser):
    roles = request.app.db["roles"]

    await verify_user_permissions_on_roles(request, current_user, "delete", role_id)

    # Delete the role object in the database and return the object
    deleted_role = RoleInDB(**await roles.find_one_and_delete({"role_id": role_id}))

    return deleted_role


#### Security ####################################################


async def verify_user_permissions_on_roles(
    request: Request,
    current_user: PublicUser,
    action: Literal["create", "read", "update", "delete"],
    role_id: str | None,
):
    request.app.db["users"]
    roles = request.app.db["roles"]

    # If current user is not authenticated

    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Roles : Not authenticated"
        )

    if action == "create":
        if "owner" in [org.org_role for org in current_user.orgs]:
            return True

    if role_id is not None:
        role = RoleInDB(**await roles.find_one({"role_id": role_id}))

        if action == "read":
            if "owner" in [org.org_role for org in current_user.orgs]:
                return True

            for org in current_user.orgs:
                if org.org_id == role.org_id:
                    return True

        if action == "update":
            for org in current_user.orgs:
                # If the user is an owner of the organization
                if org.org_id == role.org_id:
                    if org.org_role == "owner" or org.org_role == "editor":
                        return True
                # Can't update a global role
                if role.org_id == "*":
                    return False

        if action == "delete":
            for org in current_user.orgs:
                # If the user is an owner of the organization
                if org.org_id == role.org_id:
                    if org.org_role == "owner":
                        return True
                # Can't delete a global role
                if role.org_id == "*":
                    return False


#### Security ####################################################
