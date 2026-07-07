"""Auth tests for the embedded MCP server's bearer middleware.

Covers `src/security/mcp_auth.py`: header parsing, token-prefix rules
(`lh_` accepted, `lh_sa_` rejected), in-process validation, the principal
contextvar, and TTL-cache behavior (hit, expiry, revocation window).
"""

import json
from unittest.mock import AsyncMock, patch

import pytest

from src.db.users import APITokenUser
from src.security.mcp_auth import (
    MCPAuthMiddleware,
    _TokenCache,
    current_mcp_principal,
)


def _scope(auth: str | None = None, scope_type: str = "http"):
    headers = []
    if auth is not None:
        headers.append((b"authorization", auth.encode()))
    return {"type": scope_type, "method": "POST", "path": "/", "headers": headers}


class _Recorder:
    """Records sent ASGI messages and the principal seen by the inner app."""

    def __init__(self):
        self.messages = []
        self.inner_called = False
        self.seen_principal = "unset"

    async def send(self, message):
        self.messages.append(message)

    async def receive(self):  # pragma: no cover - not used
        return {"type": "http.request"}

    async def inner_app(self, scope, receive, send):
        self.inner_called = True
        self.seen_principal = current_mcp_principal.get()
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"ok"})

    @property
    def status(self):
        starts = [m for m in self.messages if m["type"] == "http.response.start"]
        return starts[0]["status"] if starts else None

    @property
    def body_json(self):
        bodies = [m for m in self.messages if m["type"] == "http.response.body"]
        return json.loads(bodies[0]["body"]) if bodies else None


def _principal(org_id=1):
    return APITokenUser(
        id=0,
        user_uuid="apitoken_mcp",
        username="api_token_mcp",
        org_id=org_id,
        rights={"courses": {"action_read": True}},
        created_by_user_id=7,
    )


@pytest.fixture
def rec():
    return _Recorder()


async def test_missing_authorization_rejected(rec):
    mw = MCPAuthMiddleware(rec.inner_app)
    await mw(_scope(), rec.receive, rec.send)
    assert rec.status == 401
    assert not rec.inner_called
    assert "bearer" in rec.body_json["detail"].lower()


async def test_non_bearer_rejected(rec):
    mw = MCPAuthMiddleware(rec.inner_app)
    await mw(_scope("Basic abc"), rec.receive, rec.send)
    assert rec.status == 401
    assert not rec.inner_called


async def test_superadmin_token_rejected(rec):
    mw = MCPAuthMiddleware(rec.inner_app)
    await mw(_scope("Bearer lh_sa_secret"), rec.receive, rec.send)
    assert rec.status == 401
    assert not rec.inner_called
    assert "superadmin" in rec.body_json["detail"].lower()


async def test_non_lh_token_rejected(rec):
    mw = MCPAuthMiddleware(rec.inner_app)
    await mw(_scope("Bearer sk-something"), rec.receive, rec.send)
    assert rec.status == 401
    assert not rec.inner_called


async def test_invalid_token_rejected(rec):
    mw = MCPAuthMiddleware(rec.inner_app)
    with patch.object(
        MCPAuthMiddleware, "_validate", new_callable=AsyncMock, return_value=None
    ):
        await mw(_scope("Bearer lh_revoked"), rec.receive, rec.send)
    assert rec.status == 401
    assert not rec.inner_called
    assert "invalid or revoked" in rec.body_json["detail"].lower()


async def test_valid_token_sets_principal_and_passes_through(rec):
    mw = MCPAuthMiddleware(rec.inner_app)
    principal = _principal()
    with patch.object(
        MCPAuthMiddleware, "_validate", new_callable=AsyncMock, return_value=principal
    ):
        await mw(_scope("Bearer lh_good"), rec.receive, rec.send)
    assert rec.status == 200
    assert rec.inner_called
    assert rec.seen_principal is principal
    # contextvar reset after the request
    assert current_mcp_principal.get() is None


async def test_cache_hit_skips_validation(rec):
    mw = MCPAuthMiddleware(rec.inner_app)
    principal = _principal()
    with patch.object(
        MCPAuthMiddleware, "_validate", new_callable=AsyncMock, return_value=principal
    ) as validate:
        await mw(_scope("Bearer lh_cached"), rec.receive, rec.send)
        await mw(_scope("Bearer lh_cached"), rec.receive, rec.send)
    assert validate.await_count == 1


async def test_cache_expiry_revalidates(rec):
    mw = MCPAuthMiddleware(rec.inner_app, cache_ttl_seconds=0)
    principal = _principal()
    with patch.object(
        MCPAuthMiddleware, "_validate", new_callable=AsyncMock, return_value=principal
    ) as validate:
        await mw(_scope("Bearer lh_ttl"), rec.receive, rec.send)
        await mw(_scope("Bearer lh_ttl"), rec.receive, rec.send)
    assert validate.await_count == 2


async def test_revocation_after_cache_expiry_rejects(rec):
    mw = MCPAuthMiddleware(rec.inner_app, cache_ttl_seconds=0)
    principal = _principal()
    with patch.object(
        MCPAuthMiddleware,
        "_validate",
        new_callable=AsyncMock,
        side_effect=[principal, None],
    ):
        await mw(_scope("Bearer lh_soon_revoked"), rec.receive, rec.send)
        rec2 = _Recorder()
        mw.app = rec2.inner_app
        await mw(_scope("Bearer lh_soon_revoked"), rec2.receive, rec2.send)
    assert rec2.status == 401
    assert not rec2.inner_called


async def test_non_http_scope_passes_through(rec):
    called = {}

    async def inner(scope, receive, send):
        called["yes"] = True

    mw = MCPAuthMiddleware(inner)
    await mw(_scope(scope_type="lifespan"), rec.receive, rec.send)
    assert called.get("yes")


def test_token_cache_eviction_under_pressure():
    cache = _TokenCache(ttl_seconds=60, max_entries=8)
    for i in range(9):
        cache.put(f"lh_{i}", _principal(org_id=i))
    # A quarter of the oldest entries were evicted to make room.
    assert len(cache._entries) <= 8
    assert cache.get("lh_8") is not None


def test_token_cache_clear():
    cache = _TokenCache()
    cache.put("lh_x", _principal())
    cache.clear()
    assert cache.get("lh_x") is None
