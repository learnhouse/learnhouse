import json
from typing import List
from uuid import uuid4
from pydantic import BaseModel
from src.services.users import PublicUser, User
from src.services.database import create_config_collection, check_database, create_database, learnhouseDB, learnhouseDB
from src.services.security import *
from fastapi import FastAPI, HTTPException, status, Request, Response, BackgroundTasks
from datetime import datetime

#### Classes ####################################################


class Collection(BaseModel):
    name: str
    description: str
    courses: List[str] # course_id
    org_id: str # org_id


class CollectionInDB(Collection):
    collection_id: str


#### Classes ####################################################

####################################################
# CRUD
####################################################

async def get_collection(collection_id: str, current_user: PublicUser):
    await check_database()
    collections = learnhouseDB["collections"]

    collection = collections.find_one({"collection_id": collection_id})

    # verify collection rights
    await verify_collection_rights(collection_id, current_user, "read")
    
    if not collection:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Collection does not exist")

    collection = Collection(**collection)
    return collection


async def create_collection(collection_object: Collection, current_user: PublicUser):
    await check_database()
    collections = learnhouseDB["collections"]

    # find if collection already exists using name
    isCollectionNameAvailable = collections.find_one({"name": collection_object.name})
    
    # TODO 
    # await verify_collection_rights("*", current_user, "create")

    if isCollectionNameAvailable:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Collection name already exists")

    # generate collection_id with uuid4
    collection_id = str(f"collection_{uuid4()}")

    collection = CollectionInDB(collection_id=collection_id, **collection_object.dict())

    collection_in_db = collections.insert_one(collection.dict())

    if not collection_in_db:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Unavailable database")

    return collection.dict()


async def update_collection(collection_object: Collection, collection_id: str, current_user: PublicUser):
    await check_database()

    # verify collection rights
    await verify_collection_rights(collection_id, current_user, "update")

    collections = learnhouseDB["collections"]

    collection = collections.find_one({"collection_id": collection_id})


    if not collection:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Collection does not exist")

    updated_collection = CollectionInDB(
        collection_id=collection_id,  **collection_object.dict())

    collections.update_one({"collection_id": collection_id}, {"$set": updated_collection.dict()})

    return Collection(**updated_collection.dict())


async def delete_collection(collection_id: str, current_user: PublicUser):
    await check_database()

    await verify_collection_rights(collection_id, current_user,"delete")

    collections = learnhouseDB["collections"]

    collection = collections.find_one({"collection_id": collection_id})

    if not collection:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Collection does not exist")

    isDeleted = collections.delete_one({"collection_id": collection_id})

    if isDeleted:
        return {"detail": "collection deleted"}
    else:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Unavailable database")

####################################################
# Misc
####################################################

async def get_collections(page: int = 1, limit: int = 10):
    ## TODO : auth
    await check_database()
    collections = learnhouseDB["collections"]

    # get all collections from database
    all_collections = collections.find().sort("name", 1).skip(10 * (page - 1)).limit(limit)
    
    # TODO : Check rights for each collection
    return [json.loads(json.dumps(collection, default=str)) for collection in all_collections]


#### Security ####################################################

async def verify_collection_rights(collection_id: str,  current_user: PublicUser, action: str):
    await check_database()
    collections = learnhouseDB["collections"]

    collection = collections.find_one({"collection_id": collection_id})

    if not collection and action != "create":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Collection does not exist")

    hasRoleRights = await verify_user_rights_with_roles(action, current_user.user_id, collection_id)

    if not hasRoleRights:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="You do not have rights to this Collection")

    return True

#### Security ####################################################
