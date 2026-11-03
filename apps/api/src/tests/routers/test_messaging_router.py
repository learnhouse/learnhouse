"""Router tests for src/routers/messaging/messaging.py.

Every route is exercised once over HTTP so the wiring (paths, bodies, query
params, auth dependency) is covered; behaviour lives in the service tests.
"""

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.user_organizations import UserOrganization
from src.db.users import User
from src.routers.messaging.messaging import router
from src.security.api_token_utils import get_authenticated_non_api_token_user


@pytest.fixture(autouse=True)
def _ee():
    with patch("src.security.features_utils.resolve.get_deployment_mode", return_value="ee"), \
         patch("src.services.messaging.messaging.enforce_org_mfa", new=AsyncMock()):
        yield


@pytest.fixture
def app(db, admin_user):
    app = FastAPI()
    app.include_router(router, prefix="/api/v1/messaging")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_authenticated_non_api_token_user] = lambda: admin_user
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


B = "/api/v1/messaging"


async def test_oss_is_forbidden(client, org):
    with patch("src.security.features_utils.resolve.get_deployment_mode", return_value="oss"):
        r = await client.get(f"{B}/conversations", params={"org_id": org.id})
    assert r.status_code == 403


async def test_full_conversation_flow(client, db, org, course, admin_user, regular_user):
    r = await client.post(f"{B}/conversations", json={"org_id": org.id, "kind": "dm", "user_uuids": [regular_user.user_uuid]})
    assert r.status_code == 200
    conv = r.json()["conversation_uuid"]

    assert (await client.get(f"{B}/conversations", params={"org_id": org.id})).json()[0]["conversation_uuid"] == conv
    assert (await client.get(f"{B}/conversations/{conv}")).json()["kind"] == "dm"
    assert (await client.patch(f"{B}/conversations/{conv}", json={"pinned": True})).json()["pinned"] is True

    r = await client.post(f"{B}/conversations/{conv}/messages", json={"content": "hello", "course_uuid": course.course_uuid})
    assert r.status_code == 200
    msg = r.json()["message"]["message_uuid"]

    page = (await client.get(f"{B}/conversations/{conv}/messages", params={"limit": 10})).json()
    assert page["messages"][-1]["message_uuid"] == msg

    assert (await client.patch(f"{B}/messages/{msg}", json={"content": "hello!"})).json()["content"] == "hello!"
    assert (await client.post(f"{B}/messages/{msg}/reactions", json={"emoji": "🎉"})).json()["reactions"][0]["emoji"] == "🎉"
    assert (await client.post(f"{B}/conversations/{conv}/typing", json={"is_typing": True})).json() == {"ok": True}
    assert "last_read_message_id" in (await client.post(f"{B}/conversations/{conv}/read", json={})).json()
    assert (await client.get(f"{B}/search", params={"org_id": org.id, "q": "hello"})).json()[0]["message_uuid"] == msg
    assert (await client.get(f"{B}/unread", params={"org_id": org.id})).json()["unread"] == 0
    assert (await client.delete(f"{B}/messages/{msg}")).json() == {"deleted": True}
    assert (await client.delete(f"{B}/conversations/{conv}/members/me")).json() == {"left": True}


async def test_group_members(client, db, org, admin_user, regular_user):
    now = str(datetime.now())
    db.add(User(id=9, username="nina", first_name="Nina", last_name="N", email="n@x.com", password="x",
                user_uuid="user_nina", creation_date=now, update_date=now))
    db.add(UserOrganization(user_id=9, org_id=org.id, role_id=4, creation_date=now, update_date=now))
    await db.commit()
    conv = (await client.post(f"{B}/conversations", json={
        "org_id": org.id, "kind": "group", "user_uuids": [regular_user.user_uuid], "title": "Crew",
    })).json()["conversation_uuid"]
    r = await client.post(f"{B}/conversations/{conv}/members", json={"user_uuids": ["user_nina"]})
    assert r.json()["member_count"] == 3


async def test_people_presence_and_preferences(client, org, regular_user):
    people = (await client.get(f"{B}/directory", params={"org_id": org.id, "q": "reg"})).json()
    assert people[0]["user_uuid"] == regular_user.user_uuid
    presence = (await client.get(f"{B}/presence", params={"org_id": org.id, "user_ids": f"{regular_user.id},x"})).json()
    assert presence[0]["user_id"] == regular_user.id
    me = (await client.put(f"{B}/me", params={"org_id": org.id}, json={"email_mode": "off", "sounds": False})).json()
    assert me["email_mode"] == "off" and me["sounds"] is False
    assert (await client.get(f"{B}/me", params={"org_id": org.id})).json()["email_mode"] == "off"


async def test_broadcast_routes(client, org, course):
    targets = (await client.get(f"{B}/broadcast/targets", params={"org_id": org.id})).json()
    assert targets[0]["course_uuid"] is None  # admins can announce org-wide
    r = await client.post(f"{B}/broadcast", json={"org_id": org.id, "course_uuid": course.course_uuid, "content": "Hi class"})
    assert r.status_code == 200
    assert r.json()["message"]["kind"] == "announcement"


async def test_agent_routes(client, org):
    agents = (await client.get(f"{B}/agents", params={"org_id": org.id})).json()
    assert agents[0]["is_default"]
    created = (await client.post(f"{B}/agents", json={
        "org_id": org.id, "name": "Tutor", "emoji": "🦉", "color": "#112233", "secondary_color": "#445566",
    })).json()
    uuid = created["agent_uuid"]
    assert (await client.get(f"{B}/agents/{uuid}")).json()["name"] == "Tutor"
    assert (await client.patch(f"{B}/agents/{uuid}", json={"tone": "concise"})).json()["tone"] == "concise"
    chat = (await client.post(f"{B}/agents/{uuid}/chat", json={})).json()
    assert chat["kind"] == "agent"
    assert (await client.delete(f"{B}/agents/{uuid}")).json() == {"deleted": True}
    assert (await client.post(f"{B}/agents", json={"org_id": org.id, "name": "X", "color": "blue"})).status_code == 422


async def test_stream_says_hello(app, db, org, admin_user):
    closed_before_stream = []

    async def fake_stream(org_id, user_id, hello, presence_payload, on_offline, is_disconnected):
        closed_before_stream.append(db.close.await_count)
        yield f"data: {hello['type']}:{user_id}\n\n"

    # The request's DB connection must not stay checked out for the life of the stream.
    with patch("src.routers.messaging.messaging.realtime.event_stream", fake_stream), \
         patch.object(db, "close", new=AsyncMock(wraps=db.close)):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            r = await c.get(f"{B}/stream", params={"org_id": org.id})
    assert closed_before_stream == [1]
    assert r.status_code == 200
    assert r.text == f"data: hello:{admin_user.id}\n\n"
    assert r.headers["content-type"].startswith("text/event-stream")


async def test_reminder_routes(client, org):
    from datetime import datetime, timedelta, timezone

    due = (datetime.now(timezone.utc) + timedelta(hours=3)).isoformat()
    r = await client.post(f"{B}/reminders", json={"org_id": org.id, "text": "Review notes", "due_at": due})
    assert r.status_code == 200
    uuid = r.json()["reminder_uuid"]
    assert (await client.get(f"{B}/reminders", params={"org_id": org.id})).json()[0]["reminder_uuid"] == uuid
    assert (await client.delete(f"{B}/reminders/{uuid}")).json()["status"] == "cancelled"
    bad = await client.post(f"{B}/reminders", json={"org_id": org.id, "text": "x", "due_at": "2020-01-01T00:00:00Z"})
    assert bad.status_code == 400
