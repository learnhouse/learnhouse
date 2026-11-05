"""Read side of analytics: run a catalog query against Postgres.

Queries come only from ``queries.py`` and take bind parameters (never string
interpolation). Each runs in its own short transaction with a statement
timeout, so a heavy dashboard can't hold a connection the app needs.
"""

import math
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import text

STATEMENT_TIMEOUT_MS = 20_000


def _jsonable(value):
    if isinstance(value, Decimal):
        value = float(value)
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%d %H:%M:%S")
    if isinstance(value, date):
        return value.isoformat()
    return value


async def run_query(sql: str, params: dict) -> list[dict]:
    """Rows as JSON-ready dicts (dates as ISO strings, NaN/Inf as None)."""
    from src.core.events.database import _async_session_factory

    async with _async_session_factory() as db:
        if db.bind.dialect.name == "postgresql":
            await db.execute(text(f"SET LOCAL statement_timeout = {STATEMENT_TIMEOUT_MS}"))
        result = await db.execute(text(sql), params)
        rows = [{key: _jsonable(value) for key, value in row._mapping.items()} for row in result]
        await db.rollback()
    return rows
