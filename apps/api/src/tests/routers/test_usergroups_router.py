"""Router tests for src/routers/usergroups.py."""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.usergroups import UserGroupRead
from src.db.users import UserRead
from src.routers.usergroups import router as usergroups_router
from src.security.auth import get_current_user


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
