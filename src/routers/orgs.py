from fastapi import APIRouter, Depends
from src.services.auth import get_current_user
from src.services.orgs import Organization, create_org, delete_org, get_organization, get_orgs, update_org
from src.services.users import User


router = APIRouter()


@router.post("/")
async def api_create_org(org_object: Organization, current_user: User = Depends(get_current_user)):
    """
    Create new organization
    """
    return await create_org(org_object, current_user)


@router.get("/{org_id}")
async def api_get_org(org_id: str, current_user: User = Depends(get_current_user)):
    """
    Get single Org by ID
    """
    return await get_organization(org_id)


@router.get("/page/{page}/limit/{limit}")
async def api_get_org_by(page: int, limit: int, current_user: User = Depends(get_current_user)):
    """
    Get orgs by page and limit
    """
    return await get_orgs(page, limit)


@router.put("/{org_id}")
async def api_update_org(org_object: Organization, org_id: str, current_user: User = Depends(get_current_user)):
    """
    Update Org by ID
    """
    return await update_org(org_object, org_id, current_user)


@router.delete("/{org_id}")
async def api_delete_org(org_id: str, current_user: User = Depends(get_current_user)):
    """
    Delete Org by ID
    """

    return await delete_org(org_id, current_user)
