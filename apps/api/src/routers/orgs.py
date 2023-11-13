from fastapi import APIRouter, Depends, Request, UploadFile
from sqlmodel import Session
from src.db.users import PublicUser
from src.db.organizations import OrganizationCreate, OrganizationUpdate
from src.core.events.database import get_db_session
from src.security.auth import get_current_user
from src.services.orgs.orgs import (
    create_org,
    delete_org,
    get_organization,
    get_organization_by_slug,
    get_orgs_by_user,
    update_org,
    update_org_logo,
)


router = APIRouter()


@router.post("/")
async def api_create_org(
    request: Request,
    org_object: OrganizationCreate,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Create new organization
    """
    return await create_org(request, org_object, current_user, db_session)


@router.get("/{org_id}")
async def api_get_org(
    request: Request,
    org_id: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Get single Org by ID
    """
    return await get_organization(request, org_id, db_session)


@router.get("/slug/{org_slug}")
async def api_get_org_by_slug(
    request: Request,
    org_slug: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Get single Org by Slug
    """
    return await get_organization_by_slug(request, org_slug, db_session)


@router.put("/{org_id}/logo")
async def api_update_org_logo(
    request: Request,
    org_id: str,
    logo_file: UploadFile,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Get single Org by Slug
    """
    return await update_org_logo(
        request=request,
        logo_file=logo_file,
        org_id=org_id,
        current_user=current_user,
        db_session=db_session,
    )


@router.get("/user/page/{page}/limit/{limit}")
async def api_user_orgs(
    request: Request,
    page: int,
    limit: int,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Get orgs by page and limit by user
    """
    return await get_orgs_by_user(
        request, db_session, str(current_user.id), page, limit
    )


@router.put("/")
async def api_update_org(
    request: Request,
    org_object: OrganizationUpdate,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Update Org by ID
    """
    return await update_org(request, org_object, current_user, db_session)


@router.delete("/{org_id}")
async def api_delete_org(
    request: Request,
    org_id: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Delete Org by ID
    """

    return await delete_org(request, org_id, current_user, db_session)
