"""Behavioral tests for MagicBlock session creation/persistence.

Covers src/services/ai/magicblocks.py lines 63-64 (user_id parameter on
create_magicblock_session) and lines 77-78 (user_id stored on the session
object), plus the Redis round-trip via save/get so user_id survives
serialization.
"""
import json

from src.services.ai import magicblocks as mb
from src.services.ai.schemas.magicblocks import MagicBlockContext


def _context():
    return MagicBlockContext(
        course_title="C",
        course_description="D",
        activity_name="A",
        activity_content_summary="S",
    )


class _FakeRedis:
    """Minimal in-memory Redis good enough for setex/get of JSON sessions."""

    def __init__(self):
        self.store = {}

    def setex(self, key, ttl, value):
        self.store[key] = value
        return True

    def get(self, key):
        return self.store.get(key)


def test_create_stores_user_id_on_session(monkeypatch):
    fake = _FakeRedis()
    monkeypatch.setattr(mb, "get_redis_connection", lambda: fake)

    session = mb.create_magicblock_session(
        block_uuid="b1",
        activity_uuid="a1",
        context=_context(),
        user_id=55,
    )

    assert session.user_id == 55
    assert session.block_uuid == "b1"
    assert session.activity_uuid == "a1"
    assert session.session_uuid.startswith("mb_")


def test_create_defaults_user_id_to_none(monkeypatch):
    monkeypatch.setattr(mb, "get_redis_connection", lambda: _FakeRedis())
    session = mb.create_magicblock_session(
        block_uuid="b1", activity_uuid="a1", context=_context()
    )
    assert session.user_id is None


def test_create_persists_user_id_to_redis(monkeypatch):
    fake = _FakeRedis()
    monkeypatch.setattr(mb, "get_redis_connection", lambda: fake)

    session = mb.create_magicblock_session(
        block_uuid="b1", activity_uuid="a1", context=_context(), user_id=55
    )

    key = mb.MAGICBLOCK_SESSION_KEY.format(session_uuid=session.session_uuid)
    stored = json.loads(fake.store[key])
    assert stored["user_id"] == 55


def test_user_id_round_trips_through_get(monkeypatch):
    fake = _FakeRedis()
    monkeypatch.setattr(mb, "get_redis_connection", lambda: fake)

    created = mb.create_magicblock_session(
        block_uuid="b1", activity_uuid="a1", context=_context(), user_id=55
    )

    loaded = mb.get_magicblock_session(created.session_uuid)
    assert loaded is not None
    assert loaded.user_id == 55
    assert loaded.session_uuid == created.session_uuid


def test_create_returns_session_even_when_no_redis(monkeypatch):
    monkeypatch.setattr(mb, "get_redis_connection", lambda: None)
    session = mb.create_magicblock_session(
        block_uuid="b1", activity_uuid="a1", context=_context(), user_id=77
    )
    assert session.user_id == 77
