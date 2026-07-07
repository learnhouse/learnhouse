"""Wire-contract tests for the agent SSE event union.

The frontend (`apps/web/services/ai/atlas.ts`) discriminates on `type`; the
Python union must keep those event names stable. `preview.action` is a
backend-side addition the frontend safely ignores.
"""

import json
import typing

import pytest

from src.services.ai import events as ev

# Frozen contract — mirrors the TS union in apps/web/services/ai/atlas.ts.
FRONTEND_EVENT_TYPES = {
    "session",
    "message.delta",
    "tool.start",
    "tool.end",
    "entity.resolved",
    "entity.ambiguous",
    "entity.not_found",
    "preview.activity",
    "preview.chapter",
    "preview.course",
    "results.list",
    "structure.proposal",
    "confirm.required",
    "applied",
    "pending.dropped",
    "error",
    "done",
}

BACKEND_ONLY_EVENT_TYPES = {"preview.action"}


def _union_event_types() -> set[str]:
    union, _field = typing.get_args(ev.AgentEvent)
    out = set()
    for model in typing.get_args(union):
        out.add(model.model_fields["type"].default)
    return out


def test_union_covers_frontend_contract():
    types = _union_event_types()
    missing = FRONTEND_EVENT_TYPES - types
    assert not missing, f"events union lost frontend event types: {missing}"


def test_union_has_no_unknown_extras():
    types = _union_event_types()
    extras = types - FRONTEND_EVENT_TYPES - BACKEND_ONLY_EVENT_TYPES
    assert not extras, (
        f"new event types {extras} — add them to apps/web/services/ai/atlas.ts "
        "(or BACKEND_ONLY_EVENT_TYPES) deliberately"
    )


def test_serialize_emits_named_sse_frame():
    frame = ev.serialize(ev.MessageDeltaEvent(delta="hi"))
    assert frame.startswith("event: message.delta\n")
    assert frame.endswith("\n\n")
    data_line = [line for line in frame.splitlines() if line.startswith("data: ")][0]
    payload = json.loads(data_line[len("data: "):])
    assert payload == {"type": "message.delta", "delta": "hi"}


def test_serialize_excludes_none_fields():
    frame = ev.serialize(ev.ToolEndEvent(call_id="c1", ok=True))
    data_line = [line for line in frame.splitlines() if line.startswith("data: ")][0]
    payload = json.loads(data_line[len("data: "):])
    assert "duration_ms" not in payload
    assert payload["ok"] is True


def test_confirmation_challenge_kinds_are_constrained():
    with pytest.raises(Exception):
        ev.ConfirmationChallengeDTO(
            pending_id="p1",
            action_label="x",
            blast_radius_summary="y",
            challenge_phrase="z",
            challenge_kind="freeform",  # type: ignore[arg-type]
        )
