"""More tests for src/services/messaging/realtime.py: the async client,
error branches, and the SSE loop's heartbeat, parse fallback and teardown."""

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from src.services.messaging import realtime
from src.tests.services.test_messaging_realtime import FakeAsyncRedis, FakeSyncRedis


def _config(url):
    return SimpleNamespace(redis_config=SimpleNamespace(redis_connection_string=url))


def test_get_async_redis_builds_client_once(monkeypatch):
    monkeypatch.setattr(realtime, "_async_client", None)
    client = MagicMock()
    with patch.object(realtime, "get_learnhouse_config", return_value=_config("redis://x:1/0")), \
         patch.object(realtime.aioredis, "from_url", return_value=client) as from_url:
        assert realtime.get_async_redis() is client
        assert realtime.get_async_redis() is client
    from_url.assert_called_once_with("redis://x:1/0", decode_responses=True)


def test_get_async_redis_without_url(monkeypatch):
    monkeypatch.setattr(realtime, "_async_client", None)
    with patch.object(realtime, "get_learnhouse_config", return_value=_config("")):
        assert realtime.get_async_redis() is None


def test_online_user_ids_empty_set():
    r = FakeSyncRedis()
    with patch("src.services.messaging.realtime.get_redis_client", return_value=r):
        assert realtime.online_user_ids(4) == set()


def test_redis_errors_are_swallowed():
    r = MagicMock()
    r.pipeline.side_effect = RuntimeError("down")
    r.publish.side_effect = RuntimeError("down")
    r.smembers.side_effect = RuntimeError("down")
    r.exists.side_effect = RuntimeError("down")
    with patch("src.services.messaging.realtime.get_redis_client", return_value=r):
        realtime.publish_to_users(1, [1], {"type": "x"})
        realtime.publish_to_org(1, {"type": "x"})
        assert realtime.online_user_ids(1) == set()
        assert realtime.is_online(1, 1) is False


async def _collect(gen):
    return [chunk async for chunk in gen]


def _disconnect_after(n):
    calls = {"n": 0}

    async def is_disconnected():
        calls["n"] += 1
        return calls["n"] > n

    return is_disconnected


async def _no_presence(online):
    return None


async def _noop():
    pass


async def test_event_stream_heartbeat_and_raw_data():
    fake = FakeAsyncRedis([{"type": "message", "data": "not json"}])
    with patch("src.services.messaging.realtime.get_async_redis", return_value=fake), \
         patch("src.services.messaging.realtime.online_user_ids", return_value=set()), \
         patch.object(realtime, "HEARTBEAT_SECONDS", 0):
        chunks = await _collect(realtime.event_stream(
            2, 5, {"type": "hello"}, _no_presence, _noop, _disconnect_after(1)
        ))
    assert chunks[1:] == ["data: not json\n\n", ": ping\n\n"]
    assert "msg:presence:2:5" not in fake.keys  # removed on disconnect
    assert fake.published == []


async def test_event_stream_cancelled_still_cleans_up():
    fake = FakeAsyncRedis([])

    async def cancelled(**kwargs):
        raise asyncio.CancelledError

    fake._pubsub.get_message = cancelled
    offline = MagicMock()

    async def on_offline():
        offline()

    with patch("src.services.messaging.realtime.get_async_redis", return_value=fake), \
         patch("src.services.messaging.realtime.online_user_ids", return_value=set()):
        chunks = await _collect(realtime.event_stream(
            2, 5, {"type": "hello"}, _no_presence, on_offline, _disconnect_after(5)
        ))
    assert len(chunks) == 1
    offline.assert_called_once()
    assert fake.counters == {}


async def test_event_stream_teardown_errors_are_swallowed():
    fake = FakeAsyncRedis([])

    async def boom(*args, **kwargs):
        raise RuntimeError("down")

    fake._pubsub.unsubscribe = boom
    fake.decr = boom
    with patch("src.services.messaging.realtime.get_async_redis", return_value=fake), \
         patch("src.services.messaging.realtime.online_user_ids", return_value=set()):
        chunks = await _collect(realtime.event_stream(
            2, 5, {"type": "hello"}, _no_presence, _noop, _disconnect_after(0)
        ))
    assert json.loads(chunks[0][6:])["type"] == "hello"
