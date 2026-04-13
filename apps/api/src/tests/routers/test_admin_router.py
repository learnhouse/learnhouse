"""Router tests for src/routers/admin.py."""

from contextlib import contextmanager
from unittest.mock import AsyncMock, Mock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.courses.courses import CourseRead, FullCourseRead, ThumbnailType
from src.db.resource_authors import (
    ResourceAuthorshipEnum,
    ResourceAuthorshipStatusEnum,
)
from src.db.trails import TrailRead
from src.db.users import APITokenUser, UserRead
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


def _mock_user(**overrides) -> UserRead:
    data = dict(
        id=2,
        username="learners",
        first_name="Learner",
        last_name="User",
        email="learner@test.com",
        user_uuid="user_2",
        email_verified=True,
        avatar_image="",
        bio="",
    )
    data.update(overrides)
    return UserRead(**data)


def _mock_author(**overrides):
    data = dict(
        user=_mock_user(),
        authorship=ResourceAuthorshipEnum.CREATOR,
        authorship_status=ResourceAuthorshipStatusEnum.ACTIVE,
        creation_date="2024-01-01",
        update_date="2024-01-01",
    )
    data.update(overrides)
    return data


def _mock_course(**overrides) -> CourseRead:
    data = dict(
        id=1,
        org_id=1,
        name="Course",
        description="Desc",
        about="About",
        learnings="Learn",
        tags="tag1",
        public=True,
        published=True,
        open_to_contributors=False,
        authors=[_mock_author()],
        course_uuid="course_1",
        creation_date="2024-01-01",
        update_date="2024-01-02",
        thumbnail_type=ThumbnailType.IMAGE,
        thumbnail_image="",
        thumbnail_video="",
        seo=None,
    )
    data.update(overrides)
    return CourseRead(**data)


def _mock_full_course(**overrides) -> FullCourseRead:
    data = dict(
        id=1,
        org_id=1,
        org_uuid="org_1",
        name="Course",
        description="Desc",
        about="About",
        learnings="Learn",
        tags="tag1",
        public=True,
        published=True,
        open_to_contributors=False,
        authors=[_mock_author()],
        chapters=[],
        course_uuid="course_1",
        creation_date="2024-01-01",
        update_date="2024-01-02",
        thumbnail_type=ThumbnailType.IMAGE,
        thumbnail_image="",
        thumbnail_video="",
        seo=None,
    )
    data.update(overrides)
    return FullCourseRead(**data)


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
    async def test_auth_and_user_endpoints(self, client, api_user):
        with _admin_context(api_user), patch(
            "src.routers.admin.issue_user_token",
            new_callable=AsyncMock,
            return_value=_mock_token_response(),
        ):
            response = await client.post("/api/v1/admin/acme/auth/token", json={"user_id": 2})
        assert response.status_code == 200
        assert response.json()["access_token"] == "issued-token"

        with _admin_context(api_user), patch(
            "src.routers.admin.list_users",
            new_callable=AsyncMock,
            return_value=[_mock_user()],
        ):
            response = await client.get("/api/v1/admin/acme/users")
        assert response.status_code == 200
        assert response.json()[0]["user_uuid"] == "user_2"

        with _admin_context(api_user), patch(
            "src.routers.admin.get_user",
            new_callable=AsyncMock,
            return_value=_mock_user(user_uuid="user_profile"),
        ):
            response = await client.get("/api/v1/admin/acme/users/2")
        assert response.status_code == 200
        assert response.json()["user_uuid"] == "user_profile"

        with _admin_context(api_user), patch(
            "src.routers.admin.get_user_courses",
            new_callable=AsyncMock,
            return_value=[_mock_course(course_uuid="course_user")],
        ):
            response = await client.get("/api/v1/admin/acme/users/2/courses")
        assert response.status_code == 200
        assert response.json()[0]["course_uuid"] == "course_user"

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

    async def test_course_collection_and_content_endpoints(self, client, api_user):
        with _admin_context(api_user), patch(
            "src.routers.admin.list_courses",
            new_callable=AsyncMock,
            return_value=[_mock_course()],
        ):
            response = await client.get("/api/v1/admin/acme/courses")
        assert response.status_code == 200
        assert response.json()[0]["course_uuid"] == "course_1"

        with _admin_context(api_user), patch(
            "src.routers.admin.get_course",
            new_callable=AsyncMock,
            return_value=_mock_course(course_uuid="course_detail"),
        ):
            response = await client.get("/api/v1/admin/acme/courses/course_detail")
        assert response.status_code == 200
        assert response.json()["course_uuid"] == "course_detail"

        with _admin_context(api_user), patch(
            "src.routers.admin.get_course_structure",
            new_callable=AsyncMock,
            return_value=_mock_full_course(),
        ):
            response = await client.get("/api/v1/admin/acme/courses/course_1/structure")
        assert response.status_code == 200
        assert response.json()["chapters"] == []

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

        with _admin_context(api_user), patch(
            "src.routers.admin.list_collections",
            new_callable=AsyncMock,
            return_value=[{"collection_uuid": "collection_1", "name": "Collection", "courses": []}],
        ):
            response = await client.get("/api/v1/admin/acme/collections")
        assert response.status_code == 200
        assert response.json()[0]["collection_uuid"] == "collection_1"

        with _admin_context(api_user), patch(
            "src.routers.admin.get_collection",
            new_callable=AsyncMock,
            return_value={"collection_uuid": "collection_1", "name": "Collection", "courses": []},
        ):
            response = await client.get("/api/v1/admin/acme/collections/collection_1")
        assert response.status_code == 200
        assert response.json()["name"] == "Collection"

        with _admin_context(api_user), patch(
            "src.routers.admin.get_chapter",
            new_callable=AsyncMock,
            return_value={"id": 1, "chapter_uuid": "chapter_1", "name": "Chapter"},
        ):
            response = await client.get("/api/v1/admin/acme/chapters/1")
        assert response.status_code == 200
        assert response.json()["chapter_uuid"] == "chapter_1"

        with _admin_context(api_user), patch(
            "src.routers.admin.get_activity",
            new_callable=AsyncMock,
            return_value={"id": 1, "activity_uuid": "activity_1", "name": "Activity"},
        ):
            response = await client.get("/api/v1/admin/acme/activities/activity_1")
        assert response.status_code == 200
        assert response.json()["activity_uuid"] == "activity_1"

        with _admin_context(api_user), patch(
            "src.routers.admin.get_chapter_activities",
            new_callable=AsyncMock,
            return_value=[{"id": 1, "activity_uuid": "activity_1", "name": "Activity"}],
        ):
            response = await client.get("/api/v1/admin/acme/chapters/1/activities")
        assert response.status_code == 200
        assert response.json()[0]["activity_uuid"] == "activity_1"

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
