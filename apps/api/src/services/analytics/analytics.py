"""Analytics event writer.

``track()`` validates an event against the catalog (``events.py``), turns it
into an ``analytics_event`` row and queues it. Queued rows are written in one
multi-row INSERT, at most a second later or as soon as ``MAX_BUFFER`` rows are
waiting, so a burst of page views costs one round trip instead of hundreds.

Analytics never breaks the app: every error is logged and swallowed. Rows that
are still queued when the process stops are written by ``flush()``, which the
shutdown hook awaits.
"""

import asyncio
import logging
import math
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import insert

from src.db.analytics import AnalyticsEvent
from src.services.analytics.events import CATALOG, COLUMN_PROPERTIES

logger = logging.getLogger(__name__)

FLUSH_INTERVAL_SECONDS = 1.0
MAX_BUFFER = 200
# Hard cap so a database outage can't grow the queue without bound.
MAX_QUEUED = 10_000
MAX_STRING = 512
MAX_SECONDS_SPENT = 4 * 3600

_STRING_COLUMNS = {
    "course_uuid": 100,
    "activity_uuid": 100,
    "path": 512,
    "referrer_domain": 255,
}

_buffer: list[dict] = []
_flush_task: asyncio.Task | None = None
# Strong references so the GC does not collect tasks before they complete
_background_tasks: set = set()


def _clean_value(value: Any) -> Any:
    """Scalars only; strings capped. Anything else is dropped (None)."""
    if isinstance(value, bool) or value is None:
        return value
    if isinstance(value, (int, float)):
        return value if not (isinstance(value, float) and not math.isfinite(value)) else None
    if isinstance(value, str):
        return value[:MAX_STRING]
    return None


def _seconds(value: Any) -> float | None:
    try:
        seconds = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(seconds) or seconds <= 0:
        return None
    return min(seconds, MAX_SECONDS_SPENT)


def build_row(
    event_name: str,
    org_id: int,
    user_id: int = 0,
    session_id: str = "",
    properties: dict | None = None,
    source: str = "api",
    actor_key: str | None = None,
    country: str | None = None,
    device: str | None = None,
) -> dict | None:
    """The ``analytics_event`` row for an event, or None if it isn't in the catalog."""
    spec = CATALOG.get(event_name)
    if spec is None:
        logger.debug("Dropping uncatalogued analytics event %r", event_name)
        return None

    props = properties or {}
    row: dict[str, Any] = {
        "ts": datetime.now(timezone.utc),
        "org_id": int(org_id),
        "event_name": event_name,
        "source": source[:16],
        "user_id": int(user_id or 0),
        "actor_key": (actor_key or (f"u:{user_id}" if user_id else ""))[:80],
        "session_id": (session_id or "")[:64],
        "country": (country or "").upper()[:2] or None,
        "device": (device or "")[:16] or None,
        "seconds_spent": _seconds(props["seconds_spent"]) if "seconds_spent" in props else None,
    }
    for column, limit in _STRING_COLUMNS.items():
        value = props.get(column)
        row[column] = str(value)[:limit] if isinstance(value, (str, int)) and str(value) else None

    extra = {}
    for key in spec.props:
        if key in props and key not in COLUMN_PROPERTIES:
            value = _clean_value(props[key])
            if value is not None:
                extra[key] = value
    row["properties"] = extra
    return row


async def track(
    event_name: str,
    org_id: int,
    user_id: int = 0,
    session_id: str = "",
    properties: dict | None = None,
    source: str = "api",
    actor_key: str | None = None,
    country: str | None = None,
    device: str | None = None,
) -> None:
    """Queue an analytics event. Fire-and-forget; never raises."""
    try:
        row = build_row(
            event_name, org_id, user_id, session_id, properties, source, actor_key, country, device
        )
    except Exception:
        logger.warning("Invalid analytics event %s", event_name, exc_info=True)
        return
    if row is None:
        return
    enqueue([row])


def enqueue(rows: list[dict]) -> None:
    if len(_buffer) >= MAX_QUEUED:
        logger.warning("Analytics queue full, dropping %d events", len(rows))
        return
    _buffer.extend(rows)
    _schedule(0 if len(_buffer) >= MAX_BUFFER else FLUSH_INTERVAL_SECONDS)


def _schedule(delay: float) -> None:
    global _flush_task
    if delay and _flush_task is not None and not _flush_task.done():
        return
    task = asyncio.create_task(_flush_after(delay))
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    _flush_task = task


async def _flush_after(delay: float) -> None:
    if delay:
        await asyncio.sleep(delay)
    await flush()


async def flush() -> None:
    """Write every queued row now."""
    if not _buffer:
        return
    rows = list(_buffer)
    _buffer.clear()
    try:
        from src.core.events.database import _async_session_factory

        async with _async_session_factory() as db:
            await db.execute(insert(AnalyticsEvent.__table__), rows)
            await db.commit()
    except Exception:
        logger.warning("Failed to write %d analytics events", len(rows), exc_info=True)
