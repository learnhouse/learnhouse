"""
Coverage for the F-08 logout-revocation branch in ``src/routers/auth.py``.

The existing logout test in ``test_auth_router.py`` only exercises the
"token was opaque, skip revocation" path. These tests drive the happy path
(revoke_user_sessions_before is invoked) and the exception-swallowing path
(Redis is down but logout still completes).
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.routers.auth import router as auth_router


@pytest.fixture
def app(db):
    app = FastAPI()
    app.include_router(auth_router, prefix="/api/v1/auth")
    app.dependency_overrides[get_db_session] = lambda: db
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.mark.asyncio
async def test_logout_revokes_every_session_for_the_user(client, admin_user):
    """Happy path: decode_jwt yields a sub, user lookup succeeds, revoke called."""
    with patch(
        "src.routers.auth.extract_jwt_from_request",
        return_value="opaque-but-nonempty",
    ), patch(
        "src.routers.auth.decode_jwt",
        return_value={"sub": admin_user.email, "iat": 123, "exp": 999},
    ), patch(
        "src.routers.auth.security_get_user",
        new_callable=AsyncMock,
        return_value=MagicMock(id=admin_user.id),
    ), patch(
        "src.routers.auth.revoke_user_sessions_before"
    ) as revoke, patch(
        "src.routers.auth.unset_auth_cookies"
    ) as unset:
        response = await client.delete("/api/v1/auth/logout")

    assert response.status_code == 200
    revoke.assert_called_once_with(admin_user.id)
    unset.assert_called_once()


@pytest.mark.asyncio
async def test_logout_succeeds_when_revocation_store_raises(client, admin_user):
    """
    A transient Redis / DB error inside the revocation branch must not prevent
    the user from logging out — cookies still need to clear. The exception is
    swallowed and logout returns 200.
    """
    with patch(
        "src.routers.auth.extract_jwt_from_request",
        return_value="opaque-but-nonempty",
    ), patch(
        "src.routers.auth.decode_jwt",
        return_value={"sub": admin_user.email, "iat": 123, "exp": 999},
    ), patch(
        "src.routers.auth.security_get_user",
        new_callable=AsyncMock,
        side_effect=RuntimeError("db boom"),
    ), patch(
        "src.routers.auth.unset_auth_cookies"
    ) as unset:
        response = await client.delete("/api/v1/auth/logout")

    assert response.status_code == 200
    unset.assert_called_once()


@pytest.mark.asyncio
async def test_logout_skips_revocation_when_token_has_no_sub(client):
    """
    If ``decode_jwt`` yields a payload without ``sub`` (corrupt token), the
    revocation branch is skipped and the cookies still clear.
    """
    with patch(
        "src.routers.auth.extract_jwt_from_request",
        return_value="opaque",
    ), patch(
        "src.routers.auth.decode_jwt",
        return_value={"exp": 999},  # no sub
    ), patch(
        "src.routers.auth.revoke_user_sessions_before"
    ) as revoke, patch(
        "src.routers.auth.unset_auth_cookies"
    ) as unset:
        response = await client.delete("/api/v1/auth/logout")

    assert response.status_code == 200
    revoke.assert_not_called()
    unset.assert_called_once()


@pytest.mark.asyncio
async def test_logout_skips_revocation_when_user_no_longer_exists(client):
    """
    ``security_get_user`` returning ``None`` (user was deleted) must not
    crash or call revoke; logout still completes.
    """
    with patch(
        "src.routers.auth.extract_jwt_from_request",
        return_value="opaque",
    ), patch(
        "src.routers.auth.decode_jwt",
        return_value={"sub": "gone@example.com"},
    ), patch(
        "src.routers.auth.security_get_user",
        new_callable=AsyncMock,
        return_value=None,
    ), patch(
        "src.routers.auth.revoke_user_sessions_before"
    ) as revoke, patch(
        "src.routers.auth.unset_auth_cookies"
    ) as unset:
        response = await client.delete("/api/v1/auth/logout")

    assert response.status_code == 200
    revoke.assert_not_called()
    unset.assert_called_once()
