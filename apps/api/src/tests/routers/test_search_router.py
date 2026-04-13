"""
Router tests for src/routers/search.py

Covers: GET /api/v1/search/org_slug/{org_slug}
"""

from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient
from fastapi import FastAPI

from src.core.events.database import get_db_session
from src.security.auth import get_current_user
from src.routers.search import router


@pytest.fixture
def app(db, admin_user):
    """Minimal FastAPI app with the search router."""
    app = FastAPI()
    app.include_router(router, prefix="/api/v1/search")
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


class TestSearchRouter:
    """Router-level tests for the search endpoint."""

    @patch(
        "src.services.search.search.search_courses",
        new_callable=AsyncMock,
        return_value=[],
    )
    @patch(
        "src.services.search.search.is_org_member",
        return_value=True,
    )
    async def test_search_returns_200(
        self, mock_is_org_member, mock_search_courses, client, org
    ):
        response = await client.get(
            "/api/v1/search/org_slug/test-org", params={"query": "test"}
        )

        assert response.status_code == 200
        body = response.json()
        assert "courses" in body
        assert "collections" in body
        assert "users" in body

    async def test_search_missing_query_returns_422(self, client, org):
        response = await client.get("/api/v1/search/org_slug/test-org")

        assert response.status_code == 422

    @patch(
        "src.services.search.search.search_courses",
        new_callable=AsyncMock,
        return_value=[],
    )
    @patch(
        "src.services.search.search.is_org_member",
        return_value=True,
    )
    async def test_search_nonexistent_org_returns_empty(
        self, mock_is_org_member, mock_search_courses, client
    ):
        response = await client.get(
            "/api/v1/search/org_slug/fake-org", params={"query": "test"}
        )

        assert response.status_code == 200
        body = response.json()
        assert body["courses"] == []
        assert body["collections"] == []
        assert body["users"] == []
