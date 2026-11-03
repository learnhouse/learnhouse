"""Realtime delivery for messaging: Redis pub/sub fan-out, presence, SSE.

Every signed-in tab holds one SSE stream. It subscribes to the person's own
channel (messages, reactions, typing and reads for conversations they are in)
and to the org channel (presence). Any API worker can publish; Redis carries
the event to whichever worker holds the stream.

Presence is counted per connection: each stream bumps a counter while it is
open, and the person is online while the counter is above zero. The counter
and the presence key both carry a TTL refreshed by the stream's heartbeat, so a
worker that dies mid-stream cannot leave someone online forever.
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import AsyncGenerator, Iterable, Optional

import redis.asyncio as aioredis

from config.config import get_learnhouse_config
from src.core.redis import get_redis_client

logger = logging.getLogger(__name__)

HEARTBEAT_SECONDS = 20
PRESENCE_TTL_SECONDS = 50

_async_client: Optional[aioredis.Redis] = None


def _user_channel(user_id: int) -> str:
    return f"msg:user:{user_id}"


def _org_channel(org_id: int) -> str:
    return f"msg:org:{org_id}"


def _presence_key(org_id: int, user_id: int) -> str:
    return f"msg:presence:{org_id}:{user_id}"


def _connections_key(org_id: int, user_id: int) -> str:
    return f"msg:conns:{org_id}:{user_id}"


def _online_set_key(org_id: int) -> str:
    return f"msg:online:{org_id}"


def get_async_redis() -> Optional[aioredis.Redis]:
    global _async_client
    if _async_client is None:
        url = get_learnhouse_config().redis_config.redis_connection_string
        if not url:
            return None
        _async_client = aioredis.from_url(url, decode_responses=True)
    return _async_client


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ----------------------------------------------------------------------------
# Publishing
# ----------------------------------------------------------------------------

def publish_to_users(user_ids: Iterable[int], event: dict) -> None:
    """Fire-and-forget fan-out to each user's channel."""
    r = get_redis_client()
    if r is None:
        return
    payload = json.dumps(event, default=str)
    try:
        pipe = r.pipeline(transaction=False)
        for uid in set(user_ids):
            pipe.publish(_user_channel(uid), payload)
        pipe.execute()
    except Exception:
        logger.debug("messaging publish failed", exc_info=True)


def publish_to_org(org_id: int, event: dict) -> None:
    r = get_redis_client()
    if r is None:
        return
    try:
        r.publish(_org_channel(org_id), json.dumps(event, default=str))
    except Exception:
        logger.debug("messaging org publish failed", exc_info=True)


# ----------------------------------------------------------------------------
# Presence
# ----------------------------------------------------------------------------

def online_user_ids(org_id: int) -> set[int]:
    """Users with at least one open stream in this org. Stale set members (a
    worker died before cleaning up) are filtered by their expired presence key."""
    r = get_redis_client()
    if r is None:
        return set()
    try:
        members = [int(m) for m in r.smembers(_online_set_key(org_id))]
        if not members:
            return set()
        pipe = r.pipeline(transaction=False)
        for uid in members:
            pipe.exists(_presence_key(org_id, uid))
        alive = pipe.execute()
        stale = [uid for uid, ok in zip(members, alive) if not ok]
        if stale:
            r.srem(_online_set_key(org_id), *stale)
        return {uid for uid, ok in zip(members, alive) if ok}
    except Exception:
        logger.debug("online_user_ids failed", exc_info=True)
        return set()


def is_online(org_id: int, user_id: int) -> bool:
    r = get_redis_client()
    if r is None:
        return False
    try:
        return bool(r.exists(_presence_key(org_id, user_id)))
    except Exception:
        return False


async def _connect(r: aioredis.Redis, org_id: int, user_id: int) -> bool:
    """Count a new stream. Returns True when the user just came online."""
    conns = await r.incr(_connections_key(org_id, user_id))
    await r.expire(_connections_key(org_id, user_id), PRESENCE_TTL_SECONDS * 4)
    await r.set(_presence_key(org_id, user_id), _now_iso(), ex=PRESENCE_TTL_SECONDS)
    await r.sadd(_online_set_key(org_id), user_id)
    return conns == 1


async def _heartbeat(r: aioredis.Redis, org_id: int, user_id: int) -> None:
    await r.set(_presence_key(org_id, user_id), _now_iso(), ex=PRESENCE_TTL_SECONDS)
    await r.expire(_connections_key(org_id, user_id), PRESENCE_TTL_SECONDS * 4)


async def _disconnect(r: aioredis.Redis, org_id: int, user_id: int) -> bool:
    """Uncount a stream. Returns True when the user just went offline."""
    conns = await r.decr(_connections_key(org_id, user_id))
    if conns <= 0:
        await r.delete(_connections_key(org_id, user_id), _presence_key(org_id, user_id))
        await r.srem(_online_set_key(org_id), user_id)
        return True
    return False


# ----------------------------------------------------------------------------
# SSE stream
# ----------------------------------------------------------------------------

def _sse(event: dict) -> str:
    return f"data: {json.dumps(event, default=str)}\n\n"


async def event_stream(
    org_id: int,
    user_id: int,
    hello: dict,
    presence_payload,
    on_offline,
    is_disconnected,
) -> AsyncGenerator[str, None]:
    """One person's live stream.

    ``presence_payload(online)`` builds the presence event others see (it
    respects invisible mode), ``on_offline()`` persists last-seen, and
    ``is_disconnected()`` is the request's disconnect probe.
    """
    r = get_async_redis()
    if r is None:
        yield _sse({"type": "error", "message": "Realtime is unavailable"})
        return

    pubsub = r.pubsub()
    await pubsub.subscribe(_user_channel(user_id), _org_channel(org_id))
    came_online = False
    try:
        came_online = await _connect(r, org_id, user_id)
        if came_online:
            event = await presence_payload(True)
            if event:
                await r.publish(_org_channel(org_id), json.dumps(event, default=str))

        hello["online_user_ids"] = sorted(online_user_ids(org_id))
        yield _sse(hello)

        loop = asyncio.get_event_loop()
        last_beat = loop.time()
        while True:
            if await is_disconnected():
                break
            message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
            if message and message.get("type") == "message":
                data = message.get("data")
                # Presence for yourself is noise; the client tracks its own.
                try:
                    parsed = json.loads(data)
                    if parsed.get("type") == "presence" and parsed.get("user_id") == user_id:
                        continue
                except Exception:
                    pass
                yield f"data: {data}\n\n"
            now = loop.time()
            if now - last_beat >= HEARTBEAT_SECONDS:
                last_beat = now
                await _heartbeat(r, org_id, user_id)
                # SSE comment: keeps proxies from closing an idle stream.
                yield ": ping\n\n"
    except asyncio.CancelledError:
        pass
    finally:
        try:
            await pubsub.unsubscribe()
            await pubsub.aclose()
        except Exception:
            pass
        try:
            went_offline = await _disconnect(r, org_id, user_id)
            if went_offline:
                await on_offline()
                event = await presence_payload(False)
                if event:
                    await r.publish(_org_channel(org_id), json.dumps(event, default=str))
        except Exception:
            logger.debug("presence disconnect failed", exc_info=True)
