"""Atlas HTTP layer.

Endpoints (all under /api/v1/ai/atlas):

  POST /session                         mint a 24h lh_* session token
  POST /session/revoke                  revoke an Atlas session token
  POST /chat                            SSE stream of AtlasEvent
  POST /pending/{id}/apply              SSE — materializes a pending edit
  POST /pending/{id}/cancel             cancel a pending edit
  POST /pending/{id}/refine             SSE — run another turn scoped to a pending
  POST /pending/{id}/undo               SSE — best-effort inverse of an applied edit
  GET  /sessions                        list chat sessions
  GET  /sessions/{uuid}/messages        load chat history
  PATCH /sessions/{uuid}                rename / favourite
  DELETE /sessions/{uuid}               drop chat
  GET  /sessions/{uuid}/pendings        live pending edits for a chat
  GET  /health                          probe MCP + Redis + Gemini key

All endpoints are gated by the parent router's `require_authenticated_user`
+ `require_plan("pro", "Atlas")` dependencies (see src/router.py).
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import secrets
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from uuid import uuid4

import httpx
import redis
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession
from sse_starlette.sse import EventSourceResponse

from config.config import get_learnhouse_config
from src.core.events.database import get_db_session
from src.db.api_tokens import APIToken
from src.db.organizations import Organization
from src.db.users import PublicUser
from src.security.auth import get_authenticated_user
from src.security.org_auth import get_user_org_role
from src.services.ai.atlas import events as ev
from src.services.ai.atlas.apply import apply_pending
from src.services.ai.atlas.config import (
    CHAT_HISTORY_MAX_MESSAGES,
    CHAT_HISTORY_TTL_SECONDS,
)
from src.services.ai.atlas.deps import AtlasDeps
from src.services.ai.atlas.pending import PendingStore
from src.services.ai.atlas.turn import run_turn

logger = logging.getLogger(__name__)
router = APIRouter()

LH_CONFIG = get_learnhouse_config()


# ─── Helpers ─────────────────────────────────────────────────────────────


def _get_redis() -> redis.Redis:
    conn = LH_CONFIG.redis_config.redis_connection_string
    if not conn:
        raise HTTPException(
            status_code=503, detail="Redis is not configured; Atlas requires Redis."
        )
    return redis.Redis.from_url(conn, socket_connect_timeout=2)


def _model_id() -> str:
    """Pydantic-AI accepts provider-prefixed model strings (e.g.
    `google-gla:gemini-2.5-flash`). The LH config stores the bare model
    name (`gemini-2.5-flash`); we prepend the provider prefix here."""
    raw = getattr(LH_CONFIG.ai_config, "atlas_model", None) or "gemini-2.5-flash"
    return raw if ":" in raw else f"google-gla:{raw}"


def _mcp_url() -> str:
    return getattr(LH_CONFIG.ai_config, "mcp_internal_url", None) or "http://127.0.0.1:8765/mcp"


def _session_ttl_seconds() -> int:
    return 86400  # 24h


async def _get_org_slug(db: AsyncSession, org_id: int) -> str:
    org = (await db.execute(select(Organization).where(Organization.id == org_id))).scalars().first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    return org.slug  # type: ignore[no-any-return]


def _user_chats_key(user_id: int) -> str:
    return f"atlas:chats:{user_id}"


def _chat_meta_key(aichat_uuid: str) -> str:
    return f"atlas:chat:meta:{aichat_uuid}"


def _chat_history_key(aichat_uuid: str) -> str:
    return f"atlas:chat:history:{aichat_uuid}"


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


# ─── Request/response models ─────────────────────────────────────────────


class AtlasSessionResponse(BaseModel):
    token: str
    token_uuid: str
    expires_at: str
    ttl_seconds: int


class RevokeRequest(BaseModel):
    token_uuid: str


class AtlasReferencePayload(BaseModel):
    type: str
    uuid: str
    name: str
    parent_course_uuid: Optional[str] = None
    parent_chapter_id: Optional[int] = None
    parent_chapter_name: Optional[str] = None
    activity_type: Optional[str] = None


class AtlasPageContextPayload(BaseModel):
    course_uuid: Optional[str] = None
    course_name: Optional[str] = None
    chapter_uuid: Optional[str] = None
    chapter_id: Optional[int] = None
    chapter_name: Optional[str] = None
    activity_uuid: Optional[str] = None
    activity_name: Optional[str] = None
    references: Optional[list[AtlasReferencePayload]] = None


class ChatRequest(BaseModel):
    org_id: int
    session_token: str
    message: str
    aichat_uuid: Optional[str] = None
    page_context: Optional[AtlasPageContextPayload] = None
    references: Optional[list[AtlasReferencePayload]] = None


class ApplyRequest(BaseModel):
    org_id: int
    session_token: str
    confirmation_phrase: Optional[str] = None


class CancelRequest(BaseModel):
    org_id: int


class RefineRequest(BaseModel):
    org_id: int
    session_token: str
    instruction: str
    page_context: Optional[AtlasPageContextPayload] = None


class SessionPatchRequest(BaseModel):
    title: Optional[str] = None
    favorite: Optional[bool] = None


# ─── Session minting ─────────────────────────────────────────────────────


@router.post("/session", response_model=AtlasSessionResponse, summary="Mint Atlas session token")
async def atlas_create_session(
    request: Request,
    org_id: int,
    current_user: PublicUser = Depends(get_authenticated_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> AtlasSessionResponse:
    """Issue a short-lived `lh_*` API token tagged as an Atlas session.

    The token is used by the MCP server to call back to the LH API on
    behalf of the user. It carries no special rights — RBAC checks run
    against the original user's permissions on apply.
    """
    org = (await db_session.execute(
        select(Organization).where(Organization.id == org_id)
    )).scalars().first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    random_part = secrets.token_urlsafe(32)
    full_token = f"lh_{random_part}"
    token_prefix = full_token[:12]
    token_hash = _hash_token(full_token)
    token_uuid = f"apitoken_{uuid4()}"

    ttl = _session_ttl_seconds()
    now = datetime.now(timezone.utc)
    expires_at = (now + timedelta(seconds=ttl)).isoformat()

    # Copy the user's role rights onto the session token so the MCP server,
    # when calling LH REST endpoints with this token, acts with the same
    # permissions the user has in the org. Without this, the token authenticates
    # but has no rights → courses/* and similar return 403.
    user_role = await get_user_org_role(current_user.id, org_id, db_session)
    role_rights = None
    if user_role and user_role.rights:
        role_rights = (
            user_role.rights.model_dump()
            if hasattr(user_role.rights, "model_dump")
            else user_role.rights
        )

    api_token = APIToken(
        token_uuid=token_uuid,
        name=f"Atlas session ({now.isoformat()})",
        description="Auto-issued Atlas session token",
        token_prefix=token_prefix,
        token_hash=token_hash,
        org_id=org_id,
        rights=role_rights,
        created_by_user_id=current_user.id,
        creation_date=str(now),
        update_date=str(now),
        expires_at=expires_at,
        is_active=True,
    )
    db_session.add(api_token)
    await db_session.commit()

    return AtlasSessionResponse(
        token=full_token,
        token_uuid=token_uuid,
        expires_at=expires_at,
        ttl_seconds=ttl,
    )


@router.post("/session/revoke", summary="Revoke an Atlas session token")
async def atlas_revoke_session(
    payload: RevokeRequest,
    current_user: PublicUser = Depends(get_authenticated_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    token = (await db_session.execute(
        select(APIToken).where(APIToken.token_uuid == payload.token_uuid)
    )).scalars().first()
    if not token:
        return {"status": "not_found"}
    if token.created_by_user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your token")
    token.is_active = False
    db_session.add(token)
    await db_session.commit()
    return {"status": "revoked"}


# ─── /chat ───────────────────────────────────────────────────────────────


def _persist_history(
    r: redis.Redis,
    *,
    aichat_uuid: str,
    user_id: int,
    org_id: int,
    role: str,
    content: str,
    is_new: bool,
    initial_title: str | None,
) -> None:
    key = _chat_history_key(aichat_uuid)
    raw = r.get(key)
    msgs: list[dict] = json.loads(raw) if raw else []
    msgs.append({"role": role, "content": content, "ts": int(time.time())})
    if len(msgs) > CHAT_HISTORY_MAX_MESSAGES * 2:
        msgs = msgs[-CHAT_HISTORY_MAX_MESSAGES * 2 :]
    r.set(key, json.dumps(msgs), ex=CHAT_HISTORY_TTL_SECONDS)

    if is_new:
        meta = {
            "aichat_uuid": aichat_uuid,
            "title": (initial_title or content[:60] or "New chat"),
            "created_at": datetime.now(timezone.utc).isoformat(),
            "favorite": False,
            "user_id": user_id,
            "org_id": org_id,
        }
        r.set(_chat_meta_key(aichat_uuid), json.dumps(meta), ex=CHAT_HISTORY_TTL_SECONDS)
        r.zadd(_user_chats_key(user_id), {aichat_uuid: time.time()})
        r.expire(_user_chats_key(user_id), CHAT_HISTORY_TTL_SECONDS)


@router.post("/chat", summary="Atlas chat (SSE stream)")
async def atlas_chat(
    request: Request,
    payload: ChatRequest,
    current_user: PublicUser = Depends(get_authenticated_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    r = _get_redis()
    aichat_uuid = payload.aichat_uuid or f"aichat_{uuid4()}"
    is_new_chat = payload.aichat_uuid is None

    org_slug = await _get_org_slug(db_session, payload.org_id)
    references = (
        [ref.model_dump() for ref in payload.references] if payload.references else None
    )

    course_snapshot = await _load_course_snapshot(
        request, payload.session_token, payload.org_id, payload.page_context
    )

    deps = AtlasDeps(
        request=request,
        db=db_session,
        current_user=current_user,
        org_id=payload.org_id,
        org_slug=org_slug,
        aichat_uuid=aichat_uuid,
        session_token=payload.session_token,
        page_context=payload.page_context.model_dump() if payload.page_context else None,
        references=references,
        course_snapshot=course_snapshot,
        redis_client=r,
    )

    pending_store = PendingStore(r)

    _persist_history(
        r,
        aichat_uuid=aichat_uuid,
        user_id=current_user.id,
        org_id=payload.org_id,
        role="user",
        content=payload.message,
        is_new=is_new_chat,
        initial_title=payload.message,
    )

    async def event_source():
        async for event in run_turn(
            deps=deps,
            user_message=payload.message,
            pending_store=pending_store,
            model=_model_id(),
            mcp_url=_mcp_url(),
            new_chat=is_new_chat,
            api_key=getattr(LH_CONFIG.ai_config, "gemini_api_key", None),
        ):
            yield event

    return EventSourceResponse(event_source())


async def _load_course_snapshot(
    request: Request,
    session_token: str,
    org_id: int,
    page_context: Optional[AtlasPageContextPayload],
) -> dict | None:
    """Pre-fetch the focused course's chapter/activity tree so the LLM's
    first turn has rich context without an extra tool call.

    Calls the existing `GET /courses/{uuid}/meta?slim=true` endpoint over
    HTTP using the session token, so RBAC is uniformly enforced.
    """
    if not page_context or not page_context.course_uuid:
        return None
    base = str(request.url_for("api_get_course_meta", course_uuid=page_context.course_uuid))
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                base,
                params={"slim": "true"},
                headers={"Authorization": f"Bearer {session_token}"},
            )
            if resp.is_error:
                return None
            data = resp.json()
    except Exception:
        return None
    # Normalize to the shape render_focus_block expects.
    chapters = []
    for ch in data.get("chapters", []) or []:
        chapters.append(
            {
                "chapter_id": ch.get("id"),
                "name": ch.get("name"),
                "activity_count": len(ch.get("activities") or []),
                "activities": [
                    {
                        "activity_uuid": a.get("activity_uuid"),
                        "name": a.get("name"),
                        "activity_sub_type": a.get("activity_sub_type"),
                    }
                    for a in (ch.get("activities") or [])
                ],
            }
        )
    return {
        "name": data.get("name"),
        "published": data.get("published"),
        "chapters": chapters,
    }


# ─── /pending/* ──────────────────────────────────────────────────────────


@router.post("/pending/{pending_id}/apply", summary="Apply a pending edit (SSE)")
async def atlas_apply(
    pending_id: str,
    payload: ApplyRequest,
    request: Request,
    current_user: PublicUser = Depends(get_authenticated_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    r = _get_redis()
    store = PendingStore(r)
    edit = store.get(pending_id)
    if not edit:
        raise HTTPException(status_code=404, detail="Pending edit not found")
    if edit.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your pending edit")

    if edit.requires_confirmation:
        if not store.verify_challenge(edit, payload.confirmation_phrase):
            raise HTTPException(status_code=400, detail="Confirmation phrase did not match")

    org_slug = await _get_org_slug(db_session, payload.org_id)
    deps = AtlasDeps(
        request=request,
        db=db_session,
        current_user=current_user,
        org_id=payload.org_id,
        org_slug=org_slug,
        aichat_uuid=edit.aichat_uuid,
        session_token=payload.session_token,
        page_context=None,
        references=None,
        course_snapshot=None,
        redis_client=r,
    )

    async def event_source():
        async for event in apply_pending(edit=edit, deps=deps, store=store):
            yield event

    return EventSourceResponse(event_source())


@router.post("/pending/{pending_id}/cancel", summary="Cancel a pending edit")
async def atlas_cancel(
    pending_id: str,
    payload: CancelRequest,
    current_user: PublicUser = Depends(get_authenticated_user),
):
    r = _get_redis()
    store = PendingStore(r)
    edit = store.get(pending_id)
    if not edit:
        return {"status": "not_found"}
    if edit.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your pending edit")
    cancelled = store.cancel(pending_id)
    return {"status": "cancelled" if cancelled else "no_change"}


@router.post("/pending/{pending_id}/refine", summary="Refine an existing pending (SSE)")
async def atlas_refine(
    pending_id: str,
    payload: RefineRequest,
    request: Request,
    current_user: PublicUser = Depends(get_authenticated_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    r = _get_redis()
    store = PendingStore(r)
    edit = store.get(pending_id)
    if not edit:
        raise HTTPException(status_code=404, detail="Pending edit not found")
    if edit.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your pending edit")

    org_slug = await _get_org_slug(db_session, payload.org_id)
    # Pin the pending's target into focus so the LLM stays on subject.
    pc = (payload.page_context.model_dump() if payload.page_context else {}) or {}
    if edit.target.get("kind") == "course":
        pc.setdefault("course_uuid", edit.target.get("uuid"))
    course_snapshot = await _load_course_snapshot(
        request,
        payload.session_token,
        payload.org_id,
        AtlasPageContextPayload(**pc) if pc else None,
    )
    deps = AtlasDeps(
        request=request,
        db=db_session,
        current_user=current_user,
        org_id=payload.org_id,
        org_slug=org_slug,
        aichat_uuid=edit.aichat_uuid,
        session_token=payload.session_token,
        page_context=pc or None,
        references=None,
        course_snapshot=course_snapshot,
        redis_client=r,
    )
    refine_message = (
        f"Refine the pending edit `{pending_id}` (subject: "
        f"{edit.target.get('kind')} \"{edit.target.get('name','')}\"). "
        f"The user's refinement: {payload.instruction}"
    )

    async def event_source():
        async for event in run_turn(
            deps=deps,
            user_message=refine_message,
            pending_store=store,
            model=_model_id(),
            mcp_url=_mcp_url(),
            new_chat=False,
            api_key=getattr(LH_CONFIG.ai_config, "gemini_api_key", None),
        ):
            yield event

    return EventSourceResponse(event_source())


@router.post("/pending/{pending_id}/undo", summary="Undo a recently applied edit (SSE)")
async def atlas_undo(
    pending_id: str,
    payload: ApplyRequest,
    request: Request,
    current_user: PublicUser = Depends(get_authenticated_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    """Best-effort undo. Phase 1 supports inverse of single-resource edits;
    `propose_course_structure` is not undoable."""
    r = _get_redis()
    store = PendingStore(r)
    edit = store.get(pending_id)
    if not edit:
        raise HTTPException(status_code=404, detail="Pending edit not found")
    if edit.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your pending edit")
    if edit.status != "applied":
        raise HTTPException(status_code=400, detail="Pending is not in an applied state")
    if not edit.undo_token or payload.confirmation_phrase != edit.undo_token:
        raise HTTPException(status_code=400, detail="Invalid undo token")

    async def event_source():
        # Phase 1: emit an error for unsupported undos rather than a partial impl.
        yield ev.serialize(
            ev.ErrorEvent(
                code="UNSUPPORTED",
                message="Undo is not yet implemented in this phase. Manually revert the change via the editor.",
                retriable=False,
            )
        )
        yield ev.serialize(ev.DoneEvent())

    return EventSourceResponse(event_source())


# ─── /sessions/* ─────────────────────────────────────────────────────────


@router.get("/sessions", summary="List Atlas chat sessions")
async def atlas_list_sessions(
    org_id: int,
    current_user: PublicUser = Depends(get_authenticated_user),
):
    r = _get_redis()
    raw_ids = r.zrevrange(_user_chats_key(current_user.id), 0, 49)
    sessions: list[dict] = []
    for raw_id in raw_ids:
        uuid_str = raw_id.decode() if isinstance(raw_id, bytes) else raw_id
        meta_raw = r.get(_chat_meta_key(uuid_str))
        if not meta_raw:
            continue
        meta = json.loads(meta_raw)
        if meta.get("org_id") != org_id:
            continue
        sessions.append(
            {
                "aichat_uuid": meta.get("aichat_uuid"),
                "title": meta.get("title"),
                "created_at": meta.get("created_at"),
                "favorite": bool(meta.get("favorite", False)),
            }
        )
    return {"sessions": sessions}


@router.get("/sessions/{aichat_uuid}/messages", summary="Load chat history")
async def atlas_get_messages(
    aichat_uuid: str,
    current_user: PublicUser = Depends(get_authenticated_user),
):
    r = _get_redis()
    meta_raw = r.get(_chat_meta_key(aichat_uuid))
    if not meta_raw:
        return {"messages": []}
    meta = json.loads(meta_raw)
    if meta.get("user_id") != current_user.id:
        raise HTTPException(status_code=403, detail="Not your chat")
    raw = r.get(_chat_history_key(aichat_uuid))
    msgs = json.loads(raw) if raw else []
    return {"messages": msgs}


@router.patch("/sessions/{aichat_uuid}", summary="Rename / favourite a chat")
async def atlas_patch_session(
    aichat_uuid: str,
    payload: SessionPatchRequest,
    current_user: PublicUser = Depends(get_authenticated_user),
):
    r = _get_redis()
    meta_raw = r.get(_chat_meta_key(aichat_uuid))
    if not meta_raw:
        raise HTTPException(status_code=404, detail="Chat not found")
    meta = json.loads(meta_raw)
    if meta.get("user_id") != current_user.id:
        raise HTTPException(status_code=403, detail="Not your chat")
    if payload.title is not None:
        meta["title"] = payload.title[:200]
    if payload.favorite is not None:
        meta["favorite"] = bool(payload.favorite)
    r.set(_chat_meta_key(aichat_uuid), json.dumps(meta), ex=CHAT_HISTORY_TTL_SECONDS)
    return {"session": meta}


@router.delete("/sessions/{aichat_uuid}", summary="Delete a chat session")
async def atlas_delete_session(
    aichat_uuid: str,
    current_user: PublicUser = Depends(get_authenticated_user),
):
    r = _get_redis()
    meta_raw = r.get(_chat_meta_key(aichat_uuid))
    if not meta_raw:
        return {"status": "not_found"}
    meta = json.loads(meta_raw)
    if meta.get("user_id") != current_user.id:
        raise HTTPException(status_code=403, detail="Not your chat")
    r.delete(_chat_meta_key(aichat_uuid))
    r.delete(_chat_history_key(aichat_uuid))
    r.zrem(_user_chats_key(current_user.id), aichat_uuid)
    return {"status": "deleted"}


@router.get("/sessions/{aichat_uuid}/pendings", summary="List pending edits for a chat")
async def atlas_list_pendings(
    aichat_uuid: str,
    org_id: int,
    current_user: PublicUser = Depends(get_authenticated_user),
):
    r = _get_redis()
    store = PendingStore(r)
    edits = store.list_for_chat(aichat_uuid)
    # Only return this user's pendings.
    edits = [e for e in edits if e.user_id == current_user.id and e.org_id == org_id]
    return {
        "pendings": [
            {
                "pending_id": e.pending_id,
                "tool": e.tool,
                "tier": e.tier,
                "target": e.target,
                "mode": e.mode,
                "summary": e.summary,
                "status": e.status,
                "requires_confirmation": e.requires_confirmation,
                "blast_radius": e.blast_radius,
            }
            for e in edits
        ]
    }


# ─── /health ─────────────────────────────────────────────────────────────


@router.get("/health", summary="Atlas health probe")
async def atlas_health():
    out: dict[str, Any] = {
        "mcp_reachable": False,
        "redis_reachable": False,
        "gemini_key_present": False,
        "plan_ok": True,
    }
    try:
        r = _get_redis()
        r.ping()
        out["redis_reachable"] = True
    except Exception:
        pass

    out["gemini_key_present"] = bool(getattr(LH_CONFIG.ai_config, "gemini_api_key", None))

    try:
        async with httpx.AsyncClient(timeout=2) as client:
            resp = await client.get(_mcp_url().rsplit("/mcp", 1)[0] + "/")
            out["mcp_reachable"] = resp.status_code < 500
    except Exception:
        out["mcp_reachable"] = False

    return out
