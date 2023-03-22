import json
from typing import List
from uuid import uuid4
from pydantic import BaseModel
from src.services.users.schemas.users import UserOrganization
from src.services.users.users import PublicUser, User
from src.services.security import *
from fastapi import FastAPI, HTTPException, status, Request, Response, BackgroundTasks
from datetime import datetime

#### Classes ####################################################


class Organization(BaseModel):
    name: str
    description: str
    email: str
    slug: str


class OrganizationInDB(Organization):
    org_id: str
    owners: List[str]
    admins: List[str]


class PublicOrganization(Organization):
    name: str
    description: str
    email: str
    slug: str
    org_id: str


#### Classes ####################################################


async def get_organization(request: Request, org_id: str):
    orgs = request.app.db["organizations"]

    org = await orgs.find_one({"org_id": org_id})

    if not org:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Organization does not exist")

    org = PublicOrganization(**org)
    return org


async def get_organization_by_slug(request: Request, org_slug: str):
    orgs = request.app.db["organizations"]

    org = await orgs.find_one({"slug": org_slug})

    if not org:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Organization does not exist")

    org = PublicOrganization(**org)
    return org


async def create_org(request: Request, org_object: Organization, current_user: PublicUser):
    orgs = request.app.db["organizations"]
    user = request.app.db["users"]

    # find if org already exists using name
    isOrgAvailable = await orgs.find_one({"slug": org_object.slug})

    if isOrgAvailable:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Organization slug already exists")

    # generate org_id with uuid4
    org_id = str(f"org_{uuid4()}")

    org = OrganizationInDB(org_id=org_id, owners=[
        current_user.user_id], admins=[
        current_user.user_id], **org_object.dict())

    org_in_db = await orgs.insert_one(org.dict())

    user_organization: UserOrganization = UserOrganization(
        org_id=org_id, org_role="owner")
    
    # add org to user
    await user.update_one({"user_id": current_user.user_id}, {
        "$addToSet": {"orgs": user_organization.dict()}})

    if not org_in_db:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Unavailable database")

    return org.dict()


async def update_org(request: Request, org_object: Organization, org_id: str, current_user: PublicUser):

    # verify org rights
    await verify_org_rights(request, org_id, current_user, "update")

    orgs = request.app.db["organizations"]

    org = await orgs.find_one({"org_id": org_id})

    if org:
        owners = org["owners"]
        admins = org["admins"]

    else:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Organization does not exist")

    updated_org = OrganizationInDB(
        org_id=org_id, owners=owners, admins=admins, **org_object.dict())

    await orgs.update_one({"org_id": org_id}, {"$set": updated_org.dict()})

    return Organization(**updated_org.dict())


async def delete_org(request: Request, org_id: str, current_user: PublicUser):

    await verify_org_rights(request, org_id, current_user, "delete")

    orgs = request.app.db["organizations"]

    org = await orgs.find_one({"org_id": org_id})

    if not org:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Organization does not exist")

    isDeleted = await orgs.delete_one({"org_id": org_id})

    # remove org from all users
    users = request.app.db["users"]
    await users.update_many({}, {"$pull": {"orgs": {"org_id": org_id}}})

    if isDeleted:
        return {"detail": "Org deleted"}
    else:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Unavailable database")


async def get_orgs_by_user(request: Request, user_id: str, page: int = 1, limit: int = 10):
    orgs = request.app.db["organizations"]
    user = request.app.db["users"]

    # get user orgs 
    user_orgs = await user.find_one({"user_id": user_id})

    org_ids : list[UserOrganization] = []

    for org in user_orgs["orgs"]:
        if org["org_role"] == "owner" or org["org_role"] == "editor" or org["org_role"] == "member":
            org_ids.append(org["org_id"])

    # find all orgs where org_id is in org_ids array

    all_orgs = orgs.find({"org_id": {"$in": org_ids}}).sort(
        "name", 1).skip(10 * (page - 1)).limit(100)

    return [json.loads(json.dumps(org, default=str)) for org in await all_orgs.to_list(length=100)]


#### Security ####################################################

async def verify_org_rights(request: Request, org_id: str,  current_user: PublicUser, action: str,):
    orgs = request.app.db["organizations"]

    org = await orgs.find_one({"org_id": org_id})

    if not org:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Organization does not exist")

    isOwner = current_user.user_id in org["owners"]
    hasRoleRights = await verify_user_rights_with_roles(request, action, current_user.user_id, org_id, org_id)

    if not hasRoleRights and not isOwner:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="You do not have rights to this organization")

    return True

#### Security ####################################################
