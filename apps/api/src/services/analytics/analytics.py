import asyncio
import json
import logging
from datetime import datetime, timezone

import httpx

from config.config import get_learnhouse_config

logger = logging.getLogger(__name__)

# Lazy singleton httpx client for Tinybird ingestion
_ingest_client: httpx.AsyncClient | None = None


def _get_ingest_client() -> httpx.AsyncClient | None:
    global _ingest_client
    if _ingest_client is not None:
        return _ingest_client

    config = get_learnhouse_config()
    tb = config.tinybird_config
    if tb is None:
        return None

    _ingest_client = httpx.AsyncClient(
        base_url=tb.api_url,
        headers={"Authorization": f"Bearer {tb.ingest_token}"},
        timeout=10.0,
    )
    return _ingest_client


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
    Fire-and-forget analytics event to Tinybird.
    All errors are swallowed and logged — analytics never breaks the app.
    """
    config = get_learnhouse_config()
    if config.tinybird_config is None:
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
        client = _get_ingest_client()
        if client is None:
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
        resp = await client.post(
            "/v0/events?name=events",
            json=payload,
        )
        if resp.status_code >= 400:
            logger.warning(
                "Tinybird ingest failed (%s): %s",
                resp.status_code,
                resp.text[:200],
            )
    except Exception:
        logger.warning("Failed to send analytics event %s", event_name, exc_info=True)
