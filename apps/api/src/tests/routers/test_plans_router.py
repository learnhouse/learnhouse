"""Router tests for src/routers/plans.py."""

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.routers.plans import router as plans_router


@pytest.fixture
def app():
    app = FastAPI()
    app.include_router(plans_router, prefix="/api/v1/plans")
    return app


@pytest.fixture
async def client(app):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


class TestPlansRouter:
    async def test_get_plan_limits(self, client):
        response = await client.get("/api/v1/plans")

        assert response.status_code == 200
        body = response.json()
        assert "free" in body
        assert "ai_credits" in body["free"]
        assert "courses" in body["free"]
