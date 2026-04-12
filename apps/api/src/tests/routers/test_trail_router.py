"""Router tests for src/routers/trail.py."""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.trails import TrailRead
from src.routers.trail import router as trail_router
from src.security.auth import get_current_user
from src.security.features_utils.dependencies import require_courses_feature


@pytest.fixture
def app(db, admin_user):
    app = FastAPI()
    app.include_router(trail_router, prefix="/api/v1/trail")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: admin_user
    app.dependency_overrides[require_courses_feature] = lambda: True
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


def _mock_trail(**overrides) -> TrailRead:
    data = dict(
        id=1,
        trail_uuid="trail_test",
        org_id=1,
        user_id=1,
        creation_date="2024-01-01",
        update_date="2024-01-01",
        runs=[],
    )
    data.update(overrides)
    return TrailRead(**data)


class TestTrailRouter:
    async def test_trail_endpoints(self, client):
        with patch("src.routers.trail.create_user_trail", new_callable=AsyncMock, return_value=_mock_trail()):
            response = await client.post("/api/v1/trail/start", json={"org_id": 1, "user_id": 1})
        assert response.status_code == 200

        with patch("src.routers.trail.get_user_trails", new_callable=AsyncMock, return_value=_mock_trail()):
            response = await client.get("/api/v1/trail/")
        assert response.status_code == 200

        with patch("src.routers.trail.get_user_trail_with_orgid", new_callable=AsyncMock, return_value=_mock_trail()):
            response = await client.get("/api/v1/trail/org/1/trail")
        assert response.status_code == 200

        with patch("src.routers.trail.add_course_to_trail", new_callable=AsyncMock, return_value=_mock_trail()):
            response = await client.post("/api/v1/trail/add_course/course_test")
        assert response.status_code == 200

        with patch("src.routers.trail.remove_course_from_trail", new_callable=AsyncMock, return_value=_mock_trail()):
            response = await client.delete("/api/v1/trail/remove_course/course_test")
        assert response.status_code == 200

        with patch("src.routers.trail.add_activity_to_trail", new_callable=AsyncMock, return_value=_mock_trail()):
            response = await client.post("/api/v1/trail/add_activity/activity_test")
        assert response.status_code == 200

        with patch("src.routers.trail.remove_activity_from_trail", new_callable=AsyncMock, return_value=_mock_trail()):
            response = await client.delete("/api/v1/trail/remove_activity/activity_test")
        assert response.status_code == 200
