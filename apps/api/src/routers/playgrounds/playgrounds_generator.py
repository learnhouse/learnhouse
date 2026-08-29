from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession
import asyncio
import json
import logging

from src.db.organizations import Organization
from src.db.playgrounds import Playground
from src.db.courses.courses import Course
from src.core.events.database import get_db_session
from src.db.users import PublicUser, AnonymousUser, APITokenUser
from src.security.auth import get_current_user, resolve_acting_user_id
from src.security.features_utils.usage import refund_ai_credit, reserve_ai_credit
from src.security.features_utils.dependencies import require_playgrounds_feature
from src.services.ai.llm import (
    AI_QUOTA_USER_MESSAGE,
    AIQuotaExhaustedError,
    model_for_tier,
)
from src.services.playgrounds.playgrounds_generator import (
    get_playground_session,
    create_playground_session,
    generate_playground_stream,
    MAX_ITERATIONS,
)
from src.services.playgrounds.schemas.playgrounds_generator import (
    StartPlaygroundSession,
    SendPlaygroundMessage,
    PlaygroundSessionResponse,
    PlaygroundMessage,
)

router = APIRouter(dependencies=[Depends(require_playgrounds_feature)])

# Credits reserved per generation turn, refunded when the stream produces nothing.
GENERATION_CREDIT_COST = 3


async def event_generator(
    generator,
    session_uuid: str,
    org_id: Optional[int] = None,
    credit_cost: int = GENERATION_CREDIT_COST,
):
    """Convert async generator to SSE format.

    Refunds the credits reserved by the caller when the stream produced no
    output — a provider outage must not silently bill the org for nothing.
    Mirrors ``editor_chat_event_generator`` in ``src/routers/ai/ai.py``.
    """
    produced_output = False
    stream_failed = False
    try:
        async for chunk in generator:
            produced_output = True
            yield f"data: {json.dumps({'type': 'chunk', 'content': chunk})}\n\n"
        yield f"data: {json.dumps({'type': 'done', 'session_uuid': session_uuid})}\n\n"
    except asyncio.CancelledError:
        # Client disconnect. Do NOT force a refund: if the model already produced
        # output the credits were legitimately spent. The finally block still
        # refunds when nothing was produced, so a disconnect after a full
        # response can't be abused for free AI. Re-raise so Starlette sees it.
        raise
    except AIQuotaExhaustedError:
        stream_failed = True
        # Not a server fault — a billing state an admin can fix. WARNING keeps it
        # out of Sentry, and the typed code lets the UI say something useful
        # instead of "an internal error occurred".
        logging.warning(
            "Playground generation unavailable for session %s: provider quota exhausted",
            session_uuid,
        )
        yield f"data: {json.dumps({'type': 'error', 'code': 'ai_quota_exhausted', 'message': AI_QUOTA_USER_MESSAGE})}\n\n"
    except Exception:
        stream_failed = True
        logging.exception("Error in playground event stream for session %s", session_uuid)
        yield f"data: {json.dumps({'type': 'error', 'message': 'An internal error occurred.'})}\n\n"
    finally:
        if org_id is not None and (stream_failed or not produced_output):
            try:
                refund_ai_credit(org_id, credit_cost)
            except Exception:
                logging.debug("AI credit refund failed", exc_info=True)


async def get_org_ai_model(org_id: int, db_session: AsyncSession) -> str:
    return model_for_tier("fast")  # interactive widgets: fast + concise (gemini-3.1-flash-lite)


async def _get_course_context(
    course_uuid: Optional[str],
    org_id: int,
    db_session: AsyncSession,
    prompt: str,
) -> tuple[Optional[str], Optional[int]]:
    """Return (course_context_str, course_id) or (None, None) if no course."""
    if not course_uuid:
        return None, None

    course = (await db_session.execute(
        select(Course).where(Course.course_uuid == course_uuid)
    )).scalars().first()
    if not course or course.org_id != org_id:
        return None, None

    try:
        from src.services.ai.rag.query_service import query_course_rag
        rag_result = await query_course_rag(
            question=prompt,
            org_id=org_id,
            db_session=db_session,
            course_id=course.id,
        )
        return rag_result.get("context") or None, course.id
    except Exception as e:
        logging.warning("Failed to fetch RAG context for playground: %s", e)
        return None, course.id


@router.post(
    "/generate/start",
    summary="Start a playground generation session",
    description="Start a new Playground AI generation session with a server-sent events stream. Deducts AI credits and requires update permission on the target playground.",
    responses={
        200: {"description": "Server-sent events stream of generated playground content.", "content": {"text/event-stream": {}}},
        401: {"description": "Authentication required"},
        403: {"description": "Insufficient permissions to generate content"},
        404: {"description": "Playground or organization not found"},
    },
)
async def start_playground_session(
    request: Request,
    session_request: StartPlaygroundSession,
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    """Start a new Playground AI generation session with streaming response."""
    playground = (await db_session.execute(
        select(Playground).where(Playground.playground_uuid == session_request.playground_uuid)
    )).scalars().first()
    if not playground:
        raise HTTPException(status_code=404, detail="Playground not found")

    org = (await db_session.execute(
        select(Organization).where(Organization.id == playground.org_id)
    )).scalars().first()
    if not org or org.id is None:
        raise HTTPException(status_code=404, detail="Organization not found")

    # Enforce API-token org scope: a token is bound to a single org and must not
    # be usable to drive (and bill) AI generation against another org's playground.
    if isinstance(current_user, APITokenUser) and current_user.org_id != playground.org_id:
        raise HTTPException(status_code=403, detail="Insufficient permissions to generate content")

    # Verify user can edit (must be creator or have update rights)
    generate_acting_user_id = resolve_acting_user_id(current_user)
    from src.services.playgrounds.playgrounds import _get_user_rights
    rights = await _get_user_rights(generate_acting_user_id, playground.org_id, db_session)
    pg_rights = rights.get("playgrounds", {})
    is_owner = playground.created_by == generate_acting_user_id
    can_edit = pg_rights.get("action_update", False) or (
        is_owner and pg_rights.get("action_update_own", False)
    )
    if not can_edit:
        raise HTTPException(status_code=403, detail="Insufficient permissions to generate content")

    # F-9: per-user + per-org rate limit before any compute / credit spend.
    from src.services.security.rate_limiting import enforce_ai_rate_limit
    enforce_ai_rate_limit(generate_acting_user_id, org.id)
    await reserve_ai_credit(org.id, db_session, amount=GENERATION_CREDIT_COST)

    ai_model = await get_org_ai_model(org.id, db_session)

    # Fetch RAG context if course linked
    course_context, _ = await _get_course_context(
        session_request.context.course_uuid,
        org.id,
        db_session,
        session_request.prompt,
    )

    session = create_playground_session(
        playground_uuid=session_request.playground_uuid,
        context=session_request.context,
    )

    stream = generate_playground_stream(
        prompt=session_request.prompt,
        session=session,
        model_name=ai_model,
        current_html=playground.html_content or None,
        course_context=course_context,
    )

    return StreamingResponse(
        event_generator(stream, session.session_uuid, org_id=org.id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post(
    "/generate/iterate",
    summary="Iterate on a playground generation session",
    description="Continue an existing Playground session with a new message, streaming the updated output. Deducts AI credits and enforces the session's iteration limit.",
    responses={
        200: {"description": "Server-sent events stream of generated playground content.", "content": {"text/event-stream": {}}},
        400: {"description": "Maximum iterations reached or playground UUID mismatch"},
        401: {"description": "Authentication required"},
        403: {"description": "Insufficient permissions"},
        404: {"description": "Session, playground, or organization not found"},
    },
)
async def iterate_playground_session(
    request: Request,
    message_request: SendPlaygroundMessage,
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
):
    """Continue an existing Playground session with a new message."""
    session = get_playground_session(message_request.session_uuid)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if session.iteration_count >= session.max_iterations:
        raise HTTPException(
            status_code=400,
            detail=f"Maximum iterations ({MAX_ITERATIONS}) reached",
        )

    if session.playground_uuid != message_request.playground_uuid:
        raise HTTPException(status_code=400, detail="Playground UUID mismatch")

    playground = (await db_session.execute(
        select(Playground).where(Playground.playground_uuid == message_request.playground_uuid)
    )).scalars().first()
    if not playground:
        raise HTTPException(status_code=404, detail="Playground not found")

    org = (await db_session.execute(
        select(Organization).where(Organization.id == playground.org_id)
    )).scalars().first()
    if not org or org.id is None:
        raise HTTPException(status_code=404, detail="Organization not found")

    # Enforce API-token org scope: a token is bound to a single org and must not
    # be usable to drive (and bill) AI generation against another org's playground.
    if isinstance(current_user, APITokenUser) and current_user.org_id != playground.org_id:
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    # Verify user can edit
    iterate_acting_user_id = resolve_acting_user_id(current_user)
    from src.services.playgrounds.playgrounds import _get_user_rights
    rights = await _get_user_rights(iterate_acting_user_id, playground.org_id, db_session)
    pg_rights = rights.get("playgrounds", {})
    is_owner = playground.created_by == iterate_acting_user_id
    can_edit = pg_rights.get("action_update", False) or (
        is_owner and pg_rights.get("action_update_own", False)
    )
    if not can_edit:
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    # F-9: per-user + per-org rate limit before any compute / credit spend.
    from src.services.security.rate_limiting import enforce_ai_rate_limit
    enforce_ai_rate_limit(iterate_acting_user_id, org.id)
    await reserve_ai_credit(org.id, db_session, amount=GENERATION_CREDIT_COST)

    ai_model = await get_org_ai_model(org.id, db_session)

    # Fetch RAG context if course linked
    course_context, _ = await _get_course_context(
        session.context.course_uuid,
        org.id,
        db_session,
        message_request.message,
    )

    html_to_iterate = message_request.current_html or session.current_html

    stream = generate_playground_stream(
        prompt=message_request.message,
        session=session,
        model_name=ai_model,
        current_html=html_to_iterate,
        course_context=course_context,
    )

    return StreamingResponse(
        event_generator(stream, session.session_uuid, org_id=org.id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get(
    "/generate/session/{session_uuid}",
    response_model=PlaygroundSessionResponse,
    summary="Get playground generation session state",
    description="Retrieve the current state of a Playground generation session, including iteration count, current HTML, and message history.",
    responses={
        200: {"description": "Current state of the playground generation session.", "model": PlaygroundSessionResponse},
        401: {"description": "Authentication required"},
        404: {"description": "Session not found"},
    },
)
async def get_session_state(
    session_uuid: str,
    current_user: PublicUser | AnonymousUser | APITokenUser = Depends(get_current_user),
    db_session: AsyncSession = Depends(get_db_session),
) -> PlaygroundSessionResponse:
    """Get the current state of a Playground session."""
    session = get_playground_session(session_uuid)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Authorize: a session exposes generated HTML + full message history, so the
    # caller must have edit rights on the underlying playground. Without this
    # check any authenticated user could read another org's session content by
    # its uuid (cross-tenant IDOR), while /generate/start and /generate/iterate
    # both enforce the same check.
    playground = (await db_session.execute(
        select(Playground).where(Playground.playground_uuid == session.playground_uuid)
    )).scalars().first()
    if not playground:
        raise HTTPException(status_code=404, detail="Playground not found")

    state_acting_user_id = resolve_acting_user_id(current_user)
    from src.services.playgrounds.playgrounds import _get_user_rights
    rights = await _get_user_rights(state_acting_user_id, playground.org_id, db_session)
    pg_rights = rights.get("playgrounds", {})
    is_owner = playground.created_by == state_acting_user_id
    can_edit = pg_rights.get("action_update", False) or (
        is_owner and pg_rights.get("action_update_own", False)
    )
    if not can_edit:
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    return PlaygroundSessionResponse(
        session_uuid=session.session_uuid,
        iteration_count=session.iteration_count,
        max_iterations=session.max_iterations,
        html_content=session.current_html,
        message_history=[
            PlaygroundMessage(role=msg.role, content=msg.content)
            for msg in session.message_history
        ],
    )
