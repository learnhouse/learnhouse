"""
Tests for update_org_menu_config in src/services/orgs/orgs.py

Covers the public-menu config writer: v2 configs store the menu under
`customization.menu`, v1 under `general.menu`, plus the missing-org / missing-config
guards.
"""

from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from sqlmodel import select

from src.db.organizations import OrganizationConfig
from src.services.orgs.orgs import update_org_menu_config


async def _load_config(db, org_id):
    return (
        await db.execute(select(OrganizationConfig).where(OrganizationConfig.org_id == org_id))
    ).scalars().first()


_MENU = {
    "items": [
        {"type": "library", "enabled": True, "order": 0, "label": "", "url": "", "icon": ""},
        {"type": "custom", "enabled": True, "order": 1, "label": "Docs", "url": "https://docs.x", "icon": "Globe"},
    ]
}


async def _make_config(db, org, config):
    row = OrganizationConfig(
        org_id=org.id,
        config=config,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


@pytest.fixture(autouse=True)
def _bypass_rbac():
    with patch("src.services.orgs.orgs.rbac_check", new_callable=AsyncMock, return_value=True):
        yield


class TestUpdateOrgMenuConfig:
    @pytest.mark.asyncio
    async def test_v2_config_stores_under_customization(self, db, org, admin_user, mock_request):
        await _make_config(db, org, {"config_version": "2.0", "customization": {}})
        result = await update_org_menu_config(mock_request, _MENU, org.id, admin_user, db)
        assert result["detail"] == "Menu configuration updated"

        row = await _load_config(db, org.id)
        items = row.config["customization"]["menu"]["items"]
        assert [i["type"] for i in items] == ["library", "custom"]
        assert items[1]["icon"] == "Globe"

    @pytest.mark.asyncio
    async def test_v1_config_stores_under_general(self, db, org, admin_user, mock_request):
        await _make_config(db, org, {"config_version": "1.4", "general": {"enabled": True}})
        await update_org_menu_config(mock_request, _MENU, org.id, admin_user, db)

        row = await _load_config(db, org.id)
        assert row.config["general"]["menu"]["items"][1]["label"] == "Docs"

    @pytest.mark.asyncio
    async def test_missing_org_404(self, db, admin_user, mock_request):
        with pytest.raises(HTTPException) as exc:
            await update_org_menu_config(mock_request, _MENU, 999999, admin_user, db)
        assert exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_missing_config_404(self, db, org, admin_user, mock_request):
        with pytest.raises(HTTPException) as exc:
            await update_org_menu_config(mock_request, _MENU, org.id, admin_user, db)
        assert exc.value.status_code == 404
