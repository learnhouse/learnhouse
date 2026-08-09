"""Router tests for src/routers/orgs/ai_credits.py."""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.users import APITokenUser
from src.routers.orgs.ai_credits import (
    router as ai_credits_router,
    verify_user_is_org_admin,
    verify_user_is_org_member,
)
from src.security.auth import get_current_user


@pytest.fixture
def app(db, admin_user):
    app = FastAPI()
    app.include_router(ai_credits_router, prefix="/api/v1/orgs")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: admin_user
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


@pytest.fixture(autouse=True)
def ee_mode():
    """Run this module against the self-hosted-EE baseline.

    The credit mutators are superadmin-only and therefore Enterprise-only. The
    suite pins 'oss' globally (see conftest), which would 403 them before any
    of the behaviour under test runs. Tests that specifically want OSS patch
    the same target again — the inner patch wins.
    """
    with patch("src.core.deployment_mode.get_deployment_mode", return_value="ee"):
        yield


class TestAICreditsRouter:
    async def test_org_member_and_admin_wrappers(self, db, org):
        with patch(
            "src.routers.orgs.ai_credits.is_org_member",
            return_value=True,
        ), patch(
            "src.routers.orgs.ai_credits.is_org_admin",
            return_value=True,
        ):
            assert await verify_user_is_org_member(1, 1, db)
            assert await verify_user_is_org_admin(1, 1, db)

        with patch(
            "src.routers.orgs.ai_credits.is_org_member",
            return_value=False,
        ), patch(
            "src.routers.orgs.ai_credits.is_org_admin",
            return_value=False,
        ):
            assert not await verify_user_is_org_member(1, 1, db)
            assert not await verify_user_is_org_admin(1, 1, db)

    async def test_get_org_ai_credits_success_and_summary_error(
        self, client, org
    ):
        with patch(
            "src.routers.orgs.ai_credits.verify_user_is_org_member",
            new_callable=AsyncMock,
            return_value=True,
        ), patch(
            "src.routers.orgs.ai_credits.get_ai_credits_summary",
            return_value={
                "plan": "free",
                "base_credits": 100,
                "purchased_credits": 50,
                "total_credits": 150,
                "used_credits": 20,
                "remaining_credits": 130,
                "mode": "v1",
            },
        ):
            response = await client.get(f"/api/v1/orgs/{org.id}/ai-credits")

        assert response.status_code == 200
        assert response.json()["remaining_credits"] == 130

        with patch(
            "src.routers.orgs.ai_credits.verify_user_is_org_member",
            new_callable=AsyncMock,
            return_value=True,
        ), patch(
            "src.routers.orgs.ai_credits.get_ai_credits_summary",
            return_value={"error": "Credits not found"},
        ):
            response = await client.get(f"/api/v1/orgs/{org.id}/ai-credits")

        assert response.status_code == 404

    async def test_get_org_ai_credits_forbidden_and_missing_org(self, client):
        with patch(
            "src.routers.orgs.ai_credits.verify_user_is_org_member",
            new_callable=AsyncMock,
            return_value=False,
        ):
            response = await client.get("/api/v1/orgs/1/ai-credits")

        assert response.status_code == 403

        response = await client.get("/api/v1/orgs/9999/ai-credits")
        assert response.status_code == 404

    async def test_get_org_ai_credits_api_token_wrong_org(self, app, client, org):
        # An API token scoped to a different org must be rejected with 403
        # before the membership check runs.
        app.dependency_overrides[get_current_user] = lambda: APITokenUser(
            org_id=org.id + 999, created_by_user_id=1
        )
        response = await client.get(f"/api/v1/orgs/{org.id}/ai-credits")

        assert response.status_code == 403
        assert "not scoped" in response.json()["detail"]

    async def test_add_org_ai_credits_success_and_validation(self, client, org):
        # Adding "purchased" credits has no payment check, so it is superadmin-only.
        with patch(
            "src.routers.orgs.ai_credits.is_user_superadmin",
            new_callable=AsyncMock,
            return_value=True,
        ), patch(
            "src.routers.orgs.ai_credits.add_ai_credits",
            return_value=250,
        ):
            response = await client.post(
                f"/api/v1/orgs/{org.id}/ai-credits/add",
                json={"amount": 50},
            )

        assert response.status_code == 200
        assert response.json()["new_purchased_total"] == 250

        with patch(
            "src.routers.orgs.ai_credits.is_user_superadmin",
            new_callable=AsyncMock,
            return_value=True,
        ):
            response = await client.post(
                f"/api/v1/orgs/{org.id}/ai-credits/add",
                json={"amount": 0},
            )

        assert response.status_code == 400

        response = await client.post(
            "/api/v1/orgs/9999/ai-credits/add",
            json={"amount": 10},
        )
        assert response.status_code == 404

        # A mere org admin (non-superadmin) must be rejected.
        with patch(
            "src.routers.orgs.ai_credits.is_user_superadmin",
            new_callable=AsyncMock,
            return_value=False,
        ):
            response = await client.post(
                f"/api/v1/orgs/{org.id}/ai-credits/add",
                json={"amount": 10},
            )
        assert response.status_code == 403

    async def test_reset_org_ai_credits_success_and_forbidden(self, client, org):
        with patch(
            "src.routers.orgs.ai_credits.is_user_superadmin",
            new_callable=AsyncMock,
            return_value=True,
        ), patch("src.routers.orgs.ai_credits.reset_ai_credits_usage") as reset_mock:
            response = await client.post(f"/api/v1/orgs/{org.id}/ai-credits/reset")

        assert response.status_code == 200
        reset_mock.assert_called_once_with(org.id)

        # A mere org admin (non-superadmin) must be rejected.
        with patch(
            "src.routers.orgs.ai_credits.is_user_superadmin",
            new_callable=AsyncMock,
            return_value=False,
        ):
            response = await client.post(f"/api/v1/orgs/{org.id}/ai-credits/reset")

        assert response.status_code == 403

        response = await client.post("/api/v1/orgs/9999/ai-credits/reset")
        assert response.status_code == 404

    async def test_set_org_ai_credits_superadmin_and_errors(self, client, org):
        with patch(
            "src.routers.orgs.ai_credits.is_user_superadmin",
            new_callable=AsyncMock,
            return_value=True,
        ), patch(
            "src.routers.orgs.ai_credits.set_ai_credits",
            return_value=500,
        ):
            response = await client.post(
                f"/api/v1/orgs/{org.id}/ai-credits/set",
                json={"amount": 500},
            )

        assert response.status_code == 200
        assert response.json()["purchased_total"] == 500

        with patch(
            "src.routers.orgs.ai_credits.is_user_superadmin",
            new_callable=AsyncMock,
            return_value=False,
        ):
            response = await client.post(
                f"/api/v1/orgs/{org.id}/ai-credits/set",
                json={"amount": 100},
            )
        assert response.status_code == 403

        response = await client.post(
            "/api/v1/orgs/9999/ai-credits/set",
            json={"amount": 100},
        )
        assert response.status_code == 404

        with patch(
            "src.routers.orgs.ai_credits.is_user_superadmin",
            new_callable=AsyncMock,
            return_value=True,
        ):
            response = await client.post(
                f"/api/v1/orgs/{org.id}/ai-credits/set",
                json={"amount": -1},
            )
        assert response.status_code == 400


class TestAICreditsOSSGate:
    """The credit mutators are Enterprise-only; the read endpoint is not."""

    async def test_mutators_403_in_oss(self, client, org):
        with patch("src.core.deployment_mode.get_deployment_mode", return_value="oss"):
            for path, payload in (
                (f"/api/v1/orgs/{org.id}/ai-credits/add", {"amount": 10}),
                (f"/api/v1/orgs/{org.id}/ai-credits/reset", {}),
                (f"/api/v1/orgs/{org.id}/ai-credits/set", {"amount": 10}),
            ):
                response = await client.post(path, json=payload)
                assert response.status_code == 403, path
                assert response.json()["detail"]["error"] == "ee_required", path

    async def test_get_still_works_in_oss(self, client, org):
        # Regression guard: three non-admin billing and usage surfaces read
        # this endpoint. Gating it would break org billing in every mode.
        with patch("src.core.deployment_mode.get_deployment_mode", return_value="oss"), patch(
            "src.routers.orgs.ai_credits.verify_user_is_org_member",
            new_callable=AsyncMock,
            return_value=True,
        ), patch(
            "src.routers.orgs.ai_credits.get_ai_credits_summary",
            return_value={
                "plan": "free",
                "base_credits": 100,
                "purchased_credits": 0,
                "total_credits": 100,
                "used_credits": 0,
                "remaining_credits": 100,
                "mode": "v1",
            },
        ):
            response = await client.get(f"/api/v1/orgs/{org.id}/ai-credits")
        assert response.status_code == 200
        assert response.json()["remaining_credits"] == 100
