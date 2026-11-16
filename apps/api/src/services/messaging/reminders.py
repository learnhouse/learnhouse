"""Reminders: agents (and people) bring something back up later.

An agent sets one by writing a ```reminder block in its reply; the block is
parsed after the reply finishes, validated, and stored. People set personal
ones from a message ("remind me about this tomorrow"). A loop inside the API
delivers due reminders as a message from the agent, which then flows through
everything else Messages does: live delivery, unread badges, and the unread
email if nobody opens it.
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import update
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.messaging import Conversation, ConversationMember, Message, MessageReminder
from src.db.users import User
from src.services.messaging import realtime
from src.services.messaging.messaging import (
    get_conversation_for_member,
    member_ids,
    now_iso,
    require_messaging,
    serialize_message,
)

logger = logging.getLogger(__name__)

MAX_AHEAD = timedelta(days=366)
MAX_PER_REPLY = 3
MAX_PENDING_PER_USER = 50
DELIVERY_BATCH = 100

REMINDER_BLOCK = re.compile(r"```reminder\s*(\{.*?\})\s*```", re.DOTALL)


class ReminderCreate(BaseModel):
    org_id: int
    text: str = Field(min_length=1, max_length=500)
    due_at: str = Field(min_length=10, max_length=40)
    message_uuid: Optional[str] = None
    tz: Optional[str] = Field(default=None, max_length=64)


def zone(tz: Optional[str]) -> timezone | ZoneInfo:
    if tz:
        try:
            return ZoneInfo(tz)
        except (ZoneInfoNotFoundError, ValueError):
            pass
    return timezone.utc


def parse_due(raw: str, tz: Optional[str], now: Optional[datetime] = None) -> Optional[datetime]:
    """A due time in the future (within a year), as UTC. A time without an
    offset is read in the person's time zone."""
    now = now or datetime.now(timezone.utc)
    try:
        due = datetime.fromisoformat(str(raw).strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    if due.tzinfo is None:
        due = due.replace(tzinfo=zone(tz))
    due = due.astimezone(timezone.utc)
    if due <= now or due > now + MAX_AHEAD:
        return None
    return due


def reminder_view(r: MessageReminder) -> dict:
    status = "cancelled" if r.cancelled_at else "sent" if r.sent_at else "pending"
    return {
        "reminder_uuid": r.reminder_uuid,
        "text": r.text,
        "due_at": r.due_at,
        "status": status,
    }


async def _pending_count(user_id: int, db: AsyncSession) -> int:
    rows = (await db.execute(select(MessageReminder.id).where(
        MessageReminder.user_id == user_id,
        MessageReminder.sent_at.is_(None),  # type: ignore[union-attr]
        MessageReminder.cancelled_at.is_(None),  # type: ignore[union-attr]
    ))).scalars().all()
    return len(rows)


async def create_from_agent_reply(
    db: AsyncSession,
    *,
    reply_text: str,
    conversation: Conversation,
    agent_id: int,
    user_id: int,
    source_message_id: int,
    tz: Optional[str],
) -> list[dict]:
    """Store the reminders an agent wrote into its reply. Invalid ones (bad
    JSON, a time in the past) are dropped; the reply text still shows them,
    and the card renders as not scheduled."""
    out: list[dict] = []
    budget = MAX_PENDING_PER_USER - await _pending_count(user_id, db)
    for raw in REMINDER_BLOCK.findall(reply_text)[:MAX_PER_REPLY]:
        if budget <= 0:
            break
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            continue
        text = str(data.get("text") or "").strip()[:500]
        due = parse_due(data.get("due_at") or "", tz)
        if not text or due is None:
            continue
        r = MessageReminder(
            reminder_uuid=f"reminder_{uuid4()}",
            org_id=conversation.org_id,
            user_id=user_id,
            conversation_id=conversation.id,
            agent_id=agent_id,
            text=text,
            due_at=due.isoformat(),
            source_message_id=source_message_id,
            creation_date=now_iso(),
        )
        db.add(r)
        budget -= 1
        out.append(r)
    if out:
        await db.flush()
    return [reminder_view(r) for r in out]


async def refresh_statuses(attachments: list[dict], db: AsyncSession) -> None:
    """Reminder cards inside messages carry their live status (a reminder
    cancelled or delivered since the reply was written)."""
    uuids = [
        r["reminder_uuid"]
        for a in attachments if a
        for r in (a.get("reminders") or [])
        if isinstance(r, dict) and r.get("reminder_uuid")
    ]
    if not uuids:
        return
    rows = (await db.execute(select(MessageReminder).where(
        MessageReminder.reminder_uuid.in_(uuids)  # type: ignore[attr-defined]
    ))).scalars().all()
    live = {r.reminder_uuid: reminder_view(r) for r in rows}
    for a in attachments:
        if a and a.get("reminders"):
            a["reminders"] = [live.get(r.get("reminder_uuid"), r) for r in a["reminders"]]


# ============================================================================
# People's own reminders
# ============================================================================


async def create_personal(body: ReminderCreate, user: User, db: AsyncSession) -> dict:
    """Remind me (only me) later. Delivered into my chat with the org's
    default agent, quoting the message it was set on."""
    from src.services.messaging.agents import AgentChatOpen, ensure_default_agent, open_agent_chat

    await require_messaging(body.org_id, user.id, db)
    due = parse_due(body.due_at, body.tz)
    if due is None:
        raise HTTPException(status_code=400, detail="Pick a time in the future, within a year")
    if await _pending_count(user.id, db) >= MAX_PENDING_PER_USER:
        raise HTTPException(status_code=400, detail=f"You can have up to {MAX_PENDING_PER_USER} upcoming reminders")

    source_id = None
    if body.message_uuid:
        msg = (await db.execute(select(Message).where(Message.message_uuid == body.message_uuid))).scalars().first()
        if not msg:
            raise HTTPException(status_code=404, detail="Message not found")
        conv = (await db.execute(select(Conversation).where(Conversation.id == msg.conversation_id))).scalars().first()
        await get_conversation_for_member(conv.conversation_uuid, user.id, db)
        source_id = msg.id

    agent = await ensure_default_agent(body.org_id, db)
    chat = await open_agent_chat(agent.agent_uuid, AgentChatOpen(), user, db)
    r = MessageReminder(
        reminder_uuid=f"reminder_{uuid4()}",
        org_id=body.org_id,
        user_id=user.id,
        conversation_id=chat["id"],
        agent_id=agent.id,
        text=body.text.strip(),
        due_at=due.isoformat(),
        source_message_id=source_id,
        creation_date=now_iso(),
    )
    db.add(r)
    await db.commit()
    await db.refresh(r)
    return {**reminder_view(r), "conversation_uuid": chat["conversation_uuid"]}


async def list_reminders(org_id: int, user: User, db: AsyncSession) -> list[dict]:
    await require_messaging(org_id, user.id, db)
    since = (datetime.now(timezone.utc) - timedelta(days=14)).isoformat()
    rows = (await db.execute(
        select(MessageReminder, Conversation.conversation_uuid)
        .join(Conversation, Conversation.id == MessageReminder.conversation_id)
        .where(
            MessageReminder.org_id == org_id,
            MessageReminder.user_id == user.id,
            MessageReminder.cancelled_at.is_(None),  # type: ignore[union-attr]
            (MessageReminder.sent_at.is_(None)) | (MessageReminder.sent_at >= since),  # type: ignore[union-attr,operator]
        )
        .order_by(MessageReminder.due_at)
        .limit(200)
    )).all()
    out = [{**reminder_view(r), "conversation_uuid": conv_uuid} for r, conv_uuid in rows]
    # Upcoming first (soonest first), then delivered (most recent first).
    pending = [r for r in out if r["status"] == "pending"]
    sent = sorted((r for r in out if r["status"] == "sent"), key=lambda r: r["due_at"], reverse=True)
    return pending + sent


async def cancel_reminder(reminder_uuid: str, user: User, db: AsyncSession) -> dict:
    r = (await db.execute(select(MessageReminder).where(
        MessageReminder.reminder_uuid == reminder_uuid
    ))).scalars().first()
    if not r or r.user_id != user.id:
        raise HTTPException(status_code=404, detail="Reminder not found")
    await require_messaging(r.org_id, user.id, db)
    if r.sent_at:
        raise HTTPException(status_code=400, detail="This reminder was already sent")
    r.cancelled_at = now_iso()
    db.add(r)
    await db.commit()
    return reminder_view(r)


# ============================================================================
# Delivery
# ============================================================================


async def deliver_due(db: AsyncSession, now: Optional[datetime] = None) -> int:
    """Send every reminder that is due. Each one is claimed with a
    conditional update first, so two API replicas never both deliver it."""
    now = now or datetime.now(timezone.utc)
    due = (await db.execute(
        select(MessageReminder)
        .where(
            MessageReminder.sent_at.is_(None),  # type: ignore[union-attr]
            MessageReminder.cancelled_at.is_(None),  # type: ignore[union-attr]
            MessageReminder.due_at <= now.isoformat(),
        )
        .order_by(MessageReminder.due_at)
        .limit(DELIVERY_BATCH)
    )).scalars().all()
    delivered = 0
    for r in due:
        stamp = now.isoformat()
        claimed = await db.execute(
            update(MessageReminder)
            .where(MessageReminder.id == r.id, MessageReminder.sent_at.is_(None))  # type: ignore[union-attr]
            .values(sent_at=stamp)
        )
        if not claimed.rowcount:
            continue
        conv = (await db.execute(select(Conversation).where(Conversation.id == r.conversation_id))).scalars().first()
        if conv is None:
            continue
        source = None
        if r.source_message_id:
            src = (await db.execute(select(Message).where(Message.id == r.source_message_id))).scalars().first()
            if src and src.deleted_at is None:
                src_conv = (await db.execute(select(Conversation.conversation_uuid).where(
                    Conversation.id == src.conversation_id
                ))).scalars().first()
                source = {
                    "conversation_uuid": src_conv,
                    "message_uuid": src.message_uuid,
                    "snippet": src.content[:200],
                }
        r.sent_at = stamp
        msg = Message(
            message_uuid=f"message_{uuid4()}",
            conversation_id=conv.id,
            org_id=conv.org_id,
            sender_agent_id=r.agent_id,
            kind="reminder",
            content=r.text,
            attachment={"reminder": reminder_view(r), "for_user_id": r.user_id, **({"source": source} if source else {})},
            creation_date=stamp,
        )
        db.add(msg)
        conv.last_message_at = stamp
        db.add(conv)
        members = (await db.execute(
            select(ConversationMember).where(ConversationMember.conversation_id == conv.id)
        )).scalars().all()
        for m in members:
            if m.archived:
                m.archived = False
                db.add(m)
        await db.commit()
        await db.refresh(msg)
        payload = await serialize_message(msg, conv.conversation_uuid, None, db)
        realtime.publish_to_users(conv.org_id, await member_ids(conv.id, db), {
            "type": "message.new", "conversation_uuid": conv.conversation_uuid, "message": payload,
        })
        from src.services.notifications.events import notify_new_message

        await notify_new_message(db, conv.id, msg.id)
        delivered += 1
    if not delivered:
        await db.commit()
    return delivered

