"""
RAG (Retrieval-Augmented Generation) API router.

Provides streaming chatbot grounded in course content and manual re-index trigger.
"""

import json
import logging
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlmodel import Session, select

from src.core.events.database import get_db_session
from src.db.courses.courses import Course
from src.db.organization_config import OrganizationConfig
from src.db.organizations import Organization
from src.db.users import PublicUser
from src.security.auth import get_current_user
from src.security.features_utils.usage import check_ai_credits, deduct_ai_credit
from src.security.org_auth import require_org_admin
from src.services.ai.base import (
    get_chat_session_history,
    save_message_to_history,
    generate_follow_up_suggestions,
    generate_chat_title,
    get_user_chat_sessions,
    get_chat_messages,
    delete_chat_session,
    update_chat_session_meta,
)
from src.services.ai.rag.embedding_service import embed_course_content
from src.services.ai.rag.query_service import query_course_rag_stream

logger = logging.getLogger(__name__)

router = APIRouter()


# ============================================================================
# Request/Response schemas
# ============================================================================


class RAGChatRequest(BaseModel):
    message: str
    course_uuid: Optional[str] = None
    aichat_uuid: Optional[str] = None
    mode: Literal["course_only", "general"] = "course_only"
    org_slug: Optional[str] = None


class RAGIndexRequest(BaseModel):
    course_uuid: str


class RAGIndexResponse(BaseModel):
    status: str
    chunks_indexed: int


# ============================================================================
# SSE Event Generator
# ============================================================================


async def rag_chat_event_generator(
    stream_generator,
    aichat_uuid: str,
    user_message: str,
    sources: list[dict],
    context_text: str,
    ai_model: str,
    user_id: Optional[int] = None,
    course_uuid: Optional[str] = None,
    is_new_session: bool = False,
    mode: str = "course_only",
    org_id: Optional[int] = None,
):
    """Convert async generator to SSE format with source references."""
    full_response = ""
    try:
        # Send start event
        yield f"data: {json.dumps({'type': 'start', 'aichat_uuid': aichat_uuid})}\n\n"

        async for chunk in stream_generator:
            full_response += chunk
            yield f"data: {json.dumps({'type': 'chunk', 'content': chunk})}\n\n"

        # Save the message exchange to history (including sources for persistence)
        save_message_to_history(aichat_uuid, user_message, full_response, user_id=user_id, course_uuid=course_uuid, sources=sources if sources else None, mode=mode, org_id=org_id)

        # Send sources event before done
        if sources:
            yield f"data: {json.dumps({'type': 'sources', 'sources': sources})}\n\n"

        # Send done event
        yield f"data: {json.dumps({'type': 'done', 'aichat_uuid': aichat_uuid})}\n\n"

        # Generate follow-up suggestions
        follow_ups = await generate_follow_up_suggestions(
            full_response,
            context_text[:1000],
            ai_model,
            user_message,
        )
        if follow_ups:
            yield f"data: {json.dumps({'type': 'follow_ups', 'follow_up_suggestions': follow_ups})}\n\n"

        # Generate AI-summarized title for new sessions
        if is_new_session and user_id is not None:
            title = generate_chat_title(user_message, full_response)
            update_chat_session_meta(aichat_uuid, user_id, title=title)
            yield f"data: {json.dumps({'type': 'session_title', 'title': title})}\n\n"

    except Exception:
        logger.exception("Error in rag_chat_event_generator")
        yield f"data: {json.dumps({'type': 'error', 'message': 'An internal error occurred while processing the AI chat request.'})}\n\n"


# ============================================================================
# Endpoints
# ============================================================================


@router.post("/rag/chat")
async def api_rag_chat(
    request: Request,
    chat_request: RAGChatRequest,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Streaming RAG chatbot (SSE).

    - If course_uuid is provided, searches within that course only.
    - If course_uuid is omitted, searches across all courses for the user's org.
    """
    course_id = None
    org_id = None

    if chat_request.course_uuid:
        # Resolve course
        course = db_session.exec(
            select(Course).where(Course.course_uuid == chat_request.course_uuid)
        ).first()
        if not course:
            raise HTTPException(status_code=404, detail="Course not found")
        course_id = course.id
        org_id = course.org_id
    else:
        # Cross-course mode: resolve org from org_slug if provided, else fall back to first membership
        if chat_request.org_slug:
            org = db_session.exec(
                select(Organization).where(Organization.slug == chat_request.org_slug)
            ).first()
            if not org:
                raise HTTPException(status_code=404, detail="Organization not found")
            org_id = org.id
        else:
            from src.db.user_organizations import UserOrganization
            user_org = db_session.exec(
                select(UserOrganization).where(
                    UserOrganization.user_id == current_user.id
                )
            ).first()
            if not user_org:
                raise HTTPException(status_code=403, detail="User has no organization")
            org_id = user_org.org_id

    # Check if copilot is enabled for this org
    org_config = db_session.exec(
        select(OrganizationConfig).where(OrganizationConfig.org_id == org_id)
    ).first()
    if org_config and org_config.config:
        from src.security.features_utils.resolve import resolve_feature
        resolved_ai = resolve_feature("ai", org_config.config, org_id)
        if not resolved_ai["enabled"]:
            raise HTTPException(status_code=403, detail="AI features are disabled for this organization")
        # Check copilot_enabled from admin toggles (v2) or features.ai (v1)
        config = org_config.config
        version = config.get("config_version", "1.0")
        if version.startswith("2"):
            copilot_enabled = config.get("admin_toggles", {}).get("ai", {}).get("copilot_enabled", True)
        else:
            copilot_enabled = config.get("features", {}).get("ai", {}).get("copilot_enabled", True)
        if not copilot_enabled:
            raise HTTPException(status_code=403, detail="Copilot is disabled for this organization")

    # Check AI credits
    check_ai_credits(org_id, db_session)
    deduct_ai_credit(org_id, db_session)

    # Get or create chat session
    is_new_session = chat_request.aichat_uuid is None
    chat_session = get_chat_session_history(chat_request.aichat_uuid)

    # Perform RAG query with streaming
    stream, sources = await query_course_rag_stream(
        question=chat_request.message,
        org_id=org_id,
        db_session=db_session,
        message_history=chat_session["message_history"],
        course_id=course_id,
        mode=chat_request.mode or "course_only",
    )

    return StreamingResponse(
        rag_chat_event_generator(
            stream,
            chat_session["aichat_uuid"],
            chat_request.message,
            sources,
            chat_request.message,  # context_text for follow-ups
            "gemini-2.5-flash",
            user_id=current_user.id,
            course_uuid=chat_request.course_uuid,
            is_new_session=is_new_session,
            mode=chat_request.mode,
            org_id=org_id,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/rag/index", response_model=RAGIndexResponse)
async def api_rag_index(
    request: Request,
    index_request: RAGIndexRequest,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Manually trigger re-indexing of a course's content for RAG.
    Requires admin/maintainer role on the course's organization.
    """
    # Resolve course
    course = db_session.exec(
        select(Course).where(Course.course_uuid == index_request.course_uuid)
    ).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    # Require admin/maintainer access
    require_org_admin(current_user.id, course.org_id, db_session)

    # Run indexing
    chunks_indexed = embed_course_content(
        course_id=course.id,
        org_id=course.org_id,
        db_session=db_session,
    )

    return RAGIndexResponse(
        status="success",
        chunks_indexed=chunks_indexed,
    )


# ============================================================================
# Session management endpoints
# ============================================================================


@router.get("/rag/sessions")
async def api_rag_sessions(
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
    org_slug: Optional[str] = None,
):
    """List all chat sessions for the current user, optionally filtered by org."""
    org_id = None
    if org_slug:
        org = db_session.exec(
            select(Organization).where(Organization.slug == org_slug)
        ).first()
        if org:
            org_id = org.id
    sessions = get_user_chat_sessions(current_user.id, org_id=org_id)
    return {"sessions": sessions}


@router.get("/rag/sessions/{aichat_uuid}/messages")
async def api_rag_session_messages(
    aichat_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
):
    """Load message history for a specific chat session."""
    messages = get_chat_messages(aichat_uuid, current_user.id)
    if messages is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"messages": messages}


@router.delete("/rag/sessions/{aichat_uuid}")
async def api_rag_session_delete(
    aichat_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
):
    """Delete a chat session."""
    deleted = delete_chat_session(aichat_uuid, current_user.id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"status": "deleted"}


class RAGSessionUpdateRequest(BaseModel):
    title: Optional[str] = None
    favorite: Optional[bool] = None


@router.patch("/rag/sessions/{aichat_uuid}")
async def api_rag_session_update(
    aichat_uuid: str,
    body: RAGSessionUpdateRequest,
    current_user: PublicUser = Depends(get_current_user),
):
    """Update session title and/or favorite status."""
    updated = update_chat_session_meta(
        aichat_uuid, current_user.id,
        title=body.title,
        favorite=body.favorite,
    )
    if updated is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"session": updated}
