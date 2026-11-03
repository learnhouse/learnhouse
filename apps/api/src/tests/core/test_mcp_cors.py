"""Tests for the open CORS on MCP and OAuth paths (src/core/middleware/mcp_cors.py)."""

import pytest
from httpx import ASGITransport, AsyncClient

from src.core.middleware.mcp_cors import PublicCORSMiddleware, is_public_path


async def _inner(scope, receive, send):
    await send(
        {
            "type": "http.response.start",
            "status": 200,
            "headers": [(b"access-control-allow-origin", b"https://app.test"), (b"x-kept", b"1")],
        }
    )
    await send({"type": "http.response.body", "body": b"ok"})


@pytest.mark.parametrize(
    "path,public",
    [
        ("/mcp", True),
        ("/mcp/", True),
        ("/mcpx", False),
        ("/.well-known/oauth-protected-resource/mcp", True),
        ("/.well-known/openid-configuration", True),
        ("/oauth/token", True),
        ("/oauth/consent", False),
        ("/api/v1/courses", False),
    ],
)
def test_public_paths(path, public):
    assert is_public_path(path) is public


async def _client():
    return AsyncClient(transport=ASGITransport(app=PublicCORSMiddleware(_inner)), base_url="http://t")


async def test_preflight_answered_with_wildcard():
    async with await _client() as c:
        resp = await c.options("/oauth/token", headers={"Origin": "https://x.test", "Access-Control-Request-Method": "POST"})
    assert resp.status_code == 204
    assert resp.headers["access-control-allow-origin"] == "*"
    assert "Mcp-Protocol-Version" in resp.headers["access-control-allow-headers"]


async def test_response_headers_replaced_on_public_paths():
    async with await _client() as c:
        resp = await c.post("/mcp")
        private = await c.get("/api/v1/x")
    assert resp.headers["access-control-allow-origin"] == "*"
    assert "WWW-Authenticate" in resp.headers["access-control-expose-headers"]
    assert resp.headers["x-kept"] == "1"
    assert private.headers["access-control-allow-origin"] == "https://app.test"


async def test_non_http_scope_passes_through():
    seen = []

    async def app(scope, receive, send):
        seen.append(scope["type"])

    await PublicCORSMiddleware(app)({"type": "lifespan"}, None, None)
    assert seen == ["lifespan"]
