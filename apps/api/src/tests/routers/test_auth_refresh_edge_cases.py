"""Edge cases of GET /auth/refresh and its ``_token_age_seconds`` helper.

The happy path and the password-change / revocation guards are pinned in
src/tests/security/test_remediation_auth_refresh.py. These cover the remaining
rejections (token without a subject, subject with no account) and a token whose
``iat`` claim is not a timestamp, which must not crash the endpoint.
"""

import time
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.users import AnonymousUser
from src.routers.auth import (
    JWT_REFRESH_COOKIE_NAME,
    _token_age_seconds,
    router as auth_router,
)
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


@pytest.fixture(autouse=True)
def _allow_refresh_rate_limit():
    with patch("src.routers.auth.check_refresh_rate_limit", return_value=(True, None)):
        yield


async def _refresh(client):
    return await client.get(
        "/api/v1/auth/refresh",
        cookies={JWT_REFRESH_COOKIE_NAME: "presented-token"},
    )


class TestTokenAgeSeconds:
    def test_no_payload(self):
        assert _token_age_seconds(None) is None
        assert _token_age_seconds({}) is None

    def test_payload_without_iat(self):
        assert _token_age_seconds({"sub": "user@test.com"}) is None

    def test_iat_that_is_not_a_timestamp(self):
        # A string iat would raise TypeError inside fromtimestamp; the helper
        # only feeds a log line, so it reports "unknown" instead.
        assert _token_age_seconds({"iat": "yesterday"}) is None

    def test_age_of_a_recent_token(self):
        age = _token_age_seconds({"iat": int(time.time()) - 30})
        assert 29 <= age <= 35


class TestRefreshRejections:
    async def test_token_without_subject_is_rejected(self, client):
        with patch(
            "src.routers.auth.decode_refresh_token",
            return_value={"iat": int(time.time()), "jti": "j1"},
        ), patch(
            "src.routers.auth.security_get_user", new_callable=AsyncMock
        ) as get_user:
            response = await _refresh(client)

        assert response.status_code == 401
        assert response.json()["detail"] == "Invalid credentials"
        # No subject means there is nobody to look up.
        get_user.assert_not_awaited()

    async def test_subject_without_account_is_rejected(self, client):
        # No iat either: the user_not_found log line must still be written.
        with patch(
            "src.routers.auth.decode_refresh_token",
            return_value={"sub": "ghost@test.com"},
        ), patch(
            "src.routers.auth.security_get_user",
            new_callable=AsyncMock,
            return_value=None,
        ), patch("src.routers.auth.create_access_token") as mint:
            response = await _refresh(client)

        assert response.status_code == 401
        mint.assert_not_called()

    async def test_user_without_id_is_rejected(self, client):
        with patch(
            "src.routers.auth.decode_refresh_token",
            return_value={"sub": "ghost@test.com", "iat": int(time.time())},
        ), patch(
            "src.routers.auth.security_get_user",
            new_callable=AsyncMock,
            return_value=SimpleNamespace(id=None, email="ghost@test.com"),
        ):
            response = await _refresh(client)

        assert response.status_code == 401


class TestUnparseableIat:
    async def test_non_numeric_iat_skips_password_cutover_and_still_rotates(self, client):
        """A token with a garbage ``iat`` has no issue time, so the
        password-change cutover cannot be applied; the revocation check is
        asked about an unknown issue time (None) and decides."""
        user = SimpleNamespace(
            id=42,
            email="user@test.com",
            password_changed_at=datetime.now(timezone.utc),
        )
        with patch(
            "src.routers.auth.decode_refresh_token",
            return_value={"sub": user.email, "iat": "not-a-timestamp"},
        ), patch(
            "src.routers.auth.security_get_user",
            new_callable=AsyncMock,
            return_value=user,
        ), patch(
            "src.routers.auth._is_token_revoked_for_user", return_value=False
        ) as revoked, patch(
            "src.routers.auth.create_access_token", return_value="new-access"
        ), patch(
            "src.routers.auth.create_refresh_token", return_value="new-refresh"
        ), patch("src.routers.auth._store_refresh_grace") as store_grace:
            response = await _refresh(client)

        assert response.status_code == 200
        assert response.json()["access_token"] == "new-access"
        assert response.json()["refresh_token"] == "new-refresh"
        revoked.assert_called_once_with(42, None)
        # No jti on the token, so there is no grace entry to cache.
        store_grace.assert_not_called()
