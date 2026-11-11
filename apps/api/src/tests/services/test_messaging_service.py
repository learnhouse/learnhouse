"""Service tests for messaging and agents (src/services/messaging/).

Runs against the in-memory SQLite DB from conftest. Redis is absent, so
realtime fan-out is a no-op; it is patched where a test asserts on it.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.messaging import Agent, Conversation, ConversationMember, Message, MessagingProfile
from src.db.organization_config import OrganizationConfig
from src.db.resource_authors import (
    ResourceAuthor,
    ResourceAuthorshipEnum,
    ResourceAuthorshipStatusEnum,
)
from src.db.trail_runs import TrailRun
from src.db.trails import Trail
from src.db.user_organizations import UserOrganization
from src.db.users import PublicUser, User
from src.services.messaging import agents as agents_svc
from src.services.messaging import messaging as svc
from src.services.messaging import notify


def _mode(mode: str):
    return patch("src.security.features_utils.resolve.get_deployment_mode", return_value=mode)


@pytest.fixture(autouse=True)
def _ee_mode():
    """Messaging is EE-only self-hosted; most tests run as EE."""
    with _mode("ee"):
        yield


@pytest.fixture(autouse=True)
def _no_mfa():
    # The send-rate limit lives in Redis, which unit tests don't run.
    with patch("src.services.messaging.messaging.enforce_org_mfa", new=AsyncMock()), \
         patch("src.services.security.rate_limiting.check_rate_limit", return_value=(True, 0, 0)):
        yield


async def _user(db, org, uid: int, username: str, role_id: int = 4) -> PublicUser:
    now = str(datetime.now())
    u = User(
        id=uid, username=username, first_name=username.title(), last_name="Test",
        email=f"{username}@test.com", password="x", user_uuid=f"user_{username}",
        creation_date=now, update_date=now,
    )
    db.add(u)
    db.add(UserOrganization(user_id=uid, org_id=org.id, role_id=role_id, creation_date=now, update_date=now))
    await db.commit()
    return PublicUser(id=uid, username=username, first_name=u.first_name, last_name="Test",
                      email=u.email, user_uuid=u.user_uuid)


async def _dm(db, org, a, b) -> dict:
    return await svc.create_conversation(
        svc.ConversationCreate(org_id=org.id, kind="dm", user_uuids=[b.user_uuid]), a, db
    )


async def _send(db, conv_uuid, user, text="hello", **kw):
    _, msg, payload = await svc.send_message(conv_uuid, svc.MessageCreate(content=text, **kw), user, db)
    return msg, payload


# ---------------------------------------------------------------------------
# Gating: Pro in SaaS, EE-only self-hosted
# ---------------------------------------------------------------------------


async def test_oss_blocks_messaging(db, org, admin_user):
    with _mode("oss"):
        with pytest.raises(HTTPException) as exc:
            await svc.list_conversations(org.id, admin_user.id, db)
    assert exc.value.status_code == 403
    assert "Enterprise" in exc.value.detail


@pytest.mark.parametrize("plan", ["free", "personal", "standard", "pro", "enterprise"])
async def test_saas_allows_every_plan(db, org, admin_user, plan):
    db.add(OrganizationConfig(org_id=org.id, config={"config_version": "2.0", "plan": plan},
                              creation_date="", update_date=""))
    await db.commit()
    with _mode("saas"):
        assert await svc.list_conversations(org.id, admin_user.id, db) == []


async def test_admin_toggle_disables_in_ee(db, org, admin_user):
    db.add(OrganizationConfig(org_id=org.id, config={
        "config_version": "2.0", "plan": "free", "admin_toggles": {"messaging": {"disabled": True}},
    }, creation_date="", update_date=""))
    await db.commit()
    with pytest.raises(HTTPException) as exc:
        await svc.list_conversations(org.id, admin_user.id, db)
    assert "disabled" in exc.value.detail


async def test_non_member_is_rejected(db, org, other_org, admin_user):
    with pytest.raises(HTTPException) as exc:
        await svc.list_conversations(other_org.id, admin_user.id, db)
    assert exc.value.status_code == 403


# ---------------------------------------------------------------------------
# DMs, messages, reads, reactions
# ---------------------------------------------------------------------------


async def test_dm_is_get_or_create(db, org, admin_user, regular_user):
    first = await _dm(db, org, admin_user, regular_user)
    again = await _dm(db, org, regular_user, admin_user)
    assert first["conversation_uuid"] == again["conversation_uuid"]
    assert first["kind"] == "dm"
    assert {m["id"] for m in first["members"]} == {admin_user.id, regular_user.id}


async def test_dm_requires_exactly_one_other(db, org, admin_user):
    with pytest.raises(HTTPException):
        await svc.create_conversation(svc.ConversationCreate(org_id=org.id, kind="dm", user_uuids=[]), admin_user, db)


async def test_dm_with_outsider_is_404(db, org, other_org, admin_user):
    now = str(datetime.now())
    db.add(User(id=50, username="out", first_name="Out", last_name="S", email="o@x.com",
                password="x", user_uuid="user_out", creation_date=now, update_date=now))
    db.add(UserOrganization(user_id=50, org_id=other_org.id, role_id=4, creation_date=now, update_date=now))
    await db.commit()
    with pytest.raises(HTTPException) as exc:
        await svc.create_conversation(svc.ConversationCreate(org_id=org.id, user_uuids=["user_out"]), admin_user, db)
    assert exc.value.status_code == 404


async def test_dm_respects_allow_dms(db, org, regular_user, user_role):
    third = await _user(db, org, 3, "third")
    db.add(MessagingProfile(user_id=regular_user.id, allow_dms=False))
    await db.commit()
    with pytest.raises(HTTPException) as exc:
        await _dm(db, org, third, regular_user)
    assert exc.value.status_code == 403


async def test_groups_respect_allow_dms(db, org, admin_user, regular_user, user_role):
    third = await _user(db, org, 3, "third")
    db.add(MessagingProfile(user_id=regular_user.id, allow_dms=False))
    await db.commit()
    with pytest.raises(HTTPException) as exc:
        await svc.create_conversation(svc.ConversationCreate(
            org_id=org.id, kind="group", user_uuids=[regular_user.user_uuid]), third, db)
    assert exc.value.status_code == 403

    group = await svc.create_conversation(svc.ConversationCreate(
        org_id=org.id, kind="group", user_uuids=[admin_user.user_uuid]), third, db)
    with pytest.raises(HTTPException) as exc:
        await svc.add_members(group["conversation_uuid"], svc.MembersAdd(user_uuids=[regular_user.user_uuid]), third, db)
    assert "isn't accepting" in exc.value.detail
    # Admins can still bring them in.
    added = await svc.add_members(group["conversation_uuid"], svc.MembersAdd(user_uuids=[regular_user.user_uuid]), admin_user, db)
    assert added["member_count"] == 3


async def test_invisible_people_are_not_listed_online(db, org, admin_user, regular_user):
    db.add(MessagingProfile(user_id=regular_user.id, availability="invisible"))
    await db.commit()
    with patch.object(svc.realtime, "online_user_ids", return_value={admin_user.id, regular_user.id}):
        assert await svc.visible_online_ids(org.id, db) == {admin_user.id}
    with patch.object(svc.realtime, "online_user_ids", return_value=set()):
        assert await svc.visible_online_ids(org.id, db) == set()


async def test_messages_unread_and_read(db, org, admin_user, regular_user):
    conv = await _dm(db, org, admin_user, regular_user)
    await _send(db, conv["conversation_uuid"], admin_user, "one")
    await _send(db, conv["conversation_uuid"], admin_user, "two")

    listed = await svc.list_conversations(org.id, regular_user.id, db)
    assert listed[0]["unread_count"] == 2
    assert listed[0]["last_message"]["content"] == "two"
    assert (await svc.unread_total(org.id, regular_user, db))["unread"] == 2
    # The sender has nothing unread.
    assert (await svc.list_conversations(org.id, admin_user.id, db))[0]["unread_count"] == 0

    await svc.mark_read(conv["conversation_uuid"], svc.ReadUpdate(), regular_user, db)
    assert (await svc.unread_total(org.id, regular_user, db))["unread"] == 0

    page = await svc.list_messages(conv["conversation_uuid"], regular_user, db, limit=1)
    assert page["has_more"] is True
    assert page["messages"][0]["content"] == "two"


async def test_outsider_cannot_read_conversation(db, org, admin_user, regular_user):
    conv = await _dm(db, org, admin_user, regular_user)
    third = await _user(db, org, 3, "third")
    with pytest.raises(HTTPException) as exc:
        await svc.list_messages(conv["conversation_uuid"], third, db)
    assert exc.value.status_code == 404


async def test_empty_message_rejected(db, org, admin_user, regular_user):
    conv = await _dm(db, org, admin_user, regular_user)
    with pytest.raises(HTTPException) as exc:
        await _send(db, conv["conversation_uuid"], admin_user, "   ")
    assert exc.value.status_code == 400


async def test_reply_and_course_share(db, org, course, admin_user, regular_user):
    conv = await _dm(db, org, admin_user, regular_user)
    first, _ = await _send(db, conv["conversation_uuid"], admin_user, "check this")
    _, payload = await _send(db, conv["conversation_uuid"], regular_user, "",
                             course_uuid=course.course_uuid, reply_to_uuid=first.message_uuid)
    assert payload["kind"] == "course_share"
    assert payload["attachment"]["course"]["name"] == course.name
    assert payload["reply_to"]["content"] == "check this"


async def test_cannot_share_unpublished_course_unless_author(db, org, course, admin_user, regular_user):
    course.published = False
    db.add(course)
    await db.commit()
    conv = await _dm(db, org, admin_user, regular_user)
    with pytest.raises(HTTPException) as exc:
        await _send(db, conv["conversation_uuid"], regular_user, "x", course_uuid=course.course_uuid)
    assert exc.value.status_code == 404
    # Admins can.
    _, payload = await _send(db, conv["conversation_uuid"], admin_user, "x", course_uuid=course.course_uuid)
    assert payload["kind"] == "course_share"


async def test_reactions_toggle(db, org, admin_user, regular_user):
    conv = await _dm(db, org, admin_user, regular_user)
    msg, _ = await _send(db, conv["conversation_uuid"], admin_user)
    out = await svc.toggle_reaction(msg.message_uuid, svc.ReactionToggle(emoji="🔥"), regular_user, db)
    assert out["reactions"] == [{"emoji": "🔥", "count": 1, "user_ids": [regular_user.id], "me": True}]
    out = await svc.toggle_reaction(msg.message_uuid, svc.ReactionToggle(emoji="🔥"), admin_user, db)
    assert out["reactions"][0]["count"] == 2
    out = await svc.toggle_reaction(msg.message_uuid, svc.ReactionToggle(emoji="🔥"), admin_user, db)
    assert out["reactions"][0]["count"] == 1


async def test_edit_and_delete_own_only(db, org, admin_user, regular_user):
    conv = await _dm(db, org, admin_user, regular_user)
    msg, _ = await _send(db, conv["conversation_uuid"], admin_user, "typo")
    with pytest.raises(HTTPException):
        await svc.edit_message(msg.message_uuid, svc.MessageEdit(content="nope"), regular_user, db)
    edited = await svc.edit_message(msg.message_uuid, svc.MessageEdit(content="fixed"), admin_user, db)
    assert edited["content"] == "fixed" and edited["edited_at"]
    with pytest.raises(HTTPException):
        await svc.delete_message(msg.message_uuid, regular_user, db)
    await svc.delete_message(msg.message_uuid, admin_user, db)
    page = await svc.list_messages(conv["conversation_uuid"], regular_user, db)
    assert page["messages"][0]["deleted"] is True and page["messages"][0]["content"] == ""


async def test_realtime_fanout_on_send(db, org, admin_user, regular_user):
    conv = await _dm(db, org, admin_user, regular_user)
    with patch("src.services.messaging.realtime.publish_to_users") as publish:
        await _send(db, conv["conversation_uuid"], admin_user, "hi")
    org_id, users, event = publish.call_args.args
    assert org_id == org.id and set(users) == {admin_user.id, regular_user.id}
    assert event["type"] == "message.new" and event["message"]["content"] == "hi"


async def test_read_receipts_off_only_tells_reader(db, org, admin_user, regular_user):
    conv = await _dm(db, org, admin_user, regular_user)
    await _send(db, conv["conversation_uuid"], admin_user, "hi")
    db.add(MessagingProfile(user_id=regular_user.id, read_receipts=False))
    await db.commit()
    with patch("src.services.messaging.realtime.publish_to_users") as publish:
        await svc.mark_read(conv["conversation_uuid"], svc.ReadUpdate(), regular_user, db)
    assert publish.call_args.args[1] == [regular_user.id]
    seen = (await svc.list_conversations(org.id, admin_user.id, db))[0]["members"]
    assert next(m for m in seen if m["id"] == regular_user.id)["last_read_message_id"] is None


# ---------------------------------------------------------------------------
# Groups
# ---------------------------------------------------------------------------


async def test_group_lifecycle(db, org, admin_user, regular_user):
    third = await _user(db, org, 3, "third")
    conv = await svc.create_conversation(svc.ConversationCreate(
        org_id=org.id, kind="group", user_uuids=[regular_user.user_uuid], title="Study group", emoji="📚"
    ), admin_user, db)
    assert conv["title"] == "Study group" and conv["my_role"] == "owner"

    conv = await svc.add_members(conv["conversation_uuid"], svc.MembersAdd(user_uuids=[third.user_uuid]), admin_user, db)
    assert conv["member_count"] == 3

    with pytest.raises(HTTPException):
        await svc.update_conversation(conv["conversation_uuid"], svc.ConversationUpdate(title="Mine"), third, db)

    await svc.leave_conversation(conv["conversation_uuid"], third, db)
    with pytest.raises(HTTPException):
        await svc.list_messages(conv["conversation_uuid"], third, db)


# ---------------------------------------------------------------------------
# Broadcasts
# ---------------------------------------------------------------------------


async def _enroll(db, org, course, user_id):
    now = str(datetime.now())
    trail = Trail(org_id=org.id, user_id=user_id, trail_uuid=f"trail_{user_id}", creation_date=now, update_date=now)
    db.add(trail)
    await db.commit()
    await db.refresh(trail)
    db.add(TrailRun(trail_id=trail.id, course_id=course.id, org_id=org.id, user_id=user_id,
                    creation_date=now, update_date=now))
    await db.commit()


async def test_broadcast_reaches_learners_and_only_team_posts(db, org, course, admin_user, regular_user):
    teacher = await _user(db, org, 3, "teacher")
    learner = await _user(db, org, 5, "learner")
    db.add(ResourceAuthor(resource_uuid=course.course_uuid, user_id=teacher.id,
                          authorship=ResourceAuthorshipEnum.CREATOR,
                          authorship_status=ResourceAuthorshipStatusEnum.ACTIVE))
    await db.commit()
    await _enroll(db, org, course, regular_user.id)
    await _enroll(db, org, course, learner.id)

    with pytest.raises(HTTPException) as exc:
        await svc.send_broadcast(svc.BroadcastCreate(org_id=org.id, course_uuid=course.course_uuid, content="hi"), learner, db)
    assert exc.value.status_code == 403

    targets = await svc.broadcast_targets(org.id, teacher, db)
    assert [t["course_uuid"] for t in targets] == [course.course_uuid]
    assert targets[0]["learners"] == 2

    out = await svc.send_broadcast(svc.BroadcastCreate(
        org_id=org.id, course_uuid=course.course_uuid, content="Exam on Friday", share_course=True
    ), teacher, db)
    assert out["recipients"] == 2
    assert out["message"]["kind"] == "announcement"
    assert out["message"]["attachment"]["course"]["course_uuid"] == course.course_uuid

    channel = out["conversation"]["conversation_uuid"]
    with pytest.raises(HTTPException) as exc:
        await _send(db, channel, learner, "can I post?")
    assert exc.value.status_code == 403
    # Learners see it unread and can react.
    assert (await svc.unread_total(org.id, learner, db))["unread"] == 1
    await svc.toggle_reaction(out["message"]["message_uuid"], svc.ReactionToggle(emoji="👍"), learner, db)

    # A second broadcast reuses the channel.
    again = await svc.send_broadcast(svc.BroadcastCreate(org_id=org.id, course_uuid=course.course_uuid, content="2"), teacher, db)
    assert again["conversation"]["conversation_uuid"] == channel


async def test_leaving_the_course_team_ends_posting_rights(db, org, course):
    teacher = await _user(db, org, 3, "teacher")
    colleague = await _user(db, org, 5, "colleague")
    author = ResourceAuthor(resource_uuid=course.course_uuid, user_id=teacher.id,
                            authorship=ResourceAuthorshipEnum.CREATOR,
                            authorship_status=ResourceAuthorshipStatusEnum.ACTIVE)
    db.add(author)
    db.add(ResourceAuthor(resource_uuid=course.course_uuid, user_id=colleague.id,
                          authorship=ResourceAuthorshipEnum.MAINTAINER,
                          authorship_status=ResourceAuthorshipStatusEnum.ACTIVE))
    await db.commit()
    out = await svc.send_broadcast(svc.BroadcastCreate(org_id=org.id, course_uuid=course.course_uuid, content="hi"), teacher, db)
    channel = out["conversation"]["conversation_uuid"]
    await _send(db, channel, teacher, "still on the team")

    await db.delete(author)
    await db.commit()
    with pytest.raises(HTTPException) as exc:
        await _send(db, channel, teacher, "not anymore")
    assert exc.value.status_code == 403
    # Nor can they moderate the channel any more.
    note, _ = await _send(db, channel, colleague, "colleague note")
    with pytest.raises(HTTPException) as exc:
        await svc.delete_message(note.message_uuid, teacher, db)
    assert exc.value.status_code == 403


async def test_org_wide_broadcast_admin_only(db, org, admin_user, regular_user):
    with pytest.raises(HTTPException):
        await svc.send_broadcast(svc.BroadcastCreate(org_id=org.id, content="all"), regular_user, db)
    out = await svc.send_broadcast(svc.BroadcastCreate(org_id=org.id, content="all"), admin_user, db)
    assert out["recipients"] == 1
    assert out["conversation"]["title"] == "Announcements"


# ---------------------------------------------------------------------------
# Presence & preferences
# ---------------------------------------------------------------------------


def test_presence_view_states():
    assert svc.presence_view(1, None, True)["state"] == "online"
    assert svc.presence_view(1, MessagingProfile(user_id=1, availability="dnd"), True)["state"] == "dnd"
    invisible = svc.presence_view(1, MessagingProfile(user_id=1, availability="invisible", last_seen_at="t"), True)
    assert invisible["online"] is False and invisible["state"] == "offline"
    expired = MessagingProfile(user_id=1, status_text="Lunch", status_emoji="🍔",
                               status_expires_at=(datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat())
    assert svc.presence_view(1, expired, True)["status_text"] == ""


async def test_preferences_roundtrip(db, org, regular_user):
    me = await svc.get_my_status(org.id, regular_user, db)
    assert me["email_mode"] == "direct" and me["email_delay_minutes"] == 60
    me = await svc.set_my_status(org.id, svc.StatusUpdate(
        email_mode="all", email_delay_minutes=240, status_emoji="📖", status_text="Studying", availability="dnd",
    ), regular_user, db)
    assert me["email_mode"] == "all" and me["email_delay_minutes"] == 240
    assert me["status_text"] == "Studying" and me["availability"] == "dnd"


async def test_directory_search(db, org, admin_user, regular_user):
    await _user(db, org, 3, "zelda")
    people = await svc.directory(org.id, "zel", admin_user, db)
    assert [p["username"] for p in people] == ["zelda"]
    assert people[0]["presence"]["state"] == "offline"


# ---------------------------------------------------------------------------
# Unread emails
# ---------------------------------------------------------------------------


async def _age(db, msg: Message, minutes: int):
    msg.creation_date = (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat()
    db.add(msg)
    await db.commit()


async def test_unread_email_after_an_hour_once(db, org, admin_user, regular_user):
    conv = await _dm(db, org, admin_user, regular_user)
    msg, _ = await _send(db, conv["conversation_uuid"], admin_user, "are you coming?")
    fresh, _ = await _send(db, conv["conversation_uuid"], admin_user, "still there?")
    await _age(db, msg, 61)
    await _age(db, fresh, 10)

    sender = MagicMock()
    with patch("src.services.users.emails.send_unread_messages_email", sender), \
         patch("src.services.nudges.links.org_base_url", new=AsyncMock(return_value="https://x.test")):
        stats = await notify.run_unread_emails(db)
    assert stats.emails == 1
    kwargs = sender.call_args.kwargs
    assert kwargs["email"] == regular_user.email
    assert kwargs["conversations"][0]["count"] == 1
    assert kwargs["conversations"][0]["snippet"] == "are you coming?"
    assert kwargs["cta_url"] == f"https://x.test/messages?c={conv['conversation_uuid']}"

    # Same message never mailed twice.
    with patch("src.services.users.emails.send_unread_messages_email", sender), \
         patch("src.services.nudges.links.org_base_url", new=AsyncMock(return_value="https://x.test")):
        stats = await notify.run_unread_emails(db)
    assert stats.emails == 0


async def test_unread_email_skips_read_and_opted_out(db, org, admin_user, regular_user):
    conv = await _dm(db, org, admin_user, regular_user)
    msg, _ = await _send(db, conv["conversation_uuid"], admin_user, "hello")
    await _age(db, msg, 120)
    db.add(MessagingProfile(user_id=regular_user.id, email_mode="off"))
    await db.commit()
    sender = MagicMock()
    with patch("src.services.users.emails.send_unread_messages_email", sender):
        stats = await notify.run_unread_emails(db)
    assert stats.emails == 0
    member = (await db.execute(select(ConversationMember).where(ConversationMember.user_id == regular_user.id))).scalars().first()
    assert member.last_emailed_message_id == msg.id


def test_wants_email_modes():
    user = User(id=2, username="sam", first_name="Sam", last_name="", email="s@x.com", password="")
    dm = MagicMock(kind="dm")
    group = MagicMock(kind="group")
    channel = MagicMock(kind="broadcast")
    msg = Message(conversation_id=1, org_id=1, content="hey all")
    mention = Message(conversation_id=1, org_id=1, content="@sam look")
    direct = MessagingProfile(user_id=2, email_mode="direct")
    assert notify.wants_email(direct, dm, msg, user, None)
    assert not notify.wants_email(direct, group, msg, user, None)
    assert notify.wants_email(direct, group, mention, user, None)
    assert notify.wants_email(direct, group, msg, user, 2)
    assert notify.wants_email(MessagingProfile(user_id=2, email_mode="all"), group, msg, user, None)
    assert not notify.wants_email(MessagingProfile(user_id=2, email_broadcasts=False), channel, msg, user, None)
    assert not notify.wants_email(MessagingProfile(user_id=2, email_mode="off"), dm, msg, user, None)


# ---------------------------------------------------------------------------
# Agents
# ---------------------------------------------------------------------------


async def test_default_agent_and_visibility(db, org, admin_user, regular_user):
    agents = await agents_svc.list_agents(org.id, regular_user, db)
    assert agents[0]["is_default"] and agents[0]["name"] == "Copilot"

    mine = await agents_svc.create_agent(agents_svc.AgentCreate(
        org_id=org.id, name="Quizzy", emoji="🧠", color="#ff0066", tone="socratic", instructions="secret sauce",
    ), regular_user, db)
    assert mine["mine"] and mine["instructions"] == "secret sauce"

    # Private agents are invisible to others.
    with pytest.raises(HTTPException):
        await agents_svc.get_agent(mine["agent_uuid"], admin_user, db)
    # Only admins share with everyone.
    with pytest.raises(HTTPException):
        await agents_svc.create_agent(agents_svc.AgentCreate(org_id=org.id, name="X", visibility="org"), regular_user, db)
    shared = await agents_svc.create_agent(agents_svc.AgentCreate(org_id=org.id, name="Helper", visibility="org"), admin_user, db)
    seen = await agents_svc.get_agent(shared["agent_uuid"], regular_user, db)
    assert seen["instructions"] == "" and not seen["can_edit"]

    with pytest.raises(HTTPException):
        await agents_svc.delete_agent(agents[0]["agent_uuid"], admin_user, db)


async def test_agent_color_validation():
    with pytest.raises(Exception):
        agents_svc.AgentCreate(org_id=1, name="Bad", color="red")


async def test_open_agent_chat_with_greeting(db, org, regular_user):
    default = (await agents_svc.list_agents(org.id, regular_user, db))[0]
    conv = await agents_svc.open_agent_chat(default["agent_uuid"], agents_svc.AgentChatOpen(), regular_user, db)
    assert conv["kind"] == "agent" and conv["agent"]["name"] == "Copilot"
    assert conv["unread_count"] == 0
    page = await svc.list_messages(conv["conversation_uuid"], regular_user, db)
    assert page["messages"][0]["sender"]["type"] == "agent"
    # Reopening returns the same chat; new=True starts fresh.
    same = await agents_svc.open_agent_chat(default["agent_uuid"], agents_svc.AgentChatOpen(), regular_user, db)
    fresh = await agents_svc.open_agent_chat(default["agent_uuid"], agents_svc.AgentChatOpen(new=True), regular_user, db)
    assert same["conversation_uuid"] == conv["conversation_uuid"] != fresh["conversation_uuid"]


async def test_agent_reply_is_triggered(db, org, admin_user, regular_user):
    default = (await agents_svc.list_agents(org.id, regular_user, db))[0]
    conv = await agents_svc.open_agent_chat(default["agent_uuid"], agents_svc.AgentChatOpen(), regular_user, db)
    trigger = AsyncMock(return_value={"message_uuid": "m"})
    with patch("src.services.messaging.agents.trigger_agent_reply", trigger), \
         patch("src.services.messaging.messaging.track", new=AsyncMock()) as mock_track:
        out = await agents_svc.send_and_reply(MagicMock(), conv["conversation_uuid"],
                                              svc.MessageCreate(content="What is DNS?"), regular_user, db)
    assert out["message"]["content"] == "What is DNS?"
    assert out["agent_replies"] == [{"message_uuid": "m"}]
    mock_track.assert_awaited_once_with(
        event_name="message_sent",
        org_id=org.id,
        user_id=regular_user.id,
        properties={"conversation_uuid": conv["conversation_uuid"], "conversation_kind": "agent"},
    )


async def test_agent_mentions_in_group(db, org, admin_user, regular_user):
    private = await agents_svc.create_agent(agents_svc.AgentCreate(org_id=org.id, name="Mine"), admin_user, db)
    default = (await agents_svc.list_agents(org.id, regular_user, db))[0]
    conv = await svc.create_conversation(svc.ConversationCreate(
        org_id=org.id, kind="group", user_uuids=[admin_user.user_uuid]), regular_user, db)
    trigger = AsyncMock(return_value={})
    with patch("src.services.messaging.agents.trigger_agent_reply", trigger):
        out = await agents_svc.send_and_reply(MagicMock(), conv["conversation_uuid"], svc.MessageCreate(
            content="@Copilot help", agent_uuids=[default["agent_uuid"], private["agent_uuid"]]), regular_user, db)
    # Someone else's private agent can't be summoned.
    assert len(out["agent_replies"]) == 1
    assert trigger.call_args.args[2].name == "Copilot"


async def test_agent_reply_gated_by_ai_toggle(db, org, regular_user):
    db.add(OrganizationConfig(org_id=org.id, config={
        "config_version": "2.0", "plan": "pro", "admin_toggles": {"ai": {"copilot_enabled": False}},
    }, creation_date="", update_date=""))
    await db.commit()
    default = (await agents_svc.list_agents(org.id, regular_user, db))[0]
    conv = await agents_svc.open_agent_chat(default["agent_uuid"], agents_svc.AgentChatOpen(), regular_user, db)
    out = await agents_svc.send_and_reply(MagicMock(), conv["conversation_uuid"],
                                          svc.MessageCreate(content="hi"), regular_user, db)
    assert out["agent_replies"] == []
    assert "Agents" in out["agent_errors"][0]["detail"]


def test_system_prompt_carries_persona_and_blocks():
    agent = Agent(org_id=1, name="Quizzy", description="Drills you.", tone="socratic",
                  instructions="Always end with a question.", knowledge_mode="general")
    prompt = agents_svc._system_prompt(agent, "ctx", [{"course_uuid": "course_1", "name": "DNS 101"}])
    assert "You are Quizzy" in prompt and "Socratic" in prompt
    assert "Always end with a question." in prompt
    assert "```quiz" in prompt and "DNS 101 (uuid: course_1)" in prompt
    assert "Course Content:\nctx" in prompt


async def test_referenced_courses_limited_to_scope(db, org, course):
    scope = MagicMock()
    scope.courses = {course.id: MagicMock(course_uuid=course.course_uuid)}
    text = (
        f'```course\n{{"course_uuid": "{course.course_uuid}", "reason": "start here"}}\n```\n'
        '```course\n{"course_uuid": "course_forged"}\n```'
    )
    cards = await agents_svc._referenced_courses(text, scope, db)
    assert list(cards) == [course.course_uuid]


async def test_agent_rate_limit_error_is_plain_text(db, org, regular_user):
    default = (await agents_svc.list_agents(org.id, regular_user, db))[0]
    conv = await agents_svc.open_agent_chat(default["agent_uuid"], agents_svc.AgentChatOpen(), regular_user, db)
    limited = HTTPException(status_code=429, detail={"code": "RATE_LIMITED", "message": "Too many AI requests."})
    with patch.object(agents_svc, "trigger_agent_reply", new=AsyncMock(side_effect=limited)):
        out = await agents_svc.send_and_reply(MagicMock(), conv["conversation_uuid"],
                                              svc.MessageCreate(content="hi"), regular_user, db)
    assert out["agent_errors"][0]["detail"] == "Too many AI requests."


async def test_copilot_keeps_identity_and_every_course(db, org, course, admin_user):
    copilot = (await agents_svc.list_agents(org.id, admin_user, db))[0]
    updated = await agents_svc.update_agent(copilot["agent_uuid"], agents_svc.AgentUpdate(
        name="Renamed", emoji="🐙", color="#ff0000", course_uuids=[course.course_uuid], tone="concise",
        knowledge_mode="course_only",
    ), admin_user, db)
    assert updated["name"] == "Copilot" and updated["emoji"] == copilot["emoji"]
    assert updated["color"] == copilot["color"] and updated["course_uuids"] == []
    assert updated["tone"] == "concise" and updated["knowledge_mode"] == "general"


def test_copilot_prompt_spans_all_courses():
    copilot = Agent(org_id=1, name="Copilot", tone="friendly", knowledge_mode="course_only", is_default=True)
    other = Agent(org_id=1, name="Quizzy", tone="friendly", knowledge_mode="course_only")
    assert "every course the learner has access" in agents_svc._system_prompt(copilot, "")
    assert "every course the learner has access" not in agents_svc._system_prompt(other, "")
    # Copilot answers from general knowledge even if an old row says course_only.
    assert "answer from your general knowledge" in agents_svc._system_prompt(copilot, "")
    assert "freely add your own knowledge" in agents_svc._system_prompt(copilot, "ctx")
    assert "freely add your own knowledge" not in agents_svc._system_prompt(other, "ctx")


@pytest.mark.parametrize("is_default,expected", [(True, {1, 2}), (False, {1})])
async def test_agent_course_scope(db, org, admin_user, is_default, expected):
    agent = (await agents_svc.list_agents(org.id, admin_user, db))[0] if is_default else await agents_svc.create_agent(
        agents_svc.AgentCreate(org_id=org.id, name="Narrow"), admin_user, db)
    row = (await db.execute(select(Agent).where(Agent.agent_uuid == agent["agent_uuid"]))).scalars().one()
    row.course_uuids = ["course_a"]  # Copilot ignores any list that slipped in
    conv_view = await agents_svc.open_agent_chat(agent["agent_uuid"], agents_svc.AgentChatOpen(), admin_user, db)
    conv, msg, _ = await svc.send_message(conv_view["conversation_uuid"], svc.MessageCreate(content="hi"), admin_user, db)

    scope = MagicMock()
    scope.courses = {1: MagicMock(course_uuid="course_a"), 2: MagicMock(course_uuid="course_b")}
    stream = MagicMock(return_value=None)
    with patch.object(agents_svc, "_ai_gate", new=AsyncMock()), \
         patch("src.services.security.rate_limiting.enforce_ai_rate_limit"), \
         patch("src.services.ai.rag.access.build_rag_access_scope", new=AsyncMock(return_value=scope)), \
         patch("src.security.features_utils.usage.reserve_ai_credit", new=AsyncMock()), \
         patch.object(agents_svc, "_stream_reply", new=stream), \
         patch.object(agents_svc.asyncio, "create_task", new=MagicMock()):
        await agents_svc.trigger_agent_reply(MagicMock(), conv, row, msg, admin_user, db)
    assert set(stream.call_args.kwargs["scope"].courses) == expected


async def test_unread_email_shows_copilot_logo(db, org, regular_user):
    copilot = (await agents_svc.list_agents(org.id, regular_user, db))[0]
    conv = await agents_svc.open_agent_chat(copilot["agent_uuid"], agents_svc.AgentChatOpen(), regular_user, db)
    conv_row = (await db.execute(
        select(Conversation).where(Conversation.conversation_uuid == conv["conversation_uuid"])
    )).scalars().one()
    agent_row = (await db.execute(select(Agent).where(Agent.agent_uuid == copilot["agent_uuid"]))).scalars().one()
    msg = Message(message_uuid="message_copilot_ping", conversation_id=conv_row.id, org_id=org.id,
                  sender_agent_id=agent_row.id, kind="reminder", content="Review the breach chapter",
                  status="complete", creation_date=datetime.now(timezone.utc).isoformat())
    db.add(msg)
    await db.commit()
    await _age(db, msg, 61)

    sender = MagicMock()
    with patch("src.services.users.emails.send_unread_messages_email", sender), \
         patch("src.services.nudges.links.org_base_url", new=AsyncMock(return_value="https://x.test")):
        await notify.run_unread_emails(db)
    row = sender.call_args.kwargs["conversations"][0]
    assert row["image"] == "https://x.test/learnhouse_ai_simple_colored.png"
    assert "copilot" not in row


async def test_group_agent_answers_only_from_shared_courses(db, org, admin_user, regular_user):
    from src.services.ai.rag.access import CourseGrant, RagAccessScope

    group = await svc.create_conversation(svc.ConversationCreate(
        org_id=org.id, kind="group", user_uuids=[regular_user.user_uuid]), admin_user, db)
    conv = (await db.execute(select(Conversation).where(
        Conversation.conversation_uuid == group["conversation_uuid"]))).scalars().one()
    scope = RagAccessScope(request=MagicMock(), current_user=admin_user, org_id=org.id, courses={
        1: CourseGrant(course_uuid="course_open", is_admin=True),
        2: CourseGrant(course_uuid="course_private", is_admin=True),
    })

    async def grant(request, user, course_uuid, db_session, raise_on_deny):
        return CourseGrant(course_uuid=course_uuid) if course_uuid == "course_open" else None

    with patch("src.services.ai.rag.access._grant_for_course", new=grant):
        await agents_svc._share_scope(MagicMock(), scope, conv, admin_user.id, db)
    assert list(scope.courses) == [1]
    assert [r.current_user.id for r in scope.co_readers] == [regular_user.id]
    assert list(scope.co_readers[0].courses) == [1]


# ---------------------------------------------------------------------------
# Edges
# ---------------------------------------------------------------------------


async def test_send_rate_limit(db, org, admin_user, regular_user):
    conv = await _dm(db, org, admin_user, regular_user)
    with patch("src.services.security.rate_limiting.check_rate_limit", return_value=(False, 31, 20)):
        with pytest.raises(HTTPException) as exc:
            await _send(db, conv["conversation_uuid"], admin_user, "spam")
    assert exc.value.status_code == 429


async def test_empty_inputs_short_circuit(db, org, regular_user):
    assert await svc._reactions_for([], db) == {}
    assert await svc.serialize_messages([], "conversation_x", regular_user.id, db) == []
    assert await svc._members_of([], db) == {}
    assert await svc._require_accepting([], regular_user, org.id, db) is None
    assert await svc.search_messages(org.id, "a", regular_user, db) == []
    assert await svc.presence_for(org.id, [0], regular_user, db) == []
    assert await svc.unread_total(org.id, regular_user, db) == {"unread": 0, "conversations": 0}
    assert svc._status_expired(MessagingProfile(user_id=1, status_expires_at="not a date")) is False


async def test_outsiders_and_unknowns_are_404(db, org, admin_user, regular_user, user_role):
    conv = await _dm(db, org, admin_user, regular_user)
    third = await _user(db, org, 3, "third")
    with pytest.raises(HTTPException) as exc:
        await svc.get_conversation(conv["conversation_uuid"], third, db)
    assert exc.value.status_code == 404
    with pytest.raises(HTTPException) as exc:
        await svc.get_conversation("conversation_missing", admin_user, db)
    assert exc.value.status_code == 404
    rows = (await db.execute(select(Conversation).where(
        Conversation.conversation_uuid == conv["conversation_uuid"]))).scalars().all()
    # Serializing for a non-member skips the unread count instead of failing.
    assert len(await svc.serialize_conversations(list(rows), third.id, db)) == 1
    with pytest.raises(HTTPException) as exc:
        await svc.toggle_reaction("message_missing", svc.ReactionToggle(emoji="👍"), admin_user, db)
    assert exc.value.status_code == 404
    with pytest.raises(HTTPException) as exc:
        await _send(db, conv["conversation_uuid"], admin_user, "re", reply_to_uuid="message_missing")
    assert exc.value.status_code == 404
    with pytest.raises(HTTPException) as exc:
        await svc.send_broadcast(svc.BroadcastCreate(org_id=org.id, course_uuid="course_missing", content="x"), admin_user, db)
    assert exc.value.status_code == 404


async def test_archived_dm_comes_back(db, org, admin_user, regular_user):
    conv = await _dm(db, org, admin_user, regular_user)
    await svc.leave_conversation(conv["conversation_uuid"], regular_user, db)
    # A new message un-archives it for the other person...
    await _send(db, conv["conversation_uuid"], admin_user, "you there?")
    me = (await db.execute(select(ConversationMember).where(
        ConversationMember.user_id == regular_user.id))).scalars().first()
    assert me.archived is False
    # ...and so does opening it again.
    await svc.leave_conversation(conv["conversation_uuid"], regular_user, db)
    await _dm(db, org, regular_user, admin_user)
    await db.refresh(me)
    assert me.archived is False


async def test_group_rename_and_limits(db, org, admin_user, regular_user):
    with pytest.raises(HTTPException):
        await svc.create_conversation(svc.ConversationCreate(org_id=org.id, kind="group", user_uuids=[]), admin_user, db)
    group = await svc.create_conversation(svc.ConversationCreate(
        org_id=org.id, kind="group", user_uuids=[regular_user.user_uuid], title="Old"), admin_user, db)
    with patch("src.services.messaging.realtime.publish_to_users") as publish:
        renamed = await svc.update_conversation(group["conversation_uuid"], svc.ConversationUpdate(title=" New ", emoji="📚"), admin_user, db)
    assert renamed["title"] == "New" and renamed["emoji"] == "📚"
    assert publish.call_args.args[2]["type"] == "conversation.updated"

    seven = await _user(db, org, 7, "seven")
    with patch.object(svc, "GROUP_MAX_MEMBERS", 2):
        with pytest.raises(HTTPException) as exc:
            await svc.add_members(group["conversation_uuid"], svc.MembersAdd(user_uuids=[seven.user_uuid]), admin_user, db)
    assert "limited" in exc.value.detail

    dm = await _dm(db, org, admin_user, regular_user)
    with pytest.raises(HTTPException) as exc:
        await svc.add_members(dm["conversation_uuid"], svc.MembersAdd(user_uuids=[regular_user.user_uuid]), admin_user, db)
    assert exc.value.status_code == 400


async def test_paging_reactions_typing_and_read(db, org, admin_user, regular_user):
    conv = await _dm(db, org, admin_user, regular_user)
    first, _ = await _send(db, conv["conversation_uuid"], admin_user, "one")
    second, _ = await _send(db, conv["conversation_uuid"], admin_user, "two")
    page = await svc.list_messages(conv["conversation_uuid"], admin_user, db, before_id=second.id)
    assert [m["content"] for m in page["messages"]] == ["one"]

    read = await svc.mark_read(conv["conversation_uuid"], svc.ReadUpdate(message_uuid=first.message_uuid), regular_user, db)
    assert read["last_read_message_id"] == first.id

    for emoji in "😀😁😂🤣😃😄😅😆😉😊😋😎😍😘🥰😗😙🥲😚🙂":
        await svc.toggle_reaction(first.message_uuid, svc.ReactionToggle(emoji=emoji), admin_user, db)
    with pytest.raises(HTTPException) as exc:
        await svc.toggle_reaction(first.message_uuid, svc.ReactionToggle(emoji="🤩"), admin_user, db)
    assert "Too many" in exc.value.detail

    await svc.delete_message(second.message_uuid, admin_user, db)
    with pytest.raises(HTTPException) as exc:
        await svc.toggle_reaction(second.message_uuid, svc.ReactionToggle(emoji="👍"), regular_user, db)
    assert exc.value.status_code == 400

    db.add(MessagingProfile(user_id=admin_user.id, typing_indicators=False))
    await db.commit()
    with patch("src.services.messaging.realtime.publish_to_users") as publish:
        assert await svc.set_typing(conv["conversation_uuid"], svc.TypingUpdate(is_typing=True), admin_user, db) == {"ok": True}
    publish.assert_not_called()


async def test_channel_rules(db, org, course, admin_user, regular_user):
    assert await svc._can_share_course(SimpleNamespace(org_id=org.id + 1, published=True), admin_user.id, org.id, db) is False
    org_channel = Conversation(org_id=org.id, kind="broadcast", course_id=None)
    assert await svc._runs_channel(org_channel, admin_user.id, db) is True
    assert await svc._runs_channel(org_channel, regular_user.id, db) is False

    # A learner who joins the course team is promoted in the channel.
    await _enroll(db, org, course, regular_user.id)
    out = await svc.send_broadcast(svc.BroadcastCreate(org_id=org.id, course_uuid=course.course_uuid, content="hi"), admin_user, db)
    conv = (await db.execute(select(Conversation).where(
        Conversation.conversation_uuid == out["conversation"]["conversation_uuid"]))).scalars().one()
    await svc._sync_channel_members(conv, {admin_user.id, regular_user.id}, set(), db)
    await db.commit()
    member = (await db.execute(select(ConversationMember).where(
        ConversationMember.conversation_id == conv.id, ConversationMember.user_id == regular_user.id))).scalars().one()
    assert member.role == "owner"


async def test_unread_email_group_edges(db, org, admin_user, regular_user):
    assert notify._parse("not a date") is None
    silent = await _user(db, org, 3, "silent")
    silent_row = await db.get(User, silent.id)
    silent_row.email = ""
    db.add(silent_row)
    await db.commit()
    group = await svc.create_conversation(svc.ConversationCreate(
        org_id=org.id, kind="group", user_uuids=[regular_user.user_uuid, silent.user_uuid], title="Study group"), admin_user, db)
    old, _ = await _send(db, group["conversation_uuid"], admin_user, "notes are up")
    await _age(db, old, 90)
    await _send(db, group["conversation_uuid"], admin_user, "just now")
    db.add(MessagingProfile(user_id=regular_user.id, email_mode="all"))
    await db.commit()

    sender = MagicMock(side_effect=RuntimeError("provider down"))
    with patch("src.services.users.emails.send_unread_messages_email", sender), \
         patch("src.services.nudges.links.org_base_url", new=AsyncMock(return_value="https://x.test")):
        stats = await notify.run_unread_emails(db)
    # Only the learner with an email address is tried; the failure is counted, not raised.
    assert sender.call_count == 1
    assert sender.call_args.kwargs["conversations"][0]["title"] == "Study group"
    assert stats.failed == 1 and stats.emails == 0


async def test_unread_email_waits_for_personal_delay(db, org, admin_user, regular_user):
    conv = await _dm(db, org, admin_user, regular_user)
    msg, _ = await _send(db, conv["conversation_uuid"], admin_user, "later is fine")
    await _age(db, msg, 90)
    db.add(MessagingProfile(user_id=regular_user.id, email_delay_minutes=240))
    await db.commit()
    sender = MagicMock()
    with patch("src.services.users.emails.send_unread_messages_email", sender):
        stats = await notify.run_unread_emails(db)
    assert stats.considered == 0
    sender.assert_not_called()
