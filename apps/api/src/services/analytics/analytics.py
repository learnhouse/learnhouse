import asyncio
import json
import logging
from datetime import datetime, timezone

import httpx

from config.config import get_learnhouse_config

logger = logging.getLogger(__name__)

# Shared httpx client for connection pooling
_client: httpx.AsyncClient | None = None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=10.0)
    return _client


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
    tb = config.tinybird_config

    if tb is None:
        return

    asyncio.create_task(
        _send_event(
            api_url=tb.api_url,
            token=tb.ingest_token,
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
    api_url: str,
    token: str,
    event_name: str,
    org_id: int,
    user_id: int,
    session_id: str,
    properties: dict,
    source: str,
    ip: str,
) -> None:
    try:
        client = _get_client()
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
        url = f"{api_url.rstrip('/')}/v0/events?name=events"
        resp = await client.post(
            url,
            json=payload,
            headers={"Authorization": f"Bearer {token}"},
        )
        if resp.status_code != 200 and resp.status_code != 202:
            logger.warning(
                "Tinybird event ingest failed (%d): %s",
                resp.status_code,
                resp.text[:300],
            )
    except Exception:
        logger.warning("Failed to send analytics event %s", event_name, exc_info=True)
