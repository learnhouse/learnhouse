"""Redis-backed pending-edit store with explicit FSM.

A ``PendingEdit`` represents a proposed mutation that's waiting for the
user to confirm via the ``/pending/{id}/apply`` endpoint. Old Atlas
encoded this state implicitly in chat history (HTML-comment markers,
regex-matched approval keywords). The new store makes it durable,
inspectable, and per-resource exclusive.

State machine:
    Proposed ──► AwaitingConfirm (destructive only) ──► Applying ──► Applied
                              │                            │
                              ├─► Cancelled                └─► Failed
                              └─► Superseded
                              └─► (TTL expiry: silent cancel)

Atomicity guarantees:
  - ``create()`` supersedes any prior pending for the same (chat,
    resource_uuid) so a single live preview card per resource is the
    invariant the frontend can rely on.
  - ``mark_applying()`` is a Lua CAS — concurrent apply attempts cannot
    both succeed.
  - Per-chat cap (3 active pendings across distinct resources) is
    enforced at create time; oldest are superseded to make room.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from uuid import uuid4

import redis.asyncio as redis_async
from pydantic import BaseModel, Field

from config.config import get_learnhouse_config
from src.services.ai.atlas.events import ResourceRef
from src.services.ai.atlas.tiers import ConfirmationChallenge, Tier

logger = logging.getLogger(__name__)


PENDING_TTL_SECONDS = 30 * 60  # 30 minutes per plan
CHAT_INDEX_TTL_SECONDS = 24 * 60 * 60  # 24 hours
MAX_PENDINGS_PER_CHAT = 3

PendingStatus = str  # one of: proposed | awaiting_confirm | applying | applied | cancelled | superseded | failed


class PendingEdit(BaseModel):
    """Durable record of a proposed mutation awaiting user confirmation."""

    pending_id: str
    aichat_uuid: str
    user_id: int
    org_id: int

    tier: Tier
    tool_name: str  # the ``apply_*`` tool that will run on confirm
    target_resource: ResourceRef
    proposed_payload: dict[str, Any]
    current_snapshot: Optional[dict[str, Any]] = None
    summary: str
    blast_radius: Optional[dict[str, Any]] = None
    expected_version: Optional[int] = None
    challenge: Optional[ConfirmationChallenge] = None

    status: str = "proposed"
    created_at: datetime
    expires_at: datetime
    applied_at: Optional[datetime] = None
    version_after: Optional[int] = None
    failure_reason: Optional[str] = None
    undo_token: Optional[str] = None


class CreatePendingEditRequest(BaseModel):
    """Inputs to ``PendingStore.create()``.

    Separated from ``PendingEdit`` so callers don't have to mint
    timestamps or ids — the store owns those.
    """

    aichat_uuid: str
    user_id: int
    org_id: int
    tier: Tier
    tool_name: str
    target_resource: ResourceRef
    proposed_payload: dict[str, Any]
    current_snapshot: Optional[dict[str, Any]] = None
    summary: str
    blast_radius: Optional[dict[str, Any]] = Field(default=None)
    expected_version: Optional[int] = None
    challenge: Optional[ConfirmationChallenge] = None


# Lua: CAS transition proposed | awaiting_confirm → applying. Returns the
# full record JSON on success or empty string on failure (status was not
# proposed/awaiting_confirm, e.g. already applying/applied/cancelled).
_LUA_MARK_APPLYING = """
local raw = redis.call('GET', KEYS[1])
if not raw then return '' end
local data = cjson.decode(raw)
if data.status ~= 'proposed' and data.status ~= 'awaiting_confirm' then
  return ''
end
data.status = 'applying'
local encoded = cjson.encode(data)
redis.call('SET', KEYS[1], encoded, 'KEEPTTL')
return encoded
"""


class PendingStore:
    """Async, Redis-backed pending-edit store. One per HTTP request."""

    KEY_PENDING = "atlas:pending:"
    KEY_BY_CHAT = "atlas:pending_by_chat:"
    KEY_BY_RESOURCE = "atlas:pending_by_resource:"

    def __init__(self) -> None:
        self._redis: Optional[redis_async.Redis] = None
        conn = get_learnhouse_config().redis_config.redis_connection_string
        if conn:
            try:
                self._redis = redis_async.from_url(
                    conn, socket_connect_timeout=5, socket_timeout=5
                )
            except Exception as e:
                logger.warning("PendingStore: Redis unavailable, disabling: %s", e)
                self._redis = None
        self._lua_mark_applying = None

    def _key(self, pending_id: str) -> str:
        return f"{self.KEY_PENDING}{pending_id}"

    def _chat_key(self, aichat_uuid: str) -> str:
        return f"{self.KEY_BY_CHAT}{aichat_uuid}"

    def _resource_key(self, resource_uuid: str) -> str:
        return f"{self.KEY_BY_RESOURCE}{resource_uuid}"

    # -- Reads ------------------------------------------------------------

    async def get(
        self, pending_id: str, *, user_id: int, org_id: int
    ) -> Optional[PendingEdit]:
        """Fetch and ownership-check a pending edit.

        Returns ``None`` if missing, expired, or owned by a different
        user/org — callers should treat that as 404.
        """
        if self._redis is None:
            return None
        try:
            raw = await self._redis.get(self._key(pending_id))
            if not raw:
                return None
            pe = PendingEdit.model_validate_json(raw)
            if pe.user_id != user_id or pe.org_id != org_id:
                return None
            return pe
        except Exception as e:
            logger.warning("PendingStore.get failed: %s", e)
            return None

    async def list_for_chat(self, aichat_uuid: str) -> list[PendingEdit]:
        """All non-expired pending edits in a chat session."""
        if self._redis is None:
            return []
        try:
            ids = await self._redis.smembers(self._chat_key(aichat_uuid))
            if not ids:
                return []
            keys = [self._key(_decode(pid)) for pid in ids]
            raws = await self._redis.mget(keys)
            out: list[PendingEdit] = []
            stale: list[str] = []
            for pid, raw in zip(ids, raws):
                if raw is None:
                    stale.append(_decode(pid))
                    continue
                try:
                    out.append(PendingEdit.model_validate_json(raw))
                except Exception:
                    stale.append(_decode(pid))
            # Best-effort cleanup of dangling index entries
            if stale:
                await self._redis.srem(self._chat_key(aichat_uuid), *stale)
            return out
        except Exception as e:
            logger.warning("PendingStore.list_for_chat failed: %s", e)
            return []

    async def list_for_resource(self, resource_uuid: str) -> list[PendingEdit]:
        """All pending edits currently targeting a given resource."""
        if self._redis is None:
            return []
        try:
            ids = await self._redis.smembers(self._resource_key(resource_uuid))
            if not ids:
                return []
            keys = [self._key(_decode(pid)) for pid in ids]
            raws = await self._redis.mget(keys)
            return [PendingEdit.model_validate_json(r) for r in raws if r is not None]
        except Exception as e:
            logger.warning("PendingStore.list_for_resource failed: %s", e)
            return []

    # -- Writes -----------------------------------------------------------

    async def create(self, req: CreatePendingEditRequest) -> PendingEdit:
        """Mint a new pending edit, superseding any prior one on the same
        (chat, resource_uuid). Enforces the per-chat cap.

        Returns the persisted ``PendingEdit``. If Redis is unavailable
        the record is returned but not persisted — apply will then fail
        with ``pending_not_found`` and the user can retry.
        """
        now = datetime.now(timezone.utc)
        pending_id = "pend_" + uuid4().hex[:16]
        record = PendingEdit(
            pending_id=pending_id,
            aichat_uuid=req.aichat_uuid,
            user_id=req.user_id,
            org_id=req.org_id,
            tier=req.tier,
            tool_name=req.tool_name,
            target_resource=req.target_resource,
            proposed_payload=req.proposed_payload,
            current_snapshot=req.current_snapshot,
            summary=req.summary,
            blast_radius=req.blast_radius,
            expected_version=req.expected_version,
            challenge=req.challenge,
            status="awaiting_confirm" if req.tier == "DESTRUCTIVE" else "proposed",
            created_at=now,
            expires_at=now + timedelta(seconds=PENDING_TTL_SECONDS),
        )

        if self._redis is None:
            return record

        try:
            await self._supersede_for_resource(
                req.aichat_uuid, req.target_resource.uuid, reason="superseded"
            )
            await self._enforce_chat_cap(req.aichat_uuid)

            pipe = self._redis.pipeline(transaction=True)
            pipe.setex(self._key(pending_id), PENDING_TTL_SECONDS, record.model_dump_json())
            pipe.sadd(self._chat_key(req.aichat_uuid), pending_id)
            pipe.expire(self._chat_key(req.aichat_uuid), CHAT_INDEX_TTL_SECONDS)
            pipe.sadd(self._resource_key(req.target_resource.uuid), pending_id)
            pipe.expire(self._resource_key(req.target_resource.uuid), PENDING_TTL_SECONDS)
            await pipe.execute()
        except Exception as e:
            logger.warning("PendingStore.create write failed: %s", e)

        return record

    async def mark_applying(self, pending_id: str) -> Optional[PendingEdit]:
        """Atomic CAS: proposed|awaiting_confirm → applying.

        Returns the updated record on success, or ``None`` if the
        pending was already in a non-transitionable state (already
        applying/applied/cancelled/superseded/failed/expired). The
        router maps ``None`` to HTTP 409.
        """
        if self._redis is None:
            return None
        try:
            if self._lua_mark_applying is None:
                self._lua_mark_applying = self._redis.register_script(_LUA_MARK_APPLYING)
            raw = await self._lua_mark_applying(keys=[self._key(pending_id)])
            if not raw:
                return None
            if isinstance(raw, bytes):
                raw = raw.decode("utf-8")
            if raw == "":
                return None
            return PendingEdit.model_validate_json(raw)
        except Exception as e:
            logger.warning("PendingStore.mark_applying failed: %s", e)
            return None

    async def mark_applied(
        self,
        pending_id: str,
        *,
        version_after: Optional[int] = None,
        undo_token: Optional[str] = None,
    ) -> None:
        """Final-state transition after a successful apply."""
        await self._patch_status(
            pending_id,
            status="applied",
            extras={
                "applied_at": datetime.now(timezone.utc).isoformat(),
                "version_after": version_after,
                "undo_token": undo_token,
            },
        )

    async def mark_failed(self, pending_id: str, reason: str) -> None:
        """Terminal failure (apply raised, optimistic-lock conflict, etc.)."""
        await self._patch_status(
            pending_id, status="failed", extras={"failure_reason": reason}
        )

    async def supersede(self, pending_id: str, reason: str) -> None:
        """Drop a pending because a newer one (or subject change) replaced it."""
        await self._patch_status(
            pending_id, status="superseded", extras={"failure_reason": reason}
        )

    async def cancel(self, pending_id: str, *, user_id: int) -> bool:
        """User-initiated cancel. Returns False if the pending is gone
        or owned by a different user."""
        if self._redis is None:
            return False
        try:
            raw = await self._redis.get(self._key(pending_id))
            if not raw:
                return False
            pe = PendingEdit.model_validate_json(raw)
            if pe.user_id != user_id:
                return False
            if pe.status in ("applied", "cancelled", "failed", "superseded"):
                return False
            await self._patch_status(pending_id, status="cancelled", extras={})
            return True
        except Exception as e:
            logger.warning("PendingStore.cancel failed: %s", e)
            return False

    # -- Internals --------------------------------------------------------

    async def _patch_status(
        self, pending_id: str, *, status: PendingStatus, extras: dict[str, Any]
    ) -> None:
        """Read-modify-write a record's status without touching TTL."""
        if self._redis is None:
            return
        try:
            raw = await self._redis.get(self._key(pending_id))
            if not raw:
                return
            data = json.loads(raw)
            data["status"] = status
            for k, v in (extras or {}).items():
                if v is not None:
                    data[k] = v
            await self._redis.set(
                self._key(pending_id), json.dumps(data, default=str), keepttl=True
            )
        except Exception as e:
            logger.warning("PendingStore._patch_status failed: %s", e)

    async def _supersede_for_resource(
        self, aichat_uuid: str, resource_uuid: str, *, reason: str
    ) -> None:
        """Mark any prior pending edits on the same (chat, resource) as
        superseded so the new one is the single live card."""
        if self._redis is None:
            return
        try:
            chat_ids = await self._redis.smembers(self._chat_key(aichat_uuid))
            res_ids = await self._redis.smembers(self._resource_key(resource_uuid))
            overlap = {_decode(x) for x in chat_ids} & {_decode(x) for x in res_ids}
            for pid in overlap:
                await self.supersede(pid, reason)
        except Exception as e:
            logger.warning("PendingStore._supersede_for_resource failed: %s", e)

    async def _enforce_chat_cap(self, aichat_uuid: str) -> None:
        """Trim oldest active pendings if a chat exceeds the cap."""
        if self._redis is None:
            return
        actives = await self.list_for_chat(aichat_uuid)
        active = [p for p in actives if p.status in ("proposed", "awaiting_confirm")]
        if len(active) < MAX_PENDINGS_PER_CHAT:
            return
        # Sort oldest-first; supersede until we're under cap.
        active.sort(key=lambda p: p.created_at)
        overflow = len(active) - (MAX_PENDINGS_PER_CHAT - 1)
        for victim in active[:overflow]:
            await self.supersede(victim.pending_id, "chat_cap_exceeded")

    async def close(self) -> None:
        if self._redis is not None:
            try:
                await self._redis.aclose()
            except Exception:
                pass


def _decode(v: Any) -> str:
    """Decode a Redis set member which may come back as bytes or str."""
    if isinstance(v, bytes):
        return v.decode("utf-8")
    return str(v)
