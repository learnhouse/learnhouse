"""Edge branches in core startup and deployment-mode detection."""

from types import SimpleNamespace
from unittest.mock import patch

import pytest

from src.core.deployment_mode import get_deployment_mode


@pytest.mark.asyncio
async def test_connect_to_db_retries_even_when_dispose_fails(monkeypatch):
    """A failed pool dispose between attempts is logged, not fatal: the retry still runs."""
    import src.core.events.database as db_events

    attempts = []

    async def flaky():
        attempts.append(1)
        if len(attempts) < 2:
            raise RuntimeError("connection refused")

    class BrokenEngine:
        disposed = 0

        async def dispose(self):
            BrokenEngine.disposed += 1
            raise RuntimeError("pool already gone")

    engine = BrokenEngine()
    monkeypatch.setattr(db_events, "_bootstrap_schema", flaky)
    monkeypatch.setattr(db_events, "_STARTUP_CONNECT_BACKOFF_SECONDS", 0)
    monkeypatch.setattr(db_events, "_is_transient_connect_error", lambda e: True)
    monkeypatch.setattr(db_events, "engine", engine)

    app = SimpleNamespace()
    await db_events.connect_to_db(app)

    assert len(attempts) == 2
    assert BrokenEngine.disposed == 1
    assert app.db_engine is engine


def test_force_ee_in_development_skips_the_license(monkeypatch):
    config = SimpleNamespace(general_config=SimpleNamespace(saas_mode=False, development_mode=True))
    monkeypatch.setenv("LEARNHOUSE_FORCE_EE", "1")
    with patch("src.core.deployment_mode.get_learnhouse_config", return_value=config), \
         patch("src.core.deployment_mode.is_ee_available", return_value=True), \
         patch("src.core.deployment_mode.get_ee_hooks") as hooks:
        assert get_deployment_mode() == "ee"
    hooks.assert_not_called()
