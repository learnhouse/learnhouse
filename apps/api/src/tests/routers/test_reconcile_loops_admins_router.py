"""Router tests for the Loops admin reconcile endpoint in
src/routers/orgs/org_plan.py (POST /cloud_internal/reconcile_loops_admins)."""

from datetime import datetime
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.organizations import Organization
from src.db.user_organizations import UserOrganization
from src.db.users import User
from src.routers.orgs.org_plan import internal_router

KEY = "test-internal-key"
PATH = "/api/v1/cloud_internal/reconcile_loops_admins"
HDR = {"X-Internal-Key": KEY}

ADMIN_ROLE_ID = 1
MEMBER_ROLE_ID = 4


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


async def _add_org(db, org_id: int):
    now = str(datetime.now())
    db.add(
        Organization(
            id=org_id,
            name=f"Org {org_id}",
            slug=f"org-{org_id}",
            email="o@test.com",
            org_uuid=f"org_{org_id}",
            creation_date=now,
            update_date=now,
        )
    )


async def _add_user(db, user_id: int, email: str):
    db.add(
        User(
            id=user_id,
            username=f"user{user_id}",
            first_name="First",
            last_name="Last",
            email=email,
            user_uuid=f"user_{user_id}",
        )
    )


async def _add_membership(db, user_id: int, org_id: int, role_id: int):
    now = str(datetime.now())
    db.add(
        UserOrganization(
            user_id=user_id,
            org_id=org_id,
            role_id=role_id,
            creation_date=now,
            update_date=now,
        )
    )


async def test_invalid_key_forbidden(client, db):
    res = await client.post(PATH, headers={"X-Internal-Key": "wrong"})
    assert res.status_code == 403


async def test_reconcile_syncs_admins_only_and_dedupes(client, db):
    # Two orgs. user1 is admin of BOTH orgs (must be synced once). user2 is
    # admin of org2. user3 is a MEMBER (must NOT be synced).
    await _add_org(db, 1)
    await _add_org(db, 2)
    await _add_user(db, 1, "admin1@test.com")
    await _add_user(db, 2, "admin2@test.com")
    await _add_user(db, 3, "member@test.com")
    await _add_membership(db, 1, 1, ADMIN_ROLE_ID)
    await _add_membership(db, 1, 2, ADMIN_ROLE_ID)  # duplicate admin user
    await _add_membership(db, 2, 2, ADMIN_ROLE_ID)
    await _add_membership(db, 3, 1, MEMBER_ROLE_ID)  # not an admin
    await db.commit()

    with patch("src.routers.orgs.org_plan.record_org_admin_in_loops") as mock_sync:
        res = await client.post(PATH, headers=HDR)

    assert res.status_code == 200
    body = res.json()
    assert body["admins_synced"] == 2  # user1 (deduped) + user2, not user3

    synced_emails = {c.kwargs["email"] for c in mock_sync.call_args_list}
    assert synced_emails == {"admin1@test.com", "admin2@test.com"}
    assert "member@test.com" not in synced_emails
    # each admin synced exactly once
    assert mock_sync.call_count == 2


async def test_reconcile_no_admins_returns_zero(client, db):
    await _add_org(db, 1)
    await _add_user(db, 1, "member@test.com")
    await _add_membership(db, 1, 1, MEMBER_ROLE_ID)
    await db.commit()

    with patch("src.routers.orgs.org_plan.record_org_admin_in_loops") as mock_sync:
        res = await client.post(PATH, headers=HDR)

    assert res.status_code == 200
    assert res.json()["admins_synced"] == 0
    mock_sync.assert_not_called()
