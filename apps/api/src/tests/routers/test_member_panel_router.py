"""Router tests for src/routers/orgs/member_panel.py."""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.routers.orgs.member_panel import router as member_panel_router
from src.security.auth import get_authenticated_user, get_current_user

MOD = "src.routers.orgs.member_panel"


@pytest.fixture
def app(db, admin_user):
    app = FastAPI()
    app.include_router(member_panel_router, prefix="/api/v1/orgs")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: admin_user
    app.dependency_overrides[get_authenticated_user] = lambda: admin_user
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def test_summary_route(client, admin_user):
    with patch(f"{MOD}.get_member_summary", new_callable=AsyncMock, return_value={"user": {"id": 2}}) as svc:
        response = await client.get("/api/v1/orgs/1/users/2/summary")
    assert response.status_code == 200 and response.json() == {"user": {"id": 2}}
    assert svc.call_args.args[:3] == (1, 2, admin_user)


async def test_assignments_route(client, admin_user):
    with patch(f"{MOD}.get_member_assignments", new_callable=AsyncMock, return_value={"items": [], "total": 0}) as svc:
        response = await client.get("/api/v1/orgs/1/users/2/assignments")
    assert response.status_code == 200 and response.json()["total"] == 0
    assert svc.call_args.args[:3] == (1, 2, admin_user)


async def test_activity_route_passes_paging(client, admin_user):
    with patch(f"{MOD}.get_member_activity", new_callable=AsyncMock, return_value={"items": [], "total": 0}) as svc:
        response = await client.get("/api/v1/orgs/1/users/2/activity?offset=10&limit=5")
    assert response.status_code == 200
    assert svc.call_args.args[:3] == (1, 2, admin_user) and svc.call_args.args[4:] == (10, 5)
    bad = await client.get("/api/v1/orgs/1/users/2/activity?limit=500")
    assert bad.status_code == 422


async def test_unenroll_route(client, admin_user):
    payload = {"user_id": 2, "course_uuid": "course_test", "unenrolled": True}
    with patch(f"{MOD}.unenroll_org_member", new_callable=AsyncMock, return_value=payload) as svc:
        response = await client.delete("/api/v1/orgs/1/users/2/enrollments/course_test")
    assert response.status_code == 200 and response.json() == payload
    assert svc.call_args.args[:4] == (1, 2, "course_test", admin_user)
