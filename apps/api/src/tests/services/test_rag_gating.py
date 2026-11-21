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
    @pytest.fixture(autouse=True)
    def _configured(self):
        with patch("src.services.ai.llm.embeddings.embeddings_configured", return_value=True):
            yield

    async def test_filters_orgs(self, db, org, other_org, ai_on):
        db.add(OrganizationConfig(
            org_id=other_org.id,
            config={"config_version": "2.0", "admin_toggles": {"ai": {"copilot_enabled": False}}},
            creation_date="", update_date="",
        ))
        await db.commit()
        assert await orgs_using_ai([org.id, other_org.id], db) == {org.id}
        assert await orgs_using_ai([], db) == set()

    async def test_nothing_without_pgvector(self, db, org, ai_on, monkeypatch):
        from src.core import migrations

        monkeypatch.setattr(migrations, "_pgvector_missing", True)
        assert await orgs_using_ai([org.id], db) == set()

    async def test_nothing_without_an_embeddings_provider(self, db, org, ai_on):
        with patch("src.services.ai.llm.embeddings.embeddings_configured", return_value=False):
            assert await orgs_using_ai([org.id], db) == set()


class TestEmbeddingsConfigured:
    @pytest.fixture
    def ai_config(self):
        from types import SimpleNamespace

        cfg = SimpleNamespace(provider=None, embedding_provider=None, api_key=None, gemini_api_key=None)
        with patch(
            "src.services.ai.llm.embeddings.get_learnhouse_config",
            return_value=SimpleNamespace(ai_config=cfg),
        ):
            yield cfg

    def _check(self):
        from src.services.ai.llm.embeddings import embeddings_configured

        return embeddings_configured()

    def test_no_key_at_all(self, ai_config):
        assert self._check() is False

    def test_gemini_key(self, ai_config):
        ai_config.gemini_api_key = "k"
        assert self._check() is True

    def test_google_main_key(self, ai_config):
        ai_config.provider = "google"
        ai_config.api_key = "k"
        assert self._check() is True

    def test_ollama_needs_no_key(self, ai_config):
        ai_config.embedding_provider = "ollama"
        assert self._check() is True

    def test_openai(self, ai_config):
        ai_config.provider = "openai"
        assert self._check() is False
        ai_config.api_key = "k"
        assert self._check() is True

    def test_provider_without_embeddings_falls_back_to_gemini(self, ai_config):
        ai_config.provider = "anthropic"
        ai_config.api_key = "k"
        assert self._check() is False
        ai_config.gemini_api_key = "g"
        assert self._check() is True
