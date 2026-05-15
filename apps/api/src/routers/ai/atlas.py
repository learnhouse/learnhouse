"""Atlas chat router — HTTP/SSE plumbing only.

The agent logic, tier enforcement, and tool dispatch all live in
``services/ai/atlas/pipeline.py``. This module owns:

  - Session token mint/revoke (unchanged from v1)
  - Sessions list/messages/patch/delete (unchanged from v1)
  - ``POST /chat`` SSE: builds AtlasDeps, runs ``pipeline.run_turn``,
    serializes events through ``sse-starlette``
  - ``POST /pending/{id}/apply``: confirms a pending edit and streams
    the apply via the same SSE shape
  - ``POST /pending/{id}/cancel``, ``POST /pending/{id}/refine``

All session-management endpoints from v1 are kept verbatim — only the
chat/streaming surface changed.
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession
from sse_starlette.sse import EventSourceResponse

from src.core.events.database import get_db_session
from src.db.organizations import Organization
from src.db.users import PublicUser
from src.security.api_token_utils import get_authenticated_non_api_token_user
from src.security.org_auth import require_org_membership
from src.services.ai.atlas.deps import AtlasDeps
from src.services.ai.atlas.events import serialize as serialize_event
from src.services.ai.atlas.history import (
    ATLAS_MODE,
    new_session_uuid,
    save_atlas_turn,
)
from src.services.ai.atlas.pending import PendingStore
from src.services.ai.atlas.pipeline import (
    AtlasTurnRequest,
    apply_flow,
    run_turn,
)
from src.services.ai.atlas.resolver import PageContextDTO, ReferenceDTO
from src.services.ai.atlas.snapshots import SnapshotCache
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


class AtlasSessionResponse(BaseModel):
    token: str
    token_uuid: str
    expires_at: str
    ttl_seconds: int


class AtlasReference(BaseModel):
    """Chat-panel chip a user attached to the next message."""

    type: str = Field(description="'activity' or 'chapter'")
    uuid: str
    name: str
    parent_course_uuid: str
    parent_chapter_id: Optional[int] = None
    parent_chapter_name: Optional[str] = None
    activity_type: Optional[str] = None


class AtlasPageContext(BaseModel):
    """What the user is currently looking at in the dashboard."""

    course_uuid: Optional[str] = None
    course_name: Optional[str] = None
    chapter_id: Optional[int] = None
    chapter_uuid: Optional[str] = None
    chapter_name: Optional[str] = None
    activity_uuid: Optional[str] = None
    activity_name: Optional[str] = None
    references: Optional[list[AtlasReference]] = None


class AtlasChatRequest(BaseModel):
    org_id: int
    session_token: str
    message: str
    aichat_uuid: Optional[str] = None
    page_context: Optional[AtlasPageContext] = None


class AtlasRevokeRequest(BaseModel):
    token_uuid: str


class AtlasSessionUpdateRequest(BaseModel):
    title: Optional[str] = None
    favorite: Optional[bool] = None


class PendingApplyRequest(BaseModel):
    org_id: int
    session_token: str
    confirmation_phrase: Optional[str] = None


class PendingCancelRequest(BaseModel):
    org_id: int


class PendingRefineRequest(BaseModel):
    org_id: int
    session_token: str
    instruction: str
    page_context: Optional[AtlasPageContext] = None


async def _ensure_org_access(user_id: int, org_id: int, db_session: AsyncSession) -> Organization:
    org = (await db_session.execute(select(Organization).where(Organization.id == org_id))).scalars().first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    await require_org_membership(user_id, org_id, db_session)
    return org


def _validate_session_token(token: str) -> None:
    if not token or not token.startswith("lh_"):
        raise HTTPException(
            status_code=400,
            detail="session_token must be a LearnHouse API token (starts with 'lh_').",
        )


def _page_context_dto(pc: Optional[AtlasPageContext]) -> PageContextDTO:
    if pc is None:
        return PageContextDTO()
    return PageContextDTO(
        course_uuid=pc.course_uuid,
        chapter_id=pc.chapter_id,
        chapter_uuid=pc.chapter_uuid,
        activity_uuid=pc.activity_uuid,
    )


def _references_dtos(pc: Optional[AtlasPageContext]) -> list[ReferenceDTO]:
    if pc is None or not pc.references:
        return []
    out: list[ReferenceDTO] = []
    for r in pc.references[:5]:
        if r.type not in ("activity", "chapter"):
            continue
        out.append(
            ReferenceDTO(
                kind=r.type,
                uuid=r.uuid,
                name=r.name,
                parent_course_uuid=r.parent_course_uuid,
                parent_chapter_id=r.parent_chapter_id,
            )
        )
    return out


@router.post("/session", response_model=AtlasSessionResponse, summary="Mint Atlas session token")
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


@router.post("/session/revoke", summary="Revoke Atlas session token")
async def api_atlas_revoke(
    request: Request,
    body: AtlasRevokeRequest,
    current_user: PublicUser = Depends(get_authenticated_non_api_token_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    await revoke_atlas_session_token(db_session, body.token_uuid, current_user.id)
    return {"ok": True}


@router.post(
    "/chat",
    summary="Stream one Atlas turn",
    description=(
        "Send one user message and stream back typed events as Server-Sent "
        "Events. Event types: session, message.delta, tool.start, tool.end, "
        "entity.resolved, entity.ambiguous, entity.not_found, preview.activity/"
        "chapter/course, results.list, structure.proposal, confirm.required, "
        "applied, pending.dropped, error, done."
    ),
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
    _validate_session_token(body.session_token)

    aichat_uuid = body.aichat_uuid
    if aichat_uuid:
        loaded = get_chat_messages(aichat_uuid, current_user.id)
        if loaded is None:
            raise HTTPException(
                status_code=404, detail="Chat session not found or not owned by this user."
            )
    else:
        aichat_uuid = new_session_uuid()

    return EventSourceResponse(
        _chat_event_stream(
            request=request,
            db_session=db_session,
            current_user=current_user,
            org_id=body.org_id,
            session_token=body.session_token,
            aichat_uuid=aichat_uuid,
            message=body.message,
            page_context=body.page_context,
        ),
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    )


async def _chat_event_stream(
    *,
    request: Request,
    db_session: AsyncSession,
    current_user: PublicUser,
    org_id: int,
    session_token: str,
    aichat_uuid: str,
    message: str,
    page_context: Optional[AtlasPageContext],
):
    """SSE generator. Persists turn to Redis after stream ends."""
    pending_store = PendingStore()
    snapshot_cache = SnapshotCache()
    deps = AtlasDeps(
        db=db_session,
        request=request,
        current_user=current_user,
        org_id=org_id,
        aichat_uuid=aichat_uuid,
        session_token=session_token,
        pending_store=pending_store,
        snapshot_cache=snapshot_cache,
    )
    req = AtlasTurnRequest(
        aichat_uuid=aichat_uuid,
        message=message,
        page_context=_page_context_dto(page_context),
        references=_references_dtos(page_context),
    )

    text_chunks: list[str] = []
    structured_events: list[dict] = []
    try:
        async for event in run_turn(req, deps):
            payload = serialize_event(event)
            if event.type == "message.delta":
                text_chunks.append(getattr(event, "delta", "") or "")
            elif event.type not in ("session", "tool.start", "tool.end", "message.delta"):
                structured_events.append(event.model_dump(exclude_none=True))
            yield payload
    except Exception:
        logger.exception("Atlas SSE generator failed")
        yield {
            "event": "error",
            "data": '{"code":"stream_failed","message":"Atlas stream terminated unexpectedly.","retriable":true}',
        }
    finally:
        try:
            await pending_store.close()
            await snapshot_cache.close()
        except Exception:
            pass

    final_text = "".join(text_chunks).strip()
    if final_text or structured_events:
        try:
            save_atlas_turn(
                aichat_uuid=aichat_uuid,
                user_message=message,
                ai_response=final_text,
                tool_calls=structured_events or None,
                user_id=current_user.id,
                org_id=org_id,
            )
        except Exception:
            logger.exception("Failed to persist Atlas turn %s", aichat_uuid)


@router.post(
    "/pending/{pending_id}/apply",
    summary="Apply a pending Atlas edit",
)
async def api_pending_apply(
    request: Request,
    pending_id: str,
    body: PendingApplyRequest,
    current_user: PublicUser = Depends(get_authenticated_non_api_token_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    await _ensure_org_access(current_user.id, body.org_id, db_session)
    _validate_session_token(body.session_token)

    pending_store = PendingStore()
    snapshot_cache = SnapshotCache()
    pe = await pending_store.get(pending_id, user_id=current_user.id, org_id=body.org_id)
    if pe is None:
        await pending_store.close()
        await snapshot_cache.close()
        raise HTTPException(status_code=404, detail="Pending edit not found.")
    deps = AtlasDeps(
        db=db_session,
        request=request,
        current_user=current_user,
        org_id=body.org_id,
        aichat_uuid=pe.aichat_uuid,
        session_token=body.session_token,
        pending_store=pending_store,
        snapshot_cache=snapshot_cache,
    )

    async def stream():
        try:
            async for event in apply_flow(pe, deps, confirmation_phrase=body.confirmation_phrase):
                yield serialize_event(event)
        finally:
            try:
                await pending_store.close()
                await snapshot_cache.close()
            except Exception:
                pass

    return EventSourceResponse(
        stream(),
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    )


@router.post(
    "/pending/{pending_id}/cancel",
    summary="Cancel a pending Atlas edit",
)
async def api_pending_cancel(
    pending_id: str,
    body: PendingCancelRequest,
    current_user: PublicUser = Depends(get_authenticated_non_api_token_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    await _ensure_org_access(current_user.id, body.org_id, db_session)
    pending_store = PendingStore()
    try:
        ok = await pending_store.cancel(pending_id, user_id=current_user.id)
        if not ok:
            raise HTTPException(status_code=404, detail="Pending edit not found.")
        return {"ok": True, "pending_id": pending_id}
    finally:
        await pending_store.close()


@router.post(
    "/pending/{pending_id}/refine",
    summary="Refine a pending Atlas edit",
    description=(
        "Re-runs the pipeline with ``instruction`` as a fresh user "
        "message, scoped to the same target as the existing pending. "
        "On success the prior pending is superseded and a new preview "
        "is emitted via the SSE stream."
    ),
)
async def api_pending_refine(
    request: Request,
    pending_id: str,
    body: PendingRefineRequest,
    current_user: PublicUser = Depends(get_authenticated_non_api_token_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    await _ensure_org_access(current_user.id, body.org_id, db_session)
    _validate_session_token(body.session_token)
    if not body.instruction or not body.instruction.strip():
        raise HTTPException(status_code=400, detail="instruction must be non-empty")

    pending_store = PendingStore()
    snapshot_cache = SnapshotCache()
    pe = await pending_store.get(pending_id, user_id=current_user.id, org_id=body.org_id)
    if pe is None:
        await pending_store.close()
        await snapshot_cache.close()
        raise HTTPException(status_code=404, detail="Pending edit not found.")

    refine_message = (
        f"Refine the pending edit on '{pe.target_resource.name}' "
        f"(originally: \"{pe.summary}\"). Refinement: {body.instruction.strip()}"
    )

    return EventSourceResponse(
        _chat_event_stream(
            request=request,
            db_session=db_session,
            current_user=current_user,
            org_id=body.org_id,
            session_token=body.session_token,
            aichat_uuid=pe.aichat_uuid,
            message=refine_message,
            page_context=body.page_context,
        ),
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/sessions", summary="List Atlas chat sessions")
async def api_atlas_sessions_list(
    org_id: int,
    current_user: PublicUser = Depends(get_authenticated_non_api_token_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    await _ensure_org_access(current_user.id, org_id, db_session)
    sessions = get_user_chat_sessions(current_user.id, org_id=org_id)
    atlas_sessions = [s for s in sessions if s.get("mode") == ATLAS_MODE]
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


@router.get("/sessions/{aichat_uuid}/messages", summary="Load Atlas session messages")
async def api_atlas_session_messages(
    aichat_uuid: str,
    current_user: PublicUser = Depends(get_authenticated_non_api_token_user),
):
    messages = get_chat_messages(aichat_uuid, current_user.id)
    if messages is None:
        raise HTTPException(status_code=404, detail="Chat session not found or not owned by this user.")
    return {"messages": messages}


@router.delete("/sessions/{aichat_uuid}", summary="Delete an Atlas chat session")
async def api_atlas_session_delete(
    aichat_uuid: str,
    current_user: PublicUser = Depends(get_authenticated_non_api_token_user),
):
    ok = delete_chat_session(aichat_uuid, current_user.id)
    if not ok:
        raise HTTPException(status_code=404, detail="Chat session not found or not owned by this user.")
    return {"status": "deleted"}


@router.patch("/sessions/{aichat_uuid}", summary="Rename or favorite an Atlas chat session")
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
        raise HTTPException(status_code=404, detail="Chat session not found or not owned by this user.")
    return {"session": updated}
