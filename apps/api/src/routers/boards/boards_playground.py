from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select
import json
import logging

from src.db.organizations import Organization
from src.db.boards import Board
from src.core.events.database import get_db_session
from src.db.users import PublicUser
from src.security.auth import get_current_user, get_authenticated_user
from src.security.features_utils.usage import (
    reserve_ai_credit,
)
from src.security.features_utils.plan_check import get_org_plan
from src.security.features_utils.plans import plan_meets_requirement
from src.services.boards.boards_playground import (
    get_boards_playground_session,
    create_boards_playground_session,
    generate_boards_playground_stream,
    MAX_ITERATIONS,
)
from src.services.boards.schemas.boards_playground import (
    StartBoardsPlaygroundSession,
    SendBoardsPlaygroundMessage,
    BoardsPlaygroundSessionResponse,
    BoardsPlaygroundMessage,
)


router = APIRouter()


async def event_generator(generator, session_uuid: str):
    """Convert async generator to SSE format"""
    try:
        async for chunk in generator:
            yield f"data: {json.dumps({'type': 'chunk', 'content': chunk})}\n\n"
        yield f"data: {json.dumps({'type': 'done', 'session_uuid': session_uuid})}\n\n"
    except Exception:
        logging.exception("Error in boards playground event stream for session %s", session_uuid)
        yield f"data: {json.dumps({'type': 'error', 'message': 'An internal error occurred.'})}\n\n"


def get_org_ai_model(org_id: int, db_session: Session) -> str:
    try:
        current_plan = get_org_plan(org_id, db_session)
        if plan_meets_requirement(current_plan, "pro"):
            return "gemini-3-flash-preview"
        return "gemini-2.5-flash-lite"
    except Exception:
        return "gemini-2.5-flash-lite"


@router.post(
    "/playground/start",
    summary="Start a boards playground AI session",
    description="Start a new Boards Playground AI generation session with a server-sent events stream. Deducts AI credits and requires a valid board and organization.",
    responses={
        200: {"description": "Server-sent events stream of generated playground content.", "content": {"text/event-stream": {}}},
        401: {"description": "Authentication required"},
        404: {"description": "Board or organization not found"},
    },
)
async def start_boards_playground_session(
    request: Request,
    session_request: StartBoardsPlaygroundSession,
    current_user: PublicUser = Depends(get_authenticated_user),
    db_session: Session = Depends(get_db_session),
):
    """Start a new Boards Playground AI generation session with streaming response."""
    # Validate board exists
    statement = select(Board).where(
        Board.board_uuid == session_request.board_uuid
    )
    board = db_session.exec(statement).first()
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")

    # Get the organization
    statement = select(Organization).where(Organization.id == board.org_id)
    org = db_session.exec(statement).first()
    if not org or org.id is None:
        raise HTTPException(status_code=404, detail="Organization not found")

    reserve_ai_credit(org.id, db_session, amount=3)

    # Get AI model
    ai_model = get_org_ai_model(org.id, db_session)

    # Create new session
    session = create_boards_playground_session(
        block_uuid=session_request.block_uuid,
        board_uuid=session_request.board_uuid,
        context=session_request.context,
    )

    # Generate with streaming
    stream = generate_boards_playground_stream(
        prompt=session_request.prompt,
        session=session,
        gemini_model_name=ai_model,
    )

    return StreamingResponse(
        event_generator(stream, session.session_uuid),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post(
    "/playground/iterate",
    summary="Iterate on a boards playground AI session",
    description="Continue an existing Boards Playground session with a new message, streaming the updated output. Deducts AI credits and enforces the session's iteration limit.",
    responses={
        200: {"description": "Server-sent events stream of generated playground content.", "content": {"text/event-stream": {}}},
        400: {"description": "Maximum iterations reached, or board/block UUID mismatch"},
        401: {"description": "Authentication required"},
        404: {"description": "Session, board, or organization not found"},
    },
)
async def iterate_boards_playground_session(
    request: Request,
    message_request: SendBoardsPlaygroundMessage,
    current_user: PublicUser = Depends(get_authenticated_user),
    db_session: Session = Depends(get_db_session),
):
    """Continue an existing Boards Playground session with a new message."""
    session = get_boards_playground_session(message_request.session_uuid)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if session.iteration_count >= session.max_iterations:
        raise HTTPException(
            status_code=400,
            detail=f"Maximum iterations ({MAX_ITERATIONS}) reached",
        )

    if session.board_uuid != message_request.board_uuid:
        raise HTTPException(status_code=400, detail="Board UUID mismatch")
    if session.block_uuid != message_request.block_uuid:
        raise HTTPException(status_code=400, detail="Block UUID mismatch")

    # Get the board for org lookup
    statement = select(Board).where(
        Board.board_uuid == message_request.board_uuid
    )
    board = db_session.exec(statement).first()
    if not board:
        raise HTTPException(status_code=404, detail="Board not found")

    statement = select(Organization).where(Organization.id == board.org_id)
    org = db_session.exec(statement).first()
    if not org or org.id is None:
        raise HTTPException(status_code=404, detail="Organization not found")

    reserve_ai_credit(org.id, db_session, amount=3)

    ai_model = get_org_ai_model(org.id, db_session)

    html_to_iterate = message_request.current_html or session.current_html

    stream = generate_boards_playground_stream(
        prompt=message_request.message,
        session=session,
        gemini_model_name=ai_model,
        current_html=html_to_iterate,
    )

    return StreamingResponse(
        event_generator(stream, session.session_uuid),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get(
    "/playground/session/{session_uuid}",
    response_model=BoardsPlaygroundSessionResponse,
    summary="Get boards playground session state",
    description="Retrieve the current state of a Boards Playground generation session, including iteration count, current HTML, and message history.",
    responses={
        200: {"description": "Current state of the boards playground session.", "model": BoardsPlaygroundSessionResponse},
        401: {"description": "Authentication required"},
        404: {"description": "Session not found"},
    },
)
async def get_session_state(
    session_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> BoardsPlaygroundSessionResponse:
    """Get the current state of a Boards Playground session."""
    session = get_boards_playground_session(session_uuid)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    return BoardsPlaygroundSessionResponse(
        session_uuid=session.session_uuid,
        iteration_count=session.iteration_count,
        max_iterations=session.max_iterations,
        html_content=session.current_html,
        message_history=[
            BoardsPlaygroundMessage(role=msg.role, content=msg.content)
            for msg in session.message_history
        ],
    )
