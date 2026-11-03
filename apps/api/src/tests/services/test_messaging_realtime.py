"""Tests for src/services/messaging/realtime.py: fan-out, presence counting
and the SSE loop, against small in-memory Redis stand-ins."""

import json
from unittest.mock import MagicMock, patch

from src.services.messaging import realtime


class FakeSyncRedis:
    def __init__(self):
        self.published = []
        self.sets: dict[str, set] = {}
        self.keys: set[str] = set()

    def pipeline(self, transaction=False):
        outer = self
        calls = []

        class P:
            def publish(self, ch, payload):
                calls.append(("publish", ch, payload))

            def exists(self, key):
                calls.append(("exists", key))

            def execute(self):
                out = []
                for c in calls:
                    if c[0] == "publish":
                        outer.published.append((c[1], c[2]))
                        out.append(1)
                    else:
                        out.append(1 if c[1] in outer.keys else 0)
                return out

        return P()

    def publish(self, ch, payload):
        self.published.append((ch, payload))

    def smembers(self, key):
        return {str(x) for x in self.sets.get(key, set())}

    def srem(self, key, *members):
        self.sets.setdefault(key, set()).difference_update(int(m) for m in members)

    def exists(self, key):
        return key in self.keys


class FakePubSub:
    def __init__(self, messages):
        self.messages = list(messages)
        self.subscribed = []

    async def subscribe(self, *channels):
        self.subscribed.extend(channels)

    async def get_message(self, ignore_subscribe_messages=True, timeout=1.0):
        return self.messages.pop(0) if self.messages else None

    async def unsubscribe(self):
        pass

    async def aclose(self):
        pass


class FakeAsyncRedis:
    def __init__(self, messages):
        self.counters: dict[str, int] = {}
        self.keys: dict[str, str] = {}
        self.sets: dict[str, set] = {}
        self.published = []
        self._pubsub = FakePubSub(messages)

    def pubsub(self):
        return self._pubsub

    async def incr(self, key):
        self.counters[key] = self.counters.get(key, 0) + 1
        return self.counters[key]

    async def decr(self, key):
        self.counters[key] = self.counters.get(key, 0) - 1
        return self.counters[key]

    async def expire(self, key, ttl):
        return True

    async def set(self, key, value, ex=None):
        self.keys[key] = value

    async def sadd(self, key, member):
        self.sets.setdefault(key, set()).add(member)

    async def srem(self, key, member):
        self.sets.setdefault(key, set()).discard(member)

    async def delete(self, *keys):
        for k in keys:
            self.keys.pop(k, None)
            self.counters.pop(k, None)

    async def publish(self, channel, payload):
        self.published.append((channel, json.loads(payload)))


def test_publish_to_users_dedupes_and_targets_user_channels():
    r = FakeSyncRedis()
    with patch("src.services.messaging.realtime.get_redis_client", return_value=r):
        realtime.publish_to_users(7, [1, 2, 2], {"type": "x"})
        realtime.publish_to_org(7, {"type": "presence"})
    channels = sorted(ch for ch, _ in r.published)
    assert channels == ["msg:org:7", "msg:user:7:1", "msg:user:7:2"]


def test_publish_without_redis_is_a_noop():
    with patch("src.services.messaging.realtime.get_redis_client", return_value=None):
        realtime.publish_to_users(1, [1], {"type": "x"})
        realtime.publish_to_org(1, {"type": "x"})
        assert realtime.online_user_ids(1) == set()
        assert realtime.is_online(1, 1) is False


def test_online_user_ids_drops_expired_members():
    r = FakeSyncRedis()
    r.sets["msg:online:3"] = {10, 11}
    r.keys = {"msg:presence:3:10"}
    with patch("src.services.messaging.realtime.get_redis_client", return_value=r):
        assert realtime.online_user_ids(3) == {10}
        assert realtime.is_online(3, 10) is True
    assert r.sets["msg:online:3"] == {10}


async def _collect(gen):
    return [chunk async for chunk in gen]


async def test_event_stream_presence_and_forwarding():
    own_presence = json.dumps({"type": "presence", "user_id": 5})
    other = json.dumps({"type": "message.new", "conversation_uuid": "c"})
    fake = FakeAsyncRedis([
        {"type": "message", "data": own_presence},
        {"type": "message", "data": other},
    ])
    calls = {"n": 0}

    async def is_disconnected():
        calls["n"] += 1
        return calls["n"] > 3

    async def presence_payload(online):
        return {"type": "presence", "user_id": 5, "online": online}

    offline = MagicMock()

    async def on_offline():
        offline()

    with patch("src.services.messaging.realtime.get_async_redis", return_value=fake), \
         patch("src.services.messaging.realtime.online_user_ids", return_value={5}):
        chunks = await _collect(realtime.event_stream(
            2, 5, {"type": "hello"}, presence_payload, on_offline, is_disconnected
        ))

    hello = json.loads(chunks[0][6:])
    assert hello == {"type": "hello", "online_user_ids": [5]}
    # Your own presence echo is filtered; others' events pass through.
    assert chunks[1] == f"data: {other}\n\n"
    assert len(chunks) == 2
    # Came online, then went offline: both announced on the org channel.
    assert [p[1]["online"] for p in fake.published] == [True, False]
    offline.assert_called_once()
    assert fake._pubsub.subscribed == ["msg:user:2:5", "msg:org:2"]


async def test_event_stream_second_tab_does_not_flap_presence():
    fake = FakeAsyncRedis([])
    fake.counters["msg:conns:2:5"] = 1  # another tab is already open

    async def gone():
        return True

    async def presence_payload(online):
        return {"type": "presence", "user_id": 5, "online": online}

    async def on_offline():
        raise AssertionError("must not go offline while another tab is open")

    with patch("src.services.messaging.realtime.get_async_redis", return_value=fake), \
         patch("src.services.messaging.realtime.online_user_ids", return_value=set()):
        await _collect(realtime.event_stream(2, 5, {"type": "hello"}, presence_payload, on_offline, gone))
    assert fake.published == []
    assert fake.counters["msg:conns:2:5"] == 1


async def test_event_stream_without_redis_reports_error():
    async def never():
        return False

    with patch("src.services.messaging.realtime.get_async_redis", return_value=None):
        chunks = await _collect(realtime.event_stream(1, 1, {}, None, None, never))
    assert json.loads(chunks[0][6:])["type"] == "error"
