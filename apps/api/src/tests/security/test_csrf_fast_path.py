"""Reads and websockets bypass the CSRF middleware's dispatch entirely; writes
still go through it."""

from unittest.mock import MagicMock, patch

from starlette.applications import Starlette
from starlette.responses import PlainTextResponse
from starlette.routing import Route, WebSocketRoute
from starlette.testclient import TestClient

from src.security.auth import JWT_COOKIE_NAME
from src.security.csrf import CSRFProtectionMiddleware


def _config():
    config = MagicMock()
    config.hosting_config.allowed_origins = ["https://good.example"]
    config.hosting_config.allowed_regexp = ""
    config.hosting_config.frontend_domain = "good.example"
    config.hosting_config.domain = "good.example"
    config.general_config.development_mode = False
    return config


async def _ok(request):
    return PlainTextResponse("ok")


async def _ws(websocket):
    await websocket.accept()
    await websocket.send_text("hi")
    await websocket.close()


def _client():
    app = Starlette(routes=[Route("/x", _ok, methods=["GET", "POST", "HEAD", "OPTIONS"]), WebSocketRoute("/ws", _ws)])
    app.add_middleware(CSRFProtectionMiddleware)
    # Starlette builds the middleware on the first request; build it now, under
    # the test config.
    with patch("src.security.csrf.get_learnhouse_config", return_value=_config()), patch(
        "src.core.middleware.cors.get_learnhouse_config", return_value=_config()
    ):
        app.middleware_stack = app.build_middleware_stack()
    return TestClient(app)


def test_reads_skip_dispatch():
    client = _client()
    with patch.object(CSRFProtectionMiddleware, "dispatch", side_effect=AssertionError("dispatch ran")):
        client.cookies.set(JWT_COOKIE_NAME, "t")
        assert client.get("/x", headers={"origin": "https://evil.example"}).text == "ok"
        assert client.head("/x").status_code == 200
        with client.websocket_connect("/ws") as ws:
            assert ws.receive_text() == "hi"


def test_writes_are_still_checked():
    client = _client()
    client.cookies.set(JWT_COOKIE_NAME, "t")
    assert client.post("/x", headers={"origin": "https://evil.example"}).status_code == 403
    assert client.post("/x", headers={"origin": "https://good.example"}).text == "ok"
