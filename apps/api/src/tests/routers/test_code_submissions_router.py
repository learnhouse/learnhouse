"""Router tests for src/routers/code_submissions.py."""

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.users import AnonymousUser
from src.routers.code_submissions import router as code_submissions_router
from src.security.auth import get_current_user


@pytest.fixture
def app(db, admin_user):
    app = FastAPI()
    app.include_router(code_submissions_router, prefix="/api/v1/code/submissions")
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


class TestCodeSubmissionsRouter:
    async def test_save_and_history_submission(self, client):
        body = {
            "activity_uuid": "activity_test",
            "block_id": "block_1",
            "language_id": 1,
            "source_code": "print('hello')",
            "results": {"stdout": "hello"},
            "passed": True,
            "total_tests": 1,
            "passed_tests": 1,
            "execution_time_ms": 12,
        }

        response = await client.post(
            "/api/v1/code/submissions/save",
            json=body,
        )
        assert response.status_code == 200
        assert response.json()["source_code"] == body["source_code"]

        response = await client.get(
            "/api/v1/code/submissions/history",
            params={"activity_uuid": body["activity_uuid"], "block_id": body["block_id"]},
        )
        assert response.status_code == 200
        payload = response.json()
        assert payload["total"] == 1
        assert payload["submissions"][0]["source_code"] == body["source_code"]

    async def test_code_submissions_require_authentication(self, app, client):
        app.dependency_overrides[get_current_user] = lambda: AnonymousUser()

        response = await client.post(
            "/api/v1/code/submissions/save",
            json={
                "activity_uuid": "activity_test",
                "block_id": "block_1",
                "language_id": 1,
                "source_code": "print('hello')",
                "results": {},
                "passed": True,
                "total_tests": 1,
                "passed_tests": 1,
            },
        )
        assert response.status_code == 401

        response = await client.get(
            "/api/v1/code/submissions/history",
            params={"activity_uuid": "activity_test", "block_id": "block_1"},
        )
        assert response.status_code == 401

