"""The real application must register and run startup/shutdown on Starlette 1.x."""

from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

import app as app_module


@pytest.mark.parametrize("request_fails", [False, True])
def test_real_app_lifespan_starts_and_always_stops(monkeypatch, request_fails):
    startup = AsyncMock()
    shutdown = AsyncMock()
    monkeypatch.setattr(app_module, "startup_app", lambda application: startup)
    monkeypatch.setattr(app_module, "shutdown_app", lambda application: shutdown)

    if request_fails:
        with pytest.raises(RuntimeError, match="request failed"):
            with TestClient(app_module.app) as client:
                assert client.get("/").status_code == 200
                raise RuntimeError("request failed")
    else:
        with TestClient(app_module.app) as client:
            assert client.get("/").json() == {"Message": "Welcome to LearnHouse ✨"}

    startup.assert_awaited_once()
    shutdown.assert_awaited_once()
