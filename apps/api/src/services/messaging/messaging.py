"""Messaging: direct messages, group chats, course broadcasts, reactions,
read state and presence.

Everything is org-scoped. A conversation lives in one org and only that org's
members can be in it. Access is membership: if you have no
ConversationMember row you get a 404, never a 403, so conversation ids are
not an oracle.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Iterable, Literal, Optional
from uuid import uuid4

from fastapi import HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, or_
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.courses import Course
from src.db.messaging import (
    Agent,
    Conversation,
    ConversationMember,
    Message,
    MessageReaction,
    MessagingProfile,
)
from src.db.organization_config import OrganizationConfig
from src.db.resource_authors import (
    ResourceAuthor,
    ResourceAuthorshipEnum,
    ResourceAuthorshipStatusEnum,
)
from src.db.trail_runs import TrailRun
from src.db.user_organizations import UserOrganization
from src.db.users import User
from src.security.org_auth import enforce_org_mfa, is_org_admin, is_org_member
from src.security.rbac.constants import ADMIN_OR_MAINTAINER_ROLE_IDS
from src.services.messaging import realtime

logger = logging.getLogger(__name__)

MESSAGE_MAX_CHARS = 4000
GROUP_MAX_MEMBERS = 100
MESSAGES_PAGE_MAX = 100
REACTION_MAX_LEN = 16
SEND_RATE_PER_MINUTE = 40

ConversationKind = Literal["dm", "group", "broadcast", "agent"]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ============================================================================
# Request schemas
# ============================================================================


class ConversationCreate(BaseModel):
    org_id: int
    kind: Literal["dm", "group"] = "dm"
    user_uuids: list[str] = Field(default_factory=list, max_length=GROUP_MAX_MEMBERS)
    title: str = Field(default="", max_length=120)
    emoji: str = Field(default="", max_length=16)


class ConversationUpdate(BaseModel):
    title: Optional[str] = Field(default=None, max_length=120)
    emoji: Optional[str] = Field(default=None, max_length=16)
    muted: Optional[bool] = None
    pinned: Optional[bool] = None
    archived: Optional[bool] = None


class MembersAdd(BaseModel):
    user_uuids: list[str] = Field(min_length=1, max_length=GROUP_MAX_MEMBERS)


class MessageCreate(BaseModel):
    content: str = Field(default="", max_length=MESSAGE_MAX_CHARS)
    course_uuid: Optional[str] = None
    reply_to_uuid: Optional[str] = None
    # Agents mentioned with @ in a group or DM; each one replies in the thread.
    agent_uuids: list[str] = Field(default_factory=list, max_length=3)
    # The sender's IANA time zone, so agents read "tomorrow at 9" right.
    tz: Optional[str] = Field(default=None, max_length=64)


class MessageEdit(BaseModel):
    content: str = Field(min_length=1, max_length=MESSAGE_MAX_CHARS)


class ReactionToggle(BaseModel):
    emoji: str = Field(min_length=1, max_length=REACTION_MAX_LEN)


class TypingUpdate(BaseModel):
    is_typing: bool = True


class ReadUpdate(BaseModel):
    message_uuid: Optional[str] = None


class StatusUpdate(BaseModel):
    availability: Optional[Literal["auto", "away", "dnd", "invisible"]] = None
    status_emoji: Optional[str] = Field(default=None, max_length=16)
    status_text: Optional[str] = Field(default=None, max_length=100)
    status_expires_at: Optional[str] = None
    allow_dms: Optional[bool] = None
    email_mode: Optional[Literal["all", "direct", "off"]] = None
    email_delay_minutes: Optional[Literal[15, 60, 240, 1440]] = None
    email_broadcasts: Optional[bool] = None
    desktop_notifications: Optional[bool] = None
    sounds: Optional[bool] = None
    read_receipts: Optional[bool] = None
    typing_indicators: Optional[bool] = None


PREFERENCE_FIELDS = (
    "availability", "status_emoji", "status_text", "status_expires_at", "allow_dms",
    "email_mode", "email_delay_minutes", "email_broadcasts", "desktop_notifications",
    "sounds", "read_receipts", "typing_indicators",
)


class BroadcastCreate(BaseModel):
    org_id: int
    # A course uuid, or None to announce to the whole organization (admins).
    course_uuid: Optional[str] = None
    content: str = Field(min_length=1, max_length=MESSAGE_MAX_CHARS)
    share_course: bool = False


# ============================================================================
# Gates
# ============================================================================


async def _org_config(org_id: int, db: AsyncSession) -> Optional[dict]:
    row = (await db.execute(
        select(OrganizationConfig).where(OrganizationConfig.org_id == org_id)
    )).scalars().first()
    return row.config if row else None


async def require_messaging(org_id: int, user_id: int, db: AsyncSession) -> None:
    """Membership, org session policy, then the ``messaging`` feature.

    The feature resolves through deployment mode (OSS never has it, EE always
    does), the org's plan in SaaS (Pro and up) and the admin toggle.
    """
    if not user_id or not await is_org_member(user_id, org_id, db):
        raise HTTPException(status_code=403, detail="You are not a member of this organization")
    await enforce_org_mfa(user_id, org_id, db)

    from src.security.features_utils.resolve import resolve_feature

    config = await _org_config(org_id, db)
    resolved = resolve_feature("messaging", config or {}, org_id)
    if not resolved["enabled"]:
        if not resolved["available"]:
            raise HTTPException(
                status_code=403,
                detail="Messaging requires a Pro plan or the Enterprise Edition.",
            )
        raise HTTPException(status_code=403, detail="Messaging is disabled for this organization")


def enforce_send_rate(user_id: int) -> None:
    from src.services.security.rate_limiting import check_rate_limit

    allowed, _count, retry_after = check_rate_limit(
        key=f"msg_send:{user_id}", max_attempts=SEND_RATE_PER_MINUTE, window_seconds=60
    )
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail={"code": "RATE_LIMITED", "message": "You're sending messages too fast.", "retry_after": retry_after},
            headers={"Retry-After": str(retry_after)},
        )


# ============================================================================
# Serialization
# ============================================================================


def user_summary(user: User) -> dict:
    return {
        "id": user.id,
        "user_uuid": user.user_uuid,
        "username": user.username,
        "first_name": user.first_name,
        "last_name": user.last_name,
        "avatar_image": user.avatar_image or "",
    }


def agent_summary(agent: Agent) -> dict:
    return {
        "id": agent.id,
        "agent_uuid": agent.agent_uuid,
        "name": agent.name,
        "emoji": agent.emoji,
        "color": agent.color,
        "secondary_color": agent.secondary_color,
        "description": agent.description,
        "is_default": agent.is_default,
    }


def course_card(course: Course) -> dict:
    return {
        "course_uuid": course.course_uuid,
        "name": course.name,
        "description": (course.description or "")[:280],
        "thumbnail_image": course.thumbnail_image or "",
    }


async def _users_by_id(ids: Iterable[int], db: AsyncSession) -> dict[int, User]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    rows = (await db.execute(select(User).where(User.id.in_(ids)))).scalars().all()  # type: ignore[union-attr]
    return {u.id: u for u in rows}


async def _agents_by_id(ids: Iterable[int], db: AsyncSession) -> dict[int, Agent]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    rows = (await db.execute(select(Agent).where(Agent.id.in_(ids)))).scalars().all()  # type: ignore[union-attr]
    return {a.id: a for a in rows}


async def _reactions_for(message_ids: list[int], db: AsyncSession) -> dict[int, list[MessageReaction]]:
    if not message_ids:
        return {}
    rows = (await db.execute(
        select(MessageReaction)
        .where(MessageReaction.message_id.in_(message_ids))  # type: ignore[attr-defined]
        .order_by(MessageReaction.id)
    )).scalars().all()
    out: dict[int, list[MessageReaction]] = {}
    for r in rows:
        out.setdefault(r.message_id, []).append(r)
    return out


def _group_reactions(rows: list[MessageReaction], viewer_id: Optional[int]) -> list[dict]:
    grouped: dict[str, dict] = {}
    for r in rows:
        g = grouped.setdefault(r.emoji, {"emoji": r.emoji, "count": 0, "user_ids": [], "me": False})
        g["count"] += 1
        g["user_ids"].append(r.user_id)
        if viewer_id is not None and r.user_id == viewer_id:
            g["me"] = True
    return list(grouped.values())


async def serialize_messages(
    messages: list[Message],
    conversation_uuid: str,
    viewer_id: Optional[int],
    db: AsyncSession,
) -> list[dict]:
    if not messages:
        return []
    reply_ids = {m.reply_to_id for m in messages if m.reply_to_id}
    replies: dict[int, Message] = {}
    if reply_ids:
        rows = (await db.execute(select(Message).where(Message.id.in_(reply_ids)))).scalars().all()  # type: ignore[union-attr]
        replies = {m.id: m for m in rows}
    users = await _users_by_id(
        [m.sender_user_id for m in messages] + [m.sender_user_id for m in replies.values()], db
    )
    agents = await _agents_by_id(
        [m.sender_agent_id for m in messages] + [m.sender_agent_id for m in replies.values()], db
    )
    reactions = await _reactions_for([m.id for m in messages], db)
    # Copies, so live reminder statuses never write back into the ORM rows.
    attachments = {m.id: dict(m.attachment) if m.attachment else None for m in messages}
    from src.services.messaging.reminders import refresh_statuses

    await refresh_statuses([a for a in attachments.values() if a], db)

    def sender(m: Message) -> Optional[dict]:
        if m.sender_agent_id and m.sender_agent_id in agents:
            return {"type": "agent", **agent_summary(agents[m.sender_agent_id])}
        if m.sender_user_id and m.sender_user_id in users:
            return {"type": "user", **user_summary(users[m.sender_user_id])}
        return None

    out = []
    for m in messages:
        deleted = m.deleted_at is not None
        reply = None
        if m.reply_to_id and m.reply_to_id in replies:
            rm = replies[m.reply_to_id]
            reply = {
                "message_uuid": rm.message_uuid,
                "content": "" if rm.deleted_at else rm.content[:200],
                "kind": rm.kind,
                "deleted": rm.deleted_at is not None,
                "sender": sender(rm),
            }
        out.append({
            "id": m.id,
            "message_uuid": m.message_uuid,
            "conversation_uuid": conversation_uuid,
            "kind": m.kind,
            "content": "" if deleted else m.content,
            "attachment": None if deleted else attachments[m.id],
            "reply_to": reply,
            "sender": sender(m),
            "reactions": [] if deleted else _group_reactions(reactions.get(m.id, []), viewer_id),
            "status": m.status,
            "edited_at": m.edited_at,
            "deleted": deleted,
            "creation_date": m.creation_date,
        })
    return out


async def serialize_message(message: Message, conversation_uuid: str, viewer_id: Optional[int], db: AsyncSession) -> dict:
    return (await serialize_messages([message], conversation_uuid, viewer_id, db))[0]


async def _members_of(conversation_ids: list[int], db: AsyncSession) -> dict[int, list[ConversationMember]]:
    if not conversation_ids:
        return {}
    rows = (await db.execute(
        select(ConversationMember).where(ConversationMember.conversation_id.in_(conversation_ids))  # type: ignore[attr-defined]
    )).scalars().all()
    out: dict[int, list[ConversationMember]] = {}
    for r in rows:
        out.setdefault(r.conversation_id, []).append(r)
    return out


async def member_ids(conversation_id: int, db: AsyncSession) -> list[int]:
    return list((await db.execute(
        select(ConversationMember.user_id).where(ConversationMember.conversation_id == conversation_id)
    )).scalars().all())


async def serialize_conversations(
    conversations: list[Conversation],
    viewer_id: int,
    db: AsyncSession,
    member_preview_limit: int = 12,
) -> list[dict]:
    if not conversations:
        return []
    conv_ids = [c.id for c in conversations]
    members = await _members_of(conv_ids, db)

    # Last message per conversation.
    last_ids = (await db.execute(
        select(func.max(Message.id)).where(
            Message.conversation_id.in_(conv_ids),  # type: ignore[attr-defined]
        ).group_by(Message.conversation_id)
    )).scalars().all()
    last_msgs = (await db.execute(select(Message).where(Message.id.in_(last_ids)))).scalars().all() if last_ids else []  # type: ignore[union-attr]

    # Unread = others' messages after my read marker.
    my_rows = {c_id: next((m for m in ms if m.user_id == viewer_id), None) for c_id, ms in members.items()}
    unread: dict[int, int] = {}
    for c_id, me in my_rows.items():
        if me is None:
            continue
        unread[c_id] = 0
    if my_rows:
        conds = [
            and_(Message.conversation_id == c_id, Message.id > me.last_read_message_id)
            for c_id, me in my_rows.items() if me is not None
        ]
        if conds:
            rows = (await db.execute(
                select(Message.conversation_id, func.count(Message.id))
                .where(or_(*conds))
                .where(or_(Message.sender_user_id.is_(None), Message.sender_user_id != viewer_id))  # type: ignore[union-attr]
                .where(Message.deleted_at.is_(None))  # type: ignore[union-attr]
                .group_by(Message.conversation_id)
            )).all()
            for c_id, count in rows:
                unread[c_id] = count

    preview_user_ids: set[int] = set()
    for c_id, ms in members.items():
        for m in ms[:member_preview_limit]:
            preview_user_ids.add(m.user_id)
    users = await _users_by_id(preview_user_ids, db)
    hidden_receipts: set[int] = set()
    if preview_user_ids:
        hidden_receipts = set((await db.execute(select(MessagingProfile.user_id).where(
            MessagingProfile.user_id.in_(preview_user_ids),  # type: ignore[attr-defined]
            MessagingProfile.read_receipts == False,  # noqa: E712
        ))).scalars().all())
    agents = await _agents_by_id([c.agent_id for c in conversations], db)
    courses = {}
    course_ids = {c.course_id for c in conversations if c.course_id}
    if course_ids:
        rows = (await db.execute(select(Course).where(Course.id.in_(course_ids)))).scalars().all()  # type: ignore[union-attr]
        courses = {c.id: c for c in rows}

    # The last message carries sender info; serialize them in one batch.
    last_serialized = {}
    if last_msgs:
        uuid_by_conv = {c.id: c.conversation_uuid for c in conversations}
        batch = await serialize_messages(list(last_msgs), "", viewer_id, db)
        for m, data in zip(last_msgs, batch):
            data["conversation_uuid"] = uuid_by_conv[m.conversation_id]
            last_serialized[m.conversation_id] = data

    out = []
    for c in conversations:
        ms = members.get(c.id, [])
        me = my_rows.get(c.id)
        out.append({
            "id": c.id,
            "conversation_uuid": c.conversation_uuid,
            "org_id": c.org_id,
            "kind": c.kind,
            "title": c.title,
            "emoji": c.emoji,
            "course": course_card(courses[c.course_id]) if c.course_id in courses else None,
            "agent": agent_summary(agents[c.agent_id]) if c.agent_id in agents else None,
            "member_count": len(ms),
            "members": [
                {
                    **user_summary(users[m.user_id]),
                    "role": m.role,
                    "last_read_message_id": (
                        None if (m.user_id in hidden_receipts and m.user_id != viewer_id) else m.last_read_message_id
                    ),
                }
                for m in ms[:member_preview_limit] if m.user_id in users
            ],
            "my_role": me.role if me else None,
            "muted": me.muted if me else False,
            "pinned": me.pinned if me else False,
            "archived": me.archived if me else False,
            "last_read_message_id": me.last_read_message_id if me else 0,
            "unread_count": unread.get(c.id, 0),
            "last_message": last_serialized.get(c.id),
            "last_message_at": c.last_message_at or c.creation_date,
            "created_by": c.created_by,
            "creation_date": c.creation_date,
        })
    return out


async def serialize_conversation(c: Conversation, viewer_id: int, db: AsyncSession, member_preview_limit: int = 200) -> dict:
    return (await serialize_conversations([c], viewer_id, db, member_preview_limit))[0]


# ============================================================================
# Lookups
# ============================================================================


async def get_conversation_for_member(
    conversation_uuid: str, user_id: int, db: AsyncSession
) -> tuple[Conversation, ConversationMember]:
    conv = (await db.execute(
        select(Conversation).where(Conversation.conversation_uuid == conversation_uuid)
    )).scalars().first()
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    member = (await db.execute(
        select(ConversationMember).where(
            ConversationMember.conversation_id == conv.id,
            ConversationMember.user_id == user_id,
        )
    )).scalars().first()
    if not member:
        raise HTTPException(status_code=404, detail="Conversation not found")
    await require_messaging(conv.org_id, user_id, db)
    return conv, member


async def _org_users_by_uuid(org_id: int, user_uuids: list[str], db: AsyncSession) -> list[User]:
    if not user_uuids:
        return []
    rows = (await db.execute(
        select(User)
        .join(UserOrganization, UserOrganization.user_id == User.id)
        .where(UserOrganization.org_id == org_id, User.user_uuid.in_(set(user_uuids)))  # type: ignore[attr-defined]
    )).scalars().unique().all()
    if len({u.user_uuid for u in rows}) != len(set(user_uuids)):
        raise HTTPException(status_code=404, detail="Some people are not members of this organization")
    return list(rows)


async def _profile(user_id: int, db: AsyncSession) -> Optional[MessagingProfile]:
    return (await db.execute(
        select(MessagingProfile).where(MessagingProfile.user_id == user_id)
    )).scalars().first()


# ============================================================================
# Conversations
# ============================================================================


async def list_conversations(org_id: int, user_id: int, db: AsyncSession) -> list[dict]:
    await require_messaging(org_id, user_id, db)
    convs = (await db.execute(
        select(Conversation)
        .join(ConversationMember, ConversationMember.conversation_id == Conversation.id)
        .where(Conversation.org_id == org_id, ConversationMember.user_id == user_id)
        .order_by(Conversation.last_message_at.desc(), Conversation.id.desc())  # type: ignore[union-attr]
        .limit(300)
    )).scalars().all()
    return await serialize_conversations(list(convs), user_id, db)


def _dm_key(a: int, b: int) -> str:
    lo, hi = sorted((a, b))
    return f"{lo}:{hi}"


async def _require_accepting(people: list[User], actor: User, org_id: int, db: AsyncSession) -> None:
    """People who turned off new messages can't be pulled into a chat, except by an admin."""
    if not people:
        return
    closed = set((await db.execute(select(MessagingProfile.user_id).where(
        MessagingProfile.user_id.in_([u.id for u in people]),  # type: ignore[attr-defined]
        MessagingProfile.allow_dms == False,  # noqa: E712
    ))).scalars().all())
    if closed and not await is_org_admin(actor.id, org_id, db):
        names = ", ".join(f"{u.first_name} {u.last_name}".strip() or u.username for u in people if u.id in closed)
        verb = "isn't" if len(closed) == 1 else "aren't"
        raise HTTPException(status_code=403, detail=f"{names} {verb} accepting new messages")


async def create_conversation(body: ConversationCreate, user: User, db: AsyncSession) -> dict:
    await require_messaging(body.org_id, user.id, db)
    others = [u for u in await _org_users_by_uuid(body.org_id, body.user_uuids, db) if u.id != user.id]
    now = now_iso()

    if body.kind == "dm":
        if len(others) != 1:
            raise HTTPException(status_code=400, detail="A direct message is between exactly two people")
        other = others[0]
        key = _dm_key(user.id, other.id)
        existing = (await db.execute(
            select(Conversation).where(
                Conversation.org_id == body.org_id,
                Conversation.kind == "dm",
                Conversation.dm_key == key,
            )
        )).scalars().first()
        if existing:
            # Re-surface a DM the viewer archived.
            me = (await db.execute(select(ConversationMember).where(
                ConversationMember.conversation_id == existing.id, ConversationMember.user_id == user.id
            ))).scalars().first()
            if me and me.archived:
                me.archived = False
                db.add(me)
                await db.commit()
            return await serialize_conversation(existing, user.id, db)
        profile = await _profile(other.id, db)
        if profile is not None and not profile.allow_dms and not await is_org_admin(user.id, body.org_id, db):
            raise HTTPException(status_code=403, detail="This person isn't accepting new direct messages")
        conv = Conversation(
            conversation_uuid=f"conversation_{uuid4()}",
            org_id=body.org_id,
            kind="dm",
            dm_key=key,
            created_by=user.id,
            last_message_at=now,
            creation_date=now,
            update_date=now,
        )
        db.add(conv)
        await db.flush()
        for uid in (user.id, other.id):
            db.add(ConversationMember(conversation_id=conv.id, user_id=uid, role="member", joined_at=now))
    else:
        if not others:
            raise HTTPException(status_code=400, detail="Add at least one person to the group")
        await _require_accepting(others, user, body.org_id, db)
        conv = Conversation(
            conversation_uuid=f"conversation_{uuid4()}",
            org_id=body.org_id,
            kind="group",
            title=body.title.strip() or ", ".join(u.first_name or u.username for u in others[:3]),
            emoji=body.emoji,
            created_by=user.id,
            last_message_at=now,
            creation_date=now,
            update_date=now,
        )
        db.add(conv)
        await db.flush()
        db.add(ConversationMember(conversation_id=conv.id, user_id=user.id, role="owner", joined_at=now))
        for u in others:
            db.add(ConversationMember(conversation_id=conv.id, user_id=u.id, role="member", joined_at=now))
        db.add(Message(
            message_uuid=f"message_{uuid4()}",
            conversation_id=conv.id,
            org_id=body.org_id,
            sender_user_id=user.id,
            kind="system",
            content="created the group",
            creation_date=now,
        ))
    await db.commit()
    await db.refresh(conv)
    data = await serialize_conversation(conv, user.id, db)
    ids = await member_ids(conv.id, db)
    realtime.publish_to_users(conv.org_id, [i for i in ids if i != user.id], {"type": "conversation.new", "conversation_uuid": conv.conversation_uuid})
    return data


async def get_conversation(conversation_uuid: str, user: User, db: AsyncSession) -> dict:
    conv, _ = await get_conversation_for_member(conversation_uuid, user.id, db)
    return await serialize_conversation(conv, user.id, db)


async def update_conversation(conversation_uuid: str, body: ConversationUpdate, user: User, db: AsyncSession) -> dict:
    conv, me = await get_conversation_for_member(conversation_uuid, user.id, db)
    changed_shared = False
    if body.title is not None or body.emoji is not None:
        if conv.kind != "group" or me.role not in ("owner", "admin"):
            raise HTTPException(status_code=403, detail="Only group owners can rename the group")
        if body.title is not None and body.title.strip():
            conv.title = body.title.strip()
        if body.emoji is not None:
            conv.emoji = body.emoji
        conv.update_date = now_iso()
        db.add(conv)
        changed_shared = True
    for field in ("muted", "pinned", "archived"):
        value = getattr(body, field)
        if value is not None:
            setattr(me, field, value)
    db.add(me)
    await db.commit()
    await db.refresh(conv)
    if changed_shared:
        realtime.publish_to_users(conv.org_id, await member_ids(conv.id, db), {"type": "conversation.updated", "conversation_uuid": conv.conversation_uuid})
    return await serialize_conversation(conv, user.id, db)


async def add_members(conversation_uuid: str, body: MembersAdd, user: User, db: AsyncSession) -> dict:
    conv, me = await get_conversation_for_member(conversation_uuid, user.id, db)
    if conv.kind != "group":
        raise HTTPException(status_code=400, detail="People can only be added to groups")
    current = set(await member_ids(conv.id, db))
    new_users = [u for u in await _org_users_by_uuid(conv.org_id, body.user_uuids, db) if u.id not in current]
    if len(current) + len(new_users) > GROUP_MAX_MEMBERS:
        raise HTTPException(status_code=400, detail=f"Groups are limited to {GROUP_MAX_MEMBERS} people")
    await _require_accepting(new_users, user, conv.org_id, db)
    now = now_iso()
    for u in new_users:
        db.add(ConversationMember(conversation_id=conv.id, user_id=u.id, role="member", joined_at=now))
    if new_users:
        db.add(Message(
            message_uuid=f"message_{uuid4()}",
            conversation_id=conv.id,
            org_id=conv.org_id,
            sender_user_id=user.id,
            kind="system",
            content="added " + ", ".join(f"{u.first_name} {u.last_name}".strip() or u.username for u in new_users),
            attachment={"user_ids": [u.id for u in new_users]},
            creation_date=now,
        ))
        conv.last_message_at = now
        db.add(conv)
    await db.commit()
    await db.refresh(conv)
    ids = await member_ids(conv.id, db)
    realtime.publish_to_users(conv.org_id, ids, {"type": "conversation.updated", "conversation_uuid": conv.conversation_uuid})
    realtime.publish_to_users(conv.org_id, [u.id for u in new_users], {"type": "conversation.new", "conversation_uuid": conv.conversation_uuid})
    return await serialize_conversation(conv, user.id, db)


async def leave_conversation(conversation_uuid: str, user: User, db: AsyncSession) -> dict:
    conv, me = await get_conversation_for_member(conversation_uuid, user.id, db)
    if conv.kind in ("dm", "agent"):
        # Leaving a DM just hides it until the next message.
        me.archived = True
        db.add(me)
        await db.commit()
        return {"left": True}
    await db.delete(me)
    now = now_iso()
    db.add(Message(
        message_uuid=f"message_{uuid4()}",
        conversation_id=conv.id,
        org_id=conv.org_id,
        sender_user_id=user.id,
        kind="system",
        content="left the conversation",
        creation_date=now,
    ))
    await db.commit()
    realtime.publish_to_users(conv.org_id, await member_ids(conv.id, db), {"type": "conversation.updated", "conversation_uuid": conv.conversation_uuid})
    return {"left": True}


# ============================================================================
# Messages
# ============================================================================


async def list_messages(
    conversation_uuid: str,
    user: User,
    db: AsyncSession,
    before_id: Optional[int] = None,
    limit: int = 50,
) -> dict:
    conv, _ = await get_conversation_for_member(conversation_uuid, user.id, db)
    limit = max(1, min(limit, MESSAGES_PAGE_MAX))
    stmt = select(Message).where(Message.conversation_id == conv.id)
    if before_id:
        stmt = stmt.where(Message.id < before_id)
    rows = list((await db.execute(stmt.order_by(Message.id.desc()).limit(limit + 1))).scalars().all())  # type: ignore[union-attr]
    has_more = len(rows) > limit
    rows = list(reversed(rows[:limit]))
    return {
        "messages": await serialize_messages(rows, conv.conversation_uuid, user.id, db),
        "has_more": has_more,
    }


async def _can_share_course(course: Course, user_id: int, org_id: int, db: AsyncSession) -> bool:
    if course.org_id != org_id:
        return False
    if course.published:
        return True
    if await is_org_admin(user_id, org_id, db):
        return True
    author = (await db.execute(select(ResourceAuthor).where(
        ResourceAuthor.resource_uuid == course.course_uuid,
        ResourceAuthor.user_id == user_id,
        ResourceAuthor.authorship_status == ResourceAuthorshipStatusEnum.ACTIVE,
    ))).scalars().first()
    return author is not None


async def _runs_channel(conv: Conversation, user_id: int, db: AsyncSession) -> bool:
    """Whether someone runs a broadcast channel right now: an org admin, or on
    the course team for a course channel. Checked live, so leaving the team or
    losing the admin role takes posting rights away."""
    if await is_org_admin(user_id, conv.org_id, db):
        return True
    if conv.course_id is None:
        return False
    course = await db.get(Course, conv.course_id)
    return course is not None and user_id in await _course_team_ids(course, db)


async def _can_post(conv: Conversation, me: ConversationMember, db: AsyncSession) -> bool:
    if conv.kind == "broadcast":
        return await _runs_channel(conv, me.user_id, db)
    return True


async def post_message(
    conv: Conversation,
    user: User,
    body: MessageCreate,
    db: AsyncSession,
    kind: str = "text",
) -> Message:
    """Persist a message from a person and fan it out. Agent replies are
    triggered by the caller (they need the request for access scoping)."""
    content = (body.content or "").strip()
    attachment = None
    if body.course_uuid:
        course = (await db.execute(select(Course).where(Course.course_uuid == body.course_uuid))).scalars().first()
        if not course or not await _can_share_course(course, user.id, conv.org_id, db):
            raise HTTPException(status_code=404, detail="Course not found")
        attachment = {"course": course_card(course)}
        if kind == "text":
            kind = "course_share"
    if not content and not attachment:
        raise HTTPException(status_code=400, detail="Message is empty")

    reply_to_id = None
    if body.reply_to_uuid:
        reply = (await db.execute(select(Message).where(
            Message.message_uuid == body.reply_to_uuid, Message.conversation_id == conv.id
        ))).scalars().first()
        if not reply:
            raise HTTPException(status_code=404, detail="Replied message not found")
        reply_to_id = reply.id

    now = now_iso()
    msg = Message(
        message_uuid=f"message_{uuid4()}",
        conversation_id=conv.id,
        org_id=conv.org_id,
        sender_user_id=user.id,
        kind=kind,
        content=content,
        attachment=attachment,
        reply_to_id=reply_to_id,
        creation_date=now,
    )
    db.add(msg)
    conv.last_message_at = now
    conv.update_date = now
    db.add(conv)
    await db.flush()

    # Sending marks the conversation read for the sender, and un-archives it
    # for everyone (a new message brings a hidden DM back).
    members = (await db.execute(
        select(ConversationMember).where(ConversationMember.conversation_id == conv.id)
    )).scalars().all()
    for m in members:
        changed = False
        if m.user_id == user.id:
            m.last_read_message_id = msg.id
            changed = True
        if m.archived:
            m.archived = False
            changed = True
        if changed:
            db.add(m)
    await db.commit()
    await db.refresh(msg)

    payload = await serialize_message(msg, conv.conversation_uuid, None, db)
    realtime.publish_to_users(conv.org_id, 
        [m.user_id for m in members],
        {"type": "message.new", "conversation_uuid": conv.conversation_uuid, "message": payload},
    )
    return msg


async def send_message(conversation_uuid: str, body: MessageCreate, user: User, db: AsyncSession) -> tuple[Conversation, Message, dict]:
    conv, me = await get_conversation_for_member(conversation_uuid, user.id, db)
    if not await _can_post(conv, me, db):
        raise HTTPException(status_code=403, detail="Only the course team can post in this channel")
    enforce_send_rate(user.id)
    msg = await post_message(conv, user, body, db)
    return conv, msg, await serialize_message(msg, conv.conversation_uuid, user.id, db)


async def _own_message(message_uuid: str, user: User, db: AsyncSession) -> tuple[Message, Conversation]:
    msg = (await db.execute(select(Message).where(Message.message_uuid == message_uuid))).scalars().first()
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    conv = (await db.execute(select(Conversation).where(Conversation.id == msg.conversation_id))).scalars().first()
    await get_conversation_for_member(conv.conversation_uuid, user.id, db)
    return msg, conv


async def edit_message(message_uuid: str, body: MessageEdit, user: User, db: AsyncSession) -> dict:
    msg, conv = await _own_message(message_uuid, user, db)
    if msg.sender_user_id != user.id or msg.kind == "system" or msg.deleted_at:
        raise HTTPException(status_code=403, detail="You can only edit your own messages")
    msg.content = body.content.strip()
    msg.edited_at = now_iso()
    db.add(msg)
    await db.commit()
    await db.refresh(msg)
    payload = await serialize_message(msg, conv.conversation_uuid, None, db)
    realtime.publish_to_users(conv.org_id, await member_ids(conv.id, db), {"type": "message.updated", "conversation_uuid": conv.conversation_uuid, "message": payload})
    return await serialize_message(msg, conv.conversation_uuid, user.id, db)


async def delete_message(message_uuid: str, user: User, db: AsyncSession) -> dict:
    msg, conv = await _own_message(message_uuid, user, db)
    me = (await db.execute(select(ConversationMember).where(
        ConversationMember.conversation_id == conv.id, ConversationMember.user_id == user.id
    ))).scalars().first()
    is_own = msg.sender_user_id == user.id
    if conv.kind == "broadcast":
        is_moderator = me is not None and await _runs_channel(conv, user.id, db)
    else:
        is_moderator = me is not None and me.role in ("owner", "admin")
    if not (is_own or is_moderator):
        raise HTTPException(status_code=403, detail="You can only delete your own messages")
    msg.deleted_at = now_iso()
    db.add(msg)
    await db.commit()
    realtime.publish_to_users(conv.org_id, await member_ids(conv.id, db), {
        "type": "message.deleted", "conversation_uuid": conv.conversation_uuid, "message_uuid": msg.message_uuid,
    })
    return {"deleted": True}


async def toggle_reaction(message_uuid: str, body: ReactionToggle, user: User, db: AsyncSession) -> dict:
    msg, conv = await _own_message(message_uuid, user, db)
    if msg.deleted_at:
        raise HTTPException(status_code=400, detail="Message was deleted")
    existing = (await db.execute(select(MessageReaction).where(
        MessageReaction.message_id == msg.id,
        MessageReaction.user_id == user.id,
        MessageReaction.emoji == body.emoji,
    ))).scalars().first()
    if existing:
        await db.delete(existing)
    else:
        distinct = (await db.execute(select(func.count(func.distinct(MessageReaction.emoji))).where(
            MessageReaction.message_id == msg.id
        ))).scalar() or 0
        if distinct >= 20:
            raise HTTPException(status_code=400, detail="Too many different reactions on this message")
        db.add(MessageReaction(message_id=msg.id, user_id=user.id, emoji=body.emoji, creation_date=now_iso()))
    await db.commit()
    rows = (await _reactions_for([msg.id], db)).get(msg.id, [])
    realtime.publish_to_users(conv.org_id, await member_ids(conv.id, db), {
        "type": "reaction",
        "conversation_uuid": conv.conversation_uuid,
        "message_uuid": msg.message_uuid,
        "reactions": _group_reactions(rows, None),
        "actor_id": user.id,
        "emoji": body.emoji,
        "added": existing is None,
    })
    return {"reactions": _group_reactions(rows, user.id)}


async def set_typing(conversation_uuid: str, body: TypingUpdate, user: User, db: AsyncSession) -> dict:
    conv, _ = await get_conversation_for_member(conversation_uuid, user.id, db)
    profile = await _profile(user.id, db)
    if profile is not None and not profile.typing_indicators:
        return {"ok": True}
    ids = [i for i in await member_ids(conv.id, db) if i != user.id]
    realtime.publish_to_users(conv.org_id, ids, {
        "type": "typing",
        "conversation_uuid": conv.conversation_uuid,
        "user": user_summary(user),
        "is_typing": body.is_typing,
    })
    return {"ok": True}


async def mark_read(conversation_uuid: str, body: ReadUpdate, user: User, db: AsyncSession) -> dict:
    conv, me = await get_conversation_for_member(conversation_uuid, user.id, db)
    if body.message_uuid:
        target = (await db.execute(select(Message.id).where(
            Message.message_uuid == body.message_uuid, Message.conversation_id == conv.id
        ))).scalars().first()
    else:
        target = (await db.execute(select(func.max(Message.id)).where(Message.conversation_id == conv.id))).scalar()
    if target and target > me.last_read_message_id:
        me.last_read_message_id = target
        db.add(me)
        await db.commit()
        profile = await _profile(user.id, db)
        # Without read receipts only the reader's own tabs learn about it.
        audience = [user.id] if (profile is not None and not profile.read_receipts) else await member_ids(conv.id, db)
        realtime.publish_to_users(conv.org_id, audience, {
            "type": "read",
            "conversation_uuid": conv.conversation_uuid,
            "user_id": user.id,
            "message_id": target,
        })
    return {"last_read_message_id": me.last_read_message_id}


async def unread_total(org_id: int, user: User, db: AsyncSession) -> dict:
    await require_messaging(org_id, user.id, db)
    rows = (await db.execute(
        select(ConversationMember.conversation_id, ConversationMember.last_read_message_id)
        .join(Conversation, Conversation.id == ConversationMember.conversation_id)
        .where(
            Conversation.org_id == org_id,
            ConversationMember.user_id == user.id,
            ConversationMember.muted == False,  # noqa: E712
        )
    )).all()
    if not rows:
        return {"unread": 0, "conversations": 0}
    conds = [and_(Message.conversation_id == c, Message.id > last) for c, last in rows]
    counts = (await db.execute(
        select(Message.conversation_id, func.count(Message.id))
        .where(or_(*conds))
        .where(or_(Message.sender_user_id.is_(None), Message.sender_user_id != user.id))  # type: ignore[union-attr]
        .where(Message.deleted_at.is_(None))  # type: ignore[union-attr]
        .group_by(Message.conversation_id)
    )).all()
    return {"unread": sum(c for _, c in counts), "conversations": len(counts)}


async def search_messages(org_id: int, q: str, user: User, db: AsyncSession) -> list[dict]:
    await require_messaging(org_id, user.id, db)
    q = q.strip()
    if len(q) < 2:
        return []
    rows = (await db.execute(
        select(Message, Conversation.conversation_uuid)
        .join(Conversation, Conversation.id == Message.conversation_id)
        .join(ConversationMember, ConversationMember.conversation_id == Conversation.id)
        .where(
            Conversation.org_id == org_id,
            ConversationMember.user_id == user.id,
            Message.deleted_at.is_(None),  # type: ignore[union-attr]
            Message.kind != "system",
            Message.content.ilike(f"%{q.replace('%', '').replace('_', '')}%"),  # type: ignore[union-attr]
        )
        .order_by(Message.id.desc())
        .limit(30)
    )).all()
    out = []
    for msg, conv_uuid in rows:
        out.append((await serialize_messages([msg], conv_uuid, user.id, db))[0])
    return out


# ============================================================================
# Presence & directory
# ============================================================================


def _status_expired(profile: MessagingProfile) -> bool:
    if not profile.status_expires_at:
        return False
    try:
        return datetime.fromisoformat(profile.status_expires_at) < datetime.now(timezone.utc)
    except ValueError:
        return False


def presence_view(user_id: int, profile: Optional[MessagingProfile], connected: bool) -> dict:
    """What other people see. Invisible reads as offline."""
    availability = profile.availability if profile else "auto"
    online = connected and availability != "invisible"
    if not online:
        state = "offline"
    elif availability in ("away", "dnd"):
        state = availability
    else:
        state = "online"
    expired = profile is not None and _status_expired(profile)
    return {
        "user_id": user_id,
        "online": online,
        "state": state,
        "status_emoji": "" if (not profile or expired) else profile.status_emoji,
        "status_text": "" if (not profile or expired) else profile.status_text,
        "last_seen_at": None if online else (profile.last_seen_at if profile else None),
    }


async def visible_online_ids(org_id: int, db: AsyncSession) -> set[int]:
    """Who's online in the org, minus anyone set to invisible."""
    online = realtime.online_user_ids(org_id)
    if not online:
        return set()
    hidden = set((await db.execute(select(MessagingProfile.user_id).where(
        MessagingProfile.user_id.in_(online),  # type: ignore[attr-defined]
        MessagingProfile.availability == "invisible",
    ))).scalars().all())
    return online - hidden


async def presence_event(org_id: int, user_id: int, connected: bool, db_factory) -> dict:
    async with db_factory() as db:
        profile = await _profile(user_id, db)
    return {"type": "presence", **presence_view(user_id, profile, connected)}


async def directory(org_id: int, q: str, user: User, db: AsyncSession, limit: int = 40) -> list[dict]:
    await require_messaging(org_id, user.id, db)
    stmt = (
        select(User)
        .join(UserOrganization, UserOrganization.user_id == User.id)
        .where(UserOrganization.org_id == org_id, User.id != user.id)
    )
    q = (q or "").strip()
    if q:
        like = f"%{q.replace('%', '').replace('_', '')}%"
        stmt = stmt.where(or_(
            User.username.ilike(like),  # type: ignore[attr-defined]
            User.first_name.ilike(like),  # type: ignore[attr-defined]
            User.last_name.ilike(like),  # type: ignore[attr-defined]
            func.concat(User.first_name, " ", User.last_name).ilike(like),
        ))
    online = await visible_online_ids(org_id, db)
    # Online people first, then alphabetical.
    users = list((await db.execute(stmt.order_by(User.first_name, User.last_name).limit(400))).scalars().unique().all())
    users.sort(key=lambda u: (u.id not in online, (u.first_name or u.username).lower()))
    users = users[:max(1, min(limit, 100))]
    profiles = {}
    if users:
        rows = (await db.execute(select(MessagingProfile).where(
            MessagingProfile.user_id.in_([u.id for u in users])  # type: ignore[attr-defined]
        ))).scalars().all()
        profiles = {p.user_id: p for p in rows}
    return [
        {**user_summary(u), "presence": presence_view(u.id, profiles.get(u.id), u.id in online)}
        for u in users
    ]


async def presence_for(org_id: int, user_ids: list[int], user: User, db: AsyncSession) -> list[dict]:
    await require_messaging(org_id, user.id, db)
    ids = list({i for i in user_ids if i})[:300]
    if not ids:
        return []
    # Only report on people in the same org.
    allowed = set((await db.execute(select(UserOrganization.user_id).where(
        UserOrganization.org_id == org_id, UserOrganization.user_id.in_(ids)  # type: ignore[attr-defined]
    ))).scalars().all())
    online = realtime.online_user_ids(org_id)
    rows = (await db.execute(select(MessagingProfile).where(MessagingProfile.user_id.in_(allowed)))).scalars().all()  # type: ignore[attr-defined]
    profiles = {p.user_id: p for p in rows}
    return [presence_view(uid, profiles.get(uid), uid in online) for uid in allowed]


async def get_my_status(org_id: int, user: User, db: AsyncSession) -> dict:
    await require_messaging(org_id, user.id, db)
    profile = await _profile(user.id, db)
    view = presence_view(user.id, profile, realtime.is_online(org_id, user.id))
    defaults = MessagingProfile(user_id=user.id)
    prefs = {f: getattr(profile or defaults, f) for f in PREFERENCE_FIELDS}
    return {**view, **prefs}


async def set_my_status(org_id: int, body: StatusUpdate, user: User, db: AsyncSession) -> dict:
    await require_messaging(org_id, user.id, db)
    profile = await _profile(user.id, db) or MessagingProfile(user_id=user.id)
    for field in PREFERENCE_FIELDS:
        value = getattr(body, field)
        if value is not None:
            setattr(profile, field, value)
    profile.update_date = now_iso()
    db.add(profile)
    await db.commit()
    await db.refresh(profile)
    view = presence_view(user.id, profile, realtime.is_online(org_id, user.id))
    # Invisible people announce themselves as offline.
    realtime.publish_to_org(org_id, {"type": "presence", **view})
    return await get_my_status(org_id, user, db)


async def touch_last_seen(user_id: int, db_factory) -> None:
    async with db_factory() as db:
        profile = await _profile(user_id, db) or MessagingProfile(user_id=user_id)
        profile.last_seen_at = now_iso()
        db.add(profile)
        await db.commit()


# ============================================================================
# Broadcasts: a teacher announcing to everyone in their course
# ============================================================================


async def _course_team_ids(course: Course, db: AsyncSession) -> set[int]:
    return set((await db.execute(select(ResourceAuthor.user_id).where(
        ResourceAuthor.resource_uuid == course.course_uuid,
        ResourceAuthor.authorship.in_([  # type: ignore[attr-defined]
            ResourceAuthorshipEnum.CREATOR,
            ResourceAuthorshipEnum.MAINTAINER,
            ResourceAuthorshipEnum.CONTRIBUTOR,
        ]),
        ResourceAuthor.authorship_status == ResourceAuthorshipStatusEnum.ACTIVE,
    ))).scalars().all())


async def _course_learner_ids(course: Course, db: AsyncSession) -> set[int]:
    return set((await db.execute(
        select(TrailRun.user_id).where(TrailRun.course_id == course.id).distinct()
    )).scalars().all())


async def broadcast_targets(org_id: int, user: User, db: AsyncSession) -> list[dict]:
    """Courses the person can announce to (they're on the course team, or an
    org admin), with how many people each would reach."""
    await require_messaging(org_id, user.id, db)
    admin = await is_org_admin(user.id, org_id, db)
    stmt = select(Course).where(Course.org_id == org_id)
    if not admin:
        authored = select(ResourceAuthor.resource_uuid).where(
            ResourceAuthor.user_id == user.id,
            ResourceAuthor.authorship_status == ResourceAuthorshipStatusEnum.ACTIVE,
            ResourceAuthor.authorship.in_([  # type: ignore[attr-defined]
                ResourceAuthorshipEnum.CREATOR,
                ResourceAuthorshipEnum.MAINTAINER,
                ResourceAuthorshipEnum.CONTRIBUTOR,
            ]),
        )
        stmt = stmt.where(Course.course_uuid.in_(authored))  # type: ignore[attr-defined]
    courses = list((await db.execute(stmt.order_by(Course.name))).scalars().all())
    counts = {}
    if courses:
        counts = dict((await db.execute(
            select(TrailRun.course_id, func.count(func.distinct(TrailRun.user_id)))
            .where(TrailRun.course_id.in_([c.id for c in courses]))  # type: ignore[attr-defined]
            .group_by(TrailRun.course_id)
        )).all())
    out = [{**course_card(c), "learners": counts.get(c.id, 0)} for c in courses]
    if admin:
        members = (await db.execute(select(func.count(UserOrganization.id)).where(UserOrganization.org_id == org_id))).scalar() or 0
        out.insert(0, {"course_uuid": None, "name": "Everyone in the organization", "description": "", "thumbnail_image": "", "learners": members})
    return out


async def _sync_channel_members(conv: Conversation, owners: set[int], audience: set[int], db: AsyncSession) -> set[int]:
    """Bring the channel's membership up to date. Returns newly added ids."""
    rows = (await db.execute(select(ConversationMember).where(ConversationMember.conversation_id == conv.id))).scalars().all()
    existing = {m.user_id: m for m in rows}
    now = now_iso()
    added = set()
    for uid in owners | audience:
        role = "owner" if uid in owners else "member"
        m = existing.get(uid)
        if m is None:
            db.add(ConversationMember(conversation_id=conv.id, user_id=uid, role=role, joined_at=now))
            added.add(uid)
        elif m.role != role and m.role != "owner":
            m.role = role
            db.add(m)
    return added


async def send_broadcast(body: BroadcastCreate, user: User, db: AsyncSession) -> dict:
    await require_messaging(body.org_id, user.id, db)
    admin = await is_org_admin(user.id, body.org_id, db)
    now = now_iso()
    course = None
    if body.course_uuid:
        course = (await db.execute(select(Course).where(
            Course.course_uuid == body.course_uuid, Course.org_id == body.org_id
        ))).scalars().first()
        if not course:
            raise HTTPException(status_code=404, detail="Course not found")
        team = await _course_team_ids(course, db)
        if not admin and user.id not in team:
            raise HTTPException(status_code=403, detail="Only the course team can message everyone in this course")
        owners = team | {user.id}
        audience = await _course_learner_ids(course, db)
    else:
        if not admin:
            raise HTTPException(status_code=403, detail="Only administrators can message the whole organization")
        owners = set((await db.execute(select(UserOrganization.user_id).where(
            UserOrganization.org_id == body.org_id,
            UserOrganization.role_id.in_(ADMIN_OR_MAINTAINER_ROLE_IDS),  # type: ignore[attr-defined]
        ))).scalars().all()) | {user.id}
        audience = set((await db.execute(select(UserOrganization.user_id).where(
            UserOrganization.org_id == body.org_id
        ))).scalars().all())

    enforce_send_rate(user.id)
    stmt = select(Conversation).where(Conversation.org_id == body.org_id, Conversation.kind == "broadcast")
    if course:
        stmt = stmt.where(Conversation.course_id == course.id)
    else:
        stmt = stmt.where(Conversation.course_id.is_(None))  # type: ignore[union-attr]
    conv = (await db.execute(stmt)).scalars().first()
    if conv is None:
        conv = Conversation(
            conversation_uuid=f"conversation_{uuid4()}",
            org_id=body.org_id,
            kind="broadcast",
            title=course.name if course else "Announcements",
            emoji="📣",
            course_id=course.id if course else None,
            created_by=user.id,
            last_message_at=now,
            creation_date=now,
            update_date=now,
        )
        db.add(conv)
        await db.flush()
    added = await _sync_channel_members(conv, owners, audience, db)
    await db.commit()
    await db.refresh(conv)

    msg = await post_message(
        conv,
        user,
        MessageCreate(content=body.content, course_uuid=course.course_uuid if (course and body.share_course) else None),
        db,
        kind="announcement",
    )
    if added:
        realtime.publish_to_users(conv.org_id, added, {"type": "conversation.new", "conversation_uuid": conv.conversation_uuid})
    return {
        "conversation": await serialize_conversation(conv, user.id, db, member_preview_limit=12),
        "message": await serialize_message(msg, conv.conversation_uuid, user.id, db),
        "recipients": len(audience | owners) - 1,
    }
