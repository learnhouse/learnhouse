"""Endpoint tests for src/routers/mfa.py.

Service-level primitives (TOTP verification, backup-code burning, org-policy
arithmetic) are already pinned by src/tests/security/test_mfa*.py. These drive
the nine MFA HTTP endpoints end-to-end: the auth gate, the password/second-factor
re-authentication checks, and the admin org-policy guards including the
auth-method / session-sharing self-lockout protections.
"""

import time
from datetime import datetime

import pyotp
import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.organization_config import OrganizationConfig
from src.db.user_mfa import UserMFA, UserMFABackupCode
from src.db.users import APITokenUser
from src.routers.mfa import router as mfa_router
from src.security.auth import get_authenticated_user
from src.security.session_context import (
    AUTH_METHOD_PASSWORD,
    SessionProvenance,
    set_session_provenance,
)
from src.services.auth.mfa import (
    TOTP_PERIOD_SECONDS,
    encrypt_secret,
    generate_totp_secret,
    hash_backup_code,
)
from src.services.auth.session import create_mfa_pending_token


def _code_for(secret: str, step_offset: int = 0) -> str:
    step = int(time.time()) // TOTP_PERIOD_SECONDS + step_offset
    return pyotp.TOTP(secret, interval=TOTP_PERIOD_SECONDS).at(step * TOTP_PERIOD_SECONDS)


async def _enroll(db, user_id, secret, *, confirmed=True, last_step=None):
    now = str(datetime.now())
    db.add(
        UserMFA(
            user_id=user_id,
            secret_encrypted=encrypt_secret(secret),
            confirmed_at=now if confirmed else None,
            last_used_timestep=last_step,
            creation_date=now,
            update_date=now,
        )
    )
    await db.commit()


async def _add_backup_code(db, user_id, code):
    db.add(
        UserMFABackupCode(
            user_id=user_id,
            code_hash=hash_backup_code(code),
            creation_date=str(datetime.now()),
        )
    )
    await db.commit()


async def _add_org_config(db, org_id, security=None):
    config = {"config_version": "2.0"}
    if security is not None:
        config["admin_toggles"] = {"security": security}
    db.add(
        OrganizationConfig(
            org_id=org_id,
            config=config,
            creation_date=str(datetime.now()),
            update_date=str(datetime.now()),
        )
    )
    await db.commit()


@pytest.fixture(autouse=True)
def _allow_rate_limit():
    """Keep the per-account/IP throttle from touching Redis and flaking."""
    from unittest.mock import patch

    with patch(
        "src.routers.mfa.check_rate_limit",
        return_value=(True, 0, None),
    ):
        yield


@pytest.fixture(autouse=True)
def _reset_provenance():
    set_session_provenance(None)
    yield
    set_session_provenance(None)


@pytest.fixture
def app(db, regular_user):
    app = FastAPI()
    app.include_router(mfa_router, prefix="/api/v1/auth")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_authenticated_user] = lambda: regular_user
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


def _act_as(app, user):
    app.dependency_overrides[get_authenticated_user] = lambda: user


class TestStatus:
    async def test_not_enrolled(self, client, regular_user):
        response = await client.get("/api/v1/auth/mfa/status")
        assert response.status_code == 200
        body = response.json()
        assert body["enabled"] is False
        assert body["backup_codes_remaining"] == 0
        assert body["has_password"] is True

    async def test_enrolled_reports_backup_codes(self, client, db, regular_user):
        await _enroll(db, regular_user.id, generate_totp_secret())
        await _add_backup_code(db, regular_user.id, "ABCDE-FGHJK")
        response = await client.get("/api/v1/auth/mfa/status")
        assert response.status_code == 200
        body = response.json()
        assert body["enabled"] is True
        assert body["backup_codes_remaining"] == 1


class TestSetup:
    async def test_happy_path_returns_provisioning_uri(self, client, regular_user):
        from unittest.mock import patch

        with patch("src.routers.mfa.security_verify_password", return_value=True):
            response = await client.post(
                "/api/v1/auth/mfa/setup", json={"password": "pw"}
            )
        assert response.status_code == 200
        body = response.json()
        assert body["secret"]
        assert body["provisioning_uri"].startswith("otpauth://totp/")

    async def test_password_gate_rejects_missing_password(self, client, regular_user):
        # regular_user has a local password, so setup demands re-authentication.
        response = await client.post("/api/v1/auth/mfa/setup", json={})
        assert response.status_code == 401
        assert response.json()["detail"]["code"] == "INVALID_PASSWORD"

    async def test_already_enabled_conflicts(self, client, db, regular_user):
        from unittest.mock import patch

        await _enroll(db, regular_user.id, generate_totp_secret())
        with patch("src.routers.mfa.security_verify_password", return_value=True):
            response = await client.post(
                "/api/v1/auth/mfa/setup", json={"password": "pw"}
            )
        assert response.status_code == 409
        assert response.json()["detail"]["code"] == "MFA_ALREADY_ENABLED"

    async def test_restart_overwrites_unconfirmed_enrollment(self, client, db, regular_user):
        from unittest.mock import patch

        await _enroll(db, regular_user.id, generate_totp_secret(), confirmed=False)
        with patch("src.routers.mfa.security_verify_password", return_value=True):
            response = await client.post(
                "/api/v1/auth/mfa/setup", json={"password": "pw"}
            )
        assert response.status_code == 200
        assert response.json()["secret"]


class TestConfirm:
    async def test_valid_code_activates_and_returns_backup_codes(self, client, db, regular_user):
        secret = generate_totp_secret()
        await _enroll(db, regular_user.id, secret, confirmed=False)
        response = await client.post(
            "/api/v1/auth/mfa/confirm", json={"code": _code_for(secret)}
        )
        assert response.status_code == 200
        body = response.json()
        assert body["enabled"] is True
        assert len(body["backup_codes"]) == 10

    async def test_invalid_code_rejected(self, client, db, regular_user):
        secret = generate_totp_secret()
        await _enroll(db, regular_user.id, secret, confirmed=False)
        response = await client.post(
            "/api/v1/auth/mfa/confirm", json={"code": "000000"}
        )
        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "INVALID_CODE"

    async def test_no_enrollment_in_progress(self, client, regular_user):
        response = await client.post(
            "/api/v1/auth/mfa/confirm", json={"code": "000000"}
        )
        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "NO_ENROLLMENT"


class TestDisable:
    async def test_valid_totp_disables(self, client, db, regular_user):
        from unittest.mock import patch

        secret = generate_totp_secret()
        await _enroll(db, regular_user.id, secret)
        with patch("src.routers.mfa.security_verify_password", return_value=True):
            response = await client.post(
                "/api/v1/auth/mfa/disable",
                json={"password": "pw", "code": _code_for(secret)},
            )
        assert response.status_code == 200
        assert response.json()["enabled"] is False

    async def test_backup_code_disables(self, client, db, regular_user):
        from unittest.mock import patch

        await _enroll(db, regular_user.id, generate_totp_secret())
        await _add_backup_code(db, regular_user.id, "ABCDE-FGHJK")
        with patch("src.routers.mfa.security_verify_password", return_value=True):
            response = await client.post(
                "/api/v1/auth/mfa/disable",
                json={"password": "pw", "code": "ABCDE-FGHJK"},
            )
        assert response.status_code == 200
        assert response.json()["enabled"] is False

    async def test_wrong_code_rejected(self, client, db, regular_user):
        from unittest.mock import patch

        await _enroll(db, regular_user.id, generate_totp_secret())
        with patch("src.routers.mfa.security_verify_password", return_value=True):
            response = await client.post(
                "/api/v1/auth/mfa/disable",
                json={"password": "pw", "code": "000000"},
            )
        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "INVALID_CODE"

    async def test_not_enabled_rejected(self, client, db, regular_user):
        from unittest.mock import patch

        with patch("src.routers.mfa.security_verify_password", return_value=True):
            response = await client.post(
                "/api/v1/auth/mfa/disable",
                json={"password": "pw", "code": "000000"},
            )
        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "MFA_NOT_ENABLED"

    async def test_api_token_forbidden(self, app, client, db, regular_user):
        # A machine credential must never be able to strip a human's factor.
        await _enroll(db, regular_user.id, generate_totp_secret())
        _act_as(app, APITokenUser(id=99, org_id=1))
        response = await client.post(
            "/api/v1/auth/mfa/disable", json={"code": "000000"}
        )
        assert response.status_code == 403
        assert response.json()["detail"]["code"] == "API_TOKEN_NOT_ALLOWED"


class TestRegenerateBackupCodes:
    async def test_valid_code_returns_fresh_batch(self, client, db, regular_user):
        secret = generate_totp_secret()
        await _enroll(db, regular_user.id, secret)
        response = await client.post(
            "/api/v1/auth/mfa/backup-codes/regenerate", json={"code": _code_for(secret)}
        )
        assert response.status_code == 200
        assert len(response.json()["backup_codes"]) == 10

    async def test_invalid_code_rejected(self, client, db, regular_user):
        await _enroll(db, regular_user.id, generate_totp_secret())
        response = await client.post(
            "/api/v1/auth/mfa/backup-codes/regenerate", json={"code": "000000"}
        )
        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "INVALID_CODE"

    async def test_not_enabled_rejected(self, client, regular_user):
        response = await client.post(
            "/api/v1/auth/mfa/backup-codes/regenerate", json={"code": "000000"}
        )
        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "MFA_NOT_ENABLED"


class TestLoginMFA:
    """/login/mfa takes only the DB dependency (no auth gate) — the pending token
    is the credential. These patch the cookie/expiry helpers that reach for the
    hosting config, exactly as test_auth_router does for set_auth_cookies."""

    @staticmethod
    def _patches():
        from unittest.mock import patch

        return (
            patch("src.routers.mfa.set_auth_cookies"),
            patch("src.routers.mfa.get_token_expiry_ms", return_value=12345),
        )

    async def _get_user_row(self, db, user_id):
        from sqlmodel import select

        from src.db.users import User

        return (
            await db.execute(select(User).where(User.id == user_id))
        ).scalars().first()

    async def test_valid_totp_mints_session(self, app, db, regular_user):
        # No auth override needed; remove it so the DB-only dep set is honest.
        app.dependency_overrides.pop(get_authenticated_user, None)
        user = await self._get_user_row(db, regular_user.id)
        secret = generate_totp_secret()
        await _enroll(db, user.id, secret)
        token = create_mfa_pending_token(user.email, AUTH_METHOD_PASSWORD, 1)

        c1, c2 = self._patches()
        with c1, c2:
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as c:
                response = await c.post(
                    "/api/v1/auth/login/mfa",
                    json={"mfa_token": token, "code": _code_for(secret)},
                )
        assert response.status_code == 200
        body = response.json()
        assert body["tokens"]["access_token"]
        assert body["user"]["email"] == user.email

    async def test_backup_code_mints_session(self, app, db, regular_user):
        app.dependency_overrides.pop(get_authenticated_user, None)
        user = await self._get_user_row(db, regular_user.id)
        await _enroll(db, user.id, generate_totp_secret())
        await _add_backup_code(db, user.id, "ABCDE-FGHJK")
        token = create_mfa_pending_token(user.email, AUTH_METHOD_PASSWORD, 1)

        c1, c2 = self._patches()
        with c1, c2:
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as c:
                response = await c.post(
                    "/api/v1/auth/login/mfa",
                    json={"mfa_token": token, "code": "ABCDE-FGHJK", "is_backup_code": True},
                )
        assert response.status_code == 200
        assert response.json()["tokens"]["access_token"]

    async def test_invalid_code_401(self, app, db, regular_user):
        app.dependency_overrides.pop(get_authenticated_user, None)
        user = await self._get_user_row(db, regular_user.id)
        await _enroll(db, user.id, generate_totp_secret())
        token = create_mfa_pending_token(user.email, AUTH_METHOD_PASSWORD, 1)

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as c:
            response = await c.post(
                "/api/v1/auth/login/mfa",
                json={"mfa_token": token, "code": "000000"},
            )
        assert response.status_code == 401
        assert response.json()["detail"]["code"] == "INVALID_CODE"

    async def test_expired_or_invalid_pending_token_401(self, app, db, regular_user):
        app.dependency_overrides.pop(get_authenticated_user, None)
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as c:
            response = await c.post(
                "/api/v1/auth/login/mfa",
                json={"mfa_token": "not-a-valid-token", "code": "000000"},
            )
        assert response.status_code == 401
        assert response.json()["detail"]["code"] == "MFA_SESSION_EXPIRED"

    async def test_factor_removed_mid_flow_falls_through_to_session(self, app, db, regular_user):
        # The factor was disabled between the password step and the code step:
        # the user is not stranded at a challenge they can no longer satisfy.
        app.dependency_overrides.pop(get_authenticated_user, None)
        user = await self._get_user_row(db, regular_user.id)
        token = create_mfa_pending_token(user.email, AUTH_METHOD_PASSWORD, 1)

        c1, c2 = self._patches()
        with c1, c2:
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as c:
                response = await c.post(
                    "/api/v1/auth/login/mfa",
                    json={"mfa_token": token, "code": "000000"},
                )
        assert response.status_code == 200
        assert response.json()["tokens"]["access_token"]


class TestOrgCompliance:
    async def test_compliance_state_no_policy(self, client, db, org, regular_user):
        response = await client.get(f"/api/v1/auth/mfa/org-policy/{org.id}")
        assert response.status_code == 200
        body = response.json()
        assert body["required"] is False
        assert body["satisfied"] is True

    async def test_compliance_list_requires_admin(self, client, db, org, regular_user):
        response = await client.get(f"/api/v1/auth/mfa/org-compliance/{org.id}")
        assert response.status_code == 403
        assert response.json()["detail"]["code"] == "NOT_ORG_ADMIN"

    async def test_compliance_list_for_admin(self, app, client, db, org, admin_user):
        _act_as(app, admin_user)
        response = await client.get(f"/api/v1/auth/mfa/org-compliance/{org.id}")
        assert response.status_code == 200
        body = response.json()
        assert body["total"] >= 1
        assert any(m["user_id"] == admin_user.id for m in body["members"])


class TestSetOrgPolicy:
    async def test_not_org_admin_forbidden(self, client, db, org, regular_user):
        response = await client.put(
            f"/api/v1/auth/mfa/org-policy/{org.id}", json={"require_2fa": True}
        )
        assert response.status_code == 403
        assert response.json()["detail"]["code"] == "NOT_ORG_ADMIN"

    async def test_admin_must_enroll_before_requiring(self, app, client, db, org, admin_user):
        _act_as(app, admin_user)
        await _add_org_config(db, org.id)
        response = await client.put(
            f"/api/v1/auth/mfa/org-policy/{org.id}", json={"require_2fa": True}
        )
        assert response.status_code == 403
        assert response.json()["detail"]["code"] == "ADMIN_MFA_REQUIRED_FIRST"

    async def test_admin_with_mfa_can_enable(self, app, client, db, org, admin_user):
        _act_as(app, admin_user)
        await _add_org_config(db, org.id)
        await _enroll(db, admin_user.id, generate_totp_secret())
        response = await client.put(
            f"/api/v1/auth/mfa/org-policy/{org.id}",
            json={"require_2fa": True, "require_2fa_grace_days": 7},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["require_2fa"] is True
        assert body["require_2fa_grace_days"] == 7

    async def test_config_row_missing_404(self, app, client, db, org, admin_user):
        _act_as(app, admin_user)
        response = await client.put(
            f"/api/v1/auth/mfa/org-policy/{org.id}", json={"require_2fa": False}
        )
        assert response.status_code == 404

    async def test_auth_method_self_lockout(self, app, client, db, org, admin_user):
        _act_as(app, admin_user)
        await _add_org_config(db, org.id)
        # Signed in with password; restricting to google-only would refuse this
        # very session — the guard blocks the save.
        set_session_provenance(SessionProvenance(amr=AUTH_METHOD_PASSWORD, org_id=org.id))
        response = await client.put(
            f"/api/v1/auth/mfa/org-policy/{org.id}",
            json={"require_2fa": False, "allowed_auth_methods": ["google"]},
        )
        assert response.status_code == 403
        assert response.json()["detail"]["code"] == "AUTH_METHOD_SELF_LOCKOUT"

    async def test_auth_method_self_lockout_for_a_session_with_no_recorded_method(
        self, app, client, db, org, admin_user
    ):
        _act_as(app, admin_user)
        await _add_org_config(db, org.id)
        # A session minted before the policy shipped carries no amr. The gate
        # refuses it exactly like a disallowed method, so the save must not go
        # through — the admin would have no way back in.
        set_session_provenance(SessionProvenance(amr=None, org_id=org.id))
        response = await client.put(
            f"/api/v1/auth/mfa/org-policy/{org.id}",
            json={"require_2fa": False, "allowed_auth_methods": ["password"]},
        )
        assert response.status_code == 403
        assert response.json()["detail"]["code"] == "AUTH_METHOD_SELF_LOCKOUT"

    async def test_get_settings_is_admin_only(self, app, client, db, org, regular_user):
        _act_as(app, regular_user)
        await _add_org_config(db, org.id)
        response = await client.get(f"/api/v1/auth/mfa/org-policy/{org.id}/settings")
        assert response.status_code == 403
        assert response.json()["detail"]["code"] == "NOT_ORG_ADMIN"

    async def test_get_settings_returns_the_saved_policy(
        self, app, client, db, org, admin_user
    ):
        _act_as(app, admin_user)
        await _add_org_config(db, org.id)
        set_session_provenance(SessionProvenance(amr=AUTH_METHOD_PASSWORD, org_id=org.id))
        await client.put(
            f"/api/v1/auth/mfa/org-policy/{org.id}",
            json={"require_2fa": False, "allowed_auth_methods": ["password"]},
        )

        response = await client.get(f"/api/v1/auth/mfa/org-policy/{org.id}/settings")
        assert response.status_code == 200
        assert response.json()["allowed_auth_methods"] == ["password"]

    async def test_session_sharing_self_lockout(self, app, client, db, org, admin_user):
        _act_as(app, admin_user)
        await _add_org_config(db, org.id)
        # Session was minted for a different org, so turning off central sharing
        # would refuse it.
        set_session_provenance(SessionProvenance(amr=AUTH_METHOD_PASSWORD, org_id=999))
        response = await client.put(
            f"/api/v1/auth/mfa/org-policy/{org.id}",
            json={"require_2fa": False, "allow_central_session_sharing": False},
        )
        assert response.status_code == 403
        assert response.json()["detail"]["code"] == "SESSION_SHARING_SELF_LOCKOUT"

    async def test_auth_method_and_sharing_saved_when_session_is_compliant(
        self, app, client, db, org, admin_user
    ):
        _act_as(app, admin_user)
        await _add_org_config(db, org.id)
        # Signed in with password from this org: restricting to password and
        # turning off central sharing does not lock the current session out.
        set_session_provenance(SessionProvenance(amr=AUTH_METHOD_PASSWORD, org_id=org.id))
        response = await client.put(
            f"/api/v1/auth/mfa/org-policy/{org.id}",
            json={
                "require_2fa": False,
                "allowed_auth_methods": ["password"],
                "allow_central_session_sharing": False,
            },
        )
        assert response.status_code == 200
        body = response.json()
        assert body["allowed_auth_methods"] == ["password"]
        assert body["allow_central_session_sharing"] is False


class TestCoverageGaps:
    """Branches not hit by the main happy/error paths above."""

    async def test_confirm_when_already_enabled_conflicts(self, client, db, regular_user):
        secret = generate_totp_secret()
        await _enroll(db, regular_user.id, secret, confirmed=True)
        resp = await client.post("/api/v1/auth/mfa/confirm", json={"code": _code_for(secret)})
        assert resp.status_code == 409
        assert resp.json()["detail"]["code"] == "MFA_ALREADY_ENABLED"

    async def test_setup_skips_password_for_passwordless_account(self, client, db, regular_user):
        # A Google/SSO account has no local password — the re-auth check is skipped
        # rather than making enrollment unreachable.
        from sqlmodel import select as _select

        from src.db.users import User as _User

        user = (await db.execute(_select(_User).where(_User.id == regular_user.id))).scalars().first()
        user.password = ""
        db.add(user)
        await db.commit()

        resp = await client.post("/api/v1/auth/mfa/setup", json={})
        assert resp.status_code == 200
        assert "provisioning_uri" in resp.json()

    async def test_confirm_is_rate_limited(self, app, db, regular_user):
        from unittest.mock import patch

        secret = generate_totp_secret()
        await _enroll(db, regular_user.id, secret, confirmed=False)
        with patch("src.routers.mfa.check_rate_limit", return_value=(False, 99, 42)):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
                resp = await c.post("/api/v1/auth/mfa/confirm", json={"code": "000000"})
        assert resp.status_code == 429
        assert resp.json()["detail"]["code"] == "RATE_LIMITED"

    async def test_compliance_counts_enrolled_members(self, app, client, db, org, admin_user):
        _act_as(app, admin_user)
        await _enroll(db, admin_user.id, generate_totp_secret(), confirmed=True)
        resp = await client.get(f"/api/v1/auth/mfa/org-compliance/{org.id}")
        assert resp.status_code == 200
        body = resp.json()
        assert body["enabled"] >= 1
        assert any(m["user_id"] == admin_user.id and m["mfa_enabled"] for m in body["members"])


class TestOrgResetMember:
    """Admin recovery tool: clear a member's factor so they can re-enroll."""

    async def test_admin_resets_member_factor(self, app, client, db, org, admin_user, regular_user):
        _act_as(app, admin_user)
        await _enroll(db, regular_user.id, generate_totp_secret(), confirmed=True)

        resp = await client.post(f"/api/v1/auth/mfa/org-reset/{org.id}/{regular_user.id}")
        assert resp.status_code == 200
        body = resp.json()
        assert body["reset"] is True
        assert body["had_factor"] is True

        # Factor is gone — the member can now re-enroll.
        from src.services.auth.mfa import get_user_mfa

        assert await get_user_mfa(db, regular_user.id) is None

    async def test_non_admin_forbidden(self, app, client, db, org, admin_user, regular_user):
        # regular_user (a plain member) may not reset anyone.
        _act_as(app, regular_user)
        resp = await client.post(f"/api/v1/auth/mfa/org-reset/{org.id}/{admin_user.id}")
        assert resp.status_code == 403
        assert resp.json()["detail"]["code"] == "NOT_ORG_ADMIN"

    async def test_cannot_reset_self(self, app, client, org, admin_user):
        _act_as(app, admin_user)
        resp = await client.post(f"/api/v1/auth/mfa/org-reset/{org.id}/{admin_user.id}")
        assert resp.status_code == 400
        assert resp.json()["detail"]["code"] == "CANNOT_RESET_SELF"

    async def test_target_must_be_member(self, app, client, org, admin_user):
        _act_as(app, admin_user)
        resp = await client.post(f"/api/v1/auth/mfa/org-reset/{org.id}/99999999")
        assert resp.status_code == 404
        assert resp.json()["detail"]["code"] == "NOT_A_MEMBER"

    async def test_reset_member_without_factor_is_noop_ok(self, app, client, org, admin_user, regular_user):
        _act_as(app, admin_user)
        # regular_user has no factor enrolled — reset still succeeds, had_factor False.
        resp = await client.post(f"/api/v1/auth/mfa/org-reset/{org.id}/{regular_user.id}")
        assert resp.status_code == 200
        assert resp.json()["had_factor"] is False

    async def test_cannot_reset_a_superadmin(self, app, client, db, org, admin_user, regular_user):
        from sqlmodel import select as _select

        from src.db.users import User as _User

        target = (await db.execute(_select(_User).where(_User.id == regular_user.id))).scalars().first()
        target.is_superadmin = True
        db.add(target)
        await db.commit()

        _act_as(app, admin_user)
        resp = await client.post(f"/api/v1/auth/mfa/org-reset/{org.id}/{regular_user.id}")
        assert resp.status_code == 403
        assert resp.json()["detail"]["code"] == "TARGET_IS_SUPERADMIN"
