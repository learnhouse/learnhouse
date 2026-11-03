"""Tests for the /mcp bearer authentication middleware (src/security/mcp_auth.py)."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from src.db.users import APITokenUser, PublicUser
from src.security import mcp_auth
from src.security.mcp_auth import (
    MCPAuthMiddleware,
    MCPPrincipal,
    _TokenCache,
    current_mcp_principal,
    principal_from_request,
)
from src.services.mcp.oauth import OAuthPrincipal


class _Inner:
    """Records the principal it was called with."""

    def __init__(self):
        self.seen = []

    async def __call__(self, scope, receive, send):
        self.seen.append((principal_from_request(SimpleNamespace(scope=scope)), current_mcp_principal.get()))
        await send({"type": "http.response.start", "status": 200, "headers": [(b"content-type", b"text/plain")]})
        await send({"type": "http.response.body", "body": b"ok"})


@pytest.fixture
def config():
    with patch("src.services.mcp.oauth.get_learnhouse_config") as get_config:
        get_config.return_value.mcp_config = SimpleNamespace(enabled=True, public_url=None)
        get_config.return_value.hosting_config.ssl = False
        yield


@pytest.fixture
def session_factory():
    class _Session:
        async def __aenter__(self):
            return object()

        async def __aexit__(self, *a):
            return False

    with patch.object(mcp_auth, "_async_session_factory", lambda: _Session()):
        yield


def _user():
    return PublicUser(id=7, username="u", first_name="", last_name="", email="u@x.test", user_uuid="user_u")


def _oauth_principal(scopes=("mcp:read", "mcp:write")):
    return OAuthPrincipal(
        user=_user(), org_id=3, scopes=scopes, grant_id=1, grant_uuid="mcpgrant_1",
        client_id="c", client_name="Claude", auth_method="password", expires_at=0,
    )


async def _post(app, token=None, method="POST"):
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://api.test") as c:
        return await c.request(method, "/mcp", headers=headers, json={})


async def test_missing_token_gets_discovery_challenge(config):
    inner = _Inner()
    resp = await _post(MCPAuthMiddleware(inner))
    assert resp.status_code == 401
    challenge = resp.headers["www-authenticate"]
    assert 'resource_metadata="http://api.test/.well-known/oauth-protected-resource/mcp"' in challenge
    assert "error=" not in challenge
    assert inner.seen == []


async def test_superadmin_token_refused(config):
    resp = await _post(MCPAuthMiddleware(_Inner()), "lh_sa_abc")
    assert resp.status_code == 401
    assert 'error="invalid_token"' in resp.headers["www-authenticate"]


async def test_unknown_token_refused(config, session_factory):
    resp = await _post(MCPAuthMiddleware(_Inner()), "something_else")
    assert resp.status_code == 401


async def test_oauth_token_resolves_member(config, session_factory):
    inner = _Inner()
    app = MCPAuthMiddleware(inner)
    with patch("src.services.mcp.oauth.verify_access_token", new_callable=AsyncMock, return_value=_oauth_principal(("mcp:read",))) as verify:
        assert (await _post(app, "lho_at_x")).status_code == 200
        assert (await _post(app, "lho_at_x")).status_code == 200  # cached
    assert verify.await_count == 1
    principal, from_var = inner.seen[0]
    assert principal == from_var
    assert principal.kind == "oauth" and principal.org_id == 3
    assert principal.can_write is False
    assert principal.grant_uuid == "mcpgrant_1"


async def test_oauth_token_invalid(config, session_factory):
    with patch("src.services.mcp.oauth.verify_access_token", new_callable=AsyncMock, return_value=None):
        resp = await _post(MCPAuthMiddleware(_Inner()), "lho_at_bad")
    assert resp.status_code == 401


async def test_api_token_resolves(config, session_factory):
    inner = _Inner()
    token_user = APITokenUser(org_id=5, token_name="CI", rights={})
    with patch.object(mcp_auth, "validate_api_token", new_callable=AsyncMock, return_value=token_user):
        assert (await _post(MCPAuthMiddleware(inner), "lh_abc")).status_code == 200
    principal = inner.seen[0][0]
    assert principal.kind == "api_token" and principal.org_id == 5 and principal.can_write
    with patch.object(mcp_auth, "validate_api_token", new_callable=AsyncMock, return_value=None):
        assert (await _post(MCPAuthMiddleware(_Inner()), "lh_abc")).status_code == 401


async def test_options_and_non_http_pass_through():
    inner = _Inner()
    app = MCPAuthMiddleware(inner)
    resp = await _post(app, method="OPTIONS")
    assert resp.status_code == 200

    called = []

    async def lifespan_app(scope, receive, send):
        called.append(scope["type"])

    await MCPAuthMiddleware(lifespan_app)({"type": "lifespan"}, None, None)
    assert called == ["lifespan"]


def test_token_cache_ttl_and_eviction():
    cache = _TokenCache(ttl_seconds=60, max_entries=4)
    principal = MCPPrincipal(user=_user(), org_id=1, scopes=frozenset(), kind="oauth")
    cache.put("a", principal)
    assert cache.get("a") is principal
    cache.put("b", principal, ttl=0)
    assert cache.get("b") is None
    for i in range(6):
        cache.put(f"k{i}", principal)
    assert len(cache._entries) <= 4
    cache.clear()
    assert cache.get("a") is None


def test_principal_from_request_fallbacks():
    assert principal_from_request(None) is None
    principal = MCPPrincipal(user=_user(), org_id=1, scopes=frozenset({"mcp:write"}), kind="oauth")
    token = current_mcp_principal.set(principal)
    try:
        assert principal_from_request(SimpleNamespace(scope={"state": "odd"})) is principal
    finally:
        current_mcp_principal.reset(token)
