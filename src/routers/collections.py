from fastapi import APIRouter, Depends
from src.services.auth import get_current_user
from src.services.users import User
from src.services.collections import Collection, create_collection, get_collection, get_collections, update_collection, delete_collection


router = APIRouter()


@router.post("/")
async def api_create_collection(collection_object: Collection, current_user: User = Depends(get_current_user)):
    """
    Create new Collection
    """
    return await create_collection(collection_object, current_user)


@router.get("/{collection_id}")
async def api_get_collection(collection_id: str, current_user: User = Depends(get_current_user)):
    """
    Get single collection by ID
    """
    return await get_collection(collection_id, current_user)


@router.get("/page/{page}/limit/{limit}")
async def api_get_collection_by(page: int, limit: int, current_user: User = Depends(get_current_user)):
    """
    Get collections by page and limit
    """
    return await get_collections(page, limit, current_user)


@router.put("/{collection_id}")
async def api_update_collection(collection_object: Collection, collection_id: str, current_user: User = Depends(get_current_user)):
    """
    Update collection by ID
    """
    return await update_collection(collection_object, collection_id, current_user)


@router.delete("/{collection_id}")
async def api_delete_collection(collection_id: str, current_user: User = Depends(get_current_user)):
    """
    Delete collection by ID
    """

    return await delete_collection(collection_id, current_user)
