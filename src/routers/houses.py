from fastapi import APIRouter, Depends
from src.services.auth import get_current_user

from src.services.houses import House, HouseInDB, create_house, get_house, get_houses, update_house, delete_house
from src.services.users import User


router = APIRouter()


@router.post("/")
async def api_create_house(house_object: House, current_user: User = Depends(get_current_user)):
    """
    Create new house
    """
    return await create_house(house_object, current_user)


@router.get("/{house_id}")
async def api_get_house(house_id: str):
    """
    Get single House by house_id
    """
    return await get_house(house_id)


@router.get("/page/{page}/limit/{limit}")
async def api_get_house_by(page: int, limit: int):
    """
    Get houses by page and limit
    """
    return await get_houses(page, limit)


@router.put("/{house_id}")
async def api_update_house(house_object: House, house_id: str, current_user: User = Depends(get_current_user)):
    """
    Update House by house_id
    """
    return await update_house(house_object, house_id, current_user)


@router.delete("/{house_id}")
async def api_delete_house(house_id: str, current_user: User = Depends(get_current_user)):
    """
    Delete House by ID
    """

    return await delete_house(house_id, current_user)
