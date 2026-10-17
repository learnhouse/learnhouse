"""Which orgs AI search indexes for."""

from unittest.mock import patch

import pytest

from src.db.organization_config import OrganizationConfig
from src.services.ai.rag.gating import ai_block_reason, orgs_using_ai


@pytest.fixture
def ai_on():
    with patch("src.security.features_utils.resolve.resolve_feature", return_value={"enabled": True}):
        yield


class TestBlockReason:
    def test_no_config_is_not_restricted(self):
        assert ai_block_reason(None, 1) is None
        assert ai_block_reason({}, 1) is None

    def test_ai_off(self):
        with patch("src.security.features_utils.resolve.resolve_feature", return_value={"enabled": False}):
            assert ai_block_reason({"config_version": "2.0"}, 1) == "AI features are disabled for this organization"

    @pytest.mark.parametrize("config", [
        {"config_version": "2.0", "admin_toggles": {"ai": {"copilot_enabled": False}}},
        {"config_version": "1.0", "features": {"ai": {"copilot_enabled": False}}},
    ])
    def test_copilot_off(self, ai_on, config):
        assert ai_block_reason(config, 1) == "Copilot is disabled for this organization"

    def test_on(self, ai_on):
        assert ai_block_reason({"config_version": "2.0"}, 1) is None


class TestOrgsUsingAi:
    async def test_filters_orgs(self, db, org, other_org, ai_on):
        db.add(OrganizationConfig(
            org_id=other_org.id,
            config={"config_version": "2.0", "admin_toggles": {"ai": {"copilot_enabled": False}}},
            creation_date="", update_date="",
        ))
        await db.commit()
        assert await orgs_using_ai([org.id, other_org.id], db) == {org.id}
        assert await orgs_using_ai([], db) == set()
