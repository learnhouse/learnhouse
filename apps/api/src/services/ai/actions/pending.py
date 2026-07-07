"""Redis-backed pending-action store.

A pending action is any CREATE/EDIT/DESTRUCTIVE tool call held for user
confirmation (the agent's confirm mode). It snapshots the tool name and
validated args so applying later replays the exact same call through the
registry's enforcement pipeline.

State machine
  proposed
    ├─ apply  (when !requires_confirmation)       → applying → applied | failed
    ├─ confirm  (when requires_confirmation)      → applying → applied | failed
    ├─ cancel                                     → cancelled
    ├─ supersede (cap reached, oldest evicted)    → superseded
    └─ expire (TTL)                               → expired

Storage
  agent:pending:{pending_id}            — JSON blob
  agent:pending:by_scope:{scope_key}    — ZSET, score=created_at
  (scope_key = the chat uuid for the in-app agent, "token:{uuid}" for MCP)

Concurrency
  All transitions use a WATCH/MULTI/EXEC optimistic check so two concurrent
  applies on the same pending only let one through.
"""

from __future__ import annotations

import json
import secrets
import time
import unicodedata
from dataclasses import dataclass
from typing import Any, Literal

import redis

from config.config import get_learnhouse_config
from src.services.ai.actions.config import (
    MAX_PENDINGS_PER_SCOPE,
    PENDING_POST_APPLY_TTL_SECONDS,
    PENDING_TTL_SECONDS,
)
from src.services.ai.tools.base import PendingProposal

PendingStatus = Literal[
    "proposed",
    "awaiting_confirm",
    "applying",
    "applied",
    "cancelled",
    "superseded",
    "expired",
    "failed",
]

OPEN_STATUSES: set[str] = {"proposed", "awaiting_confirm"}


def _key(pending_id: str) -> str:
    return f"agent:pending:{pending_id}"


def _index_key(scope_key: str) -> str:
    return f"agent:pending:by_scope:{scope_key}"


def get_redis_connection() -> redis.Redis | None:
    """House-convention Redis client (see src/services/ai/base.py)."""
    conn = get_learnhouse_config().redis_config.redis_connection_string
    if not conn:
        return None
    return redis.from_url(conn, socket_connect_timeout=5, socket_timeout=5)


@dataclass
class PendingAction:
    pending_id: str
    scope_key: str
    org_id: int
    user_id: int
    tool: str
    tier: str
    target: dict[str, Any]
    summary: str
    args: dict[str, Any]
    preview: dict[str, Any] | None
    requires_confirmation: bool
    challenge_kind: str | None
    challenge_phrase: str | None
    expected_version: int | None
    blast_radius: dict[str, Any] | None
    status: PendingStatus
    created_at: int
    version_after: int | None = None
    undo_token: str | None = None
    error: str | None = None

    def to_json(self) -> str:
        return json.dumps(self.__dict__, default=str)

    @classmethod
    def from_json(cls, raw: bytes | str) -> "PendingAction":
        data = json.loads(raw)
        return cls(**data)


class PendingStore:
    def __init__(self, redis_client: redis.Redis):
        self._r = redis_client

    # ── reads ────────────────────────────────────────────────────────────

    def get(self, pending_id: str) -> PendingAction | None:
        raw = self._r.get(_key(pending_id))
        if not raw:
            return None
        return PendingAction.from_json(raw)

    def list_for_scope(self, scope_key: str) -> list[PendingAction]:
        ids = self._r.zrange(_index_key(scope_key), 0, -1)
        out: list[PendingAction] = []
        for raw_id in ids:
            pid = raw_id.decode() if isinstance(raw_id, bytes) else raw_id
            action = self.get(pid)
            if action and action.status in ("proposed", "awaiting_confirm", "applied"):
                out.append(action)
        return out

    # ── writes ───────────────────────────────────────────────────────────

    def create(
        self,
        proposal: PendingProposal,
        *,
        preview: dict[str, Any] | None = None,
        blast_radius: dict[str, Any] | None = None,
        expected_version: int | None = None,
    ) -> tuple[PendingAction, list[str]]:
        """Persist a new pending action from a registry proposal.

        Returns (created_action, superseded_pending_ids). The caller emits
        `pending.dropped` events for the superseded ones.
        """
        created_at = int(time.time())
        requires_confirm = proposal.requires_confirmation
        challenge_kind, challenge_phrase = (
            _challenge_for(proposal.target, proposal.tool)
            if requires_confirm
            else (None, None)
        )

        action = PendingAction(
            pending_id=f"pnd_{secrets.token_urlsafe(9)}",
            scope_key=proposal.scope_key,
            org_id=proposal.org_id,
            user_id=proposal.user_id,
            tool=proposal.tool,
            tier=proposal.tier.value,
            target=proposal.target,
            summary=proposal.summary,
            args=proposal.args,
            preview=preview,
            requires_confirmation=requires_confirm,
            challenge_kind=challenge_kind,
            challenge_phrase=challenge_phrase,
            expected_version=expected_version,
            blast_radius=blast_radius,
            status="awaiting_confirm" if requires_confirm else "proposed",
            created_at=created_at,
        )

        pipe = self._r.pipeline()
        pipe.set(_key(action.pending_id), action.to_json(), ex=PENDING_TTL_SECONDS)
        # Float score: same-second creations must still evict in insertion
        # order (an int score ties and falls back to lexicographic order).
        pipe.zadd(_index_key(action.scope_key), {action.pending_id: time.time()})
        pipe.expire(_index_key(action.scope_key), PENDING_TTL_SECONDS * 2)
        pipe.execute()

        # Cap enforcement: evict oldest beyond the cap.
        superseded: list[str] = []
        ids = self._r.zrange(_index_key(action.scope_key), 0, -1)
        live = [
            (raw_id.decode() if isinstance(raw_id, bytes) else raw_id)
            for raw_id in ids
        ]
        live = [pid for pid in live if self._is_live(pid)]
        if len(live) > MAX_PENDINGS_PER_SCOPE:
            for old_pid in live[: len(live) - MAX_PENDINGS_PER_SCOPE]:
                if old_pid == action.pending_id:
                    continue
                if self._transition(
                    old_pid,
                    allowed_from=OPEN_STATUSES,
                    new_status="superseded",
                ):
                    superseded.append(old_pid)

        return action, superseded

    def cancel(self, pending_id: str) -> PendingAction | None:
        if self._transition(
            pending_id,
            allowed_from=OPEN_STATUSES,
            new_status="cancelled",
        ):
            return self.get(pending_id)
        return None

    def begin_apply(self, pending_id: str) -> PendingAction | None:
        """Atomic transition to `applying`. Returns the action on success,
        None if the pending is in an incompatible state (already applied,
        cancelled, etc.)."""
        if self._transition(
            pending_id,
            allowed_from=OPEN_STATUSES,
            new_status="applying",
        ):
            return self.get(pending_id)
        return None

    def finish_apply(
        self,
        pending_id: str,
        *,
        version_after: int | None = None,
        with_undo: bool = False,
    ) -> PendingAction | None:
        action = self.get(pending_id)
        if not action or action.status != "applying":
            return None
        action.status = "applied"
        action.version_after = version_after
        action.undo_token = secrets.token_urlsafe(16) if with_undo else None
        self._r.set(
            _key(pending_id), action.to_json(), ex=PENDING_POST_APPLY_TTL_SECONDS
        )
        return action

    def fail_apply(self, pending_id: str, error: str) -> PendingAction | None:
        action = self.get(pending_id)
        if not action:
            return None
        action.status = "failed"
        action.error = error
        self._r.set(_key(pending_id), action.to_json(), ex=PENDING_TTL_SECONDS)
        return action

    # ── helpers ──────────────────────────────────────────────────────────

    def verify_challenge(self, action: PendingAction, provided: str | None) -> bool:
        if not action.requires_confirmation:
            return True
        if not action.challenge_phrase or provided is None:
            return False
        return _normalize(provided) == _normalize(action.challenge_phrase)

    def _is_live(self, pending_id: str) -> bool:
        action = self.get(pending_id)
        return bool(action and action.status in OPEN_STATUSES)

    def _transition(
        self,
        pending_id: str,
        *,
        allowed_from: set[str],
        new_status: PendingStatus,
    ) -> bool:
        """Optimistic-locking transition. Returns True if the swap succeeded."""
        key = _key(pending_id)
        # WATCH so concurrent transitions on the same key fail one of them.
        with self._r.pipeline() as pipe:
            for _attempt in range(3):
                try:
                    pipe.watch(key)
                    raw = pipe.get(key)
                    if not raw:
                        pipe.unwatch()
                        return False
                    action = PendingAction.from_json(raw)
                    if action.status not in allowed_from:
                        pipe.unwatch()
                        return False
                    action.status = new_status
                    pipe.multi()
                    pipe.set(key, action.to_json(), ex=PENDING_TTL_SECONDS)
                    pipe.execute()
                    return True
                except redis.WatchError:
                    continue
        return False


# ─── Confirmation phrase derivation ───────────────────────────────────────


_COMMON_WORDS = {
    "test",
    "demo",
    "course",
    "chapter",
    "activity",
    "community",
    "board",
    "playground",
    "folder",
    "untitled",
}

# Verb shown in type_phrase challenges, keyed by tool-name prefix.
_ACTION_VERBS = ("delete", "remove", "wipe", "revoke")


def _normalize(s: str) -> str:
    s = unicodedata.normalize("NFKC", s).lower().strip()
    # Collapse runs of whitespace.
    return " ".join(s.split())


def _verb_for_tool(tool: str) -> str:
    for verb in _ACTION_VERBS:
        if tool.startswith(verb) or f"_{verb}" in tool:
            return verb
    return "delete"


def _challenge_for(target: dict[str, Any], tool: str = "") -> tuple[str, str]:
    """Pick (challenge_kind, challenge_phrase) for a destructive target.

    `type_name` when the target's name is unambiguous; `type_phrase`
    (`<verb> <name>`) when the name is too short or generic.
    """
    name = (target.get("name") or "").strip()
    norm = _normalize(name)
    if len(norm) < 3 or norm in _COMMON_WORDS:
        verb = _verb_for_tool(tool)
        return "type_phrase", _normalize(f"{verb} {name or 'this'}")
    return "type_name", norm


def build_confirmation_challenge(action: PendingAction) -> dict[str, Any]:
    """Build the `ConfirmationChallengeDTO` payload for an awaiting_confirm
    pending action."""
    name = action.target.get("name", "") or "this item"
    kind = action.target.get("kind", "item")
    verb = _verb_for_tool(action.tool).capitalize()
    blast = action.blast_radius or {}
    counted = {k: v for k, v in blast.items() if isinstance(v, int) and v > 0}
    if counted:
        summary = "affects " + " and ".join(
            f"{v} {k.rstrip('s')}(s)" for k, v in counted.items()
        )
    else:
        summary = "this action cannot be undone"
    return {
        "pending_id": action.pending_id,
        "action_label": f'{verb} {kind} "{name}"',
        "blast_radius_summary": summary,
        "challenge_phrase": action.challenge_phrase or "",
        "challenge_kind": action.challenge_kind or "type_phrase",
    }
