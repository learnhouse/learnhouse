"""
Router tests for src/routers/users.py

Uses httpx AsyncClient with a minimal FastAPI app containing only the
users router. The id/uuid/username endpoints use get_authenticated_user
(not get_current_user), so both dependencies are overridden.

Service functions are patched at the router import level to isolate
from database queries and external dependencies (Redis, config, etc.).
"""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.users import UserReadPublic
from src.routers.users import router as users_router
from src.security.auth import get_current_user, get_authenticated_user


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


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


def _mock_user_public(**overrides) -> UserReadPublic:
    """Build a minimal UserReadPublic for mocked service returns."""
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
    return UserReadPublic(**data)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestGetProfile:
    async def test_get_profile(self, client):
        """GET /profile returns the current user (injected via dependency override)."""
        response = await client.get("/api/v1/users/profile")

        assert response.status_code == 200
        body = response.json()
        assert "username" in body
        assert body["username"] == "admin"


class TestGetUserById:
    async def test_get_user_by_id(self, client):
        mock_user = _mock_user_public()
        with patch(
            "src.routers.users.read_user_by_id",
            new_callable=AsyncMock,
            return_value=mock_user,
        ):
            response = await client.get("/api/v1/users/id/1")

        assert response.status_code == 200
        body = response.json()
        assert "user_uuid" in body
        assert body["user_uuid"] == "user_admin"

    async def test_get_user_by_id_not_found(self, client):
        with patch(
            "src.routers.users.read_user_by_id",
            new_callable=AsyncMock,
            side_effect=HTTPException(status_code=404, detail="User not found"),
        ):
            response = await client.get("/api/v1/users/id/999")

        assert response.status_code == 404


class TestGetUserByUuid:
    async def test_get_user_by_uuid(self, client):
        mock_user = _mock_user_public()
        with patch(
            "src.routers.users.read_user_by_uuid",
            new_callable=AsyncMock,
            return_value=mock_user,
        ):
            response = await client.get("/api/v1/users/uuid/user_admin")

        assert response.status_code == 200
        body = response.json()
        assert body["user_uuid"] == "user_admin"

    async def test_get_user_by_uuid_not_found(self, client):
        with patch(
            "src.routers.users.read_user_by_uuid",
            new_callable=AsyncMock,
            side_effect=HTTPException(
                status_code=404, detail="User not found"
            ),
        ):
            response = await client.get("/api/v1/users/uuid/nonexistent")

        assert response.status_code == 404


class TestGetUserByUsername:
    async def test_get_user_by_username(self, client):
        mock_user = _mock_user_public()
        with patch(
            "src.routers.users.read_user_by_username",
            new_callable=AsyncMock,
            return_value=mock_user,
        ):
            response = await client.get("/api/v1/users/username/admin")

        assert response.status_code == 200
        body = response.json()
        assert body["username"] == "admin"

    async def test_get_user_by_username_not_found(self, client):
        with patch(
            "src.routers.users.read_user_by_username",
            new_callable=AsyncMock,
            side_effect=HTTPException(
                status_code=404, detail="User not found"
            ),
        ):
            response = await client.get("/api/v1/users/username/nonexistent")

        assert response.status_code == 404


class TestBulkImport:
    """POST /{org_id}/bulk-import — CSV upload that creates users and enrollments."""

    @staticmethod
    def _result(**overrides):
        from src.services.users.bulk_import import BulkImportResult
        defaults = dict(
            rows_processed=0,
            users_created=0,
            users_skipped_existing=0,
            users_failed=0,
            enrollments_added=0,
            usergroup_assignments_added=0,
            errors=[],
        )
        defaults.update(overrides)
        return BulkImportResult(**defaults)

    async def test_bulk_import_success(self, client):
        csv_body = (
            "email,first_name,last_name\n"
            "alice@school.pt,Alice,Silva\n"
            "bob@school.pt,Bob,Costa\n"
        )
        with patch(
            "src.routers.users.bulk_import_users_from_csv",
            new_callable=AsyncMock,
            return_value=self._result(rows_processed=2, users_created=2),
        ):
            response = await client.post(
                "/api/v1/users/1/bulk-import",
                files={"file": ("import.csv", csv_body, "text/csv")},
            )

        assert response.status_code == 200
        body = response.json()
        assert body["rows_processed"] == 2
        assert body["users_created"] == 2
        assert body["errors"] == []

    async def test_bulk_import_rejects_non_csv_content_type(self, client):
        response = await client.post(
            "/api/v1/users/1/bulk-import",
            files={"file": ("import.json", b"{}", "application/json")},
        )

        assert response.status_code == 400
        assert "CSV" in response.json()["detail"]

    async def test_bulk_import_rejects_non_utf8(self, client):
        # 0xC0 is an invalid UTF-8 start byte
        bad_bytes = b"email\nbad\xc0byte\n"
        response = await client.post(
            "/api/v1/users/1/bulk-import",
            files={"file": ("import.csv", bad_bytes, "text/csv")},
        )

        assert response.status_code == 400
        assert "UTF-8" in response.json()["detail"]

    async def test_bulk_import_propagates_service_errors(self, client):
        with patch(
            "src.routers.users.bulk_import_users_from_csv",
            new_callable=AsyncMock,
            side_effect=HTTPException(status_code=400, detail="CSV missing required columns: ['email']"),
        ):
            response = await client.post(
                "/api/v1/users/1/bulk-import",
                files={"file": ("import.csv", b"name\nfoo\n", "text/csv")},
            )

        assert response.status_code == 400
        assert "missing required columns" in response.json()["detail"]


class TestBulkExport:
    """GET /{org_id}/bulk-export — CSV stream of users in the organization."""

    async def test_bulk_export_success(self, client):
        csv_payload = (
            "email,first_name,last_name,username,role_id,user_groups\n"
            "alice@school.pt,Alice,Silva,alice,4,1|2\n"
        )
        with patch(
            "src.routers.users.export_users_to_csv",
            new_callable=AsyncMock,
            return_value=csv_payload,
        ):
            response = await client.get("/api/v1/users/1/bulk-export")

        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/csv")
        assert "attachment" in response.headers["content-disposition"]
        assert "users-export-org-1" in response.headers["content-disposition"]
        body = response.text
        assert body.startswith("email,first_name,last_name,username,role_id,user_groups")
        assert "alice@school.pt" in body

    async def test_bulk_export_with_usergroup_filter(self, client):
        with patch(
            "src.routers.users.export_users_to_csv",
            new_callable=AsyncMock,
            return_value="email\nbob@school.pt\n",
        ) as mock_export:
            response = await client.get("/api/v1/users/1/bulk-export?usergroup_id=42")

        assert response.status_code == 200
        # Verify the service got the filter argument
        kwargs = mock_export.call_args.kwargs
        assert kwargs["usergroup_id"] == 42
        assert "usergroup-42" in response.headers["content-disposition"]

    async def test_bulk_export_org_not_found(self, client):
        with patch(
            "src.routers.users.export_users_to_csv",
            new_callable=AsyncMock,
            side_effect=HTTPException(status_code=404, detail="Organization not found"),
        ):
            response = await client.get("/api/v1/users/999/bulk-export")

        assert response.status_code == 404


class TestBulkUpdate:
    """POST /{org_id}/bulk-update — CSV upload that updates existing users."""

    @staticmethod
    def _result(**overrides):
        from src.services.users.bulk_update import BulkUpdateResult
        defaults = dict(
            rows_processed=0,
            users_updated=0,
            users_not_found=0,
            users_failed=0,
            enrollments_added=0,
            usergroup_assignments_added=0,
            errors=[],
        )
        defaults.update(overrides)
        return BulkUpdateResult(**defaults)

    async def test_bulk_update_success(self, client):
        csv_body = "email,first_name\nalice@school.pt,Alice\n"
        with patch(
            "src.routers.users.bulk_update_users_from_csv",
            new_callable=AsyncMock,
            return_value=self._result(rows_processed=1, users_updated=1),
        ):
            response = await client.post(
                "/api/v1/users/1/bulk-update",
                files={"file": ("update.csv", csv_body, "text/csv")},
            )

        assert response.status_code == 200
        assert response.json()["users_updated"] == 1

    async def test_bulk_update_user_not_found_reported(self, client):
        from src.services.users.bulk_import import BulkImportError
        with patch(
            "src.routers.users.bulk_update_users_from_csv",
            new_callable=AsyncMock,
            return_value=self._result(
                rows_processed=1,
                users_not_found=1,
                errors=[BulkImportError(row=1, email="ghost@x.pt", error="User not found in this organization")],
            ),
        ):
            response = await client.post(
                "/api/v1/users/1/bulk-update",
                files={"file": ("update.csv", b"email\nghost@x.pt\n", "text/csv")},
            )

        body = response.json()
        assert body["users_not_found"] == 1
        assert body["errors"][0]["email"] == "ghost@x.pt"


class TestBulkUnenroll:
    """POST /{org_id}/bulk-unenroll — CSV upload that removes memberships and enrollments."""

    @staticmethod
    def _result(**overrides):
        from src.services.users.bulk_unenroll import BulkUnenrollResult
        defaults = dict(
            rows_processed=0,
            users_not_found=0,
            users_failed=0,
            enrollments_removed=0,
            usergroup_assignments_removed=0,
            errors=[],
        )
        defaults.update(overrides)
        return BulkUnenrollResult(**defaults)

    async def test_bulk_unenroll_success(self, client):
        csv_body = "email,courses\nalice@school.pt,course_abc\n"
        with patch(
            "src.routers.users.bulk_unenroll_users_from_csv",
            new_callable=AsyncMock,
            return_value=self._result(rows_processed=1, enrollments_removed=1),
        ):
            response = await client.post(
                "/api/v1/users/1/bulk-unenroll",
                files={"file": ("unenroll.csv", csv_body, "text/csv")},
            )

        assert response.status_code == 200
        assert response.json()["enrollments_removed"] == 1

    async def test_bulk_unenroll_rejects_non_csv(self, client):
        response = await client.post(
            "/api/v1/users/1/bulk-unenroll",
            files={"file": ("payload.json", b"{}", "application/json")},
        )
        assert response.status_code == 400


class TestBulkTemplates:
    """GET /{org_id}/bulk-import/template.csv and bulk-unenroll/template.csv."""

    async def test_import_template_returns_csv(self, client):
        response = await client.get("/api/v1/users/1/bulk-import/template.csv")

        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/csv")
        assert "bulk-import-template.csv" in response.headers["content-disposition"]
        # First line should be the header — must include `email`
        first_line = response.text.splitlines()[0]
        assert "email" in first_line
        assert "user_groups" in first_line
        assert "courses" in first_line
        assert "collections" in first_line

    async def test_unenroll_template_returns_csv(self, client):
        response = await client.get("/api/v1/users/1/bulk-unenroll/template.csv")

        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/csv")
        assert "bulk-unenroll-template.csv" in response.headers["content-disposition"]
        first_line = response.text.splitlines()[0]
        # Unenroll template should NOT include create-only fields
        assert "password" not in first_line
        assert "first_name" not in first_line
        assert "email" in first_line
