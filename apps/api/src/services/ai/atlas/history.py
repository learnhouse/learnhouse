"""Atlas chat-history persistence.

Mirrors the Copilot/RAG schema in `apps/api/src/services/ai/base.py` so the
two agents share infrastructure (sessions list, Redis keys, TTL, ownership
checks) — but Atlas messages can carry tool-call metadata, which Copilot
messages don't. We write our own saver to extend the per-message shape,
and reuse the shared read/list/delete/patch helpers from base.py
unchanged. They tolerate extra fields on a message dict.

Mode tag: every Atlas session is written with ``mode="atlas"`` so the
sessions sidebar can filter cleanly.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Optional
from uuid import uuid4

from src.services.ai.base import CHAT_TTL, _get_redis, save_chat_session_meta

logger = logging.getLogger(__name__)


ATLAS_MODE = "atlas"
# Cap stored history to keep Redis writes small. The agent's working
# context is the *recent* turns; older turns become read-only history
# the user can scroll back through (we keep them on disk via the
# ``messages`` endpoint, but trim the in-Redis array to the most recent
# N turns to bound write size).
ATLAS_HISTORY_KEEP = 40


def new_session_uuid() -> str:
    """Mint a new Atlas session id. Same ``aichat_`` prefix as Copilot so
    the cross-agent sidebar (if we ever build one) can render them
    uniformly."""
    return f"aichat_{uuid4()}"


def save_atlas_turn(
    aichat_uuid: str,
    user_message: str,
    ai_response: str,
    tool_calls: list[dict[str, Any]] | None = None,
    user_id: Optional[int] = None,
    org_id: Optional[int] = None,
) -> None:
    """Append one user→model exchange to a session's Redis-backed history.

    On first save, also creates the session metadata row with
    ``mode="atlas"`` and a title derived from the user's first message.
    Tool calls (if any) are stored as a list on the model message so the
    UI can re-render the action chips when reopening the session.
    """
    r = _get_redis()
    if r is None:
        return

    history_key = f"chat_history:{aichat_uuid}"
    try:
        raw = r.get(history_key)
        if raw:
            history = json.loads(raw.decode("utf-8") if isinstance(raw, bytes) else raw)
        else:
            history = []
    except Exception:  # noqa: BLE001 — never let a corrupt history block the response
        logger.warning("Atlas history at %s was unreadable, resetting", history_key, exc_info=True)
        history = []

    is_first_message = len(history) == 0

    history.append({"role": "user", "content": user_message})
    model_msg: dict[str, Any] = {"role": "model", "content": ai_response}
    if tool_calls:
        # Trim each tool result to keep the Redis blob small. The
        # in-memory agent loop already caps summaries at 4000 chars, but
        # for persistence 600 is plenty — the user just needs to see
        # which tools ran and what they returned, not re-execute them.
        model_msg["tool_calls"] = [
            {
                "name": tc.get("name"),
                "args": tc.get("args") or {},
                "summary": (tc.get("summary") or "")[:600],
                "is_error": bool(tc.get("is_error")),
                "guidance": tc.get("guidance"),
            }
            for tc in tool_calls
        ]
    history.append(model_msg)

    if len(history) > ATLAS_HISTORY_KEEP:
        history = history[-ATLAS_HISTORY_KEEP:]

    try:
        r.setex(history_key, CHAT_TTL, json.dumps(history))
    except Exception:
        logger.exception("Failed to write Atlas history at %s", history_key)
        return

    if is_first_message and user_id is not None:
        title = user_message.strip()[:60]
        if len(user_message) > 60:
            title += "…"
        save_chat_session_meta(
            aichat_uuid=aichat_uuid,
            user_id=user_id,
            title=title or "New Atlas chat",
            course_uuid=None,
            mode=ATLAS_MODE,
            org_id=org_id,
        )
