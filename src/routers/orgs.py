
from fastapi import APIRouter, Depends, Request
from src.security.auth import get_current_user
from src.services.orgs import Organization, create_org, delete_org, get_organization, get_organization_by_slug, get_orgs_by_user, update_org
from src.services.users.users import PublicUser, User


router = APIRouter()


@router.post("/")
async def api_create_org(request: Request, org_object: Organization, current_user: PublicUser = Depends(get_current_user)):
    """
    Create new organization
    """
    return await create_org(request, org_object, current_user)


@router.get("/{org_id}")
async def api_get_org(request: Request, org_id: str, current_user: PublicUser = Depends(get_current_user)):
    """
    Get single Org by ID
    """
    return await get_organization(request, org_id)


@router.get("/slug/{org_slug}")
async def api_get_org_by_slug(request: Request, org_slug: str, current_user: User = Depends(get_current_user)):
    """
    Get single Org by Slug
    """
    return await get_organization_by_slug(request, org_slug)


@router.get("/user/page/{page}/limit/{limit}")
async def api_user_orgs(request: Request, page: int, limit: int, current_user: PublicUser = Depends(get_current_user)):
    """
    Get orgs by page and limit by user
    """
    return await get_orgs_by_user(request, current_user.user_id, page, limit)


@router.put("/{org_id}")
async def api_update_org(request: Request, org_object: Organization, org_id: str, current_user: PublicUser = Depends(get_current_user)):
    """
    Update Org by ID
    """
    return await update_org(request, org_object, org_id, current_user)


@router.delete("/{org_id}")
async def api_delete_org(request: Request, org_id: str, current_user: PublicUser = Depends(get_current_user)):
    """
    Delete Org by ID
    """

    return await delete_org(request, org_id, current_user)
