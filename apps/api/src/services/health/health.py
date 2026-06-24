from fastapi import HTTPException
from sqlalchemy import text
from sqlmodel.ext.asyncio.session import AsyncSession


async def check_database_health(db_session: AsyncSession) -> bool:
    # A Result object is always truthy, so the previous `if not result` was dead
    # code and an actual DB outage raised an uncaught exception (500) instead of
    # being reported as unhealthy. Materialize the scalar and fail closed.
    try:
        result = await db_session.execute(text("SELECT 1"))
        value = result.scalar()
    except Exception:
        return False

    return value == 1

async def check_health(db_session: AsyncSession) -> bool:
    # Check database health
    database_healthy = await check_database_health(db_session)

    if not database_healthy:
        raise HTTPException(status_code=503, detail="Database is not healthy")

    return True
