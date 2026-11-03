"""Email people about messages that stayed unread.

Every few minutes: find messages older than each recipient's chosen delay
(an hour unless they changed it) that they haven't read and that no earlier
email covered, filter by their preferences, and send one email per person and
org listing the conversations. ``ConversationMember.last_emailed_message_id``
is the ledger: a message is considered for email at most once, whether or not
the preferences let it through.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.messaging import Agent, Conversation, ConversationMember, Message, MessagingProfile
from src.db.organization_config import OrganizationConfig
from src.db.organizations import Organization
from src.db.users import User

logger = logging.getLogger(__name__)

LOOKBACK = timedelta(days=3)
MIN_DELAY = timedelta(minutes=15)
COPILOT_LOGO_PATH = "/learnhouse_ai_simple_colored.png"
MAX_ROWS = 5000


@dataclass
class NotifyStats:
    emails: int = 0
    failed: int = 0
    considered: int = 0


def _parse(ts: str) -> Optional[datetime]:
    try:
        dt = datetime.fromisoformat(ts)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def wants_email(
    profile: Optional[MessagingProfile],
    conv: Conversation,
    msg: Message,
    member: User,
    reply_target_user_id: Optional[int],
) -> bool:
    """Whether this unread message should be in this person's email."""
    mode = profile.email_mode if profile else "direct"
    if mode == "off":
        return False
    # A reminder is the point of the conversation: it goes out unless email is off.
    if msg.kind == "reminder":
        return True
    if conv.kind == "broadcast":
        return profile.email_broadcasts if profile else True
    if mode == "all":
        return True
    # "direct": one-to-one conversations, agents answering you, replies to
    # you, and @mentions.
    if conv.kind in ("dm", "agent"):
        return True
    if reply_target_user_id == member.id:
        return True
    content = (msg.content or "").lower()
    handles = {f"@{member.username}".lower()}
    if member.first_name:
        handles.add(f"@{member.first_name}".lower())
    return any(h in content for h in handles)


def _title(conv: Conversation, sender: Optional[User], agent: Optional[Agent]) -> str:
    if conv.kind == "dm" and sender:
        return f"{sender.first_name} {sender.last_name}".strip() or sender.username
    if conv.kind == "agent" and agent:
        return agent.name
    return conv.title or "Conversation"


async def run_unread_emails(db: AsyncSession, now: Optional[datetime] = None) -> NotifyStats:
    now = now or datetime.now(timezone.utc)
    stats = NotifyStats()
    earliest = (now - LOOKBACK).isoformat()
    latest = (now - MIN_DELAY).isoformat()

    rows = (await db.execute(
        select(ConversationMember, Message, Conversation)
        .join(Message, Message.conversation_id == ConversationMember.conversation_id)
        .join(Conversation, Conversation.id == Message.conversation_id)
        .where(
            Message.creation_date >= earliest,
            Message.creation_date <= latest,
            Message.deleted_at.is_(None),  # type: ignore[union-attr]
            Message.status == "complete",
            Message.kind != "system",
            Message.id > ConversationMember.last_read_message_id,
            Message.id > ConversationMember.last_emailed_message_id,
            ConversationMember.muted == False,  # noqa: E712
            (Message.sender_user_id.is_(None)) | (Message.sender_user_id != ConversationMember.user_id),  # type: ignore[union-attr]
        )
        .order_by(Message.id)
        .limit(MAX_ROWS)
    )).all()
    if not rows:
        return stats

    user_ids = {m.user_id for m, _, _ in rows}
    sender_ids = {msg.sender_user_id for _, msg, _ in rows if msg.sender_user_id}
    users = {u.id: u for u in (await db.execute(select(User).where(User.id.in_(user_ids | sender_ids)))).scalars().all()}  # type: ignore[union-attr]
    profiles = {p.user_id: p for p in (await db.execute(
        select(MessagingProfile).where(MessagingProfile.user_id.in_(user_ids))  # type: ignore[attr-defined]
    )).scalars().all()}
    agent_ids = {msg.sender_agent_id for _, msg, _ in rows if msg.sender_agent_id} | {c.agent_id for _, _, c in rows if c.agent_id}
    agents = {a.id: a for a in (await db.execute(select(Agent).where(Agent.id.in_(agent_ids)))).scalars().all()} if agent_ids else {}  # type: ignore[union-attr]
    reply_ids = {msg.reply_to_id for _, msg, _ in rows if msg.reply_to_id}
    reply_authors = dict((await db.execute(
        select(Message.id, Message.sender_user_id).where(Message.id.in_(reply_ids))  # type: ignore[union-attr]
    )).all()) if reply_ids else {}

    from src.services.nudges.preferences import get_opted_out_user_ids

    opted_out = await get_opted_out_user_ids(db, user_ids)

    # (user_id, org_id) -> conversation_id -> summary
    digests: dict[tuple[int, int], dict[int, dict]] = {}
    # member row -> highest message id now considered
    ledger: dict[int, tuple[ConversationMember, int]] = {}

    for member, msg, conv in rows:
        profile = profiles.get(member.user_id)
        delay = timedelta(minutes=max(15, profile.email_delay_minutes if profile else 60))
        created = _parse(msg.creation_date)
        if created is None or created > now - delay:
            continue
        stats.considered += 1
        prev = ledger.get(member.id)
        ledger[member.id] = (member, max(msg.id, prev[1] if prev else 0))

        recipient = users.get(member.user_id)
        if recipient is None or member.user_id in opted_out or not recipient.email:
            continue
        if not wants_email(profile, conv, msg, recipient, reply_authors.get(msg.reply_to_id)):
            continue
        sender = users.get(msg.sender_user_id) if msg.sender_user_id else None
        agent = agents.get(msg.sender_agent_id) if msg.sender_agent_id else agents.get(conv.agent_id)
        author = (
            agent.name if msg.sender_agent_id and agent
            else (f"{sender.first_name} {sender.last_name}".strip() or sender.username) if sender
            else ""
        )
        snippet = msg.content or (
            f"Shared a course: {msg.attachment['course']['name']}"
            if msg.attachment and msg.attachment.get("course") else ""
        )
        entry = digests.setdefault((member.user_id, conv.org_id), {}).setdefault(conv.id, {
            "conversation_uuid": conv.conversation_uuid,
            "title": _title(conv, sender, agent),
            "count": 0,
        })
        if conv.kind == "agent" and agent:
            entry["emoji"], entry["color"] = agent.emoji, agent.color
            entry["copilot"] = bool(agent.is_default)
        entry["count"] += 1
        # Rows are in id order, so the last one wins: the newest message.
        entry["snippet"] = snippet
        entry["author"] = "" if conv.kind == "dm" else author
        entry["last_id"] = msg.id

    # Advance the ledger first: a provider hiccup must not cause a resend
    # storm on the next tick.
    for member, max_id in ledger.values():
        member.last_emailed_message_id = max(member.last_emailed_message_id, max_id)
        db.add(member)
    await db.commit()

    if not digests:
        return stats

    from src.services.email.branding import resolve_org_email_branding
    from src.services.nudges.links import org_base_url
    from src.services.users.emails import send_unread_messages_email

    org_cache: dict[int, tuple] = {}
    for (user_id, org_id), convs in digests.items():
        try:
            if org_id not in org_cache:
                org = await db.get(Organization, org_id)
                org_config = (await db.execute(
                    select(OrganizationConfig).where(OrganizationConfig.org_id == org_id)
                )).scalars().first()
                branding = resolve_org_email_branding(org, org_config, None)
                base = await org_base_url(org.slug, db, org.id)
                org_cache[org_id] = (branding, base)
            branding, base = org_cache[org_id]
            ordered = sorted(convs.values(), key=lambda c: c["last_id"], reverse=True)
            for c in ordered:
                # Copilot wears the LearnHouse AI mark, served by the org's own site.
                if c.pop("copilot", False):
                    c["image"] = f"{base}{COPILOT_LOGO_PATH}"
            cta = f"{base}/messages"
            if len(ordered) == 1:
                cta += f"?c={ordered[0]['conversation_uuid']}"
            user = users[user_id]
            await asyncio.to_thread(
                send_unread_messages_email,
                email=user.email,
                username=user.username,
                org_name=branding.org_name,
                conversations=ordered,
                cta_url=cta,
                settings_url=f"{base}/messages?settings=notifications",
                **branding.as_kwargs(),
            )
            stats.emails += 1
        except Exception:
            stats.failed += 1
            logger.warning("Unread messages email failed for user %s", user_id, exc_info=True)
    return stats
