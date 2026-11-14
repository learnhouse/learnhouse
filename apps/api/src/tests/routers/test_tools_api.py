"""The tools API: every token-callable agent tool as POST /tools/{name}, run
through run_tool with the token's rights, approvals through the token's
creator, and the routes documented in the API token OpenAPI spec."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import APIRouter, FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient
from pydantic import BaseModel, Field

from src.core.events.database import get_db_session
from src.db.users import APITokenUser
from src.routers import tools_api
from src.security.auth import get_current_user
from src.security.rbac import AccessAction
from src.services.ai.tools import ActionTier, ToolRegistry, ToolSpec
from src.services.ai.tools.base import ToolOutcome
from src.services.api_tokens.openapi_spec import build_api_token_openapi_spec
from src.services.mcp import approvals as approvals_module  # noqa: F401  (loaded for patching)
from src.services.mcp import audit as audit_module  # noqa: F401

FULL = {"action_create": True, "action_read": True, "action_update": True, "action_delete": True}


class EchoParams(BaseModel):
    text: str = Field("hi", max_length=20)


async def _echo(ctx, p):
    return {"echo": p.text}


async def _plain(ctx, p):
    return ["a", "b"]


async def _boom(ctx, p):
    raise RuntimeError("bad")


async def _missing(ctx, p):
    raise HTTPException(status_code=404, detail="Nope")


def spec(name, execute=_echo, **kw):
    kw.setdefault("tier", ActionTier.READ)
    kw.setdefault("rights_bucket", "courses")
    kw.setdefault("access_action", AccessAction.READ)
    return ToolSpec(name=name, description=f"{name} tool", params_model=EchoParams, execute=execute, toolset="demo", **kw)


SPECS = [
    spec("echo", title="Echo"),
    spec("echo_list", execute=_plain, feature="boards"),
    spec("boom", execute=_boom, tier=ActionTier.EDIT, access_action=AccessAction.UPDATE),
    spec("missing", execute=_missing),
    spec("wipe", tier=ActionTier.DESTRUCTIVE, access_action=AccessAction.DELETE),
    spec("payments_only", rights_bucket="payments"),
    spec("person_only", api_tokens=False),
]


@pytest.fixture
def registry():
    r = ToolRegistry()
    r.register_all(SPECS)
    with patch.object(tools_api, "get_registry", return_value=r):
        yield r


def make_token(org_id=1, creator=1, rights=None):
    return APITokenUser(id=9, user_uuid="apitoken_t", username="t", org_id=org_id, token_name="CI",
                        rights=rights if rights is not None else {"courses": FULL}, created_by_user_id=creator)


@pytest.fixture
def principal():
    return {"user": make_token()}


@pytest.fixture
def approvals():
    m = MagicMock()
    m.ApprovalUnavailable = type("ApprovalUnavailable", (Exception,), {})
    m.APPROVAL_TTL = 600
    m.create.return_value = SimpleNamespace(id="apr_1")
    m.approval_url.return_value = "https://acme.test/oauth/approve?id=apr_1"
    m.consume.return_value = "approved"
    with patch("src.services.mcp.approvals", m), patch("src.services.mcp.audit.record") as rec:
        m.record = rec
        yield m


@pytest.fixture
async def client(db, org, registry, principal, approvals):
    app = FastAPI()
    router = APIRouter()
    added = tools_api.register_tool_routes(router)
    assert added == len(SPECS) - 1  # person_only stays off
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_db_session] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: principal["user"]
    with patch("src.services.mcp.handlers._describe", new=AsyncMock(return_value={"kind": "x", "name": "X"})):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            c.app = app
            yield c


async def test_read_tool_runs_for_a_token(client):
    r = await client.post("/api/v1/tools/echo", json={"text": "yo"})
    assert r.status_code == 200 and r.json() == {"echo": "yo"}
    r = await client.post("/api/v1/tools/echo")
    assert r.status_code == 200 and r.json() == {"echo": "hi"}


async def test_body_is_validated(client):
    r = await client.post("/api/v1/tools/echo", json={"text": "x" * 50})
    assert r.status_code == 422


async def test_sessions_are_refused(client, principal, admin_user):
    principal["user"] = admin_user
    assert (await client.post("/api/v1/tools/echo", json={})).status_code == 403
    assert (await client.get("/api/v1/tools")).status_code == 403


async def test_listing_shows_what_the_token_can_call(client):
    names = [t["name"] for t in (await client.get("/api/v1/tools")).json()]
    assert "echo" in names and "payments_only" not in names and "person_only" not in names
    listed = (await client.get("/api/v1/tools", params={"toolset": "other"})).json()
    assert listed == []
    echo = next(t for t in (await client.get("/api/v1/tools")).json() if t["name"] == "echo")
    assert echo["toolset"] == "demo" and echo["input_schema"]["properties"]["text"]


async def test_hidden_tool_answers_404(client):
    r = await client.post("/api/v1/tools/payments_only", json={})
    assert r.status_code == 404 and r.json()["error"]["code"] == "unknown_tool"


async def test_feature_gate(client):
    with patch("src.services.ai.tools.registry.resolve_feature", return_value={"enabled": False, "available": True}), \
            patch("src.services.mcp.server.tool_available", return_value=True):
        r = await client.post("/api/v1/tools/echo_list", json={})
    assert r.status_code == 403 and r.json()["error"]["code"] == "feature_unavailable"


async def test_non_dict_result_is_wrapped(client):
    with patch("src.services.mcp.server.tool_available", return_value=True), \
            patch("src.services.ai.tools.registry.feature_state", return_value={"enabled": True}):
        r = await client.post("/api/v1/tools/echo_list", json={})
    assert r.json() == {"result": ["a", "b"]}


async def test_crash_and_http_errors(client, approvals):
    r = await client.post("/api/v1/tools/boom", json={})
    assert r.status_code == 500 and r.json()["error"]["code"] == "internal_error"
    r = await client.post("/api/v1/tools/missing", json={})
    assert r.status_code == 404 and r.json()["error"]["message"] == "Nope"


async def test_names_that_do_not_resolve(client):
    with patch("src.services.ai.tools.registry.resolve_names",
               new=AsyncMock(return_value=ToolOutcome.denied("http_404", "No course"))):
        r = await client.post("/api/v1/tools/echo", json={})
    assert r.status_code == 404


async def test_resolved_names_are_reported(client):
    with patch("src.services.ai.tools.registry.resolve_names",
               new=AsyncMock(return_value=({"text": "ok"}, {"text": {"name": "ok"}}))):
        r = await client.post("/api/v1/tools/echo", json={"text": "the ok one"})
    assert r.json()["resolved"] == {"text": {"name": "ok"}}


async def test_destructive_call_goes_through_the_creators_approval(client, approvals):
    r = await client.post("/api/v1/tools/wipe", json={})
    assert r.status_code == 409
    err = r.json()["error"]
    assert err["code"] == "approval_required" and err["approval_id"] == "apr_1" and err["approval_url"].endswith("apr_1")
    assert approvals.create.call_args.kwargs["user_id"] == 1
    r = await client.post("/api/v1/tools/wipe", json={}, headers={"X-Approval-Id": "apr_1"})
    assert r.status_code == 200 and r.json() == {"echo": "hi"}
    assert approvals.record.call_args.kwargs["approval"] == "link apr_1"


@pytest.mark.parametrize("status,code", [("pending", "approval_pending"), ("used", "approval_expired"),
                                         ("mismatch", "approval_mismatch"), ("declined", "approval_expired")])
async def test_unusable_approvals(client, approvals, status, code):
    approvals.consume.return_value = status
    r = await client.post("/api/v1/tools/wipe", json={}, headers={"X-Approval-Id": "apr_1"})
    assert r.status_code == 409 and r.json()["error"]["code"] == code


async def test_approvals_unavailable(client, approvals):
    approvals.consume.side_effect = approvals.ApprovalUnavailable()
    r = await client.post("/api/v1/tools/wipe", json={}, headers={"X-Approval-Id": "apr_1"})
    assert r.status_code == 503
    approvals.create.side_effect = approvals.ApprovalUnavailable()
    r = await client.post("/api/v1/tools/wipe", json={})
    assert r.status_code == 503


async def test_token_without_creator_cannot_be_approved(client, principal):
    principal["user"] = make_token(creator=0)
    r = await client.post("/api/v1/tools/wipe", json={})
    assert r.status_code == 503 and r.json()["error"]["code"] == "approval_unavailable"
    r = await client.post("/api/v1/tools/wipe", json={}, headers={"X-Approval-Id": "apr_1"})
    assert r.status_code == 503


async def test_org_gone(client, principal):
    principal["user"] = make_token(org_id=999)
    assert (await client.post("/api/v1/tools/echo", json={})).status_code == 404


def test_status_mapping():
    assert tools_api._status_for(None) == 400
    assert tools_api._status_for("http_x") == 400
    assert tools_api._status_for("http_402") == 402
    assert tools_api._status_for("something_else") == 400


async def test_routes_are_in_the_api_token_openapi_spec(client):
    spec_doc = client.app.openapi()
    filtered = build_api_token_openapi_spec(spec_doc)
    assert "/api/v1/tools/echo" in filtered["paths"] and "/api/v1/tools" in filtered["paths"]
    op = filtered["paths"]["/api/v1/tools/wipe"]["post"]
    assert op["tags"] == ["tools/demo"] and "approval" in op["description"]
    assert "courses.action_delete" in op["description"]
    assert "Plan feature: boards" in filtered["paths"]["/api/v1/tools/echo_list"]["post"]["description"]
    assert "/api/v1/tools/person_only" not in spec_doc["paths"]
