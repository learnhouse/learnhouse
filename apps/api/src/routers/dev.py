from fastapi import APIRouter
from config.config import get_learnhouse_config


router = APIRouter()


@router.get("/config")
async def config():
    config = get_learnhouse_config()
    return config.dict()
