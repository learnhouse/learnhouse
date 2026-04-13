"""Router tests for src/routers/local_content.py."""

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.courses.courses import Course
from src.db.podcasts.podcasts import Podcast
from src.db.user_organizations import UserOrganization
from src.db.users import APITokenUser, AnonymousUser
from src.routers.local_content import router as local_content_router
from src.security.auth import get_current_user


@pytest.fixture
def app(db, admin_user):
    app = FastAPI()
    app.include_router(local_content_router)
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


class TestLocalContentRouter:
    async def test_get_and_head_local_content_success(
        self, client, db, org, course, admin_user, app, tmp_path
    ):
        content_root = tmp_path / "content"
        file_path = content_root / "orgs" / org.org_uuid / "courses" / course.course_uuid / "thumb.png"
        file_path.parent.mkdir(parents=True)
        file_path.write_bytes(b"png")

        from src.routers import local_content

        original_dir = local_content.CONTENT_DIR
        local_content.CONTENT_DIR = content_root
        try:
            get_response = await client.get(
                f"/content/orgs/{org.org_uuid}/courses/{course.course_uuid}/thumb.png"
            )
            head_response = await client.head(
                f"/content/orgs/{org.org_uuid}/courses/{course.course_uuid}/thumb.png"
            )
        finally:
            local_content.CONTENT_DIR = original_dir

        assert get_response.status_code == 200
        assert get_response.content == b"png"
        assert head_response.status_code == 200
        assert head_response.headers["content-type"] == "image/png"
        assert head_response.headers["content-length"] == "3"

    async def test_private_course_activity_requires_membership(
        self, client, db, org, regular_user, anonymous_user, app, tmp_path
    ):
        course = Course(
            id=10,
            name="Private Course",
            description="Desc",
            public=False,
            published=True,
            open_to_contributors=False,
            org_id=org.id,
            course_uuid="course_private_local",
            creation_date="2024-01-01",
            update_date="2024-01-01",
        )
        db.add(course)
        db.commit()

        content_root = tmp_path / "content"
        file_path = (
            content_root
            / "orgs"
            / org.org_uuid
            / "courses"
            / course.course_uuid
            / "activities"
            / "activity_x"
            / "video.mp4"
        )
        file_path.parent.mkdir(parents=True)
        file_path.write_bytes(b"video")

        from src.routers import local_content

        original_dir = local_content.CONTENT_DIR
        local_content.CONTENT_DIR = content_root
        try:
            app.dependency_overrides[get_current_user] = lambda: AnonymousUser()
            anon_response = await client.get(
                f"/content/orgs/{org.org_uuid}/courses/{course.course_uuid}/activities/activity_x/video.mp4"
            )

            app.dependency_overrides[get_current_user] = lambda: regular_user.model_copy(update={"id": 222})
            forbidden_response = await client.get(
                f"/content/orgs/{org.org_uuid}/courses/{course.course_uuid}/activities/activity_x/video.mp4"
            )

            db.add(
                UserOrganization(
                    user_id=regular_user.id,
                    org_id=org.id,
                    role_id=1,
                    creation_date="2024-01-01",
                    update_date="2024-01-01",
                )
            )
            db.commit()
            app.dependency_overrides[get_current_user] = lambda: regular_user
            ok_response = await client.get(
                f"/content/orgs/{org.org_uuid}/courses/{course.course_uuid}/activities/activity_x/video.mp4"
            )
        finally:
            local_content.CONTENT_DIR = original_dir

        assert anon_response.status_code == 401
        assert forbidden_response.status_code == 403
        assert ok_response.status_code == 200
        assert ok_response.headers["content-type"] == "video/mp4"

    async def test_api_token_scope_and_invalid_paths(
        self, client, db, org, other_org, app, tmp_path
    ):
        podcast = Podcast(
            id=20,
            name="Private Podcast",
            description="Desc",
            public=False,
            published=True,
            org_id=org.id,
            podcast_uuid="podcast_private_local",
            creation_date="2024-01-01",
            update_date="2024-01-01",
        )
        db.add(podcast)
        db.commit()

        content_root = tmp_path / "content"
        file_path = (
            content_root
            / "orgs"
            / org.org_uuid
            / "podcasts"
            / podcast.podcast_uuid
            / "episodes"
            / "episode_x"
            / "audio.mp3"
        )
        file_path.parent.mkdir(parents=True)
        file_path.write_bytes(b"audio")

        from src.routers import local_content

        original_dir = local_content.CONTENT_DIR
        local_content.CONTENT_DIR = content_root
        try:
            wrong_token = APITokenUser(org_id=other_org.id, created_by_user_id=1)
            app.dependency_overrides[get_current_user] = lambda: wrong_token
            forbidden_response = await client.get(
                f"/content/orgs/{org.org_uuid}/podcasts/{podcast.podcast_uuid}/episodes/episode_x/audio.mp3"
            )

            correct_token = APITokenUser(org_id=org.id, created_by_user_id=1)
            app.dependency_overrides[get_current_user] = lambda: correct_token
            ok_response = await client.get(
                f"/content/orgs/{org.org_uuid}/podcasts/{podcast.podcast_uuid}/episodes/episode_x/audio.mp3"
            )

            app.dependency_overrides[get_current_user] = lambda: AnonymousUser()
            invalid_path_response = await client.get("/content/%2E%2E/secret.txt")
            missing_file_response = await client.head("/content/users/user_x/avatar.png")
        finally:
            local_content.CONTENT_DIR = original_dir

        assert forbidden_response.status_code == 403
        assert ok_response.status_code == 200
        assert invalid_path_response.status_code == 400
        assert missing_file_response.status_code == 404
