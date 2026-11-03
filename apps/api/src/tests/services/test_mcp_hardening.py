"""Hardening of the MCP server found in the security review: connections that
must stay ended, hosts a caller cannot pick, and resource reads gated like the
tools behind them."""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import mcp_types as types
import pytest
from mcp.shared.exceptions import MCPError
from sqlmodel import select
from starlette.requests import Request

from src.db.mcp_oauth import MCPOAuthGrant
from src.db.organizations import Organization
from src.db.users import User
from src.routers import mcp_oauth as router
from src.security.mcp_auth import MCPAuthMiddleware
from src.services.mcp import handlers as h
from src.services.mcp import oauth
from src.services.mcp import server as srv
from src.tests.security.test_mcp_auth import _Inner, _oauth_principal, session_factory  # noqa: F401
from src.tests.services.test_mcp_oauth import frontend, full_tokens, mcp_config  # noqa: F401
from src.tests.services.test_mcp_approvals import redis  # noqa: F401
from src.tests.services.test_mcp_server import _registry, ctx_for, member, sessions  # noqa: F401

RESOURCE = "https://api.example.com/mcp"


def _request(client_ip, headers):
    raw = [(b"host", b"api.example.com")] + [(k.encode(), v.encode()) for k, v in headers.items()]
    return Request({"type": "http", "method": "GET", "path": "/mcp", "headers": raw, "query_string": b"", "client": (client_ip, 4000)})


# ─── hosts ───────────────────────────────────────────────────────────────────


def test_forwarded_host_counts_only_from_a_proxy(mcp_config):  # noqa: F811
    spoofed = {"x-forwarded-host": "attacker.test", "x-forwarded-proto": "http"}
    assert oauth.mcp_resource_url(_request("8.8.8.8", spoofed)) == RESOURCE
    assert oauth.mcp_resource_url(_request("10.0.0.2", spoofed)) == "http://attacker.test/mcp"
    with patch.dict("os.environ", {"LEARNHOUSE_SECURITY__TRUST_PROXY_HEADERS": "false"}):
        assert oauth.mcp_resource_url(_request("10.0.0.2", spoofed)) == RESOURCE
    mcp_config.public_url = "https://learn.example.org/mcp/"
    assert oauth.mcp_resource_url(_request("10.0.0.2", spoofed)) == "https://learn.example.org/mcp"


async def test_discovery_documents_are_never_cached(mcp_config):  # noqa: F811
    request = _request("8.8.8.8", {})
    for endpoint in (router.protected_resource_metadata, router.authorization_server_metadata):
        response = await endpoint(request)
        assert response.headers["cache-control"] == "no-store"


async def test_token_cache_is_keyed_by_resource(session_factory):  # noqa: F811
    from httpx import ASGITransport, AsyncClient

    app = MCPAuthMiddleware(_Inner())
    with patch("src.services.mcp.oauth.get_learnhouse_config") as get_config, patch(
        "src.services.mcp.oauth.verify_access_token", new_callable=AsyncMock, return_value=_oauth_principal()
    ) as verify:
        get_config.return_value.mcp_config = SimpleNamespace(enabled=True, public_url=None)
        get_config.return_value.hosting_config.ssl = False
        for host in ("api.test", "api.test", "other.test"):
            async with AsyncClient(transport=ASGITransport(app=app), base_url=f"http://{host}") as c:
                resp = await c.post("/mcp", headers={"Authorization": "Bearer lho_at_x"}, json={})
            assert resp.status_code == 200
    # Once per host: the cached answer for api.test does not let it in on other.test.
    assert [call.args[1] for call in verify.await_args_list] == ["http://api.test/mcp", "http://other.test/mcp"]


# ─── connections that end stay ended ─────────────────────────────────────────


async def _grants(db, user_id):
    query = select(MCPOAuthGrant).where(MCPOAuthGrant.user_id == user_id)
    return (await db.execute(query.execution_options(populate_existing=True))).scalars().all()


async def test_password_change_revokes_the_connection_for_good(db, org, admin_user, mcp_config, frontend):  # noqa: F811
    user_id = admin_user.id
    _, tokens = await full_tokens(db, admin_user, org)
    user = await db.get(User, user_id)
    user.password_changed_at = datetime.now(timezone.utc) + timedelta(seconds=5)
    db.add(user)
    await db.commit()
    assert await oauth.verify_access_token(tokens["access_token"], RESOURCE, db) is None
    assert all(g.revoked_at is not None for g in await _grants(db, user_id))
    # Even if the clock comparison stopped failing, the token stays dead.
    user = await db.get(User, user_id)
    user.password_changed_at = None
    db.add(user)
    await db.commit()
    assert await oauth.verify_access_token(tokens["access_token"], RESOURCE, db) is None


async def test_departing_members_lose_their_connected_apps(db, org, admin_user, mcp_config, frontend):  # noqa: F811
    from src.services.orgs.users import _revoke_org_grants

    user_id, org_id = admin_user.id, org.id
    _, tokens = await full_tokens(db, admin_user, org)
    await _revoke_org_grants(db, await db.get(Organization, org_id), [user_id])
    await db.commit()
    assert all(g.revoked_at is not None for g in await _grants(db, user_id))
    assert await oauth.verify_access_token(tokens["access_token"], RESOURCE, db) is None


# ─── resources ───────────────────────────────────────────────────────────────


async def test_resource_reads_take_the_tool_gates(db, org, admin_user, sessions):  # noqa: F811
    org = SimpleNamespace(id=org.id)
    handlers = h.Handlers(_registry())
    reader = member(admin_user, org)
    params = types.ReadResourceRequestParams(uri="learnhouse://course/course_1")
    with patch.object(h, "_rate_limited", return_value=True):
        with pytest.raises(MCPError):
            await handlers.read_resource(ctx_for(reader), params)
        assert (await handlers.list_tools(ctx_for(reader), None)).tools == []
    # A member whose role cannot use get_course cannot read it as a resource either.
    with patch.object(srv, "spec_visible", return_value=False):
        with pytest.raises(MCPError):
            await handlers.read_resource(ctx_for(reader), params)
    assert (await handlers.read_resource(ctx_for(reader), params)).contents


# ─── audit ───────────────────────────────────────────────────────────────────


async def test_audit_records_requests_refusals_and_how_a_call_was_approved(db, org, admin_user, redis, sessions):  # noqa: F811
    from src.services.mcp import approvals
    from src.tests.services import test_mcp_approvals as ta

    org = SimpleNamespace(id=org.id)
    handlers = h.Handlers(ta._registry())
    who = ta.member(admin_user, org)
    with patch.object(h.audit, "record") as record:
        asked = ta.err(await handlers.call_tool(ta.ctx_for(who), ta.call("delete_course")))
        approvals.decide(asked["approval_id"], who.user.id, True)
        await handlers.call_tool(ta.ctx_for(who), ta.call("delete_course", {"approval_id": asked["approval_id"]}))
        with patch.object(h, "_rate_limited", return_value=True):
            await handlers.call_tool(ta.ctx_for(who), ta.call("delete_course"))
    seen = [(c.args[4], c.args[5] if len(c.args) > 5 else None, c.kwargs.get("approval")) for c in record.call_args_list]
    assert seen == [
        ("approval_requested", None, None),
        ("executed", None, f"link {asked['approval_id']}"),
        ("refused", "rate_limited", None),
    ]
