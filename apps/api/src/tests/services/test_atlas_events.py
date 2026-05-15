"""Smoke tests for the Atlas SSE event union + serializer.

Covers shape, discriminator behavior, and ``serialize`` envelope format.
The frontend's typed ``switch (event.type)`` is the consumer, so we
verify ``event`` and ``data`` keys come out matching the discriminator.
"""

from __future__ import annotations

import json

from src.services.ai.atlas.events import (
    AppliedEvent,
    Candidate,
    ConfirmRequiredEvent,
    EntityAmbiguousEvent,
    MessageDeltaEvent,
    PendingDroppedEvent,
    PreviewActivityEvent,
    ResourceRef,
    serialize,
)
from src.services.ai.atlas.tiers import ConfirmationChallenge


def test_message_delta_serialize():
    env = serialize(MessageDeltaEvent(delta="hello"))
    assert env["event"] == "message.delta"
    assert json.loads(env["data"]) == {"type": "message.delta", "delta": "hello"}


def test_preview_activity_omits_none():
    ev = PreviewActivityEvent(
        pending_id="pend_x",
        target=ResourceRef(kind="activity", uuid="activity_x", name="Welcome"),
        proposed={"name": "Welcome 2"},
        summary="Rename Welcome to Welcome 2.",
        mode="rename",
    )
    env = serialize(ev)
    payload = json.loads(env["data"])
    assert payload["type"] == "preview.activity"
    assert payload["mode"] == "rename"
    # current / expected_version are None → excluded
    assert "current" not in payload
    assert "expected_version" not in payload


def test_entity_ambiguous_carries_candidates():
    ev = EntityAmbiguousEvent(
        kind="activity",
        selector="intro",
        candidates=[
            Candidate(kind="activity", uuid="a1", name="Introduction", label="Ch 1 · Introduction", score=0.85),
            Candidate(kind="activity", uuid="a2", name="Intro to DNS", label="Ch 3 · Intro to DNS", score=0.84),
        ],
    )
    env = serialize(ev)
    payload = json.loads(env["data"])
    assert payload["type"] == "entity.ambiguous"
    assert len(payload["candidates"]) == 2


def test_confirm_required_serialize():
    ch = ConfirmationChallenge(
        pending_id="pend_y",
        action_label="Delete chapter 'Foo'",
        blast_radius_summary="Removes 3 activities.",
        challenge_phrase="Foo",
        challenge_kind="type_name",
    )
    ev = ConfirmRequiredEvent(pending_id="pend_y", challenge=ch)
    env = serialize(ev)
    payload = json.loads(env["data"])
    assert payload["type"] == "confirm.required"
    assert payload["challenge"]["challenge_phrase"] == "Foo"


def test_applied_serialize():
    ev = AppliedEvent(
        pending_id="pend_z",
        target=ResourceRef(kind="activity", uuid="a1", name="Welcome"),
        version_after=7,
        undo_token="undo_xyz",
    )
    env = serialize(ev)
    payload = json.loads(env["data"])
    assert payload["type"] == "applied"
    assert payload["version_after"] == 7
    assert payload["undo_token"] == "undo_xyz"


def test_pending_dropped_serialize():
    ev = PendingDroppedEvent(pending_id="p1", reason="superseded")
    env = serialize(ev)
    payload = json.loads(env["data"])
    assert payload["reason"] == "superseded"
