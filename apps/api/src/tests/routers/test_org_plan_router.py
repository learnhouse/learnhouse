"""Router tests for src/routers/orgs/org_plan.py (internal plan update)."""

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.organization_config import OrganizationConfig
from src.db.organizations import Organization
from src.routers.orgs.org_plan import internal_router

KEY = "test-internal-key"
PATH = "/api/v1/cloud_internal/update_org_plan"
HDR = {"X-Internal-Key": KEY}


@pytest.fixture(autouse=True)
def _set_key(monkeypatch):
    monkeypatch.setenv("CLOUD_INTERNAL_KEY", KEY)


@pytest.fixture
def app(db):
    app = FastAPI()
    app.include_router(internal_router, prefix="/api/v1/cloud_internal")
    app.dependency_overrides[get_db_session] = lambda: db
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
async def client(app):
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


async def _add_org(db, org_id: int = 1, config: dict | None = None, with_config: bool = True):
    now = str(datetime.now())
    db.add(
        Organization(
            id=org_id,
            name="Org",
            slug=f"org-{org_id}",
            email="o@test.com",
            org_uuid=f"org_{org_id}",
            creation_date=now,
            update_date=now,
        )
    )
    if with_config:
        db.add(OrganizationConfig(org_id=org_id, config=config or {"config_version": "1.0"}))
    await db.commit()


async def test_update_plan_v1_sets_cloud_plan(client, db):
    await _add_org(db, config={"config_version": "1.0"})
    with patch(
        "src.routers.orgs.org_plan.update_org_with_config_no_auth", new=AsyncMock()
    ) as mock_update:
        res = await client.put(PATH, headers=HDR, json={"org_id": 1, "plan": "pro"})

    assert res.status_code == 200
    assert res.json()["plan"] == "pro"
    written_config = mock_update.call_args.args[1]
    assert written_config["cloud"]["plan"] == "pro"


async def test_update_plan_v2_sets_top_level_plan(client, db):
    await _add_org(db, config={"config_version": "2.0"})
    with patch(
        "src.routers.orgs.org_plan.update_org_with_config_no_auth", new=AsyncMock()
    ) as mock_update:
        res = await client.put(PATH, headers=HDR, json={"org_id": 1, "plan": "standard"})

    assert res.status_code == 200
    written_config = mock_update.call_args.args[1]
    assert written_config["plan"] == "standard"


async def test_invalid_key_is_forbidden(client, db):
    await _add_org(db)
    res = await client.put(
        PATH, headers={"X-Internal-Key": "wrong"}, json={"org_id": 1, "plan": "pro"}
    )
    assert res.status_code == 403


async def test_missing_key_is_unprocessable(client, db):
    res = await client.put(PATH, json={"org_id": 1, "plan": "pro"})
    assert res.status_code == 422


async def test_invalid_plan_is_rejected(client, db):
    await _add_org(db)
    res = await client.put(PATH, headers=HDR, json={"org_id": 1, "plan": "gold"})
    assert res.status_code == 422


async def test_org_not_found(client, db):
    res = await client.put(PATH, headers=HDR, json={"org_id": 999, "plan": "pro"})
    assert res.status_code == 404


async def test_org_config_not_found(client, db):
    await _add_org(db, with_config=False)
    res = await client.put(PATH, headers=HDR, json={"org_id": 1, "plan": "pro"})
    assert res.status_code == 404
