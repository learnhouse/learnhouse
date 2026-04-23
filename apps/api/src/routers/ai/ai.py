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
from src.services.ai.editor import (
    editor_ai_start_chat_session_stream,
    editor_ai_send_message_stream,
)
from src.services.ai.base import ask_ai_stream, save_message_to_history, generate_follow_up_suggestions
from src.services.ai.schemas.ai import (
    ActivityAIChatSessionResponse,
    SendActivityAIChatMessage,
    StartActivityAIChatSession,
)
from src.services.ai.schemas.editor import (
    StartEditorAIChatSession,
    SendEditorAIChatMessage,
)
from src.core.events.database import get_db_session
from src.db.users import PublicUser
from src.security.auth import get_authenticated_user

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post(
    "/start/activity_chat_session",
    response_model=ActivityAIChatSessionResponse,
    summary="Start activity AI chat session",
    description="Start a new AI chat session anchored to a course activity. Returns the new session's state and initial message.",
    responses={
        200: {"description": "New AI chat session created.", "model": ActivityAIChatSessionResponse},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission or AI feature disabled for this organization"},
        404: {"description": "Activity or organization not found"},
    },
)
async def api_ai_start_activity_chat_session(
    request: Request,
    chat_session_object: StartActivityAIChatSession,
    current_user: PublicUser = Depends(get_authenticated_user),
    db_session: Session = Depends(get_db_session),
)-> ActivityAIChatSessionResponse:
    """
    Start a new AI Chat session with a Course Activity
    """
    return ai_start_activity_chat_session(
        request, chat_session_object, current_user, db_session
    )

@router.post(
    "/send/activity_chat_message",
    response_model=ActivityAIChatSessionResponse,
    summary="Send activity AI chat message",
    description="Send a message to an existing AI chat session anchored to a course activity and receive the updated session state.",
    responses={
        200: {"description": "Message sent and AI response recorded.", "model": ActivityAIChatSessionResponse},
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission or AI feature disabled for this organization"},
        404: {"description": "Session or activity not found"},
    },
)
async def api_ai_send_activity_chat_message(
    request: Request,
    chat_session_object: SendActivityAIChatMessage,
    current_user: PublicUser = Depends(get_authenticated_user),
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
    org_id: int | None = None,
):
    """Convert async generator to SSE format with follow-up suggestions.

    Credits are reserved by the caller before the stream is created. If the
    stream dies before producing any model output (upstream error, client
    disconnect, cancellation) we refund one credit so a flaky connection
    doesn't silently drain the org's quota.
    """
    import asyncio
    from src.security.features_utils.usage import refund_ai_credit

    full_response = ""
    stream_failed = False
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

    except asyncio.CancelledError:
        stream_failed = True
        # Client disconnect / server shutdown. Re-raise so Starlette observes
        # the cancellation, but let the finally refund first.
        raise
    except Exception:
        stream_failed = True
        logger.exception("Error in activity_chat_event_generator")
        yield f"data: {json.dumps({'type': 'error', 'message': 'An internal error occurred while processing the AI chat request.'})}\n\n"
    finally:
        # Refund credit if the model produced nothing useful.
        if org_id is not None and (stream_failed or not full_response):
            try:
                refund_ai_credit(org_id, 1)
            except Exception:
                logger.debug("AI credit refund failed", exc_info=True)


@router.post(
    "/stream/start/activity_chat_session",
    summary="Start activity AI chat session (streaming)",
    description="Start a new AI chat session for a course activity and stream the response as Server-Sent Events (SSE).",
    responses={
        200: {
            "description": "SSE stream of chat events (start, chunk, done, follow_ups, error).",
            "content": {"text/event-stream": {}},
        },
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission or AI feature disabled for this organization"},
        404: {"description": "Activity or organization not found"},
    },
)
async def api_ai_start_activity_chat_session_stream(
    request: Request,
    chat_session_object: StartActivityAIChatSession,
    current_user: PublicUser = Depends(get_authenticated_user),
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
            org_id=getattr(context.get("course", None), "org_id", None),
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


@router.post(
    "/stream/send/activity_chat_message",
    summary="Send activity AI chat message (streaming)",
    description="Send a message to an existing activity AI chat session and stream the response as Server-Sent Events (SSE).",
    responses={
        200: {
            "description": "SSE stream of chat events (start, chunk, done, follow_ups, error).",
            "content": {"text/event-stream": {}},
        },
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission or AI feature disabled for this organization"},
        404: {"description": "Session or activity not found"},
    },
)
async def api_ai_send_activity_chat_message_stream(
    request: Request,
    chat_session_object: SendActivityAIChatMessage,
    current_user: PublicUser = Depends(get_authenticated_user),
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
            org_id=getattr(context.get("course", None), "org_id", None),
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


# ============================================================================
# Editor AI Endpoints
# ============================================================================

# Content modification markers
CONTENT_START_MARKER = "<<<CONTENT>>>"
CONTENT_END_MARKER = "<<<END_CONTENT>>>"

import asyncio  # noqa: E402
from src.security.features_utils.usage import refund_ai_credit  # noqa: E402


async def editor_chat_event_generator(
    stream_generator,
    aichat_uuid: str,
    activity_uuid: str,
    user_message: str,
    ai_friendly_text: str,
    ai_model: str,
    org_id: int | None = None,
):
    """
    Convert async generator to SSE format for editor AI chat.
    Parses AI response to detect content modifications between markers.

    Events:
    - start: Stream started
    - chat_chunk: Regular chat text (explanation)
    - content_start: Beginning of content modification
    - content_chunk: Content to insert/replace in editor
    - content_end: End of content modification
    - done: Stream complete
    - follow_ups: Suggested follow-up actions
    - error: Error occurred
    """
    full_response = ""
    buffer = ""
    in_content_block = False
    content_buffer = ""

    try:
        # Send start event immediately
        yield f"data: {json.dumps({'type': 'start', 'aichat_uuid': aichat_uuid})}\n\n"

        async for chunk in stream_generator:
            full_response += chunk
            buffer += chunk

            # Check for content block markers in buffer
            while True:
                if not in_content_block:
                    # Look for start marker
                    start_idx = buffer.find(CONTENT_START_MARKER)
                    if start_idx != -1:
                        # Send any text before the marker as chat
                        before_marker = buffer[:start_idx].strip()
                        if before_marker:
                            yield f"data: {json.dumps({'type': 'chat_chunk', 'content': before_marker})}\n\n"

                        # Enter content block mode
                        in_content_block = True
                        yield f"data: {json.dumps({'type': 'content_start'})}\n\n"

                        # Keep everything after the marker, stripping leading whitespace/newlines
                        remaining = buffer[start_idx + len(CONTENT_START_MARKER):]
                        buffer = remaining.lstrip('\n\r \t')
                        content_buffer = ""
                    else:
                        # No start marker found, but might be partial at end
                        # Keep last N chars in case marker spans chunks
                        safe_boundary = len(CONTENT_START_MARKER) - 1
                        if len(buffer) > safe_boundary:
                            to_send = buffer[:-safe_boundary]
                            buffer = buffer[-safe_boundary:]
                            if to_send.strip():
                                yield f"data: {json.dumps({'type': 'chat_chunk', 'content': to_send})}\n\n"
                        break
                else:
                    # We're inside a content block, look for end marker
                    end_idx = buffer.find(CONTENT_END_MARKER)
                    if end_idx != -1:
                        # Send content before the marker
                        content_before_raw = buffer[:end_idx]
                        content_before = content_before_raw.rstrip('\n\r \t')
                        logger.debug(f"Found end marker at index {end_idx}")
                        logger.debug(
                            f"Content before marker (raw length): {len(content_before_raw)}"
                        )
                        logger.debug(
                            f"Content before marker (stripped length): {len(content_before)}"
                        )
                        if content_before:
                            content_buffer += content_before
                            yield f"data: {json.dumps({'type': 'content_chunk', 'content': content_before})}\n\n"

                        # Exit content block mode - strip all whitespace from final content
                        in_content_block = False
                        final_content = content_buffer.strip()
                        logger.debug(
                            f"Sending content_end with {len(final_content)} chars"
                        )
                        yield f"data: {json.dumps({'type': 'content_end', 'full_content': final_content})}\n\n"

                        # Keep everything after the marker
                        buffer = buffer[end_idx + len(CONTENT_END_MARKER):]
                        content_buffer = ""
                    else:
                        # No end marker, stream content (keep some in buffer for safety)
                        safe_boundary = len(CONTENT_END_MARKER) - 1
                        if len(buffer) > safe_boundary:
                            to_send = buffer[:-safe_boundary]
                            buffer = buffer[-safe_boundary:]
                            content_buffer += to_send
                            yield f"data: {json.dumps({'type': 'content_chunk', 'content': to_send})}\n\n"
                        break

        # Flush remaining buffer
        if buffer.strip():
            if in_content_block:
                content_buffer += buffer
                yield f"data: {json.dumps({'type': 'content_chunk', 'content': buffer})}\n\n"
                yield f"data: {json.dumps({'type': 'content_end', 'full_content': content_buffer.strip()})}\n\n"
            else:
                yield f"data: {json.dumps({'type': 'chat_chunk', 'content': buffer})}\n\n"

        # Save the message exchange to history
        save_message_to_history(aichat_uuid, user_message, full_response)

        # Send done event
        yield f"data: {json.dumps({'type': 'done', 'aichat_uuid': aichat_uuid, 'activity_uuid': activity_uuid})}\n\n"

        # Generate follow-up suggestions
        follow_ups = await generate_follow_up_suggestions(
            full_response,
            ai_friendly_text[:1000],
            ai_model,
            user_message
        )

        if follow_ups:
            yield f"data: {json.dumps({'type': 'follow_ups', 'follow_up_suggestions': follow_ups})}\n\n"

    except asyncio.CancelledError:
        # Client disconnect / cancellation — let Starlette observe it after
        # we refund credits in the finally block.
        if org_id is not None and not full_response:
            try:
                refund_ai_credit(org_id, 1)
            except Exception:
                logger.debug("AI credit refund failed", exc_info=True)
        raise
    except Exception:
        logger.exception("Error in editor_chat_event_generator")
        yield f"data: {json.dumps({'type': 'error', 'message': 'An internal error occurred while processing the AI request.'})}\n\n"
        if org_id is not None and not full_response:
            try:
                refund_ai_credit(org_id, 1)
            except Exception:
                logger.debug("AI credit refund failed", exc_info=True)


@router.post(
    "/stream/editor/start",
    summary="Start editor AI chat session (streaming)",
    description="Start a new AI editor chat session that is aware of the current editor content. Streams the response as Server-Sent Events (SSE) and can emit content modification blocks to be inserted into the editor.",
    responses={
        200: {
            "description": "SSE stream of editor chat events (start, chat_chunk, content_start, content_chunk, content_end, done, follow_ups, error).",
            "content": {"text/event-stream": {}},
        },
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission or AI feature disabled for this organization"},
        404: {"description": "Activity or organization not found"},
    },
)
async def api_editor_ai_start_chat_session_stream(
    request: Request,
    chat_session_object: StartEditorAIChatSession,
    current_user: PublicUser = Depends(get_authenticated_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Start a new AI Editor chat session with streaming response (SSE).
    This endpoint is aware of the current editor content and can help modify it.
    """
    context = await editor_ai_start_chat_session_stream(
        chat_session_object, current_user, db_session
    )

    # Create the streaming generator
    stream = ask_ai_stream(
        context["user_message"],
        context["chat_session"]["message_history"],
        context["ai_friendly_text"],
        context["system_prompt"],
        context["ai_model"],
    )

    return StreamingResponse(
        editor_chat_event_generator(
            stream,
            context["chat_session"]["aichat_uuid"],
            context["activity"].activity_uuid,
            context["user_message"],
            context["ai_friendly_text"],
            context["ai_model"],
            org_id=getattr(context.get("course", None), "org_id", None),
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


@router.post(
    "/stream/editor/message",
    summary="Send editor AI chat message (streaming)",
    description="Send a message to an existing AI editor chat session and stream the response as Server-Sent Events (SSE). The endpoint is aware of the current editor content and can emit content modification blocks.",
    responses={
        200: {
            "description": "SSE stream of editor chat events (start, chat_chunk, content_start, content_chunk, content_end, done, follow_ups, error).",
            "content": {"text/event-stream": {}},
        },
        401: {"description": "Authentication required"},
        403: {"description": "User lacks permission or AI feature disabled for this organization"},
        404: {"description": "Session or activity not found"},
    },
)
async def api_editor_ai_send_message_stream(
    request: Request,
    chat_session_object: SendEditorAIChatMessage,
    current_user: PublicUser = Depends(get_authenticated_user),
    db_session: Session = Depends(get_db_session),
):
    """
    Send a message to an existing AI Editor chat session with streaming response (SSE).
    This endpoint is aware of the current editor content and can help modify it.
    """
    context = await editor_ai_send_message_stream(
        chat_session_object, current_user, db_session
    )

    # Create the streaming generator
    stream = ask_ai_stream(
        context["user_message"],
        context["chat_session"]["message_history"],
        context["ai_friendly_text"],
        context["system_prompt"],
        context["ai_model"],
    )

    return StreamingResponse(
        editor_chat_event_generator(
            stream,
            context["chat_session"]["aichat_uuid"],
            context["activity"].activity_uuid,
            context["user_message"],
            context["ai_friendly_text"],
            context["ai_model"],
            org_id=getattr(context.get("course", None), "org_id", None),
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )