from fastapi import APIRouter, Depends, Request
from src.security.auth import get_current_user
from src.services.users.users import PublicUser
from src.services.courses.collections import (
    Collection,
    create_collection,
    get_collection,
    get_collections,
    update_collection,
    delete_collection,
)


router = APIRouter()


@router.post("/")
async def api_create_collection(
    request: Request,
    collection_object: Collection,
    current_user: PublicUser = Depends(get_current_user),
):
    """
    Create new Collection
    """
    return await create_collection(request, collection_object, current_user)


@router.get("/{collection_id}")
async def api_get_collection(
    request: Request,
    collection_id: str,
    current_user: PublicUser = Depends(get_current_user),
):
    """
    Get single collection by ID
    """
    return await get_collection(request, collection_id, current_user)


@router.get("/org_id/{org_id}/page/{page}/limit/{limit}")
async def api_get_collections_by(
    request: Request,
    page: int,
    limit: int,
    org_id: str,
    current_user: PublicUser = Depends(get_current_user),
):
    """
    Get collections by page and limit
    """
    return await get_collections(request, org_id, current_user, page, limit)


@router.put("/{collection_id}")
async def api_update_collection(
    request: Request,
    collection_object: Collection,
    collection_id: str,
    current_user: PublicUser = Depends(get_current_user),
):
    """
    Update collection by ID
    """
    return await update_collection(
        request, collection_object, collection_id, current_user
    )


@router.delete("/{collection_id}")
async def api_delete_collection(
    request: Request,
    collection_id: str,
    current_user: PublicUser = Depends(get_current_user),
):
    """
    Delete collection by ID
    """

    return await delete_collection(request, collection_id, current_user)
