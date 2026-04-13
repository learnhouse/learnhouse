"""Router tests for src/routers/orgs/orgs.py."""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.organizations import OrganizationRead
from src.routers.orgs.orgs import router as orgs_router
from src.security.auth import get_authenticated_user, get_current_user
from src.security.features_utils.dependencies import require_org_admin


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def app(db, admin_user):
    app = FastAPI()
    app.include_router(orgs_router, prefix="/api/v1/orgs")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: admin_user
    app.dependency_overrides[get_authenticated_user] = lambda: admin_user
    app.dependency_overrides[require_org_admin] = lambda: True
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


def _mock_org_read(**overrides) -> OrganizationRead:
    """Build a minimal OrganizationRead for mocked service returns."""
    data = dict(
        id=1,
        name="Test Org",
        slug="test-org",
        email="test@org.com",
        org_uuid="org_test",
        creation_date="2024-01-01",
        update_date="2024-01-01",
    )
    data.update(overrides)
    return OrganizationRead(**data)


def _org_config_payload():
    return {
        "config_version": "1.4",
        "general": {
            "enabled": True,
            "color": "",
            "footer_text": "",
            "watermark": True,
            "favicon_image": "",
            "auth_branding": {
                "welcome_message": "",
                "background_type": "gradient",
                "background_image": "",
                "text_color": "light",
            },
        },
        "features": {
            "courses": {"enabled": True, "limit": 10},
            "members": {"enabled": True, "signup_mode": "open", "admin_limit": 1, "limit": 10},
            "usergroups": {"enabled": True, "limit": 10},
            "storage": {"enabled": True, "limit": 10},
            "ai": {"enabled": True, "limit": 10, "model": ""},
            "assignments": {"enabled": False, "limit": 10},
            "payments": {"enabled": False},
            "discussions": {"enabled": True, "limit": 10},
            "communities": {"enabled": True},
            "collections": {"enabled": True},
            "analytics": {"enabled": True, "limit": 10},
            "collaboration": {"enabled": True, "limit": 10},
            "api": {"enabled": True, "limit": 10},
            "podcasts": {"enabled": False, "limit": 10},
            "boards": {"enabled": False, "limit": 10},
            "playgrounds": {"enabled": False, "limit": 10},
        },
        "cloud": {"plan": "free", "custom_domain": False},
        "landing": {},
        "seo": {
            "default_meta_title_suffix": "",
            "default_meta_description": "",
            "default_og_image": "",
            "google_site_verification": "",
            "twitter_handle": "",
            "noindex_communities": False,
        },
    }


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestGetOrgBySlug:
    async def test_get_org_by_slug(self, client):
        mock_org = _mock_org_read()
        with patch(
            "src.routers.orgs.orgs.get_organization_by_slug",
            new_callable=AsyncMock,
            return_value=mock_org,
        ):
            response = await client.get("/api/v1/orgs/slug/test-org")

        assert response.status_code == 200
        body = response.json()
        assert "name" in body
        assert body["name"] == "Test Org"
        assert body["slug"] == "test-org"

    async def test_get_org_by_slug_not_found(self, client):
        with patch(
            "src.routers.orgs.orgs.get_organization_by_slug",
            new_callable=AsyncMock,
            side_effect=HTTPException(
                status_code=404, detail="Organization not found"
            ),
        ):
            response = await client.get("/api/v1/orgs/slug/nonexistent")

        assert response.status_code == 404


class TestGetOrgByUuid:
    async def test_get_org_by_uuid(self, client):
        mock_org = _mock_org_read()
        with patch(
            "src.routers.orgs.orgs.get_organization_by_uuid",
            new_callable=AsyncMock,
            return_value=mock_org,
        ):
            response = await client.get("/api/v1/orgs/uuid/org_test")

        assert response.status_code == 200
        body = response.json()
        assert body["org_uuid"] == "org_test"
        assert body["name"] == "Test Org"

    async def test_get_org_by_uuid_not_found(self, client):
        with patch(
            "src.routers.orgs.orgs.get_organization_by_uuid",
            new_callable=AsyncMock,
            side_effect=HTTPException(
                status_code=404, detail="Organization not found"
            ),
        ):
            response = await client.get("/api/v1/orgs/uuid/nonexistent")

        assert response.status_code == 404


class TestOrgCrudEndpoints:
    async def test_create_org(self, client):
        with patch(
            "src.routers.orgs.orgs.create_org",
            new_callable=AsyncMock,
            return_value=_mock_org_read(),
        ):
            response = await client.post(
                "/api/v1/orgs/",
                json={"name": "Test Org", "slug": "test-org", "email": "test@org.com"},
            )

        assert response.status_code == 200
        assert response.json()["org_uuid"] == "org_test"

    async def test_create_org_with_config(self, client):
        with patch(
            "src.routers.orgs.orgs.create_org_with_config",
            new_callable=AsyncMock,
            return_value=_mock_org_read(),
        ):
            response = await client.post(
                "/api/v1/orgs/withconfig/",
                json={
                    "org_object": {
                        "name": "Test Org",
                        "slug": "test-org",
                        "email": "test@org.com",
                    },
                    "config_object": _org_config_payload(),
                },
            )

        assert response.status_code == 200
        assert response.json()["slug"] == "test-org"

    async def test_update_org(self, client):
        with patch(
            "src.routers.orgs.orgs.update_org",
            new_callable=AsyncMock,
            return_value=_mock_org_read(name="Updated Org"),
        ):
            response = await client.put("/api/v1/orgs/1", json={"name": "Updated Org"})

        assert response.status_code == 200
        assert response.json()["name"] == "Updated Org"

    async def test_delete_org(self, client):
        with patch(
            "src.routers.orgs.orgs.delete_org",
            new_callable=AsyncMock,
            return_value={"detail": "deleted"},
        ):
            response = await client.delete("/api/v1/orgs/1")

        assert response.status_code == 200
        assert response.json()["detail"] == "deleted"


class TestOrgUserEndpoints:
    async def test_export_org_users(self, client):
        with patch(
            "src.routers.orgs.orgs.export_organization_users_csv",
            new_callable=AsyncMock,
            return_value={"detail": "exported"},
        ):
            response = await client.get("/api/v1/orgs/1/users/export")

        assert response.status_code == 200
        assert response.json()["detail"] == "exported"

    async def test_get_org_users(self, client):
        with patch(
            "src.routers.orgs.orgs.get_organization_users",
            new_callable=AsyncMock,
            return_value={"users": []},
        ):
            response = await client.get("/api/v1/orgs/1/users?page=1&limit=20")

        assert response.status_code == 200
        assert response.json()["users"] == []

    async def test_join_org(self, client):
        with patch(
            "src.routers.orgs.orgs.join_org",
            new_callable=AsyncMock,
            return_value={"detail": "joined"},
        ):
            response = await client.post(
                "/api/v1/orgs/join",
                json={"org_id": 1, "user_id": 1, "invite_code": "abc123"},
            )

        assert response.status_code == 200
        assert response.json()["detail"] == "joined"

    async def test_update_user_role(self, client):
        with patch(
            "src.routers.orgs.orgs.update_user_role",
            new_callable=AsyncMock,
            return_value={"detail": "updated"},
        ):
            response = await client.put("/api/v1/orgs/1/users/2/role/role_test")

        assert response.status_code == 200
        assert response.json()["detail"] == "updated"

    async def test_remove_batch_users_from_org(self, client):
        with patch(
            "src.routers.orgs.orgs.remove_batch_users_from_org",
            new_callable=AsyncMock,
            return_value={"removed": 2},
        ):
            response = await client.delete(
                "/api/v1/orgs/1/users/batch/remove?user_ids=2&user_ids=3"
            )

        assert response.status_code == 200
        assert response.json()["removed"] == 2

    async def test_remove_user_from_org(self, client):
        with patch(
            "src.routers.orgs.orgs.remove_user_from_org",
            new_callable=AsyncMock,
            return_value={"removed": 1},
        ):
            response = await client.delete("/api/v1/orgs/1/users/2")

        assert response.status_code == 200
        assert response.json()["removed"] == 1


class TestOrgConfigEndpoints:
    async def test_update_signup_mechanism(self, client):
        with patch(
            "src.routers.orgs.orgs.update_org_signup_mechanism",
            new_callable=AsyncMock,
            return_value={"signup_mode": "open"},
        ):
            response = await client.put(
                "/api/v1/orgs/1/signup_mechanism?signup_mechanism=open"
            )

        assert response.status_code == 200
        assert response.json()["signup_mode"] == "open"

    @pytest.mark.parametrize(
        ("path", "target", "params"),
        [
            ("/api/v1/orgs/1/config/ai", "update_org_ai_config", {"ai_enabled": "true", "copilot_enabled": "false"}),
            ("/api/v1/orgs/1/config/communities", "update_org_communities_config", {"communities_enabled": "true"}),
            ("/api/v1/orgs/1/config/payments", "update_org_payments_config", {"payments_enabled": "true"}),
            ("/api/v1/orgs/1/config/courses", "update_org_courses_config", {"courses_enabled": "true"}),
            ("/api/v1/orgs/1/config/collections", "update_org_collections_config", {"collections_enabled": "true"}),
            ("/api/v1/orgs/1/config/podcasts", "update_org_podcasts_config", {"podcasts_enabled": "true"}),
            ("/api/v1/orgs/1/config/boards", "update_org_boards_config", {"boards_enabled": "true"}),
            ("/api/v1/orgs/1/config/playgrounds", "update_org_playgrounds_config", {"playgrounds_enabled": "true"}),
            ("/api/v1/orgs/1/config/color", "update_org_color_config", {"color": "#fff"}),
            ("/api/v1/orgs/1/config/font", "update_org_font_config", {"font": "Geist"}),
            ("/api/v1/orgs/1/config/footer_text", "update_org_footer_text_config", {"footer_text": "Footer"}),
            ("/api/v1/orgs/1/config/watermark", "update_org_watermark_config", {"watermark_enabled": "false"}),
        ],
    )
    async def test_simple_config_endpoints(self, client, path, target, params):
        with patch(
            f"src.routers.orgs.orgs.{target}",
            new_callable=AsyncMock,
            return_value={"ok": True},
        ):
            response = await client.put(path, params=params)

        assert response.status_code == 200
        assert response.json()["ok"] is True

    async def test_update_auth_branding(self, client):
        with patch(
            "src.routers.orgs.orgs.update_org_auth_branding_config",
            new_callable=AsyncMock,
            return_value={"ok": True},
        ):
            response = await client.put(
                "/api/v1/orgs/1/config/auth_branding",
                json={
                    "welcome_message": "Welcome",
                    "background_type": "gradient",
                    "background_image": "",
                    "text_color": "light",
                },
            )

        assert response.status_code == 200
        assert response.json()["ok"] is True

    async def test_update_seo_config(self, client):
        with patch(
            "src.routers.orgs.orgs.update_org_seo_config",
            new_callable=AsyncMock,
            return_value={"ok": True},
        ):
            response = await client.put(
                "/api/v1/orgs/1/config/seo",
                json={
                    "default_meta_title_suffix": "",
                    "default_meta_description": "",
                    "default_og_image": "",
                    "google_site_verification": "",
                    "twitter_handle": "",
                    "noindex_communities": False,
                },
            )

        assert response.status_code == 200
        assert response.json()["ok"] is True


class TestInviteEndpoints:
    @pytest.mark.parametrize(
        ("method", "path", "target", "kwargs"),
        [
            ("post", "/api/v1/orgs/1/invites", "create_invite_code", {}),
            ("get", "/api/v1/orgs/1/invites", "get_invite_codes", {}),
            ("get", "/api/v1/orgs/1/invites/code/abc123", "get_invite_code", {}),
            ("delete", "/api/v1/orgs/1/invites/invite_uuid", "delete_invite_code", {}),
            ("post", "/api/v1/orgs/1/invites/users/batch?emails=a@test.com,b@test.com", "invite_batch_users", {}),
            ("get", "/api/v1/orgs/1/invites/users", "get_list_of_invited_users", {}),
            ("delete", "/api/v1/orgs/1/invites/users/a@test.com", "remove_invited_user", {}),
        ],
    )
    async def test_invite_endpoints(self, client, method, path, target, kwargs):
        with patch(
            f"src.routers.orgs.orgs.{target}",
            new_callable=AsyncMock,
            return_value={"ok": True},
        ):
            response = await getattr(client, method)(path, **kwargs)

        assert response.status_code == 200
        assert response.json()["ok"] is True


class TestUploadAndListingEndpoints:
    @pytest.mark.parametrize(
        ("path", "target", "file_field", "filename"),
        [
            ("/api/v1/orgs/1/logo", "update_org_logo", "logo_file", "logo.png"),
            ("/api/v1/orgs/1/favicon", "update_org_favicon", "favicon_file", "favicon.png"),
            ("/api/v1/orgs/1/thumbnail", "update_org_thumbnail", "thumbnail_file", "thumb.png"),
            ("/api/v1/orgs/1/preview", "update_org_preview", "preview_file", "preview.png"),
            ("/api/v1/orgs/1/auth_background", "upload_org_auth_background_service", "background_file", "background.png"),
            ("/api/v1/orgs/1/og_image", "upload_org_og_image_service", "og_image_file", "og.png"),
            ("/api/v1/orgs/1/landing/content", "upload_org_landing_content_service", "content_file", "landing.html"),
        ],
    )
    async def test_upload_endpoints(self, client, path, target, file_field, filename):
        with patch(
            f"src.routers.orgs.orgs.{target}",
            new_callable=AsyncMock,
            return_value={"ok": True},
        ):
            response = await client.put(path, files={file_field: (filename, b"data", "application/octet-stream")}) if path != "/api/v1/orgs/1/landing/content" else await client.post(path, files={file_field: (filename, b"data", "application/octet-stream")})

        assert response.status_code == 200
        assert response.json()["ok"] is True

    async def test_get_user_orgs(self, client):
        with patch(
            "src.routers.orgs.orgs.get_orgs_by_user",
            new_callable=AsyncMock,
            return_value=[_mock_org_read()],
        ):
            response = await client.get("/api/v1/orgs/user/page/1/limit/10")

        assert response.status_code == 200
        assert response.json()[0]["org_uuid"] == "org_test"

    async def test_get_user_admin_orgs(self, client):
        with patch(
            "src.routers.orgs.orgs.get_orgs_by_user_admin",
            new_callable=AsyncMock,
            return_value=[_mock_org_read()],
        ):
            response = await client.get("/api/v1/orgs/user_admin/page/1/limit/10")

        assert response.status_code == 200
        assert response.json()[0]["org_uuid"] == "org_test"

    async def test_update_org_landing(self, client):
        with patch(
            "src.routers.orgs.orgs.update_org_landing",
            new_callable=AsyncMock,
            return_value={"ok": True},
        ):
            response = await client.put("/api/v1/orgs/1/landing", json={"hero": "value"})

        assert response.status_code == 200
        assert response.json()["ok"] is True

    async def test_get_org_usage(self, client):
        with patch(
            "src.services.orgs.usage.get_org_usage_and_limits",
            new_callable=AsyncMock,
            return_value={"usage": {}},
        ):
            response = await client.get("/api/v1/orgs/1/usage")

        assert response.status_code == 200
        assert response.json()["usage"] == {}
