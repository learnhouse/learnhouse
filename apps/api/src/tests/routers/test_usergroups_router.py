"""Router tests for src/routers/usergroups.py."""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.usergroup_resources import UserGroupResource
from src.db.usergroups import UserGroup, UserGroupCreate, UserGroupRead
from src.db.users import APITokenUser, UserRead
from src.routers.usergroups import router as usergroups_router
from src.security.auth import get_current_user
from src.services.users.usergroups import (
    create_usergroup,
    get_usergroups_by_resource,
)


@pytest.fixture
def app(db, admin_user):
    app = FastAPI()
    app.include_router(usergroups_router, prefix="/api/v1/usergroups")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: admin_user
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


def _mock_usergroup(**overrides) -> UserGroupRead:
    data = dict(
        id=1,
        org_id=1,
        name="UG",
        description="User group",
        usergroup_uuid="usergroup_test",
        creation_date="2024-01-01",
        update_date="2024-01-01",
    )
    data.update(overrides)
    return UserGroupRead(**data)


def _mock_user(**overrides) -> UserRead:
    data = dict(
        id=1,
        username="user",
        first_name="User",
        last_name="Test",
        email="user@test.com",
        avatar_image="",
        bio="",
        user_uuid="user_test",
        email_verified=True,
    )
    data.update(overrides)
    return UserRead(**data)


class TestUsergroupsRouter:
    async def test_crud_and_membership_endpoints(self, client):
        with patch("src.routers.usergroups.create_usergroup", new_callable=AsyncMock, return_value=_mock_usergroup()):
            response = await client.post("/api/v1/usergroups/", json={"name": "UG", "description": "User group", "org_id": 1})
        assert response.status_code == 200

        with patch("src.routers.usergroups.read_usergroup_by_id", new_callable=AsyncMock, return_value=_mock_usergroup()):
            response = await client.get("/api/v1/usergroups/1")
        assert response.status_code == 200

        with patch("src.routers.usergroups.get_users_linked_to_usergroup", new_callable=AsyncMock, return_value=[_mock_user()]):
            response = await client.get("/api/v1/usergroups/1/users")
        assert response.status_code == 200

        with patch("src.routers.usergroups.read_usergroups_by_org_id", new_callable=AsyncMock, return_value=[_mock_usergroup()]):
            response = await client.get("/api/v1/usergroups/org/1")
        assert response.status_code == 200

        with patch("src.routers.usergroups.get_resources_by_usergroup", new_callable=AsyncMock, return_value=["course_test"]):
            response = await client.get("/api/v1/usergroups/1/resources")
        assert response.status_code == 200

        with patch("src.routers.usergroups.get_usergroups_by_resource", new_callable=AsyncMock, return_value=[_mock_usergroup()]):
            response = await client.get("/api/v1/usergroups/resource/course_test")
        assert response.status_code == 200

        with patch("src.routers.usergroups.update_usergroup_by_id", new_callable=AsyncMock, return_value=_mock_usergroup(name="Updated")):
            response = await client.put("/api/v1/usergroups/1", json={"name": "Updated"})
        assert response.status_code == 200

        with patch("src.routers.usergroups.delete_usergroup_by_id", new_callable=AsyncMock, return_value="deleted"):
            response = await client.delete("/api/v1/usergroups/1")
        assert response.status_code == 200

        with patch("src.routers.usergroups.add_users_to_usergroup", new_callable=AsyncMock, return_value="ok"):
            response = await client.post("/api/v1/usergroups/1/add_users?user_ids=1,2")
        assert response.status_code == 200

        with patch("src.routers.usergroups.remove_users_from_usergroup", new_callable=AsyncMock, return_value="ok"):
            response = await client.request("DELETE", "/api/v1/usergroups/1/remove_users?user_ids=1,2")
        assert response.status_code == 200

        with patch("src.routers.usergroups.add_resources_to_usergroup", new_callable=AsyncMock, return_value="ok"):
            response = await client.post("/api/v1/usergroups/1/add_resources?resource_uuids=course_test")
        assert response.status_code == 200

        with patch("src.routers.usergroups.remove_resources_from_usergroup", new_callable=AsyncMock, return_value="ok"):
            response = await client.request("DELETE", "/api/v1/usergroups/1/remove_resources?resource_uuids=course_test")
        assert response.status_code == 200

    async def test_add_users_rejects_non_numeric_ids(self, client):
        # Non-numeric user_ids must be rejected with 422 before reaching the
        # service (which does int(uid) and would otherwise 500).
        with patch("src.routers.usergroups.add_users_to_usergroup", new_callable=AsyncMock) as service_mock:
            response = await client.post("/api/v1/usergroups/1/add_users?user_ids=1,abc")
        assert response.status_code == 422
        assert "integer user IDs" in response.json()["detail"]
        service_mock.assert_not_awaited()

    async def test_remove_users_rejects_non_numeric_ids(self, client):
        with patch("src.routers.usergroups.remove_users_from_usergroup", new_callable=AsyncMock) as service_mock:
            response = await client.request(
                "DELETE", "/api/v1/usergroups/1/remove_users?user_ids=1,xyz"
            )
        assert response.status_code == 422
        assert "integer user IDs" in response.json()["detail"]
        service_mock.assert_not_awaited()


class TestUsergroupsApiTokenOrgBoundary:
    """API tokens may manage usergroups, but never across their org boundary.

    The router admits API tokens (require_authenticated_user_or_api_token) and
    most handlers authorize against a real usergroup uuid, so the RBAC layer
    resolves the element's org and enforces the boundary. These tests lock down
    the two handlers that authorize against the ``usergroup_X`` placeholder —
    create (org from the request body) and get-by-resource (org from the
    resource) — where the placeholder's org resolves to None and the RBAC
    boundary check is skipped, so the service layer must guard the boundary.
    """

    def _token(self, org_id: int, **rights) -> APITokenUser:
        return APITokenUser(
            id=1,
            user_uuid="apitoken_test",
            username="api_token",
            org_id=org_id,
            rights=rights or None,
            token_name="Test Token",
            created_by_user_id=1,
        )

    async def test_create_usergroup_cross_org_rejected(self, db, org, other_org, mock_request):
        # Token scoped to `org` tries to create a group in `other_org` via the
        # request body — invisible to the global path/query org-boundary net.
        # Must 403 before any DB write.
        token = self._token(org.id, usergroups={"action_create": True})
        with pytest.raises(HTTPException) as exc:
            await create_usergroup(
                mock_request,
                db,
                token,
                UserGroupCreate(name="Cohort", description="", org_id=other_org.id),
            )
        assert exc.value.status_code == 403
        assert "outside its organization" in exc.value.detail

    async def test_get_usergroups_by_resource_cross_org_rejected(self, db, org, other_org, mock_request):
        # A usergroup + resource link living entirely in other_org.
        ug = UserGroup(
            org_id=other_org.id,
            name="Other",
            description="",
            usergroup_uuid="usergroup_other",
            creation_date="2024-01-01",
            update_date="2024-01-01",
        )
        db.add(ug)
        await db.commit()
        await db.refresh(ug)
        db.add(
            UserGroupResource(
                usergroup_id=ug.id,
                resource_uuid="course_other",
                org_id=other_org.id,
                creation_date="2024-01-01",
                update_date="2024-01-01",
            )
        )
        await db.commit()

        # Token scoped to `org` with read rights clears the placeholder RBAC
        # check, then the service must refuse because the resource is in other_org.
        token = self._token(org.id, usergroups={"action_read": True})
        with pytest.raises(HTTPException) as exc:
            await get_usergroups_by_resource(mock_request, db, token, "course_other")
        assert exc.value.status_code == 403
        assert "outside its organization" in exc.value.detail
