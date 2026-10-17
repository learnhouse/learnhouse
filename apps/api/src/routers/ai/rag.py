"""
RAG (Retrieval-Augmented Generation) API router.

Provides streaming chatbot grounded in course content and manual re-index trigger.
"""

import json
import logging
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlmodel import select

from sqlmodel.ext.asyncio.session import AsyncSession
from src.core.events.database import get_db_session
from src.db.course_embeddings import CourseEmbedding
from src.db.courses.activities import Activity
from src.db.courses.blocks import Block
from src.db.courses.courses import Course
from src.db.organization_config import OrganizationConfig
from src.db.organizations import Organization
from src.db.users import PublicUser, AnonymousUser, APITokenUser
from src.security.auth import get_current_user, get_authenticated_user, resolve_acting_user_id
from src.security.features_utils.usage import reserve_ai_credit
from src.security.org_auth import is_org_member, require_org_admin, enforce_org_mfa
from src.services.ai.base import (
    get_chat_session_history,
    save_message_to_history,
    generate_follow_up_suggestions,
    generate_chat_title,
    get_user_chat_sessions,
    get_chat_messages,
    delete_chat_session,
    update_chat_session_meta,
    chat_session_belongs_to_user,
)
from src.services.ai.rag import pipeline
from src.services.ai.rag import queue as rag_queue
from src.services.ai.rag.access import RagAccessScope, build_rag_access_scope
from src.services.ai.rag.gating import ai_block_reason
from src.services.ai.rag.media import reset_unfinished_transcripts, status_of
from src.services.ai.rag.query_service import (
    query_course_rag_stream,
    search_course_content,
    source_from_row,
)
from src.services.ai.llm import model_for_tier
from src.services.ai.schemas.limits import AI_MESSAGE_MAX_CHARS

logger = logging.getLogger(__name__)

router = APIRouter()


# ============================================================================
# Request/Response schemas
# ============================================================================


class RAGChatRequest(BaseModel):
    message: str = Field(max_length=AI_MESSAGE_MAX_CHARS)
    course_uuid: Optional[str] = None
    aichat_uuid: Optional[str] = None
    mode: Literal["course_only", "general"] = "course_only"
    org_slug: Optional[str] = None


RAG_INDEX_MAX_PER_HOUR = 10


class RAGIndexRequest(BaseModel):
    course_uuid: str


class RAGIndexResponse(BaseModel):
    status: str
    chunks_indexed: int


class RAGSearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=2000)
    course_uuid: Optional[str] = None
    org_slug: Optional[str] = None
    limit: int = Field(default=8, ge=1, le=20)


class RAGSearchResponse(BaseModel):
    sources: list[dict]


class RAGActivityStatus(BaseModel):
    activity_uuid: str
    name: str
    activity_type: str
    chunks: int
    indexed_at: Optional[str] = None
    transcripts: list[dict] = []


class RAGStatusResponse(BaseModel):
    course_uuid: str
    course_chunks: int
    activities: list[RAGActivityStatus]


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
    from src.security.features_utils.usage import refund_ai_credit

    full_response = ""
    stream_failed = False
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
            title = await generate_chat_title(user_message, full_response)
            update_chat_session_meta(aichat_uuid, user_id, title=title)
            yield f"data: {json.dumps({'type': 'session_title', 'title': title})}\n\n"

    except Exception:
        stream_failed = True
        logger.exception("Error in rag_chat_event_generator")
        yield f"data: {json.dumps({'type': 'error', 'message': 'An internal error occurred while processing the AI chat request.'})}\n\n"
    finally:
        # Refund the 2 reserved credits if the stream produced nothing useful
        # (upstream error before any model output). Without this a flaky
        # embedding/generation call permanently drains the org's quota.
        if org_id is not None and (stream_failed or not full_response):
            try:
                refund_ai_credit(org_id, 2)
            except Exception:
                logger.debug("RAG AI credit refund failed", exc_info=True)


# ============================================================================
# Shared gate
# ============================================================================


async def _open_rag(
    request: Request,
    current_user: PublicUser | AnonymousUser | APITokenUser,
    course_uuid: Optional[str],
    org_slug: Optional[str],
    db_session: AsyncSession,
) -> tuple[int, RagAccessScope]:
    """Resolve the org and the courses the caller may retrieve from.

    Applies every gate a retrieval needs, in order: membership, MFA, the AI
    feature and copilot toggle, the rate limit, then course access. A named
    course the caller cannot read is a 403. Nothing is charged here.
    """
    course = None
    org_id = None

    if course_uuid:
        course = (await db_session.execute(
            select(Course).where(Course.course_uuid == course_uuid)
        )).scalars().first()
        if not course:
            raise HTTPException(status_code=404, detail="Course not found")
        org_id = course.org_id
    else:
        if org_slug:
            org = (await db_session.execute(
                select(Organization).where(Organization.slug == org_slug)
            )).scalars().first()
            if not org:
                raise HTTPException(status_code=404, detail="Organization not found")
            org_id = org.id
        else:
            from src.db.user_organizations import UserOrganization
            user_org = (await db_session.execute(
                select(UserOrganization).where(
                    UserOrganization.user_id == resolve_acting_user_id(current_user)
                )
            )).scalars().first()
            if not user_org:
                raise HTTPException(status_code=403, detail="User has no organization")
            org_id = user_org.org_id

    # SECURITY (F-5): before touching any org-scoped resource (including the
    # credit bucket), verify the authenticated user is actually a member of
    # the resolved org. Without this check, an attacker in org A can drain
    # org B's AI credits or run RAG against org B's indexed content by
    # supplying a course_uuid or org_slug from org B.
    if not await is_org_member(resolve_acting_user_id(current_user), org_id, db_session):
        raise HTTPException(
            status_code=403,
            detail="You are not a member of this organization",
        )
    # Org-wide two-factor policy, applied after the membership gate.
    await enforce_org_mfa(resolve_acting_user_id(current_user), org_id, db_session)

    # Check if AI and the copilot are enabled for this org
    org_config = (await db_session.execute(
        select(OrganizationConfig).where(OrganizationConfig.org_id == org_id)
    )).scalars().first()
    blocked = ai_block_reason(org_config.config if org_config else None, org_id)
    if blocked:
        raise HTTPException(status_code=403, detail=blocked)

    # F-9: per-user + per-org rate limit before any compute / credit spend.
    # Resolve API tokens to creator so rate-limit buckets per creator, not 0.
    from src.services.security.rate_limiting import enforce_ai_rate_limit
    enforce_ai_rate_limit(resolve_acting_user_id(current_user), org_id)

    # Only content the caller could open through the course/activity endpoints
    # may reach the model or the returned sources. A named course the caller
    # cannot read is a 403, before any credit is spent.
    access_scope = await build_rag_access_scope(
        request, current_user, org_id, db_session, course=course
    )
    return org_id, access_scope


# ============================================================================
# Endpoints
# ============================================================================


@router.post(
    "/rag/chat",
    summary="RAG chat (streaming)",
    description="Streaming RAG chatbot grounded in course content. If `course_uuid` is provided, searches within that course only. Otherwise searches across all courses for the user's organization. Responses are delivered as Server-Sent Events (SSE).",
    responses={
        200: {
            "description": "SSE stream of chat events (start, chunk, sources, done, follow_ups, session_title, error).",
            "content": {"text/event-stream": {}},
        },
        401: {"description": "Authentication required"},
        403: {"description": "AI features disabled, copilot disabled, or user has no organization"},
        404: {"description": "Course or organization not found"},
    },
)
async def api_rag_chat(
    request: Request,
    chat_request: RAGChatRequest,
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_authenticated_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    """
    Streaming RAG chatbot (SSE).

    - If course_uuid is provided, searches within that course only.
    - If course_uuid is omitted, searches across all courses for the user's org.
    """
    org_id, access_scope = await _open_rag(
        request, current_user, chat_request.course_uuid, chat_request.org_slug, db_session
    )
    chat_acting_user_id = resolve_acting_user_id(current_user)

    # Validate session ownership BEFORE reserving credits. Reserving first means
    # a request that targets someone else's session (or probes random UUIDs)
    # still raises 404 but silently burns the org's credits with no refund.
    is_new_session = chat_request.aichat_uuid is None
    if not is_new_session and not chat_session_belongs_to_user(
        chat_request.aichat_uuid, chat_acting_user_id
    ):
        raise HTTPException(status_code=404, detail="Chat session not found")

    # Atomic credit reservation: RAG chat makes 2 API calls (embedding + generation)
    await reserve_ai_credit(org_id, db_session, amount=2)

    # Get or create chat session
    chat_session = get_chat_session_history(chat_request.aichat_uuid)

    # Perform RAG query with streaming
    stream, sources = await query_course_rag_stream(
        question=chat_request.message,
        org_id=org_id,
        db_session=db_session,
        message_history=chat_session["message_history"],
        scope=access_scope,
        mode=chat_request.mode or "course_only",
    )

    return StreamingResponse(
        rag_chat_event_generator(
            stream,
            chat_session["aichat_uuid"],
            chat_request.message,
            sources,
            chat_request.message,  # context_text for follow-ups
            model_for_tier("fast"),
            user_id=chat_acting_user_id,
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


@router.post(
    "/rag/index",
    response_model=RAGIndexResponse,
    summary="Reindex course content for RAG",
    description="Manually trigger re-indexing (embedding) of a course's content for the RAG chatbot. Requires admin/maintainer role on the course's organization.",
    responses={
        200: {"description": "Course re-indexed successfully.", "model": RAGIndexResponse},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks admin/maintainer role on the organization"},
        404: {"description": "Course not found"},
    },
)
async def api_rag_index(
    request: Request,
    index_request: RAGIndexRequest,
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    """
    Manually trigger re-indexing of a course's content for RAG.
    Requires admin/maintainer role on the course's organization.
    """
    # Resolve course
    course = (await db_session.execute(
        select(Course).where(Course.course_uuid == index_request.course_uuid)
    )).scalars().first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    # Require admin/maintainer access
    await require_org_admin(resolve_acting_user_id(current_user), course.org_id, db_session)

    # A full reindex re-embeds every chunk (paid), so cap manual runs per org
    from src.services.security.rate_limiting import check_rate_limit
    is_allowed, _count, retry_after = check_rate_limit(
        key=f"rag_index:{course.org_id}",
        max_attempts=RAG_INDEX_MAX_PER_HOUR,
        window_seconds=60 * 60,
    )
    if not is_allowed:
        raise HTTPException(
            status_code=429,
            detail={
                "code": "RATE_LIMITED",
                "message": "Too many reindex requests. Please try again later.",
                "retry_after": retry_after,
            },
            headers={"Retry-After": str(retry_after)},
        )

    # Index the text now; transcription takes minutes, so media is retried
    # (including transcripts that failed or ran out of credits) in the
    # background, which indexes the course again when it finishes.
    chunks_indexed = await pipeline.run_course(course.id, transcribe=False)
    await reset_unfinished_transcripts(course.id, db_session)
    await rag_queue.enqueue_course(course.id, db_session, delay=0, transcribe=True)

    return RAGIndexResponse(
        status="success",
        chunks_indexed=chunks_indexed,
    )


@router.post(
    "/rag/search",
    response_model=RAGSearchResponse,
    summary="Search course content",
    description="Semantic search over the course content the caller can read: pages, documents, video and audio transcripts, assignments and course descriptions. Returns ranked sources with a snippet and, where available, the page or timestamp. Searches one course when `course_uuid` is given, otherwise every readable course in the organization.",
    responses={
        200: {"description": "Ranked sources.", "model": RAGSearchResponse},
        401: {"description": "Authentication required"},
        403: {"description": "AI features disabled, copilot disabled, or no access to the course"},
        404: {"description": "Course or organization not found"},
        429: {"description": "AI rate limit exceeded"},
    },
)
async def api_rag_search(
    request: Request,
    search_request: RAGSearchRequest,
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_authenticated_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    org_id, access_scope = await _open_rag(
        request, current_user, search_request.course_uuid, search_request.org_slug, db_session
    )
    if not access_scope.course_ids:
        return RAGSearchResponse(sources=[])

    # One embedding call for the query.
    await reserve_ai_credit(org_id, db_session, amount=1)
    try:
        rows = await search_course_content(
            search_request.query, org_id, db_session, access_scope, top_k=search_request.limit
        )
    except Exception:
        from src.security.features_utils.usage import refund_ai_credit

        refund_ai_credit(org_id, 1)
        raise
    return RAGSearchResponse(sources=[source_from_row(row).to_dict() for row in rows])


@router.get(
    "/rag/status",
    response_model=RAGStatusResponse,
    summary="Course indexing status",
    description="How much of each activity is indexed for AI search, and the transcription status of its media. Requires admin/maintainer role on the course's organization.",
    responses={
        200: {"description": "Per-activity index status.", "model": RAGStatusResponse},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks admin/maintainer role on the organization"},
        404: {"description": "Course not found"},
    },
)
async def api_rag_status(
    course_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    course = (await db_session.execute(
        select(Course).where(Course.course_uuid == course_uuid)
    )).scalars().first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    await require_org_admin(resolve_acting_user_id(current_user), course.org_id, db_session)

    counts = {
        activity_id: (chunks, indexed_at)
        for activity_id, chunks, indexed_at in (await db_session.execute(
            select(CourseEmbedding.activity_id, func.count(), func.max(CourseEmbedding.update_date))
            .where(CourseEmbedding.course_id == course.id)
            .group_by(CourseEmbedding.activity_id)
        )).all()
    }
    activities = (await db_session.execute(
        select(Activity).where(Activity.course_id == course.id).order_by(Activity.id)
    )).scalars().all()
    blocks = (await db_session.execute(
        select(Block).where(Block.course_id == course.id)
    )).scalars().all()
    block_transcripts: dict[int, list[dict]] = {}
    for block in blocks:
        transcript = status_of(block.content)
        if transcript:
            block_transcripts.setdefault(block.activity_id, []).append(
                {**transcript, "block_uuid": block.block_uuid}
            )

    return RAGStatusResponse(
        course_uuid=course.course_uuid,
        course_chunks=counts.get(None, (0, None))[0],
        activities=[
            RAGActivityStatus(
                activity_uuid=activity.activity_uuid,
                name=activity.name,
                activity_type=activity.activity_type,
                chunks=counts.get(activity.id, (0, None))[0],
                indexed_at=counts.get(activity.id, (0, None))[1],
                transcripts=[
                    t for t in [status_of(activity.extra_metadata)] if t
                ] + block_transcripts.get(activity.id, []),
            )
            for activity in activities
        ],
    )


# ============================================================================
# Session management endpoints
# ============================================================================


@router.get(
    "/rag/sessions",
    summary="List RAG chat sessions",
    description="List all RAG chat sessions owned by the current user, optionally filtered by organization via `org_slug`.",
    responses={
        200: {"description": "Object containing the list of chat sessions for the current user."},
        401: {"description": "Authentication required"},
    },
)
async def api_rag_sessions(
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
    org_slug: Optional[str] = None,
):
    """List all chat sessions for the current user, optionally filtered by org."""
    org_id = None
    if org_slug:
        org = (await db_session.execute(
            select(Organization).where(Organization.slug == org_slug)
        )).scalars().first()
        if org:
            org_id = org.id
    sessions = get_user_chat_sessions(resolve_acting_user_id(current_user), org_id=org_id)
    return {"sessions": sessions}


@router.get(
    "/rag/sessions/{aichat_uuid}/messages",
    summary="Get RAG chat session messages",
    description="Load the full message history for a specific RAG chat session owned by the current user.",
    responses={
        200: {"description": "Object containing the session's messages."},
        401: {"description": "Authentication required"},
        404: {"description": "Session not found"},
    },
)
async def api_rag_session_messages(
    aichat_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
):
    """Load message history for a specific chat session."""
    messages = get_chat_messages(aichat_uuid, resolve_acting_user_id(current_user))
    if messages is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"messages": messages}


@router.delete(
    "/rag/sessions/{aichat_uuid}",
    summary="Delete a RAG chat session",
    description="Delete a RAG chat session and all its messages. The session must belong to the current user.",
    responses={
        200: {"description": "Session deleted successfully."},
        401: {"description": "Authentication required"},
        404: {"description": "Session not found"},
    },
)
async def api_rag_session_delete(
    aichat_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
):
    """Delete a chat session."""
    deleted = delete_chat_session(aichat_uuid, resolve_acting_user_id(current_user))
    if not deleted:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"status": "deleted"}


class RAGSessionUpdateRequest(BaseModel):
    title: Optional[str] = None
    favorite: Optional[bool] = None


@router.patch(
    "/rag/sessions/{aichat_uuid}",
    summary="Update a RAG chat session",
    description="Update a RAG chat session's title and/or favorite status. The session must belong to the current user.",
    responses={
        200: {"description": "Session updated successfully."},
        401: {"description": "Authentication required"},
        404: {"description": "Session not found"},
    },
)
async def api_rag_session_update(
    aichat_uuid: str,
    body: RAGSessionUpdateRequest,
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
):
    """Update session title and/or favorite status."""
    updated = update_chat_session_meta(
        aichat_uuid, resolve_acting_user_id(current_user),
        title=body.title,
        favorite=body.favorite,
    )
    if updated is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"session": updated}
