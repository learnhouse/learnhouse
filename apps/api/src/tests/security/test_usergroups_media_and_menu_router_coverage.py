"""Targeted coverage tests.

1) src/services/users/usergroups.py lines 74-75: the media branch in
   _validate_resource_exists_and_belongs_to_org, exercised via
   add_resources_to_usergroup with a media_ uuid.
2) src/routers/orgs/orgs.py line 749: the api_update_org_menu_config
   PUT /{org_id}/config/menu endpoint that calls update_org_menu_config.
"""

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from src.core.events.database import get_db_session
from src.db.media.media import Media
from src.db.organization_config import OrganizationConfig
from src.db.usergroups import UserGroup
from src.db.usergroup_resources import UserGroupResource
from src.routers.orgs.orgs import router as orgs_router
from src.security.auth import get_authenticated_user, get_current_user
from src.security.features_utils.dependencies import require_org_admin
from src.services.users.usergroups import add_resources_to_usergroup


# ---------------------------------------------------------------------------
# 1) usergroups.py media branch (lines 74-75)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_add_media_resource_to_usergroup_hits_media_branch(
    db, org, admin_user, mock_request
):
    media = Media(
        name="Test Media",
        org_id=org.id,
        media_uuid="media_test",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(media)

    usergroup = UserGroup(
        name="Test UserGroup",
        description="A test usergroup",
        org_id=org.id,
        usergroup_uuid="usergroup_test",
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(usergroup)
    await db.commit()
    await db.refresh(usergroup)

    with patch(
        "src.services.users.usergroups.rbac_check",
        new_callable=AsyncMock,
    ), patch(
        "src.services.users.usergroups.dispatch_webhooks",
        new_callable=AsyncMock,
    ):
        result = await add_resources_to_usergroup(
            mock_request,
            db,
            admin_user,
            usergroup.id,
            "media_test",
        )

    assert result == "Resources added to UserGroup successfully"

    # Verify the link was actually created (the media branch resolved the row).
    from sqlmodel import select

    link = (
        await db.execute(
            select(UserGroupResource).where(
                UserGroupResource.usergroup_id == usergroup.id,
                UserGroupResource.resource_uuid == "media_test",
            )
        )
    ).scalars().first()
    assert link is not None


# ---------------------------------------------------------------------------
# 2) orgs router PUT /{org_id}/config/menu (line 749)
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


@pytest.mark.asyncio
async def test_update_org_menu_config_endpoint(client, db, org):
    org_config = OrganizationConfig(
        org_id=org.id,
        config={"config_version": "2.0", "customization": {}},
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(org_config)
    await db.commit()

    with patch(
        "src.services.orgs.orgs.rbac_check",
        new_callable=AsyncMock,
    ):
        response = await client.put(
            f"/api/v1/orgs/{org.id}/config/menu",
            json={},
        )

    assert response.status_code == 200
    assert response.json()["detail"] == "Menu configuration updated"
