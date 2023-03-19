import json
from typing import List
from uuid import uuid4
from pydantic import BaseModel
from src.services.users.users import PublicUser, User
from src.services.security import *
from fastapi import FastAPI, HTTPException, status, Request, Response, BackgroundTasks
from datetime import datetime

#### Classes ####################################################


class Collection(BaseModel):
    name: str
    description: str
    courses: List[str]  # course_id
    org_id: str  # org_id


class CollectionInDB(Collection):
    collection_id: str


#### Classes ####################################################

####################################################
# CRUD
####################################################

async def get_collection(request: Request,collection_id: str, current_user: PublicUser):
    collections = request.app.db["collections"]

    collection = await collections.find_one({"collection_id": collection_id})

    # verify collection rights
    await verify_collection_rights(request, collection_id, current_user, "read")

    if not collection:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Collection does not exist")

    collection = Collection(**collection)
    return collection


async def create_collection(request: Request,collection_object: Collection, current_user: PublicUser):
    collections = request.app.db["collections"]

    # find if collection already exists using name
    isCollectionNameAvailable = await collections.find_one(
        {"name": collection_object.name})

    # TODO
    # await verify_collection_rights("*", current_user, "create")

    if isCollectionNameAvailable:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Collection name already exists")

    # generate collection_id with uuid4
    collection_id = str(f"collection_{uuid4()}")

    collection = CollectionInDB(
        collection_id=collection_id, **collection_object.dict())

    collection_in_db = await collections.insert_one(collection.dict())

    if not collection_in_db:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Unavailable database")

    return collection.dict()


async def update_collection(request: Request,collection_object: Collection, collection_id: str, current_user: PublicUser):

    # verify collection rights
    await verify_collection_rights(request, collection_id, current_user, "update")

    collections = request.app.db["collections"]

    collection = await collections.find_one({"collection_id": collection_id})

    if not collection:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Collection does not exist")

    updated_collection = CollectionInDB(
        collection_id=collection_id,  **collection_object.dict())

    await collections.update_one({"collection_id": collection_id}, {
                           "$set": updated_collection.dict()})

    return Collection(**updated_collection.dict())


async def delete_collection(request: Request,collection_id: str, current_user: PublicUser):

    await verify_collection_rights(request, collection_id, current_user, "delete")

    collections = request.app.db["collections"]

    collection = await collections.find_one({"collection_id": collection_id})

    if not collection:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Collection does not exist")

    isDeleted = await collections.delete_one({"collection_id": collection_id})

    if isDeleted:
        return {"detail": "collection deleted"}
    else:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Unavailable database")

####################################################
# Misc
####################################################


async def get_collections(request: Request,page: int = 1, limit: int = 10):
    ## TODO : auth
    collections = request.app.db["collections"]

    # get all collections from database without ObjectId
    all_collections = collections.find({}).sort(
        "name", 1).skip(10 * (page - 1)).limit(limit)

    # create list of collections and include courses in each collection
    collections_list = []
    for collection in await all_collections.to_list(length=100):
        collection = CollectionInDB(**collection)
        collections_list.append(collection)

        collection_courses = [course for course in collection.courses]
        # add courses to collection
        courses = request.app.db["courses"]
        collection.courses = []
        collection.courses = courses.find(
            {"course_id": {"$in": collection_courses}}, {'_id': 0})

        collection.courses = [course for course in await collection.courses.to_list(length=100)]

    return collections_list

#### Security ####################################################


async def verify_collection_rights(request: Request,collection_id: str,  current_user: PublicUser, action: str):
    collections = request.app.db["collections"]

    collection = await collections.find_one({"collection_id": collection_id})

    if not collection and action != "create":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Collection does not exist")

    hasRoleRights = await verify_user_rights_with_roles(request, action, current_user.user_id, collection_id)

    if not hasRoleRights:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="You do not have rights to this Collection")

    return True

#### Security ####################################################
