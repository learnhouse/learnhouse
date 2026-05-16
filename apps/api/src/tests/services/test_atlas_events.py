"""Round-trip and contract tests for Atlas SSE event models.

These guard against accidental field renames that would break the
frontend's discriminated union (see apps/web/services/ai/atlas.ts).
"""

import json

from src.services.ai.atlas import events as ev


def test_session_event_serializes_with_type():
    e = ev.SessionEvent(aichat_uuid="aichat_xxx")
    out = ev.serialize(e)
    assert out["event"] == "session"
    payload = json.loads(out["data"])
    assert payload["type"] == "session"
    assert payload["aichat_uuid"] == "aichat_xxx"


def test_preview_activity_uses_proposed_not_patch():
    target = ev.ResourceRefDTO(kind="activity", uuid="activity_xxx", name="Intro")
    e = ev.PreviewActivityEvent(
        pending_id="pid", target=target, proposed={"name": "Intro"}, summary="x", mode="create"
    )
    payload = json.loads(ev.serialize(e)["data"])
    assert "proposed" in payload
    assert "patch" not in payload


def test_preview_course_uses_patch_not_proposed():
    target = ev.ResourceRefDTO(kind="course", uuid="course_x", name="Algebra")
    e = ev.PreviewCourseEvent(
        pending_id="pid", target=target, patch={"name": "Algebra 1"}, summary="x", mode="rename"
    )
    payload = json.loads(ev.serialize(e)["data"])
    assert "patch" in payload
    assert "proposed" not in payload


def test_confirmation_challenge_required_fields():
    challenge = ev.ConfirmationChallengeDTO(
        pending_id="pid",
        action_label="Delete course",
        blast_radius_summary="3 chapters, 12 activities",
        challenge_phrase="algebra 1",
        challenge_kind="type_name",
    )
    e = ev.ConfirmRequiredEvent(pending_id="pid", challenge=challenge)
    payload = json.loads(ev.serialize(e)["data"])
    assert payload["type"] == "confirm.required"
    assert payload["challenge"]["challenge_kind"] in ("type_name", "type_phrase")


def test_pending_dropped_reasons():
    for reason in ("superseded", "cancelled", "expired", "subject_change"):
        e = ev.PendingDroppedEvent(pending_id="p", reason=reason)
        payload = json.loads(ev.serialize(e)["data"])
        assert payload["reason"] == reason


def test_done_event_minimal():
    payload = json.loads(ev.serialize(ev.DoneEvent())["data"])
    assert payload == {"type": "done"}
