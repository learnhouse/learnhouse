from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlmodel import select

from src.db.user_organizations import UserOrganization
from src.db.users import User
from src.routers import psp_auth


class FakeRedis:
    def __init__(self):
        self.store = {}

    def setex(self, key, ttl, value):
        self.store[key] = value

    def getdel(self, key):
        return self.store.pop(key, None)


@pytest.fixture
def client(monkeypatch):
    fake = FakeRedis()

    async def _noop_ensure(_request, _email):
        return None

    monkeypatch.setattr(psp_auth, "get_redis_client", lambda: fake)
    monkeypatch.setattr(psp_auth, "validate_shell_token", lambda t: "user@opengov.com")
    monkeypatch.setattr(psp_auth, "_ensure_lh_user", _noop_ensure)
    monkeypatch.setattr(psp_auth, "create_access_token", lambda data: "ACCESS")
    monkeypatch.setattr(psp_auth, "create_refresh_token", lambda data: "REFRESH")
    monkeypatch.setenv("NEXT_PUBLIC_LEARNHOUSE_URL", "https://lms.example.com")

    app = FastAPI()
    app.include_router(psp_auth.psp_router, prefix="/api/v1/psp")
    app.include_router(psp_auth.platform_router)
    return TestClient(app), fake


def test_token_exchange_issues_code(client):
    c, fake = client
    res = c.post("/api/v1/psp/token-exchange", headers={"Authorization": "Bearer shelltok"})
    assert res.status_code == 200
    body = res.json()
    assert body["learnhouse_url"] == "https://lms.example.com"
    code = body["code"]
    assert fake.store[f"psp_code:{code}"]


def test_exchange_code_is_single_use(client):
    c, fake = client
    code = c.post("/api/v1/psp/token-exchange", headers={"Authorization": "Bearer t"}).json()["code"]

    first = c.get(f"/api/auth/exchange-code?code={code}")
    assert first.status_code == 200
    assert first.json() == {"access_token": "ACCESS", "refresh_token": "REFRESH"}

    second = c.get(f"/api/auth/exchange-code?code={code}")
    assert second.status_code == 404


def test_token_exchange_rejects_bad_shell_token(client, monkeypatch):
    c, _ = client

    def boom(_t):
        raise psp_auth.ShellTokenError("nope")

    monkeypatch.setattr(psp_auth, "validate_shell_token", boom)
    res = c.post("/api/v1/psp/token-exchange", headers={"Authorization": "Bearer bad"})
    assert res.status_code == 401


# ---------------------------------------------------------------------------
# _provision_psp_user — must link the new user to the org, not just insert a
# bare User row. Routes through the canonical create_user service so a
# UserOrganization membership + role are created (regression for the org-less
# provisioning bug).
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_provision_psp_user_creates_org_membership(mock_request, db, org, user_role):
    with patch(
        "src.services.users.users.check_limits_with_usage", new_callable=AsyncMock
    ), patch(
        "src.services.users.users.increase_feature_usage", new_callable=AsyncMock
    ), patch(
        "src.services.users.users.track", new_callable=AsyncMock
    ), patch(
        "src.services.users.users.dispatch_webhooks", new_callable=AsyncMock
    ), patch(
        "src.services.users.users.send_account_creation_email"
    ):
        await psp_auth._provision_psp_user(mock_request, db, "learner@opengov.com", org.id)

    user = (
        await db.execute(select(User).where(User.email == "learner@opengov.com"))
    ).scalars().first()
    assert user is not None
    assert user.email_verified is True
    assert user.signup_method == "psp"

    membership = (
        await db.execute(
            select(UserOrganization).where(UserOrganization.user_id == user.id)
        )
    ).scalars().first()
    assert membership is not None, "PSP-provisioned user must be linked to the org"
    assert membership.org_id == org.id
    assert membership.role_id == 4  # the user_role seeded by the fixture
