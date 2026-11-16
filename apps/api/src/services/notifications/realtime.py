"""Realtime delivery of notifications to the web bells (SSE over Redis pub/sub).

Each signed-in browser holds at most one stream (tabs elect a leader and share
it over a BroadcastChannel), opened on ``GET /notifications/stream?org_id=``.
The stream subscribes to the person's own channel, ``notif:user:{user_id}``,
and forwards the events that belong to the org it was opened for (or to no
org). Any API worker can publish; Redis carries the event to whichever worker
holds the stream.

Two events:

- ``notification.new``: a row was written; carries the serialized row so the
  bell can show it (and toast it when important) without a round trip.
- ``notification.changed``: rows were read, archived or deleted elsewhere (an
  other device, the mobile app); clients refetch their counts.

Without Redis nothing is published and the stream answers with an error
event; the web client then falls back to polling the unread counts.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import AsyncGenerator, Awaitable, Callable, Iterable, Optional

logger = logging.getLogger(__name__)

HEARTBEAT_SECONDS = 20


def user_channel(user_id: int) -> str:
    return f"notif:user:{user_id}"


def _publish(pairs: Iterable[tuple[int, dict]]) -> None:
    try:
        from src.core.redis import get_redis_client

        r = get_redis_client()
        if r is None:
            return
        pipe = r.pipeline(transaction=False)
        for user_id, event in pairs:
            pipe.publish(user_channel(user_id), json.dumps(event, default=str))
        pipe.execute()
    except Exception:
        logger.debug("notification publish failed", exc_info=True)


def publish_new(rows: Iterable) -> None:
    """Fan the freshly written rows out to their owners. Never raises."""
    try:
        from src.services.notifications.notifications import serialize

        events = [
            (n.user_id, {
                "type": "notification.new",
                "org_id": n.org_id,
                "audience": n.audience or "personal",
                "item": serialize(n),
            })
            for n in rows
        ]
        _publish(events)
    except Exception:
        logger.debug("notification publish failed", exc_info=True)


def publish_changed(user_id: int, org_id: Optional[int] = None) -> None:
    _publish([(user_id, {"type": "notification.changed", "org_id": org_id})])


def wanted(event: dict, org_id: Optional[int]) -> bool:
    """Events for the stream's org, for no org, or org-wide changes."""
    if org_id is None:
        return True
    ev_org = event.get("org_id")
    return ev_org is None or ev_org == org_id


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event, default=str)}\n\n"


async def event_stream(
    user_id: int,
    org_id: Optional[int],
    hello: dict,
    is_disconnected: Callable[[], Awaitable[bool]],
) -> AsyncGenerator[str, None]:
    from src.services.messaging.realtime import get_async_redis

    r = get_async_redis()
    if r is None:
        yield _sse({"type": "error", "message": "Realtime is unavailable"})
        return
    pubsub = r.pubsub()
    await pubsub.subscribe(user_channel(user_id))
    try:
        yield _sse(hello)
        loop = asyncio.get_event_loop()
        last_beat = loop.time()
        while True:
            if await is_disconnected():
                break
            message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
            if message and message.get("type") == "message":
                try:
                    event = json.loads(message.get("data"))
                except Exception:
                    event = None
                if isinstance(event, dict) and wanted(event, org_id):
                    yield _sse(event)
            now = loop.time()
            if now - last_beat >= HEARTBEAT_SECONDS:
                last_beat = now
                yield ": ping\n\n"
    except asyncio.CancelledError:
        pass
    finally:
        try:
            await pubsub.unsubscribe()
            await pubsub.aclose()
        except Exception:
            pass
