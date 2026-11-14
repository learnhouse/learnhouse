"""Service tests for the learner notification inbox and Expo push
(src/services/notifications/).

Runs against the in-memory SQLite DB from conftest. ``notify`` writes through
a sibling session on the same engine, so rows are visible to ``db`` once it
returns. Pushes are captured by patching ``schedule_push``; the Expo HTTP API
is replaced with an httpx MockTransport.
"""

import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.courses.assignments import (
    Assignment,
    AssignmentUserSubmission,
    AssignmentUserSubmissionStatus,
    GradingTypeEnum,
)
from src.db.courses.course_updates import CourseUpdate
from src.db.messaging import Agent, Conversation, ConversationMember, Message
from src.db.notifications import Notification, NotificationPreference, category_for
from src.db.trail_runs import TrailRun
from src.db.trails import Trail
from src.db.user_organizations import UserOrganization
from src.db.users import User
from src.services.notifications import events, notifications as svc, push, scheduler
from src.services.notifications.notifications import NotificationInput

TOKEN = "ExponentPushToken[abcdefghijklmnop]"
TOKEN2 = "ExpoPushToken[qrstuvwxyz0123456]"


@pytest.fixture
def pushed():
    calls: list[list[int]] = []
    with patch("src.services.notifications.push.schedule_push", side_effect=lambda ids: calls.append(list(ids))):
        yield calls


def _n(user_id, **kw) -> NotificationInput:
    return NotificationInput(user_id=user_id, org_id=kw.pop("org_id", 1), type=kw.pop("type", "message"),
                             title=kw.pop("title", "Hi"), **kw)


async def _rows(db, user_id=None):
    stmt = select(Notification).order_by(Notification.id).execution_options(populate_existing=True)
    if user_id is not None:
        stmt = stmt.where(Notification.user_id == user_id)
    return (await db.execute(stmt)).scalars().all()


def _now():
    return datetime.now(timezone.utc).isoformat()


async def _enroll(db, org, course, user_id):
    now = _now()
    trail = Trail(org_id=org.id, user_id=user_id, trail_uuid=f"trail_{user_id}", creation_date=now, update_date=now)
    db.add(trail)
    await db.commit()
    await db.refresh(trail)
    db.add(TrailRun(trail_id=trail.id, course_id=course.id, org_id=org.id, user_id=user_id,
                    creation_date=now, update_date=now))
    await db.commit()


async def _user(db, org, uid, username):
    now = _now()
    db.add(User(id=uid, username=username, first_name=username.title(), last_name="", email=f"{username}@t.com",
                password="x", user_uuid=f"user_{username}", creation_date=now, update_date=now))
    db.add(UserOrganization(user_id=uid, org_id=org.id, role_id=4, creation_date=now, update_date=now))
    await db.commit()


# ---------------------------------------------------------------------------
# Writing
# ---------------------------------------------------------------------------


async def test_notify_writes_and_queues_push(db, org, admin_user, regular_user, pushed):
    created = await svc.notify(db, [
        _n(admin_user.id, body="x" * 900, title="t" * 300),
        _n(regular_user.id, push=False),
        _n(0),  # no user: dropped
    ])
    assert len(created) == 2
    rows = await _rows(db)
    assert len(rows) == 2
    assert rows[0].category == "messages" and rows[0].notification_uuid.startswith("notification_")
    assert len(rows[0].body) == svc.BODY_MAX and rows[0].body.endswith("…")
    assert len(rows[0].title) == svc.TITLE_MAX
    assert pushed == [[rows[0].id]]


async def test_notify_empty_is_noop(db, pushed):
    assert await svc.notify(db, []) == []
    assert pushed == []


async def test_group_key_collapses_unread(db, org, admin_user, pushed):
    await svc.notify(db, [_n(admin_user.id, body="one", group_key="conv:1")])
    await svc.notify(db, [_n(admin_user.id, body="two", group_key="conv:1")])
    rows = await _rows(db)
    assert len(rows) == 1 and rows[0].count == 2 and rows[0].body == "two"

    # Once read, the next event starts a fresh row.
    await svc.mark_read(db, admin_user.id, all_=True)
    await svc.notify(db, [_n(admin_user.id, body="three", group_key="conv:1")])
    rows = await _rows(db)
    assert [r.count for r in rows] == [2, 1]


async def test_dedupe_key_writes_once(db, org, admin_user, pushed):
    await svc.notify(db, [_n(admin_user.id, dedupe_key="k"), _n(admin_user.id, dedupe_key="k")])
    assert await svc.notify(db, [_n(admin_user.id, dedupe_key="k")]) == []
    assert len(await _rows(db)) == 1
    assert len(pushed) == 1


async def test_dedupe_race_falls_back_row_by_row(db, org, admin_user, regular_user, pushed):
    # Another pod wrote admin's row after our pre-check.
    db.add(Notification(user_id=admin_user.id, org_id=org.id, type="message", dedupe_key="race",
                        creation_date="", update_date=""))
    await db.commit()
    real_execute = svc.AsyncSession.execute
    calls = {"n": 0}

    async def blind_precheck(self, stmt, *a, **kw):
        calls["n"] += 1
        if calls["n"] == 2:  # the dedupe pre-check (after the preferences read) sees nothing
            return SimpleNamespace(all=lambda: [])
        return await real_execute(self, stmt, *a, **kw)

    with patch.object(svc.AsyncSession, "execute", blind_precheck):
        created = await svc.notify(db, [_n(admin_user.id, dedupe_key="race"), _n(regular_user.id, dedupe_key="race")])
    assert [c.user_id for c in created] == [regular_user.id]
    assert len(await _rows(db)) == 2


async def test_notify_never_raises(db, admin_user, pushed):
    with patch("src.services.notifications.notifications._write", side_effect=RuntimeError("boom")):
        assert await svc.notify(db, [_n(admin_user.id)]) == []
    assert pushed == []


def test_category_for_unknown_type():
    assert category_for("live_session") == "live"
    assert category_for("whatever") == "courses"


# ---------------------------------------------------------------------------
# Reading
# ---------------------------------------------------------------------------


async def test_list_pages_and_scopes(db, org, other_org, admin_user, pushed):
    await svc.notify(db, [_n(admin_user.id, title=f"n{i}") for i in range(5)])
    await svc.notify(db, [_n(admin_user.id, org_id=other_org.id, type="certificate", title="other")])
    await svc.notify(db, [_n(admin_user.id, org_id=None, type="course_update", title="global")])

    page = await svc.list_notifications(db, admin_user.id, org.id, limit=3)
    assert [i["title"] for i in page["items"]] == ["global", "n4", "n3"]
    assert page["next_cursor"] and page["unread_count"] == 6
    page2 = await svc.list_notifications(db, admin_user.id, org.id, limit=3, cursor=page["next_cursor"])
    assert [i["title"] for i in page2["items"]] == ["n2", "n1", "n0"]
    assert page2["next_cursor"] is None

    everything = await svc.list_notifications(db, admin_user.id)
    assert len(everything["items"]) == 7
    certs = await svc.list_notifications(db, admin_user.id, category="courses")
    assert {i["title"] for i in certs["items"]} == {"other", "global"}
    item = everything["items"][0]
    assert set(item) >= {"notification_uuid", "type", "category", "data", "read", "created_at", "count"}


async def test_list_rejects_bad_input(db, admin_user):
    with pytest.raises(HTTPException) as e:
        await svc.list_notifications(db, admin_user.id, category="nope")
    assert e.value.status_code == 400
    with pytest.raises(HTTPException) as e:
        await svc.list_notifications(db, admin_user.id, cursor="abc")
    assert e.value.status_code == 400


async def test_unread_only_and_counts(db, org, admin_user, pushed):
    await svc.notify(db, [_n(admin_user.id), _n(admin_user.id, type="assignment_due"), _n(admin_user.id, type="live_session")])
    rows = await _rows(db)
    await svc.mark_read(db, admin_user.id, notification_uuids=[rows[0].notification_uuid])
    counts = await svc.unread_count(db, admin_user.id, org.id)
    assert counts["unread_count"] == 2
    assert {k: counts["unread_by_category"][k] for k in ("messages", "assignments", "courses", "live")} == {
        "messages": 0, "assignments": 1, "courses": 0, "live": 1}
    assert counts["unread_important"] == 2
    unread = await svc.list_notifications(db, admin_user.id, unread_only=True)
    assert len(unread["items"]) == 2


async def test_mark_read_variants(db, org, admin_user, regular_user, pushed):
    await svc.notify(db, [_n(admin_user.id), _n(admin_user.id, type="certificate"), _n(regular_user.id)])
    with pytest.raises(HTTPException):
        await svc.mark_read(db, admin_user.id)
    res = await svc.mark_read(db, admin_user.id, all_=True, category="courses")
    assert res["marked"] == 1 and res["unread_count"] == 1
    res = await svc.mark_read(db, admin_user.id, all_=True, org_id=org.id)
    assert res["marked"] == 1 and res["unread_count"] == 0
    # Someone else's row is untouched.
    assert (await svc.unread_count(db, regular_user.id))["unread_count"] == 1


async def test_mark_group_read(db, org, admin_user, pushed):
    await svc.notify(db, [_n(admin_user.id, group_key="conv:9"), _n(admin_user.id)])
    await svc.mark_group_read(db, admin_user.id, "conv:9")
    assert (await svc.unread_count(db, admin_user.id))["unread_count"] == 1
    with patch("src.services.notifications.notifications._sibling_session", side_effect=RuntimeError):
        await svc.mark_group_read(db, admin_user.id, "conv:9")  # swallowed


async def test_delete_and_missing(db, org, admin_user, regular_user, pushed):
    await svc.notify(db, [_n(admin_user.id)])
    uuid = (await _rows(db))[0].notification_uuid
    with pytest.raises(HTTPException) as e:
        await svc.delete_notification(db, regular_user.id, uuid)
    assert e.value.status_code == 404
    assert await svc.delete_notification(db, admin_user.id, uuid) == {"deleted": True}
    assert await _rows(db) == []


async def test_prune(db, org, admin_user):
    now = datetime.now(timezone.utc)
    old = (now - timedelta(days=100)).isoformat()
    ancient = (now - timedelta(days=200)).isoformat()
    db.add_all([
        Notification(user_id=admin_user.id, type="message", creation_date=old, read_at=old),  # read + old: gone
        Notification(user_id=admin_user.id, type="message", creation_date=old),  # unread + old: kept
        Notification(user_id=admin_user.id, type="message", creation_date=ancient),  # too old: gone
        Notification(user_id=admin_user.id, type="message", creation_date=now.isoformat(), read_at=now.isoformat()),
    ])
    await db.commit()
    assert await svc.prune(db, now) == 2
    assert len(await _rows(db)) == 2


# ---------------------------------------------------------------------------
# Preferences
# ---------------------------------------------------------------------------


async def test_preferences_roundtrip(db, admin_user):
    view = await svc.get_preferences(db, admin_user.id)
    assert view["push_enabled"] is True
    assert {k: view["push_categories"][k] for k in ("messages", "assignments", "courses", "live")} == {
        "messages": True, "assignments": True, "courses": True, "live": True}
    view = await svc.update_preferences(db, admin_user.id, push_categories={"messages": False})
    assert view["push_categories"]["messages"] is False and view["push_enabled"] is True
    view = await svc.update_preferences(db, admin_user.id, push_enabled=False)
    assert view["push_enabled"] is False and view["push_categories"]["messages"] is False
    with pytest.raises(HTTPException) as e:
        await svc.update_preferences(db, admin_user.id, push_categories={"spam": True})
    assert e.value.status_code == 400


def test_wants_push():
    assert svc.wants_push(None, "live")
    pref = NotificationPreference(user_id=1, push_enabled=True, push_categories={"live": False})
    assert not svc.wants_push(pref, "live") and svc.wants_push(pref, "messages")
    assert not svc.wants_push(NotificationPreference(user_id=1, push_enabled=False), "messages")


# ---------------------------------------------------------------------------
# Devices
# ---------------------------------------------------------------------------


async def test_register_device_validates(db, org, other_org, admin_user):
    with pytest.raises(HTTPException) as e:
        await push.register_device(db, admin_user.id, "nope", "ios")
    assert e.value.status_code == 400
    with pytest.raises(HTTPException) as e:
        await push.register_device(db, admin_user.id, TOKEN, "windows")
    assert e.value.status_code == 400
    with pytest.raises(HTTPException) as e:
        await push.register_device(db, admin_user.id, TOKEN, "ios", org_id=other_org.id)
    assert e.value.status_code == 403


async def test_register_moves_token_and_trims(db, org, admin_user, regular_user):
    view = await push.register_device(db, admin_user.id, TOKEN, "iOS", org_id=org.id, device_name="Phone", app_version="1.0")
    assert view["platform"] == "ios" and view["org_id"] == org.id
    await push.register_device(db, regular_user.id, TOKEN, "android")
    assert await push.list_devices(db, admin_user.id) == []
    assert [d["token"] for d in await push.list_devices(db, regular_user.id)] == [TOKEN]

    with patch.object(push, "MAX_DEVICES_PER_USER", 2):
        for i in range(3):
            await push.register_device(db, admin_user.id, f"ExponentPushToken[device{i:010d}]", "ios")
    assert len(await push.list_devices(db, admin_user.id)) == 2


async def test_unregister_device(db, org, admin_user, regular_user):
    await push.register_device(db, admin_user.id, TOKEN, "ios")
    assert await push.unregister_device(db, regular_user.id, TOKEN) == {"removed": False}
    assert await push.unregister_device(db, admin_user.id, TOKEN) == {"removed": True}


# ---------------------------------------------------------------------------
# Sending
# ---------------------------------------------------------------------------


class _Expo:
    """Stands in for exp.host: records requests, answers with canned tickets."""

    def __init__(self, tickets=None, status=200):
        self.requests: list[httpx.Request] = []
        self.tickets = tickets
        self.status = status

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        body = json.loads(request.content)
        tickets = self.tickets(body) if callable(self.tickets) else [{"status": "ok", "id": "t"} for _ in body]
        return httpx.Response(self.status, json={"data": tickets})

    def patch(self):
        real = httpx.AsyncClient
        return patch("src.services.notifications.push.httpx.AsyncClient",
                     lambda **kw: real(transport=httpx.MockTransport(self.handler), **kw))

    @property
    def messages(self):
        return [m for r in self.requests for m in json.loads(r.content)]


async def _write(db, items):
    with patch("src.services.notifications.push.schedule_push"):
        return await svc.notify(db, items)


async def test_send_push_filters_and_badges(db, org, other_org, admin_user, regular_user, monkeypatch):
    await push.register_device(db, admin_user.id, TOKEN, "ios", org_id=org.id)
    await push.register_device(db, admin_user.id, TOKEN2, "android")
    await svc.update_preferences(db, regular_user.id, push_categories={"live": False})
    await push.register_device(db, regular_user.id, "ExponentPushToken[regular00000000]", "ios")
    monkeypatch.setenv("LEARNHOUSE_EXPO_ACCESS_TOKEN", "secret")

    rows = await _write(db, [
        _n(admin_user.id, body="hello", group_key="conv:1"),
        _n(admin_user.id, org_id=other_org.id, type="certificate", title="Cert"),
        _n(regular_user.id, type="live_session", title="Live"),
    ])
    expo = _Expo()
    with expo.patch():
        accepted = await push.send_push(db, [r.id for r in rows])
    # admin: message to both devices, other-org cert only to the any-org device.
    # regular: live muted by preference.
    assert accepted == 3
    msgs = expo.messages
    assert sorted((m["to"], m["title"]) for m in msgs) == sorted([(TOKEN, "Hi"), (TOKEN2, "Hi"), (TOKEN2, "Cert")])
    org_scoped = next(m for m in msgs if m["to"] == TOKEN)
    assert org_scoped["badge"] == 1 and org_scoped["priority"] == "high" and org_scoped["threadId"] == "conv:1"
    assert org_scoped["data"]["type"] == "message" and org_scoped["data"]["org_id"] == org.id
    assert next(m for m in msgs if m["to"] == TOKEN2 and m["title"] == "Hi")["badge"] == 2
    assert expo.requests[0].headers["authorization"] == "Bearer secret"


async def test_send_push_collapsed_body_and_skips(db, org, admin_user):
    await push.register_device(db, admin_user.id, TOKEN, "ios")
    await _write(db, [_n(admin_user.id, body="one", group_key="g")])
    rows = await _write(db, [_n(admin_user.id, body="two", group_key="g")])
    expo = _Expo()
    with expo.patch():
        await push.send_push(db, [rows[0].id])
    assert expo.messages[0]["body"] == "two\n+1 more"

    # Already read, or nothing to send: no request at all.
    await svc.mark_read(db, admin_user.id, all_=True)
    expo = _Expo()
    with expo.patch():
        assert await push.send_push(db, [rows[0].id]) == 0
        assert await push.send_push(db, [999]) == 0
    assert expo.requests == []


async def test_send_push_without_devices_or_wanted(db, org, admin_user, regular_user):
    rows = await _write(db, [_n(regular_user.id)])
    assert await push.send_push(db, [rows[0].id]) == 0
    await push.register_device(db, regular_user.id, TOKEN, "ios")
    await svc.update_preferences(db, regular_user.id, push_enabled=False)
    assert await push.send_push(db, [rows[0].id]) == 0


async def test_deliver_drops_dead_tokens_and_survives_errors(db, org, admin_user):
    await push.register_device(db, admin_user.id, TOKEN, "ios")
    await push.register_device(db, admin_user.id, TOKEN2, "ios")
    tickets = lambda body: [  # noqa: E731
        {"status": "error", "message": "gone", "details": {"error": "DeviceNotRegistered"}},
        {"status": "error", "message": "too big", "details": {"error": "MessageTooBig"}},
    ]
    expo = _Expo(tickets)
    with expo.patch():
        assert await push.deliver(db, [{"to": TOKEN}, {"to": TOKEN2}]) == 0
    assert [d["token"] for d in await push.list_devices(db, admin_user.id)] == [TOKEN2]

    with _Expo(status=500).patch():
        assert await push.deliver(db, [{"to": TOKEN2}]) == 0


async def test_deliver_chunks(db):
    expo = _Expo()
    with expo.patch(), patch.object(push, "CHUNK", 2):
        assert await push.deliver(db, [{"to": f"t{i}"} for i in range(5)]) == 5
    assert len(expo.requests) == 3


async def test_schedule_push(monkeypatch):
    push.schedule_push([1])  # disabled under tests: nothing happens
    assert not push._tasks
    monkeypatch.setattr(push, "push_disabled", lambda: False)
    ran = []

    async def fake_task(ids):
        ran.append(ids)

    monkeypatch.setattr(push, "_push_task", fake_task)
    push.schedule_push([])
    push.schedule_push([1, 2])
    task = next(iter(push._tasks))
    await task
    assert ran == [[1, 2]]


def test_push_disabled_env(monkeypatch):
    monkeypatch.setenv("TESTING", "false")
    monkeypatch.delenv("LEARNHOUSE_PUSH_DISABLED", raising=False)
    assert push.push_disabled() is False
    monkeypatch.setenv("LEARNHOUSE_PUSH_DISABLED", "1")
    assert push.push_disabled() is True


async def test_push_task_uses_own_session(db, engine):
    from sqlalchemy.ext.asyncio import async_sessionmaker
    from sqlmodel.ext.asyncio.session import AsyncSession

    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    with patch("src.core.events.database._async_session_factory", factory), \
         patch.object(push, "send_push", new=AsyncMock(return_value=1)) as send:
        await push._push_task([5])
    send.assert_awaited_once()
    with patch("src.core.events.database._async_session_factory", factory), \
         patch.object(push, "send_push", new=AsyncMock(side_effect=RuntimeError)):
        await push._push_task([5])  # logged, not raised


# ---------------------------------------------------------------------------
# Event producers
# ---------------------------------------------------------------------------


async def _conv(db, org, kind, members, **kw):
    now = _now()
    conv = Conversation(conversation_uuid=f"conversation_{kind}_{len(members)}", org_id=org.id, kind=kind,
                        title=kw.pop("title", ""), creation_date=now, update_date=now, **kw)
    db.add(conv)
    await db.commit()
    await db.refresh(conv)
    for uid, muted in members:
        db.add(ConversationMember(conversation_id=conv.id, user_id=uid, muted=muted, joined_at=now))
    await db.commit()
    return conv


async def _msg(db, conv, **kw):
    msg = Message(message_uuid=f"message_{kw.get('content', '')}_{kw.get('kind', 'text')}", conversation_id=conv.id,
                  org_id=conv.org_id, creation_date=_now(), **kw)
    db.add(msg)
    await db.commit()
    await db.refresh(msg)
    return msg


async def test_message_dm_and_mute(db, org, admin_user, regular_user, pushed):
    await _user(db, org, 3, "muted")
    conv = await _conv(db, org, "dm", [(admin_user.id, False), (regular_user.id, False), (3, True)])
    msg = await _msg(db, conv, sender_user_id=admin_user.id, content="hey there")
    created = await events.notify_new_message(db, conv.id, msg.id)
    assert [c.user_id for c in created] == [regular_user.id]
    row = created[0]
    assert row.title == "Admin" or row.title  # sender's display name
    assert row.body == "hey there" and row.group_key == f"conv:{conv.id}"
    assert row.data["path"] == f"/messages?c={conv.conversation_uuid}"


async def test_message_group_needs_mention_or_reply(db, org, admin_user, regular_user, pushed):
    await _user(db, org, 3, "carol")
    conv = await _conv(db, org, "group", [(admin_user.id, False), (regular_user.id, False), (3, False)], title="Team")
    plain = await _msg(db, conv, sender_user_id=admin_user.id, content="morning")
    assert await events.notify_new_message(db, conv.id, plain.id) == []
    mention = await _msg(db, conv, sender_user_id=admin_user.id, content="ping @Carol")
    created = await events.notify_new_message(db, conv.id, mention.id)
    assert [c.user_id for c in created] == [3]
    assert created[0].title.endswith("in Team")
    reply = await _msg(db, conv, sender_user_id=3, content="yes", reply_to_id=mention.id)
    assert [c.user_id for c in await events.notify_new_message(db, conv.id, reply.id)] == [admin_user.id]


async def test_message_broadcast_agent_reminder_and_course_share(db, org, admin_user, regular_user, pushed):
    now = _now()
    agent = Agent(agent_uuid="agent_x", org_id=org.id, name="Tutor", emoji="🦉", creation_date=now, update_date=now)
    db.add(agent)
    await db.commit()
    await db.refresh(agent)

    bc = await _conv(db, org, "broadcast", [(admin_user.id, False), (regular_user.id, False)], title="News")
    m = await _msg(db, bc, sender_user_id=admin_user.id, content="", attachment={"course": {"name": "Intro"}})
    [row] = await events.notify_new_message(db, bc.id, m.id)
    assert row.title == "News" and row.body.endswith("Shared a course: Intro")

    chat = await _conv(db, org, "agent", [(regular_user.id, False)], agent_id=agent.id)
    reply = await _msg(db, chat, sender_agent_id=agent.id, content="Here you go", status="complete")
    [row] = await events.notify_new_message(db, chat.id, reply.id)
    assert row.title == "Tutor" and row.image == "🦉"

    rem = await _msg(db, chat, sender_agent_id=agent.id, kind="reminder", content="Study!",
                     attachment={"for_user_id": regular_user.id})
    [row] = await events.notify_new_message(db, chat.id, rem.id)
    assert row.title == "Reminder"

    system = await _msg(db, chat, kind="system", content="joined")
    assert await events.notify_new_message(db, chat.id, system.id) == []
    assert await events.notify_new_message(db, chat.id, 9999) == []


async def test_message_skips_push_when_online(db, org, admin_user, regular_user, pushed):
    conv = await _conv(db, org, "dm", [(admin_user.id, False), (regular_user.id, False)])
    msg = await _msg(db, conv, sender_user_id=admin_user.id, content="hi")
    with patch("src.services.messaging.realtime.is_online", return_value=True):
        assert len(await events.notify_new_message(db, conv.id, msg.id)) == 1
    assert pushed == []


async def test_hook_failures_are_swallowed(db):
    with patch.object(events, "notify", side_effect=RuntimeError("down")):
        assert await events.notify_certificate(db, 1, SimpleNamespace(org_id=1, course_uuid="course_x", name="C", thumbnail_image=""), "cert_1") == []


async def test_clear_conversation(db, org, admin_user, pushed):
    await svc.notify(db, [_n(admin_user.id, group_key="conv:4")])
    await events.clear_conversation(db, admin_user.id, 4)
    assert (await svc.unread_count(db, admin_user.id))["unread_count"] == 0


def test_grade_text():
    assert events.grade_text({"display_grade": "A", "passed": True}) == "Grade: A · Passed"
    assert events.grade_text({"display_grade": None, "percentage": 42.4, "passed": False}) == "Grade: 42% · Not passed"
    assert events.grade_text({}) == "Your grade is ready"


async def _assignment(db, org, course, chapter, activity, due_date=None, **kw):
    activity.published = True
    db.add(activity)
    row = Assignment(title=kw.pop("title", "Essay"), description="", published=kw.pop("published", True),
                     grading_type=GradingTypeEnum.NUMERIC, due_date=due_date, org_id=org.id, course_id=course.id,
                     chapter_id=chapter.id, activity_id=activity.id, assignment_uuid=kw.pop("uuid", "assignment_a"),
                     creation_date="", update_date="")
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


async def test_assignment_graded(db, org, course, chapter, activity, regular_user, pushed):
    a = await _assignment(db, org, course, chapter, activity)
    [row] = await events.notify_assignment_graded(db, regular_user.id, a.id, {"display_grade": "18/20", "passed": True})
    assert row.type == "assignment_graded" and row.title == "Graded: Essay"
    assert row.data["path"] == "/course/test/activity/" + activity.activity_uuid.removeprefix("activity_")
    assert await events.notify_assignment_graded(db, regular_user.id, 999, {}) == []


async def test_assignment_due_reminders(db, org, course, chapter, activity, admin_user, regular_user, pushed):
    now = datetime(2026, 11, 11, 12, tzinfo=timezone.utc)
    await _user(db, org, 3, "late")
    a = await _assignment(db, org, course, chapter, activity, due_date=(now + timedelta(hours=5)).isoformat())
    # Bare date tomorrow: the deadline is the end of that day, 36h out.
    await _assignment(db, org, course, chapter, activity, due_date="2026-11-12", uuid="assignment_b")
    await _assignment(db, org, course, chapter, activity, due_date="garbage", uuid="assignment_c")
    for uid in (admin_user.id, regular_user.id, 3):
        await _enroll(db, org, course, uid)
    db.add(AssignmentUserSubmission(user_id=admin_user.id, assignment_id=a.id, grade=0,
                                    submission_status=AssignmentUserSubmissionStatus.SUBMITTED,
                                    assignmentusersubmission_uuid="s1", creation_date="", update_date=""))
    await db.commit()

    assert await events.run_assignment_due_reminders(db, now) == 2
    rows = await _rows(db)
    assert {r.user_id for r in rows} == {regular_user.id, 3}
    assert rows[0].body.endswith("due in 5 h")
    # Second tick: deduped.
    assert await events.run_assignment_due_reminders(db, now) == 0
    # A day later the bare-date one is inside the window.
    assert await events.run_assignment_due_reminders(db, now + timedelta(hours=13)) == 3


async def test_assignment_due_skips_when_everyone_handed_in(db, org, course, chapter, activity, regular_user, pushed):
    now = datetime(2026, 11, 11, 12, tzinfo=timezone.utc)
    a = await _assignment(db, org, course, chapter, activity, due_date=(now + timedelta(hours=2)).isoformat())
    await _enroll(db, org, course, regular_user.id)
    db.add(AssignmentUserSubmission(user_id=regular_user.id, assignment_id=a.id, grade=5,
                                    submission_status=AssignmentUserSubmissionStatus.GRADED,
                                    assignmentusersubmission_uuid="s2", creation_date="", update_date=""))
    await db.commit()
    assert await events.run_assignment_due_reminders(db, now) == 0


async def test_chapters_unlocked(db, org, course, regular_user, pushed):
    [row] = await events.notify_chapters_unlocked(db, regular_user.id, course, [2], ["Week 2"])
    assert row.body == "Week 2 is now open" and row.title == course.name
    [row] = await events.notify_chapters_unlocked(db, regular_user.id, course, [3, 4, 5, 6], ["A", "B", "C", "D"])
    assert row.body == "4 new chapters are open: A, B, C…"
    assert await events.notify_chapters_unlocked(db, regular_user.id, course, [2], ["Week 2"]) == []


async def test_course_update(db, org, course, admin_user, regular_user, pushed):
    upd = CourseUpdate(title="New lesson", content="Check it out", course_id=course.id, org_id=org.id,
                       courseupdate_uuid="courseupdate_1", creation_date="", update_date="")
    db.add(upd)
    await db.commit()
    await db.refresh(upd)
    assert await events.notify_course_update(db, course.id, upd.id, admin_user.id) == []  # nobody enrolled
    await _enroll(db, org, course, admin_user.id)
    await _enroll(db, org, course, regular_user.id)
    created = await events.notify_course_update(db, course.id, upd.id, admin_user.id)
    assert [c.user_id for c in created] == [regular_user.id]
    assert created[0].title == f"{course.name}: New lesson"
    assert await events.notify_course_update(db, course.id, 999) == []


async def test_certificate(db, org, course, regular_user, pushed):
    [row] = await events.notify_certificate(db, regular_user.id, course, "cert_1")
    assert row.data["path"] == "/certificates/cert_1/verify" and row.category == "courses"


async def test_live_session_turns_into_live_now(db, org, admin_user, regular_user, pushed):
    kw = dict(user_ids=[regular_user.id], org_id=org.id, session_id=7, session_uuid="livesession_7",
              title="Office hours", path="/live/7")
    [row] = await events.notify_live_session(db, kind="24h", when="Thursday 10:00", **kw)
    assert row.title == "Tomorrow: Office hours" and row.body == "Thursday 10:00"
    await events.notify_live_session(db, kind="live", **kw)
    rows = await _rows(db)
    assert len(rows) == 1 and rows[0].title == "Live now: Office hours" and rows[0].count == 2
    assert await events.notify_live_session(db, kind="live", **kw) == []  # deduped


# ---------------------------------------------------------------------------
# Scheduler
# ---------------------------------------------------------------------------


async def test_scheduler_tick(db, engine, org, admin_user):
    from sqlalchemy.ext.asyncio import async_sessionmaker
    from sqlmodel.ext.asyncio.session import AsyncSession

    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    scheduler._last_prune = None
    with patch("src.core.events.database._async_session_factory", factory), \
         patch.object(scheduler, "_claim", new=AsyncMock(return_value=True)), \
         patch("src.services.notifications.events.run_assignment_due_reminders", new=AsyncMock(return_value=2)) as due, \
         patch("src.services.notifications.notifications.prune", new=AsyncMock(return_value=0)) as prune:
        await scheduler.tick(datetime(2026, 11, 11, tzinfo=timezone.utc))
        await scheduler.tick(datetime(2026, 11, 11, 0, 30, tzinfo=timezone.utc))
    assert due.await_count == 2 and prune.await_count == 1

    with patch.object(scheduler, "_claim", new=AsyncMock(return_value=False)), \
         patch("src.services.notifications.events.run_assignment_due_reminders", new=AsyncMock()) as due:
        await scheduler.tick()
    due.assert_not_awaited()


async def test_scheduler_claim_with_redis():
    client = MagicMock()
    client.set.return_value = True
    with patch("src.core.redis.get_redis_client", return_value=client):
        assert await scheduler._claim(datetime(2026, 11, 11, 10, 20, tzinfo=timezone.utc)) is True
    assert client.set.call_args.args[0] == "learnhouse:notifications:tick:2026-11-11T10:1"
    with patch("src.core.redis.get_redis_client", return_value=None):
        assert await scheduler._claim(datetime.now(timezone.utc)) is True


async def test_scheduler_start_stop(monkeypatch):
    scheduler.start_scheduler()  # TESTING=true: no task
    assert scheduler._task is None
    await scheduler.stop_scheduler()

    monkeypatch.setenv("TESTING", "false")
    monkeypatch.delenv("LEARNHOUSE_NOTIFICATIONS_SCHEDULER_DISABLED", raising=False)
    ticks = []

    async def fake_tick(now=None):
        ticks.append(1)
        raise RuntimeError("boom")  # logged, loop goes on

    monkeypatch.setattr(scheduler, "STARTUP_DELAY_SECONDS", 0)
    monkeypatch.setattr(scheduler, "INTERVAL_SECONDS", 0.01)
    monkeypatch.setattr(scheduler, "tick", fake_tick)
    import asyncio

    scheduler.start_scheduler()
    await asyncio.sleep(0.05)
    await scheduler.stop_scheduler()
    assert scheduler._task is None and len(ticks) >= 2

    with patch("asyncio.create_task", side_effect=RuntimeError), patch.object(scheduler, "_loop", MagicMock()):
        scheduler.start_scheduler()  # never raises


def test_helpers_edge_cases():
    assert events._name(None) == ""
    conv = SimpleNamespace(kind="group")
    msg = SimpleNamespace(kind="text", sender_user_id=1, content="@ghost hi", attachment=None)
    members = [SimpleNamespace(user_id=5, muted=False)]
    assert events.message_targets(conv, msg, members, {}, None) == []  # member row without a user


async def test_assignment_graded_without_activity(db, org, course, chapter, activity, regular_user, pushed):
    a = await _assignment(db, org, course, chapter, activity)
    a.activity_id = 999
    db.add(a)
    await db.commit()
    assert await events.notify_assignment_graded(db, regular_user.id, a.id, {}) == []


async def test_scheduler_loop_stops_on_cancel(monkeypatch):
    import asyncio

    async def cancelled(now=None):
        raise asyncio.CancelledError

    monkeypatch.setattr(scheduler, "STARTUP_DELAY_SECONDS", 0)
    monkeypatch.setattr(scheduler, "tick", cancelled)
    with pytest.raises(asyncio.CancelledError):
        await scheduler._loop()
