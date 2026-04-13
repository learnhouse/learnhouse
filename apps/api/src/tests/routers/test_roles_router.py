"""Router tests for src/routers/roles.py."""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.roles import RoleRead, RoleTypeEnum
from src.routers.roles import router as roles_router
from src.security.auth import get_current_user


@pytest.fixture
def app(db, admin_user):
    app = FastAPI()
    app.include_router(roles_router, prefix="/api/v1/roles")
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


def _mock_role_read(**overrides) -> RoleRead:
    data = dict(
        id=1,
        org_id=1,
        name="Instructor",
        description="Role",
        rights={},
        role_type=RoleTypeEnum.TYPE_ORGANIZATION,
        role_uuid="role_test",
        creation_date="2024-01-01",
        update_date="2024-01-01",
    )
    data.update(overrides)
    return RoleRead(**data)


class TestRolesRouter:
    async def test_create_role(self, client):
        with patch(
            "src.security.features_utils.plan_check.get_deployment_mode",
            return_value="ee",
        ), patch(
            "src.routers.roles.create_role",
            new_callable=AsyncMock,
            return_value=_mock_role_read(),
        ):
            response = await client.post(
                "/api/v1/roles/org/1",
                json={"name": "Instructor", "description": "Role", "rights": {}},
            )

        assert response.status_code == 200
        assert response.json()["role_uuid"] == "role_test"

    async def test_get_roles_by_organization(self, client):
        with patch(
            "src.routers.roles.get_roles_by_organization",
            new_callable=AsyncMock,
            return_value=[_mock_role_read()],
        ):
            response = await client.get("/api/v1/roles/org/1")

        assert response.status_code == 200
        assert response.json()[0]["name"] == "Instructor"

    async def test_get_role(self, client):
        with patch(
            "src.routers.roles.read_role",
            new_callable=AsyncMock,
            return_value=_mock_role_read(),
        ):
            response = await client.get("/api/v1/roles/1")

        assert response.status_code == 200
        assert response.json()["id"] == 1

    async def test_update_role(self, client):
        with patch(
            "src.routers.roles.update_role",
            new_callable=AsyncMock,
            return_value=_mock_role_read(name="Updated"),
        ):
            response = await client.put(
                "/api/v1/roles/1",
                json={"name": "Updated", "rights": {}},
            )

        assert response.status_code == 200
        assert response.json()["name"] == "Updated"

    async def test_update_role_invalid_id(self, client):
        response = await client.put(
            "/api/v1/roles/not-a-number",
            json={"name": "Updated", "rights": {}},
        )

        assert response.status_code == 400
        assert "must be a number" in response.json()["detail"]

    async def test_delete_role(self, client):
        with patch(
            "src.routers.roles.delete_role",
            new_callable=AsyncMock,
            return_value={"detail": "deleted"},
        ):
            response = await client.delete("/api/v1/roles/1")

        assert response.status_code == 200
        assert response.json()["detail"] == "deleted"
