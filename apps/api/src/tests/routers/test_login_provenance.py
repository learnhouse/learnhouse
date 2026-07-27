"""Password login stamps session provenance (amr/sorg) and honours the 2FA gate.

Unlike test_auth_router.test_login_success (which patches the token factories),
these let real tokens mint so the amr/sorg claims can be read back, and they
exercise the org-slug binding and the second-factor branch.
"""

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.organization_config import OrganizationConfig
from src.db.user_mfa import UserMFA
from src.db.users import AnonymousUser, User
from src.routers.auth import router as auth_router
from src.security.auth import decode_jwt, get_current_user
from src.security.session_context import AMR_CLAIM, SORG_CLAIM
from src.services.auth.mfa import encrypt_secret, generate_totp_secret


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
def login_user(db):
    user = User(
        id=4110,
        username="provuser",
        first_name="Prov",
        last_name="User",
        email="prov@test.com",
        password="hashed_password",
        user_uuid="user_prov",
        email_verified=True,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


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


def _login_patches():
    """The environmental stubs shared by both tests — everything except the
    token factories, which we deliberately leave real."""
    return [
        patch("src.routers.auth.check_login_rate_limit", return_value=(True, None)),
        patch("src.routers.auth.check_account_locked", return_value=(False, None)),
        patch("src.routers.auth.reset_failed_attempts"),
        patch("src.routers.auth.get_client_ip", return_value="127.0.0.1"),
        patch("src.routers.auth.update_login_info"),
        patch("src.routers.auth.record_audit_event"),
        patch("src.routers.auth.set_auth_cookies"),
        patch("src.routers.auth.get_deployment_mode", return_value="oss"),
    ]


class TestLoginProvenance:
    async def test_login_binds_session_to_org_slug(self, client, login_user, org):
        stubs = _login_patches() + [
            patch("src.routers.auth.authenticate_user", new_callable=AsyncMock, return_value=login_user),
        ]
        import contextlib

        with contextlib.ExitStack() as stack:
            for s in stubs:
                stack.enter_context(s)
            resp = await client.post(
                "/api/v1/auth/login",
                data={"username": login_user.email, "password": "secret", "org_slug": org.slug},
            )

        assert resp.status_code == 200
        token = resp.json()["tokens"]["access_token"]
        claims = decode_jwt(token)
        assert claims[AMR_CLAIM] == "password"
        assert claims[SORG_CLAIM] == org.id

    async def test_login_without_org_slug_has_no_sorg(self, client, login_user):
        stubs = _login_patches() + [
            patch("src.routers.auth.authenticate_user", new_callable=AsyncMock, return_value=login_user),
        ]
        import contextlib

        with contextlib.ExitStack() as stack:
            for s in stubs:
                stack.enter_context(s)
            resp = await client.post(
                "/api/v1/auth/login",
                data={"username": login_user.email, "password": "secret"},
            )

        assert resp.status_code == 200
        claims = decode_jwt(resp.json()["tokens"]["access_token"])
        assert claims[AMR_CLAIM] == "password"
        assert SORG_CLAIM not in claims

    async def test_login_refused_when_org_disallows_password(self, client, db, login_user, org):
        await _set_allowed_methods(db, org.id, ["google", "sso"])

        stubs = _login_patches() + [
            patch("src.routers.auth.authenticate_user", new_callable=AsyncMock, return_value=login_user),
        ]
        import contextlib

        with contextlib.ExitStack() as stack:
            for s in stubs:
                stack.enter_context(s)
            resp = await client.post(
                "/api/v1/auth/login",
                data={"username": login_user.email, "password": "secret", "org_slug": org.slug},
            )

        assert resp.status_code == 403
        detail = resp.json()["detail"]
        assert detail["code"] == "AUTH_METHOD_NOT_ALLOWED"
        assert detail["allowed_methods"] == ["google", "sso"]

    async def test_org_policy_does_not_block_the_apex_login(self, client, db, login_user, org):
        # Same restricted org, but a login that names no org is not that org's to
        # refuse — the per-request gate handles it once they reach the org.
        await _set_allowed_methods(db, org.id, ["google"])

        stubs = _login_patches() + [
            patch("src.routers.auth.authenticate_user", new_callable=AsyncMock, return_value=login_user),
        ]
        import contextlib

        with contextlib.ExitStack() as stack:
            for s in stubs:
                stack.enter_context(s)
            resp = await client.post(
                "/api/v1/auth/login",
                data={"username": login_user.email, "password": "secret"},
            )

        assert resp.status_code == 200

    async def test_login_allowed_when_password_is_on_the_list(self, client, db, login_user, org):
        await _set_allowed_methods(db, org.id, ["password", "google"])

        stubs = _login_patches() + [
            patch("src.routers.auth.authenticate_user", new_callable=AsyncMock, return_value=login_user),
        ]
        import contextlib

        with contextlib.ExitStack() as stack:
            for s in stubs:
                stack.enter_context(s)
            resp = await client.post(
                "/api/v1/auth/login",
                data={"username": login_user.email, "password": "secret", "org_slug": org.slug},
            )

        assert resp.status_code == 200

    async def test_login_with_2fa_returns_challenge_not_session(self, client, db, login_user):
        # Enrolled second factor → login must hand back an mfa_token, no session.
        now = str(datetime.now())
        db.add(
            UserMFA(
                user_id=login_user.id,
                secret_encrypted=encrypt_secret(generate_totp_secret()),
                confirmed_at=now,
                creation_date=now,
                update_date=now,
            )
        )
        await db.commit()

        stubs = _login_patches() + [
            patch("src.routers.auth.authenticate_user", new_callable=AsyncMock, return_value=login_user),
        ]
        import contextlib

        with contextlib.ExitStack() as stack:
            for s in stubs:
                stack.enter_context(s)
            resp = await client.post(
                "/api/v1/auth/login",
                data={"username": login_user.email, "password": "secret"},
            )

        assert resp.status_code == 200
        body = resp.json()
        assert body["mfa_required"] is True
        assert body["mfa_token"]
        assert "tokens" not in body
