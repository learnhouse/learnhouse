import json
from typing import List
from uuid import uuid4
from pydantic import BaseModel
from src.services.users.users import PublicUser, User
from src.services.security import *
from fastapi import FastAPI, HTTPException, status, Request, Response, BackgroundTasks
from datetime import datetime

#### Classes ####################################################


class House(BaseModel):
    name: str
    photo: str
    description: str
    email: str
    org: str


class HouseInDB(House):
    house_id: str
    owners: List[str]
    admins: List[str]

#### Classes ####################################################

# TODO : Add house photo upload and delete

async def get_house(request: Request, house_id: str, current_user: PublicUser):
    houses = request.app.db["houses"]

    house = houses.find_one({"house_id": house_id})

    # verify house rights
    await verify_house_rights(request,house_id, current_user, "read")

    if not house:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="House does not exist")

    house = House(**house)
    return house


async def create_house(request: Request,house_object: House, current_user: PublicUser):
    houses = request.app.db["houses"]

    # find if house already exists using name
    isHouseAvailable = houses.find_one({"name": house_object.name})

    if isHouseAvailable:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="House name already exists")

    # generate house_id with uuid4
    house_id = str(f"house_{uuid4()}")

    hasRoleRights = await verify_user_rights_with_roles(request, "create", current_user.user_id, house_id)

    if not hasRoleRights:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Roles : Insufficient rights to perform this action")

    house = HouseInDB(house_id=house_id, owners=[
                      current_user.user_id], admins=[
                      current_user.user_id], **house_object.dict())

    house_in_db = houses.insert_one(house.dict())

    if not house_in_db:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Unavailable database")

    return house.dict()


async def update_house(request: Request,house_object: House, house_id: str, current_user: PublicUser):

    # verify house rights
    await verify_house_rights(request,house_id, current_user, "update")

    houses = request.app.db["houses"]

    house = houses.find_one({"house_id": house_id})

    if house:
        # get owner value from house object database
        owners = house["owners"]
        admins = house["admins"]

        updated_house = HouseInDB(
            house_id=house_id, owners=owners, admins=admins, **house_object.dict())

        houses.update_one({"house_id": house_id}, {"$set": updated_house.dict()})

        return HouseInDB(**updated_house.dict())

    else:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="House does not exist")

    


async def delete_house(request: Request,house_id: str, current_user: PublicUser):

    # verify house rights
    await verify_house_rights(request,house_id, current_user, "delete")

    houses = request.app.db["houses"]

    house = houses.find_one({"house_id": house_id})

    if not house:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="House does not exist")

    isDeleted = houses.delete_one({"house_id": house_id})

    if isDeleted:
        return {"detail": "House deleted"}
    else:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Unavailable database")


async def get_houses(request: Request,page: int = 1, limit: int = 10):
    houses = request.app.db["houses"]
    # TODO : Get only houses that user is admin/has roles of
    # get all houses from database
    all_houses = houses.find().sort("name", 1).skip(10 * (page - 1)).limit(limit)

    return [json.loads(json.dumps(house, default=str)) for house in await all_houses.to_list(length=limit)]


#### Security ####################################################

async def verify_house_rights(request: Request,house_id: str, current_user: PublicUser, action: str):
    houses = request.app.db["houses"]

    house = houses.find_one({"house_id": house_id})

    if not house:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="House does not exist")

    hasRoleRights = await verify_user_rights_with_roles(request,action, current_user.user_id, house_id)
    isOwner = current_user.user_id in house["owners"]

    if not hasRoleRights and not isOwner:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Roles/Ownership : Insufficient rights to perform this action")

    return True

#### Security ####################################################
