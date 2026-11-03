"""Tests for the org switch for AI app connections (src/services/mcp/access.py)."""

from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from src.db.organization_config import OrganizationConfig
from src.services.mcp import access


@pytest.mark.parametrize(
    "config,enabled",
    [
        (None, True),
        ({}, True),
        ({"config_version": "2.0"}, True),
        ({"config_version": "2.0", "admin_toggles": {"mcp": {"disabled": True}}}, False),
        ({"features": {"mcp": {"enabled": False}}}, False),
        ({"features": {"mcp": {"enabled": True}}}, True),
    ],
)
def test_mcp_enabled_in_config(config, enabled):
    assert access.mcp_enabled_in_config(config) is enabled


@pytest.fixture
def server_on():
    with patch.object(access, "get_learnhouse_config") as get_config:
        get_config.return_value.mcp_config = SimpleNamespace(enabled=True)
        yield get_config


async def test_org_without_config_is_enabled(db, org, server_on):
    assert await access.mcp_enabled_for_org(org.id, db) is True


async def test_server_switch_wins(db, org, server_on):
    server_on.return_value.mcp_config.enabled = False
    assert await access.mcp_enabled_for_org(org.id, db) is False


@pytest.mark.parametrize("version", ["2.0", "1.0"])
async def test_toggle_round_trip(db, org, server_on, version):
    db.add(OrganizationConfig(org_id=org.id, config={"config_version": version}, creation_date="", update_date=""))
    await db.commit()
    await access.set_mcp_enabled_for_org(org.id, False, db)
    assert await access.mcp_enabled_for_org(org.id, db) is False
    await access.set_mcp_enabled_for_org(org.id, True, db)
    assert await access.mcp_enabled_for_org(org.id, db) is True


async def test_toggle_without_config_404(db, org):
    with pytest.raises(HTTPException) as e:
        await access.set_mcp_enabled_for_org(org.id, False, db)
    assert e.value.status_code == 404
