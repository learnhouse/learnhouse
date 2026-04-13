"""Router tests for src/routers/instance.py."""

from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.routers.instance import router as instance_router


@pytest.fixture
def app(db):
    app = FastAPI()
    app.include_router(instance_router, prefix="/api/v1/instance")
    app.dependency_overrides[get_db_session] = lambda: db
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


class TestInstanceRouter:
    async def test_get_instance_info_from_cache(self, client):
        with patch(
            "src.routers.instance.get_cached_instance_info",
            return_value={"mode": "ee"},
        ):
            response = await client.get("/api/v1/instance/info")

        assert response.status_code == 200
        assert response.json()["mode"] == "ee"

    async def test_get_instance_info_builds_response(self, client, db, org):
        config = SimpleNamespace(
            hosting_config=SimpleNamespace(frontend_domain="localhost:3000")
        )
        with patch(
            "src.routers.instance.get_cached_instance_info",
            return_value=None,
        ), patch(
            "src.routers.instance.get_learnhouse_config",
            return_value=config,
        ), patch(
            "src.routers.instance.get_deployment_mode",
            return_value="saas",
        ), patch(
            "src.routers.instance.is_multi_org_allowed",
            return_value=True,
        ), patch(
            "src.routers.instance.set_cached_instance_info",
        ) as mock_set_cache:
            response = await client.get("/api/v1/instance/info")

        assert response.status_code == 200
        body = response.json()
        assert body["default_org_slug"] == org.slug
        assert body["frontend_domain"] == "localhost:3000"
        assert body["top_domain"] == "localhost"
        mock_set_cache.assert_called_once()

    async def test_get_instance_info_falls_back_when_db_lookup_fails(self, client):
        config = SimpleNamespace(
            hosting_config=SimpleNamespace(frontend_domain="learnhouse.ai")
        )
        bad_session = Mock()
        bad_session.exec.side_effect = RuntimeError("db error")

        app = FastAPI()
        app.include_router(instance_router, prefix="/api/v1/instance")
        app.dependency_overrides[get_db_session] = lambda: bad_session

        try:
            with patch(
                "src.routers.instance.get_cached_instance_info",
                return_value=None,
            ), patch(
                "src.routers.instance.get_learnhouse_config",
                return_value=config,
            ), patch(
                "src.routers.instance.get_deployment_mode",
                return_value="oss",
            ), patch(
                "src.routers.instance.is_multi_org_allowed",
                return_value=False,
            ), patch(
                "src.routers.instance.set_cached_instance_info",
            ):
                async with AsyncClient(
                    transport=ASGITransport(app=app), base_url="http://test"
                ) as local_client:
                    response = await local_client.get("/api/v1/instance/info")
        finally:
            app.dependency_overrides.clear()

        assert response.status_code == 200
        assert response.json()["default_org_slug"] == "default"
