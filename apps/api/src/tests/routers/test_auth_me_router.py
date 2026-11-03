"""Router tests for the ``GET /auth/me`` identity endpoint (src/routers/auth.py).

The endpoint describes the current authenticated principal for both JWT
sessions and API tokens, and rejects anonymous callers with 401.
"""

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.routers.auth import router as auth_router
from src.security.auth import get_current_user
from src.db.users import AnonymousUser, APITokenUser


@pytest.fixture
def app(db):
    app = FastAPI()
    app.include_router(auth_router, prefix="/auth")
    app.dependency_overrides[get_db_session] = lambda: db
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


async def test_me_anonymous_returns_401(app, client):
    app.dependency_overrides[get_current_user] = lambda: AnonymousUser()
    resp = await client.get("/auth/me")
    assert resp.status_code == 401
    assert resp.headers.get("WWW-Authenticate") == "Bearer"


async def test_me_jwt_session_has_null_org_scope(app, client, admin_user):
    app.dependency_overrides[get_current_user] = lambda: admin_user
    resp = await client.get("/auth/me")
    assert resp.status_code == 200
    data = resp.json()
    assert data["is_api_token"] is False
    assert data["org_id"] is None
    assert data["org_slug"] is None
    assert data["token_name"] is None
    assert data["username"] == admin_user.username
    assert data["user_uuid"] == admin_user.user_uuid


async def test_me_api_token_reports_org_scope_and_name(app, client, org):
    token_user = APITokenUser(
        user_uuid="apitoken_test",
        username="api_token",
        org_id=org.id,
        token_name="My Integration",
    )
    app.dependency_overrides[get_current_user] = lambda: token_user
    resp = await client.get("/auth/me")
    assert resp.status_code == 200
    data = resp.json()
    assert data["is_api_token"] is True
    assert data["org_id"] == org.id
    assert data["org_slug"] == org.slug
    assert data["token_name"] == "My Integration"
    assert data["user_uuid"] == "apitoken_test"


async def test_me_api_token_with_unknown_org_returns_null_slug(app, client):
    token_user = APITokenUser(
        user_uuid="apitoken_orphan",
        username="api_token",
        org_id=999999,
        token_name="Orphan",
    )
    app.dependency_overrides[get_current_user] = lambda: token_user
    resp = await client.get("/auth/me")
    assert resp.status_code == 200
    data = resp.json()
    assert data["is_api_token"] is True
    assert data["org_id"] == 999999
    assert data["org_slug"] is None
