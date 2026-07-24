"""Router tests for src/routers/local_content.py."""

from pathlib import Path

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
        await db.commit()

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
            await db.commit()
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

    async def test_dot_segment_cannot_bypass_the_access_check(
        self, client, db, org, regular_user, app, tmp_path
    ):
        # A `.` segment survives normalization (only `..` is rejected) but is
        # collapsed by realpath. The access check must run on the CANONICAL path
        # derived from the resolved file, not the request string — otherwise
        # `orgs/./{uuid}/courses/...` shifts the segment indices, misses the
        # private-course pattern, falls through to the public branch, and serves
        # a private file to an anonymous user.
        course = Course(
            id=11,
            name="Private Course",
            description="Desc",
            public=False,
            published=True,
            open_to_contributors=False,
            org_id=org.id,
            course_uuid="course_dotseg",
            creation_date="2024-01-01",
            update_date="2024-01-01",
        )
        db.add(course)
        await db.commit()

        content_root = tmp_path / "content"
        file_path = (
            content_root / "orgs" / org.org_uuid / "courses" / course.course_uuid
            / "activities" / "activity_x" / "secret.mp4"
        )
        file_path.parent.mkdir(parents=True)
        file_path.write_bytes(b"secret")

        from src.routers import local_content

        original_dir = local_content.CONTENT_DIR
        local_content.CONTENT_DIR = content_root
        try:
            app.dependency_overrides[get_current_user] = lambda: AnonymousUser()
            # Same file, reached through a `.` segment after `orgs`.
            sneaky = await client.get(
                f"/content/orgs/./{org.org_uuid}/courses/{course.course_uuid}"
                "/activities/activity_x/secret.mp4"
            )
            # And double-URL-encoded (`%252e` -> `%2e` -> `.`).
            sneaky_encoded = await client.get(
                f"/content/orgs/%252e/{org.org_uuid}/courses/{course.course_uuid}"
                "/activities/activity_x/secret.mp4"
            )
        finally:
            local_content.CONTENT_DIR = original_dir

        # The anonymous caller must be challenged, never handed the file (200).
        assert sneaky.status_code in (400, 401)
        assert sneaky_encoded.status_code in (400, 401)

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
        await db.commit()

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
            # The relpath normalizer rejects traversal, absolute paths, and null
            # bytes as strings; the realpath containment guard that catches
            # symlink escapes lives in the handlers and is covered end-to-end
            # below and in test_api_token_scope_and_invalid_paths.
            assert local_content._normalize_content_relpath("../escape") is None
            assert local_content._normalize_content_relpath("/absolute/path") is None
            assert local_content._normalize_content_relpath("foo\\..\\bar") is None
            assert local_content._normalize_content_relpath("foo\x00bar") is None
            assert local_content._normalize_content_relpath("%2E%2E/escape") is None
            assert local_content._normalize_content_relpath("orgs/x/file.txt") == "orgs/x/file.txt"

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
            await db.commit()

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
            await db.commit()

            assert (
                await local_content._check_content_access(
                    "orgs/org_test/courses/course_test/activities/activity_test/file.txt",
                    anonymous_user,
                    db,
                )
                is None
            )
            assert (
                await local_content._check_content_access(
                    "orgs/org_test/podcasts/podcast_public_router/episodes/episode_1/file.txt",
                    anonymous_user,
                    db,
                )
                is None
            )
            assert (
                await local_content._check_content_access(
                    "orgs/org_test/courses/course_test/activities/activity_test/file.txt",
                    regular_user,
                    db,
                )
            ) is None

            assert (
                await local_content._check_content_access(
                    "orgs/org_test/courses/course_private_router/activities/activity_test/file.txt",
                    APITokenUser(org_id=org.id, created_by_user_id=1),
                    db,
                )
                is None
            )

            with pytest.raises(HTTPException) as token_course_exc:
                await local_content._check_content_access(
                    "orgs/org_test/courses/course_private_router/activities/activity_test/file.txt",
                    APITokenUser(org_id=999, created_by_user_id=1),
                    db,
                )
            assert token_course_exc.value.status_code == 403

            with pytest.raises(HTTPException) as anon_course_exc:
                await local_content._check_content_access(
                    "orgs/org_test/courses/course_private_router/activities/activity_test/file.txt",
                    anonymous_user,
                    db,
                )
            assert anon_course_exc.value.status_code == 401

            with pytest.raises(HTTPException) as anon_podcast_exc:
                await local_content._check_content_access(
                    "orgs/org_test/podcasts/podcast_private_router/episodes/episode_1/file.txt",
                    anonymous_user,
                    db,
                )
            assert anon_podcast_exc.value.status_code == 401

            with pytest.raises(HTTPException) as unknown_exc:
                await local_content._check_content_access("misc/file.txt", anonymous_user, db)
            assert unknown_exc.value.status_code == 401

            with pytest.raises(HTTPException) as missing_course_exc:
                await local_content._check_content_access(
                    "orgs/org_test/courses/missing/activities/activity_test/file.txt",
                    regular_user,
                    db,
                )
            assert missing_course_exc.value.status_code == 403

            with pytest.raises(HTTPException) as missing_podcast_exc:
                await local_content._check_content_access(
                    "orgs/org_test/podcasts/missing/episodes/episode_1/file.txt",
                    regular_user,
                    db,
                )
            assert missing_podcast_exc.value.status_code == 403

            with pytest.raises(HTTPException) as podcast_member_exc:
                await local_content._check_content_access(
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

            # A symlink that lives inside CONTENT_DIR but resolves outside it
            # passes the string checks in _validate_content_path (no ".." in the
            # request) yet must be refused by the inline realpath containment
            # guard right before the filesystem read.
            secret = tmp_path / "secret.txt"
            secret.write_text("top secret")
            content_root = Path(local_content.CONTENT_DIR)
            content_root.mkdir(parents=True, exist_ok=True)
            (content_root / "orgs").mkdir(parents=True, exist_ok=True)
            link = content_root / "orgs" / "leak.txt"
            try:
                link.symlink_to(secret)
                symlink_ok = True
            except (OSError, NotImplementedError):
                symlink_ok = False
            symlink_response = (
                await client.get("/content/orgs/leak.txt") if symlink_ok else None
            )
        finally:
            local_content.CONTENT_DIR = original_dir

        assert missing_response.status_code == 404
        assert invalid_response.status_code == 400
        assert head_missing_response.status_code == 404
        assert head_invalid_response.status_code == 400
        if symlink_response is not None:
            assert symlink_response.status_code == 400
