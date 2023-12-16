from fastapi import APIRouter, Depends, Request
from sqlmodel import Session
from src.core.events.database import get_db_session
from src.services.dev.migration_from_mongo import start_migrate_from_mongo
from config.config import get_learnhouse_config


router = APIRouter()


@router.get("/config")
async def config():
    config = get_learnhouse_config()
    return config.dict()


@router.get("/migrate_from_mongo")
async def migrate_from_mongo(
    request: Request,
    db_session: Session = Depends(get_db_session),
):
    return await start_migrate_from_mongo(request, db_session)
