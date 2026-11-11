"""Remaining org-policy branches of src/routers/mfa.py.

test_mfa_router.py drives the endpoints broadly. These add:
  * the compliance poll explaining an auth-method block instead of reporting
    two-factor state (the "sign in to this org again" screen),
  * saving the ``exempt_external_auth`` toggle on its own,
  * refusing to reset the factor of an account that also belongs to another
    org, which is not this org's identity to rewrite.
"""

from datetime import datetime
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlmodel import select

from src.core.events.database import get_db_session
from src.db.organization_config import OrganizationConfig
from src.db.user_organizations import UserOrganization
from src.routers.mfa import router as mfa_router
from src.security.auth import get_authenticated_user
from src.security.session_context import (
    AUTH_METHOD_PASSWORD,
    SessionProvenance,
    set_session_provenance,
)
from src.services.orgs.auth_policy import METHOD_NOT_ALLOWED_CODE


@pytest.fixture(autouse=True)
def _allow_rate_limit():
    """Keep the per-account/IP throttle from touching Redis."""
    with patch("src.routers.mfa.check_rate_limit", return_value=(True, 0, None)):
        yield


@pytest.fixture(autouse=True)
def _reset_provenance():
    set_session_provenance(None)
    yield
    set_session_provenance(None)


def _make_app(db, user):
    app = FastAPI()
    app.include_router(mfa_router, prefix="/api/v1/auth")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_authenticated_user] = lambda: user
    return app


async def _request(app, method, url, **kwargs):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        return await c.request(method, url, **kwargs)


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


class TestCompliancePollExplainsAuthBlock:
    async def test_disallowed_sign_in_method_is_reported_as_policy_block(
        self, db, org, regular_user
    ):
        await _add_org_config(db, org.id, security={"allowed_auth_methods": ["google"]})
        # Signed in with a password; the org now only admits Google.
        set_session_provenance(SessionProvenance(amr=AUTH_METHOD_PASSWORD, org_id=org.id))

        response = await _request(
            _make_app(db, regular_user), "GET", f"/api/v1/auth/mfa/org-policy/{org.id}"
        )

        assert response.status_code == 403
        detail = response.json()["detail"]
        assert detail["code"] == METHOD_NOT_ALLOWED_CODE
        assert detail["allowed_methods"] == ["google"]


class TestExemptExternalAuthToggle:
    async def test_toggle_is_saved_without_touching_the_requirement(self, db, org, admin_user):
        await _add_org_config(db, org.id)

        response = await _request(
            _make_app(db, admin_user),
            "PUT",
            f"/api/v1/auth/mfa/org-policy/{org.id}",
            json={"exempt_external_auth": True},
        )

        assert response.status_code == 200
        assert response.json()["exempt_external_auth"] is True
        assert response.json()["require_2fa"] is False

        row = (
            await db.execute(select(OrganizationConfig).where(OrganizationConfig.org_id == org.id))
        ).scalars().first()
        await db.refresh(row)
        security = row.config["admin_toggles"]["security"]
        assert security["exempt_external_auth"] is True
        assert "require_2fa" not in security


class TestResetSharedAccount:
    async def test_member_of_another_org_cannot_be_reset_by_this_org(
        self, db, org, other_org, admin_user, regular_user
    ):
        db.add(
            UserOrganization(
                user_id=regular_user.id,
                org_id=other_org.id,
                role_id=4,
                creation_date=str(datetime.now()),
                update_date=str(datetime.now()),
            )
        )
        await db.commit()

        response = await _request(
            _make_app(db, admin_user),
            "POST",
            f"/api/v1/auth/mfa/org-reset/{org.id}/{regular_user.id}",
        )

        assert response.status_code == 403
        assert response.json()["detail"]["code"] == "ACCOUNT_SHARED"
