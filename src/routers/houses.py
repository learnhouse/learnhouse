from fastapi import APIRouter, Depends, Request
from src.dependencies.auth import get_current_user

from src.services.houses import House, HouseInDB, create_house, get_house, get_houses, update_house, delete_house
from src.services.users import PublicUser, User


router = APIRouter()


@router.post("/")
async def api_create_house(request: Request,house_object: House, current_user: PublicUser = Depends(get_current_user)):
    """
    Create new house
    """
    return await create_house(request, house_object, current_user)


@router.get("/{house_id}")
async def api_get_house(request: Request,house_id: str, current_user: PublicUser = Depends(get_current_user)):
    """
    Get single House by house_id
    """
    return await get_house(request, house_id, current_user=current_user)


@router.get("/page/{page}/limit/{limit}")
async def api_get_house_by(request: Request,page: int, limit: int):
    """
    Get houses by page and limit
    """
    return await get_houses(request, page, limit)


@router.put("/{house_id}")
async def api_update_house(request: Request,house_object: House, house_id: str, current_user: PublicUser = Depends(get_current_user)):
    """
    Update House by house_id
    """
    return await update_house(request, house_object, house_id, current_user)


@router.delete("/{house_id}")
async def api_delete_house(request: Request,house_id: str, current_user: PublicUser = Depends(get_current_user)):
    """
    Delete House by ID
    """

    return await delete_house(request, house_id, current_user)
