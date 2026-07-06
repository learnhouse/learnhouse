"""Tests for the free-plan organization cap (_enforce_free_org_cap)."""

from datetime import datetime

import pytest
from fastapi import HTTPException

from src.db.organization_config import OrganizationConfig
from src.db.organizations import Organization
from src.db.user_organizations import UserOrganization
from src.security.rbac.constants import ADMIN_ROLE_ID
from src.services.orgs.orgs import MAX_FREE_ORGS, _enforce_free_org_cap


class _User:
    """Minimal stand-in for an authenticated PublicUser (only .id is read)."""

    def __init__(self, user_id: int):
        self.id = user_id


async def _add_admin_org(db, user_id: int, org_id: int, plan: str | None = None):
    now = str(datetime.now())
    db.add(
        Organization(
            id=org_id,
            name=f"Org {org_id}",
            slug=f"org-{org_id}",
            email=f"o{org_id}@test.com",
            org_uuid=f"org_{org_id}",
            creation_date=now,
            update_date=now,
        )
    )
    config: dict = {"config_version": "1.0"}
    if plan is not None:
        config["cloud"] = {"plan": plan}
    db.add(OrganizationConfig(org_id=org_id, config=config))
    db.add(
        UserOrganization(
            user_id=user_id,
            org_id=org_id,
            role_id=ADMIN_ROLE_ID,
            creation_date=now,
            update_date=now,
        )
    )
    await db.commit()


async def test_cap_blocks_free_user_at_limit(db):
    user = _User(1)
    for i in range(1, MAX_FREE_ORGS + 1):
        await _add_admin_org(db, user_id=1, org_id=i)

    with pytest.raises(HTTPException) as exc:
        await _enforce_free_org_cap(user, db)

    assert exc.value.status_code == 403
    assert "Free plan is limited" in exc.value.detail


async def test_cap_exempts_user_with_paid_org(db):
    user = _User(1)
    for i in range(1, MAX_FREE_ORGS):
        await _add_admin_org(db, user_id=1, org_id=i)
    # One paid org among them exempts the user from the cap.
    await _add_admin_org(db, user_id=1, org_id=MAX_FREE_ORGS, plan="pro")

    # Should not raise.
    await _enforce_free_org_cap(user, db)


async def test_cap_allows_user_under_limit(db):
    user = _User(1)
    await _add_admin_org(db, user_id=1, org_id=1)

    # Under the limit — no query into configs, no raise.
    await _enforce_free_org_cap(user, db)
