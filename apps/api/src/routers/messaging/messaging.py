from typing import Optional

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.events.database import _async_session_factory, get_db_session
from src.db.users import PublicUser
from src.security.api_token_utils import get_authenticated_non_api_token_user
from src.services.messaging import agents as agents_service
from src.services.messaging import messaging as service
from src.services.messaging import realtime
from src.services.messaging import reminders as reminders_service

router = APIRouter()

# Messaging is personal: it never accepts API tokens, only signed-in people.
CurrentUser = Depends(get_authenticated_non_api_token_user)


# ============================================================================
# Realtime
# ============================================================================


@router.get(
    "/stream",
    summary="Live messaging events (SSE)",
    description="Server-Sent Events for the signed-in person in one organization: new, edited and deleted messages, streamed agent replies, reactions, typing, read receipts and presence. Holding the stream open is what makes you show as online.",
    responses={200: {"content": {"text/event-stream": {}}}},
)
async def api_stream(
    request: Request,
    org_id: int,
    current_user: PublicUser = CurrentUser,
    db_session: AsyncSession = Depends(get_db_session),
):
    await service.require_messaging(org_id, current_user.id, db_session)
    me = await service.get_my_status(org_id, current_user, db_session)
    hello = {"type": "hello", "user_id": current_user.id, "me": me}
    user_id = current_user.id
    # FastAPI keeps yield dependencies open until the response finishes, which
    # for a stream is as long as the tab stays open. Hand the connection back
    # now; presence lookups open short sessions of their own.
    await db_session.close()

    async def presence_payload(connected: bool):
        return await service.presence_event(org_id, user_id, connected, _async_session_factory)

    async def on_offline():
        await service.touch_last_seen(user_id, _async_session_factory)

    return StreamingResponse(
        realtime.event_stream(org_id, user_id, hello, presence_payload, on_offline, request.is_disconnected),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )


# ============================================================================
# Conversations
# ============================================================================


@router.get("/conversations", summary="List my conversations")
async def api_list_conversations(
    org_id: int,
    current_user: PublicUser = CurrentUser,
    db_session: AsyncSession = Depends(get_db_session),
):
    return await service.list_conversations(org_id, current_user.id, db_session)


@router.post("/conversations", summary="Start a DM or group")
async def api_create_conversation(
    body: service.ConversationCreate,
    current_user: PublicUser = CurrentUser,
    db_session: AsyncSession = Depends(get_db_session),
):
    return await service.create_conversation(body, current_user, db_session)


@router.get("/conversations/{conversation_uuid}", summary="Get a conversation")
async def api_get_conversation(
    conversation_uuid: str,
    current_user: PublicUser = CurrentUser,
    db_session: AsyncSession = Depends(get_db_session),
):
    return await service.get_conversation(conversation_uuid, current_user, db_session)


@router.patch("/conversations/{conversation_uuid}", summary="Rename, mute, pin or archive")
async def api_update_conversation(
    conversation_uuid: str,
    body: service.ConversationUpdate,
    current_user: PublicUser = CurrentUser,
    db_session: AsyncSession = Depends(get_db_session),
):
    return await service.update_conversation(conversation_uuid, body, current_user, db_session)


@router.post("/conversations/{conversation_uuid}/members", summary="Add people to a group")
async def api_add_members(
    conversation_uuid: str,
    body: service.MembersAdd,
    current_user: PublicUser = CurrentUser,
    db_session: AsyncSession = Depends(get_db_session),
):
    return await service.add_members(conversation_uuid, body, current_user, db_session)


@router.delete("/conversations/{conversation_uuid}/members/me", summary="Leave a conversation")
async def api_leave(
    conversation_uuid: str,
    current_user: PublicUser = CurrentUser,
    db_session: AsyncSession = Depends(get_db_session),
):
    return await service.leave_conversation(conversation_uuid, current_user, db_session)


@router.get("/conversations/{conversation_uuid}/messages", summary="Message history")
async def api_list_messages(
    conversation_uuid: str,
    before_id: Optional[int] = None,
    limit: int = Query(default=50, ge=1, le=100),
    current_user: PublicUser = CurrentUser,
    db_session: AsyncSession = Depends(get_db_session),
):
    return await service.list_messages(conversation_uuid, current_user, db_session, before_id, limit)


@router.post(
    "/conversations/{conversation_uuid}/messages",
    summary="Send a message",
    description="Send text, share a course, or reply. In an agent chat, or when `agent_uuids` mentions agents, each agent streams a reply into the conversation.",
)
async def api_send_message(
    request: Request,
    conversation_uuid: str,
    body: service.MessageCreate,
    current_user: PublicUser = CurrentUser,
    db_session: AsyncSession = Depends(get_db_session),
):
    return await agents_service.send_and_reply(request, conversation_uuid, body, current_user, db_session)


@router.post("/conversations/{conversation_uuid}/typing", summary="Typing indicator")
async def api_typing(
    conversation_uuid: str,
    body: service.TypingUpdate,
    current_user: PublicUser = CurrentUser,
    db_session: AsyncSession = Depends(get_db_session),
):
    return await service.set_typing(conversation_uuid, body, current_user, db_session)


@router.post("/conversations/{conversation_uuid}/read", summary="Mark as read")
async def api_read(
    conversation_uuid: str,
    body: service.ReadUpdate,
    current_user: PublicUser = CurrentUser,
    db_session: AsyncSession = Depends(get_db_session),
):
    return await service.mark_read(conversation_uuid, body, current_user, db_session)


# ============================================================================
# Messages
# ============================================================================


@router.patch("/messages/{message_uuid}", summary="Edit a message")
async def api_edit_message(
    message_uuid: str,
    body: service.MessageEdit,
    current_user: PublicUser = CurrentUser,
    db_session: AsyncSession = Depends(get_db_session),
):
    return await service.edit_message(message_uuid, body, current_user, db_session)


@router.delete("/messages/{message_uuid}", summary="Delete a message")
async def api_delete_message(
    message_uuid: str,
    current_user: PublicUser = CurrentUser,
    db_session: AsyncSession = Depends(get_db_session),
):
    return await service.delete_message(message_uuid, current_user, db_session)


@router.post("/messages/{message_uuid}/reactions", summary="Toggle a reaction")
async def api_react(
    message_uuid: str,
    body: service.ReactionToggle,
    current_user: PublicUser = CurrentUser,
    db_session: AsyncSession = Depends(get_db_session),
):
    return await service.toggle_reaction(message_uuid, body, current_user, db_session)


@router.get("/search", summary="Search my messages")
async def api_search(
    org_id: int,
    q: str = Query(min_length=1, max_length=200),
    current_user: PublicUser = CurrentUser,
    db_session: AsyncSession = Depends(get_db_session),
):
    return await service.search_messages(org_id, q, current_user, db_session)


@router.get("/unread", summary="Unread count")
async def api_unread(
    org_id: int,
    current_user: PublicUser = CurrentUser,
    db_session: AsyncSession = Depends(get_db_session),
):
    return await service.unread_total(org_id, current_user, db_session)


# ============================================================================
# People, presence, status and notification preferences
# ============================================================================


@router.get("/directory", summary="People you can message")
async def api_directory(
    org_id: int,
    q: str = "",
    limit: int = Query(default=40, ge=1, le=100),
    current_user: PublicUser = CurrentUser,
    db_session: AsyncSession = Depends(get_db_session),
):
    return await service.directory(org_id, q, current_user, db_session, limit)


@router.get("/presence", summary="Presence for people")
async def api_presence(
    org_id: int,
    user_ids: str = Query(default="", max_length=3000),
    current_user: PublicUser = CurrentUser,
    db_session: AsyncSession = Depends(get_db_session),
):
    ids = [int(x) for x in user_ids.split(",") if x.strip().isdigit()]
    return await service.presence_for(org_id, ids, current_user, db_session)


@router.get("/me", summary="My status and notification preferences")
async def api_get_me(
    org_id: int,
    current_user: PublicUser = CurrentUser,
    db_session: AsyncSession = Depends(get_db_session),
):
    return await service.get_my_status(org_id, current_user, db_session)


@router.put("/me", summary="Update my status and notification preferences")
async def api_set_me(
    org_id: int,
    body: service.StatusUpdate,
    current_user: PublicUser = CurrentUser,
    db_session: AsyncSession = Depends(get_db_session),
):
    return await service.set_my_status(org_id, body, current_user, db_session)


# ============================================================================
# Broadcasts
# ============================================================================


@router.get("/broadcast/targets", summary="Courses I can message everyone in")
async def api_broadcast_targets(
    org_id: int,
    current_user: PublicUser = CurrentUser,
    db_session: AsyncSession = Depends(get_db_session),
):
    return await service.broadcast_targets(org_id, current_user, db_session)


@router.post(
    "/broadcast",
    summary="Message everyone in a course",
    description="Course team members (or org admins) post an announcement to every learner enrolled in the course. Without `course_uuid`, an admin announces to the whole organization.",
)
async def api_broadcast(
    body: service.BroadcastCreate,
    current_user: PublicUser = CurrentUser,
    db_session: AsyncSession = Depends(get_db_session),
):
    return await service.send_broadcast(body, current_user, db_session)


# ============================================================================
# Agents
# ============================================================================


@router.get("/agents", summary="Agents I can chat with")
async def api_list_agents(
    org_id: int,
    current_user: PublicUser = CurrentUser,
    db_session: AsyncSession = Depends(get_db_session),
):
    return await agents_service.list_agents(org_id, current_user, db_session)


@router.post("/agents", summary="Create an agent")
async def api_create_agent(
    body: agents_service.AgentCreate,
    current_user: PublicUser = CurrentUser,
    db_session: AsyncSession = Depends(get_db_session),
):
    return await agents_service.create_agent(body, current_user, db_session)


@router.get("/agents/{agent_uuid}", summary="Get an agent")
async def api_get_agent(
    agent_uuid: str,
    current_user: PublicUser = CurrentUser,
    db_session: AsyncSession = Depends(get_db_session),
):
    return await agents_service.get_agent(agent_uuid, current_user, db_session)


@router.patch("/agents/{agent_uuid}", summary="Update an agent")
async def api_update_agent(
    agent_uuid: str,
    body: agents_service.AgentUpdate,
    current_user: PublicUser = CurrentUser,
    db_session: AsyncSession = Depends(get_db_session),
):
    return await agents_service.update_agent(agent_uuid, body, current_user, db_session)


@router.delete("/agents/{agent_uuid}", summary="Delete an agent")
async def api_delete_agent(
    agent_uuid: str,
    current_user: PublicUser = CurrentUser,
    db_session: AsyncSession = Depends(get_db_session),
):
    return await agents_service.delete_agent(agent_uuid, current_user, db_session)


@router.post("/agents/{agent_uuid}/chat", summary="Open a chat with an agent")
async def api_open_agent_chat(
    agent_uuid: str,
    body: agents_service.AgentChatOpen,
    current_user: PublicUser = CurrentUser,
    db_session: AsyncSession = Depends(get_db_session),
):
    return await agents_service.open_agent_chat(agent_uuid, body, current_user, db_session)


# ============================================================================
# Reminders
# ============================================================================


@router.get("/reminders", summary="My reminders", description="Upcoming reminders, then ones delivered in the last two weeks.")
async def api_list_reminders(
    org_id: int,
    current_user: PublicUser = CurrentUser,
    db_session: AsyncSession = Depends(get_db_session),
):
    return await reminders_service.list_reminders(org_id, current_user, db_session)


@router.post(
    "/reminders",
    summary="Remind me later",
    description="A personal reminder, optionally about a message. It arrives in your chat with the default agent.",
)
async def api_create_reminder(
    body: reminders_service.ReminderCreate,
    current_user: PublicUser = CurrentUser,
    db_session: AsyncSession = Depends(get_db_session),
):
    return await reminders_service.create_personal(body, current_user, db_session)


@router.delete("/reminders/{reminder_uuid}", summary="Cancel a reminder")
async def api_cancel_reminder(
    reminder_uuid: str,
    current_user: PublicUser = CurrentUser,
    db_session: AsyncSession = Depends(get_db_session),
):
    return await reminders_service.cancel_reminder(reminder_uuid, current_user, db_session)
