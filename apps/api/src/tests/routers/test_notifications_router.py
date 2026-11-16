"""Router tests for src/routers/notifications.py.

Every route is exercised once over HTTP so the wiring (paths, bodies, query
params, auth dependency) is covered; behaviour lives in the service tests.
"""

from unittest.mock import patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.routers.notifications import router
from src.security.api_token_utils import get_authenticated_non_api_token_user
from src.services.notifications.notifications import NotificationInput, notify

B = "/api/v1/notifications"
TOKEN = "ExponentPushToken[abcdefghijklmnop]"


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


async def _seed(db, user_id, n=3, **kw):
    with patch("src.services.notifications.push.schedule_push"):
        await notify(db, [NotificationInput(user_id=user_id, org_id=1, type=kw.get("type", "message"), title=f"n{i}") for i in range(n)])


async def test_inbox_flow(client, db, org, admin_user):
    await _seed(db, admin_user.id)

    r = await client.get(B, params={"org_id": org.id, "limit": 2})
    assert r.status_code == 200
    body = r.json()
    assert [i["title"] for i in body["items"]] == ["n2", "n1"]
    assert body["unread_count"] == 3 and body["next_cursor"]

    r = await client.get(B, params={"cursor": body["next_cursor"], "unread_only": True, "category": "messages"})
    assert [i["title"] for i in r.json()["items"]] == ["n0"]

    assert (await client.get(f"{B}/unread_count", params={"org_id": org.id})).json()["unread_count"] == 3

    first = body["items"][0]["notification_uuid"]
    r = await client.post(f"{B}/{first}/read")
    assert r.json()["marked"] == 1 and r.json()["unread_count"] == 2

    r = await client.post(f"{B}/read", json={"notification_uuids": [body["items"][1]["notification_uuid"]]})
    assert r.json()["unread_count"] == 1
    r = await client.post(f"{B}/read", json={"all": True, "org_id": org.id, "category": "messages"})
    assert r.json()["unread_count"] == 0
    assert (await client.post(f"{B}/read", json={})).status_code == 400

    assert (await client.delete(f"{B}/{first}")).json() == {"deleted": True}
    assert (await client.delete(f"{B}/{first}")).status_code == 404


async def test_bad_query_is_rejected(client):
    assert (await client.get(B, params={"category": "spam"})).status_code == 422
    assert (await client.get(B, params={"limit": 0})).status_code == 422
    assert (await client.get(B, params={"cursor": "x"})).status_code == 400


async def test_preferences(client):
    r = await client.get(f"{B}/preferences")
    assert r.json()["push_enabled"] is True
    r = await client.put(f"{B}/preferences", json={"push_enabled": False, "push_categories": {"live": False}})
    body = r.json()
    assert body["push_enabled"] is False
    assert {k: body["push_categories"][k] for k in ("messages", "assignments", "courses", "live")} == {
        "messages": True, "assignments": True, "courses": True, "live": False}
    r = await client.put(f"{B}/preferences", json={"push_enabled": True})
    assert r.json()["push_enabled"] is True and r.json()["push_categories"]["live"] is False
    assert (await client.put(f"{B}/preferences", json={"push_categories": {"spam": True}})).status_code == 422


async def test_devices(client, org):
    r = await client.post(f"{B}/devices", json={"token": TOKEN, "platform": "ios", "org_id": org.id, "device_name": "iPhone"})
    assert r.status_code == 200 and r.json()["token"] == TOKEN
    assert [d["device_name"] for d in (await client.get(f"{B}/devices")).json()] == ["iPhone"]
    assert (await client.post(f"{B}/devices", json={"token": "bad", "platform": "ios"})).status_code == 400
    assert (await client.post(f"{B}/devices", json={"token": TOKEN, "platform": "web"})).status_code == 422
    r = await client.post(f"{B}/devices/unregister", json={"token": TOKEN})
    assert r.json() == {"removed": True}
    assert (await client.get(f"{B}/devices")).json() == []


async def test_requires_sign_in(db):
    app = FastAPI()
    app.include_router(router, prefix=B)
    app.dependency_overrides[get_db_session] = lambda: db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        r = await c.get(B)
    assert r.status_code in (401, 403)
