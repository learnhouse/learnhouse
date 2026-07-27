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


async def test_generate_stream_reraises_on_provider_error(monkeypatch):
    """A provider failure must propagate as an exception, not be yielded as an
    "Error: ..." content chunk. Yielding it leaked exception detail to the
    client and defeated the router's credit-refund logic.

    After the provider-agnostic refactor the failure originates in the shared
    ``llm.generate_stream`` rather than a Gemini client, so we inject it there.
    """
    import pytest

    async def _boom_stream(**kwargs):
        raise RuntimeError("upstream provider 500")
        yield  # pragma: no cover - makes this an async generator

    monkeypatch.setattr(mb, "generate_stream", _boom_stream)

    session = mb.create_magicblock_session(
        block_uuid="b1", activity_uuid="a1", context=_context(), user_id=1
    )

    with pytest.raises(RuntimeError):
        async for _ in mb.generate_magicblock_stream(
            prompt="hi", session=session, model_name="gemini-x"
        ):
            pass


async def test_style_reference_primes_history_with_exemplar(monkeypatch):
    """A style_reference must be injected as a user/model exemplar pair at the
    FRONT of the history so the new block inherits its design language."""
    captured = {}

    async def _fake_stream(**kwargs):
        captured.update(kwargs)
        yield "<!DOCTYPE html><html></html>"

    monkeypatch.setattr(mb, "get_redis_connection", lambda: _FakeRedis())
    monkeypatch.setattr(mb, "generate_stream", _fake_stream)

    session = mb.create_magicblock_session(
        block_uuid="b1", activity_uuid="a1", context=_context()
    )

    async for _ in mb.generate_magicblock_stream(
        prompt="make a quiz",
        session=session,
        style_reference="<html>REFERENCE_MARKER</html>",
    ):
        pass

    history = captured["history"]
    assert history[0]["role"] == "user"
    assert "STYLE REFERENCE" in history[0]["content"]
    assert "REFERENCE_MARKER" in history[0]["content"]
    assert history[1]["role"] == "model"


async def test_no_style_reference_leaves_history_empty_on_first_turn(monkeypatch):
    captured = {}

    async def _fake_stream(**kwargs):
        captured.update(kwargs)
        yield "<!DOCTYPE html><html></html>"

    monkeypatch.setattr(mb, "get_redis_connection", lambda: _FakeRedis())
    monkeypatch.setattr(mb, "generate_stream", _fake_stream)

    session = mb.create_magicblock_session(
        block_uuid="b1", activity_uuid="a1", context=_context()
    )

    async for _ in mb.generate_magicblock_stream(prompt="build", session=session):
        pass

    assert captured["history"] == []
    assert captured["user_prompt"] == "build"


async def test_iteration_uses_surgical_edit_prompt(monkeypatch):
    """When iterating on existing HTML, the user prompt must carry the strict
    surgical-edit rules and embed the current HTML."""
    captured = {}

    async def _fake_stream(**kwargs):
        captured.update(kwargs)
        yield "<!DOCTYPE html><html></html>"

    monkeypatch.setattr(mb, "get_redis_connection", lambda: _FakeRedis())
    monkeypatch.setattr(mb, "generate_stream", _fake_stream)

    session = mb.create_magicblock_session(
        block_uuid="b1", activity_uuid="a1", context=_context()
    )
    session.iteration_count = 1

    async for _ in mb.generate_magicblock_stream(
        prompt="change the color",
        session=session,
        current_html="<html>ORIGINAL_BODY</html>",
    ):
        pass

    user_prompt = captured["user_prompt"]
    assert "SURGICAL CHANGE" in user_prompt
    assert "STRICT EDIT RULES" in user_prompt
    assert "ORIGINAL_BODY" in user_prompt


async def test_generation_appends_revision_snapshot(monkeypatch):
    async def _fake_stream(**kwargs):
        yield "<!DOCTYPE html><html><body>hi</body></html>"

    monkeypatch.setattr(mb, "get_redis_connection", lambda: _FakeRedis())
    monkeypatch.setattr(mb, "generate_stream", _fake_stream)

    session = mb.create_magicblock_session(
        block_uuid="b1", activity_uuid="a1", context=_context()
    )
    assert session.revisions == []

    async for _ in mb.generate_magicblock_stream(prompt="build a widget", session=session):
        pass

    assert len(session.revisions) == 1
    rev = session.revisions[0]
    assert rev.prompt == "build a widget"
    assert rev.revision_uuid.startswith("rev_")
    assert "hi" in rev.html
    assert session.iteration_count == 1


async def test_revisions_are_capped_at_max(monkeypatch):
    from src.services.ai.schemas.magicblocks import MagicBlockRevision

    async def _fake_stream(**kwargs):
        yield "<!DOCTYPE html><html></html>"

    monkeypatch.setattr(mb, "get_redis_connection", lambda: _FakeRedis())
    monkeypatch.setattr(mb, "generate_stream", _fake_stream)

    session = mb.create_magicblock_session(
        block_uuid="b1", activity_uuid="a1", context=_context()
    )
    session.revisions = [
        MagicBlockRevision(
            revision_uuid=f"rev_{i}", prompt="p", html="<html></html>", created_at=0.0
        )
        for i in range(mb.MAX_REVISIONS)
    ]

    async for _ in mb.generate_magicblock_stream(prompt="one more", session=session):
        pass

    assert len(session.revisions) == mb.MAX_REVISIONS
    assert session.revisions[-1].prompt == "one more"
