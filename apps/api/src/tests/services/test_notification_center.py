"""Notification center: audience split, preferences per channel, archive and
bulk actions, admin routing, realtime fan-out, digests, the HTTP routes added
for the web, the agent tools, and the mobile contract.

Runs against the in-memory SQLite DB from conftest. ``notify`` writes through
a sibling session on the same engine; pushes are captured by patching
``schedule_push`` and Redis by patching the client getters.
"""

import json
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient
from sqlmodel import select

from src.core.events.database import get_db_session
from src.db.notifications import (
    NOTIFICATION_TYPE_META,
    Notification,
    NotificationPreference,
    OrgNotificationSetting,
    audience_of_category,
    meta_for,
)
from src.db.resource_authors import ResourceAuthor, ResourceAuthorshipEnum, ResourceAuthorshipStatusEnum
from src.db.user_organizations import UserOrganization
from src.db.users import APITokenUser, User
from src.routers.notifications import router
from src.security.api_token_utils import get_authenticated_non_api_token_user
from src.services.notifications import digest, emit, realtime
from src.services.notifications import notifications as svc
from src.services.notifications.notifications import NotificationInput

B = "/api/v1/notifications"
REAL_PUBLISH = realtime._publish


@pytest.fixture(autouse=True)
def quiet():
    """No pushes and no Redis unless a test asks for them."""
    with patch("src.services.notifications.push.schedule_push") as push, \
         patch.object(realtime, "_publish") as pub:
        yield {"push": push, "publish": pub}


def _n(user_id, **kw) -> NotificationInput:
    return NotificationInput(user_id=user_id, org_id=kw.pop("org_id", 1), type=kw.pop("type", "message"),
                             title=kw.pop("title", "Hi"), **kw)


async def _rows(db, user_id=None):
    stmt = select(Notification).order_by(Notification.id).execution_options(populate_existing=True)
    if user_id is not None:
        stmt = stmt.where(Notification.user_id == user_id)
    return (await db.execute(stmt)).scalars().all()


async def _user(db, org, uid, username, role_id=4):
    now = datetime.now(timezone.utc).isoformat()
    db.add(User(id=uid, username=username, first_name=username.title(), last_name="", email=f"{username}@t.com",
                password="x", user_uuid=f"user_{username}", creation_date=now, update_date=now))
    db.add(UserOrganization(user_id=uid, org_id=org.id, role_id=role_id, creation_date=now, update_date=now))
    await db.commit()


# ---------------------------------------------------------------------------
# Catalog
# ---------------------------------------------------------------------------


def test_catalog():
    assert meta_for("submission_to_grade").audience == "admin"
    assert meta_for("submission_to_grade").default_roles == ("course_authors",)
    assert meta_for("unknown_type").category == "courses"
    assert audience_of_category("plan") == "admin" and audience_of_category("live") == "personal"
    from src.db.notifications import NOTIFICATION_CATEGORIES, NOTIFICATION_LINKS

    # Every type has a category, an audience matching it, and a deep link;
    # the web test checks each has a label, a headline and an action.
    assert set(NOTIFICATION_LINKS) == set(NOTIFICATION_TYPE_META)
    for type_, meta in NOTIFICATION_TYPE_META.items():
        assert meta.category in NOTIFICATION_CATEGORIES, type_
        assert audience_of_category(meta.category) == meta.audience, type_
        assert NOTIFICATION_LINKS[type_].startswith("/"), type_
        if meta.audience == "admin":
            assert NOTIFICATION_LINKS[type_].startswith("/dash"), type_


# ---------------------------------------------------------------------------
# Writing
# ---------------------------------------------------------------------------


async def test_notify_fills_audience_priority_actor(db, org, admin_user, regular_user, quiet):
    rows = await svc.notify(db, [
        _n(admin_user.id, type="join_request", actor_id=regular_user.id, expires_at="2999-01-01T00:00:00+00:00"),
        _n(regular_user.id, type="assignment_graded", actor_id=regular_user.id, audience="nope", priority="important"),
    ])
    a, r = rows
    assert (a.audience, a.priority, a.category, a.actor_id, a.expires_at) == ("admin", "important", "people", regular_user.id, "2999-01-01T00:00:00+00:00")
    # Your own action has no actor; unknown audience falls back to the type's.
    assert (r.audience, r.priority, r.actor_id) == ("personal", "important", None)
    quiet["publish"].assert_called()


async def test_in_app_off_writes_nothing_and_push_follows_channel(db, org, admin_user, regular_user, quiet):
    await svc.update_preferences(db, admin_user.id, channels={"messages": {"in_app": False}})
    await svc.update_preferences(db, regular_user.id, channels={"messages": {"push": False}})
    created = await svc.notify(db, [_n(admin_user.id), _n(regular_user.id)])
    assert [c.user_id for c in created] == [regular_user.id]
    # Push was off for that category: the row is written without a push.
    quiet["push"].assert_not_called()
    assert await svc.notify(db, [_n(admin_user.id)]) == []


# ---------------------------------------------------------------------------
# Reading
# ---------------------------------------------------------------------------


async def test_list_scopes_and_filters(db, org, admin_user, regular_user):
    await svc.notify(db, [
        _n(admin_user.id, title="Grade for essay", type="assignment_graded", actor_id=regular_user.id),
        _n(admin_user.id, title="Live", type="live_session"),
        _n(admin_user.id, title="Signup", type="signup_pending"),
        _n(admin_user.id, title="Old live", type="live_session", expires_at="2000-01-01T00:00:00+00:00"),
    ])
    page = await svc.list_notifications(db, admin_user.id, org.id)
    assert [i["title"] for i in page["items"]] == ["Live", "Grade for essay"]
    assert page["items"][1]["actor"]["name"] == "regular" or page["items"][1]["actor"]["username"] == "regular"
    assert page["unread_count"] == 2 and page["unread_important"] == 1
    assert "teaching" not in page["unread_by_category"]

    admin = await svc.list_notifications(db, admin_user.id, org.id, audience="admin")
    assert [i["title"] for i in admin["items"]] == ["Signup"] and admin["items"][0]["important"] is True
    assert set(admin["unread_by_category"]) == {"teaching", "people", "integrations", "newsletter", "plan", "automation"}

    everything = await svc.list_notifications(db, admin_user.id, audience="all")
    assert len(everything["items"]) == 3 and "messages" in everything["unread_by_category"]
    assert len((await svc.list_notifications(db, admin_user.id, q="essay"))["items"]) == 1
    assert len((await svc.list_notifications(db, admin_user.id, type_="live_session"))["items"]) == 1
    assert len((await svc.list_notifications(db, admin_user.id, important_only=True))["items"]) == 1
    with pytest.raises(HTTPException):
        await svc.list_notifications(db, admin_user.id, audience="robots")

    both = await svc.counts(db, admin_user.id, org.id)
    assert both["personal"]["unread_count"] == 2 and both["admin"]["unread_count"] == 1


async def test_bulk_actions(db, org, admin_user):
    await svc.notify(db, [_n(admin_user.id, title=f"n{i}") for i in range(3)] + [_n(admin_user.id, type="member_joined", title="adm")])
    rows = await _rows(db, admin_user.id)
    u = [r.notification_uuid for r in rows]

    out = await svc.bulk(db, admin_user.id, "archive", notification_uuids=[u[0]])
    assert out["changed"] == 1 and out["unread_count"] == 2
    archived = await svc.list_notifications(db, admin_user.id, archived=True)
    assert [i["title"] for i in archived["items"]] == ["n0"] and archived["items"][0]["read"] is True
    await svc.bulk(db, admin_user.id, "unarchive", notification_uuids=[u[0]])
    await svc.bulk(db, admin_user.id, "read", notification_uuids=[u[1]])
    out = await svc.bulk(db, admin_user.id, "unread", notification_uuids=[u[1]])
    # n0 stayed read when it was archived.
    assert out["unread_count"] == 2
    out = await svc.bulk(db, admin_user.id, "delete", notification_uuids=[u[2]])
    assert out["changed"] == 1

    # `all` stays inside the audience: the admin row is untouched.
    out = await svc.bulk(db, admin_user.id, "archive", all_=True, category="messages")
    assert out["unread_count"] == 0
    assert (await svc.unread_count(db, admin_user.id, audience="admin"))["unread_count"] == 1
    out = await svc.mark_read(db, admin_user.id, all_=True, audience="admin")
    assert out["marked"] == 1

    for bad in (
        dict(action="explode", notification_uuids=[u[0]]),
        dict(action="archive"),
        dict(action="delete", notification_uuids=[u[0]], category="nope"),
    ):
        with pytest.raises(HTTPException):
            await svc.bulk(db, admin_user.id, **bad)
    with pytest.raises(HTTPException):
        await svc.mark_read(db, admin_user.id, all_=True, category="nope")


async def test_cannot_touch_someone_elses_rows(db, org, admin_user, regular_user):
    await svc.notify(db, [_n(regular_user.id, title="theirs")])
    theirs = (await _rows(db, regular_user.id))[0].notification_uuid
    assert (await svc.bulk(db, admin_user.id, "delete", notification_uuids=[theirs]))["changed"] == 0
    assert (await svc.mark_read(db, admin_user.id, notification_uuids=[theirs]))["marked"] == 0
    assert len(await _rows(db, regular_user.id)) == 1


async def test_other_org_rows_hidden_in_org_scope(db, org, other_org, admin_user):
    await svc.notify(db, [_n(admin_user.id, org_id=other_org.id, title="elsewhere"), _n(admin_user.id, title="here")])
    assert [i["title"] for i in (await svc.list_notifications(db, admin_user.id, org.id))["items"]] == ["here"]


# ---------------------------------------------------------------------------
# Preferences
# ---------------------------------------------------------------------------


async def test_preferences_channels_and_digest(db, admin_user):
    view = await svc.get_preferences(db, admin_user.id)
    assert view["channels"]["plan"] == {"in_app": True, "email": True, "push": False}
    assert view["channels"]["community"] == {"in_app": True, "email": False, "push": True}
    assert view["email_digest"] == "off" and {"key": "plan", "audience": "admin"} in view["categories"]

    view = await svc.update_preferences(db, admin_user.id, channels={"live": {"push": False, "email": False}}, email_digest="weekly")
    assert view["channels"]["live"] == {"in_app": True, "email": False, "push": False}
    # The mobile switch follows the channel...
    assert view["push_categories"]["live"] is False and view["email_digest"] == "weekly"
    # ...and the channel follows the mobile switch.
    view = await svc.update_preferences(db, admin_user.id, push_categories={"live": True})
    assert view["channels"]["live"]["push"] is True

    for bad in (dict(channels={"spam": {"push": True}}), dict(channels={"live": {"fax": True}}), dict(email_digest="hourly")):
        with pytest.raises(HTTPException):
            await svc.update_preferences(db, admin_user.id, **bad)


def test_wants_channel():
    assert svc.wants_channel(None, "plan", "email") and not svc.wants_channel(None, "plan", "push")
    pref = NotificationPreference(user_id=1, channels={"live": {"in_app": False}}, push_categories={})
    assert not svc.wants_channel(pref, "live", "in_app") and svc.wants_channel(pref, "messages", "in_app")
    assert not svc.wants_push(NotificationPreference(user_id=1, push_enabled=False), "messages")
    pref = NotificationPreference(user_id=1, channels={"live": {"fax": True}}, push_categories={})
    assert svc.channels_view(pref)["live"] == svc.default_channels("live")
    assert svc.is_admin_category("plan") and not svc.is_admin_category("live")


# ---------------------------------------------------------------------------
# emit / emit_admin / routing
# ---------------------------------------------------------------------------


async def test_emit_params_and_exclusions(db, org, admin_user, regular_user):
    rows = await emit.emit(
        db, "discussion_reply", [admin_user.id, regular_user.id, None], org_id=org.id, title="Reply",
        params={"actor": "Reg", "discussion": "Intro", "skip": None}, path="/community/x",
        actor_id=regular_user.id, group_key="d:1:{user_id}", dedupe_key="dd:{user_id}",
    )
    assert [r.user_id for r in rows] == [admin_user.id]
    row = rows[0]
    assert row.data == {"params": {"actor": "Reg", "discussion": "Intro"}, "path": "/community/x"}
    assert row.group_key == f"d:1:{admin_user.id}" and row.dedupe_key == f"dd:{admin_user.id}"
    assert await emit.emit(db, "message", [admin_user.id], org_id=org.id, title="x", exclude=[admin_user.id]) == []
    with patch.object(emit, "notify", side_effect=RuntimeError("boom")):
        assert await emit.emit(db, "message", [admin_user.id], org_id=org.id, title="x") == []


async def test_admin_routing_defaults_and_overrides(db, org, admin_user, regular_user):
    await _user(db, org, 30, "maint", role_id=2)
    # Defaults: admins.
    assert await emit.admin_recipients(db, org.id, "join_request") == [admin_user.id]
    # Course authors, falling back to admins when the course has none.
    assert await emit.admin_recipients(db, org.id, "submission_to_grade", course_uuid="course_x") == [admin_user.id]
    db.add(ResourceAuthor(resource_uuid="course_x", user_id=regular_user.id, authorship=ResourceAuthorshipEnum.CONTRIBUTOR,
                          authorship_status=ResourceAuthorshipStatusEnum.ACTIVE))
    await db.commit()
    assert await emit.admin_recipients(db, org.id, "submission_to_grade", course_uuid="course_x") == [regular_user.id]

    view = await emit.update_org_routing(db, org.id, {"join_request": ["maintainers", "admins"], "member_joined": []})
    assert view["types"]["join_request"]["roles"] == ["admins", "maintainers"]
    assert view["types"]["member_joined"]["roles"] == []
    assert await emit.admin_recipients(db, org.id, "join_request") == [admin_user.id, 30]
    assert await emit.admin_recipients(db, org.id, "member_joined") == []
    # A type with no default roles falls back to admins.
    assert await emit.admin_recipients(db, org.id, "agent_run_finished") == [admin_user.id]
    assert "agent_run_finished" not in emit.admin_types()
    assert await emit.admin_recipients(db, org.id, "not_an_admin_type") == [admin_user.id]

    # Stored junk is ignored.
    setting = (await db.execute(select(OrgNotificationSetting))).scalars().first()
    setting.admin_routing = {**setting.admin_routing, "poc_ending": "admins", "crm_sync_errors": ["robots", "admins"]}
    db.add(setting)
    await db.commit()
    types = (await emit.get_org_routing(db, org.id))["types"]
    assert types["poc_ending"]["roles"] == ["admins"] and types["crm_sync_errors"]["roles"] == ["admins"]

    for bad in ({"message": ["admins"]}, {"join_request": ["robots"]}):
        with pytest.raises(HTTPException):
            await emit.update_org_routing(db, org.id, bad)

    rows = await emit.emit_admin(db, "join_request", org_id=org.id, title="Join?", extra_user_ids=[regular_user.id])
    assert sorted(r.user_id for r in rows) == [admin_user.id, regular_user.id, 30]
    assert all(r.audience == "admin" for r in rows)
    with patch.object(emit, "admin_recipients", side_effect=RuntimeError("boom")):
        assert await emit.emit_admin(db, "join_request", org_id=org.id, title="x") == []


async def test_course_author_who_left_org_is_skipped(db, org, admin_user):
    db.add(ResourceAuthor(resource_uuid="course_y", user_id=99, authorship=ResourceAuthorshipEnum.CREATOR,
                          authorship_status=ResourceAuthorshipStatusEnum.ACTIVE))
    await db.commit()
    assert await emit.admin_recipients(db, org.id, "submission_to_grade", course_uuid="course_y") == []
    assert await emit.course_author_ids(db, None) == set()


# ---------------------------------------------------------------------------
# Realtime
# ---------------------------------------------------------------------------


def test_publish_with_and_without_redis():
    client = MagicMock()
    with patch.object(realtime, "_publish", REAL_PUBLISH):
        with patch("src.core.redis.get_redis_client", return_value=client):
            realtime.publish_changed(5, 1)
        payload = client.pipeline.return_value.publish.call_args.args
        assert payload[0] == "notif:user:5" and json.loads(payload[1]) == {"type": "notification.changed", "org_id": 1}
        with patch("src.core.redis.get_redis_client", return_value=None):
            realtime.publish_changed(5)
        with patch("src.core.redis.get_redis_client", side_effect=RuntimeError):
            realtime.publish_changed(5)
        row = Notification(id=1, notification_uuid="n1", user_id=5, org_id=1, type="message", category="messages",
                           title="t", audience="personal", priority="normal", data={})
        with patch("src.core.redis.get_redis_client", return_value=client):
            realtime.publish_new([row])
        event = json.loads(client.pipeline.return_value.publish.call_args.args[1])
        assert event["type"] == "notification.new" and event["item"]["notification_uuid"] == "n1"
        with patch("src.services.notifications.notifications.serialize", side_effect=RuntimeError):
            realtime.publish_new([row])


def test_wanted():
    assert realtime.wanted({"org_id": 2}, None)
    assert realtime.wanted({"org_id": None}, 1) and realtime.wanted({"org_id": 1}, 1)
    assert not realtime.wanted({"org_id": 2}, 1)


class _PubSub:
    def __init__(self, messages):
        self.messages = list(messages)
        self.closed = False

    async def subscribe(self, *_):
        pass

    async def get_message(self, **_):
        return self.messages.pop(0) if self.messages else None

    async def unsubscribe(self):
        pass

    async def aclose(self):
        self.closed = True


async def test_event_stream_filters_by_org_and_beats():
    pubsub = _PubSub([
        {"type": "message", "data": json.dumps({"type": "notification.new", "org_id": 1})},
        {"type": "message", "data": json.dumps({"type": "notification.new", "org_id": 2})},
        {"type": "message", "data": "not json"},
        None,
    ])
    redis = MagicMock()
    redis.pubsub.return_value = pubsub
    calls = {"n": 0}

    async def disconnected():
        calls["n"] += 1
        return calls["n"] > 4

    with patch("src.services.messaging.realtime.get_async_redis", return_value=redis), \
         patch.object(realtime, "HEARTBEAT_SECONDS", 0):
        frames = [f async for f in realtime.event_stream(7, 1, {"type": "hello"}, disconnected)]
    assert frames[0] == 'data: {"type": "hello"}\n\n'
    assert sum('"org_id": 1' in f for f in frames) == 1 and not any('"org_id": 2' in f for f in frames)
    assert ": ping\n\n" in frames and pubsub.closed

    with patch("src.services.messaging.realtime.get_async_redis", return_value=None):
        frames = [f async for f in realtime.event_stream(7, 1, {}, disconnected)]
    assert "unavailable" in frames[0]

    class Broken(_PubSub):
        async def get_message(self, **_):
            import asyncio

            raise asyncio.CancelledError

        async def aclose(self):
            raise RuntimeError

    redis.pubsub.return_value = Broken([])
    with patch("src.services.messaging.realtime.get_async_redis", return_value=redis):
        frames = [f async for f in realtime.event_stream(7, None, {"type": "hello"}, AsyncMock(return_value=False))]
    assert len(frames) == 1


# ---------------------------------------------------------------------------
# Digest
# ---------------------------------------------------------------------------


def test_digest_helpers():
    assert digest.copy("fr-CA", "cta") == "Ouvrir les notifications"
    assert digest.copy("xx", "subject", count=2).startswith("2 ")
    now = datetime(2026, 11, 13, tzinfo=timezone.utc)
    assert digest.is_due(NotificationPreference(user_id=1, email_digest="daily"), now)
    assert not digest.is_due(NotificationPreference(user_id=1, email_digest="off"), now)
    recent = (now - timedelta(days=2)).isoformat()
    assert digest.is_due(NotificationPreference(user_id=1, email_digest="daily", last_digest_at=recent), now)
    assert not digest.is_due(NotificationPreference(user_id=1, email_digest="weekly", last_digest_at=recent), now)
    assert digest.is_due(NotificationPreference(user_id=1, email_digest="weekly", last_digest_at="garbage"), now)
    assert digest._parse("2026-11-01T00:00:00").tzinfo is not None
    html = digest.render([Notification(title="<b>x</b>", body="b", data={"path": "/p"}), Notification(title="y", body="", data={})],
                         base_url="https://o.test", org_name="Org", lang="en")
    assert "&lt;b&gt;" in html and 'href="https://o.test/p"' in html and 'href="https://o.test/notifications"' in html


async def test_run_digests(db, org, admin_user, regular_user, monkeypatch):
    now = datetime.now(timezone.utc)
    await svc.update_preferences(db, admin_user.id, email_digest="daily")
    await svc.update_preferences(db, regular_user.id, email_digest="daily", channels={"people": {"email": False}})
    await svc.notify(db, [
        _n(admin_user.id, type="assignment_due", title="Due"),
        _n(admin_user.id, type="message", title="Chatter"),
        _n(admin_user.id, type="assignment_due", title="No org", org_id=None),
        _n(regular_user.id, type="join_request", title="Join"),
    ])
    sent = []
    with patch("src.services.users.emails._send_notification_email", side_effect=lambda **kw: sent.append(kw)), \
         patch("src.services.nudges.links.org_base_url", new=AsyncMock(return_value="https://test-org.test/")):
        assert await digest.run_digests(db, now) == 2
        # Already emailed / not due: nothing more.
        assert await digest.run_digests(db, now) == 0
    assert {s["to"] for s in sent} == {"admin@test.com"}
    rows = {r.title: r for r in await _rows(db)}
    assert rows["Due"].emailed_at and rows["No org"].emailed_at and not rows["Chatter"].emailed_at
    assert not rows["Join"].emailed_at  # email off for that category

    monkeypatch.setenv("LEARNHOUSE_NOTIFICATIONS_DIGEST_DISABLED", "1")
    assert await digest.run_digests(db, now + timedelta(days=3)) == 0
    monkeypatch.delenv("LEARNHOUSE_NOTIFICATIONS_DIGEST_DISABLED")

    # A failing send rolls back that user and moves on.
    await svc.notify(db, [_n(admin_user.id, type="assignment_due", title="Again")])
    with patch.object(digest, "send_digest", side_effect=RuntimeError("smtp")):
        assert await digest.run_digests(db, now + timedelta(days=3)) == 0


async def test_run_digests_skips_people_without_email(db, org, admin_user):
    await svc.update_preferences(db, admin_user.id, email_digest="daily")
    await svc.notify(db, [_n(admin_user.id, type="assignment_due", title="Due")])
    user = await db.get(User, admin_user.id)
    user.email = ""
    db.add(user)
    await db.commit()
    assert await digest.run_digests(db) == 0
    assert (await _rows(db))[0].emailed_at


# ---------------------------------------------------------------------------
# HTTP routes added for the web
# ---------------------------------------------------------------------------


@pytest.fixture
def app(db, admin_user):
    app = FastAPI()
    app.include_router(router, prefix=B)
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_authenticated_non_api_token_user] = lambda: admin_user
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def test_routes(client, db, org, admin_user):
    await svc.notify(db, [_n(admin_user.id, title="p"), _n(admin_user.id, type="member_joined", title="a")])
    r = await client.get(B, params={"audience": "admin", "q": "a", "important": False, "archived": False})
    assert [i["title"] for i in r.json()["items"]] == ["a"]
    assert (await client.get(f"{B}/unread_count", params={"audience": "admin"})).json()["unread_count"] == 1
    assert (await client.get(f"{B}/counts", params={"org_id": org.id})).json()["personal"]["unread_count"] == 1

    uuid = r.json()["items"][0]["notification_uuid"]
    assert (await client.post(f"{B}/{uuid}/archive")).status_code == 200
    assert (await client.post(f"{B}/{uuid}/unarchive")).status_code == 200
    # Archiving read it; bring it back unread, then read it.
    assert (await client.post(f"{B}/{uuid}/unread")).json()["changed"] == 1
    assert (await client.post(f"{B}/{uuid}/read")).json()["marked"] == 1
    r = await client.post(f"{B}/bulk", json={"action": "read", "all": True, "audience": "admin"})
    assert r.json()["unread_count"] == 0
    assert (await client.post(f"{B}/bulk", json={"action": "nuke", "all": True})).status_code == 422
    r = await client.post(f"{B}/read", json={"all": True, "audience": "all"})
    assert r.status_code == 200

    r = await client.put(f"{B}/preferences", json={"channels": {"plan": {"push": True}}, "email_digest": "daily"})
    assert r.json()["channels"]["plan"]["push"] is True and r.json()["email_digest"] == "daily"

    r = await client.get(f"{B}/org/{org.id}/routing")
    assert r.json()["types"]["submission_to_grade"]["roles"] == ["course_authors"]
    r = await client.put(f"{B}/org/{org.id}/routing", json={"routing": {"submission_to_grade": ["admins"]}})
    assert r.json()["types"]["submission_to_grade"]["roles"] == ["admins"]
    assert (await client.put(f"{B}/org/{org.id}/routing", json={"routing": {"x": ["robots"]}})).status_code == 422


async def test_routing_is_for_admins(app, client, org, regular_user):
    app.dependency_overrides[get_authenticated_non_api_token_user] = lambda: regular_user
    assert (await client.get(f"{B}/org/{org.id}/routing")).status_code == 403
    assert (await client.put(f"{B}/org/{org.id}/routing", json={"routing": {}})).status_code == 403


async def test_stream_route(app, client, org, other_org):
    async def fake(user_id, org_id, hello, is_disconnected):
        yield f"data: {json.dumps(hello)}\n\n"

    with patch.object(realtime, "event_stream", side_effect=fake):
        r = await client.get(f"{B}/stream", params={"org_id": org.id})
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream")
    assert '"type": "hello"' in r.text and '"counts"' in r.text
    # Not a member of the other org: refused before streaming.
    assert (await client.get(f"{B}/stream", params={"org_id": other_org.id})).status_code == 403


# ---------------------------------------------------------------------------
# Mobile contract: the original keys and meanings are unchanged
# ---------------------------------------------------------------------------

MOBILE_ITEM_KEYS = ["notification_uuid", "org_id", "type", "category", "title", "body", "data", "image",
                    "count", "read", "read_at", "created_at"]


async def test_mobile_contract(client, db, org, admin_user):
    await svc.notify(db, [_n(admin_user.id, title="m", type="message"), _n(admin_user.id, title="adm", type="join_request")])
    body = (await client.get(B, params={"org_id": org.id})).json()
    assert {"items", "next_cursor", "unread_count", "unread_by_category"} <= set(body)
    item = body["items"][0]
    assert list(item)[:len(MOBILE_ITEM_KEYS)] == MOBILE_ITEM_KEYS
    # The default list is the personal inbox: admin rows never reach old clients.
    assert [i["title"] for i in body["items"]] == ["m"] and body["unread_count"] == 1
    assert {"messages", "assignments", "courses", "live"} <= set(body["unread_by_category"])
    prefs = (await client.get(f"{B}/preferences")).json()
    assert prefs["push_enabled"] is True and {"messages", "assignments", "courses", "live"} <= set(prefs["push_categories"])
    r = await client.post(f"{B}/read", json={"all": True})
    assert {"marked", "unread_count", "unread_by_category"} <= set(r.json())


# ---------------------------------------------------------------------------
# Agent tools
# ---------------------------------------------------------------------------


async def test_agent_tools(db, org, admin_user, regular_user):
    from src.services.ai.tools import ToolContext, ToolRegistry, make_synthetic_request, refs, run_tool
    from src.services.ai.tools import notifications as tools

    registry = ToolRegistry()
    registry.register_all(tools.SPECS)

    def ctx(user):
        return ToolContext(request=make_synthetic_request(), db_session=db, user=user, org=org, org_slug=org.slug,
                           mode="execute", scope_key="t", surface="mcp")

    await svc.notify(db, [_n(admin_user.id, title="Graded", type="assignment_graded"), _n(admin_user.id, type="join_request", title="Join")])
    with patch.object(refs, "web_base", new=AsyncMock(return_value="https://acme.test")):
        out = await run_tool(registry, "list_my_notifications", {}, ctx(admin_user))
        assert out.status == "executed", out.reason
        assert [i["title"] for i in out.result["items"]] == ["Graded"]
        assert out.result["url"] == "https://acme.test/notifications"
        out = await run_tool(registry, "list_my_notifications", {"audience": "admin"}, ctx(admin_user))
        assert out.result["items"][0]["title"] == "Join" and out.result["url"].endswith("/dash/notifications")
        out = await run_tool(registry, "mark_notifications_read", {"all": True}, ctx(admin_user))
        assert out.result["marked"] == 1
        out = await run_tool(registry, "get_my_notification_settings", {}, ctx(admin_user))
        assert out.result["email_digest"] == "off"
        out = await run_tool(registry, "get_notification_routing", {}, ctx(admin_user))
        assert "submission_to_grade" in out.result["types"]
        out = await run_tool(registry, "update_notification_routing", {"routing": {"join_request": ["maintainers"]}}, ctx(admin_user))
        assert out.status == "executed" and out.result["types"]["join_request"]["roles"] == ["maintainers"]
        out = await run_tool(registry, "get_notification_routing", {}, ctx(regular_user))
        assert out.status == "denied"

    with patch.object(refs, "web_base", new=AsyncMock(return_value="")):
        out = await run_tool(registry, "list_my_notifications", {}, ctx(admin_user))
        assert out.result["url"] is None
        out = await run_tool(registry, "get_my_notification_settings", {}, ctx(admin_user))
        assert out.result["url"] is None

    token = APITokenUser(id=7, user_uuid="apitoken_x", username="t", org_id=org.id, rights={}, created_by_user_id=admin_user.id)
    out = await run_tool(registry, "list_my_notifications", {}, ctx(token))
    assert out.status == "denied"


async def test_scheduler_logs_digests(engine):
    from sqlalchemy.ext.asyncio import async_sessionmaker
    from sqlmodel.ext.asyncio.session import AsyncSession

    from src.services.notifications import scheduler

    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    with patch("src.core.events.database._async_session_factory", factory), \
         patch.object(scheduler, "_claim", new=AsyncMock(return_value=True)), \
         patch("src.services.notifications.events.run_assignment_due_reminders", new=AsyncMock(return_value=0)), \
         patch("src.services.notifications.notifications.prune", new=AsyncMock(return_value=0)), \
         patch.object(digest, "run_digests", new=AsyncMock(return_value=3)) as runs:
        await scheduler.tick(datetime(2026, 11, 12, tzinfo=timezone.utc))
    runs.assert_awaited_once()


async def test_large_fan_out_goes_to_background_batches(db, org, admin_user, regular_user):
    import asyncio

    await _user(db, org, 40, "u40")
    await _user(db, org, 41, "u41")
    items = [_n(uid, type="course_update", title="Big") for uid in (admin_user.id, regular_user.id, 40, 41)]
    with patch.object(svc, "BULK_THRESHOLD", 2), patch.object(svc, "BATCH_SIZE", 3):
        assert await svc.notify(db, items) == []  # the request returns at once
        await asyncio.gather(*list(svc._tasks))
    assert sorted(r.user_id for r in await _rows(db)) == [admin_user.id, regular_user.id, 40, 41]


def test_grade_context_helpers():
    from src.services.notifications import events

    assert events._excerpt(None) is None and events._excerpt("  a \n b ") == "a b"
    assert events._excerpt("x" * 200, 10) == "x" * 9 + "…"
    assert events._grade_display({"display_grade": "B+"}) == "B+"
    assert events._grade_display({"percentage": 91.6}) == "92%"
    assert events._grade_display({}) is None


async def test_replace_read_keeps_one_row_per_group(db, org, admin_user):
    # Two old rows for the same group (written before the rule), one read.
    db.add(Notification(user_id=admin_user.id, org_id=org.id, type="submission_to_grade", category="teaching",
                        audience="admin", group_key="submit:1:2", read_at="2026-01-01", creation_date="", update_date=""))
    db.add(Notification(user_id=admin_user.id, org_id=org.id, type="submission_to_grade", category="teaching",
                        audience="admin", group_key="submit:1:2", creation_date="", update_date=""))
    await db.commit()
    await svc.notify(db, [_n(admin_user.id, type="submission_to_grade", title="Again", group_key="submit:1:2", replace_read=True)])
    rows = await _rows(db, admin_user.id)
    assert [(r.title, r.count) for r in rows] == [("Again", 2)]
