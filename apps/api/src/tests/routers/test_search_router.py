"""
Router tests for src/routers/search.py

Covers: GET /api/v1/search/org_slug/{org_slug}
"""

from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient
from fastapi import FastAPI

from src.core.events.database import get_db_session
from src.db.users import AnonymousUser
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

    @pytest.fixture(autouse=True)
    def _bypass_search_rate_limit(self):
        with patch(
            "src.routers.search.check_search_rate_limit",
            return_value=(True, 0),
        ):
            yield

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
        assert "folders" in body
        assert "users" in body

    @patch(
        "src.services.search.search.search_courses",
        new_callable=AsyncMock,
        return_value=[],
    )
    @patch(
        "src.services.search.search.is_org_member",
        return_value=True,
    )
    @patch("src.routers.search.get_client_ip", return_value="9.9.9.9")
    @patch(
        "src.routers.search.check_rate_limit",
        return_value=(True, 1, 0),
    )
    async def test_anonymous_caller_uses_ip_throttle(
        self,
        mock_check_rate_limit,
        mock_get_client_ip,
        mock_is_org_member,
        mock_search_courses,
        app,
        client,
        org,
    ):
        # Anonymous (id-less) callers fall through to the IP-keyed throttle
        # branch instead of the per-user search rate limit.
        app.dependency_overrides[get_current_user] = lambda: AnonymousUser()
        response = await client.get(
            "/api/v1/search/org_slug/test-org", params={"query": "test"}
        )

        assert response.status_code == 200
        mock_get_client_ip.assert_called_once()
        mock_check_rate_limit.assert_called_once()
        # IP-keyed throttle, not the per-user search limit.
        _, kwargs = mock_check_rate_limit.call_args
        assert kwargs["key"] == "search_anon:9.9.9.9"
        assert kwargs["max_attempts"] == 30
        assert kwargs["window_seconds"] == 60

    @patch("src.routers.search.get_client_ip", return_value="9.9.9.9")
    @patch(
        "src.routers.search.check_rate_limit",
        return_value=(False, 31, 42),
    )
    async def test_anonymous_caller_rate_limited_returns_429(
        self,
        mock_check_rate_limit,
        mock_get_client_ip,
        app,
        client,
        org,
    ):
        # When the IP throttle is exhausted the endpoint raises 429 with a
        # Retry-After header.
        app.dependency_overrides[get_current_user] = lambda: AnonymousUser()
        response = await client.get(
            "/api/v1/search/org_slug/test-org", params={"query": "test"}
        )

        assert response.status_code == 429
        assert response.headers.get("Retry-After") == "42"
        assert "Too many search queries" in response.json()["detail"]

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
        assert body["folders"] == []
        assert body["users"] == []
