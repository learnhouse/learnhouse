"""Router tests for src/routers/dev.py."""

from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.users import PublicUser
from src.routers.dev import router as dev_router
from src.security.auth import get_authenticated_user


@pytest.fixture
def superadmin_user():
    return PublicUser(
        id=99,
        username="superadmin",
        first_name="Super",
        last_name="Admin",
        email="superadmin@test.com",
        user_uuid="user_superadmin",
        is_superadmin=True,
    )


@pytest.fixture
def app(db, superadmin_user):
    app = FastAPI()
    app.include_router(dev_router, prefix="/api/v1/dev")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_authenticated_user] = lambda: superadmin_user
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


class TestDevRouter:
    async def test_config_redacts_secrets_and_forbidden(self, client, app, admin_user):
        mock_config = SimpleNamespace(
            model_dump=lambda: {
                "name": "LearnHouse",
                "token": "abcd1234",
                "nested": {
                    "password": "secret-value",
                    "public": "visible",
                },
            }
        )

        with patch("src.routers.dev.get_learnhouse_config", return_value=mock_config):
            response = await client.get("/api/v1/dev/config")

        assert response.status_code == 200
        body = response.json()
        assert body["token"] == "abcd***REDACTED***"
        assert body["nested"]["password"] == "secr***REDACTED***"
        assert body["nested"]["public"] == "visible"

        app.dependency_overrides[get_authenticated_user] = lambda: admin_user
        response = await client.get("/api/v1/dev/config")
        assert response.status_code == 403

    @pytest.mark.parametrize(
        ("endpoint", "patch_target"),
        [
            ("/api/v1/dev/migrate_orgconfig_v0_to_v1", "src.routers.dev.migrate_v0_to_v1"),
            ("/api/v1/dev/migrate_orgconfig_v1_to_v1.1", "src.routers.dev.migrate_to_v1_1"),
            ("/api/v1/dev/migrate_orgconfig_v1_to_v1.2", "src.routers.dev.migrate_to_v1_2"),
        ],
    )
    async def test_migrations(self, client, app, endpoint, patch_target):
        org_config = SimpleNamespace(config={"version": "old"})
        db_session = Mock()
        db_session.exec.return_value = [org_config]
        db_session.add = Mock()
        db_session.commit = Mock()

        app.dependency_overrides[get_db_session] = lambda: db_session

        with patch(patch_target, return_value={"version": "new"}):
            response = await client.post(endpoint)

        assert response.status_code == 200
        assert response.json()["message"] == "Migration successful"
        assert org_config.config == {"version": "new"}
        db_session.add.assert_called_once_with(org_config)
        db_session.commit.assert_called_once()


