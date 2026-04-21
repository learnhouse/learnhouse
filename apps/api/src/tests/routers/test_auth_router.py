"""Router tests for src/routers/auth.py."""

from datetime import datetime, timedelta
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

    def test_get_token_expiry_ms_uses_expiry_window(self):
        fixed_now = datetime(2026, 1, 1, 12, 0, 0, tzinfo=datetime.now().astimezone().tzinfo)
        with patch("src.routers.auth.isDevModeEnabled", return_value=False), patch(
            "src.routers.auth.JWT_ACCESS_TOKEN_EXPIRES",
            timedelta(minutes=15),
        ), patch("src.routers.auth.datetime") as datetime_mock:
            datetime_mock.now.return_value = fixed_now
            expiry_ms = get_token_expiry_ms()

        assert expiry_ms == int((fixed_now + timedelta(minutes=15)).timestamp() * 1000)

    def test_cookie_domain_and_secure_fallback_branches(self):
        empty_request = Mock()
        empty_request.headers = {}

        invalid_ip_request = Mock()
        invalid_ip_request.client = SimpleNamespace(host="not-an-ip")
        invalid_ip_request.headers = {}
        invalid_ip_request.url = SimpleNamespace(scheme="http")

        http_proxy_request = Mock()
        http_proxy_request.client = SimpleNamespace(host="127.0.0.1")
        http_proxy_request.headers = {"x-forwarded-proto": "http"}
        http_proxy_request.url = SimpleNamespace(scheme="https")

        with patch("src.routers.auth.get_learnhouse_config", return_value=_mock_config()), patch(
            "src.routers.auth.isDevModeEnabled",
            return_value=False,
        ):
            assert get_cookie_domain_for_request(empty_request) == ".learnhouse.test"
            assert is_request_secure(None) is True
            assert is_request_secure(invalid_ip_request) is True
            assert is_request_secure(http_proxy_request) is False


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

    async def test_refresh_invalid_token(self, client):
        with patch(
            "src.routers.auth.check_refresh_rate_limit",
            return_value=(True, None),
        ), patch(
            "src.routers.auth.decode_refresh_token",
            return_value=None,
        ):
            response = await client.get(
                "/api/v1/auth/refresh",
                cookies={JWT_REFRESH_COOKIE_NAME: "refresh-token"},
            )

        assert response.status_code == 401

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

    async def test_login_rate_limited_and_account_locked(self, client, auth_user):
        with patch(
            "src.routers.auth.check_login_rate_limit",
            return_value=(False, 120),
        ):
            response = await client.post(
                "/api/v1/auth/login",
                data={"username": auth_user.email, "password": "secret"},
            )
        assert response.status_code == 429

        # SECURITY: a locked account only surfaces 423 once the caller has
        # proven they know the password — otherwise the status leaks that the
        # account exists (enumeration). authenticate_user is mocked to succeed
        # here to simulate the correct-password branch.
        with patch(
            "src.routers.auth.check_login_rate_limit",
            return_value=(True, None),
        ), patch(
            "src.routers.auth.check_account_locked",
            return_value=(True, 90),
        ), patch(
            "src.routers.auth.authenticate_user",
            new_callable=AsyncMock,
            return_value=auth_user,
        ):
            response = await client.post(
                "/api/v1/auth/login",
                data={"username": auth_user.email, "password": "secret"},
            )
        assert response.status_code == 423

    async def test_login_failed_attempt_records_but_returns_generic_401(
        self, client, auth_user
    ):
        """A failed password attempt must return the same generic 401 whether
        or not the account is (or becomes) locked — otherwise the status leaks
        account existence and lockout state to unauthenticated callers."""
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
            return_value=(True, 120),
        ):
            response = await client.post(
                "/api/v1/auth/login",
                data={"username": auth_user.email, "password": "bad"},
            )

        assert response.status_code == 401
        assert response.json()["detail"]["code"] == "INVALID_CREDENTIALS"

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

    async def test_oauth_failure_path(self, client):
        with patch(
            "src.routers.auth.signWithGoogle",
            new_callable=AsyncMock,
            return_value=None,
        ):
            response = await client.post(
                "/api/v1/auth/oauth",
                json={
                    "email": "missing@test.com",
                    "provider": "google",
                    "access_token": "google-token",
                },
            )

        assert response.status_code == 401

    async def test_oauth_invalid_org_id_returns_400(self, client, db, org):
        with patch("src.routers.auth.get_learnhouse_config"):
            response = await client.post(
                "/api/v1/auth/oauth",
                params={"org_id": 9999},
                json={
                    "email": "user@test.com",
                    "provider": "google",
                    "access_token": "google-token",
                },
            )
        assert response.status_code == 400
        assert response.json()["detail"] == "Invalid org_id"

    async def test_oauth_org_id_valid_but_no_invite_clears_org_id(self, client, db, org):
        mock_redis = Mock(get=Mock(return_value=None))
        mock_config = SimpleNamespace(
            redis_config=SimpleNamespace(redis_connection_string="redis://localhost:6379")
        )
        with patch("src.routers.auth.get_learnhouse_config", return_value=mock_config), patch(
            "redis.Redis.from_url", return_value=mock_redis
        ), patch(
            "src.routers.auth.signWithGoogle",
            new_callable=AsyncMock,
            return_value=None,
        ):
            response = await client.post(
                "/api/v1/auth/oauth",
                params={"org_id": 1},
                json={
                    "email": "user@test.com",
                    "provider": "google",
                    "access_token": "google-token",
                },
            )
        assert response.status_code == 401

    async def test_oauth_org_id_redis_unavailable_clears_org_id(self, client, db, org):
        mock_config = SimpleNamespace(
            redis_config=SimpleNamespace(redis_connection_string="redis://localhost:6379")
        )
        with patch("src.routers.auth.get_learnhouse_config", return_value=mock_config), patch(
            "redis.Redis.from_url", side_effect=RuntimeError("Redis down")
        ), patch(
            "src.routers.auth.signWithGoogle",
            new_callable=AsyncMock,
            return_value=None,
        ):
            response = await client.post(
                "/api/v1/auth/oauth",
                params={"org_id": 1},
                json={
                    "email": "user@test.com",
                    "provider": "google",
                    "access_token": "google-token",
                },
            )
        assert response.status_code == 401

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
