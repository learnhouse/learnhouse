"""Router tests for src/routers/courses/courses.py."""

import os
import tempfile
import uuid
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.courses.course_updates import CourseUpdateRead
from src.db.courses.courses import CourseRead, FullCourseRead, ThumbnailType
from src.routers.courses.courses import BatchExportRequest, ImportRequest, router as courses_router
from src.security.auth import get_current_user
from src.security.features_utils.dependencies import require_courses_feature
from src.services.courses.transfer.models import ImportAnalysisResponse, ImportCourseInfo, ImportCourseResult, ImportResult


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


def _mock_full_course_read(**overrides) -> FullCourseRead:
    data = dict(
        id=1,
        name="Test Course",
        description="A test course",
        about="About",
        learnings="Things",
        tags="python",
        public=True,
        published=True,
        open_to_contributors=False,
        org_id=1,
        org_uuid="org_test",
        course_uuid="course_test",
        creation_date="2024-01-01",
        update_date="2024-01-01",
        authors=[],
        chapters=[],
        thumbnail_type=ThumbnailType.IMAGE,
        thumbnail_image="",
        thumbnail_video="",
    )
    data.update(overrides)
    return FullCourseRead(**data)


def _mock_course_update_read(**overrides) -> CourseUpdateRead:
    data = dict(
        id=1,
        title="Update",
        content="Update body",
        course_id=1,
        courseupdate_uuid="courseupdate_test",
        linked_activity_uuids=None,
        org_id=1,
        creation_date="2024-01-01",
        update_date="2024-01-01",
    )
    data.update(overrides)
    return CourseUpdateRead(**data)


def _temp_zip_file() -> str:
    handle = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
    handle.write(b"zip-bytes")
    handle.close()
    return handle.name


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


class TestImportExportEndpoints:
    def test_batch_export_request_validation(self):
        too_many_course_uuids = [str(uuid.uuid4()) for _ in range(21)]

        with pytest.raises(ValueError, match="Maximum 20 courses"):
            BatchExportRequest(course_uuids=too_many_course_uuids)

        with pytest.raises(ValueError, match="At least one course UUID"):
            BatchExportRequest(course_uuids=[])

    def test_import_request_validation(self):
        too_many_course_uuids = [str(uuid.uuid4()) for _ in range(21)]

        with pytest.raises(ValueError, match="Maximum 20 courses"):
            ImportRequest(temp_id="temp", course_uuids=too_many_course_uuids)

        with pytest.raises(ValueError, match="At least one course UUID"):
            ImportRequest(temp_id="temp", course_uuids=[])

    async def test_export_courses_batch(self, client):
        zip_path = _temp_zip_file()
        try:
            with patch(
                "src.routers.courses.courses.export_courses_batch",
                new_callable=AsyncMock,
                return_value=zip_path,
            ):
                response = await client.post(
                    "/api/v1/courses/export/batch",
                    json={"course_uuids": ["course_test"]},
                )

            assert response.status_code == 200
            assert response.headers["content-type"].startswith("application/zip")
        finally:
            if os.path.exists(zip_path):
                os.unlink(zip_path)

    async def test_analyze_import_package(self, client):
        mock_result = ImportAnalysisResponse(
            temp_id="temp_1",
            version="1.0.0",
            courses=[ImportCourseInfo(course_uuid="course_test", name="Course")],
        )
        with patch(
            "src.routers.courses.courses.analyze_import_package",
            new_callable=AsyncMock,
            return_value=mock_result,
        ):
            response = await client.post(
                "/api/v1/courses/import/analyze?org_id=1",
                files={"zip_file": ("courses.zip", b"zip-content", "application/zip")},
            )

        assert response.status_code == 200
        assert response.json()["temp_id"] == "temp_1"

    async def test_import_courses(self, client):
        mock_result = ImportResult(
            total_courses=1,
            successful=1,
            failed=0,
            courses=[
                ImportCourseResult(
                    original_uuid="course_old",
                    new_uuid="course_new",
                    name="Imported Course",
                    success=True,
                )
            ],
        )
        with patch(
            "src.routers.courses.courses.import_courses",
            new_callable=AsyncMock,
            return_value=mock_result,
        ):
            response = await client.post(
                "/api/v1/courses/import?org_id=1",
                json={"temp_id": "temp_1", "course_uuids": ["course_old"]},
            )

        assert response.status_code == 200
        assert response.json()["successful"] == 1
        assert response.json()["failed"] == 0

    async def test_export_single_course(self, client):
        zip_path = _temp_zip_file()
        try:
            with patch(
                "src.routers.courses.courses.export_course",
                new_callable=AsyncMock,
                return_value=zip_path,
            ):
                response = await client.get("/api/v1/courses/course_test/export")

            assert response.status_code == 200
            assert response.headers["content-type"] == "application/zip"
        finally:
            if os.path.exists(zip_path):
                os.unlink(zip_path)


class TestCreateCourse:
    async def test_create_course(self, client):
        with patch(
            "src.routers.courses.courses.create_course",
            new_callable=AsyncMock,
            return_value=_mock_course_read(),
        ):
            response = await client.post(
                "/api/v1/courses/?org_id=1",
                data={
                    "name": "Test Course",
                    "description": "A test course",
                    "public": "true",
                    "about": "About",
                    "learnings": "Things",
                    "tags": "python",
                    "thumbnail_type": "image",
                },
            )

        assert response.status_code == 200
        assert response.json()["course_uuid"] == "course_test"


class TestCourseDetailEndpoints:
    async def test_get_course_by_id(self, client):
        with patch(
            "src.routers.courses.courses.get_course_by_id",
            new_callable=AsyncMock,
            return_value=_mock_course_read(),
        ):
            response = await client.get("/api/v1/courses/id/1")

        assert response.status_code == 200
        assert response.json()["id"] == 1

    async def test_get_course_meta(self, client):
        with patch(
            "src.routers.courses.courses.get_course_meta",
            new_callable=AsyncMock,
            return_value=_mock_full_course_read(),
        ):
            response = await client.get(
                "/api/v1/courses/course_test/meta?with_unpublished_activities=true&slim=true"
            )

        assert response.status_code == 200
        assert response.json()["course_uuid"] == "course_test"

    async def test_search_courses(self, client):
        with patch(
            "src.routers.courses.courses.search_courses",
            new_callable=AsyncMock,
            return_value=[_mock_course_read()],
        ):
            response = await client.get(
                "/api/v1/courses/org_slug/test-org/search?query=test&page=1&limit=10"
            )

        assert response.status_code == 200
        assert response.json()[0]["course_uuid"] == "course_test"


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

    async def test_update_course_thumbnail(self, client):
        with patch(
            "src.routers.courses.courses.update_course_thumbnail",
            new_callable=AsyncMock,
            return_value=_mock_course_read(thumbnail_image="updated.png"),
        ):
            response = await client.put(
                "/api/v1/courses/course_test/thumbnail",
                data={"thumbnail_type": "image"},
                files={"thumbnail": ("thumb.png", b"img", "image/png")},
            )

        assert response.status_code == 200
        assert response.json()["thumbnail_image"] == "updated.png"


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

    async def test_clone_course(self, client):
        with patch(
            "src.routers.courses.courses.clone_course",
            new_callable=AsyncMock,
            return_value=_mock_course_read(course_uuid="course_clone"),
        ):
            response = await client.post("/api/v1/courses/course_test/clone")

        assert response.status_code == 200
        assert response.json()["course_uuid"] == "course_clone"


class TestContributorEndpoints:
    async def test_apply_course_contributor(self, client):
        with patch(
            "src.routers.courses.courses.apply_course_contributor",
            new_callable=AsyncMock,
            return_value={"detail": "applied"},
        ):
            response = await client.post("/api/v1/courses/course_test/apply-contributor")

        assert response.status_code == 200
        assert response.json()["detail"] == "applied"

    async def test_get_course_contributors(self, client):
        with patch(
            "src.routers.courses.courses.get_course_contributors",
            new_callable=AsyncMock,
            return_value=[{"user_id": 1}],
        ):
            response = await client.get("/api/v1/courses/course_test/contributors")

        assert response.status_code == 200
        assert response.json()[0]["user_id"] == 1

    async def test_update_course_contributor(self, client):
        with patch(
            "src.routers.courses.courses.update_course_contributor",
            new_callable=AsyncMock,
            return_value={"detail": "updated"},
        ):
            response = await client.put(
                "/api/v1/courses/course_test/contributors/2?authorship=CONTRIBUTOR&authorship_status=ACTIVE"
            )

        assert response.status_code == 200
        assert response.json()["detail"] == "updated"

    async def test_add_bulk_course_contributors(self, client):
        with patch(
            "src.routers.courses.courses.add_bulk_course_contributors",
            new_callable=AsyncMock,
            return_value={"added": 2},
        ):
            response = await client.post(
                "/api/v1/courses/course_test/bulk-add-contributors",
                json=["alice", "bob"],
            )

        assert response.status_code == 200
        assert response.json()["added"] == 2

    async def test_remove_bulk_course_contributors(self, client):
        with patch(
            "src.routers.courses.courses.remove_bulk_course_contributors",
            new_callable=AsyncMock,
            return_value={"removed": 1},
        ):
            response = await client.put(
                "/api/v1/courses/course_test/bulk-remove-contributors",
                json=["alice"],
            )

        assert response.status_code == 200
        assert response.json()["removed"] == 1

    async def test_get_course_user_rights(self, client):
        with patch(
            "src.routers.courses.courses.get_course_user_rights",
            new_callable=AsyncMock,
            return_value={"permissions": {"read": True}},
        ):
            response = await client.get("/api/v1/courses/course_test/rights")

        assert response.status_code == 200
        assert response.json()["permissions"]["read"] is True


class TestCourseUpdateEndpoints:
    async def test_get_course_updates(self, client):
        with patch(
            "src.routers.courses.courses.get_updates_by_course_uuid",
            new_callable=AsyncMock,
            return_value=[_mock_course_update_read()],
        ):
            response = await client.get("/api/v1/courses/course_test/updates")

        assert response.status_code == 200
        assert response.json()[0]["courseupdate_uuid"] == "courseupdate_test"

    async def test_create_course_update(self, client):
        with patch(
            "src.routers.courses.courses.create_update",
            new_callable=AsyncMock,
            return_value=_mock_course_update_read(),
        ):
            response = await client.post(
                "/api/v1/courses/course_test/updates",
                json={"title": "Update", "content": "Body", "org_id": 1},
            )

        assert response.status_code == 200
        assert response.json()["title"] == "Update"

    async def test_update_course_update(self, client):
        with patch(
            "src.routers.courses.courses.update_update",
            new_callable=AsyncMock,
            return_value=_mock_course_update_read(title="Updated"),
        ):
            response = await client.put(
                "/api/v1/courses/course_test/update/courseupdate_test",
                json={"title": "Updated"},
            )

        assert response.status_code == 200
        assert response.json()["title"] == "Updated"

    async def test_delete_course_update(self, client):
        with patch(
            "src.routers.courses.courses.delete_update",
            new_callable=AsyncMock,
            return_value={"detail": "deleted"},
        ):
            response = await client.delete(
                "/api/v1/courses/course_test/update/courseupdate_test"
            )

        assert response.status_code == 200
        assert response.json()["detail"] == "deleted"
