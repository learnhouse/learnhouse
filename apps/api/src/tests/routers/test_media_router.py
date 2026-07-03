"""
Router tests for src/routers/media/media.py

Drives every media endpoint through an httpx AsyncClient against the in-memory
SQLite DB, exercising the router and the media service. RBAC, webhooks and the
file-upload sink are stubbed; persistence + folder placement run for real.
"""

from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient
from fastapi import FastAPI

from src.core.events.database import get_db_session
from src.security.auth import get_current_user
from src.routers.media.media import router


@pytest.fixture
def app(db, admin_user):
    app = FastAPI()
    app.include_router(router, prefix="/api/v1/media")
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


@pytest.fixture(autouse=True)
def _bypass_rbac_and_webhooks():
    """create_media + the folder placement it triggers both gate via RBAC."""
    with patch(
        "src.services.media.media.check_resource_access", new_callable=AsyncMock
    ), patch(
        "src.services.folders.folders.check_resource_access", new_callable=AsyncMock
    ), patch(
        "src.services.folders.folders.dispatch_webhooks", new_callable=AsyncMock
    ):
        yield


class TestMediaRouter:
    async def test_create_embed_at_root(self, client, org):
        res = await client.post(
            "/api/v1/media/",
            data={
                "org_id": org.id,
                "name": "Intro video",
                "media_type": "EMBED",
                "url": "https://youtu.be/abc123",
                "public": "true",
            },
        )
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["media_uuid"].startswith("media_")
        assert body["url"] == "https://youtu.be/abc123"

    async def test_create_embed_into_folder(self, client, org, folder):
        res = await client.post(
            "/api/v1/media/",
            data={
                "org_id": org.id,
                "name": "Doc link",
                "media_type": "EMBED",
                "url": "https://example.com",
                "folder_uuid": folder.folder_uuid,
                "public": "true",
            },
        )
        assert res.status_code == 200, res.text

    async def test_create_embed_without_url_400(self, client, org):
        res = await client.post(
            "/api/v1/media/",
            data={"org_id": org.id, "name": "Bad", "media_type": "EMBED", "public": "true"},
        )
        assert res.status_code == 400

    async def test_create_upload_with_file(self, client, org):
        with patch(
            "src.services.media.media.upload_file",
            new_callable=AsyncMock,
            return_value="abc_media.pdf",
        ):
            res = await client.post(
                "/api/v1/media/",
                data={
                    "org_id": org.id,
                    "name": "Handout",
                    "media_type": "UPLOAD",
                    "public": "true",
                },
                files={"file": ("handout.pdf", b"%PDF-1.4 fake", "application/pdf")},
            )
        assert res.status_code == 200, res.text
        body = res.json()
        # file_id / storage_key are intentionally NOT exposed to clients now.
        assert "file_id" not in body
        assert "storage_key" not in body
        assert body["file_format"] == "pdf"

    async def test_create_upload_without_file_400(self, client, org):
        res = await client.post(
            "/api/v1/media/",
            data={"org_id": org.id, "name": "NoFile", "media_type": "UPLOAD", "public": "true"},
        )
        assert res.status_code == 400

    async def _make_embed(self, client, org, name="Item"):
        res = await client.post(
            "/api/v1/media/",
            data={
                "org_id": org.id,
                "name": name,
                "media_type": "EMBED",
                "url": "https://example.com",
                "public": "true",
            },
        )
        assert res.status_code == 200, res.text
        return res.json()["media_uuid"]

    async def test_get_media(self, client, org):
        uuid = await self._make_embed(client, org, "Gettable")
        res = await client.get(f"/api/v1/media/{uuid}")
        assert res.status_code == 200, res.text
        assert res.json()["name"] == "Gettable"

    async def test_list_media_for_org(self, client, org):
        await self._make_embed(client, org, "L1")
        await self._make_embed(client, org, "L2")
        res = await client.get(f"/api/v1/media/org/{org.id}/page/1/limit/10")
        assert res.status_code == 200, res.text
        names = {m["name"] for m in res.json()}
        assert {"L1", "L2"} <= names

    async def test_update_media(self, client, org):
        uuid = await self._make_embed(client, org, "Before")
        res = await client.put(f"/api/v1/media/{uuid}", json={"name": "After", "public": False})
        assert res.status_code == 200, res.text
        assert res.json()["name"] == "After"
        assert res.json()["public"] is False

    async def test_delete_media(self, client, org):
        uuid = await self._make_embed(client, org, "Doomed")
        res = await client.request("DELETE", f"/api/v1/media/{uuid}")
        assert res.status_code == 200, res.text
        gone = await client.get(f"/api/v1/media/{uuid}")
        assert gone.status_code == 404
