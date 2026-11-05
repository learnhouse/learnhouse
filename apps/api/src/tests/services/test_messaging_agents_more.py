"""More agent service tests: access edges, history/catalog helpers and the
streamed reply (src/services/messaging/agents.py).

Runs against the in-memory SQLite DB from conftest. Nothing touches Redis:
realtime, rate limits and AI credits are patched.
"""

import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import async_sessionmaker
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.messaging import Agent, Conversation, ConversationMember, Message, MessageReminder
from src.services.ai.rag.access import CourseGrant, RagAccessScope
from src.services.messaging import agents as agents_svc
from src.services.messaging import messaging as svc


@pytest.fixture(autouse=True)
def _ee_mode():
    with patch("src.security.features_utils.resolve.get_deployment_mode", return_value="ee"):
        yield


@pytest.fixture(autouse=True)
def _no_mfa():
    with patch("src.services.messaging.messaging.enforce_org_mfa", new=AsyncMock()), \
         patch("src.services.security.rate_limiting.check_rate_limit", return_value=(True, 0, 0)):
        yield


@pytest.fixture(autouse=True)
def publish():
    with patch("src.services.messaging.realtime.publish_to_users") as p:
        yield p


@pytest.fixture
def sessions(engine):
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    with patch("src.core.events.database._async_session_factory", new=factory):
        yield


async def _row(db, agent_uuid):
    return (await db.execute(select(Agent).where(Agent.agent_uuid == agent_uuid))).scalars().one()


async def _conv(db, conv_uuid):
    return (await db.execute(select(Conversation).where(Conversation.conversation_uuid == conv_uuid))).scalars().one()


# ---------------------------------------------------------------------------
# Access and CRUD edges
# ---------------------------------------------------------------------------


async def test_unknown_agent_is_404(db, org, regular_user):
    with pytest.raises(HTTPException) as exc:
        await agents_svc.get_agent("agent_missing", regular_user, db)
    assert exc.value.status_code == 404


async def test_non_admin_cannot_edit_shared_agent(db, org, admin_user, regular_user):
    shared = await agents_svc.create_agent(agents_svc.AgentCreate(org_id=org.id, name="Helper", visibility="org"), admin_user, db)
    with pytest.raises(HTTPException) as exc:
        await agents_svc.update_agent(shared["agent_uuid"], agents_svc.AgentUpdate(name="Mine"), regular_user, db)
    assert exc.value.status_code == 403


async def test_create_agent_keeps_only_org_courses(db, org, course, regular_user):
    out = await agents_svc.create_agent(agents_svc.AgentCreate(
        org_id=org.id, name="Narrow", course_uuids=["course_forged", course.course_uuid],
    ), regular_user, db)
    assert out["course_uuids"] == [course.course_uuid]


async def test_agent_cap_per_user(db, org, regular_user):
    with patch.object(agents_svc, "AGENTS_PER_USER", 0):
        with pytest.raises(HTTPException) as exc:
            await agents_svc.create_agent(agents_svc.AgentCreate(org_id=org.id, name="One"), regular_user, db)
    assert exc.value.status_code == 400


async def test_update_agent_courses_starters_and_sharing(db, org, course, regular_user):
    mine = await agents_svc.create_agent(agents_svc.AgentCreate(org_id=org.id, name="Mine"), regular_user, db)
    with pytest.raises(HTTPException) as exc:
        await agents_svc.update_agent(mine["agent_uuid"], agents_svc.AgentUpdate(visibility="org"), regular_user, db)
    assert exc.value.status_code == 403

    out = await agents_svc.update_agent(mine["agent_uuid"], agents_svc.AgentUpdate(
        course_uuids=[course.course_uuid, "course_forged"], starters=["  Quiz me  ", "   "],
    ), regular_user, db)
    assert out["course_uuids"] == [course.course_uuid]
    assert out["starters"] == ["Quiz me"]


async def test_delete_own_agent(db, org, regular_user):
    mine = await agents_svc.create_agent(agents_svc.AgentCreate(org_id=org.id, name="Mine"), regular_user, db)
    assert await agents_svc.delete_agent(mine["agent_uuid"], regular_user, db) == {"deleted": True}
    with pytest.raises(HTTPException):
        await agents_svc.get_agent(mine["agent_uuid"], regular_user, db)


async def test_legacy_copilot_redirect(db, org, regular_user):
    out = await agents_svc.legacy_copilot_redirect(org.id, regular_user, db)
    copilot = (await agents_svc.list_agents(org.id, regular_user, db))[0]
    assert out == {"agent_uuid": copilot["agent_uuid"]}


async def test_broadcast_ignores_agent_mentions(db, org, admin_user):
    copilot = (await agents_svc.list_agents(org.id, admin_user, db))[0]
    out = await svc.send_broadcast(svc.BroadcastCreate(org_id=org.id, content="all"), admin_user, db)
    conv = await _conv(db, out["conversation"]["conversation_uuid"])
    body = svc.MessageCreate(content="@Copilot", agent_uuids=[copilot["agent_uuid"]])
    assert await agents_svc.agents_for_message(conv, body, admin_user, db) == []


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def test_standalone_question():
    history = [{"role": "user", "content": "Tell me about DNS"}, {"role": "model", "content": "DNS maps names."}]
    assert await agents_svc._standalone_question("and the second one?", []) == "and the second one?"
    with patch("src.services.ai.llm.client.generate", new=AsyncMock(return_value='"DNS record types"')):
        assert await agents_svc._standalone_question("and types?", history) == "DNS record types"
    with patch("src.services.ai.llm.client.generate", new=AsyncMock(return_value="x")):
        assert await agents_svc._standalone_question("and types?", history) == "and types?"
    with patch("src.services.ai.llm.client.generate", new=AsyncMock(side_effect=RuntimeError("down"))):
        assert await agents_svc._standalone_question("and types?", history) == "and types?"


async def test_catalog(db, org, course, admin_user):
    empty = RagAccessScope(request=MagicMock(), current_user=admin_user, org_id=org.id)
    assert await agents_svc._catalog(empty, db) == []
    scope = RagAccessScope(request=MagicMock(), current_user=admin_user, org_id=org.id,
                           courses={course.id: CourseGrant(course_uuid=course.course_uuid)})
    assert await agents_svc._catalog(scope, db) == [{"course_uuid": course.course_uuid, "name": course.name}]


async def test_referenced_courses_skips_bad_blocks(db, course):
    scope = MagicMock(courses={})
    assert await agents_svc._referenced_courses("no blocks here", scope, db) == {}
    assert await agents_svc._referenced_courses("```course\n{not json}\n```", scope, db) == {}


async def test_share_scope_skips_missing_members(db, org, admin_user, regular_user):
    group = await svc.create_conversation(svc.ConversationCreate(
        org_id=org.id, kind="group", user_uuids=[regular_user.user_uuid]), admin_user, db)
    conv = await _conv(db, group["conversation_uuid"])
    db.add(ConversationMember(conversation_id=conv.id, user_id=999, role="member", joined_at=svc.now_iso()))
    await db.commit()
    scope = RagAccessScope(request=MagicMock(), current_user=admin_user, org_id=org.id,
                           courses={1: CourseGrant(course_uuid="course_open")})

    async def grant(request, user, course_uuid, db_session, raise_on_deny):
        return CourseGrant(course_uuid=course_uuid)

    with patch("src.services.ai.rag.access._grant_for_course", new=grant):
        await agents_svc._share_scope(MagicMock(), scope, conv, admin_user.id, db)
    assert list(scope.courses) == [1]
    assert [r.current_user.id for r in scope.co_readers] == [regular_user.id]


async def test_group_reply_shares_scope_and_course(db, org, course, admin_user, regular_user):
    copilot = await _row(db, (await agents_svc.list_agents(org.id, admin_user, db))[0]["agent_uuid"])
    group = await svc.create_conversation(svc.ConversationCreate(
        org_id=org.id, kind="group", user_uuids=[regular_user.user_uuid]), admin_user, db)
    conv, msg, _ = await svc.send_message(group["conversation_uuid"], svc.MessageCreate(
        content="@Copilot what's this?", course_uuid=course.course_uuid), admin_user, db)

    share = AsyncMock()
    stream = MagicMock(return_value=None)
    with patch.object(agents_svc, "_ai_gate", new=AsyncMock()), \
         patch("src.services.security.rate_limiting.enforce_ai_rate_limit"), \
         patch("src.services.ai.rag.access.build_rag_access_scope", new=AsyncMock(return_value=MagicMock())), \
         patch("src.security.features_utils.usage.reserve_ai_credit", new=AsyncMock()), \
         patch.object(agents_svc, "_share_scope", new=share), \
         patch.object(agents_svc, "_stream_reply", new=stream), \
         patch.object(agents_svc.asyncio, "create_task", new=MagicMock()), \
         patch("src.services.analytics.analytics.track", new=AsyncMock()) as mock_track:
        out = await agents_svc.trigger_agent_reply(MagicMock(), conv, copilot, msg, admin_user, db)
    share.assert_awaited_once()
    mock_track.assert_awaited_once()
    assert mock_track.await_args.kwargs["event_name"] == "ai_message_sent"
    assert mock_track.await_args.kwargs["org_id"] == org.id
    assert mock_track.await_args.kwargs["user_id"] == admin_user.id
    assert mock_track.await_args.kwargs["properties"]["surface"] == "copilot"
    assert isinstance(mock_track.await_args.kwargs["properties"]["model"], str)
    assert out["status"] == "streaming"
    assert f"(Shared course: {course.name})" in stream.call_args.kwargs["question"]


# ---------------------------------------------------------------------------
# Streamed reply
# ---------------------------------------------------------------------------


async def _chat(db, org, user):
    """An agent chat with a greeting, an empty message, a question and the
    placeholder the reply streams into."""
    copilot = await _row(db, (await agents_svc.list_agents(org.id, user, db))[0]["agent_uuid"])
    view = await agents_svc.open_agent_chat(copilot.agent_uuid, agents_svc.AgentChatOpen(), user, db)
    conv = await _conv(db, view["conversation_uuid"])
    db.add(Message(message_uuid="message_blank", conversation_id=conv.id, org_id=org.id,
                   sender_user_id=user.id, kind="text", content="", creation_date=svc.now_iso()))
    await db.commit()
    await svc.send_message(conv.conversation_uuid, svc.MessageCreate(content="What is DNS?"), user, db)
    placeholder = Message(message_uuid="message_reply", conversation_id=conv.id, org_id=org.id,
                          sender_agent_id=copilot.id, kind="text", content="", status="streaming",
                          creation_date=svc.now_iso())
    db.add(placeholder)
    await db.commit()
    await db.refresh(placeholder)
    return copilot, conv, placeholder


def _kwargs(conv, copilot, placeholder, scope, user, **kw):
    return dict(conv_id=conv.id, conversation_uuid=conv.conversation_uuid, org_id=conv.org_id,
                agent_id=copilot.id, placeholder_id=placeholder.id, question="What is DNS?",
                scope=scope, recipients=[user.id], requester_id=user.id, **kw)


async def test_stream_reply_success(db, org, course, regular_user, sessions, publish):
    copilot, conv, placeholder = await _chat(db, org, regular_user)
    scope = RagAccessScope(request=MagicMock(), current_user=regular_user, org_id=org.id,
                           courses={course.id: CourseGrant(course_uuid=course.course_uuid)})
    due = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    chunks = [
        "DNS maps names [1]. ",
        f'```course\n{{"course_uuid": "{course.course_uuid}"}}\n```\n',
        f'```reminder\n{{"text": "Review DNS", "due_at": "{due}"}}\n```',
    ]

    async def ask_ai_stream(**kwargs):
        assert kwargs["message_history"][-1]["role"] == "model"
        yield chunks[0]
        await asyncio.sleep(agents_svc.DELTA_FLUSH_SECONDS + 0.01)
        yield chunks[1]
        yield chunks[2]

    rag = AsyncMock(return_value={"context": "DNS is the phonebook.", "sources": [{"title": "Lesson 1"}]})
    refund = MagicMock()
    with patch("src.services.ai.base.ask_ai_stream", new=ask_ai_stream), \
         patch("src.services.ai.base.generate_follow_up_suggestions", new=AsyncMock(return_value=["Next?"])), \
         patch("src.services.ai.rag.query_service.query_course_rag", new=rag), \
         patch.object(agents_svc, "_standalone_question", new=AsyncMock(return_value="DNS basics")), \
         patch("src.security.features_utils.usage.refund_ai_credit", new=refund):
        await agents_svc._stream_reply(**_kwargs(conv, copilot, placeholder, scope, regular_user))

    assert rag.call_args.kwargs["question"] == "DNS basics"
    events = [c.args[2] for c in publish.call_args_list]
    assert [e["phase"] for e in events if e["type"] == "agent.status"] == ["searching", "found", "writing"]
    deltas = [e["delta"] for e in events if e["type"] == "message.delta"]
    assert "".join(deltas) == "".join(chunks) and len(deltas) == 2
    assert events[-1]["type"] == "message.updated"
    refund.assert_not_called()

    await db.refresh(placeholder)
    assert placeholder.status == "complete" and placeholder.content == "".join(chunks)
    att = placeholder.attachment
    assert att["sources"] == [{"title": "Lesson 1"}] and att["follow_ups"] == ["Next?"]
    assert list(att["courses"]) == [course.course_uuid]
    assert att["reminders"][0]["text"] == "Review DNS"
    assert (await db.execute(select(MessageReminder))).scalars().one().user_id == regular_user.id


async def test_stream_reply_error_refunds(db, org, regular_user, sessions, publish):
    copilot, conv, placeholder = await _chat(db, org, regular_user)
    scope = RagAccessScope(request=MagicMock(), current_user=regular_user, org_id=org.id)

    async def ask_ai_stream(**kwargs):
        raise RuntimeError("model down")
        yield ""

    refund = MagicMock(side_effect=RuntimeError("no redis"))
    with patch("src.services.ai.base.ask_ai_stream", new=ask_ai_stream), \
         patch("src.security.features_utils.usage.refund_ai_credit", new=refund):
        await agents_svc._stream_reply(**_kwargs(conv, copilot, placeholder, scope, regular_user))

    refund.assert_called_once_with(org.id, 2)
    await db.refresh(placeholder)
    assert placeholder.status == "error"
    assert placeholder.content.startswith("Sorry")
    assert publish.call_args.args[2]["type"] == "message.updated"


async def test_stream_reply_missing_placeholder(db, org, regular_user, sessions, publish):
    copilot, conv, placeholder = await _chat(db, org, regular_user)
    await db.delete(placeholder)
    await db.commit()
    scope = RagAccessScope(request=MagicMock(), current_user=regular_user, org_id=org.id)

    async def ask_ai_stream(**kwargs):
        for chunk in ():
            yield chunk

    refund = MagicMock()
    with patch("src.services.ai.base.ask_ai_stream", new=ask_ai_stream), \
         patch("src.security.features_utils.usage.refund_ai_credit", new=refund):
        await agents_svc._stream_reply(**_kwargs(conv, copilot, placeholder, scope, regular_user))

    refund.assert_called_once_with(org.id, 2)
    assert all(c.args[2]["type"] != "message.updated" for c in publish.call_args_list)
