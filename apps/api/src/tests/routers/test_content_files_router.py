"""Router tests for src/routers/content_files.py."""

from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.courses.courses import Course
from src.db.users import AnonymousUser
from src.routers.content_files import router as content_files_router
from src.security.auth import get_current_user


@pytest.fixture
def app(db, admin_user):
    app = FastAPI()
    app.include_router(content_files_router)
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


class _Body:
    def __init__(self, data: bytes):
        self._data = data

    def read(self):
        return self._data


class _S3Client:
    def __init__(self, payload: bytes = b"abcdef"):
        self.payload = payload

    def head_object(self, Bucket, Key):
        return {"ContentLength": len(self.payload)}

    def get_object(self, Bucket, Key, Range):
        start_end = Range.replace("bytes=", "").split("-")
        start = int(start_end[0])
        end = int(start_end[1])
        return {"Body": _Body(self.payload[start : end + 1])}


class TestContentFilesRouter:
    async def test_stream_full_and_range_content(
        self, client, db, org, course
    ):
        s3_client = _S3Client(b"abcdef")
        from src.routers import content_files

        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(content_files, "get_storage_client", lambda: s3_client)
            mp.setattr(content_files, "get_s3_bucket_name", lambda: "bucket")
            full_response = await client.get(
                f"/content/orgs/{org.org_uuid}/courses/{course.course_uuid}/thumb.png"
            )
            range_response = await client.get(
                f"/content/orgs/{org.org_uuid}/courses/{course.course_uuid}/thumb.png",
                headers={"range": "bytes=1-3"},
            )
            suffix_range_response = await client.get(
                f"/content/orgs/{org.org_uuid}/courses/{course.course_uuid}/thumb.png",
                headers={"range": "bytes=-2"},
            )

        assert full_response.status_code == 200
        assert full_response.content == b"abcdef"
        assert range_response.status_code == 206
        assert range_response.content == b"bcd"
        assert range_response.headers["content-range"] == "bytes 1-3/6"
        assert suffix_range_response.status_code == 206
        assert suffix_range_response.content == b"ef"

    async def test_head_and_invalid_path_handling(self, client):
        from src.routers import content_files

        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(content_files, "get_storage_client", lambda: _S3Client())
            mp.setattr(content_files, "get_s3_bucket_name", lambda: "bucket")
            head_response = await client.head("/content/users/u/avatar.png")
            bad_path_response = await client.get("/content/%2E%2E/secrets.txt")

        assert head_response.status_code == 200
        assert head_response.headers["content-length"] == "6"
        assert bad_path_response.status_code == 400

    async def test_private_course_requires_auth_and_storage_configuration(
        self, client, db, org, app
    ):
        course = Course(
            id=30,
            name="Private S3 Course",
            description="Desc",
            public=False,
            published=True,
            open_to_contributors=False,
            org_id=org.id,
            course_uuid="course_private_s3",
            creation_date="2024-01-01",
            update_date="2024-01-01",
        )
        db.add(course)
        db.commit()

        from src.routers import content_files

        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(content_files, "get_s3_bucket_name", lambda: "bucket")
            app.dependency_overrides[get_current_user] = lambda: AnonymousUser()
            anon_response = await client.get(
                f"/content/orgs/{org.org_uuid}/courses/{course.course_uuid}/activities/activity_x/video.mp4"
            )

            app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id=1)
            mp.setattr(content_files, "get_storage_client", lambda: None)
            no_storage_response = await client.get(
                f"/content/orgs/{org.org_uuid}/courses/{course.course_uuid}/thumb.png"
            )

        assert anon_response.status_code == 401
        assert no_storage_response.status_code == 500
