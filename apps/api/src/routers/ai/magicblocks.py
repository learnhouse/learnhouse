from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select
import json

from src.db.organizations import Organization
from src.db.courses.courses import Course
from src.db.courses.activities import Activity
from src.core.events.database import get_db_session
from src.db.users import PublicUser
from src.security.auth import get_current_user, get_authenticated_user
from src.security.features_utils.usage import (
    reserve_ai_credit,
)
from src.security.features_utils.plan_check import get_org_plan
from src.security.features_utils.plans import plan_meets_requirement
from src.services.ai.magicblocks import (
    get_magicblock_session,
    create_magicblock_session,
    generate_magicblock_stream,
    MAX_ITERATIONS,
)
from src.services.ai.schemas.magicblocks import (
    StartMagicBlockSession,
    SendMagicBlockMessage,
    MagicBlockSessionResponse,
    MagicBlockMessage,
)


router = APIRouter()


async def event_generator(generator, session_uuid: str):
    """Convert async generator to SSE format"""
    try:
        async for chunk in generator:
            # Send each chunk as an SSE data event
            yield f"data: {json.dumps({'type': 'chunk', 'content': chunk})}\n\n"

        # Send completion event
        yield f"data: {json.dumps({'type': 'done', 'session_uuid': session_uuid})}\n\n"
    except Exception as e:
        yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"


def get_org_ai_model(org_id: int, db_session: Session) -> str:
    """
    Get the AI model for MagicBlocks based on the organization's plan.

    - Standard plan (or lower): gemini-2.5-flash-lite
    - Pro plan or higher: gemini-3-flash-preview
    """
    try:
        current_plan = get_org_plan(org_id, db_session)

        # Pro or Enterprise plans get the better model
        if plan_meets_requirement(current_plan, "pro"):
            return "gemini-3-flash-preview"

        # Standard and free plans get the lite model
        return "gemini-2.5-flash-lite"
    except Exception:
        # Fallback to lite model if plan check fails
        return "gemini-2.5-flash-lite"


@router.post(
    "/magicblocks/start",
    summary="Start MagicBlock session (streaming)",
    description="Start a new MagicBlock AI generation session for an activity block. Streams generated HTML as Server-Sent Events (SSE). Consumes AI credits from the owning organization.",
    responses={
        200: {
            "description": "SSE stream of generation events (chunk, done, error).",
            "content": {"text/event-stream": {}},
        },
        401: {"description": "Authentication required"},
        403: {"description": "AI feature disabled or insufficient credits"},
        404: {"description": "Activity, course, or organization not found"},
    },
)
async def start_magicblock_session(
    request: Request,
    session_request: StartMagicBlockSession,
    current_user: PublicUser = Depends(get_authenticated_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Start a new MagicBlock AI generation session with streaming response.
    Returns Server-Sent Events (SSE) stream.
    """
    # Validate activity exists
    statement = select(Activity).where(
        Activity.activity_uuid == session_request.activity_uuid
    )
    activity = db_session.exec(statement).first()

    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")

    # Get the course
    statement = (
        select(Course)
        .join(Activity)
        .where(Activity.activity_uuid == session_request.activity_uuid)
    )
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    # Get the organization
    statement = select(Organization).where(Organization.id == course.org_id)
    org = db_session.exec(statement).first()

    if not org or org.id is None:
        raise HTTPException(status_code=404, detail="Organization not found")

    # Atomically check + deduct AI credits to prevent concurrent-request overdraw.
    reserve_ai_credit(org.id, db_session, amount=3)

    # Get AI model
    ai_model = get_org_ai_model(org.id, db_session)

    # Create new session
    session = create_magicblock_session(
        block_uuid=session_request.block_uuid,
        activity_uuid=session_request.activity_uuid,
        context=session_request.context
    )

    # Generate with streaming
    stream = generate_magicblock_stream(
        prompt=session_request.prompt,
        session=session,
        gemini_model_name=ai_model
    )

    return StreamingResponse(
        event_generator(stream, session.session_uuid),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


@router.post(
    "/magicblocks/iterate",
    summary="Iterate MagicBlock session (streaming)",
    description="Continue an existing MagicBlock session with a new user message. Streams the updated HTML as Server-Sent Events (SSE). Consumes AI credits and is bounded by the session's max iterations.",
    responses={
        200: {
            "description": "SSE stream of generation events (chunk, done, error).",
            "content": {"text/event-stream": {}},
        },
        400: {"description": "Maximum iterations reached or activity/block UUID mismatch"},
        401: {"description": "Authentication required"},
        403: {"description": "AI feature disabled or insufficient credits"},
        404: {"description": "Session, course, or organization not found"},
    },
)
async def iterate_magicblock_session(
    request: Request,
    message_request: SendMagicBlockMessage,
    current_user: PublicUser = Depends(get_authenticated_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Continue an existing MagicBlock session with a new message.
    Returns Server-Sent Events (SSE) stream.
    """
    # Get existing session
    session = get_magicblock_session(message_request.session_uuid)

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Check iteration limit
    if session.iteration_count >= session.max_iterations:
        raise HTTPException(
            status_code=400,
            detail=f"Maximum iterations ({MAX_ITERATIONS}) reached"
        )

    # Validate activity matches
    if session.activity_uuid != message_request.activity_uuid:
        raise HTTPException(status_code=400, detail="Activity UUID mismatch")

    # Validate block matches
    if session.block_uuid != message_request.block_uuid:
        raise HTTPException(status_code=400, detail="Block UUID mismatch")

    # Get the course for org lookup
    statement = (
        select(Course)
        .join(Activity)
        .where(Activity.activity_uuid == message_request.activity_uuid)
    )
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    # Get the organization
    statement = select(Organization).where(Organization.id == course.org_id)
    org = db_session.exec(statement).first()

    if not org or org.id is None:
        raise HTTPException(status_code=404, detail="Organization not found")

    # Atomically check + deduct AI credits to prevent concurrent-request overdraw.
    reserve_ai_credit(org.id, db_session, amount=3)

    # Get AI model
    ai_model = get_org_ai_model(org.id, db_session)

    # Use client-provided HTML or fall back to session's current_html
    html_to_iterate = message_request.current_html or session.current_html

    # Generate with streaming
    stream = generate_magicblock_stream(
        prompt=message_request.message,
        session=session,
        gemini_model_name=ai_model,
        current_html=html_to_iterate
    )

    return StreamingResponse(
        event_generator(stream, session.session_uuid),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


@router.get(
    "/magicblocks/session/{session_uuid}",
    response_model=MagicBlockSessionResponse,
    summary="Get MagicBlock session state",
    description="Return the current state of a MagicBlock session, including iteration count, generated HTML, and full message history.",
    responses={
        200: {"description": "MagicBlock session state.", "model": MagicBlockSessionResponse},
        401: {"description": "Authentication required"},
        404: {"description": "Session not found"},
    },
)
async def get_session_state(
    session_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> MagicBlockSessionResponse:
    """
    Get the current state of a MagicBlock session.
    """
    session = get_magicblock_session(session_uuid)

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    return MagicBlockSessionResponse(
        session_uuid=session.session_uuid,
        iteration_count=session.iteration_count,
        max_iterations=session.max_iterations,
        html_content=session.current_html,
        message_history=[
            MagicBlockMessage(role=msg.role, content=msg.content)
            for msg in session.message_history
        ]
    )
