from fastapi import APIRouter, Request

from src.services.install.install import (
    create_install_instance,
    create_sample_data,
    get_latest_install_instance,
    install_create_organization,
    install_create_organization_user,
    install_default_elements,
    update_install_instance,
)
from src.services.orgs.schemas.orgs import Organization
from src.services.users.schemas.users import UserWithPassword


router = APIRouter()


@router.post("/start")
async def api_create_install_instance(request: Request, data: dict):
    # create install
    install = await create_install_instance(request, data)

    return install


@router.get("/latest")
async def api_get_latest_install_instance(request: Request):
    # get latest created install
    install = await get_latest_install_instance(request)

    return install


@router.post("/default_elements")
async def api_install_def_elements(request: Request):
    elements = await install_default_elements(request, {})

    return elements


@router.post("/org")
async def api_install_org(request: Request, org: Organization):
    organization = await install_create_organization(request, org)

    return organization


@router.post("/user")
async def api_install_user(request: Request, data: UserWithPassword, org_slug: str):
    user = await install_create_organization_user(request, data, org_slug)

    return user


@router.post("/sample")
async def api_install_user_sample(request: Request, username: str, org_slug: str):
    sample = await create_sample_data(org_slug, username, request)

    return sample


@router.post("/update")
async def api_update_install_instance(request: Request, data: dict, step: int):
    request.app.db["installs"]

    # get latest created install
    install = await update_install_instance(request, data, step)

    return install
