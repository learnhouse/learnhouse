from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select
import json
import logging

from src.db.organizations import Organization
from src.db.playgrounds import Playground
from src.db.courses.courses import Course
from src.core.events.database import get_db_session
from src.db.users import PublicUser
from src.security.auth import get_current_user
from src.security.features_utils.usage import check_ai_credits, deduct_ai_credit
from src.security.features_utils.plan_check import get_org_plan
from src.security.features_utils.plans import plan_meets_requirement
from src.security.features_utils.dependencies import require_playgrounds_feature
from src.services.playgrounds.playgrounds_generator import (
    get_playground_session,
    create_playground_session,
    generate_playground_stream,
    save_playground_session,
    MAX_ITERATIONS,
)
from src.services.playgrounds.schemas.playgrounds_generator import (
    StartPlaygroundSession,
    SendPlaygroundMessage,
    PlaygroundSessionResponse,
    PlaygroundMessage,
)

router = APIRouter(dependencies=[Depends(require_playgrounds_feature)])


async def event_generator(generator, session_uuid: str):
    """Convert async generator to SSE format."""
    try:
        async for chunk in generator:
            yield f"data: {json.dumps({'type': 'chunk', 'content': chunk})}\n\n"
        yield f"data: {json.dumps({'type': 'done', 'session_uuid': session_uuid})}\n\n"
    except Exception:
        logging.exception("Error in playground event stream for session %s", session_uuid)
        yield f"data: {json.dumps({'type': 'error', 'message': 'An internal error occurred.'})}\n\n"


def get_org_ai_model(org_id: int, db_session: Session) -> str:
    try:
        current_plan = get_org_plan(org_id, db_session)
        if plan_meets_requirement(current_plan, "pro"):
            return "gemini-3-flash-preview"
        return "gemini-2.5-flash-lite"
    except Exception:
        return "gemini-2.5-flash-lite"


def _get_course_context(
    course_uuid: Optional[str],
    org_id: int,
    db_session: Session,
    prompt: str,
) -> tuple[Optional[str], Optional[int]]:
    """Return (course_context_str, course_id) or (None, None) if no course."""
    if not course_uuid:
        return None, None

    course = db_session.exec(
        select(Course).where(Course.course_uuid == course_uuid)
    ).first()
    if not course or course.org_id != org_id:
        return None, None

    try:
        from src.services.ai.rag.query_service import query_course_rag
        rag_result = query_course_rag(
            question=prompt,
            org_id=org_id,
            db_session=db_session,
            course_id=course.id,
        )
        return rag_result.get("context") or None, course.id
    except Exception as e:
        logging.warning("Failed to fetch RAG context for playground: %s", e)
        return None, course.id


@router.post("/generate/start")
async def start_playground_session(
    request: Request,
    session_request: StartPlaygroundSession,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """Start a new Playground AI generation session with streaming response."""
    playground = db_session.exec(
        select(Playground).where(Playground.playground_uuid == session_request.playground_uuid)
    ).first()
    if not playground:
        raise HTTPException(status_code=404, detail="Playground not found")

    org = db_session.exec(
        select(Organization).where(Organization.id == playground.org_id)
    ).first()
    if not org or org.id is None:
        raise HTTPException(status_code=404, detail="Organization not found")

    # Verify user can edit (must be creator or have update rights)
    from src.services.playgrounds.playgrounds import _get_user_rights
    rights = _get_user_rights(current_user.id, playground.org_id, db_session)
    pg_rights = rights.get("playgrounds", {})
    is_owner = playground.created_by == current_user.id
    can_edit = pg_rights.get("action_update", False) or (
        is_owner and pg_rights.get("action_update_own", False)
    )
    if not can_edit:
        raise HTTPException(status_code=403, detail="Insufficient permissions to generate content")

    check_ai_credits(org.id, db_session)
    deduct_ai_credit(org.id, db_session)

    ai_model = get_org_ai_model(org.id, db_session)

    # Fetch RAG context if course linked
    course_context, _ = _get_course_context(
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
        gemini_model_name=ai_model,
        current_html=playground.html_content or None,
        course_context=course_context,
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


@router.post("/generate/iterate")
async def iterate_playground_session(
    request: Request,
    message_request: SendPlaygroundMessage,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
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

    playground = db_session.exec(
        select(Playground).where(Playground.playground_uuid == message_request.playground_uuid)
    ).first()
    if not playground:
        raise HTTPException(status_code=404, detail="Playground not found")

    org = db_session.exec(
        select(Organization).where(Organization.id == playground.org_id)
    ).first()
    if not org or org.id is None:
        raise HTTPException(status_code=404, detail="Organization not found")

    # Verify user can edit
    from src.services.playgrounds.playgrounds import _get_user_rights
    rights = _get_user_rights(current_user.id, playground.org_id, db_session)
    pg_rights = rights.get("playgrounds", {})
    is_owner = playground.created_by == current_user.id
    can_edit = pg_rights.get("action_update", False) or (
        is_owner and pg_rights.get("action_update_own", False)
    )
    if not can_edit:
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    check_ai_credits(org.id, db_session)
    deduct_ai_credit(org.id, db_session)

    ai_model = get_org_ai_model(org.id, db_session)

    # Fetch RAG context if course linked
    course_context, _ = _get_course_context(
        session.context.course_uuid,
        org.id,
        db_session,
        message_request.message,
    )

    html_to_iterate = message_request.current_html or session.current_html

    stream = generate_playground_stream(
        prompt=message_request.message,
        session=session,
        gemini_model_name=ai_model,
        current_html=html_to_iterate,
        course_context=course_context,
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


@router.get("/generate/session/{session_uuid}")
async def get_session_state(
    session_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> PlaygroundSessionResponse:
    """Get the current state of a Playground session."""
    session = get_playground_session(session_uuid)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

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
