"""Router tests for src/routers/auth.py."""

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest
from fastapi import FastAPI, Response
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.users import AnonymousUser, User
from src.routers.auth import (
    JWT_COOKIE_NAME,
    JWT_REFRESH_COOKIE_NAME,
    get_cookie_domain_for_request,
    get_token_expiry_ms,
    is_request_secure,
    router as auth_router,
    set_auth_cookies,
    unset_auth_cookies,
)
from src.security.auth import get_current_user


def _mock_config():
    return SimpleNamespace(
        hosting_config=SimpleNamespace(
            domain="learnhouse.test",
            cookie_config=SimpleNamespace(domain=".learnhouse.test"),
        )
    )


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
def auth_user(db):
    user = User(
        id=11,
        username="authuser",
        first_name="Auth",
        last_name="User",
        email="auth@test.com",
        password="hashed_password",
        user_uuid="user_auth",
        email_verified=True,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


class TestAuthHelpers:
    def test_get_cookie_domain_for_configured_subdomain(self):
        request = Mock()
        request.headers = {
            "origin": "https://app.learnhouse.test",
            "referer": "",
            "host": "",
        }

        with patch("src.routers.auth.get_learnhouse_config", return_value=_mock_config()):
            assert get_cookie_domain_for_request(request) == ".learnhouse.test"

    def test_get_cookie_domain_for_custom_domain_and_localhost(self):
        custom_request = Mock()
        custom_request.headers = {
            "origin": "https://academy.example.com",
            "referer": "",
            "host": "",
        }
        localhost_request = Mock()
        localhost_request.headers = {
            "origin": "http://localhost:3000",
            "referer": "",
            "host": "",
        }

        with patch("src.routers.auth.get_learnhouse_config", return_value=_mock_config()):
            assert get_cookie_domain_for_request(custom_request) is None
            assert get_cookie_domain_for_request(localhost_request) is None

    def test_is_request_secure_prefers_proxy_headers_for_local_proxy(self):
        request = Mock()
        request.client = SimpleNamespace(host="127.0.0.1")
        request.headers = {"x-forwarded-proto": "https"}
        request.url = SimpleNamespace(scheme="http")

        assert is_request_secure(request) is True

    def test_is_request_secure_falls_back_to_scheme_or_dev_mode(self):
        https_request = Mock()
        https_request.client = SimpleNamespace(host="8.8.8.8")
        https_request.headers = {}
        https_request.url = SimpleNamespace(scheme="https")

        http_request = Mock()
        http_request.client = None
        http_request.headers = {}
        http_request.url = SimpleNamespace(scheme="http")

        with patch("src.routers.auth.isDevModeEnabled", return_value=True):
            assert is_request_secure(https_request) is True
            assert is_request_secure(http_request) is False

    def test_set_and_unset_auth_cookies(self):
        response = Response()
        request = Mock()
        request.client = SimpleNamespace(host="127.0.0.1")
        request.headers = {"origin": "https://app.learnhouse.test"}
        request.url = SimpleNamespace(scheme="https")

        with patch("src.routers.auth.get_learnhouse_config", return_value=_mock_config()):
            set_auth_cookies(response, "access-token", "refresh-token", request)
            cookie_header = "\n".join(response.headers.getlist("set-cookie"))
            assert JWT_COOKIE_NAME in cookie_header
            assert JWT_REFRESH_COOKIE_NAME in cookie_header

            unset_response = Response()
            unset_auth_cookies(unset_response, request)
            deleted_header = "\n".join(unset_response.headers.getlist("set-cookie"))
            assert "Max-Age=0" in deleted_header

    def test_get_token_expiry_ms_handles_dev_mode(self):
        with patch("src.routers.auth.isDevModeEnabled", return_value=True):
            assert get_token_expiry_ms() is None


class TestAuthRouter:
    async def test_refresh_success(self, client):
        with patch(
            "src.routers.auth.check_refresh_rate_limit",
            return_value=(True, None),
        ), patch(
            "src.routers.auth.decode_refresh_token",
            return_value={"sub": "auth@test.com"},
        ), patch(
            "src.routers.auth.create_access_token",
            return_value="new-access-token",
        ), patch(
            "src.routers.auth.get_token_expiry_ms",
            return_value=12345,
        ), patch(
            "src.routers.auth.get_cookie_domain_for_request",
            return_value=None,
        ), patch(
            "src.routers.auth.is_request_secure",
            return_value=False,
        ):
            response = await client.get(
                "/api/v1/auth/refresh",
                cookies={JWT_REFRESH_COOKIE_NAME: "refresh-token"},
            )

        assert response.status_code == 200
        assert response.json()["access_token"] == "new-access-token"

    async def test_refresh_rate_limited_and_missing_token(self, client):
        with patch(
            "src.routers.auth.check_refresh_rate_limit",
            return_value=(False, 60),
        ):
            response = await client.get("/api/v1/auth/refresh")
        assert response.status_code == 429

        with patch(
            "src.routers.auth.check_refresh_rate_limit",
            return_value=(True, None),
        ):
            response = await client.get("/api/v1/auth/refresh")
        assert response.status_code == 401

    async def test_login_success(self, client, auth_user):
        with patch(
            "src.routers.auth.check_login_rate_limit",
            return_value=(True, None),
        ), patch(
            "src.routers.auth.check_account_locked",
            return_value=(False, None),
        ), patch(
            "src.routers.auth.authenticate_user",
            new_callable=AsyncMock,
            return_value=auth_user,
        ), patch("src.routers.auth.reset_failed_attempts"), patch(
            "src.routers.auth.get_client_ip",
            return_value="127.0.0.1",
        ), patch("src.routers.auth.update_login_info"), patch(
            "src.routers.auth.create_access_token",
            return_value="access-token",
        ), patch(
            "src.routers.auth.create_refresh_token",
            return_value="refresh-token",
        ), patch("src.routers.auth.set_auth_cookies"), patch(
            "src.routers.auth.get_deployment_mode",
            return_value="oss",
        ), patch(
            "src.routers.auth.get_token_expiry_ms",
            return_value=12345,
        ):
            response = await client.post(
                "/api/v1/auth/login",
                data={"username": auth_user.email, "password": "secret"},
            )

        assert response.status_code == 200
        assert response.json()["user"]["email"] == auth_user.email

    async def test_login_invalid_credentials_and_email_not_verified(self, client, auth_user):
        with patch(
            "src.routers.auth.check_login_rate_limit",
            return_value=(True, None),
        ), patch(
            "src.routers.auth.check_account_locked",
            return_value=(False, None),
        ), patch(
            "src.routers.auth.authenticate_user",
            new_callable=AsyncMock,
            return_value=False,
        ), patch(
            "src.routers.auth.record_failed_login",
            return_value=(False, 0),
        ):
            response = await client.post(
                "/api/v1/auth/login",
                data={"username": auth_user.email, "password": "bad"},
            )
        assert response.status_code == 401

        auth_user.email_verified = False
        with patch(
            "src.routers.auth.check_login_rate_limit",
            return_value=(True, None),
        ), patch(
            "src.routers.auth.check_account_locked",
            return_value=(False, None),
        ), patch(
            "src.routers.auth.authenticate_user",
            new_callable=AsyncMock,
            return_value=auth_user,
        ), patch(
            "src.routers.auth.get_deployment_mode",
            return_value="saas",
        ):
            response = await client.post(
                "/api/v1/auth/login",
                data={"username": auth_user.email, "password": "secret"},
            )
        assert response.status_code == 403

    async def test_oauth_logout_and_email_endpoints(self, client, auth_user):
        with patch(
            "src.routers.auth.signWithGoogle",
            new_callable=AsyncMock,
            return_value=auth_user,
        ), patch(
            "src.routers.auth.create_access_token",
            return_value="access-token",
        ), patch(
            "src.routers.auth.create_refresh_token",
            return_value="refresh-token",
        ), patch("src.routers.auth.set_auth_cookies"), patch(
            "src.routers.auth.get_token_expiry_ms",
            return_value=12345,
        ):
            response = await client.post(
                "/api/v1/auth/oauth",
                json={
                    "email": auth_user.email,
                    "provider": "google",
                    "access_token": "google-token",
                },
            )
        assert response.status_code == 200

        with patch(
            "src.routers.auth.extract_jwt_from_request",
            return_value="jwt-token",
        ), patch("src.routers.auth.unset_auth_cookies") as unset_mock:
            response = await client.delete("/api/v1/auth/logout")
        assert response.status_code == 200
        unset_mock.assert_called_once()

        with patch(
            "src.routers.auth.check_email_verification_rate_limit",
            return_value=(True, None),
        ), patch(
            "src.routers.auth.verify_email_token",
            new_callable=AsyncMock,
            return_value="Email verified",
        ):
            response = await client.post(
                "/api/v1/auth/verify-email",
                json={
                    "token": "verify-token",
                    "user_uuid": "user_auth",
                    "org_uuid": "org_test",
                },
            )
        assert response.status_code == 200

        with patch(
            "src.routers.auth.resend_verification_email",
            new_callable=AsyncMock,
            return_value="Sent",
        ):
            response = await client.post(
                "/api/v1/auth/resend-verification",
                json={"email": auth_user.email, "org_id": 1},
            )
        assert response.status_code == 200

    async def test_verify_email_rate_limited_and_logout_unauthenticated(self, client):
        with patch(
            "src.routers.auth.check_email_verification_rate_limit",
            return_value=(False, 60),
        ):
            response = await client.post(
                "/api/v1/auth/verify-email",
                json={
                    "token": "verify-token",
                    "user_uuid": "user_auth",
                    "org_uuid": "org_test",
                },
            )
        assert response.status_code == 429

        with patch(
            "src.routers.auth.extract_jwt_from_request",
            return_value=None,
        ):
            response = await client.delete("/api/v1/auth/logout")
        assert response.status_code == 401
