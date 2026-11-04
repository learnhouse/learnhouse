"""Rate-limit and body-validation guards in src/routers/users.py.

Signups, invite-code acceptance and the body-based password-reset endpoints all
throttle before doing any work. These pin the 429 responses (message, minutes
rounding and ``Retry-After``), the "email is required" check on the v2 reset
endpoints, and that the v2 change-password endpoints hand the body fields to
the service in the right order.
"""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.routers.users import router as users_router
from src.security.auth import get_authenticated_user, get_current_user

_NEW_USER = {
    "username": "newbie",
    "first_name": "New",
    "last_name": "User",
    "email": "newbie@test.com",
    "password": "Password123!",
}


@pytest.fixture
def app(db, admin_user):
    app = FastAPI()
    app.include_router(users_router, prefix="/api/v1/users")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: admin_user
    app.dependency_overrides[get_authenticated_user] = lambda: admin_user
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


class TestSignupRateLimit:
    async def test_signup_throttled_with_plural_minutes(self, client, org):
        with patch(
            "src.routers.users.check_signup_rate_limit", return_value=(False, 180)
        ), patch("src.routers.users.create_user", new_callable=AsyncMock) as create:
            response = await client.post(f"/api/v1/users/{org.id}", json=_NEW_USER)

        assert response.status_code == 429
        assert response.json()["detail"] == (
            "Too many signups from this address. Please try again in about 3 minutes."
        )
        assert response.headers["retry-after"] == "180"
        create.assert_not_awaited()

    async def test_signup_throttle_rounds_up_to_one_minute(self, client):
        # Under a minute left still reads "1 minute", never "0 minutes".
        with patch("src.routers.users.check_signup_rate_limit", return_value=(False, 20)):
            response = await client.post("/api/v1/users/", json=_NEW_USER)

        assert response.status_code == 429
        assert response.json()["detail"].endswith("about 1 minute.")
        assert response.headers["retry-after"] == "20"


class TestInviteAcceptanceRateLimit:
    async def test_invite_code_guessing_is_throttled(self, client, org):
        with patch(
            "src.routers.users.check_signup_rate_limit", return_value=(True, 0)
        ), patch(
            "src.routers.users.check_invite_acceptance_rate_limit",
            return_value=(False, 60),
        ) as invite_limit, patch(
            "src.routers.users.create_user_with_invite", new_callable=AsyncMock
        ) as create:
            response = await client.post(
                f"/api/v1/users/{org.id}/invite/GUESS", json=_NEW_USER
            )

        assert response.status_code == 429
        assert response.json()["detail"] == (
            "Too many invite-code attempts. Please try again in about 1 minute."
        )
        assert response.headers["retry-after"] == "60"
        assert invite_limit.call_args.args[1] == org.id
        create.assert_not_awaited()


class TestChangePasswordWithResetCodeV2:
    URL = "/api/v1/users/reset_password/change_password"

    async def test_email_is_required(self, client):
        with patch("src.routers.users.check_password_reset_rate_limit") as limit:
            response = await client.post(
                self.URL,
                json={"new_password": "N3w-password!", "org_id": 1, "reset_code": "abc"},
            )

        assert response.status_code == 422
        assert response.json()["detail"] == "email is required"
        limit.assert_not_called()

    async def test_rate_limited(self, client):
        with patch(
            "src.routers.users.check_password_reset_rate_limit", return_value=(False, 240)
        ), patch(
            "src.routers.users.change_password_with_reset_code", new_callable=AsyncMock
        ) as change:
            response = await client.post(
                self.URL,
                json={
                    "email": "user@test.com",
                    "new_password": "N3w-password!",
                    "org_id": 1,
                    "reset_code": "abc",
                },
            )

        assert response.status_code == 429
        assert "try again in 4 minutes" in response.json()["detail"]
        change.assert_not_awaited()

    async def test_passes_body_fields_to_service(self, client):
        with patch(
            "src.routers.users.check_password_reset_rate_limit", return_value=(True, 0)
        ) as limit, patch(
            "src.routers.users.change_password_with_reset_code",
            new_callable=AsyncMock,
            return_value={"detail": "Password changed"},
        ) as change:
            response = await client.post(
                self.URL,
                json={
                    "email": "user@test.com",
                    "new_password": "N3w-password!",
                    "org_id": 3,
                    "reset_code": "abc",
                },
            )

        assert response.status_code == 200
        assert response.json() == {"detail": "Password changed"}
        limit.assert_called_once_with("user@test.com")
        # (request, db, current_user, new_password, org_id, email, reset_code)
        assert change.await_args.args[3:] == ("N3w-password!", 3, "user@test.com", "abc")


class TestPlatformResetV2:
    async def test_send_code_rate_limited(self, client):
        with patch(
            "src.routers.users.check_password_reset_rate_limit", return_value=(False, 120)
        ) as limit, patch(
            "src.routers.users.send_reset_password_code_platform", new_callable=AsyncMock
        ) as send:
            response = await client.post(
                "/api/v1/users/reset_password/platform/send_reset_code",
                json={"email": "user@test.com"},
            )

        assert response.status_code == 429
        assert "try again in 2 minutes" in response.json()["detail"]
        limit.assert_called_once_with("user@test.com", action="send")
        send.assert_not_awaited()

    async def test_change_password_email_is_required(self, client):
        response = await client.post(
            "/api/v1/users/reset_password/platform/change_password",
            json={"new_password": "N3w-password!", "reset_code": "abc"},
        )

        assert response.status_code == 422
        assert response.json()["detail"] == "email is required"

    async def test_change_password_rate_limited(self, client):
        with patch(
            "src.routers.users.check_password_reset_rate_limit", return_value=(False, 300)
        ), patch(
            "src.routers.users.change_password_with_reset_code_platform",
            new_callable=AsyncMock,
        ) as change:
            response = await client.post(
                "/api/v1/users/reset_password/platform/change_password",
                json={
                    "email": "user@test.com",
                    "new_password": "N3w-password!",
                    "reset_code": "abc",
                },
            )

        assert response.status_code == 429
        assert "try again in 5 minutes" in response.json()["detail"]
        change.assert_not_awaited()

    async def test_change_password_passes_body_fields_to_service(self, client):
        with patch(
            "src.routers.users.check_password_reset_rate_limit", return_value=(True, 0)
        ), patch(
            "src.routers.users.change_password_with_reset_code_platform",
            new_callable=AsyncMock,
            return_value={"detail": "Password changed"},
        ) as change:
            response = await client.post(
                "/api/v1/users/reset_password/platform/change_password",
                json={
                    "email": "user@test.com",
                    "new_password": "N3w-password!",
                    "reset_code": "abc",
                },
            )

        assert response.status_code == 200
        # (request, db, current_user, new_password, email, reset_code)
        assert change.await_args.args[3:] == ("N3w-password!", "user@test.com", "abc")
