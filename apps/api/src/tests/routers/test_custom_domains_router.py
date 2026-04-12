"""Router tests for src/routers/orgs/custom_domains.py."""

import os
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.custom_domains import (
    CustomDomainRead,
    CustomDomainResolveResponse,
    CustomDomainVerificationInfo,
)
from src.routers.orgs.custom_domains import (
    internal_router,
    public_router,
    router as custom_domains_router,
)
from src.security.auth import get_current_user


@pytest.fixture
def app(db, admin_user):
    app = FastAPI()
    app.include_router(custom_domains_router, prefix="/api/v1/orgs")
    app.include_router(public_router, prefix="/api/v1/public")
    app.include_router(internal_router, prefix="/api/v1/internal")
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


def _mock_domain_read(**overrides) -> CustomDomainRead:
    data = dict(
        id=1,
        domain_uuid="domain_test",
        domain="example.com",
        org_id=1,
        status="verified",
        primary=False,
        verification_token="verify123",
        creation_date="2024-01-01",
        update_date="2024-01-01",
        verified_at=None,
        last_check_at=None,
        check_error=None,
    )
    data.update(overrides)
    return CustomDomainRead(**data)


class TestCustomDomainsRouter:
    async def test_add_custom_domain(self, client):
        with patch(
            "src.routers.orgs.custom_domains.add_custom_domain",
            new_callable=AsyncMock,
            return_value=_mock_domain_read(),
        ):
            response = await client.post(
                "/api/v1/orgs/1/domains",
                json={"domain": "example.com"},
            )

        assert response.status_code == 200
        assert response.json()["domain_uuid"] == "domain_test"

    async def test_list_custom_domains(self, client):
        with patch(
            "src.routers.orgs.custom_domains.list_custom_domains",
            new_callable=AsyncMock,
            return_value=[_mock_domain_read()],
        ):
            response = await client.get("/api/v1/orgs/1/domains")

        assert response.status_code == 200
        assert response.json()[0]["domain"] == "example.com"

    async def test_get_custom_domain(self, client):
        with patch(
            "src.routers.orgs.custom_domains.get_custom_domain",
            new_callable=AsyncMock,
            return_value=_mock_domain_read(),
        ):
            response = await client.get("/api/v1/orgs/1/domains/domain_test")

        assert response.status_code == 200
        assert response.json()["domain_uuid"] == "domain_test"

    async def test_get_domain_verification_info(self, client):
        info = CustomDomainVerificationInfo(
            domain="example.com",
            status="pending",
            txt_record_host="_verify.example.com",
            txt_record_value="token",
            cname_record_host="www",
            cname_record_value="target.example.com",
            instructions="Add records",
        )
        with patch(
            "src.routers.orgs.custom_domains.get_domain_verification_info",
            new_callable=AsyncMock,
            return_value=info,
        ):
            response = await client.get(
                "/api/v1/orgs/1/domains/domain_test/verification-info"
            )

        assert response.status_code == 200
        assert response.json()["domain"] == "example.com"

    async def test_verify_custom_domain(self, client):
        with patch(
            "src.routers.orgs.custom_domains.verify_custom_domain",
            new_callable=AsyncMock,
            return_value={"verified": True},
        ):
            response = await client.post("/api/v1/orgs/1/domains/domain_test/verify")

        assert response.status_code == 200
        assert response.json()["verified"] is True

    async def test_check_domain_ssl_status(self, client):
        with patch(
            "src.routers.orgs.custom_domains.check_domain_ssl_status",
            new_callable=AsyncMock,
            return_value={"ssl_ready": True},
        ):
            response = await client.get(
                "/api/v1/orgs/1/domains/domain_test/ssl-status"
            )

        assert response.status_code == 200
        assert response.json()["ssl_ready"] is True

    async def test_delete_custom_domain(self, client):
        with patch(
            "src.routers.orgs.custom_domains.delete_custom_domain",
            new_callable=AsyncMock,
            return_value={"deleted": True},
        ):
            response = await client.delete("/api/v1/orgs/1/domains/domain_test")

        assert response.status_code == 200
        assert response.json()["deleted"] is True

    async def test_resolve_domain(self, client):
        result = CustomDomainResolveResponse(
            org_id=1,
            org_slug="test-org",
            org_uuid="org_test",
        )
        with patch(
            "src.routers.orgs.custom_domains.resolve_org_by_domain",
            new_callable=AsyncMock,
            return_value=result,
        ):
            response = await client.get("/api/v1/public/resolve/domain/example.com")

        assert response.status_code == 200
        assert response.json()["org_slug"] == "test-org"

    async def test_resolve_domain_not_found(self, client):
        with patch(
            "src.routers.orgs.custom_domains.resolve_org_by_domain",
            new_callable=AsyncMock,
            return_value=None,
        ):
            response = await client.get("/api/v1/public/resolve/domain/missing.com")

        assert response.status_code == 404

    async def test_list_all_verified_domains(self, client):
        old = os.environ.get("CLOUD_INTERNAL_KEY")
        os.environ["CLOUD_INTERNAL_KEY"] = "internal-secret"
        try:
            with patch(
                "src.routers.orgs.custom_domains.list_all_verified_domains",
                new_callable=AsyncMock,
                return_value=[{"domain": "example.com"}],
            ):
                response = await client.get(
                    "/api/v1/internal/domains/verified",
                    headers={"x-internal-key": "internal-secret"},
                )
        finally:
            if old is None:
                os.environ.pop("CLOUD_INTERNAL_KEY", None)
            else:
                os.environ["CLOUD_INTERNAL_KEY"] = old

        assert response.status_code == 200
        assert response.json()[0]["domain"] == "example.com"

    async def test_list_all_verified_domains_bad_key(self, client):
        old = os.environ.get("CLOUD_INTERNAL_KEY")
        os.environ["CLOUD_INTERNAL_KEY"] = "internal-secret"
        try:
            response = await client.get(
                "/api/v1/internal/domains/verified",
                headers={"x-internal-key": "wrong"},
            )
        finally:
            if old is None:
                os.environ.pop("CLOUD_INTERNAL_KEY", None)
            else:
                os.environ["CLOUD_INTERNAL_KEY"] = old

        assert response.status_code == 403
