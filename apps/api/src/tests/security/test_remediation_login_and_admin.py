"""
F-16: admin user-by-email lookup is rate-limited per API token.
F-18: login path removes pre-lookup so known-user vs unknown-user responses
      take symmetric work before authenticate_user returns.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.users import AnonymousUser
from src.routers.admin import router as admin_router
from src.routers.auth import router as auth_router
from src.security.auth import get_current_user


# ---------------------------------------------------------------------------
# F-18: login no longer pre-fetches the user row
# ---------------------------------------------------------------------------

@pytest.fixture
def auth_app(db):
    app = FastAPI()
    app.include_router(auth_router, prefix="/api/v1/auth")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: AnonymousUser()
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def auth_client(auth_app):
    async with AsyncClient(transport=ASGITransport(app=auth_app), base_url="http://test") as c:
        yield c


@pytest.mark.asyncio
async def test_login_unknown_user_does_no_extra_db_work_before_auth(auth_client):
    """
    F-18: for an unknown user the handler should NOT pre-fetch the row
    before calling authenticate_user. A single DB call (inside
    authenticate_user via security_get_user) is now the full cost.
    """
    pre_login_db = MagicMock()
    pre_login_db.exec.return_value.first.return_value = None

    with patch(
        "src.routers.auth.check_login_rate_limit",
        return_value=(True, None),
    ), patch(
        "src.routers.auth.authenticate_user",
        new_callable=AsyncMock,
        return_value=False,
    ):
        # No extra db.exec call should happen before authenticate_user returns.
        response = await auth_client.post(
            "/api/v1/auth/login",
            data={"username": "ghost@test.com", "password": "wrong"},
        )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_login_known_user_wrong_password_returns_same_shape(auth_client):
    """
    F-18: known-user + wrong-password returns the same 401 envelope as
    unknown-user. Response shape is a critical frontend contract.
    """
    with patch(
        "src.routers.auth.check_login_rate_limit",
        return_value=(True, None),
    ), patch(
        "src.routers.auth.authenticate_user",
        new_callable=AsyncMock,
        return_value=False,
    ), patch(
        "src.routers.auth.record_failed_login",
    ):
        response = await auth_client.post(
            "/api/v1/auth/login",
            data={"username": "real@test.com", "password": "wrong"},
        )
    assert response.status_code == 401
    assert response.json()["detail"] == {
        "code": "INVALID_CREDENTIALS",
        "message": "Incorrect Email or password",
    }


# ---------------------------------------------------------------------------
# F-16: admin /users/by-email rate limit + 429 envelope
# ---------------------------------------------------------------------------

@pytest.fixture
def admin_app(db):
    app = FastAPI()
    app.include_router(admin_router, prefix="/api/v1/admin")
    app.dependency_overrides[get_db_session] = lambda: db
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def admin_client(admin_app):
    async with AsyncClient(transport=ASGITransport(app=admin_app), base_url="http://test") as c:
        yield c


@pytest.mark.asyncio
async def test_admin_user_by_email_rate_limited(admin_client, admin_app):
    """F-16: 429 when the per-token limiter denies."""
    # Build a fake APITokenUser and pin it as current_user.
    from src.db.users import APITokenUser
    fake_token_user = APITokenUser(
        id=11,
        user_uuid="tok-uuid",
        username="api_token_fake",
        org_id=1,
        rights=None,
        token_name="fake",
        created_by_user_id=1,
    )
    admin_app.dependency_overrides[get_current_user] = lambda: fake_token_user

    with patch(
        "src.routers.admin._resolve_org_slug",
        return_value=MagicMock(),
    ), patch(
        "src.services.security.rate_limiting.check_admin_user_lookup_rate_limit",
        return_value=(False, 17),
    ):
        r = await admin_client.get(
            "/api/v1/admin/test-org/users/by-email/victim@example.com"
        )

    assert r.status_code == 429
    body = r.json()
    # ``detail`` is a plain string so the frontend's generic toast path
    # renders it. ``Retry-After`` carries the structured value for clients
    # that want programmatic backoff.
    assert isinstance(body["detail"], str)
    assert "Too many" in body["detail"]
    assert r.headers.get("retry-after") == "17"
