import asyncio
import json
import logging
from datetime import datetime, timezone

from src.services.analytics.backend import get_analytics_backend

logger = logging.getLogger(__name__)


async def track(
    event_name: str,
    org_id: int,
    user_id: int = 0,
    session_id: str = "",
    properties: dict | None = None,
    source: str = "api",
    ip: str = "",
) -> None:
    """
    Fire-and-forget analytics event to the configured backend (Tinybird or ClickHouse).
    All errors are swallowed and logged — analytics never breaks the app.
    """
    backend = get_analytics_backend()
    if backend is None:
        return

    asyncio.create_task(
        _send_event(
            event_name=event_name,
            org_id=org_id,
            user_id=user_id,
            session_id=session_id,
            properties=properties or {},
            source=source,
            ip=ip,
        )
    )


async def _send_event(
    event_name: str,
    org_id: int,
    user_id: int,
    session_id: str,
    properties: dict,
    source: str,
    ip: str,
) -> None:
    try:
        backend = get_analytics_backend()
        if backend is None:
            return

        payload = {
            "event_name": event_name,
            "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
            "org_id": org_id,
            "user_id": user_id,
            "session_id": session_id,
            "properties": json.dumps(properties),
            "source": source,
            "ip": ip,
        }
        await backend.ingest_event(payload)
    except Exception:
        logger.warning("Failed to send analytics event %s", event_name, exc_info=True)
