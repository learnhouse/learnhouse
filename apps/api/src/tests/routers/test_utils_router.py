"""Router tests for src/routers/utils.py."""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient

from src.db.users import AnonymousUser
from src.routers.utils import router as utils_router
from src.security.auth import get_current_user


@pytest.fixture
def app(admin_user):
    app = FastAPI()
    app.include_router(utils_router, prefix="/api/v1/utils")
    app.dependency_overrides[get_current_user] = lambda: admin_user
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


class TestUtilsRouter:
    async def test_link_preview_success_and_http_exception(self, client, app):
        with patch(
            "src.routers.utils.fetch_link_preview",
            new_callable=AsyncMock,
            return_value={"title": "Example", "url": "https://example.com"},
        ):
            response = await client.get(
                "/api/v1/utils/link-preview",
                params={"url": "https://example.com"},
            )

        assert response.status_code == 200
        assert response.json()["title"] == "Example"

        with patch(
            "src.routers.utils.fetch_link_preview",
            new_callable=AsyncMock,
            side_effect=HTTPException(status_code=404, detail="Not found"),
        ):
            response = await client.get(
                "/api/v1/utils/link-preview",
                params={"url": "https://example.com"},
            )

        assert response.status_code == 404

    async def test_link_preview_anonymous_and_general_error(
        self, client, app, admin_user
    ):
        app.dependency_overrides[get_current_user] = lambda: AnonymousUser()

        response = await client.get(
            "/api/v1/utils/link-preview",
            params={"url": "https://example.com"},
        )
        assert response.status_code == 401

        app.dependency_overrides[get_current_user] = lambda: admin_user

        with patch(
            "src.routers.utils.fetch_link_preview",
            new_callable=AsyncMock,
            side_effect=RuntimeError("boom"),
        ):
            response = await client.get(
                "/api/v1/utils/link-preview",
                params={"url": "https://example.com"},
            )

        assert response.status_code == 400
