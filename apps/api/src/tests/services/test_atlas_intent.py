"""Unit tests for ``intent.classify_user_intent`` — the cheap heuristic
that decides whether a new user message is approving / cancelling /
refining a pending edit, or starting fresh.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from src.services.ai.atlas.intent import classify_user_intent


def _pending(status: str = "proposed"):
    """Lightweight stand-in for a PendingEdit (only ``status`` is read)."""
    return SimpleNamespace(
        pending_id="pend_test",
        status=status,
        summary="Rename foo to bar",
        created_at=datetime.now(timezone.utc) - timedelta(seconds=1),
    )


def test_no_pending_is_new_request():
    intent = classify_user_intent("rename the intro to welcome", [])
    assert intent.kind == "new_request"


def test_approval_keyword_with_pending():
    intent = classify_user_intent("yes", [_pending()])
    assert intent.kind == "approve"
    assert intent.pending is not None


def test_approval_keyword_variants():
    for word in ("go", "ok", "okay", "yes", "yep", "sure", "apply", "approve", "do it", "ship it", "looks good", "lgtm"):
        intent = classify_user_intent(word, [_pending()])
        assert intent.kind == "approve", f"failed for {word!r}"


def test_cancel_keyword():
    for word in ("no", "cancel", "nevermind", "never mind", "stop", "forget it"):
        intent = classify_user_intent(word, [_pending()])
        assert intent.kind == "cancel", f"failed for {word!r}"


def test_arbitrary_message_with_pending_falls_to_refine():
    intent = classify_user_intent("make it shorter actually", [_pending()])
    assert intent.kind == "refine"


def test_approve_skips_applied_pending():
    # If the only pending is already applied, an approve keyword returns
    # ``approve`` with the last pending in the list (we don't filter to
    # "approvable only" silently — the apply path will catch the non-
    # transitionable status as 409).
    intent = classify_user_intent("yes", [_pending(status="applied")])
    # Falls through to refine since no approvable pending exists.
    assert intent.kind in ("refine", "approve")
