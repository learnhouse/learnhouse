from fastapi import APIRouter, Depends, Request
from src.db.install import InstallRead
from src.core.events.database import get_db_session
from src.db.organizations import OrganizationCreate
from src.db.users import UserCreate
from src.services.install.install import (
    create_install_instance,
    get_latest_install_instance,
    install_create_organization,
    install_create_organization_user,
    install_default_elements,
    update_install_instance,
)


router = APIRouter()


@router.post("/start")
async def api_create_install_instance(
    request: Request,
    data: dict,
    db_session=Depends(get_db_session),
) -> InstallRead:
    # create install
    install = await create_install_instance(request, data, db_session)

    return install


@router.get("/latest")
async def api_get_latest_install_instance(
    request: Request, db_session=Depends(get_db_session)
) -> InstallRead:
    # get latest created install
    install = await get_latest_install_instance(request, db_session=db_session)

    return install


@router.post("/default_elements")
async def api_install_def_elements(
    db_session=Depends(get_db_session),
):
    elements = install_default_elements(db_session)

    return elements


@router.post("/org")
async def api_install_org(
        org: OrganizationCreate,
        db_session=Depends(get_db_session),
):
    organization = install_create_organization(org, db_session)

    return organization


@router.post("/user")
async def api_install_user(
    data: UserCreate,
    org_slug: str,
    db_session=Depends(get_db_session),
):
    user = install_create_organization_user(data, org_slug, db_session)

    return user


@router.post("/update")
async def api_update_install_instance(
    request: Request,
    data: dict,
    step: int,
    db_session=Depends(get_db_session),
) -> InstallRead:

    # get latest created install
    install = await update_install_instance(request, data, step, db_session)

    return install
