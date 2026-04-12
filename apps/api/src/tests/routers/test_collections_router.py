"""
Router tests for src/routers/courses/collections.py

Covers: GET, POST, DELETE on /api/v1/collections/
"""

import pytest
from httpx import ASGITransport, AsyncClient
from fastapi import FastAPI

from src.core.events.database import get_db_session
from src.security.auth import get_current_user
from src.routers.courses.collections import router


@pytest.fixture
def app(db, admin_user):
    """Minimal FastAPI app with the collections router."""
    app = FastAPI()
    app.include_router(router, prefix="/api/v1/collections")
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


class TestGetCollection:
    """Tests for GET /api/v1/collections/{collection_uuid}."""

    async def test_get_collection(
        self, client, org, course, collection, bypass_rbac
    ):
        response = await client.get("/api/v1/collections/collection_test")

        assert response.status_code == 200
        body = response.json()
        assert body["name"] == "Test Collection"
        assert "courses" in body

    async def test_get_collection_not_found(
        self, client, org, bypass_rbac
    ):
        response = await client.get("/api/v1/collections/fake")

        assert response.status_code == 409


class TestGetCollectionsByOrg:
    """Tests for GET /api/v1/collections/org/{org_id}/page/{page}/limit/{limit}."""

    async def test_get_collections_by_org(
        self, client, org, course, collection, bypass_rbac
    ):
        response = await client.get("/api/v1/collections/org/1/page/1/limit/10")

        assert response.status_code == 200
        body = response.json()
        assert isinstance(body, list)
        assert len(body) >= 1


class TestCreateCollection:
    """Tests for POST /api/v1/collections/."""

    async def test_create_collection(
        self, client, org, course, bypass_rbac, bypass_webhooks
    ):
        payload = {
            "name": "New",
            "public": True,
            "courses": [1],
            "org_id": 1,
        }

        response = await client.post("/api/v1/collections/", json=payload)

        assert response.status_code == 200
        body = response.json()
        assert body["name"] == "New"
        assert "collection_uuid" in body


class TestDeleteCollection:
    """Tests for DELETE /api/v1/collections/{collection_uuid}."""

    async def test_delete_collection(
        self, client, org, course, collection, bypass_rbac
    ):
        response = await client.delete("/api/v1/collections/collection_test")

        assert response.status_code == 200
