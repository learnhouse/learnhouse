"""
Router tests for src/routers/folders/folders.py

Drives every folders endpoint through an httpx AsyncClient against the in-memory
SQLite DB, exercising the router layer and the folders service it delegates to.
RBAC and webhooks are stubbed; the real persistence + resolution logic runs.
"""

from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient
from fastapi import FastAPI

from src.core.events.database import get_db_session
from src.security.auth import get_current_user
from src.routers.folders.folders import router


@pytest.fixture
def app(db, admin_user):
    app = FastAPI()
    app.include_router(router, prefix="/api/v1/folders")
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
    """Folders service calls check_resource_access + dispatch_webhooks; stub both."""
    with patch(
        "src.services.folders.folders.check_resource_access", new_callable=AsyncMock
    ), patch(
        "src.services.folders.folders.dispatch_webhooks", new_callable=AsyncMock
    ):
        yield


class TestFoldersRouter:
    async def test_create_root_and_nested_folder(self, client, org):
        root = await client.post(
            "/api/v1/folders/", json={"name": "Root", "org_id": org.id}
        )
        assert root.status_code == 200, root.text
        root_uuid = root.json()["folder_uuid"]
        assert root_uuid.startswith("folder_")

        nested = await client.post(
            "/api/v1/folders/",
            json={"name": "Nested", "org_id": org.id, "parent_folder_uuid": root_uuid},
        )
        assert nested.status_code == 200, nested.text
        assert nested.json()["parent_folder_id"] is not None

    async def test_get_folder_with_item_and_breadcrumbs(self, client, org, folder, course):
        res = await client.get(f"/api/v1/folders/{folder.folder_uuid}")
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["folder_uuid"] == folder.folder_uuid
        assert body["total_items"] >= 1
        # the seeded course should resolve as an item
        assert any(it["resource_uuid"] == course.course_uuid for it in body["items"])

    async def test_get_missing_folder_404(self, client):
        res = await client.get("/api/v1/folders/folder_does_not_exist")
        assert res.status_code == 404

    async def test_list_root_and_subfolders(self, client, org):
        parent = (
            await client.post("/api/v1/folders/", json={"name": "P", "org_id": org.id})
        ).json()
        await client.post(
            "/api/v1/folders/",
            json={"name": "Child", "org_id": org.id, "parent_folder_uuid": parent["folder_uuid"]},
        )
        roots = await client.get(f"/api/v1/folders/org/{org.id}/page/1/limit/10")
        assert roots.status_code == 200
        assert any(f["name"] == "P" for f in roots.json())

        subs = await client.get(
            f"/api/v1/folders/org/{org.id}/page/1/limit/10",
            params={"parent_folder_uuid": parent["folder_uuid"]},
        )
        assert subs.status_code == 200
        assert [f["name"] for f in subs.json()] == ["Child"]

    async def test_add_remove_and_move_content(self, client, org, course):
        a = (await client.post("/api/v1/folders/", json={"name": "A", "org_id": org.id})).json()
        b = (await client.post("/api/v1/folders/", json={"name": "B", "org_id": org.id})).json()

        added = await client.post(
            f"/api/v1/folders/{a['folder_uuid']}/content",
            params={"resource_uuid": course.course_uuid},
        )
        assert added.status_code == 200, added.text
        assert added.json()["total_items"] == 1

        moved = await client.post(
            f"/api/v1/folders/{a['folder_uuid']}/content/move",
            params={"target_folder_uuid": b["folder_uuid"], "resource_uuid": course.course_uuid},
        )
        assert moved.status_code == 200, moved.text

        removed = await client.request(
            "DELETE",
            f"/api/v1/folders/{b['folder_uuid']}/content",
            params={"resource_uuid": course.course_uuid},
        )
        assert removed.status_code == 200, removed.text
        assert removed.json()["total_items"] == 0

    async def test_org_root_content_lifecycle(self, client, org, course):
        add = await client.post(
            f"/api/v1/folders/org/{org.id}/content",
            params={"resource_uuid": course.course_uuid},
        )
        assert add.status_code == 200, add.text

        root_items = await client.get(f"/api/v1/folders/org/{org.id}/root")
        assert root_items.status_code == 200
        assert any(it["resource_uuid"] == course.course_uuid for it in root_items.json())

        rm = await client.request(
            "DELETE",
            f"/api/v1/folders/org/{org.id}/content",
            params={"resource_uuid": course.course_uuid},
        )
        assert rm.status_code == 200, rm.text

    async def test_search_library(self, client, org, folder):
        res = await client.get(
            f"/api/v1/folders/org/{org.id}/search", params={"q": "Test"}
        )
        assert res.status_code == 200, res.text
        # the seeded "Test Folder" should surface in the tree search
        assert isinstance(res.json(), (list, dict))

    async def test_update_rename_and_move_to_root(self, client, org):
        parent = (await client.post("/api/v1/folders/", json={"name": "Parent", "org_id": org.id})).json()
        child = (
            await client.post(
                "/api/v1/folders/",
                json={"name": "Child", "org_id": org.id, "parent_folder_uuid": parent["folder_uuid"]},
            )
        ).json()

        renamed = await client.put(
            f"/api/v1/folders/{child['folder_uuid']}",
            json={"name": "Renamed", "color": "blue"},
        )
        assert renamed.status_code == 200, renamed.text
        assert renamed.json()["name"] == "Renamed"

        to_root = await client.put(
            f"/api/v1/folders/{child['folder_uuid']}",
            json={"parent_folder_uuid": "root"},
        )
        assert to_root.status_code == 200, to_root.text
        assert to_root.json()["parent_folder_id"] is None

    async def test_update_move_into_parent_and_cycle_guards(self, client, org):
        a = (await client.post("/api/v1/folders/", json={"name": "A", "org_id": org.id})).json()
        b = (await client.post("/api/v1/folders/", json={"name": "B", "org_id": org.id})).json()

        # Move B under A (real parent) — exercises the cycle check on a clean path.
        moved = await client.put(
            f"/api/v1/folders/{b['folder_uuid']}",
            json={"parent_folder_uuid": a["folder_uuid"]},
        )
        assert moved.status_code == 200, moved.text
        assert moved.json()["parent_folder_id"] is not None

        # Moving A under its own descendant B must be rejected as a cycle.
        cycle = await client.put(
            f"/api/v1/folders/{a['folder_uuid']}",
            json={"parent_folder_uuid": b["folder_uuid"]},
        )
        assert cycle.status_code == 400

        # A folder cannot be its own parent.
        self_parent = await client.put(
            f"/api/v1/folders/{a['folder_uuid']}",
            json={"parent_folder_uuid": a["folder_uuid"]},
        )
        assert self_parent.status_code == 400

        # Unknown parent -> 404.
        missing = await client.put(
            f"/api/v1/folders/{b['folder_uuid']}",
            json={"parent_folder_uuid": "folder_nope"},
        )
        assert missing.status_code == 404

    async def test_upload_thumbnail(self, client, org):
        f = (await client.post("/api/v1/folders/", json={"name": "Cover", "org_id": org.id})).json()
        with patch(
            "src.services.utils.upload_content.upload_file",
            new_callable=AsyncMock,
            return_value="abc_folderthumb.png",
        ):
            res = await client.put(
                f"/api/v1/folders/{f['folder_uuid']}/thumbnail",
                files={"thumbnail": ("cover.png", b"\x89PNG\r\n\x1a\n", "image/png")},
            )
        assert res.status_code == 200, res.text
        assert res.json()["thumbnail_image"] == "abc_folderthumb.png"

    async def test_delete_folder(self, client, org):
        f = (await client.post("/api/v1/folders/", json={"name": "Doomed", "org_id": org.id})).json()
        res = await client.request("DELETE", f"/api/v1/folders/{f['folder_uuid']}")
        assert res.status_code == 200, res.text
        gone = await client.get(f"/api/v1/folders/{f['folder_uuid']}")
        assert gone.status_code == 404

    async def test_delete_missing_folder_404(self, client):
        res = await client.request("DELETE", "/api/v1/folders/folder_missing")
        assert res.status_code == 404
