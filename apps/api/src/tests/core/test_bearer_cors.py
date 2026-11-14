"""Credential-less CORS for untrusted origins (src/core/middleware/bearer_cors.py)."""

import pytest
from httpx import ASGITransport, AsyncClient

from src.core.middleware.bearer_cors import BearerCORSMiddleware, bearer_cors_enabled

TRUSTED = r"^https?://(app\.test|localhost)(:\d+)?$"


async def _inner(scope, receive, send):
    await send(
        {
            "type": "http.response.start",
            "status": 200,
            "headers": [
                (b"access-control-allow-origin", b"https://app.test"),
                (b"access-control-allow-credentials", b"true"),
                (b"set-cookie", b"LH_access=x; Path=/"),
                (b"x-kept", b"1"),
            ],
        }
    )
    await send({"type": "http.response.body", "body": b"ok"})


def _client(app=None):
    middleware = BearerCORSMiddleware(app or _inner, trusted_origin_regex=TRUSTED)
    return AsyncClient(transport=ASGITransport(app=middleware), base_url="http://t")


@pytest.mark.asyncio
async def test_untrusted_preflight_answered_without_credentials():
    async with _client() as c:
        r = await c.options(
            "/api/v1/users/session",
            headers={
                "Origin": "https://shop.example",
                "Access-Control-Request-Method": "GET",
                "Access-Control-Request-Headers": "authorization, content-type",
            },
        )
    assert r.status_code == 204
    assert r.headers["access-control-allow-origin"] == "*"
    assert r.headers["access-control-allow-headers"] == "authorization, content-type"
    assert "access-control-allow-credentials" not in r.headers


@pytest.mark.asyncio
async def test_preflight_with_odd_header_list_falls_back_to_defaults():
    async with _client() as c:
        r = await c.options(
            "/api/v1/users/session",
            headers={
                "Origin": "https://shop.example",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "x-a\tb",
            },
        )
    assert r.headers["access-control-allow-headers"].startswith("Authorization")


@pytest.mark.asyncio
async def test_untrusted_response_is_open_and_cookie_free():
    async with _client() as c:
        r = await c.get("/api/v1/users/session", headers={"Origin": "https://shop.example"})
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == "*"
    assert "access-control-allow-credentials" not in r.headers
    assert "set-cookie" not in r.headers
    assert r.headers["x-kept"] == "1"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "path,headers",
    [
        # Trusted origins keep the API's own (credentialed) CORS.
        ("/api/v1/users/session", {"Origin": "https://app.test"}),
        # No Origin: server-to-server.
        ("/api/v1/users/session", {}),
        # Internal routes and non-API paths are never opened.
        ("/api/v1/internal/emails/x", {"Origin": "https://shop.example"}),
        ("/api/v1/cloud_internal/x", {"Origin": "https://shop.example"}),
        ("/content/orgs/x.png", {"Origin": "https://shop.example"}),
    ],
)
async def test_passthrough(path, headers):
    async with _client() as c:
        r = await c.get(path, headers=headers)
    assert r.headers["access-control-allow-origin"] == "https://app.test"
    assert r.headers["access-control-allow-credentials"] == "true"


@pytest.mark.asyncio
async def test_non_http_scope_passthrough():
    seen = []

    async def inner(scope, receive, send):
        seen.append(scope["type"])

    await BearerCORSMiddleware(inner, trusted_origin_regex=TRUSTED)({"type": "lifespan"}, None, None)
    assert seen == ["lifespan"]


def test_default_regex_comes_from_api_cors(monkeypatch):
    monkeypatch.setattr(
        "src.core.middleware.bearer_cors.get_cors_origin_regex", lambda: r"^https://x\.test$"
    )
    middleware = BearerCORSMiddleware(_inner)
    assert middleware._is_trusted("https://x.test")
    assert not middleware._is_trusted("https://x.test.evil")


@pytest.mark.parametrize(
    "value,enabled",
    [(None, True), ("true", True), ("1", True), ("false", False), ("OFF", False), ("0", False), ("no", False)],
)
def test_enabled_flag(monkeypatch, value, enabled):
    if value is None:
        monkeypatch.delenv("LEARNHOUSE_BEARER_CORS", raising=False)
    else:
        monkeypatch.setenv("LEARNHOUSE_BEARER_CORS", value)
    assert bearer_cors_enabled() is enabled
