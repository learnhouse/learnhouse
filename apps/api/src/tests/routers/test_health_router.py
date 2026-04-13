"""
Router tests for src/routers/health.py

Covers: GET /api/v1/health
"""

import pytest
from httpx import ASGITransport, AsyncClient
from fastapi import FastAPI

from src.core.events.database import get_db_session
from src.routers.health import router


@pytest.fixture
def app(db):
    """Minimal FastAPI app with the health router."""
    app = FastAPI()
    app.include_router(router, prefix="/api/v1/health")
    app.dependency_overrides[get_db_session] = lambda: db
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


class TestHealthRouter:
    """Router-level tests for the health endpoint."""

    async def test_health_endpoint_returns_true(self, client):
        response = await client.get("/api/v1/health")

        assert response.status_code == 200
        assert response.json() is True
