"""
Extra router tests for src/routers/users.py.

This file intentionally avoids the profile/read-by-id/read-by-uuid/read-by-username
cases already covered in test_users_router.py. It focuses on the remaining router
branches: session caching, org invite gates, mutation side effects, password reset
flows, and user course listing.
"""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.courses.courses import CourseRead
from src.db.users import AnonymousUser, UserRead, UserSession
from src.routers.users import (
    SESSION_CACHE_TTL,
    _get_redis_client,
    _get_session_cache,
    _invalidate_session_cache,
    _set_session_cache,
    router as users_router,
)
from src.security.auth import get_authenticated_user, get_current_user


@pytest.fixture
def app(db, admin_user):
    app = FastAPI()
    app.include_router(users_router, prefix="/api/v1/users")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: admin_user
    app.dependency_overrides[get_authenticated_user] = lambda: admin_user
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


def _mock_user_read(**overrides) -> UserRead:
    data = dict(
        id=1,
        username="admin",
        first_name="Admin",
        last_name="User",
        email="admin@test.com",
        user_uuid="user_admin",
        email_verified=False,
        avatar_image="",
        bio="",
    )
    data.update(overrides)
    return UserRead(**data)


def _mock_user_session(**overrides) -> UserSession:
    data = dict(user=_mock_user_read(), roles=[])
    data.update(overrides)
    return UserSession(**data)


def _mock_course_read(**overrides) -> CourseRead:
    data = dict(
        id=1,
        name="Test Course",
        description="A course",
        about="About",
        learnings="Learn",
        tags="tag1,tag2",
        public=True,
        published=False,
        open_to_contributors=False,
        org_id=1,
        authors=[],
        course_uuid="course_test",
        creation_date="2024-01-01",
        update_date="2024-01-01",
        thumbnail_image="",
        thumbnail_video="",
        seo=None,
    )
    data.update(overrides)
    return CourseRead(**data)


class TestSessionEndpoint:
    async def test_session_cache_hit(self, client):
        cached = _mock_user_session().model_dump()
        with (
            patch(
                "src.routers.users._get_session_cache",
                return_value=cached,
            ) as get_cache_mock,
            patch(
                "src.routers.users.get_user_session",
                new_callable=AsyncMock,
            ) as get_session_mock,
            patch("src.routers.users._set_session_cache") as set_cache_mock,
        ):
            response = await client.get("/api/v1/users/session")

        assert response.status_code == 200
        assert response.json()["user"]["user_uuid"] == "user_admin"
        get_cache_mock.assert_called_once_with(1)
        get_session_mock.assert_not_awaited()
        set_cache_mock.assert_not_called()

    async def test_session_cache_miss_sets_cache(self, client):
        session = _mock_user_session()
        with (
            patch("src.routers.users._get_session_cache", return_value=None),
            patch(
                "src.routers.users.get_user_session",
                new_callable=AsyncMock,
                return_value=session,
            ) as get_session_mock,
            patch("src.routers.users._set_session_cache") as set_cache_mock,
        ):
            response = await client.get("/api/v1/users/session")

        assert response.status_code == 200
        assert response.json()["user"]["username"] == "admin"
        get_session_mock.assert_awaited_once()
        set_cache_mock.assert_called_once_with(1, session.model_dump())

    async def test_session_anonymous_user_skips_cache(self, client, app):
        app.dependency_overrides[get_current_user] = lambda: AnonymousUser()
        session = _mock_user_session(user=_mock_user_read(username="anonymous"))
        with (
            patch(
                "src.routers.users._get_session_cache",
                return_value={"unexpected": True},
            ) as get_cache_mock,
            patch(
                "src.routers.users.get_user_session",
                new_callable=AsyncMock,
                return_value=session,
            ) as get_session_mock,
            patch("src.routers.users._set_session_cache") as set_cache_mock,
        ):
            response = await client.get("/api/v1/users/session")

        assert response.status_code == 200
        assert response.json()["user"]["username"] == "anonymous"
        get_cache_mock.assert_not_called()
        get_session_mock.assert_awaited_once()
        set_cache_mock.assert_not_called()


class TestSessionCacheHelpers:
    def test_get_redis_client_missing_connection_string(self):
        class FakeConfig:
            class redis_config:
                redis_connection_string = ""

        with patch(
            "src.routers.users.get_learnhouse_config",
            return_value=FakeConfig(),
        ):
            assert _get_redis_client() is None

    def test_get_redis_client_from_url_and_exception(self):
        fake_client = object()

        class FakeConfig:
            class redis_config:
                redis_connection_string = "redis://localhost:6379/0"

        with (
            patch("src.routers.users.get_learnhouse_config", return_value=FakeConfig()),
            patch(
                "src.routers.users.redis.Redis.from_url",
                return_value=fake_client,
            ) as from_url_mock,
        ):
            assert _get_redis_client() is fake_client
            from_url_mock.assert_called_once()

        with patch(
            "src.routers.users.get_learnhouse_config",
            side_effect=RuntimeError("boom"),
        ):
            assert _get_redis_client() is None

    def test_session_cache_read_write_and_invalidate(self):
        class FakeRedis:
            def __init__(self):
                self.storage = {}
                self.deleted = []

            def get(self, key):
                return self.storage.get(key)

            def setex(self, key, ttl, value):
                self.storage[key] = (ttl, value)

            def delete(self, key):
                self.deleted.append(key)

        fake_redis = FakeRedis()
        fake_redis.storage["session:1"] = b'{"user": {"id": 1}, "roles": []}'

        with patch("src.routers.users._get_redis_client", return_value=fake_redis):
            cached = _get_session_cache(1)
            assert cached == {"user": {"id": 1}, "roles": []}

            _set_session_cache(1, {"user": {"id": 1}, "roles": []})
            assert fake_redis.storage["session:1"][0] == SESSION_CACHE_TTL
            assert '"roles": []' in fake_redis.storage["session:1"][1]

            _invalidate_session_cache(1)
            assert fake_redis.deleted == ["session:1"]

    def test_session_cache_helpers_swallow_redis_errors(self):
        class ExplodingRedis:
            def get(self, key):
                raise RuntimeError("get failed")

            def setex(self, key, ttl, value):
                raise RuntimeError("set failed")

            def delete(self, key):
                raise RuntimeError("delete failed")

        with patch("src.routers.users._get_redis_client", return_value=ExplodingRedis()):
            assert _get_session_cache(1) is None
            _set_session_cache(1, {"user": {"id": 1}})
            _invalidate_session_cache(1)

    def test_session_cache_helpers_no_redis_client(self):
        with patch("src.routers.users._get_redis_client", return_value=None):
            assert _get_session_cache(1) is None
            _set_session_cache(1, {"user": {"id": 1}})
            _invalidate_session_cache(1)


class TestAuthorizationAndCreationEndpoints:
    async def test_authorization_endpoint(self, client):
        with patch(
            "src.routers.users.authorize_user_action",
            new_callable=AsyncMock,
            return_value={"allowed": True},
        ) as auth_mock:
            response = await client.get(
                "/api/v1/users/authorize/ressource/course_1/action/read"
            )

        assert response.status_code == 200
        assert response.json()["allowed"] is True
        auth_mock.assert_awaited_once()

    async def test_create_user_without_org(self, client):
        with patch(
            "src.routers.users.create_user_without_org",
            new_callable=AsyncMock,
            return_value=_mock_user_read(username="new_user", user_uuid="user_new"),
        ) as create_mock:
            response = await client.post(
                "/api/v1/users/",
                json={
                    "username": "new_user",
                    "first_name": "New",
                    "last_name": "User",
                    "email": "new@test.com",
                    "password": "Password123!",
                },
            )

        assert response.status_code == 200
        assert response.json()["username"] == "new_user"
        create_mock.assert_awaited_once()

    async def test_create_user_with_orgid_invite_only_blocks(self, client):
        with patch(
            "src.routers.users.get_org_join_mechanism",
            new_callable=AsyncMock,
            return_value="inviteOnly",
        ):
            response = await client.post(
                "/api/v1/users/1",
                json={
                    "username": "new_user",
                    "first_name": "New",
                    "last_name": "User",
                    "email": "new@test.com",
                    "password": "Password123!",
                },
            )

        assert response.status_code == 403
        assert "invite" in response.json()["detail"].lower()

    async def test_create_user_with_orgid_open_calls_service(self, client):
        with (
            patch(
                "src.routers.users.get_org_join_mechanism",
                new_callable=AsyncMock,
                return_value="open",
            ),
            patch(
                "src.routers.users.create_user",
                new_callable=AsyncMock,
                return_value=_mock_user_read(username="new_user", user_uuid="user_new"),
            ) as create_mock,
        ):
            response = await client.post(
                "/api/v1/users/1",
                json={
                    "username": "new_user",
                    "first_name": "New",
                    "last_name": "User",
                    "email": "new@test.com",
                    "password": "Password123!",
                },
            )

        assert response.status_code == 200
        assert response.json()["user_uuid"] == "user_new"
        create_mock.assert_awaited_once()

    async def test_create_user_with_invite_success(self, client):
        with (
            patch(
                "src.routers.users.get_org_join_mechanism",
                new_callable=AsyncMock,
                return_value="inviteOnly",
            ),
            patch(
                "src.routers.users.create_user_with_invite",
                new_callable=AsyncMock,
                return_value=_mock_user_read(username="invited", user_uuid="user_invited"),
            ) as create_mock,
        ):
            response = await client.post(
                "/api/v1/users/1/invite/code123",
                json={
                    "username": "invited",
                    "first_name": "Invited",
                    "last_name": "User",
                    "email": "invited@test.com",
                    "password": "Password123!",
                },
            )

        assert response.status_code == 200
        assert response.json()["username"] == "invited"
        create_mock.assert_awaited_once()

    async def test_create_user_with_invite_rejects_open_org(self, client):
        with patch(
            "src.routers.users.get_org_join_mechanism",
            new_callable=AsyncMock,
            return_value="open",
        ):
            response = await client.post(
                "/api/v1/users/1/invite/code123",
                json={
                    "username": "invited",
                    "first_name": "Invited",
                    "last_name": "User",
                    "email": "invited@test.com",
                    "password": "Password123!",
                },
            )

        assert response.status_code == 403
        assert "invite code" in response.json()["detail"].lower()


class TestMutationEndpoints:
    async def test_update_user_invalidates_session_cache(self, client):
        with (
            patch(
                "src.routers.users.update_user",
                new_callable=AsyncMock,
                return_value=_mock_user_read(username="updated", user_uuid="user_updated"),
            ) as update_mock,
            patch("src.routers.users._invalidate_session_cache") as invalidate_mock,
        ):
            response = await client.put(
                "/api/v1/users/1",
                json={
                    "username": "updated",
                    "first_name": "Updated",
                    "last_name": "User",
                    "email": "updated@test.com",
                    "avatar_image": "",
                    "bio": "",
                    "details": {},
                    "profile": {},
                },
            )

        assert response.status_code == 200
        assert response.json()["username"] == "updated"
        update_mock.assert_awaited_once()
        invalidate_mock.assert_called_once_with(1)

    async def test_update_avatar_success_and_forbidden(self, client):
        with (
            patch(
                "src.routers.users.update_user_avatar",
                new_callable=AsyncMock,
                return_value=_mock_user_read(avatar_image="avatar.png"),
            ) as avatar_mock,
            patch("src.routers.users._invalidate_session_cache") as invalidate_mock,
        ):
            response = await client.put(
                "/api/v1/users/update_avatar/1",
                files={"avatar_file": ("avatar.png", b"avatar-bytes", "image/png")},
            )

        assert response.status_code == 200
        assert response.json()["avatar_image"] == "avatar.png"
        avatar_mock.assert_awaited_once()
        invalidate_mock.assert_called_once_with(1)

        forbidden = await client.put("/api/v1/users/update_avatar/999")
        assert forbidden.status_code == 403

    async def test_update_password_and_delete_user(self, client):
        with patch(
            "src.routers.users.update_user_password",
            new_callable=AsyncMock,
            return_value=_mock_user_read(username="password-updated"),
        ) as update_password_mock:
            response = await client.put(
                "/api/v1/users/change_password/1",
                json={"old_password": "old-password", "new_password": "new-password"},
            )

        assert response.status_code == 200
        assert response.json()["username"] == "password-updated"
        update_password_mock.assert_awaited_once()

        with (
            patch(
                "src.routers.users.delete_user_by_id",
                new_callable=AsyncMock,
                return_value={"detail": "deleted"},
            ) as delete_mock,
            patch("src.routers.users._invalidate_session_cache") as invalidate_mock,
        ):
            deleted = await client.delete("/api/v1/users/user_id/1")

        assert deleted.status_code == 200
        assert deleted.json()["detail"] == "deleted"
        delete_mock.assert_awaited_once()
        invalidate_mock.assert_called_once_with(1)


class TestPasswordResetEndpoints:
    async def test_reset_password_with_code_success(self, client):
        with (
            patch(
                "src.routers.users.check_password_reset_rate_limit",
                return_value=(True, 0),
            ) as rate_limit_mock,
            patch(
                "src.routers.users.change_password_with_reset_code",
                new_callable=AsyncMock,
                return_value={"detail": "changed"},
            ) as change_mock,
        ):
            response = await client.post(
                "/api/v1/users/reset_password/change_password/user@test.com",
                json={
                    "new_password": "new-password",
                    "org_id": 1,
                    "reset_code": "code123",
                },
            )

        assert response.status_code == 200
        assert response.json()["detail"] == "changed"
        rate_limit_mock.assert_called_once()
        change_mock.assert_awaited_once()

    async def test_reset_password_with_code_rate_limited(self, client):
        with patch(
            "src.routers.users.check_password_reset_rate_limit",
            return_value=(False, 120),
        ):
            response = await client.post(
                "/api/v1/users/reset_password/change_password/user@test.com",
                json={
                    "new_password": "new-password",
                    "org_id": 1,
                    "reset_code": "code123",
                },
            )

        assert response.status_code == 429
        assert "too many password reset attempts" in response.json()["detail"].lower()

    async def test_send_password_reset_code_success(self, client):
        with (
            patch(
                "src.routers.users.send_reset_password_code",
                new_callable=AsyncMock,
                return_value={"detail": "sent"},
            ) as send_mock,
        ):
            response = await client.post(
                "/api/v1/users/reset_password/send_reset_code/user@test.com",
                params={"org_id": 1},
            )

        assert response.status_code == 200
        assert response.json()["detail"] == "sent"
        send_mock.assert_awaited_once()

    async def test_platform_reset_password_flows(self, client):
        with (
            patch(
                "src.routers.users.check_password_reset_rate_limit",
                return_value=(True, 0),
            ) as rate_limit_mock,
            patch(
                "src.routers.users.send_reset_password_code_platform",
                new_callable=AsyncMock,
                return_value={"detail": "sent"},
            ) as send_mock,
        ):
            response = await client.post(
                "/api/v1/users/reset_password/platform/send_reset_code/user@test.com"
            )

        assert response.status_code == 200
        assert response.json()["detail"] == "sent"
        rate_limit_mock.assert_called_once()
        send_mock.assert_awaited_once()

        with (
            patch(
                "src.routers.users.check_password_reset_rate_limit",
                return_value=(True, 0),
            ),
            patch(
                "src.routers.users.change_password_with_reset_code_platform",
                new_callable=AsyncMock,
                return_value={"detail": "changed"},
            ) as change_mock,
        ):
            changed = await client.post(
                "/api/v1/users/reset_password/platform/change_password/user@test.com",
                json={"new_password": "new-password", "reset_code": "code123"},
            )

        assert changed.status_code == 200
        assert changed.json()["detail"] == "changed"
        change_mock.assert_awaited_once()

    async def test_platform_reset_password_rate_limited(self, client):
        with patch(
            "src.routers.users.check_password_reset_rate_limit",
            return_value=(False, 120),
        ):
            response = await client.post(
                "/api/v1/users/reset_password/platform/send_reset_code/user@test.com"
            )

        assert response.status_code == 429
        assert "too many password reset attempts" in response.json()["detail"].lower()

        with patch(
            "src.routers.users.check_password_reset_rate_limit",
            return_value=(False, 300),
        ):
            response = await client.post(
                "/api/v1/users/reset_password/platform/change_password/user@test.com",
                json={"new_password": "new-password", "reset_code": "code123"},
            )

        assert response.status_code == 429
        assert "too many password reset attempts" in response.json()["detail"].lower()


class TestUserCoursesEndpoint:
    async def test_get_user_courses(self, client):
        with patch(
            "src.routers.users.get_user_courses",
            new_callable=AsyncMock,
            return_value=[_mock_course_read()],
        ) as courses_mock:
            response = await client.get("/api/v1/users/1/courses?page=2&limit=5")

        assert response.status_code == 200
        body = response.json()
        assert len(body) == 1
        assert body[0]["course_uuid"] == "course_test"
        courses_mock.assert_awaited_once()
