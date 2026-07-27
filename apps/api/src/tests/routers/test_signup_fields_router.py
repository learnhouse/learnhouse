"""Router + service coverage for the custom signup fields endpoints.

Covers PUT /{org_id}/config/signup-fields (admin defines the fields),
GET /{org_id}/signup-fields/pending and POST /{org_id}/signup-fields/complete
(the post-OAuth completion prompt), plus the membership gate on both.
"""

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlmodel import select

from src.core.events.database import get_db_session
from src.db.organization_config import OrganizationConfig
from src.db.users import User
from src.routers.orgs.orgs import router as orgs_router
from src.security.auth import get_authenticated_user, get_current_user
from src.security.features_utils.dependencies import require_org_admin


@pytest.fixture
def app(db, admin_user):
    app = FastAPI()
    app.include_router(orgs_router, prefix="/api/v1/orgs")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: admin_user
    app.dependency_overrides[get_authenticated_user] = lambda: admin_user
    app.dependency_overrides[require_org_admin] = lambda: True
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


async def _make_config(db, org, config_version="2.0"):
    org_config = OrganizationConfig(
        org_id=org.id,
        config={"config_version": config_version},
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(org_config)
    await db.commit()
    await db.refresh(org_config)
    return org_config


async def _read_config(db, org):
    return (
        await db.execute(
            select(OrganizationConfig).where(OrganizationConfig.org_id == org.id)
        )
    ).scalars().first()


TEXT_FIELD = {"key": "company", "label": "Company", "type": "text", "required": True}


class TestUpdateSignupFieldsConfig:
    @pytest.mark.asyncio
    async def test_writes_fields_to_v2_config(self, client, db, org):
        await _make_config(db, org, "2.0")

        with patch("src.services.orgs.orgs.rbac_check", new_callable=AsyncMock):
            response = await client.put(
                f"/api/v1/orgs/{org.id}/config/signup-fields",
                json={"fields": [TEXT_FIELD]},
            )

        assert response.status_code == 200
        assert response.json()["detail"] == "Signup fields configuration updated"

        row = await _read_config(db, org)
        stored = row.config["customization"]["signup_fields"]["fields"]
        assert [f["key"] for f in stored] == ["company"]
        assert stored[0]["required"] is True

    @pytest.mark.asyncio
    async def test_writes_fields_to_v1_config(self, client, db, org):
        """v1 keeps customization under `general`, not `customization`."""
        await _make_config(db, org, "1.4")

        with patch("src.services.orgs.orgs.rbac_check", new_callable=AsyncMock):
            response = await client.put(
                f"/api/v1/orgs/{org.id}/config/signup-fields",
                json={"fields": [TEXT_FIELD]},
            )

        assert response.status_code == 200
        row = await _read_config(db, org)
        assert [
            f["key"] for f in row.config["general"]["signup_fields"]["fields"]
        ] == ["company"]

    @pytest.mark.asyncio
    async def test_unknown_keys_are_dropped_by_the_model(self, client, db, org):
        await _make_config(db, org)

        with patch("src.services.orgs.orgs.rbac_check", new_callable=AsyncMock):
            response = await client.put(
                f"/api/v1/orgs/{org.id}/config/signup-fields",
                json={"fields": [{**TEXT_FIELD, "sneaky": "value"}]},
            )

        assert response.status_code == 200
        row = await _read_config(db, org)
        assert "sneaky" not in row.config["customization"]["signup_fields"]["fields"][0]

    @pytest.mark.asyncio
    async def test_empty_payload_clears_the_fields(self, client, db, org):
        await _make_config(db, org)

        with patch("src.services.orgs.orgs.rbac_check", new_callable=AsyncMock):
            response = await client.put(
                f"/api/v1/orgs/{org.id}/config/signup-fields", json={}
            )

        assert response.status_code == 200
        row = await _read_config(db, org)
        assert row.config["customization"]["signup_fields"]["fields"] == []

    @pytest.mark.asyncio
    async def test_duplicate_keys_are_rejected(self, client, db, org):
        """Two fields sharing a key would make one silently shadow the other in
        extra_metadata."""
        await _make_config(db, org)

        with patch("src.services.orgs.orgs.rbac_check", new_callable=AsyncMock):
            response = await client.put(
                f"/api/v1/orgs/{org.id}/config/signup-fields",
                json={"fields": [TEXT_FIELD, {**TEXT_FIELD, "label": "Other"}]},
            )

        assert response.status_code == 400
        assert "unique" in response.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_blank_key_is_rejected(self, client, db, org):
        await _make_config(db, org)

        with patch("src.services.orgs.orgs.rbac_check", new_callable=AsyncMock):
            response = await client.put(
                f"/api/v1/orgs/{org.id}/config/signup-fields",
                json={"fields": [{**TEXT_FIELD, "key": "   "}]},
            )

        assert response.status_code == 400

    @pytest.mark.asyncio
    async def test_unknown_org_is_404(self, client, db):
        with patch("src.services.orgs.orgs.rbac_check", new_callable=AsyncMock):
            response = await client.put(
                "/api/v1/orgs/999999/config/signup-fields",
                json={"fields": [TEXT_FIELD]},
            )
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_org_without_a_config_row_is_404(self, client, db, org):
        with patch("src.services.orgs.orgs.rbac_check", new_callable=AsyncMock):
            response = await client.put(
                f"/api/v1/orgs/{org.id}/config/signup-fields",
                json={"fields": [TEXT_FIELD]},
            )
        assert response.status_code == 404


class TestPendingAndComplete:
    @pytest.mark.asyncio
    async def test_pending_lists_unanswered_required_fields(self, client, db, org):
        await _make_config(db, org)
        with patch("src.services.orgs.orgs.rbac_check", new_callable=AsyncMock):
            await client.put(
                f"/api/v1/orgs/{org.id}/config/signup-fields",
                json={"fields": [TEXT_FIELD]},
            )

        with patch("src.security.org_auth.is_org_member", return_value=True):
            response = await client.get(f"/api/v1/orgs/{org.id}/signup-fields/pending")

        assert response.status_code == 200
        assert [f["key"] for f in response.json()["fields"]] == ["company"]

    @pytest.mark.asyncio
    async def test_pending_is_empty_when_org_declares_nothing(self, client, db, org):
        await _make_config(db, org)

        with patch("src.security.org_auth.is_org_member", return_value=True):
            response = await client.get(f"/api/v1/orgs/{org.id}/signup-fields/pending")

        assert response.status_code == 200
        assert response.json() == {"fields": []}

    @pytest.mark.asyncio
    async def test_pending_requires_membership(self, client, db, org):
        with patch("src.security.org_auth.is_org_member", return_value=False):
            response = await client.get(f"/api/v1/orgs/{org.id}/signup-fields/pending")
        assert response.status_code == 403

    @pytest.mark.asyncio
    async def test_complete_stores_answers_and_clears_pending(
        self, client, db, org, admin_user
    ):
        await _make_config(db, org)
        with patch("src.services.orgs.orgs.rbac_check", new_callable=AsyncMock):
            await client.put(
                f"/api/v1/orgs/{org.id}/config/signup-fields",
                json={"fields": [TEXT_FIELD]},
            )

        with patch("src.security.org_auth.is_org_member", return_value=True):
            response = await client.post(
                f"/api/v1/orgs/{org.id}/signup-fields/complete",
                json={"company": "Acme"},
            )
            assert response.status_code == 200
            assert response.json()["extra_metadata"] == {"company": "Acme"}

            pending = await client.get(f"/api/v1/orgs/{org.id}/signup-fields/pending")
            assert pending.json()["fields"] == []

        row = (
            await db.execute(select(User).where(User.id == admin_user.id))
        ).scalars().first()
        assert row.extra_metadata == {"company": "Acme"}

    @pytest.mark.asyncio
    async def test_complete_rejects_an_invalid_value(self, client, db, org):
        await _make_config(db, org)
        with patch("src.services.orgs.orgs.rbac_check", new_callable=AsyncMock):
            await client.put(
                f"/api/v1/orgs/{org.id}/config/signup-fields",
                json={
                    "fields": [
                        {"key": "cohort", "type": "select", "options": ["A"]},
                    ]
                },
            )

        with patch("src.security.org_auth.is_org_member", return_value=True):
            response = await client.post(
                f"/api/v1/orgs/{org.id}/signup-fields/complete",
                json={"cohort": "NOT_AN_OPTION"},
            )

        assert response.status_code == 400
        assert response.json()["detail"]["field"] == "cohort"

    @pytest.mark.asyncio
    async def test_complete_requires_membership(self, client, db, org):
        with patch("src.security.org_auth.is_org_member", return_value=False):
            response = await client.post(
                f"/api/v1/orgs/{org.id}/signup-fields/complete",
                json={"company": "Acme"},
            )
        assert response.status_code == 403
