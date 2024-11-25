from fastapi import HTTPException
from sqlmodel import Session, select
from src.db.organizations import Organization

async def check_database_health(db_session: Session) -> bool:
    statement = select(Organization)
    result = db_session.exec(statement)

    if not result:
        return False

    return True

async def check_health(db_session: Session) -> bool:
    # Check database health
    database_healthy = await check_database_health(db_session)

    if not database_healthy:
        raise HTTPException(status_code=503, detail="Database is not healthy")

    return True
