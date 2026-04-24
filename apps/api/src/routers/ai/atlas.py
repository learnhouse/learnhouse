import json
import logging
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import get_db_session
from src.db.organizations import Organization
from src.db.users import PublicUser
from src.security.api_token_utils import get_authenticated_non_api_token_user
from src.security.org_auth import require_org_membership
from src.services.ai.atlas.agent import run_atlas_turn
from src.services.ai.atlas.history import (
    ATLAS_MODE,
    new_session_uuid,
    save_atlas_turn,
)
from src.services.ai.base import (
    delete_chat_session,
    get_chat_messages,
    get_user_chat_sessions,
    update_chat_session_meta,
)
from src.services.api_tokens.api_tokens import (
    ATLAS_SESSION_TTL_MINUTES,
    create_atlas_session_token,
    revoke_atlas_session_token,
)

logger = logging.getLogger(__name__)

router = APIRouter()


# ─── models ────────────────────────────────────────────────────────────────


class AtlasMessage(BaseModel):
    role: str = Field(description="Either 'user' or 'model'.")
    content: str


class AtlasSessionResponse(BaseModel):
    token: str
    token_uuid: str
    expires_at: str
    ttl_seconds: int


class AtlasChatRequest(BaseModel):
    org_id: int
    session_token: str
    message: str
    # Optional continuation: if present, the turn is appended to that
    # session's Redis history. If absent, a fresh session is minted and
    # returned to the client via the SSE `session` event.
    aichat_uuid: Optional[str] = None


class AtlasRevokeRequest(BaseModel):
    token_uuid: str


class AtlasSessionListItem(BaseModel):
    aichat_uuid: str
    title: str
    created_at: Optional[str] = None
    favorite: bool = False


class AtlasSessionUpdateRequest(BaseModel):
    title: Optional[str] = None
    favorite: Optional[bool] = None


# ─── shared helpers ────────────────────────────────────────────────────────


async def _ensure_org_access(user_id: int, org_id: int, db_session: AsyncSession) -> Organization:
    org = (await db_session.execute(select(Organization).where(Organization.id == org_id))).scalars().first()
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")
    await require_org_membership(user_id, org_id, db_session)
    return org


# ─── auth / token endpoints ────────────────────────────────────────────────


@router.post(
    "/session",
    response_model=AtlasSessionResponse,
    summary="Mint an Atlas session token",
    description=(
        "Mint a short-lived API token for the Atlas in-product agent, scoped to "
        "the caller's user + org. The frontend should auto-refresh by calling "
        "this endpoint a minute or two before expiry."
    ),
    responses={
        200: {"description": "Session token minted.", "model": AtlasSessionResponse},
        401: {"description": "Authentication required"},
        403: {"description": "User is not a member of this organization"},
        404: {"description": "Organization not found"},
    },
)
async def api_atlas_session(
    request: Request,
    org_id: int,
    current_user: PublicUser = Depends(get_authenticated_non_api_token_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> AtlasSessionResponse:
    await _ensure_org_access(current_user.id, org_id, db_session)
    token, row = await create_atlas_session_token(db_session, current_user.id, org_id)
    return AtlasSessionResponse(
        token=token,
        token_uuid=row.token_uuid,
        expires_at=row.expires_at or "",
        ttl_seconds=ATLAS_SESSION_TTL_MINUTES * 60,
    )


@router.post(
    "/session/revoke",
    summary="Revoke an Atlas session token",
    responses={
        200: {"description": "Token revoked (or no-op if it wasn't active)."},
        401: {"description": "Authentication required"},
    },
)
async def api_atlas_revoke(
    request: Request,
    body: AtlasRevokeRequest,
    current_user: PublicUser = Depends(get_authenticated_non_api_token_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    await revoke_atlas_session_token(db_session, body.token_uuid, current_user.id)
    return {"ok": True}


# ─── chat (streaming) ──────────────────────────────────────────────────────


@router.post(
    "/chat",
    summary="Stream an Atlas chat turn",
    description=(
        "Send one user message and stream back the agent's response as "
        "Server-Sent Events. If `aichat_uuid` is present the turn is "
        "appended to that session's Redis history; otherwise a new session "
        "is minted and its uuid surfaced via the first SSE event "
        "(`type='session'`). Emitted events: session, start, chunk, "
        "tool_call, tool_result, done, error."
    ),
    responses={
        200: {
            "description": "SSE stream of chat events.",
            "content": {"text/event-stream": {}},
        },
        401: {"description": "Authentication required"},
        403: {"description": "User is not a member of this organization"},
        404: {"description": "Organization not found, or session not owned by this user"},
    },
)
async def api_atlas_chat(
    request: Request,
    body: AtlasChatRequest,
    current_user: PublicUser = Depends(get_authenticated_non_api_token_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    await _ensure_org_access(current_user.id, body.org_id, db_session)

    if not body.message or not body.message.strip():
        raise HTTPException(status_code=400, detail="message must be non-empty")
    if not body.session_token or not body.session_token.startswith("lh_"):
        raise HTTPException(
            status_code=400,
            detail="session_token must be a LearnHouse API token (starts with 'lh_').",
        )

    # Resolve the chat session uuid + load its history from Redis. If the
    # caller supplied one, we verify ownership by calling get_chat_messages
    # which does the check for us (returns None for non-owned sessions).
    aichat_uuid = body.aichat_uuid
    history_messages: list[dict[str, Any]] = []
    if aichat_uuid:
        loaded = get_chat_messages(aichat_uuid, current_user.id)
        if loaded is None:
            raise HTTPException(
                status_code=404,
                detail="Chat session not found or not owned by this user.",
            )
        history_messages = loaded
    else:
        aichat_uuid = new_session_uuid()

    # Strip Atlas-specific tool_calls fields before handing history to the
    # Gemini agent — the model only cares about text. Tool results from
    # past turns are already baked into the next user message.
    agent_history = [
        {"role": m.get("role"), "content": m.get("content", "")}
        for m in history_messages
        if m.get("role") in ("user", "model") and m.get("content")
    ]

    user_id = current_user.id
    org_id = body.org_id

    async def event_generator():
        full_text_parts: list[str] = []
        tool_log: dict[str, dict[str, Any]] = {}  # call_id -> {name, args, summary, is_error, guidance}

        # Emit the session uuid up front so the frontend can pin state to it
        # (URL param, sidebar highlight) before any tokens stream in.
        yield f"data: {json.dumps({'type': 'session', 'aichat_uuid': aichat_uuid})}\n\n"

        try:
            async for event in run_atlas_turn(
                user_message=body.message,
                history=agent_history,
                session_token=body.session_token,
            ):
                kind = event.get("type")
                if kind == "chunk" and isinstance(event.get("content"), str):
                    full_text_parts.append(event["content"])
                elif kind == "tool_call":
                    tool_log[event["call_id"]] = {
                        "name": event.get("name"),
                        "args": event.get("args") or {},
                    }
                elif kind == "tool_result":
                    entry = tool_log.setdefault(event["call_id"], {})
                    entry["summary"] = event.get("summary")
                    entry["is_error"] = bool(event.get("is_error"))
                    if event.get("guidance"):
                        entry["guidance"] = event["guidance"]
                yield f"data: {json.dumps(event)}\n\n"
        except Exception:
            logger.exception("Atlas SSE generator blew up")
            yield f"data: {json.dumps({'type': 'error', 'message': 'Atlas stream terminated unexpectedly.'})}\n\n"
            return

        # Persist the turn only if we actually produced something — a
        # zero-output turn (e.g. stream aborted mid-flight) would polute
        # the session with an empty model message.
        final_text = "".join(full_text_parts).strip()
        tool_calls_list = [
            {
                "name": info.get("name"),
                "args": info.get("args") or {},
                "summary": info.get("summary"),
                "is_error": info.get("is_error"),
                "guidance": info.get("guidance"),
            }
            for info in tool_log.values()
        ]
        if final_text or tool_calls_list:
            try:
                save_atlas_turn(
                    aichat_uuid=aichat_uuid,
                    user_message=body.message,
                    ai_response=final_text,
                    tool_calls=tool_calls_list or None,
                    user_id=user_id,
                    org_id=org_id,
                )
            except Exception:
                logger.exception("Failed to persist Atlas turn %s", aichat_uuid)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ─── session management ────────────────────────────────────────────────────


@router.get(
    "/sessions",
    summary="List the caller's Atlas chat sessions",
    description=(
        "Returns the caller's Atlas sessions, newest first. Sessions are "
        "filtered to `mode='atlas'` so Copilot/RAG sessions don't appear in "
        "the Atlas sidebar."
    ),
)
async def api_atlas_sessions_list(
    org_id: int,
    current_user: PublicUser = Depends(get_authenticated_non_api_token_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    await _ensure_org_access(current_user.id, org_id, db_session)
    sessions = get_user_chat_sessions(current_user.id, org_id=org_id)
    atlas_sessions = [s for s in sessions if s.get("mode") == ATLAS_MODE]
    # Keep only the fields the sidebar needs, so we don't leak e.g.
    # unrelated course_uuid fields that belong to the Copilot shape.
    return {
        "sessions": [
            {
                "aichat_uuid": s.get("aichat_uuid"),
                "title": s.get("title") or "Untitled",
                "created_at": s.get("created_at"),
                "favorite": bool(s.get("favorite", False)),
            }
            for s in atlas_sessions
            if s.get("aichat_uuid")
        ]
    }


@router.get(
    "/sessions/{aichat_uuid}/messages",
    summary="Load the messages in an Atlas chat session",
)
async def api_atlas_session_messages(
    aichat_uuid: str,
    current_user: PublicUser = Depends(get_authenticated_non_api_token_user),
):
    messages = get_chat_messages(aichat_uuid, current_user.id)
    if messages is None:
        raise HTTPException(
            status_code=404,
            detail="Chat session not found or not owned by this user.",
        )
    return {"messages": messages}


@router.delete(
    "/sessions/{aichat_uuid}",
    summary="Delete an Atlas chat session",
)
async def api_atlas_session_delete(
    aichat_uuid: str,
    current_user: PublicUser = Depends(get_authenticated_non_api_token_user),
):
    ok = delete_chat_session(aichat_uuid, current_user.id)
    if not ok:
        raise HTTPException(
            status_code=404,
            detail="Chat session not found or not owned by this user.",
        )
    return {"status": "deleted"}


@router.patch(
    "/sessions/{aichat_uuid}",
    summary="Rename or favorite an Atlas chat session",
)
async def api_atlas_session_patch(
    aichat_uuid: str,
    body: AtlasSessionUpdateRequest,
    current_user: PublicUser = Depends(get_authenticated_non_api_token_user),
):
    updated = update_chat_session_meta(
        aichat_uuid=aichat_uuid,
        user_id=current_user.id,
        title=body.title,
        favorite=body.favorite,
    )
    if updated is None:
        raise HTTPException(
            status_code=404,
            detail="Chat session not found or not owned by this user.",
        )
    return {"session": updated}
