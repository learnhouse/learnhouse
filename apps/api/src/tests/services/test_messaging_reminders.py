"""Tests for agent and personal reminders (src/services/messaging/reminders.py)."""

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.messaging import Agent, Message, MessageReminder, MessagingProfile
from src.db.users import User
from src.services.messaging import agents as agents_svc
from src.services.messaging import messaging as svc
from src.services.messaging import notify
from src.services.messaging import reminders as rem


@pytest.fixture(autouse=True)
def _ee_mode():
    with patch("src.security.features_utils.resolve.get_deployment_mode", return_value="ee"), \
         patch("src.services.messaging.messaging.enforce_org_mfa", new=AsyncMock()), \
         patch("src.services.security.rate_limiting.check_rate_limit", return_value=(True, 0, 0)):
        yield


NOW = datetime(2026, 11, 3, 8, 0, tzinfo=timezone.utc)


def test_parse_due_rules():
    # Offset given: converted to UTC.
    assert rem.parse_due("2026-11-03T10:00:00+01:00", None, NOW) == datetime(2026, 11, 3, 9, 0, tzinfo=timezone.utc)
    # No offset: read in the person's zone.
    assert rem.parse_due("2026-11-03T10:00:00", "Europe/Paris", NOW) == datetime(2026, 11, 3, 9, 0, tzinfo=timezone.utc)
    assert rem.parse_due("2026-11-03T10:00:00Z", "Not/AZone", NOW) == datetime(2026, 11, 3, 10, 0, tzinfo=timezone.utc)
    # Past, too far, garbage.
    assert rem.parse_due("2026-11-02T10:00:00Z", None, NOW) is None
    assert rem.parse_due("2028-01-01T10:00:00Z", None, NOW) is None
    assert rem.parse_due("tomorrow", None, NOW) is None


def test_time_context_uses_learner_zone():
    line = agents_svc._time_context("Europe/Paris", NOW)
    assert "2026-11-03 09:00" in line and "Europe/Paris" in line and "UTC+01:00" in line
    assert "UTC" in agents_svc._time_context(None, NOW)


def test_prompt_documents_new_blocks():
    prompt = agents_svc._system_prompt(Agent(org_id=1, name="A"), "", None, "UTC")
    for block in ("```chart", "```mindmap", "```timeline", "```exercise", "```reminder", "Current time"):
        assert block in prompt


async def _agent_chat(db, org, user):
    default = (await agents_svc.list_agents(org.id, user, db))[0]
    conv = await agents_svc.open_agent_chat(default["agent_uuid"], agents_svc.AgentChatOpen(), user, db)
    return default, conv


async def test_agent_reply_creates_reminders(db, org, regular_user):
    default, conv_data = await _agent_chat(db, org, regular_user)
    from src.db.messaging import Conversation

    conv = (await db.execute(select(Conversation).where(Conversation.conversation_uuid == conv_data["conversation_uuid"]))).scalars().one()
    future = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    text = (
        f'Done.\n```reminder\n{{"text": "Review chapter 2", "due_at": "{future}"}}\n```\n'
        '```reminder\n{"text": "Too late", "due_at": "2020-01-01T00:00:00Z"}\n```\n'
        '```reminder\nnot json\n```'
    )
    out = await rem.create_from_agent_reply(
        db, reply_text=text, conversation=conv, agent_id=default["id"], user_id=regular_user.id,
        source_message_id=None, tz=None,
    )
    await db.commit()
    assert [r["text"] for r in out] == ["Review chapter 2"]
    assert out[0]["status"] == "pending"

    listed = await rem.list_reminders(org.id, regular_user, db)
    assert listed[0]["reminder_uuid"] == out[0]["reminder_uuid"]
    assert listed[0]["conversation_uuid"] == conv.conversation_uuid


async def test_personal_reminder_cancel_and_live_status(db, org, admin_user, regular_user):
    dm = await svc.create_conversation(svc.ConversationCreate(org_id=org.id, user_uuids=[admin_user.user_uuid]), regular_user, db)
    _, msg, _ = await svc.send_message(dm["conversation_uuid"], svc.MessageCreate(content="Exam is Friday"), regular_user, db)
    due = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()

    r = await rem.create_personal(rem.ReminderCreate(org_id=org.id, text="Study!", due_at=due, message_uuid=msg.message_uuid), regular_user, db)
    assert r["status"] == "pending" and r["conversation_uuid"]

    with pytest.raises(HTTPException):
        await rem.create_personal(rem.ReminderCreate(org_id=org.id, text="x", due_at="2020-01-01T00:00:00Z"), regular_user, db)
    # Others can't cancel it.
    with pytest.raises(HTTPException) as exc:
        await rem.cancel_reminder(r["reminder_uuid"], admin_user, db)
    assert exc.value.status_code == 404

    # A message carrying the reminder card shows the live status.
    db.add(Message(message_uuid="message_card", conversation_id=dm["id"], org_id=org.id, content="ok",
                   attachment={"reminders": [{"reminder_uuid": r["reminder_uuid"], "status": "pending"}]}))
    await db.commit()
    assert (await rem.cancel_reminder(r["reminder_uuid"], regular_user, db))["status"] == "cancelled"
    page = await svc.list_messages(dm["conversation_uuid"], regular_user, db)
    card = next(m for m in page["messages"] if m["message_uuid"] == "message_card")
    assert card["attachment"]["reminders"][0]["status"] == "cancelled"
    # And the stored row is untouched.
    stored = (await db.execute(select(Message).where(Message.message_uuid == "message_card"))).scalars().one()
    assert stored.attachment["reminders"][0]["status"] == "pending"


async def test_personal_reminder_on_foreign_message_is_404(db, org, admin_user, regular_user):
    now = str(datetime.now())
    db.add(User(id=7, username="x", first_name="X", last_name="Y", email="x@y.z", password="x", user_uuid="user_x",
                creation_date=now, update_date=now))
    from src.db.user_organizations import UserOrganization

    db.add(UserOrganization(user_id=7, org_id=org.id, role_id=4, creation_date=now, update_date=now))
    await db.commit()
    dm = await svc.create_conversation(svc.ConversationCreate(org_id=org.id, user_uuids=["user_x"]), admin_user, db)
    _, msg, _ = await svc.send_message(dm["conversation_uuid"], svc.MessageCreate(content="private"), admin_user, db)
    due = (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()
    with pytest.raises(HTTPException) as exc:
        await rem.create_personal(rem.ReminderCreate(org_id=org.id, text="t", due_at=due, message_uuid=msg.message_uuid), regular_user, db)
    assert exc.value.status_code == 404


async def test_deliver_due_sends_once(db, org, regular_user):
    default, conv = await _agent_chat(db, org, regular_user)
    due = (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat()
    r = await rem.create_personal(rem.ReminderCreate(org_id=org.id, text="Stand up and stretch", due_at=due), regular_user, db)

    assert await rem.deliver_due(db) == 0  # not due yet
    later = datetime.now(timezone.utc) + timedelta(minutes=10)
    with patch("src.services.messaging.realtime.publish_to_users") as publish:
        assert await rem.deliver_due(db, later) == 1
    event = publish.call_args.args[2]
    assert event["type"] == "message.new"
    assert event["message"]["kind"] == "reminder"
    assert event["message"]["content"] == "Stand up and stretch"
    assert event["message"]["sender"]["type"] == "agent"
    assert await rem.deliver_due(db, later) == 0

    listed = await rem.list_reminders(org.id, regular_user, db)
    assert listed[0]["reminder_uuid"] == r["reminder_uuid"] and listed[0]["status"] == "sent"
    with pytest.raises(HTTPException):
        await rem.cancel_reminder(r["reminder_uuid"], regular_user, db)
    # It counts as unread.
    assert (await svc.unread_total(org.id, regular_user, db))["unread"] == 1


async def test_cancelled_reminders_are_not_delivered(db, org, regular_user):
    await _agent_chat(db, org, regular_user)
    due = (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat()
    r = await rem.create_personal(rem.ReminderCreate(org_id=org.id, text="nope", due_at=due), regular_user, db)
    await rem.cancel_reminder(r["reminder_uuid"], regular_user, db)
    assert await rem.deliver_due(db, datetime.now(timezone.utc) + timedelta(hours=1)) == 0
    assert (await db.execute(select(MessageReminder))).scalars().one().sent_at is None


async def test_pending_cap(db, org, regular_user):
    await _agent_chat(db, org, regular_user)
    due = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
    with patch.object(rem, "MAX_PENDING_PER_USER", 1):
        await rem.create_personal(rem.ReminderCreate(org_id=org.id, text="1", due_at=due), regular_user, db)
        with pytest.raises(HTTPException):
            await rem.create_personal(rem.ReminderCreate(org_id=org.id, text="2", due_at=due), regular_user, db)


def test_reminders_always_email_unless_off():
    user = User(id=2, username="sam", first_name="Sam", last_name="", email="s@x.com", password="")
    group = MagicMock(kind="group")
    reminder = Message(conversation_id=1, org_id=1, kind="reminder", content="Quiz at 3")
    assert notify.wants_email(MessagingProfile(user_id=2, email_mode="direct"), group, reminder, user, None)
    assert not notify.wants_email(MessagingProfile(user_id=2, email_mode="off"), group, reminder, user, None)


async def test_send_passes_timezone_to_agents(db, org, regular_user):
    _, conv = await _agent_chat(db, org, regular_user)
    trigger = AsyncMock(return_value={})
    with patch("src.services.messaging.agents.trigger_agent_reply", trigger):
        await agents_svc.send_and_reply(MagicMock(), conv["conversation_uuid"],
                                        svc.MessageCreate(content="remind me at 5", tz="Europe/Paris"), regular_user, db)
    assert trigger.call_args.kwargs["tz"] == "Europe/Paris"
