"""Router tests for src/routers/local_content.py."""

from unittest.mock import patch

import pytest
from fastapi import HTTPException, FastAPI
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

    async def test_helper_branches_and_missing_file_routes(
        self, client, db, org, course, regular_user, anonymous_user, tmp_path
    ):
        from src.routers import local_content

        original_dir = local_content.CONTENT_DIR
        local_content.CONTENT_DIR = tmp_path / "content"
        try:
            assert local_content._validate_content_path("../escape") is None
            assert local_content._validate_content_path("/absolute/path") is None
            assert local_content._validate_content_path("foo\\..\\bar") is None
            assert local_content._validate_content_path("foo\x00bar") is None

            with patch("src.routers.local_content.os.path.realpath", side_effect=OSError("boom")):
                assert local_content._validate_content_path("orgs/x/file.txt") is None

            with patch(
                "src.routers.local_content.os.path.realpath",
                side_effect=[
                    str(tmp_path / "content"),
                    str(tmp_path / "outside" / "file.txt"),
                ],
            ):
                assert local_content._validate_content_path("orgs/x/file.txt") is None

            private_course = Course(
                id=50,
                name="Private Course",
                description="Desc",
                public=False,
                published=True,
                open_to_contributors=False,
                org_id=org.id,
                course_uuid="course_private_router",
                creation_date="2024-01-01",
                update_date="2024-01-01",
            )
            db.add(private_course)
            db.commit()

            public_podcast = Podcast(
                id=52,
                name="Public Podcast",
                description="Desc",
                public=True,
                published=True,
                org_id=org.id,
                podcast_uuid="podcast_public_router",
                creation_date="2024-01-01",
                update_date="2024-01-01",
            )
            private_podcast = Podcast(
                id=51,
                name="Private Podcast",
                description="Desc",
                public=False,
                published=True,
                org_id=org.id,
                podcast_uuid="podcast_private_router",
                creation_date="2024-01-01",
                update_date="2024-01-01",
            )
            db.add(public_podcast)
            db.add(private_podcast)
            db.commit()

            assert (
                local_content._check_content_access(
                    "orgs/org_test/courses/course_test/activities/activity_test/file.txt",
                    anonymous_user,
                    db,
                )
                is None
            )
            assert (
                local_content._check_content_access(
                    "orgs/org_test/podcasts/podcast_public_router/episodes/episode_1/file.txt",
                    anonymous_user,
                    db,
                )
                is None
            )
            assert (
                local_content._check_content_access(
                    "orgs/org_test/courses/course_test/activities/activity_test/file.txt",
                    regular_user,
                    db,
                )
            ) is None

            assert (
                local_content._check_content_access(
                    "orgs/org_test/courses/course_private_router/activities/activity_test/file.txt",
                    APITokenUser(org_id=org.id, created_by_user_id=1),
                    db,
                )
                is None
            )

            with pytest.raises(HTTPException) as token_course_exc:
                local_content._check_content_access(
                    "orgs/org_test/courses/course_private_router/activities/activity_test/file.txt",
                    APITokenUser(org_id=999, created_by_user_id=1),
                    db,
                )
            assert token_course_exc.value.status_code == 403

            with pytest.raises(HTTPException) as anon_course_exc:
                local_content._check_content_access(
                    "orgs/org_test/courses/course_private_router/activities/activity_test/file.txt",
                    anonymous_user,
                    db,
                )
            assert anon_course_exc.value.status_code == 401

            with pytest.raises(HTTPException) as anon_podcast_exc:
                local_content._check_content_access(
                    "orgs/org_test/podcasts/podcast_private_router/episodes/episode_1/file.txt",
                    anonymous_user,
                    db,
                )
            assert anon_podcast_exc.value.status_code == 401

            with pytest.raises(HTTPException) as unknown_exc:
                local_content._check_content_access("misc/file.txt", anonymous_user, db)
            assert unknown_exc.value.status_code == 401

            with pytest.raises(HTTPException) as missing_course_exc:
                local_content._check_content_access(
                    "orgs/org_test/courses/missing/activities/activity_test/file.txt",
                    regular_user,
                    db,
                )
            assert missing_course_exc.value.status_code == 403

            with pytest.raises(HTTPException) as missing_podcast_exc:
                local_content._check_content_access(
                    "orgs/org_test/podcasts/missing/episodes/episode_1/file.txt",
                    regular_user,
                    db,
                )
            assert missing_podcast_exc.value.status_code == 403

            with pytest.raises(HTTPException) as podcast_member_exc:
                local_content._check_content_access(
                    "orgs/org_test/podcasts/podcast_private_router/episodes/episode_1/file.txt",
                    regular_user.model_copy(update={"id": 999}),
                    db,
                )
            assert podcast_member_exc.value.status_code == 403

            missing_response = await client.get(
                "/content/orgs/org_test/courses/course_private_router/activities/activity_test/missing.txt"
            )
            invalid_response = await client.get("/content/%2E%2E/escape.txt")
            head_missing_response = await client.head(
                "/content/orgs/org_test/podcasts/podcast_private_router/episodes/episode_1/missing.txt"
            )
            head_invalid_response = await client.head("/content/%2E%2E/escape.txt")
        finally:
            local_content.CONTENT_DIR = original_dir

        assert missing_response.status_code == 404
        assert invalid_response.status_code == 400
        assert head_missing_response.status_code == 404
        assert head_invalid_response.status_code == 400
