"""Router tests for src/routers/admin.py."""

from contextlib import contextmanager
from unittest.mock import AsyncMock, Mock, patch

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.trails import TrailRead
from src.db.users import APITokenUser, UserRead
from src.db.usergroups import UserGroupRead
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


def _mock_user(**overrides) -> UserRead:
    data = dict(
        id=2,
        username="learner",
        first_name="Lea",
        last_name="Learner",
        email="learner@test.com",
        user_uuid="user_2",
        email_verified=True,
        avatar_image="",
        bio="",
    )
    data.update(overrides)
    return UserRead(**data)


def _mock_usergroup(**overrides) -> UserGroupRead:
    data = dict(
        id=5,
        org_id=1,
        usergroup_uuid="usergroup_1",
        name="Cohort A",
        description="",
        creation_date="2024-01-01",
        update_date="2024-01-01",
    )
    data.update(overrides)
    return UserGroupRead(**data)


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

    async def test_user_provisioning_and_lookup(self, client, api_user):
        """provision user, remove user, lookup by email, profile/role updates."""
        with _admin_context(api_user), patch(
            "src.routers.admin.provision_user",
            new_callable=AsyncMock,
            return_value=_mock_user(username="provisioned"),
        ):
            response = await client.post(
                "/api/v1/admin/acme/users",
                json={
                    "email": "new@test.com",
                    "username": "provisioned",
                    "first_name": "New",
                    "last_name": "User",
                    "password": "pw",
                    "role_id": 4,
                },
            )
        assert response.status_code == 200
        assert response.json()["username"] == "provisioned"

        with _admin_context(api_user), patch(
            "src.routers.admin.remove_user_from_org_admin",
            new_callable=AsyncMock,
            return_value={"detail": "User removed from org"},
        ):
            response = await client.delete("/api/v1/admin/acme/users/2")
        assert response.status_code == 200
        assert response.json()["detail"] == "User removed from org"

        with _admin_context(api_user), patch(
            "src.routers.admin.get_user_by_email",
            new_callable=AsyncMock,
            return_value=_mock_user(email="found@test.com"),
        ):
            response = await client.get("/api/v1/admin/acme/users/by-email/found@test.com")
        assert response.status_code == 200
        assert response.json()["email"] == "found@test.com"

        with _admin_context(api_user), patch(
            "src.routers.admin.update_user_profile",
            new_callable=AsyncMock,
            return_value=_mock_user(first_name="Updated"),
        ):
            response = await client.patch(
                "/api/v1/admin/acme/users/2", json={"first_name": "Updated"}
            )
        assert response.status_code == 200
        assert response.json()["first_name"] == "Updated"

        with _admin_context(api_user), patch(
            "src.routers.admin.change_user_role",
            new_callable=AsyncMock,
            return_value={"user_id": 2, "role_id": 3},
        ):
            response = await client.patch(
                "/api/v1/admin/acme/users/2/role", json={"role_id": 3}
            )
        assert response.status_code == 200
        assert response.json()["role_id"] == 3

    async def test_magic_link_issue_and_consume(self, client, api_user):
        """Magic link endpoints — issue, consume (success + error HTML)."""
        with _admin_context(api_user), patch(
            "src.routers.admin.issue_magic_link",
            new_callable=AsyncMock,
            return_value={
                "url": "http://test/consume?token=abc",
                "token": "abc",
                "expires_at": "2024-01-01T00:05:00Z",
            },
        ):
            response = await client.post(
                "/api/v1/admin/acme/auth/magic-link",
                json={"user_id": 2, "ttl_seconds": 300},
            )
        assert response.status_code == 200
        assert response.json()["token"] == "abc"

        with patch(
            "src.routers.admin.consume_magic_link_token",
            new_callable=AsyncMock,
            return_value=(_mock_user(), "access_tok", "refresh_tok", "/dashboard"),
        ):
            response = await client.get(
                "/api/v1/admin/acme/auth/magic-consume",
                params={"token": "good"},
                follow_redirects=False,
            )
        assert response.status_code == 302
        assert response.headers["location"] == "/dashboard"

        with patch(
            "src.routers.admin.consume_magic_link_token",
            new_callable=AsyncMock,
            side_effect=HTTPException(status_code=410, detail="Link expired"),
        ):
            response = await client.get(
                "/api/v1/admin/acme/auth/magic-consume",
                params={"token": "bad"},
            )
        assert response.status_code == 410
        assert "text/html" in response.headers["content-type"]
        assert "Link expired" in response.text

    async def test_bulk_enrollment_and_course_listings(self, client, api_user):
        """Bulk enroll/unenroll, course enrollment listing, progress reset, course analytics."""
        with _admin_context(api_user), patch(
            "src.routers.admin.bulk_enroll_users",
            new_callable=AsyncMock,
            return_value={
                "enrolled": [1, 2],
                "already_enrolled": [3],
                "skipped": [4],
            },
        ):
            response = await client.post(
                "/api/v1/admin/acme/enrollments/bulk",
                json={"course_uuid": "course_1", "user_ids": [1, 2, 3, 4]},
            )
        assert response.status_code == 200
        assert response.json()["enrolled"] == [1, 2]

        with _admin_context(api_user), patch(
            "src.routers.admin.bulk_unenroll_users",
            new_callable=AsyncMock,
            return_value={"unenrolled": [1], "not_enrolled": [2]},
        ):
            response = await client.post(
                "/api/v1/admin/acme/enrollments/bulk/unenroll",
                json={"course_uuid": "course_1", "user_ids": [1, 2]},
            )
        assert response.status_code == 200
        assert response.json()["not_enrolled"] == [2]

        with _admin_context(api_user), patch(
            "src.routers.admin.list_course_enrollments",
            new_callable=AsyncMock,
            return_value=[
                {
                    "user": {"id": 2, "user_uuid": "user_2"},
                    "enrolled_at": "2024-01-01",
                    "status": "STATUS_IN_PROGRESS",
                }
            ],
        ):
            response = await client.get("/api/v1/admin/acme/courses/course_1/enrollments")
        assert response.status_code == 200
        assert response.json()[0]["status"] == "STATUS_IN_PROGRESS"

        with _admin_context(api_user), patch(
            "src.routers.admin.reset_user_progress",
            new_callable=AsyncMock,
            return_value={"course_uuid": "course_1", "user_id": 2, "steps_deleted": 4},
        ):
            response = await client.post("/api/v1/admin/acme/progress/2/course_1/reset")
        assert response.status_code == 200
        assert response.json()["steps_deleted"] == 4

        with _admin_context(api_user), patch(
            "src.routers.admin.get_course_analytics",
            new_callable=AsyncMock,
            return_value={
                "course_uuid": "course_1",
                "enrollment_count": 10,
                "completed_count": 3,
                "in_progress_count": 7,
                "total_activities": 8,
                "average_completion_percentage": 42.5,
                "certificate_count": 3,
            },
        ):
            response = await client.get("/api/v1/admin/acme/courses/course_1/analytics")
        assert response.status_code == 200
        assert response.json()["enrollment_count"] == 10

    async def test_certificate_award_and_revoke(self, client, api_user):
        with _admin_context(api_user), patch(
            "src.routers.admin.award_certificate",
            new_callable=AsyncMock,
            return_value={
                "user_certification_uuid": "cert_1",
                "user_id": 2,
                "course_uuid": "course_1",
            },
        ):
            response = await client.post(
                "/api/v1/admin/acme/certifications/2/course_1/award"
            )
        assert response.status_code == 200
        assert response.json()["user_certification_uuid"] == "cert_1"

        with _admin_context(api_user), patch(
            "src.routers.admin.revoke_certificate",
            new_callable=AsyncMock,
            return_value={"detail": "Revoked", "user_certification_uuid": "cert_1"},
        ):
            response = await client.delete(
                "/api/v1/admin/acme/certifications/2/cert_1"
            )
        assert response.status_code == 200
        assert response.json()["detail"] == "Revoked"

    async def test_usergroup_crud_and_membership(self, client, api_user):
        """create/delete usergroup, add/remove members, list members and groups."""
        with _admin_context(api_user), patch(
            "src.routers.admin.create_usergroup",
            new_callable=AsyncMock,
            return_value=_mock_usergroup(name="New Cohort"),
        ):
            response = await client.post(
                "/api/v1/admin/acme/usergroups",
                json={"name": "New Cohort", "description": ""},
            )
        assert response.status_code == 200
        assert response.json()["name"] == "New Cohort"

        with _admin_context(api_user), patch(
            "src.routers.admin.delete_usergroup",
            new_callable=AsyncMock,
            return_value={"detail": "Deleted", "usergroup_uuid": "usergroup_1"},
        ):
            response = await client.delete("/api/v1/admin/acme/usergroups/usergroup_1")
        assert response.status_code == 200
        assert response.json()["usergroup_uuid"] == "usergroup_1"

        with _admin_context(api_user), patch(
            "src.routers.admin.add_usergroup_member",
            new_callable=AsyncMock,
            return_value={
                "detail": "Added",
                "usergroup_uuid": "usergroup_1",
                "user_id": 2,
            },
        ):
            response = await client.post(
                "/api/v1/admin/acme/usergroups/usergroup_1/members/2"
            )
        assert response.status_code == 200
        assert response.json()["detail"] == "Added"

        with _admin_context(api_user), patch(
            "src.routers.admin.remove_usergroup_member",
            new_callable=AsyncMock,
            return_value={
                "detail": "Removed",
                "usergroup_uuid": "usergroup_1",
                "user_id": 2,
            },
        ):
            response = await client.delete(
                "/api/v1/admin/acme/usergroups/usergroup_1/members/2"
            )
        assert response.status_code == 200
        assert response.json()["detail"] == "Removed"

        with _admin_context(api_user), patch(
            "src.routers.admin.list_usergroup_members",
            new_callable=AsyncMock,
            return_value=[
                {
                    "user": {"id": 2, "user_uuid": "user_2"},
                    "added_at": "2024-01-01",
                }
            ],
        ):
            response = await client.get(
                "/api/v1/admin/acme/usergroups/usergroup_1/members"
            )
        assert response.status_code == 200
        assert response.json()[0]["user"]["user_uuid"] == "user_2"

        with _admin_context(api_user), patch(
            "src.routers.admin.get_user_groups",
            new_callable=AsyncMock,
            return_value=[
                {
                    "usergroup": {"id": 5, "usergroup_uuid": "usergroup_1", "name": "Cohort A"},
                    "added_at": "2024-01-01",
                }
            ],
        ):
            response = await client.get("/api/v1/admin/acme/users/2/groups")
        assert response.status_code == 200
        assert response.json()[0]["usergroup"]["usergroup_uuid"] == "usergroup_1"

        with _admin_context(api_user), patch(
            "src.routers.admin.add_course_to_usergroup",
            new_callable=AsyncMock,
            return_value={
                "detail": "Linked",
                "usergroup_uuid": "usergroup_1",
                "course_uuid": "course_1",
            },
        ):
            response = await client.post(
                "/api/v1/admin/acme/usergroups/usergroup_1/courses/course_1"
            )
        assert response.status_code == 200
        assert response.json()["course_uuid"] == "course_1"

        with _admin_context(api_user), patch(
            "src.routers.admin.remove_course_from_usergroup",
            new_callable=AsyncMock,
            return_value={
                "detail": "Unlinked",
                "usergroup_uuid": "usergroup_1",
                "course_uuid": "course_1",
            },
        ):
            response = await client.delete(
                "/api/v1/admin/acme/usergroups/usergroup_1/courses/course_1"
            )
        assert response.status_code == 200
        assert response.json()["detail"] == "Unlinked"

    async def test_gdpr_export_and_anonymize(self, client, api_user):
        with _admin_context(api_user), patch(
            "src.routers.admin.export_user_data",
            new_callable=AsyncMock,
            return_value={
                "profile": {"user_uuid": "user_2"},
                "memberships": [],
                "trails": [],
                "trail_runs": [],
                "trail_steps": [],
                "certificates": [],
                "user_groups": [],
                "exported_at": "2024-01-01T00:00:00Z",
            },
        ):
            response = await client.get("/api/v1/admin/acme/users/2/export")
        assert response.status_code == 200
        assert response.json()["profile"]["user_uuid"] == "user_2"

        with _admin_context(api_user), patch(
            "src.routers.admin.anonymize_user",
            new_callable=AsyncMock,
            return_value={
                "detail": "User anonymized",
                "user_id": 2,
                "anonymized_email": "anon-2@anon.invalid",
                "api_tokens_revoked": 1,
            },
        ):
            response = await client.post("/api/v1/admin/acme/users/2/anonymize")
        assert response.status_code == 200
        assert response.json()["api_tokens_revoked"] == 1
