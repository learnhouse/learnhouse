"""Endpoint tests for the passwordless magic-link flow in src/routers/auth.py.

Covers POST /magic-link/request (generic 200 responses that never reveal whether
an account exists, the org-policy short-circuit, and rate limiting) and POST
/magic-link/verify (session issuance, the second-factor branch, and the 410 for
an invalid/used link). Also pins that /auth/refresh carries a session's
provenance (amr / sorg) across rotation.
"""

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.organization_config import OrganizationConfig
from src.db.user_mfa import UserMFA
from src.db.users import AnonymousUser, User
from src.routers.auth import JWT_REFRESH_COOKIE_NAME, router as auth_router
from src.security.auth import decode_jwt, get_current_user
from src.security.session_context import AMR_CLAIM, SORG_CLAIM


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


@pytest.fixture
async def verified_user(db):
    user = User(
        id=21,
        username="magic",
        first_name="Magic",
        last_name="User",
        email="magic@test.com",
        password="hashed_password",
        user_uuid="user_magic",
        email_verified=True,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def _enroll_confirmed(db, user_id):
    now = str(datetime.now())
    db.add(
        UserMFA(
            user_id=user_id,
            secret_encrypted="ciphertext",
            confirmed_at=now,
            creation_date=now,
            update_date=now,
        )
    )
    await db.commit()


async def _set_allowed_methods(db, org_id, methods):
    db.add(
        OrganizationConfig(
            org_id=org_id,
            config={
                "config_version": "2.0",
                "admin_toggles": {"security": {"allowed_auth_methods": methods}},
            },
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
    )
    await db.commit()


class TestMagicLinkRequest:
    async def test_unknown_email_is_generic_and_sends_nothing(self, client):
        with patch(
            "src.routers.auth.check_login_rate_limit", return_value=(True, None)
        ), patch(
            "src.services.auth.magic_login.send_magic_login_email"
        ) as send_mock, patch(
            "src.services.auth.magic_login.issue_magic_login_token", return_value="tok"
        ):
            response = await client.post(
                "/api/v1/auth/magic-link/request",
                json={"email": "nobody@test.com"},
            )
        assert response.status_code == 200
        assert "login link has been sent" in response.json()["detail"]
        send_mock.assert_not_called()

    async def test_known_email_sends_link(self, client, verified_user):
        with patch(
            "src.routers.auth.check_login_rate_limit", return_value=(True, None)
        ), patch(
            "src.services.auth.magic_login.issue_magic_login_token", return_value="tok"
        ), patch(
            "src.services.auth.magic_login.send_magic_login_email"
        ) as send_mock, patch(
            "src.services.email.utils.get_base_url_from_request",
            return_value="http://test",
        ):
            response = await client.post(
                "/api/v1/auth/magic-link/request",
                json={"email": verified_user.email},
            )
        assert response.status_code == 200
        send_mock.assert_called_once()

    async def test_org_disallowing_magic_login_sends_nothing(self, client, db, org, verified_user):
        # The org restricts sign-in to password only; a magic link would be
        # refused at the org gate anyway, so none is sent.
        await _set_allowed_methods(db, org.id, ["password"])
        with patch(
            "src.routers.auth.check_login_rate_limit", return_value=(True, None)
        ), patch(
            "src.services.auth.magic_login.send_magic_login_email"
        ) as send_mock, patch(
            "src.services.auth.magic_login.issue_magic_login_token", return_value="tok"
        ):
            response = await client.post(
                "/api/v1/auth/magic-link/request",
                json={"email": verified_user.email, "org_slug": org.slug},
            )
        assert response.status_code == 200
        send_mock.assert_not_called()

    async def test_saas_unverified_user_sends_nothing(self, client, db):
        # In SaaS mode an unverified account can't log in by password; a magic
        # link must not become a verification-bypass side channel.
        unverified = User(
            id=22,
            username="unverified",
            first_name="Un",
            last_name="Verified",
            email="unverified@test.com",
            password="hashed_password",
            user_uuid="user_unverified",
            email_verified=False,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
        db.add(unverified)
        await db.commit()
        with patch(
            "src.routers.auth.check_login_rate_limit", return_value=(True, None)
        ), patch(
            "src.routers.auth.get_deployment_mode", return_value="saas"
        ), patch(
            "src.services.auth.magic_login.send_magic_login_email"
        ) as send_mock, patch(
            "src.services.auth.magic_login.issue_magic_login_token", return_value="tok"
        ):
            response = await client.post(
                "/api/v1/auth/magic-link/request",
                json={"email": unverified.email},
            )
        assert response.status_code == 200
        send_mock.assert_not_called()

    async def test_rate_limited(self, client):
        with patch(
            "src.routers.auth.check_login_rate_limit", return_value=(False, 60)
        ):
            response = await client.post(
                "/api/v1/auth/magic-link/request",
                json={"email": "x@test.com"},
            )
        assert response.status_code == 429
        assert response.json()["detail"]["code"] == "RATE_LIMITED"

    async def test_send_failure_is_swallowed_and_generic(self, client, verified_user):
        # A mail-transport error must not turn into a 500 that leaks the address
        # exists; the endpoint still returns the generic 200.
        with patch(
            "src.routers.auth.check_login_rate_limit", return_value=(True, None)
        ), patch(
            "src.services.auth.magic_login.issue_magic_login_token", return_value="tok"
        ), patch(
            "src.services.auth.magic_login.send_magic_login_email",
            side_effect=RuntimeError("smtp down"),
        ), patch(
            "src.services.email.utils.get_base_url_from_request",
            return_value="http://test",
        ):
            response = await client.post(
                "/api/v1/auth/magic-link/request",
                json={"email": verified_user.email},
            )
        assert response.status_code == 200


class TestMagicLinkVerify:
    async def test_success_mints_session(self, client, verified_user):
        with patch(
            "src.services.auth.magic_login.consume_magic_login_token",
            return_value=(verified_user.email, None),
        ), patch("src.routers.auth.set_auth_cookies") as cookies_mock, patch(
            "src.routers.auth.get_token_expiry_ms", return_value=12345
        ):
            response = await client.post(
                "/api/v1/auth/magic-link/verify", json={"token": "good-token"}
            )
        assert response.status_code == 200
        body = response.json()
        assert body["user"]["email"] == verified_user.email
        assert body["tokens"]["access_token"]
        cookies_mock.assert_called_once()

    async def test_mfa_required_branch(self, client, db, verified_user):
        await _enroll_confirmed(db, verified_user.id)
        with patch(
            "src.services.auth.magic_login.consume_magic_login_token",
            return_value=(verified_user.email, None),
        ):
            response = await client.post(
                "/api/v1/auth/magic-link/verify", json={"token": "good-token"}
            )
        assert response.status_code == 200
        body = response.json()
        assert body["mfa_required"] is True
        assert body["mfa_token"]

    async def test_unknown_user_410(self, client):
        with patch(
            "src.services.auth.magic_login.consume_magic_login_token",
            return_value=("ghost@test.com", None),
        ):
            response = await client.post(
                "/api/v1/auth/magic-link/verify", json={"token": "good-token"}
            )
        assert response.status_code == 410
        assert response.json()["detail"]["code"] == "MAGIC_LINK_INVALID"

    async def test_invalid_or_used_link_410(self, client):
        with patch(
            "src.services.auth.magic_login.consume_magic_login_token",
            side_effect=HTTPException(
                status_code=410,
                detail={"code": "MAGIC_LINK_USED", "message": "already used"},
            ),
        ):
            response = await client.post(
                "/api/v1/auth/magic-link/verify", json={"token": "used-token"}
            )
        assert response.status_code == 410
        assert response.json()["detail"]["code"] == "MAGIC_LINK_USED"


class TestRefreshPreservesProvenance:
    """Rotation must not launder a method-bound/org-bound session into a
    claim-less one — otherwise a refresh would silently bypass the org
    auth-method / session-sharing policy. Tokens are minted for real here (not
    mocked) so the carried claims are asserted on the actual rotated token."""

    async def test_rotated_token_carries_amr_and_sorg(self, client, verified_user):
        with patch(
            "src.routers.auth.check_refresh_rate_limit", return_value=(True, None)
        ), patch(
            "src.routers.auth.decode_refresh_token",
            return_value={
                "sub": verified_user.email,
                "iat": 1,
                "exp": 9_999_999_999,
                "jti": "legit-jti",
                AMR_CLAIM: "magic_login",
                SORG_CLAIM: 1,
            },
        ), patch(
            "src.routers.auth.security_get_user",
            new_callable=AsyncMock,
            return_value=verified_user,
        ), patch(
            "src.routers.auth._is_token_revoked_for_user", return_value=False
        ), patch(
            "src.routers.auth._mark_refresh_jti_used", return_value=True
        ), patch(
            "src.routers.auth.get_cookie_domain_for_request", return_value=None
        ), patch(
            "src.routers.auth.is_request_secure", return_value=False
        ):
            response = await client.get(
                "/api/v1/auth/refresh",
                cookies={JWT_REFRESH_COOKIE_NAME: "refresh-token"},
            )
        assert response.status_code == 200
        rotated = decode_jwt(response.json()["access_token"])
        assert rotated[AMR_CLAIM] == "magic_login"
        assert rotated[SORG_CLAIM] == 1
