"""Behavioral tests for chat_session_belongs_to_user (IDOR ownership guard).

Covers src/services/ai/base.py lines 237-260. The function reads the
``chat_meta:<uuid>`` Redis key and decides whether the chat session is owned
by the requesting user. Documented behavior (read from the source):

- No Redis configured -> returns True (fail-open; nothing to protect yet).
- Meta missing/None -> returns True (brand-new/expired session is ownable).
- Meta user_id matches -> True.
- Meta user_id differs -> False.
- Redis raises -> returns False (fail-closed on unexpected errors).
"""
import json

from src.services.ai import base


def _fake_redis_returning(meta_value):
    class _Redis:
        def get(self, key):
            assert key == "chat_meta:abc-uuid"
            return meta_value

    return _Redis()


def test_returns_true_when_no_redis(monkeypatch):
    monkeypatch.setattr(base, "_get_redis", lambda: None)
    assert base.chat_session_belongs_to_user("abc-uuid", 7) is True


def test_returns_true_when_meta_missing(monkeypatch):
    monkeypatch.setattr(base, "_get_redis", lambda: _fake_redis_returning(None))
    assert base.chat_session_belongs_to_user("abc-uuid", 7) is True


def test_returns_true_when_user_id_matches(monkeypatch):
    meta = json.dumps({"aichat_uuid": "abc-uuid", "user_id": 7, "title": "x"})
    monkeypatch.setattr(base, "_get_redis", lambda: _fake_redis_returning(meta))
    assert base.chat_session_belongs_to_user("abc-uuid", 7) is True


def test_returns_true_when_user_id_matches_bytes(monkeypatch):
    """Redis often returns bytes; the code decodes them."""
    meta = json.dumps({"aichat_uuid": "abc-uuid", "user_id": 7}).encode("utf-8")
    monkeypatch.setattr(base, "_get_redis", lambda: _fake_redis_returning(meta))
    assert base.chat_session_belongs_to_user("abc-uuid", 7) is True


def test_returns_false_when_user_id_differs(monkeypatch):
    meta = json.dumps({"aichat_uuid": "abc-uuid", "user_id": 999})
    monkeypatch.setattr(base, "_get_redis", lambda: _fake_redis_returning(meta))
    assert base.chat_session_belongs_to_user("abc-uuid", 7) is False


def test_returns_false_when_redis_raises(monkeypatch):
    class _Boom:
        def get(self, key):
            raise RuntimeError("redis down")

    monkeypatch.setattr(base, "_get_redis", lambda: _Boom())
    assert base.chat_session_belongs_to_user("abc-uuid", 7) is False
