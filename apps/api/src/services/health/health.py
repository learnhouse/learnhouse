from fastapi import HTTPException
from sqlmodel import Session
from sqlalchemy import text

async def check_database_health(db_session: Session) -> bool:
    result = db_session.exec(text("SELECT 1"))

    if not result:
        return False

    return True

async def check_health(db_session: Session) -> bool:
    # Check database health
    database_healthy = await check_database_health(db_session)

    if not database_healthy:
        raise HTTPException(status_code=503, detail="Database is not healthy")

    return True
