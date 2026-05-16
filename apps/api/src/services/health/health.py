from fastapi import HTTPException
from sqlalchemy import text
from sqlmodel.ext.asyncio.session import AsyncSession


async def check_database_health(db_session: AsyncSession) -> bool:
    result = await db_session.execute(text("SELECT 1"))

    if not result:
        return False

    return True

async def check_health(db_session: AsyncSession) -> bool:
    # Check database health
    database_healthy = await check_database_health(db_session)

    if not database_healthy:
        raise HTTPException(status_code=503, detail="Database is not healthy")

    return True
