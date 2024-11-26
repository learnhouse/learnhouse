from fastapi import APIRouter, Depends
from sqlmodel import Session, select
from config.config import get_learnhouse_config
from migrations.orgconfigs.orgconfigs_migrations import migrate_to_v1_1, migrate_to_v1_2, migrate_v0_to_v1
from src.core.events.database import get_db_session
from src.db.organization_config import OrganizationConfig


router = APIRouter()


@router.get("/config")
async def config():
    config = get_learnhouse_config()
    return config.dict()


@router.post("/migrate_orgconfig_v0_to_v1")
async def migrate(
    db_session: Session = Depends(get_db_session),
):
    """
    Migrate organization config from v0 to v1
    """
    statement = select(OrganizationConfig)
    result = db_session.exec(statement)

    for orgConfig in result:
        orgConfig.config = migrate_v0_to_v1(orgConfig.config)

        db_session.add(orgConfig)
        db_session.commit()

    return {"message": "Migration successful"}


@router.post("/migrate_orgconfig_v1_to_v1.1")
async def migratev1_1(
    db_session: Session = Depends(get_db_session),
):
    """
    Migrate organization config from v0 to v1
    """
    statement = select(OrganizationConfig)
    result = db_session.exec(statement)

    for orgConfig in result:
        orgConfig.config = migrate_to_v1_1(orgConfig.config)

        db_session.add(orgConfig)
        db_session.commit()

    return {"message": "Migration successful"}

@router.post("/migrate_orgconfig_v1_to_v1.2")
async def migratev1_2(
    db_session: Session = Depends(get_db_session),
):
    """
    Migrate organization config from v0 to v1
    """
    statement = select(OrganizationConfig)
    result = db_session.exec(statement)

    for orgConfig in result:
        orgConfig.config = migrate_to_v1_2(orgConfig.config)

        db_session.add(orgConfig)
        db_session.commit()

    return {"message": "Migration successful"}