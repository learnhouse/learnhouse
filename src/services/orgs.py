import json
from typing import List
from uuid import uuid4
from pydantic import BaseModel
from src.services.users import User
from src.services.database import create_config_collection, check_database, create_database, learnhouseDB, learnhouseDB
from src.services.security import *
from fastapi import FastAPI, HTTPException, status, Request, Response, BackgroundTasks
from datetime import datetime

#### Classes ####################################################


class Organization(BaseModel):
    name: str
    description: str
    email: str
    slug :str 


class OrganizationInDB(Organization):
    org_id: str
    owners: List[str]
    admins: List[str]


#### Classes ####################################################


async def get_organization(org_id: str):
    await check_database()
    orgs = learnhouseDB["organizations"]

    org = orgs.find_one({"org_id": org_id})

    if not org:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Organization does not exist")

    org = Organization(**org)
    return org


async def create_org(org_object: Organization, current_user: User):
    await check_database()
    orgs = learnhouseDB["organizations"]

    # find if org already exists using name
    isOrgAvailable = orgs.find_one({"slug": org_object.slug})

    if isOrgAvailable:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Organization slug already exists")

    # generate org_id with uuid4
    org_id = str(f"org_{uuid4()}")

    org = OrganizationInDB(org_id=org_id, owners=[
        current_user.user_id], admins=[
        current_user.user_id], **org_object.dict())

    org_in_db = orgs.insert_one(org.dict())

    if not org_in_db:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Unavailable database")

    return org.dict()


async def update_org(org_object: Organization, org_id: str, current_user: User):
    await check_database()

    # verify org rights
    await verify_org_rights(org_id, current_user)

    orgs = learnhouseDB["organizations"]

    org = orgs.find_one({"org_id": org_id})

    # get owner & adminds value from org object database
    owners = org["owners"]
    admins = org["admins"]

    if not org:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Organization does not exist")

    updated_org = OrganizationInDB(
        org_id=org_id, owners=owners, admins=admins, **org_object.dict())

    orgs.update_one({"org_id": org_id}, {"$set": updated_org.dict()})

    return Organization(**updated_org.dict())


async def delete_org(org_id: str, current_user: User):
    await check_database()

    await verify_org_rights(org_id, current_user,"delete")

    orgs = learnhouseDB["organizations"]

    org = orgs.find_one({"org_id": org_id})

    if not org:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Organization does not exist")

    isDeleted = orgs.delete_one({"org_id": org_id})

    if isDeleted:
        return {"detail": "Org deleted"}
    else:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Unavailable database")


async def get_orgs(page: int = 1, limit: int = 10):
    ## TODO : Deprecated
    await check_database()
    orgs = learnhouseDB["organizations"]

    # get all orgs from database
    all_orgs = orgs.find().sort("name", 1).skip(10 * (page - 1)).limit(limit)

    return [json.loads(json.dumps(org, default=str)) for org in all_orgs]


async def get_orgs_by_user(user_id: str, page: int = 1, limit: int = 10):
    await check_database()
    orgs = learnhouseDB["organizations"]
    print(user_id)
    # find all orgs where user_id is in owners or admins arrays 
    all_orgs = orgs.find({"$or": [{"owners": user_id}, {"admins": user_id}]}).sort("name", 1).skip(10 * (page - 1)).limit(limit)
    
    return [json.loads(json.dumps(org, default=str)) for org in all_orgs]
    


#### Security ####################################################

async def verify_org_rights(org_id: str,  current_user: User, action: str,):
    await check_database()
    orgs = learnhouseDB["organizations"]

    org = orgs.find_one({"org_id": org_id})

    if not org:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Organization does not exist")

    isOwner = current_user.user_id in org["owners"]
    hasRoleRights = await verify_user_rights_with_roles(action, current_user.user_id, org_id)

    if not hasRoleRights and not isOwner:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="You do not have rights to this organization")

    return True

#### Security ####################################################
