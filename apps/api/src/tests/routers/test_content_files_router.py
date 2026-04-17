"""Router tests for src/routers/content_files.py."""

from types import SimpleNamespace
import urllib.parse

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.courses.courses import Course
from src.db.podcasts.podcasts import Podcast
from src.db.users import APITokenUser, AnonymousUser, PublicUser
from src.routers import content_files
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

    def close(self):
        pass


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


class _EmptyBody:
    def read(self):
        return b""

    def close(self):
        pass


class _EmptyS3Client:
    def head_object(self, Bucket, Key):
        return {"ContentLength": 4}

    def get_object(self, Bucket, Key, Range):
        return {"Body": _EmptyBody()}


class _PathTrigger(str):
    def __new__(cls):
        return str.__new__(cls, "safe\\path")

    def __contains__(self, item):
        if item == "..":
            return False
        return super().__contains__(item)

    def replace(self, old, new, count=-1):
        if old == "\\" and new == "/":
            return "safe../path"
        return super().replace(old, new, count)


class TestContentFilesRouter:
    def test_validate_content_path_branches(self):
        assert content_files._validate_content_path("orgs/abc/file.txt") == "orgs/abc/file.txt"
        assert content_files._validate_content_path("../secret.txt") is None
        assert content_files._validate_content_path("foo%2f..%2fbar.txt") is None

        with pytest.MonkeyPatch.context() as mp:
            def fake_realpath(path):
                if path == "content":
                    return "/tmp/content"
                if path == "/tmp/content/safe.txt":
                    return "/tmp/other/safe.txt"
                return path

            mp.setattr(content_files.os.path, "realpath", fake_realpath)
            assert content_files._validate_content_path("safe.txt") is None

        with pytest.MonkeyPatch.context() as mp:
            def fake_unquote(value):
                return value if isinstance(value, _PathTrigger) else _PathTrigger()

            mp.setattr(urllib.parse, "unquote", fake_unquote)
            assert content_files._validate_content_path("safe.txt") is None

    def test_check_content_access_course_and_podcast_branches(
        self, db, org, admin_user
    ):
        private_course = Course(
            id=31,
            name="Private Course",
            description="Desc",
            public=False,
            published=True,
            open_to_contributors=False,
            org_id=org.id,
            course_uuid="course_private_access",
            creation_date="2024-01-01",
            update_date="2024-01-01",
        )
        public_course = Course(
            id=32,
            name="Public Course",
            description="Desc",
            public=True,
            published=True,
            open_to_contributors=False,
            org_id=org.id,
            course_uuid="course_public_access",
            creation_date="2024-01-01",
            update_date="2024-01-01",
        )
        private_podcast = Podcast(
            id=41,
            name="Private Podcast",
            description="Desc",
            public=False,
            published=True,
            org_id=org.id,
            podcast_uuid="podcast_private_access",
            creation_date="2024-01-01",
            update_date="2024-01-01",
        )
        public_podcast = Podcast(
            id=42,
            name="Public Podcast",
            description="Desc",
            public=True,
            published=True,
            org_id=org.id,
            podcast_uuid="podcast_public_access",
            creation_date="2024-01-01",
            update_date="2024-01-01",
        )
        db.add(private_course)
        db.add(public_course)
        db.add(private_podcast)
        db.add(public_podcast)
        db.commit()

        outsider = PublicUser(
            id=99,
            username="outsider",
            first_name="Out",
            last_name="Sider",
            email="outsider@test.com",
            user_uuid="user_outsider",
        )

        with pytest.raises(Exception) as not_found:
            content_files._check_content_access(
                "orgs/%s/courses/missing/activities/a/video.mp4" % org.org_uuid,
                admin_user,
                db,
            )
        assert not_found.value.status_code == 403

        content_files._check_content_access(
            f"orgs/{org.org_uuid}/courses/{public_course.course_uuid}/activities/a/video.mp4",
            AnonymousUser(),
            db,
        )

        with pytest.raises(Exception) as anon_private_course:
            content_files._check_content_access(
                f"orgs/{org.org_uuid}/courses/{private_course.course_uuid}/activities/a/video.mp4",
                AnonymousUser(),
                db,
            )
        assert anon_private_course.value.status_code == 401

        with pytest.raises(Exception) as wrong_org_token:
            content_files._check_content_access(
                f"orgs/{org.org_uuid}/courses/{private_course.course_uuid}/activities/a/video.mp4",
                APITokenUser(org_id=org.id + 1),
                db,
            )
        assert wrong_org_token.value.status_code == 403

        content_files._check_content_access(
            f"orgs/{org.org_uuid}/courses/{private_course.course_uuid}/activities/a/video.mp4",
            APITokenUser(org_id=org.id),
            db,
        )

        with pytest.raises(Exception) as no_membership_course:
            content_files._check_content_access(
                f"orgs/{org.org_uuid}/courses/{private_course.course_uuid}/activities/a/video.mp4",
                outsider,
                db,
            )
        assert no_membership_course.value.status_code == 403

        content_files._check_content_access(
            f"orgs/{org.org_uuid}/courses/{private_course.course_uuid}/activities/a/video.mp4",
            admin_user,
            db,
        )

        content_files._check_content_access(
            f"orgs/{org.org_uuid}/courses/{private_course.course_uuid}/thumb.png",
            AnonymousUser(),
            db,
        )

        content_files._check_content_access(
            "users/user_outsider/avatar.png",
            AnonymousUser(),
            db,
        )

        with pytest.raises(Exception) as not_found_podcast:
            content_files._check_content_access(
                f"orgs/{org.org_uuid}/podcasts/missing/episodes/a/audio.mp3",
                admin_user,
                db,
            )
        assert not_found_podcast.value.status_code == 403

        content_files._check_content_access(
            f"orgs/{org.org_uuid}/podcasts/{public_podcast.podcast_uuid}/episodes/a/audio.mp3",
            AnonymousUser(),
            db,
        )

        with pytest.raises(Exception) as anon_private_podcast:
            content_files._check_content_access(
                f"orgs/{org.org_uuid}/podcasts/{private_podcast.podcast_uuid}/episodes/a/audio.mp3",
                AnonymousUser(),
                db,
            )
        assert anon_private_podcast.value.status_code == 401

        with pytest.raises(Exception) as wrong_org_podcast_token:
            content_files._check_content_access(
                f"orgs/{org.org_uuid}/podcasts/{private_podcast.podcast_uuid}/episodes/a/audio.mp3",
                APITokenUser(org_id=org.id + 1),
                db,
            )
        assert wrong_org_podcast_token.value.status_code == 403

        content_files._check_content_access(
            f"orgs/{org.org_uuid}/podcasts/{private_podcast.podcast_uuid}/episodes/a/audio.mp3",
            APITokenUser(org_id=org.id),
            db,
        )

        with pytest.raises(Exception) as no_membership_podcast:
            content_files._check_content_access(
                f"orgs/{org.org_uuid}/podcasts/{private_podcast.podcast_uuid}/episodes/a/audio.mp3",
                outsider,
                db,
            )
        assert no_membership_podcast.value.status_code == 403

        content_files._check_content_access(
            f"orgs/{org.org_uuid}/podcasts/{private_podcast.podcast_uuid}/episodes/a/audio.mp3",
            admin_user,
            db,
        )

        with pytest.raises(Exception) as unknown_path_anon:
            content_files._check_content_access("misc/file.txt", AnonymousUser(), db)
        assert unknown_path_anon.value.status_code == 401

    async def test_stream_full_and_range_content(
        self, client, db, org, course
    ):
        s3_client = _S3Client(b"abcdef")
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

    async def test_open_ended_range_invalid_range_and_empty_streams(
        self, client, app
    ):
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(content_files, "get_storage_client", lambda: _S3Client())
            mp.setattr(content_files, "get_s3_bucket_name", lambda: "bucket")
            open_ended_response = await client.get(
                "/content/users/u/avatar.png",
                headers={"range": "bytes=2-"},
            )
            invalid_range_response = await client.get(
                "/content/users/u/avatar.png",
                headers={"range": "bytes=bad"},
            )

        assert open_ended_response.status_code == 206
        assert open_ended_response.content == b"cdef"
        assert open_ended_response.headers["content-range"] == "bytes 2-5/6"
        assert invalid_range_response.status_code == 206
        assert invalid_range_response.content == b"abcdef"
        assert invalid_range_response.headers["content-range"] == "bytes 0-5/6"

        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(content_files, "get_storage_client", lambda: _EmptyS3Client())
            mp.setattr(content_files, "get_s3_bucket_name", lambda: "bucket")
            empty_full_response = await client.get("/content/users/u/avatar.png")
            empty_range_response = await client.get(
                "/content/users/u/avatar.png",
                headers={"range": "bytes=0-2"},
            )

        assert empty_full_response.status_code == 200
        assert empty_full_response.content == b""
        assert empty_range_response.status_code == 206
        assert empty_range_response.content == b""

    async def test_head_and_invalid_path_handling(self, client):
        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(content_files, "get_storage_client", lambda: _S3Client())
            mp.setattr(content_files, "get_s3_bucket_name", lambda: "bucket")
            head_response = await client.head("/content/users/u/avatar.png")
            bad_path_response = await client.get("/content/%2E%2E/secrets.txt")
            bad_head_response = await client.head("/content/%2E%2E/secrets.txt")
            mp.setattr(content_files, "get_storage_client", lambda: None)
            no_storage_head_response = await client.head("/content/users/u/avatar.png")

        assert head_response.status_code == 200
        assert head_response.headers["content-length"] == "6"
        assert bad_path_response.status_code == 400
        assert bad_head_response.status_code == 400
        assert no_storage_head_response.status_code == 500

    async def test_storage_head_errors_return_502(self, client):
        class _BrokenS3Client:
            def head_object(self, Bucket, Key):
                raise Exception("boom")

        with pytest.MonkeyPatch.context() as mp:
            mp.setattr(content_files, "get_storage_client", lambda: _BrokenS3Client())
            mp.setattr(content_files, "get_s3_bucket_name", lambda: "bucket")
            get_response = await client.get("/content/users/u/avatar.png")
            head_response = await client.head("/content/users/u/avatar.png")

        # Generic storage failures are surfaced as 502 (Bad Gateway). 404 is
        # reserved for cases where the storage layer reported NoSuchKey.
        assert get_response.status_code == 502
        assert head_response.status_code == 502

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
