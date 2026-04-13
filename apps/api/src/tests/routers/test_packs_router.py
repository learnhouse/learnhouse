"""Router tests for src/routers/orgs/packs.py."""

import os
from datetime import datetime
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.packs import OrgPackRead
from src.routers.orgs.packs import internal_router, router as packs_router
from src.security.auth import get_current_user


@pytest.fixture
def app(db, admin_user):
    app = FastAPI()
    app.include_router(packs_router, prefix="/api/v1/orgs")
    app.include_router(internal_router, prefix="/api/v1/internal/packs")
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


def _mock_pack(**overrides) -> OrgPackRead:
    data = dict(
        id=1,
        org_id=1,
        pack_type="ai_credits",
        pack_id="ai_500",
        quantity=500,
        status="active",
        activated_at=datetime(2024, 1, 1),
        cancelled_at=None,
        cancel_at_period_end=False,
        platform_subscription_id="sub_123",
    )
    data.update(overrides)
    return OrgPackRead(**data)


class TestInternalPacksRouter:
    async def test_verify_platform_key_errors(self, client):
        old = os.environ.get("LEARNHOUSE_PLATFORM_API_KEY")
        os.environ.pop("LEARNHOUSE_PLATFORM_API_KEY", None)
        try:
            response = await client.post(
                "/api/v1/internal/packs/1/activate",
                headers={"x-platform-key": "platform-secret"},
                json={"pack_id": "ai_500", "platform_subscription_id": "sub_123"},
            )
        finally:
            if old is None:
                os.environ.pop("LEARNHOUSE_PLATFORM_API_KEY", None)
            else:
                os.environ["LEARNHOUSE_PLATFORM_API_KEY"] = old

        assert response.status_code == 500

        old = os.environ.get("LEARNHOUSE_PLATFORM_API_KEY")
        os.environ["LEARNHOUSE_PLATFORM_API_KEY"] = "platform-secret"
        try:
            response = await client.post(
                "/api/v1/internal/packs/1/activate",
                headers={"x-platform-key": "wrong-key"},
                json={"pack_id": "ai_500", "platform_subscription_id": "sub_123"},
            )
        finally:
            if old is None:
                os.environ.pop("LEARNHOUSE_PLATFORM_API_KEY", None)
            else:
                os.environ["LEARNHOUSE_PLATFORM_API_KEY"] = old

        assert response.status_code == 403

    async def test_activate_pack(self, client):
        old = os.environ.get("LEARNHOUSE_PLATFORM_API_KEY")
        os.environ["LEARNHOUSE_PLATFORM_API_KEY"] = "platform-secret"
        try:
            with patch(
                "src.routers.orgs.packs.activate_pack",
                return_value=_mock_pack(),
            ):
                response = await client.post(
                    "/api/v1/internal/packs/1/activate",
                    headers={"x-platform-key": "platform-secret"},
                    json={"pack_id": "ai_500", "platform_subscription_id": "sub_123"},
                )
        finally:
            if old is None:
                os.environ.pop("LEARNHOUSE_PLATFORM_API_KEY", None)
            else:
                os.environ["LEARNHOUSE_PLATFORM_API_KEY"] = old

        assert response.status_code == 200
        assert response.json()["pack_id"] == "ai_500"

    async def test_mark_pack_canceling(self, client):
        old = os.environ.get("LEARNHOUSE_PLATFORM_API_KEY")
        os.environ["LEARNHOUSE_PLATFORM_API_KEY"] = "platform-secret"
        try:
            with patch(
                "src.routers.orgs.packs.mark_pack_canceling",
                return_value=_mock_pack(cancel_at_period_end=True),
            ):
                response = await client.patch(
                    "/api/v1/internal/packs/1/mark-canceling",
                    headers={"x-platform-key": "platform-secret"},
                    json={"platform_subscription_id": "sub_123"},
                )
        finally:
            if old is None:
                os.environ.pop("LEARNHOUSE_PLATFORM_API_KEY", None)
            else:
                os.environ["LEARNHOUSE_PLATFORM_API_KEY"] = old

        assert response.status_code == 200
        assert response.json()["cancel_at_period_end"] is True

    async def test_deactivate_pack(self, client):
        old = os.environ.get("LEARNHOUSE_PLATFORM_API_KEY")
        os.environ["LEARNHOUSE_PLATFORM_API_KEY"] = "platform-secret"
        try:
            with patch(
                "src.routers.orgs.packs.deactivate_pack",
                return_value=_mock_pack(status="cancelled"),
            ):
                response = await client.request(
                    "DELETE",
                    "/api/v1/internal/packs/1/deactivate",
                    headers={"x-platform-key": "platform-secret"},
                    json={"platform_subscription_id": "sub_123"},
                )
        finally:
            if old is None:
                os.environ.pop("LEARNHOUSE_PLATFORM_API_KEY", None)
            else:
                os.environ["LEARNHOUSE_PLATFORM_API_KEY"] = old

        assert response.status_code == 200
        assert response.json()["status"] == "cancelled"

    async def test_deactivate_all_packs(self, client):
        old = os.environ.get("LEARNHOUSE_PLATFORM_API_KEY")
        os.environ["LEARNHOUSE_PLATFORM_API_KEY"] = "platform-secret"
        try:
            with patch(
                "src.routers.orgs.packs.deactivate_all_packs_for_org",
                return_value=2,
            ):
                response = await client.delete(
                    "/api/v1/internal/packs/1/deactivate-all",
                    headers={"x-platform-key": "platform-secret"},
                )
        finally:
            if old is None:
                os.environ.pop("LEARNHOUSE_PLATFORM_API_KEY", None)
            else:
                os.environ["LEARNHOUSE_PLATFORM_API_KEY"] = old

        assert response.status_code == 200
        assert response.json()["deactivated"] == 2


class TestOrgPacksRouter:
    async def test_get_org_packs(self, client, org):
        with patch(
            "src.routers.orgs.packs.is_org_admin",
            return_value=True,
        ), patch(
            "src.routers.orgs.packs.get_org_active_packs",
            return_value=[_mock_pack()],
        ):
            response = await client.get(f"/api/v1/orgs/{org.id}/packs")

        assert response.status_code == 200
        assert response.json()["active_packs"][0]["pack_id"] == "ai_500"
        assert len(response.json()["available_packs"]) > 0

        response = await client.get("/api/v1/orgs/999/packs")
        assert response.status_code == 404

    async def test_get_org_packs_forbidden(self, client, org):
        with patch(
            "src.routers.orgs.packs.is_org_admin",
            return_value=False,
        ):
            response = await client.get(f"/api/v1/orgs/{org.id}/packs")

        assert response.status_code == 403

    async def test_get_org_pack_summary(self, client, org):
        with patch(
            "src.routers.orgs.packs.is_org_admin",
            return_value=True,
        ), patch(
            "src.routers.orgs.packs.get_org_pack_summary",
            return_value={"ai_credits": 500, "member_seats": 0, "active_pack_count": 1},
        ):
            response = await client.get(f"/api/v1/orgs/{org.id}/packs/summary")

        assert response.status_code == 200
        assert response.json()["active_pack_count"] == 1

        with patch(
            "src.routers.orgs.packs.is_org_admin",
            return_value=False,
        ):
            response = await client.get(f"/api/v1/orgs/{org.id}/packs/summary")

        assert response.status_code == 403

    async def test_get_org_pack_summary_missing_org(self, client):
        response = await client.get("/api/v1/orgs/999/packs/summary")

        assert response.status_code == 404
