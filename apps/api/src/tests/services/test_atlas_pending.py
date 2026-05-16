"""Pending-edit FSM tests using fakeredis.

Skipped automatically when fakeredis isn't installed so this doesn't add a
hard dependency on devs' venvs.
"""

import pytest

try:
    import fakeredis  # type: ignore
    HAS_FAKEREDIS = True
except ImportError:
    HAS_FAKEREDIS = False

from src.services.ai.atlas.pending import (
    PendingStore,
    _challenge_for,
    _normalize,
    build_confirmation_challenge,
)


pytestmark = pytest.mark.skipif(not HAS_FAKEREDIS, reason="fakeredis not installed")


@pytest.fixture
def store():
    r = fakeredis.FakeRedis()
    return PendingStore(r)


def _envelope(**overrides):
    base = {
        "pending_id": "pid_" + str(overrides.get("seq", 1)),
        "tool": "propose_update_course",
        "tier": "EDIT",
        "target": {"kind": "course", "uuid": "course_x", "name": "Algebra 1"},
        "mode": "rename",
        "summary": "Rename to Algebra 1",
        "patch": {"name": "Algebra 1"},
        "proposed": None,
        "current": {"name": "Algebra"},
        "requires_confirmation": False,
    }
    base.update({k: v for k, v in overrides.items() if k != "seq"})
    return base


def test_create_then_get_round_trips(store):
    edit, superseded = store.create(
        envelope=_envelope(), aichat_uuid="c1", org_id=1, user_id=2
    )
    assert superseded == []
    fetched = store.get(edit.pending_id)
    assert fetched is not None
    assert fetched.status == "proposed"
    assert fetched.patch == {"name": "Algebra 1"}


def test_destructive_envelope_becomes_awaiting_confirm(store):
    env = _envelope(
        tool="propose_delete_course",
        tier="DESTRUCTIVE",
        mode="delete",
        requires_confirmation=True,
        blast_radius={"chapters": 3, "activities": 12},
    )
    edit, _ = store.create(envelope=env, aichat_uuid="c1", org_id=1, user_id=2)
    assert edit.status == "awaiting_confirm"
    assert edit.challenge_phrase is not None
    challenge = build_confirmation_challenge(edit)
    assert challenge["challenge_phrase"] == edit.challenge_phrase


def test_cancel_transitions_only_from_open_states(store):
    edit, _ = store.create(envelope=_envelope(), aichat_uuid="c1", org_id=1, user_id=2)
    cancelled = store.cancel(edit.pending_id)
    assert cancelled is not None and cancelled.status == "cancelled"
    # Idempotent — second cancel is a no-op.
    assert store.cancel(edit.pending_id) is None


def test_apply_lifecycle(store):
    edit, _ = store.create(envelope=_envelope(), aichat_uuid="c1", org_id=1, user_id=2)
    started = store.begin_apply(edit.pending_id)
    assert started is not None and started.status == "applying"
    finished = store.finish_apply(edit.pending_id, version_after=2)
    assert finished is not None
    assert finished.status == "applied"
    assert finished.undo_token is not None
    assert finished.version_after == 2


def test_challenge_phrase_short_name_uses_phrase_kind():
    kind, phrase = _challenge_for({"name": "X"})
    assert kind == "type_phrase"
    assert phrase == "delete x"


def test_challenge_phrase_normal_name_uses_name_kind():
    kind, phrase = _challenge_for({"name": "Algebra 1"})
    assert kind == "type_name"
    assert phrase == "algebra 1"


def test_verify_challenge_timing_safe(store):
    env = _envelope(
        tool="propose_delete_course",
        tier="DESTRUCTIVE",
        requires_confirmation=True,
    )
    edit, _ = store.create(envelope=env, aichat_uuid="c1", org_id=1, user_id=2)
    assert store.verify_challenge(edit, edit.challenge_phrase)
    assert not store.verify_challenge(edit, "wrong phrase")
    assert not store.verify_challenge(edit, None)


def test_normalize_collapses_whitespace_and_case():
    assert _normalize("  HELLO   World ") == "hello world"
