import json
from typing import List
from uuid import uuid4
from pydantic import BaseModel
from src.services.users import User
from ..services.database import create_config_collection, check_database, create_database, learnhouseDB, learnhouseDB
from ..services.security import *
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

#### Classes ####################################################


async def get_house(house_id: str):
    await check_database()
    houses = learnhouseDB["houses"]

    house = houses.find_one({"house_id": house_id})

    if not house:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="House does not exist")

    house = House(**house)
    return house


async def create_house(house_object: House, current_user: User):
    await check_database()
    houses = learnhouseDB["houses"]

    # find if house already exists using name
    isHouseAvailable = houses.find_one({"name": house_object.name})

    if isHouseAvailable:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="House name already exists")

    # generate house_id with uuid4
    house_id = str(f"house_{uuid4()}")

    house = HouseInDB(house_id=house_id, owners=[
                      current_user.username], **house_object.dict())

    house_in_db = houses.insert_one(house.dict())

    if not house_in_db:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Unavailable database")

    return house.dict()


async def update_house(house_object: House, house_id: str, current_user: User):
    await check_database()
    
    # verify house rights
    await verify_house_ownership(house_id, current_user)
    
    houses = learnhouseDB["houses"]

    house = houses.find_one({"house_id": house_id})
    
    ## get owner value from house object database
    owners = house["owners"]

    if not house:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="House does not exist")

    updated_house = HouseInDB(house_id=house_id, owners=owners, **house_object.dict())

    houses.update_one({"house_id": house_id}, {"$set": updated_house.dict()})

    return HouseInDB(**updated_house.dict())


async def delete_house(house_id: str, current_user: User):
    await check_database()
    
    # verify house rights
    await verify_house_ownership(house_id, current_user)
    
    houses = learnhouseDB["houses"]

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


async def get_houses(page: int = 1, limit: int = 10):
    await check_database()
    houses = learnhouseDB["houses"]

    # get all houses from database
    all_houses = houses.find().sort("name", 1).skip(10 * (page - 1)).limit(limit)

    return [json.loads(json.dumps(house, default=str)) for house in all_houses]


#### Security ####################################################

async def verify_house_ownership(house_id: str, current_user: User):
    await check_database()
    houses = learnhouseDB["houses"]

    house = houses.find_one({"house_id": house_id})

    if not house:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="House does not exist")

    if current_user.username not in house["owners"]:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="User does not own this house")

    return True

#### Security ####################################################
