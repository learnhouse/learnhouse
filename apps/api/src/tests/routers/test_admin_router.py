"""Router tests for src/routers/admin.py."""

from contextlib import contextmanager
from unittest.mock import AsyncMock, Mock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.trails import TrailRead
from src.db.users import APITokenUser
from src.routers.admin import router as admin_router
from src.security.auth import get_current_user


@pytest.fixture
def api_user():
    return APITokenUser(
        id=11,
        user_uuid="token_user",
        username="api_token",
        org_id=1,
        rights={"users": {"action_read": True}, "courses": {"action_read": True}},
        token_name="admin-token",
        created_by_user_id=99,
    )


@pytest.fixture
def db_session():
    session = Mock()
    session.exec.return_value.all.return_value = []
    session.exec.return_value.first.return_value = None
    return session


@pytest.fixture
def app(db_session, api_user):
    app = FastAPI()
    app.include_router(admin_router, prefix="/api/v1/admin")
    app.dependency_overrides[get_db_session] = lambda: db_session
    app.dependency_overrides[get_current_user] = lambda: api_user
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


def _mock_trail(**overrides) -> TrailRead:
    data = dict(
        id=1,
        trail_uuid="trail_1",
        org_id=1,
        user_id=2,
        creation_date="2024-01-01",
        update_date="2024-01-01",
        runs=[],
    )
    data.update(overrides)
    return TrailRead(**data)


def _mock_token_response(**overrides):
    data = dict(
        access_token="issued-token",
        token_type="bearer",
        user_id=2,
        user_uuid="user_2",
    )
    data.update(overrides)
    return data


@contextmanager
def _admin_context(api_user):
    with (
        patch("src.routers.admin._require_api_token", return_value=api_user),
        patch("src.routers.admin._resolve_org_slug", return_value=None),
    ):
        yield


class TestAdminRouter:
    async def test_auth_progress_and_certifications(self, client, api_user):
        """The auth/token, aggregate progress, and certificates endpoints all
        operate on a single user_id and are grouped here for a smoke check."""
        with _admin_context(api_user), patch(
            "src.routers.admin.issue_user_token",
            new_callable=AsyncMock,
            return_value=_mock_token_response(),
        ):
            response = await client.post("/api/v1/admin/acme/auth/token", json={"user_id": 2})
        assert response.status_code == 200
        assert response.json()["access_token"] == "issued-token"

        with _admin_context(api_user), patch(
            "src.routers.admin.get_all_user_progress",
            new_callable=AsyncMock,
            return_value=[
                {
                    "course_uuid": "course_1",
                    "course_name": "Course",
                    "status": "STATUS_IN_PROGRESS",
                    "total_activities": 5,
                    "completed_activities": 2,
                    "completion_percentage": 40.0,
                    "enrolled_at": "2024-01-01",
                }
            ],
        ):
            response = await client.get("/api/v1/admin/acme/progress/2")
        assert response.status_code == 200
        assert response.json()[0]["course_uuid"] == "course_1"

        with _admin_context(api_user), patch(
            "src.routers.admin.get_user_certificates",
            new_callable=AsyncMock,
            return_value=[
                {
                    "certificate_user": {"id": 1},
                    "certification": {"id": 2},
                    "course": {
                        "id": 1,
                        "course_uuid": "course_1",
                        "name": "Course",
                        "description": "Desc",
                        "thumbnail_image": "",
                    },
                }
            ],
        ):
            response = await client.get("/api/v1/admin/acme/certifications/2")
        assert response.status_code == 200
        assert response.json()[0]["course"]["course_uuid"] == "course_1"

    async def test_check_course_access(self, client, api_user):
        with _admin_context(api_user), patch(
            "src.routers.admin.check_course_access",
            new_callable=AsyncMock,
            return_value={
                "has_access": True,
                "is_enrolled": True,
                "is_public": True,
                "is_published": True,
            },
        ):
            response = await client.get("/api/v1/admin/acme/courses/course_1/access/2")
        assert response.status_code == 200
        assert response.json()["has_access"] is True

    async def test_enrollment_and_progress_endpoints(self, client, api_user):
        with _admin_context(api_user), patch(
            "src.routers.admin.enroll_user",
            new_callable=AsyncMock,
            return_value=_mock_trail(),
        ):
            response = await client.post("/api/v1/admin/acme/enrollments/2/course_1")
        assert response.status_code == 200
        assert response.json()["trail_uuid"] == "trail_1"

        with _admin_context(api_user), patch(
            "src.routers.admin.unenroll_user",
            new_callable=AsyncMock,
            return_value={"detail": "Unenrolled"},
        ):
            response = await client.delete("/api/v1/admin/acme/enrollments/2/course_1")
        assert response.status_code == 200
        assert response.json()["detail"] == "Unenrolled"

        with _admin_context(api_user), patch(
            "src.routers.admin.get_user_enrollments",
            new_callable=AsyncMock,
            return_value=_mock_trail(trail_uuid="trail_user_enrollments"),
        ):
            response = await client.get("/api/v1/admin/acme/enrollments/2")
        assert response.status_code == 200
        assert response.json()["trail_uuid"] == "trail_user_enrollments"

        with _admin_context(api_user), patch(
            "src.routers.admin.get_user_progress",
            new_callable=AsyncMock,
            return_value={
                "course_uuid": "course_1",
                "user_id": 2,
                "total_activities": 10,
                "completed_activities": 3,
                "completion_percentage": 30.0,
                "completed_activity_ids": [1, 2, 3],
            },
        ):
            response = await client.get("/api/v1/admin/acme/progress/2/course_1")
        assert response.status_code == 200
        assert response.json()["completed_activities"] == 3

        with _admin_context(api_user), patch(
            "src.routers.admin.complete_activity",
            new_callable=AsyncMock,
            return_value={
                "activity_uuid": "activity_1",
                "user_id": 2,
                "completed": True,
                "is_new_completion": True,
                "course_completed": False,
            },
        ):
            response = await client.post("/api/v1/admin/acme/progress/2/activities/activity_1/complete")
        assert response.status_code == 200
        assert response.json()["activity_uuid"] == "activity_1"

        with _admin_context(api_user), patch(
            "src.routers.admin.uncomplete_activity",
            new_callable=AsyncMock,
            return_value={"activity_uuid": "activity_1", "user_id": 2, "completed": False},
        ):
            response = await client.delete("/api/v1/admin/acme/progress/2/activities/activity_1/complete")
        assert response.status_code == 200
        assert response.json()["completed"] is False

        with _admin_context(api_user), patch(
            "src.routers.admin.complete_course",
            new_callable=AsyncMock,
            return_value={
                "course_uuid": "course_1",
                "user_id": 2,
                "completed_count": 5,
                "already_completed_count": 0,
                "total_activities": 5,
                "course_completed": True,
                "certificate_awarded": True,
            },
        ):
            response = await client.post("/api/v1/admin/acme/progress/2/course_1/complete")
        assert response.status_code == 200
        assert response.json()["certificate_awarded"] is True
