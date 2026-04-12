"""
Router tests for src/routers/orgs/orgs.py

Uses httpx AsyncClient with a minimal FastAPI app containing only the
orgs router. Service functions are patched at the router import level
to avoid hitting RBAC, caching, config, and storage dependencies.
"""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.organizations import OrganizationRead
from src.routers.orgs.orgs import router as orgs_router
from src.security.auth import get_current_user
from src.security.features_utils.dependencies import require_org_admin


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def app(db, admin_user):
    app = FastAPI()
    app.include_router(orgs_router, prefix="/api/v1/orgs")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: admin_user
    app.dependency_overrides[require_org_admin] = lambda: True
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


def _mock_org_read(**overrides) -> OrganizationRead:
    """Build a minimal OrganizationRead for mocked service returns."""
    data = dict(
        id=1,
        name="Test Org",
        slug="test-org",
        email="test@org.com",
        org_uuid="org_test",
        creation_date="2024-01-01",
        update_date="2024-01-01",
    )
    data.update(overrides)
    return OrganizationRead(**data)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestGetOrgBySlug:
    async def test_get_org_by_slug(self, client):
        mock_org = _mock_org_read()
        with patch(
            "src.routers.orgs.orgs.get_organization_by_slug",
            new_callable=AsyncMock,
            return_value=mock_org,
        ):
            response = await client.get("/api/v1/orgs/slug/test-org")

        assert response.status_code == 200
        body = response.json()
        assert "name" in body
        assert body["name"] == "Test Org"
        assert body["slug"] == "test-org"

    async def test_get_org_by_slug_not_found(self, client):
        with patch(
            "src.routers.orgs.orgs.get_organization_by_slug",
            new_callable=AsyncMock,
            side_effect=HTTPException(
                status_code=404, detail="Organization not found"
            ),
        ):
            response = await client.get("/api/v1/orgs/slug/nonexistent")

        assert response.status_code == 404


class TestGetOrgByUuid:
    async def test_get_org_by_uuid(self, client):
        mock_org = _mock_org_read()
        with patch(
            "src.routers.orgs.orgs.get_organization_by_uuid",
            new_callable=AsyncMock,
            return_value=mock_org,
        ):
            response = await client.get("/api/v1/orgs/uuid/org_test")

        assert response.status_code == 200
        body = response.json()
        assert body["org_uuid"] == "org_test"
        assert body["name"] == "Test Org"

    async def test_get_org_by_uuid_not_found(self, client):
        with patch(
            "src.routers.orgs.orgs.get_organization_by_uuid",
            new_callable=AsyncMock,
            side_effect=HTTPException(
                status_code=404, detail="Organization not found"
            ),
        ):
            response = await client.get("/api/v1/orgs/uuid/nonexistent")

        assert response.status_code == 404
