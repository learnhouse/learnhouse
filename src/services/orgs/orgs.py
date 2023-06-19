import json
from uuid import uuid4
from src.services.orgs.logos import upload_org_logo
from src.services.orgs.schemas.orgs import (
    Organization,
    OrganizationInDB,
    PublicOrganization,
)
from src.services.users.schemas.users import UserOrganization
from src.services.users.users import PublicUser
from src.security.security import verify_user_rights_with_roles
from fastapi import HTTPException, UploadFile, status, Request


async def get_organization(request: Request, org_id: str):
    orgs = request.app.db["organizations"]

    org = await orgs.find_one({"org_id": org_id})

    if not org:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Organization does not exist"
        )

    org = PublicOrganization(**org)
    return org


async def get_organization_by_slug(request: Request, org_slug: str):
    orgs = request.app.db["organizations"]

    org = await orgs.find_one({"slug": org_slug})

    if not org:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Organization does not exist"
        )

    org = PublicOrganization(**org)
    return org


async def create_org(
    request: Request, org_object: Organization, current_user: PublicUser
):
    orgs = request.app.db["organizations"]
    user = request.app.db["users"]

    # find if org already exists using name
    isOrgAvailable = await orgs.find_one({"slug": org_object.slug})

    if isOrgAvailable:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Organization slug already exists",
        )

    # generate org_id with uuid4
    org_id = str(f"org_{uuid4()}")

    org = OrganizationInDB(org_id=org_id, **org_object.dict())

    org_in_db = await orgs.insert_one(org.dict())

    user_organization: UserOrganization = UserOrganization(
        org_id=org_id, org_role="owner"
    )

    # add org to user
    await user.update_one(
        {"user_id": current_user.user_id},
        {"$addToSet": {"orgs": user_organization.dict()}},
    )

    # add role admin to org
    await user.update_one(
        {"user_id": current_user.user_id},
        {"$addToSet": {"roles": {"org_id": org_id, "role_id": "role_admin"}}},
    )

    if not org_in_db:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Unavailable database",
        )

    return org.dict()


async def update_org(
    request: Request, org_object: Organization, org_id: str, current_user: PublicUser
):
    # verify org rights
    await verify_org_rights(request, org_id, current_user, "update")

    orgs = request.app.db["organizations"]

    await orgs.find_one({"org_id": org_id})

    updated_org = OrganizationInDB(org_id=org_id, **org_object.dict())

    # update org
    await orgs.update_one({"org_id": org_id}, {"$set": updated_org.dict()})

    return updated_org.dict()


async def update_org_logo(
    request: Request, logo_file: UploadFile, org_id: str, current_user: PublicUser
):
    # verify org rights
    await verify_org_rights(request, org_id, current_user, "update")

    orgs = request.app.db["organizations"]

    await orgs.find_one({"org_id": org_id})

    name_in_disk = await upload_org_logo(logo_file)

    # update org
    await orgs.update_one({"org_id": org_id}, {"$set": {"logo": name_in_disk}})

    return {"detail": "Logo updated"}


async def delete_org(request: Request, org_id: str, current_user: PublicUser):
    await verify_org_rights(request, org_id, current_user, "delete")

    orgs = request.app.db["organizations"]

    org = await orgs.find_one({"org_id": org_id})

    if not org:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Organization does not exist"
        )

    isDeleted = await orgs.delete_one({"org_id": org_id})

    # remove org from all users
    users = request.app.db["users"]
    await users.update_many({}, {"$pull": {"orgs": {"org_id": org_id}}})

    if isDeleted:
        return {"detail": "Org deleted"}
    else:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Unavailable database",
        )


async def get_orgs_by_user(
    request: Request, user_id: str, page: int = 1, limit: int = 10
):
    orgs = request.app.db["organizations"]
    user = request.app.db["users"]

    if user_id == "anonymous":
        # raise error
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="User not logged in"
        )

    # get user orgs
    user_orgs = await user.find_one({"user_id": user_id})

    org_ids: list[UserOrganization] = []

    for org in user_orgs["orgs"]:
        if (
            org["org_role"] == "owner"
            or org["org_role"] == "editor"
            or org["org_role"] == "member"
        ):
            org_ids.append(org["org_id"])

    # find all orgs where org_id is in org_ids array

    all_orgs = (
        orgs.find({"org_id": {"$in": org_ids}})
        .sort("name", 1)
        .skip(10 * (page - 1))
        .limit(100)
    )

    return [
        json.loads(json.dumps(org, default=str))
        for org in await all_orgs.to_list(length=100)
    ]


#### Security ####################################################


async def verify_org_rights(
    request: Request,
    org_id: str,
    current_user: PublicUser,
    action: str,
):
    orgs = request.app.db["organizations"]

    org = await orgs.find_one({"org_id": org_id})

    if not org:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Organization does not exist"
        )

    hasRoleRights = await verify_user_rights_with_roles(
        request, action, current_user.user_id, org_id, org_id
    )

    if not hasRoleRights:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have rights to this organization",
        )

    return True


#### Security ####################################################
