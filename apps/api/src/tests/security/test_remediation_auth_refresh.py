"""
F-02: refresh-token guards.

Negative tests reproduce the original vulnerabilities:
  * Refresh with a valid token whose ``iat`` predates the user's
    ``password_changed_at`` is rejected.
  * Refresh after the user's sessions were revoked is rejected.

Positive tests prove the legitimate flow still works end-to-end.
"""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.users import AnonymousUser
from src.routers.auth import JWT_REFRESH_COOKIE_NAME, router as auth_router
from src.security.auth import get_current_user


@pytest.fixture
def app(db):
    app = FastAPI()
    app.include_router(auth_router, prefix="/api/v1/auth")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: AnonymousUser()
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


def _fake_user(email="user@test.com", user_id=42, password_changed_at=None):
    return SimpleNamespace(id=user_id, email=email, password_changed_at=password_changed_at)


def _patch_happy_path(payload):
    """Shared mock stack for 'everything ok' refresh flow."""
    return [
        patch("src.routers.auth.check_refresh_rate_limit", return_value=(True, None)),
        patch("src.routers.auth.decode_refresh_token", return_value=payload),
        patch("src.routers.auth.create_access_token", return_value="new-access-token"),
        patch("src.routers.auth.create_refresh_token", return_value="rotated-refresh"),
        patch("src.routers.auth.get_token_expiry_ms", return_value=123),
        patch("src.routers.auth.get_cookie_domain_for_request", return_value=None),
        patch("src.routers.auth.is_request_secure", return_value=False),
    ]


@pytest.mark.asyncio
async def test_refresh_rejects_token_issued_before_password_change(client):
    """
    F-02: a refresh token issued at time T is invalid after the user changes
    their password at time T+1 — stolen-token-survives-password-rotation gap.
    """
    token_iat = 1_000_000_000
    password_changed_at = datetime.fromtimestamp(token_iat + 3600, tz=timezone.utc)
    user = _fake_user(password_changed_at=password_changed_at)

    stack = _patch_happy_path(
        {
            "sub": user.email,
            "iat": token_iat,
            "exp": token_iat + 86400,
            "jti": "pre-pwd-change",
        }
    )
    with stack[0], stack[1], patch(
        "src.routers.auth.security_get_user",
        new_callable=AsyncMock,
        return_value=user,
    ):
        response = await client.get(
            "/api/v1/auth/refresh",
            cookies={JWT_REFRESH_COOKIE_NAME: "stolen-but-stale"},
        )
    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid credentials"


@pytest.mark.asyncio
async def test_refresh_rejects_token_revoked_by_logout(client):
    """F-02: tokens whose iat < Redis revocation cutoff are rejected."""
    user = _fake_user()
    stack = _patch_happy_path(
        {"sub": user.email, "iat": 1, "exp": 9_999_999_999, "jti": "revoked"}
    )
    with stack[0], stack[1], patch(
        "src.routers.auth.security_get_user",
        new_callable=AsyncMock,
        return_value=user,
    ), patch(
        "src.routers.auth._is_token_revoked_for_user",
        return_value=True,
    ):
        response = await client.get(
            "/api/v1/auth/refresh",
            cookies={JWT_REFRESH_COOKIE_NAME: "revoked-token"},
        )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_refresh_happy_path_rotates_refresh_cookie(client):
    """
    On the happy path, /auth/refresh issues a new access token AND a new
    refresh cookie.
    """
    user = _fake_user()
    stack = _patch_happy_path(
        {"sub": user.email, "iat": 1, "exp": 9_999_999_999, "jti": "fresh-jti"}
    )
    ctxs = [
        patch("src.routers.auth.security_get_user", new_callable=AsyncMock, return_value=user),
        patch("src.routers.auth._is_token_revoked_for_user", return_value=False),
    ]
    with stack[0], stack[1], stack[2], stack[3], stack[4], stack[5], stack[6], \
         ctxs[0], ctxs[1]:
        response = await client.get(
            "/api/v1/auth/refresh",
            cookies={JWT_REFRESH_COOKIE_NAME: "legit-token"},
        )
    assert response.status_code == 200
    assert response.json()["access_token"] == "new-access-token"
    # Both cookies should have been set: access_token_cookie + refresh_token_cookie.
    set_cookies = [c for c in response.headers.get_list("set-cookie")]
    assert any("refresh_token_cookie=rotated-refresh" in c for c in set_cookies), set_cookies
