"""Classify how a fresh user message relates to pending edits.

When the pipeline starts a new turn it asks: is the user approving a
pending edit, cancelling it, refining it, or switching subject? The
answer drives whether we apply the pending, drop it, re-run the
propose, or run a fresh agent turn.

Fast-path: regex over approval/cancel keywords. Slow-path: a tiny
classifier prompt (temperature 0, capped tokens) to decide
``refine vs new_subject`` when the message is something else.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Literal, Optional

logger = logging.getLogger(__name__)


# Keywords intentionally tight: a user typing "okay let's add a quiz"
# shouldn't trip the approve path. Single tokens with optional fillers.
_APPROVE_RE = re.compile(
    r"^\s*(?:please\s+)?(?:go|ok|okay|yes|yep|yeah|sure|apply|approve|"
    r"do it|ship it|looks good|lgtm|sounds good)\.?!?\s*$",
    re.IGNORECASE,
)
_CANCEL_RE = re.compile(
    r"^\s*(?:no|nope|cancel|nevermind|never mind|stop|skip|drop it|"
    r"actually no|forget it)\.?!?\s*$",
    re.IGNORECASE,
)


IntentKind = Literal["approve", "cancel", "refine", "subject_change", "new_request"]


@dataclass
class Intent:
    """The classifier's verdict. ``pending`` is set for approve/cancel/refine."""

    kind: IntentKind
    pending: object | None = None  # PendingEdit, kept generic to avoid circular import


def classify_user_intent(message: str, pendings: list) -> Intent:
    """Decide how this user message should be routed.

    Cheap and deterministic for the common cases:
      - No pending edits → ``new_request``.
      - Approve keyword + at least one approvable pending → ``approve``.
      - Cancel keyword + at least one pending → ``cancel``.
      - Otherwise → defer (``refine`` if a recent pending exists,
        ``new_request`` if not). The pipeline can upgrade this to a real
        LLM classifier call when ambiguity warrants it; we keep the
        cheap heuristic here as the default.

    The reason we don't run the LLM classifier inline here is latency:
    most turns are either "approve/cancel/something new", and we'd
    rather pay one LLM call (the main agent) than two.
    """
    if not pendings:
        return Intent(kind="new_request")

    msg = (message or "").strip()
    if _APPROVE_RE.match(msg):
        target = _pick_approvable(pendings)
        if target is not None:
            return Intent(kind="approve", pending=target)
    if _CANCEL_RE.match(msg):
        return Intent(kind="cancel", pending=pendings[-1])

    # Default for messages that follow a pending: treat as refine. Subject
    # change detection requires an LLM check and is handled inside the
    # pipeline's main turn — the pipeline can supersede pendings later
    # if the agent's first tool call targets a different entity.
    return Intent(kind="refine", pending=pendings[-1])


def _pick_approvable(pendings: list):
    """Among current pendings, prefer the most recent in a state that
    can transition to ``applying``. Ignore already-applying/applied."""
    for p in reversed(pendings):
        if getattr(p, "status", None) in ("proposed", "awaiting_confirm"):
            return p
    return pendings[-1] if pendings else None
