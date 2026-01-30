import json
import logging

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from sqlmodel import Session

from src.services.ai.ai import (
    ai_send_activity_chat_message,
    ai_start_activity_chat_session,
    ai_start_activity_chat_session_stream,
    ai_send_activity_chat_message_stream,
)
from src.services.ai.base import ask_ai_stream, save_message_to_history, generate_follow_up_suggestions
from src.services.ai.schemas.ai import (
    ActivityAIChatSessionResponse,
    SendActivityAIChatMessage,
    StartActivityAIChatSession,
)
from src.core.events.database import get_db_session
from src.db.users import PublicUser
from src.security.auth import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/start/activity_chat_session")
async def api_ai_start_activity_chat_session(
    request: Request,
    chat_session_object: StartActivityAIChatSession,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
)-> ActivityAIChatSessionResponse:
    """
    Start a new AI Chat session with a Course Activity
    """
    return ai_start_activity_chat_session(
        request, chat_session_object, current_user, db_session
    )

@router.post("/send/activity_chat_message")
async def api_ai_send_activity_chat_message(
    request: Request,
    chat_session_object: SendActivityAIChatMessage,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
)-> ActivityAIChatSessionResponse:
    """
    Send a message to an AI Chat session with a Course Activity
    """
    return ai_send_activity_chat_message(
        request, chat_session_object, current_user, db_session
    )


async def activity_chat_event_generator(
    stream_generator,
    aichat_uuid: str,
    activity_uuid: str,
    user_message: str,
    ai_friendly_text: str,
    ai_model: str,
):
    """Convert async generator to SSE format with follow-up suggestions"""
    full_response = ""
    try:
        # Send start event immediately so frontend knows we're ready
        yield f"data: {json.dumps({'type': 'start', 'aichat_uuid': aichat_uuid})}\n\n"

        async for chunk in stream_generator:
            full_response += chunk
            yield f"data: {json.dumps({'type': 'chunk', 'content': chunk})}\n\n"

        # Save the message exchange to history
        save_message_to_history(aichat_uuid, user_message, full_response)

        # Send done event immediately (without waiting for follow-ups)
        yield f"data: {json.dumps({'type': 'done', 'aichat_uuid': aichat_uuid, 'activity_uuid': activity_uuid})}\n\n"

        # Generate follow-up suggestions and send as separate event
        follow_ups = await generate_follow_up_suggestions(
            full_response,
            ai_friendly_text[:1000],
            ai_model,
            user_message
        )

        if follow_ups:
            yield f"data: {json.dumps({'type': 'follow_ups', 'follow_up_suggestions': follow_ups})}\n\n"

    except Exception:
        logger.exception("Error in activity_chat_event_generator")
        yield f"data: {json.dumps({'type': 'error', 'message': 'An internal error occurred while processing the AI chat request.'})}\n\n"


@router.post("/stream/start/activity_chat_session")
async def api_ai_start_activity_chat_session_stream(
    request: Request,
    chat_session_object: StartActivityAIChatSession,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Start a new AI Chat session with streaming response (SSE).
    Returns Server-Sent Events stream.
    """
    context = await ai_start_activity_chat_session_stream(
        request, chat_session_object, current_user, db_session
    )

    # Create the streaming generator
    stream = ask_ai_stream(
        context["user_message"],
        context["chat_session"]["message_history"],
        context["ai_friendly_text"],
        context["message"],
        context["ai_model"],
    )

    return StreamingResponse(
        activity_chat_event_generator(
            stream,
            context["chat_session"]["aichat_uuid"],
            context["activity"].activity_uuid,
            context["user_message"],
            context["ai_friendly_text"],
            context["ai_model"],
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


@router.post("/stream/send/activity_chat_message")
async def api_ai_send_activity_chat_message_stream(
    request: Request,
    chat_session_object: SendActivityAIChatMessage,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Send a message to an existing AI Chat session with streaming response (SSE).
    Returns Server-Sent Events stream.
    """
    context = await ai_send_activity_chat_message_stream(
        request, chat_session_object, current_user, db_session
    )

    # Create the streaming generator
    stream = ask_ai_stream(
        context["user_message"],
        context["chat_session"]["message_history"],
        context["ai_friendly_text"],
        context["message"],
        context["ai_model"],
    )

    return StreamingResponse(
        activity_chat_event_generator(
            stream,
            context["chat_session"]["aichat_uuid"],
            context["activity"].activity_uuid,
            context["user_message"],
            context["ai_friendly_text"],
            context["ai_model"],
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )