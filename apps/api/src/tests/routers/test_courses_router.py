"""
Router tests for src/routers/courses/courses.py

Uses httpx AsyncClient with a minimal FastAPI app containing only the
courses router. Service functions are patched at the router import level
to avoid deep dependency chains (RBAC, storage, webhooks, etc.).
"""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.courses.courses import CourseRead
from src.routers.courses.courses import router as courses_router
from src.security.auth import get_current_user
from src.security.features_utils.dependencies import require_courses_feature


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def app(db, admin_user):
    app = FastAPI()
    app.include_router(courses_router, prefix="/api/v1/courses")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: admin_user
    app.dependency_overrides[require_courses_feature] = lambda: True
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


def _mock_course_read(**overrides) -> CourseRead:
    """Build a minimal CourseRead for mocked service returns."""
    data = dict(
        id=1,
        name="Test Course",
        description="A test course",
        public=True,
        published=True,
        open_to_contributors=False,
        org_id=1,
        course_uuid="course_test",
        creation_date="2024-01-01",
        update_date="2024-01-01",
        authors=[],
    )
    data.update(overrides)
    return CourseRead(**data)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestGetCourse:
    async def test_get_course(self, client):
        mock_return = _mock_course_read()
        with patch(
            "src.routers.courses.courses.get_course",
            new_callable=AsyncMock,
            return_value=mock_return,
        ):
            response = await client.get("/api/v1/courses/course_test")

        assert response.status_code == 200
        body = response.json()
        assert body["course_uuid"] == "course_test"
        assert body["name"] == "Test Course"

    async def test_get_course_not_found(self, client):
        with patch(
            "src.routers.courses.courses.get_course",
            new_callable=AsyncMock,
            side_effect=HTTPException(status_code=404, detail="Course not found"),
        ):
            response = await client.get("/api/v1/courses/fake")

        assert response.status_code == 404


class TestGetCoursesByOrgSlug:
    async def test_get_courses_by_orgslug(self, client):
        mock_return = [_mock_course_read()]
        with patch(
            "src.routers.courses.courses.get_courses_orgslug",
            new_callable=AsyncMock,
            return_value=mock_return,
        ):
            response = await client.get(
                "/api/v1/courses/org_slug/test-org/page/1/limit/10"
            )

        assert response.status_code == 200
        body = response.json()
        assert isinstance(body, list)
        assert len(body) == 1
        assert body[0]["course_uuid"] == "course_test"


class TestGetCoursesCount:
    async def test_get_courses_count(self, client):
        with patch(
            "src.routers.courses.courses.get_courses_count_orgslug",
            new_callable=AsyncMock,
            return_value=5,
        ):
            response = await client.get(
                "/api/v1/courses/org_slug/test-org/count"
            )

        assert response.status_code == 200
        assert response.json() == 5


class TestUpdateCourse:
    async def test_update_course(self, client):
        updated = _mock_course_read(name="Updated Course")
        with patch(
            "src.routers.courses.courses.update_course",
            new_callable=AsyncMock,
            return_value=updated,
        ):
            response = await client.put(
                "/api/v1/courses/course_test",
                json={"name": "Updated Course"},
            )

        assert response.status_code == 200
        assert response.json()["name"] == "Updated Course"


class TestDeleteCourse:
    async def test_delete_course(self, client):
        with patch(
            "src.routers.courses.courses.delete_course",
            new_callable=AsyncMock,
            return_value={"detail": "Course deleted"},
        ):
            response = await client.delete("/api/v1/courses/course_test")

        assert response.status_code == 200
        assert response.json()["detail"] == "Course deleted"
