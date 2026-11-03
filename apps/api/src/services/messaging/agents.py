"""Agents: assistants people build and chat with inside Messages.

An agent is a persona (name, emoji, colors, tone, instructions) on top of the
same retrieval the copilot used: it answers from the org's indexed course
content the person chatting can read, optionally narrowed to a few courses,
and in "general" mode adds the model's own knowledge.

Every org gets a default agent, "Copilot", created on first use. It is the
copilot, moved into Messages: same grounding, same credit cost, and the same
admin switch (``copilot_enabled``) turns every agent off.

Replies stream into the conversation over the realtime channel, so an agent
mentioned in a group chat streams to every member at once.
"""

from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime, timezone
from typing import Literal, Optional
from uuid import uuid4

from fastapi import HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.courses.courses import Course
from src.db.messaging import Agent, Conversation, ConversationMember, Message
from src.db.users import User
from src.security.org_auth import is_org_admin
from src.services.messaging import realtime
from src.services.messaging.messaging import (
    MessageCreate,
    _org_config,
    agent_summary,
    member_ids,
    now_iso,
    require_messaging,
    serialize_conversation,
    serialize_message,
)

logger = logging.getLogger(__name__)

AGENTS_PER_USER = 25
HISTORY_MESSAGES = 14
DELTA_FLUSH_SECONDS = 0.06

HEX_COLOR = r"^#[0-9a-fA-F]{6}$"

Tone = Literal["friendly", "concise", "socratic", "expert", "playful"]
KnowledgeMode = Literal["course_only", "general"]
Visibility = Literal["private", "org"]

TONE_PROMPTS = {
    "friendly": "Be warm, encouraging and clear. Use simple language and short paragraphs.",
    "concise": "Be brief. Answer in as few words as accuracy allows; use bullet points over prose.",
    "socratic": (
        "Teach like a Socratic tutor: don't hand over final answers to exercises. Ask one guiding "
        "question at a time, give hints, and let the learner reach the answer themselves. Explain "
        "concepts fully when asked to explain rather than to solve."
    ),
    "expert": "Answer like a domain expert: precise terminology, depth, and nuance. Assume a capable reader.",
    "playful": "Be upbeat and fun. Light humor and an emoji now and then are welcome, but stay accurate.",
}

# Keeps a background reply task referenced until it finishes.
_running: set[asyncio.Task] = set()


# ============================================================================
# Schemas
# ============================================================================


class AgentCreate(BaseModel):
    org_id: int
    name: str = Field(min_length=1, max_length=60)
    description: str = Field(default="", max_length=280)
    emoji: str = Field(default="✨", max_length=16)
    color: str = Field(default="#6366f1", pattern=HEX_COLOR)
    secondary_color: str = Field(default="#a855f7", pattern=HEX_COLOR)
    instructions: str = Field(default="", max_length=4000)
    tone: Tone = "friendly"
    knowledge_mode: KnowledgeMode = "course_only"
    course_uuids: list[str] = Field(default_factory=list, max_length=50)
    greeting: str = Field(default="", max_length=500)
    starters: list[str] = Field(default_factory=list, max_length=6)
    visibility: Visibility = "private"


class AgentUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=60)
    description: Optional[str] = Field(default=None, max_length=280)
    emoji: Optional[str] = Field(default=None, max_length=16)
    color: Optional[str] = Field(default=None, pattern=HEX_COLOR)
    secondary_color: Optional[str] = Field(default=None, pattern=HEX_COLOR)
    instructions: Optional[str] = Field(default=None, max_length=4000)
    tone: Optional[Tone] = None
    knowledge_mode: Optional[KnowledgeMode] = None
    course_uuids: Optional[list[str]] = Field(default=None, max_length=50)
    greeting: Optional[str] = Field(default=None, max_length=500)
    starters: Optional[list[str]] = Field(default=None, max_length=6)
    visibility: Optional[Visibility] = None


class AgentChatOpen(BaseModel):
    new: bool = False


# ============================================================================
# Access
# ============================================================================


def knowledge_mode(agent: Agent) -> str:
    """Copilot always pairs the courses with its own general knowledge."""
    return "general" if agent.is_default else agent.knowledge_mode


def agent_read(agent: Agent, viewer_id: int, can_admin: bool) -> dict:
    mine = agent.owner_user_id == viewer_id
    return {
        **agent_summary(agent),
        "org_id": agent.org_id,
        "instructions": agent.instructions if (mine or can_admin) else "",
        "tone": agent.tone,
        "knowledge_mode": knowledge_mode(agent),
        "course_uuids": [] if agent.is_default else (agent.course_uuids or []),
        "greeting": agent.greeting,
        "starters": agent.starters or [],
        "visibility": agent.visibility,
        "owner_user_id": agent.owner_user_id,
        "mine": mine,
        "can_edit": mine or (can_admin and (agent.is_default or agent.visibility == "org")),
        "creation_date": agent.creation_date,
        "update_date": agent.update_date,
    }


async def ensure_default_agent(org_id: int, db: AsyncSession) -> Agent:
    agent = (await db.execute(select(Agent).where(
        Agent.org_id == org_id, Agent.is_default == True  # noqa: E712
    ))).scalars().first()
    if agent:
        return agent
    now = now_iso()
    agent = Agent(
        agent_uuid=f"agent_{uuid4()}",
        org_id=org_id,
        owner_user_id=None,
        name="Copilot",
        description="Answers from every course you can access, plus its own general knowledge.",
        emoji="✨",
        color="#111827",
        secondary_color="#6366f1",
        tone="friendly",
        knowledge_mode="general",
        greeting="Hi! Ask me anything about your courses and I'll answer with sources.",
        starters=[
            "Summarize what I should learn first",
            "Quiz me on a recent lesson",
            "Explain a concept in simpler words",
        ],
        visibility="org",
        is_default=True,
        creation_date=now,
        update_date=now,
    )
    db.add(agent)
    await db.commit()
    await db.refresh(agent)
    return agent


def _visible_filter(org_id: int, user_id: int):
    return (Agent.org_id == org_id) & or_(
        Agent.is_default == True,  # noqa: E712
        Agent.visibility == "org",
        Agent.owner_user_id == user_id,
    )


async def get_visible_agent(agent_uuid: str, user: User, db: AsyncSession) -> Agent:
    agent = (await db.execute(select(Agent).where(Agent.agent_uuid == agent_uuid))).scalars().first()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    await require_messaging(agent.org_id, user.id, db)
    if not (agent.is_default or agent.visibility == "org" or agent.owner_user_id == user.id):
        raise HTTPException(status_code=404, detail="Agent not found")
    return agent


async def _get_editable_agent(agent_uuid: str, user: User, db: AsyncSession) -> Agent:
    agent = await get_visible_agent(agent_uuid, user, db)
    if agent.owner_user_id == user.id:
        return agent
    if (agent.is_default or agent.visibility == "org") and await is_org_admin(user.id, agent.org_id, db):
        return agent
    raise HTTPException(status_code=403, detail="You can't edit this agent")


async def _validate_courses(org_id: int, course_uuids: list[str], db: AsyncSession) -> list[str]:
    if not course_uuids:
        return []
    found = set((await db.execute(select(Course.course_uuid).where(
        Course.org_id == org_id, Course.course_uuid.in_(set(course_uuids))  # type: ignore[attr-defined]
    ))).scalars().all())
    return [c for c in course_uuids if c in found]


# ============================================================================
# CRUD
# ============================================================================


async def list_agents(org_id: int, user: User, db: AsyncSession) -> list[dict]:
    await require_messaging(org_id, user.id, db)
    await ensure_default_agent(org_id, db)
    admin = await is_org_admin(user.id, org_id, db)
    rows = (await db.execute(
        select(Agent).where(_visible_filter(org_id, user.id)).order_by(Agent.is_default.desc(), Agent.id)  # type: ignore[union-attr]
    )).scalars().all()
    return [agent_read(a, user.id, admin) for a in rows]


async def create_agent(body: AgentCreate, user: User, db: AsyncSession) -> dict:
    await require_messaging(body.org_id, user.id, db)
    owned = (await db.execute(select(Agent.id).where(
        Agent.org_id == body.org_id, Agent.owner_user_id == user.id
    ))).scalars().all()
    if len(owned) >= AGENTS_PER_USER:
        raise HTTPException(status_code=400, detail=f"You can have up to {AGENTS_PER_USER} agents")
    admin = await is_org_admin(user.id, body.org_id, db)
    if body.visibility == "org" and not admin:
        # Sharing an agent with the whole org is an admin call, like publishing.
        raise HTTPException(status_code=403, detail="Only administrators can share agents with everyone")
    now = now_iso()
    agent = Agent(
        agent_uuid=f"agent_{uuid4()}",
        org_id=body.org_id,
        owner_user_id=user.id,
        name=body.name.strip(),
        description=body.description.strip(),
        emoji=body.emoji or "✨",
        color=body.color,
        secondary_color=body.secondary_color,
        instructions=body.instructions.strip(),
        tone=body.tone,
        knowledge_mode=body.knowledge_mode,
        course_uuids=await _validate_courses(body.org_id, body.course_uuids, db),
        greeting=body.greeting.strip(),
        starters=[s.strip()[:120] for s in body.starters if s.strip()],
        visibility=body.visibility,
        creation_date=now,
        update_date=now,
    )
    db.add(agent)
    await db.commit()
    await db.refresh(agent)
    return agent_read(agent, user.id, admin)


async def get_agent(agent_uuid: str, user: User, db: AsyncSession) -> dict:
    agent = await get_visible_agent(agent_uuid, user, db)
    return agent_read(agent, user.id, await is_org_admin(user.id, agent.org_id, db))


async def update_agent(agent_uuid: str, body: AgentUpdate, user: User, db: AsyncSession) -> dict:
    agent = await _get_editable_agent(agent_uuid, user, db)
    admin = await is_org_admin(user.id, agent.org_id, db)
    data = body.model_dump(exclude_unset=True)
    if data.get("visibility") == "org" and not admin:
        raise HTTPException(status_code=403, detail="Only administrators can share agents with everyone")
    if agent.is_default:
        # Copilot is the org's own agent: everyone sees it, it reads every course
        # the asker can, and it keeps the LearnHouse AI identity.
        for locked in ("visibility", "course_uuids", "knowledge_mode", "name", "emoji", "color", "secondary_color"):
            data.pop(locked, None)
    if "course_uuids" in data:
        data["course_uuids"] = await _validate_courses(agent.org_id, data["course_uuids"] or [], db)
    if "starters" in data:
        data["starters"] = [s.strip()[:120] for s in (data["starters"] or []) if s.strip()]
    for key, value in data.items():
        setattr(agent, key, value.strip() if isinstance(value, str) else value)
    agent.update_date = now_iso()
    db.add(agent)
    await db.commit()
    await db.refresh(agent)
    return agent_read(agent, user.id, admin)


async def delete_agent(agent_uuid: str, user: User, db: AsyncSession) -> dict:
    agent = await _get_editable_agent(agent_uuid, user, db)
    if agent.is_default:
        raise HTTPException(status_code=400, detail="The default agent can be edited but not deleted")
    await db.delete(agent)
    await db.commit()
    return {"deleted": True}


async def open_agent_chat(agent_uuid: str, body: AgentChatOpen, user: User, db: AsyncSession) -> dict:
    """The person's chat with an agent: the latest one, or a fresh one."""
    agent = await get_visible_agent(agent_uuid, user, db)
    conv = None
    if not body.new:
        conv = (await db.execute(
            select(Conversation)
            .join(ConversationMember, ConversationMember.conversation_id == Conversation.id)
            .where(
                Conversation.kind == "agent",
                Conversation.agent_id == agent.id,
                ConversationMember.user_id == user.id,
                ConversationMember.archived == False,  # noqa: E712
            )
            .order_by(Conversation.id.desc())
        )).scalars().first()
    if conv is None:
        now = now_iso()
        conv = Conversation(
            conversation_uuid=f"conversation_{uuid4()}",
            org_id=agent.org_id,
            kind="agent",
            title=agent.name,
            agent_id=agent.id,
            created_by=user.id,
            last_message_at=now,
            creation_date=now,
            update_date=now,
        )
        db.add(conv)
        await db.flush()
        db.add(ConversationMember(conversation_id=conv.id, user_id=user.id, role="owner", joined_at=now))
        if agent.greeting:
            db.add(Message(
                message_uuid=f"message_{uuid4()}",
                conversation_id=conv.id,
                org_id=agent.org_id,
                sender_agent_id=agent.id,
                kind="text",
                content=agent.greeting,
                creation_date=now,
            ))
        await db.commit()
        await db.refresh(conv)
        # The greeting shouldn't count as unread.
        me = (await db.execute(select(ConversationMember).where(
            ConversationMember.conversation_id == conv.id, ConversationMember.user_id == user.id
        ))).scalars().first()
        last = (await db.execute(select(Message.id).where(Message.conversation_id == conv.id).order_by(Message.id.desc()))).scalars().first()
        if me and last:
            me.last_read_message_id = last
            db.add(me)
            await db.commit()
    return await serialize_conversation(conv, user.id, db)


# ============================================================================
# Replies
# ============================================================================


RICH_BLOCKS_PROMPT = """RICH BLOCKS: the chat renders these fenced blocks as interactive UI. You MUST use the
matching block instead of plain text whenever the learner asks to be quizzed or tested, asks for
flashcards, or asks for steps/a plan. Never write quiz questions as a plain list. At most two blocks
per reply, always valid JSON:
- When asked to quiz or test the learner:
```quiz
{"questions": [{"question": "...", "options": ["...", "...", "...", "..."], "answer": 0, "explanation": "..."}]}
```
(1 to 5 questions, "answer" is the 0-based index of the correct option)
- When asked for flashcards or to memorize terms:
```flashcards
{"cards": [{"front": "...", "back": "..."}]}
```
- For a procedure or study plan:
```steps
{"title": "...", "steps": [{"title": "...", "detail": "..."}]}
```
- To recommend one of the listed courses (exact uuid from the catalog only):
```course
{"course_uuid": "...", "reason": "..."}
```
- A chart, when numbers are easier to compare visually (type is bar, line or pie):
```chart
{"type": "bar", "title": "...", "unit": "", "data": [{"label": "...", "value": 12}]}
```
- A mind map, to show how ideas connect (2 or 3 levels):
```mindmap
{"center": "...", "branches": [{"label": "...", "children": ["...", "..."]}]}
```
- A timeline of dated events, a schedule or a history:
```timeline
{"title": "...", "events": [{"date": "...", "title": "...", "detail": "..."}]}
```
- A practice exercise with hints and a hidden worked solution:
```exercise
{"prompt": "...", "hints": ["..."], "solution": "..."}
```
- A reminder, ONLY when the learner explicitly asks to be reminded of something or agrees
  to one you suggest. due_at is ISO 8601 with the learner's UTC offset, computed from the
  current time below; never in the past. Confirm it in one short sentence.
```reminder
{"text": "Review chapter 2 before the quiz", "due_at": "2026-11-04T09:00:00+01:00"}
```
Callouts: start a line with > [!TIP], > [!NOTE] or > [!WARNING] for a highlighted aside.
Code goes in fenced blocks with a language tag."""


def _time_context(tz: Optional[str], now: Optional[datetime] = None) -> str:
    from src.services.messaging.reminders import zone

    local = (now or datetime.now(timezone.utc)).astimezone(zone(tz))
    name = tz if tz and zone(tz) is not timezone.utc else "UTC"
    return f"Current time for the learner: {local.strftime('%A %Y-%m-%d %H:%M')} ({name}, UTC{local.strftime('%z')[:3]}:{local.strftime('%z')[3:]})."


def _system_prompt(agent: Agent, context: str, catalog: list[dict] | None = None, tz: Optional[str] = None) -> str:
    persona = (
        f"You are {agent.name}, an AI agent inside a learning platform's messaging app."
        + (f" {agent.description}" if agent.description else "")
    )
    parts = [persona, TONE_PROMPTS.get(agent.tone, TONE_PROMPTS["friendly"])]
    if agent.is_default:
        parts.append(
            "You are this organization's Copilot. You can draw on every course the learner has access "
            "to, so connect ideas across courses and point them to the course that covers what they need. "
            "You also answer from your own general knowledge, including questions no course covers."
        )
    if agent.instructions:
        parts.append(f"Instructions from the person who built you:\n{agent.instructions}")
    parts.append(
        "You are chatting in a messaging thread. Keep replies conversational and scannable. "
        "Use Markdown sparingly (short lists, bold for key terms)."
    )
    parts.append(
        "When referencing the provided sources, cite them inline as [1], [2] matching the source "
        "numbers. Never write out source paths."
    )
    parts.append(
        "MATH: Write math as LaTeX between dollar signs: $x^2$ inline, $$...$$ for display. "
        "Escape a literal dollar sign as \\$."
    )
    mode = knowledge_mode(agent)
    if context and mode == "general":
        parts.append(
            "Use the course content below as your primary reference and freely add your own "
            "knowledge. Wrap anything that goes beyond the course content in a blockquote (> )."
        )
    elif context:
        parts.append(
            "Answer from the course content below. If it doesn't cover the question, say so in one short "
            "sentence and name what the course does cover that's closest. Anything you add that is not in "
            "the course content goes in a blockquote (> )."
        )
    elif mode == "general":
        parts.append("No matching course content was found; answer from your general knowledge.")
    else:
        parts.append(
            "No matching course content was found. Say so briefly, then help as best you can, "
            "marking general knowledge with a blockquote (> )."
        )
    parts.append(RICH_BLOCKS_PROMPT)
    parts.append(_time_context(tz))
    if catalog:
        lines = "\n".join(f"- {c['name']} (uuid: {c['course_uuid']})" for c in catalog)
        parts.append(f"Courses this learner can access:\n{lines}")
    if context:
        parts.append(f"Course Content:\n{context}")
    return "\n\n".join(parts)


async def _standalone_question(question: str, history: list[dict]) -> str:
    """Rewrite a follow-up ("and the second one?") into a self-contained search
    query, so retrieval sees what the person actually means."""
    if not history:
        return question
    from src.services.ai.llm import model_for_tier
    from src.services.ai.llm.client import generate

    transcript = "\n".join(f"{h['role']}: {h['content'][:400]}" for h in history[-6:])
    try:
        rewritten = await generate(
            model_name=model_for_tier("fast"),
            user_prompt=(
                "Rewrite the last user message as one standalone search query for a course content "
                "search engine, resolving pronouns and references from the conversation. Keep the "
                "user's language. Output only the query.\n\n"
                f"Conversation:\n{transcript}\n\nLast user message: {question}"
            ),
            max_tokens=80,
            temperature=0,
        )
        rewritten = (rewritten or "").strip().strip('"')
        return rewritten if 3 <= len(rewritten) <= 400 else question
    except Exception:
        logger.debug("query rewrite failed", exc_info=True)
        return question


async def _catalog(scope, db: AsyncSession, limit: int = 30) -> list[dict]:
    if not scope.course_ids:
        return []
    rows = (await db.execute(
        select(Course.course_uuid, Course.name).where(Course.id.in_(scope.course_ids[:200]))  # type: ignore[union-attr]
    )).all()
    return [{"course_uuid": u, "name": n} for u, n in rows][:limit]


def _clean_mention(text: str, agent_name: str) -> str:
    return re.sub(rf"@{re.escape(agent_name)}\b", agent_name, text, flags=re.IGNORECASE).strip()


async def _history(conv_id: int, before_id: int, agent_id: int, db: AsyncSession) -> list[dict]:
    rows = (await db.execute(
        select(Message)
        .where(Message.conversation_id == conv_id, Message.id < before_id, Message.deleted_at.is_(None))  # type: ignore[union-attr]
        .where(Message.kind.in_(["text", "course_share", "announcement"]))  # type: ignore[attr-defined]
        .order_by(Message.id.desc())
        .limit(HISTORY_MESSAGES)
    )).scalars().all()
    out = []
    for m in reversed(rows):
        if not m.content:
            continue
        role = "model" if m.sender_agent_id == agent_id else "user"
        out.append({"role": role, "content": m.content})
    return out


async def _ai_gate(org_id: int, db: AsyncSession) -> None:
    from src.services.ai.rag.gating import ai_block_reason

    blocked = ai_block_reason(await _org_config(org_id, db), org_id)
    if blocked:
        raise HTTPException(status_code=403, detail=blocked.replace("Copilot", "Agents"))


async def trigger_agent_reply(
    request: Request,
    conv: Conversation,
    agent: Agent,
    trigger: Message,
    user: User,
    db: AsyncSession,
    tz: Optional[str] = None,
) -> dict:
    """Charge, scope and start an agent reply. Returns the placeholder message
    the reply streams into."""
    from src.security.features_utils.usage import reserve_ai_credit
    from src.services.ai.rag.access import build_rag_access_scope
    from src.services.security.rate_limiting import enforce_ai_rate_limit

    await _ai_gate(conv.org_id, db)
    enforce_ai_rate_limit(user.id, conv.org_id)

    # Retrieval is limited to what the person who asked can read, then to the
    # agent's own course list. Copilot always covers every course.
    scope = await build_rag_access_scope(request, user, conv.org_id, db)
    if agent.course_uuids and not agent.is_default:
        allowed = set(agent.course_uuids)
        scope.courses = {cid: g for cid, g in scope.courses.items() if g.course_uuid in allowed}

    await reserve_ai_credit(conv.org_id, db, amount=2)

    now = now_iso()
    placeholder = Message(
        message_uuid=f"message_{uuid4()}",
        conversation_id=conv.id,
        org_id=conv.org_id,
        sender_agent_id=agent.id,
        kind="text",
        content="",
        reply_to_id=trigger.id if conv.kind != "agent" else None,
        status="streaming",
        creation_date=now,
    )
    db.add(placeholder)
    conv.last_message_at = now
    db.add(conv)
    await db.commit()
    await db.refresh(placeholder)

    payload = await serialize_message(placeholder, conv.conversation_uuid, None, db)
    recipients = await member_ids(conv.id, db)
    realtime.publish_to_users(recipients, {"type": "message.new", "conversation_uuid": conv.conversation_uuid, "message": payload})

    question = _clean_mention(trigger.content, agent.name)
    if trigger.attachment and trigger.attachment.get("course"):
        question += f"\n\n(Shared course: {trigger.attachment['course'].get('name')})"

    task = asyncio.create_task(_stream_reply(
        conv_id=conv.id,
        conversation_uuid=conv.conversation_uuid,
        org_id=conv.org_id,
        agent_id=agent.id,
        placeholder_id=placeholder.id,
        question=question,
        scope=scope,
        recipients=recipients,
        requester_id=user.id,
        tz=tz,
    ))
    _running.add(task)
    task.add_done_callback(_running.discard)
    return payload


def _status(recipients: list[int], conversation_uuid: str, message_id: int, phase: str, **extra) -> None:
    realtime.publish_to_users(recipients, {
        "type": "agent.status",
        "conversation_uuid": conversation_uuid,
        "message_id": message_id,
        "phase": phase,
        **extra,
    })


async def _stream_reply(
    *,
    conv_id: int,
    conversation_uuid: str,
    org_id: int,
    agent_id: int,
    placeholder_id: int,
    question: str,
    scope,
    recipients: list[int],
    requester_id: Optional[int] = None,
    tz: Optional[str] = None,
) -> None:
    """Retrieve, stream and finish one agent reply.

    Phases are published as ``agent.status`` events so the UI can show what
    the agent is doing: ``searching`` (with how many courses), ``found`` (the
    sources, before any text, so citations render as soon as they appear),
    ``writing``, then the final ``message.updated`` carrying follow-ups.
    """
    from src.core.events.database import _async_session_factory
    from src.security.features_utils.usage import refund_ai_credit
    from src.services.ai.base import ask_ai_stream, generate_follow_up_suggestions
    from src.services.ai.llm import model_for_tier
    from src.services.ai.rag.query_service import query_course_rag

    full = ""
    failed = False
    sources: list[dict] = []
    follow_ups: list[str] = []
    search_query = question
    loop = asyncio.get_event_loop()
    try:
        async with _async_session_factory() as db:
            agent = (await db.execute(select(Agent).where(Agent.id == agent_id))).scalars().first()
            history = await _history(conv_id, placeholder_id, agent_id, db)
            # The question is already the last history entry; pass it as the prompt.
            if history and history[-1]["role"] == "user":
                history = history[:-1]

            context = ""
            catalog = await _catalog(scope, db)
            if scope.course_ids:
                _status(recipients, conversation_uuid, placeholder_id, "searching", courses=len(scope.course_ids))
                search_query = await _standalone_question(question, history)
                rag = await query_course_rag(question=search_query, org_id=org_id, db_session=db, scope=scope)
                context, sources = rag["context"], rag["sources"]
            _status(recipients, conversation_uuid, placeholder_id, "found", sources=sources, query=search_query)

            _status(recipients, conversation_uuid, placeholder_id, "writing")
            pending = ""
            last_flush = loop.time()
            async for chunk in ask_ai_stream(
                question=question,
                message_history=history,
                text_reference="",
                message_for_the_prompt=_system_prompt(agent, context, catalog, tz),
                model_name=model_for_tier("standard"),
            ):
                full += chunk
                pending += chunk
                if loop.time() - last_flush >= DELTA_FLUSH_SECONDS:
                    realtime.publish_to_users(recipients, {
                        "type": "message.delta",
                        "conversation_uuid": conversation_uuid,
                        "message_id": placeholder_id,
                        "delta": pending,
                    })
                    pending = ""
                    last_flush = loop.time()
            if pending:
                realtime.publish_to_users(recipients, {
                    "type": "message.delta",
                    "conversation_uuid": conversation_uuid,
                    "message_id": placeholder_id,
                    "delta": pending,
                })
            if full.strip():
                follow_ups = await generate_follow_up_suggestions(
                    full, context[:1000], model_for_tier("fast"), question
                )
    except Exception:
        failed = True
        logger.exception("Agent reply failed")

    try:
        async with _async_session_factory() as db:
            msg = (await db.execute(select(Message).where(Message.id == placeholder_id))).scalars().first()
            if msg is None:
                return
            if failed or not full.strip():
                msg.status = "error"
                msg.content = full or "Sorry, I couldn't answer that right now. Please try again."
            else:
                msg.status = "complete"
                msg.content = full
                attachment = {}
                if sources:
                    attachment["sources"] = sources
                if follow_ups:
                    attachment["follow_ups"] = follow_ups
                attachment["courses"] = await _referenced_courses(full, scope, db)
                if requester_id is not None and "```reminder" in full:
                    from src.services.messaging.reminders import create_from_agent_reply

                    conv = (await db.execute(select(Conversation).where(Conversation.id == conv_id))).scalars().first()
                    reminders = await create_from_agent_reply(
                        db,
                        reply_text=full,
                        conversation=conv,
                        agent_id=agent_id,
                        user_id=requester_id,
                        # Delivered in this same thread, right under the reply.
                        source_message_id=None,
                        tz=tz,
                    )
                    if reminders:
                        attachment["reminders"] = reminders
                msg.attachment = attachment or None
            db.add(msg)
            await db.commit()
            await db.refresh(msg)
            payload = await serialize_message(msg, conversation_uuid, None, db)
            realtime.publish_to_users(recipients, {"type": "message.updated", "conversation_uuid": conversation_uuid, "message": payload})
    finally:
        if failed or not full:
            try:
                refund_ai_credit(org_id, 2)
            except Exception:
                logger.debug("agent credit refund failed", exc_info=True)


_COURSE_BLOCK = re.compile(r"```course\s*(\{.*?\})\s*```", re.DOTALL)


async def _referenced_courses(text: str, scope, db: AsyncSession) -> dict:
    """Resolve ```course blocks to cards, limited to courses the asker can read,
    so a hallucinated or foreign uuid renders as nothing."""
    import json as _json

    uuids = []
    for raw in _COURSE_BLOCK.findall(text):
        try:
            uuid = _json.loads(raw).get("course_uuid")
        except Exception:
            continue
        if isinstance(uuid, str):
            uuids.append(uuid)
    if not uuids:
        return {}
    allowed = {g.course_uuid for g in scope.courses.values()}
    rows = (await db.execute(select(Course).where(
        Course.course_uuid.in_([u for u in uuids if u in allowed])  # type: ignore[attr-defined]
    ))).scalars().all()
    from src.services.messaging.messaging import course_card

    return {c.course_uuid: course_card(c) for c in rows}


async def agents_for_message(conv: Conversation, body: MessageCreate, user: User, db: AsyncSession) -> list[Agent]:
    """Which agents should answer this message: the agent in an agent chat,
    plus any agent @mentioned by uuid that the sender can use."""
    agents: list[Agent] = []
    if conv.kind == "agent" and conv.agent_id:
        a = (await db.execute(select(Agent).where(Agent.id == conv.agent_id))).scalars().first()
        if a:
            agents.append(a)
    if conv.kind == "broadcast":
        return agents
    for uuid in body.agent_uuids:
        try:
            a = await get_visible_agent(uuid, user, db)
        except HTTPException:
            continue
        if a.org_id == conv.org_id and all(x.id != a.id for x in agents):
            agents.append(a)
    return agents


async def send_and_reply(
    request: Request,
    conversation_uuid: str,
    body: MessageCreate,
    user: User,
    db: AsyncSession,
) -> dict:
    """POST a message; agents in the thread answer it."""
    from src.services.messaging.messaging import send_message

    conv, msg, payload = await send_message(conversation_uuid, body, user, db)
    replies = []
    errors = []
    for agent in await agents_for_message(conv, body, user, db):
        try:
            replies.append(await trigger_agent_reply(request, conv, agent, msg, user, db, tz=body.tz))
        except HTTPException as e:
            # Rate limits carry a {code, message} envelope; the client shows text.
            detail = e.detail.get("message", "") if isinstance(e.detail, dict) else str(e.detail)
            errors.append({"agent_uuid": agent.agent_uuid, "detail": detail or "The agent couldn't answer."})
    return {"message": payload, "agent_replies": replies, "agent_errors": errors}


async def legacy_copilot_redirect(org_id: int, user: User, db: AsyncSession) -> dict:
    """Where the old copilot entry points should land when messaging is on."""
    await require_messaging(org_id, user.id, db)
    agent = await ensure_default_agent(org_id, db)
    return {"agent_uuid": agent.agent_uuid}
