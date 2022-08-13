import json
from typing import List
from uuid import uuid4
from pydantic import BaseModel
from src.services.users import User
from src.services.database import check_database,  learnhouseDB, learnhouseDB
from src.services.security import *
from src.services.houses import House
from fastapi import HTTPException, status
from datetime import datetime

#### Classes ####################################################


class Permission(BaseModel):
    action_create: bool
    action_read: bool
    action_update: bool
    action_delete: bool


class Elements(BaseModel):
    course: List[str]
    users: List[str]
    houses: List[str]
    collections: List[str]
    organizations: List[str]
    coursechapters : List[str]


class Role(BaseModel):
    name: str
    description: str
    permissions: Permission
    elements: Elements
    linked_users: List[str]


class RoleInDB(Role):
    role_id: str
    creationDate: str
    updateDate: str

#### Classes ####################################################


async def get_role(role_id: str):
    await check_database()
    roles = learnhouseDB["roles"]

    role = roles.find_one({"role_id": role_id})

    if not role:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Role does not exist")

    role = Role(**role)
    return role


async def create_role(role_object: Role, current_user: User):
    await check_database()
    roles = learnhouseDB["roles"]

    # find if house already exists using name
    isRoleAvailable = roles.find_one({"name": role_object.name})

    if isRoleAvailable:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Role name already exists")

    await verify_user_permissions("create", current_user)

    # generate house_id with uuid4
    role_id = str(f"role_{uuid4()}")

    role = RoleInDB(role_id=role_id, creationDate=str(datetime.now()),
                    updateDate=str(datetime.now()), **role_object.dict())

    role_in_db = roles.insert_one(role.dict())

    if not role_in_db:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Unavailable database")

    return role.dict()


async def update_role(role_object: House, role_id: str, current_user: User):
    await check_database()

    # verify house rights
    await verify_user_permissions("update", current_user)

    roles = learnhouseDB["roles"]

    role = roles.find_one({"role_id": role_id})

    if not role:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="House does not exist")

    updated_role = RoleInDB(
        role_id=role_id, updateDate=str(datetime.now()), creationDate=role["creationDate"],  **role_object.dict())

    roles.update_one({"role_id": role_id}, {"$set": updated_role.dict()})

    return RoleInDB(**updated_role.dict())


async def delete_role(role_id: str, current_user: User):
    await check_database()

    # verify house rights
    await verify_user_permissions("delete", current_user)

    roles = learnhouseDB["roles"]

    role = roles.find_one({"role_id": role_id})

    if not role:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Role does not exist")

    isDeleted = roles.delete_one({"role_id": role_id})

    if isDeleted:
        return {"detail": "Role deleted"}
    else:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Unavailable database")


async def get_roles(page: int = 1, limit: int = 10):
    await check_database()
    roles = learnhouseDB["roles"]

    # get all roles from database
    all_roles = roles.find().sort("name", 1).skip(10 * (page - 1)).limit(limit)

    return [json.loads(json.dumps(role, default=str)) for role in all_roles]


#### Security ####################################################

async def verify_user_permissions(action: str, current_user: User):
    await check_database()
    users = learnhouseDB["users"]

    user = users.find_one({"username": current_user.username})

    if not user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="User does not exist")

    isOwner = "owner" in user["user_type"]
    isEditor = "editor" in user["user_type"]
    
    # TODO: verify for all actions. 
    if action == "delete":
        if isEditor:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="You do not have rights to this Role")

        if not isOwner and not isEditor:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="You do not have rights to this Role")

    return True

#### Security ####################################################
