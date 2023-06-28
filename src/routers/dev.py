from fastapi import APIRouter, Request
from config.config import get_learnhouse_config
from src.services.dev.mocks.initial import create_initial_data


router = APIRouter()


@router.get("/config")
async def config():
    config = get_learnhouse_config()
    return config.dict()


@router.get("/mock/initial")
async def initial_data(request: Request):
    await create_initial_data(request)
    return {"Message": "Initial data created 🤖"}
