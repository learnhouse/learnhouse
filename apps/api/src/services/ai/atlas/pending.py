"""Redis-backed pending edit store.

State machine
  proposed
    ├─ apply  (when !requires_confirmation)       → applying → applied | failed
    ├─ confirm  (when requires_confirmation)      → applying → applied | failed
    ├─ cancel                                     → cancelled
    ├─ supersede (cap reached, oldest evicted)    → superseded
    └─ expire (TTL)                               → expired

Storage
  atlas:pending:{pending_id}                — JSON blob
  atlas:pending:by_chat:{aichat_uuid}       — ZSET, score=created_at

Concurrency
  All transitions use a WATCH/MULTI/EXEC optimistic check so two concurrent
  /apply requests on the same pending only let one through.
"""

from __future__ import annotations

import json
import secrets
import time
import unicodedata
from dataclasses import dataclass
from typing import Any, Literal

import redis

from .config import (
    MAX_PENDINGS_PER_SESSION,
    PENDING_POST_APPLY_TTL_SECONDS,
    PENDING_TTL_SECONDS,
)

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


def _key(pending_id: str) -> str:
    return f"atlas:pending:{pending_id}"


def _index_key(aichat_uuid: str) -> str:
    return f"atlas:pending:by_chat:{aichat_uuid}"


@dataclass
class PendingEdit:
    pending_id: str
    aichat_uuid: str
    org_id: int
    user_id: int
    tool: str
    tier: str
    target: dict[str, Any]
    mode: str
    summary: str
    patch: dict[str, Any] | None
    proposed: dict[str, Any] | None
    current: dict[str, Any] | None
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
    def from_json(cls, raw: bytes | str) -> "PendingEdit":
        data = json.loads(raw)
        return cls(**data)


class PendingStore:
    def __init__(self, redis_client: redis.Redis):
        self._r = redis_client

    # ── reads ────────────────────────────────────────────────────────────

    def get(self, pending_id: str) -> PendingEdit | None:
        raw = self._r.get(_key(pending_id))
        if not raw:
            return None
        return PendingEdit.from_json(raw)

    def list_for_chat(self, aichat_uuid: str) -> list[PendingEdit]:
        ids = self._r.zrange(_index_key(aichat_uuid), 0, -1)
        out: list[PendingEdit] = []
        for raw_id in ids:
            pid = raw_id.decode() if isinstance(raw_id, bytes) else raw_id
            edit = self.get(pid)
            if edit and edit.status in ("proposed", "awaiting_confirm", "applied"):
                out.append(edit)
        return out

    # ── writes ───────────────────────────────────────────────────────────

    def create(
        self,
        *,
        envelope: dict[str, Any],
        aichat_uuid: str,
        org_id: int,
        user_id: int,
    ) -> tuple[PendingEdit, list[str]]:
        """Persist a new pending edit.

        Returns (created_edit, superseded_pending_ids). The caller emits
        `pending.dropped` events for the superseded ones.
        """
        created_at = int(time.time())
        requires_confirm = bool(envelope.get("requires_confirmation"))
        challenge_kind, challenge_phrase = (
            _challenge_for(envelope.get("target") or {})
            if requires_confirm
            else (None, None)
        )

        edit = PendingEdit(
            pending_id=envelope["pending_id"],
            aichat_uuid=aichat_uuid,
            org_id=org_id,
            user_id=user_id,
            tool=envelope["tool"],
            tier=envelope["tier"],
            target=envelope.get("target") or {},
            mode=envelope.get("mode", "edit"),
            summary=envelope.get("summary", ""),
            patch=envelope.get("patch"),
            proposed=envelope.get("proposed"),
            current=envelope.get("current"),
            requires_confirmation=requires_confirm,
            challenge_kind=challenge_kind,
            challenge_phrase=challenge_phrase,
            expected_version=envelope.get("expected_version"),
            blast_radius=envelope.get("blast_radius"),
            status="awaiting_confirm" if requires_confirm else "proposed",
            created_at=created_at,
        )

        pipe = self._r.pipeline()
        pipe.set(_key(edit.pending_id), edit.to_json(), ex=PENDING_TTL_SECONDS)
        pipe.zadd(_index_key(aichat_uuid), {edit.pending_id: created_at})
        pipe.expire(_index_key(aichat_uuid), PENDING_TTL_SECONDS * 2)
        pipe.execute()

        # Cap enforcement: evict oldest beyond the cap.
        superseded: list[str] = []
        ids = self._r.zrange(_index_key(aichat_uuid), 0, -1)
        live = [
            (raw_id.decode() if isinstance(raw_id, bytes) else raw_id)
            for raw_id in ids
        ]
        live = [pid for pid in live if self._is_live(pid)]
        if len(live) > MAX_PENDINGS_PER_SESSION:
            for old_pid in live[: len(live) - MAX_PENDINGS_PER_SESSION]:
                if old_pid == edit.pending_id:
                    continue
                if self._transition(old_pid, allowed_from={"proposed", "awaiting_confirm"}, new_status="superseded"):
                    superseded.append(old_pid)

        return edit, superseded

    def cancel(self, pending_id: str) -> PendingEdit | None:
        if self._transition(
            pending_id,
            allowed_from={"proposed", "awaiting_confirm"},
            new_status="cancelled",
        ):
            return self.get(pending_id)
        return None

    def begin_apply(self, pending_id: str) -> PendingEdit | None:
        """Atomic transition to `applying`. Returns the edit on success,
        None if the pending is in an incompatible state (already applied,
        cancelled, etc.)."""
        if self._transition(
            pending_id,
            allowed_from={"proposed", "awaiting_confirm"},
            new_status="applying",
        ):
            return self.get(pending_id)
        return None

    def finish_apply(
        self,
        pending_id: str,
        *,
        version_after: int | None = None,
    ) -> PendingEdit | None:
        edit = self.get(pending_id)
        if not edit or edit.status != "applying":
            return None
        edit.status = "applied"
        edit.version_after = version_after
        edit.undo_token = secrets.token_urlsafe(16)
        self._r.set(
            _key(pending_id), edit.to_json(), ex=PENDING_POST_APPLY_TTL_SECONDS
        )
        return edit

    def fail_apply(self, pending_id: str, error: str) -> PendingEdit | None:
        edit = self.get(pending_id)
        if not edit:
            return None
        edit.status = "failed"
        edit.error = error
        self._r.set(_key(pending_id), edit.to_json(), ex=PENDING_TTL_SECONDS)
        return edit

    # ── helpers ──────────────────────────────────────────────────────────

    def verify_challenge(self, edit: PendingEdit, provided: str | None) -> bool:
        if not edit.requires_confirmation:
            return True
        if not edit.challenge_phrase or provided is None:
            return False
        return _normalize(provided) == _normalize(edit.challenge_phrase)

    def _is_live(self, pending_id: str) -> bool:
        edit = self.get(pending_id)
        return bool(edit and edit.status in ("proposed", "awaiting_confirm"))

    def _transition(
        self,
        pending_id: str,
        *,
        allowed_from: set[str],
        new_status: PendingStatus,
    ) -> bool:
        """Optimistic-locking transition. Returns True if the swap succeeded."""
        key = _key(pending_id)
        # We use WATCH so concurrent transitions on the same key fail one of them.
        with self._r.pipeline() as pipe:
            for _attempt in range(3):
                try:
                    pipe.watch(key)
                    raw = pipe.get(key)
                    if not raw:
                        pipe.unwatch()
                        return False
                    edit = PendingEdit.from_json(raw)
                    if edit.status not in allowed_from:
                        pipe.unwatch()
                        return False
                    edit.status = new_status
                    pipe.multi()
                    pipe.set(key, edit.to_json(), ex=PENDING_TTL_SECONDS)
                    pipe.execute()
                    return True
                except redis.WatchError:
                    continue
        return False


# ─── Confirmation phrase derivation ───────────────────────────────────────


_COMMON_WORDS = {"test", "demo", "course", "chapter", "activity", "untitled"}


def _normalize(s: str) -> str:
    s = unicodedata.normalize("NFKC", s).lower().strip()
    # Collapse runs of whitespace.
    return " ".join(s.split())


def _challenge_for(target: dict[str, Any]) -> tuple[str, str]:
    """Pick (challenge_kind, challenge_phrase) for a destructive target.

    `type_name` when the target's name is unambiguous; `type_phrase`
    (`delete <name>`) when the name is too short or generic.
    """
    name = (target.get("name") or "").strip()
    norm = _normalize(name)
    if len(norm) < 3 or norm in _COMMON_WORDS:
        return "type_phrase", _normalize(f"delete {name or 'this'}")
    return "type_name", norm


def build_confirmation_challenge(edit: PendingEdit) -> dict[str, Any]:
    """Build the `ConfirmationChallengeDTO` payload for an awaiting_confirm
    pending edit."""
    name = edit.target.get("name", "") or "this item"
    kind = edit.target.get("kind", "item")
    blast = edit.blast_radius or {}
    if blast.get("chapters") or blast.get("activities"):
        summary = (
            f"deletes {blast.get('chapters', 0)} chapter(s) and "
            f"{blast.get('activities', 0)} activity(s)"
        )
    elif blast.get("activities"):
        summary = f"deletes {blast.get('activities', 0)} activity(s)"
    else:
        summary = "this action cannot be undone"
    return {
        "pending_id": edit.pending_id,
        "action_label": f"Delete {kind} \"{name}\"",
        "blast_radius_summary": summary,
        "challenge_phrase": edit.challenge_phrase or "",
        "challenge_kind": edit.challenge_kind or "type_phrase",
    }
