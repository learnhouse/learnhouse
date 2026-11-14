"""Tests for the MCP server and its handlers (src/services/mcp/server.py, handlers.py)."""

from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import mcp_types as types
import pytest
from fastapi import HTTPException
from mcp.shared.exceptions import MCPError
from pydantic import BaseModel

from src.db.organization_config import OrganizationConfig
from src.db.users import APITokenUser, PublicUser
from src.security.mcp_auth import MCPPrincipal
from src.security.rbac import AccessAction
from src.services.ai.tools import ActionTier, ToolRegistry, ToolSpec
from src.services.mcp import handlers as h
from src.services.mcp import prompts
from src.services.mcp import server as srv

MODERN = "2026-07-28"
LEGACY = "2025-11-25"


class _Params(BaseModel):
    course_uuid: str = "course_1"


async def _ok(ctx, params):
    return {"ok": True, "surface": ctx.surface, "read_only": ctx.read_only}


async def _list(ctx, params):
    return {"items": [{"kind": "course", "uuid": "course_1", "name": "One"}, {"name": "no uuid"}], "has_more": False}


async def _boom(ctx, params):
    raise RuntimeError("boom")


async def _forbidden(ctx, params):
    raise HTTPException(status_code=403, detail="nope")


def _spec(name, tier=ActionTier.READ, execute=_ok, bucket="courses", action=AccessAction.READ, **kw):
    return ToolSpec(
        name=name, description=f"{name} tool", params_model=_Params, tier=tier,
        rights_bucket=bucket, access_action=action, execute=execute, **kw,
    )


def _registry():
    r = ToolRegistry()
    r.register_all(
        [
            _spec("get_context", bucket=None, toolset="core", title="Get context"),
            _spec("list_courses", execute=_list, toolset="courses"),
            _spec("get_course", toolset="courses"),
            _spec("get_activity_content", toolset="content"),
            _spec("create_course", ActionTier.CREATE, action=AccessAction.CREATE, toolset="courses"),
            _spec("delete_course", ActionTier.DESTRUCTIVE, action=AccessAction.DELETE, toolset="courses", summarize=lambda p: f"Delete {p.course_uuid}"),
            _spec("delete_plain", ActionTier.DESTRUCTIVE, action=AccessAction.DELETE, toolset="courses"),
            _spec("crash", execute=_boom, toolset="courses"),
            _spec("forbidden", execute=_forbidden, toolset="courses"),
            _spec("list_boards", feature="boards", bucket="boards", toolset="boards"),
            _spec("fetch_url", ActionTier.EDIT, action=AccessAction.UPDATE, open_world=True, toolset="content"),
        ]
    )
    return r


@pytest.fixture
def sessions(db):
    @asynccontextmanager
    async def factory():
        # Each MCP call gets a fresh session in production.
        db.expunge_all()
        for cache in ("_user_org_cache", "_auth_policy_cache"):
            if hasattr(db, cache):
                delattr(db, cache)
        yield db

    with patch.object(h, "_async_session_factory", factory), patch.object(h, "_rate_limited", return_value=False):
        yield


def member(user, org, scopes=("mcp:read", "mcp:write")):
    if not isinstance(user, PublicUser):
        user = PublicUser.model_validate(user, from_attributes=True)
    return MCPPrincipal(user=user, org_id=org.id, scopes=frozenset(scopes), kind="oauth", client_name="Claude", grant_uuid="mcpgrant_x")


def ctx_for(principal, protocol=LEGACY, elicit=False, query=None):
    state = {"mcp_principal": principal} if principal else {}
    caps = SimpleNamespace(elicitation=object() if elicit else None)
    return SimpleNamespace(
        request=SimpleNamespace(scope={"state": state}, query_params=query or {}),
        protocol_version=protocol,
        session=SimpleNamespace(client_capabilities=caps),
    )


def call(name, args=None, responses=None):
    return types.CallToolRequestParams(name=name, arguments=args or {}, input_responses=responses)


def body(result):
    return result.structured_content


# ─── building blocks ─────────────────────────────────────────────────────────


def test_build_server_and_manager():
    server = srv.build_mcp_server(_registry())
    assert server.name == "learnhouse"
    assert "get_context" in server.instructions
    manager = srv.build_mcp_session_manager(_registry())
    assert srv.MCPASGIApp(manager).manager is manager


async def test_asgi_app_ignores_non_http():
    manager = SimpleNamespace(handle_request=AsyncMock())
    await srv.MCPASGIApp(manager)({"type": "lifespan"}, None, None)
    manager.handle_request.assert_not_awaited()
    await srv.MCPASGIApp(manager)({"type": "http"}, None, None)
    manager.handle_request.assert_awaited_once()


def test_tool_definition_annotations():
    reg = _registry()
    delete = srv.tool_definition(reg.get("delete_course"))
    assert delete.annotations.destructive_hint is True
    assert "approval_id" in delete.input_schema["properties"]
    assert "approval" in delete.description
    # No extra argument the model could set to approve on its own.
    assert set(delete.input_schema["properties"]) - set(_Params.model_fields) == {"approval_id"}
    read = srv.tool_definition(reg.get("list_courses"))
    assert read.annotations.read_only_hint and read.annotations.idempotent_hint
    assert "title" not in read.input_schema
    assert srv.tool_definition(reg.get("fetch_url")).annotations.open_world_hint is True


_NOT_PORTABLE = ("$ref", "$defs", "oneOf", "allOf", "discriminator", "const")


def _schema_problems(node, path="") -> list[str]:
    problems: list[str] = []
    if isinstance(node, list):
        for k, item in enumerate(node):
            problems += _schema_problems(item, f"{path}[{k}]")
        return problems
    if not isinstance(node, dict):
        return problems
    problems += [f"{path}: {key}" for key in _NOT_PORTABLE if key in node]
    if isinstance(node.get("type"), list):
        problems.append(f"{path}: type list {node['type']}")
    if node.get("type") == "null" or {"type": "null"} in (node.get("anyOf") or []):
        problems.append(f"{path}: null type")
    if node.get("type") == "array" and "items" not in node:
        problems.append(f"{path}: array without items")
    for key, value in node.items():
        if key == "properties":
            for name, prop in value.items():
                problems += _schema_problems(prop, f"{path}.{name}")
        elif key not in ("enum", "default", "examples"):
            problems += _schema_problems(value, f"{path}/{key}")
    return problems


def test_only_tools_that_always_ask_say_they_need_approval():
    from src.services.ai.tools import build_registry

    reg = build_registry()
    assert "Needs the user's approval." in srv.tool_definition(reg.get("delete_course")).description
    for name in ("edit_activity_content", "write_activity_content", "update_activity", "update_course"):
        text = srv.tool_definition(reg.get(name)).description
        assert "Needs the user's approval." not in text and "Only some changes" in text, name


def test_every_real_tool_schema_is_portable():
    """Gemini, OpenAI-side converters and IDE clients each reject some JSON
    Schema features; the catalog sticks to the subset they all read."""
    import jsonschema

    from src.services.ai.tools import build_registry

    for spec in build_registry().specs():
        schema = srv.tool_definition(spec).input_schema
        assert schema["type"] == "object", spec.name
        assert _schema_problems(schema) == [], spec.name
        jsonschema.Draft202012Validator.check_schema(schema)


def test_compact_schema_inlines_and_simplifies():
    class Leaf(BaseModel):
        name: str

    class Node(BaseModel):
        label: str | None = None
        count: int | str = 1
        leaf: Leaf | None = None
        leaves: list[Leaf] = []
        child: "Node | None" = None

    schema = srv.compact_schema(Node.model_json_schema())
    props = schema["properties"]
    assert "$defs" not in schema and props["label"] == {"type": "string"}
    assert props["count"]["anyOf"] == [{"type": "integer"}, {"type": "string"}]
    assert props["leaf"]["properties"]["name"]["type"] == "string" and props["leaf"]["required"] == ["name"]
    assert props["leaves"]["items"]["properties"]["name"]["type"] == "string"
    # A model that contains itself cannot be inlined forever.
    assert props["child"] == {"type": "object"}
    assert srv.compact_schema({"type": "object", "properties": {"op": {"const": "x", "type": "string"}}})["properties"]["op"] == {
        "enum": ["x"], "type": "string",
    }
    assert srv.compact_schema("not a schema") == "not a schema"


def test_requested_toolsets():
    known = ("core", "courses", "content", "build", "people")
    default = {"core", "courses", "content", "build"}
    # Without the parameter: the course-building default, not everything.
    assert srv.requested_toolsets(None, known) == default
    assert srv.requested_toolsets(SimpleNamespace(query_params={}), known) == default
    assert srv.requested_toolsets(SimpleNamespace(query_params=None), known) == default
    assert srv.requested_toolsets(SimpleNamespace(query_params={}), ("core", "people")) == {"core"}
    assert srv.requested_toolsets(SimpleNamespace(query_params={"toolsets": "courses, bogus"}), known) == {"courses", "core"}
    assert srv.requested_toolsets(SimpleNamespace(query_params={"toolsets": "all"}), known) is None
    assert srv.requested_toolsets(SimpleNamespace(query_params={"toolsets": "admin,default"}), known) == default | {"people"}
    assert srv.requested_toolsets(SimpleNamespace(query_params={"toolsets": "courses"})) == {"courses", "core"}
    assert srv.requested_toolsets(SimpleNamespace(query_params={"toolsets": "Essentials,paths"})) == {
        "core", "courses", "content", "teaching", "paths",
    }


def test_essentials_fits_clients_that_cap_tools():
    from src.services.ai.tools import build_registry

    wanted = srv.requested_toolsets(SimpleNamespace(query_params={"toolsets": "essentials"}))
    names = [s.name for s in build_registry().specs() if s.toolset in wanted and s.required_access != "admin"]
    assert len(names) <= 40, len(names)
    assert {"fetch", "search", "create_course", "edit_activity_content", "create_assignment"} <= set(names)


def test_spec_visible_rules(admin_user, org):
    reg = _registry()
    writer = member(admin_user, org)
    reader = member(admin_user, org, ("mcp:read",))
    assert srv.spec_visible(reg.get("create_course"), writer, {}, org.id, None)
    assert not srv.spec_visible(reg.get("create_course"), reader, {}, org.id, None)
    assert not srv.spec_visible(reg.get("get_activity_content"), writer, {}, org.id, {"courses", "core"})
    assert srv.spec_visible(reg.get("get_context"), writer, {}, org.id, {"core"})

    token = MCPPrincipal(user=APITokenUser(org_id=org.id, rights={"courses": {"action_read": True}}), org_id=org.id, scopes=frozenset({"mcp:read", "mcp:write"}), kind="api_token")
    assert srv.spec_visible(reg.get("list_courses"), token, {}, org.id, None)
    assert not srv.spec_visible(reg.get("create_course"), token, {}, org.id, None)

    learner = {"courses": {"action_read": True, "action_create": False, "action_delete_own": True}}
    assert srv.spec_visible(reg.get("list_courses"), writer, {}, org.id, None, learner)
    assert not srv.spec_visible(reg.get("create_course"), writer, {}, org.id, None, learner)
    assert srv.spec_visible(reg.get("delete_course"), writer, {}, org.id, None, learner)
    assert not srv.spec_visible(reg.get("list_courses"), writer, {}, org.id, None, {})


def test_role_allows_model_objects():
    rights = SimpleNamespace(courses=SimpleNamespace(action_read=False, action_update_own=True))
    assert srv._role_allows(rights, "courses", AccessAction.UPDATE)
    assert not srv._role_allows(rights, "boards", AccessAction.READ)


async def test_member_role_rights(db, org, admin_user, regular_user):
    assert await srv.member_role_rights(member(admin_user, org), org.id, db) is None
    rights = await srv.member_role_rights(member(regular_user, org), org.id, db)
    assert rights["courses"]["action_read"] is True
    token = MCPPrincipal(user=APITokenUser(org_id=org.id), org_id=org.id, scopes=frozenset(), kind="api_token")
    assert await srv.member_role_rights(token, org.id, db) is None
    stranger = member(regular_user, SimpleNamespace(id=999))
    assert await srv.member_role_rights(stranger, 999, db) == {}


def test_results_and_hints():
    assert srv.hint_for(None) is None
    assert srv.hint_for("nothing") is None
    assert "retrying" in srv.hint_for("rbac_denied")
    assert "Try once more" in srv.hint_for("http_502")
    err = srv.error_result("http_404", "gone")
    assert err.is_error and err.structured_content["error"]["hint"]
    assert "hint" not in srv.error_result("whatever", "x").structured_content["error"]
    assert srv.error_result("http_409", "x").structured_content["error"]["retryable"] is True
    assert srv.error_result("approval_required", "x", approval_id="a").structured_content["error"]["approval_id"] == "a"
    assert srv.success_result([1]).structured_content == {"result": [1]}
    assert srv.success_result({"a": 1}).structured_content == {"a": 1}


def test_misc_helpers():
    assert srv.parse_resource_uri("learnhouse://org") == ("org", None)
    assert srv.parse_resource_uri("learnhouse://course/course_ab-1") == ("course", "course_ab-1")
    assert srv.parse_resource_uri("https://x") is None
    assert srv.is_modern(MODERN) and not srv.is_modern(LEGACY) and not srv.is_modern(None)
    assert srv.mcp_allowed({}) is True
    assert srv.mcp_allowed({"config_version": "2.0", "admin_toggles": {"mcp": {"disabled": True}}}) is False
    assert srv._version() == "" or isinstance(srv._version(), str)


# ─── list_tools ──────────────────────────────────────────────────────────────


async def test_list_tools(db, org, admin_user, regular_user, sessions):
    org = SimpleNamespace(id=org.id)  # rollbacks expire the ORM row
    handlers = h.Handlers(_registry())
    assert (await handlers.list_tools(ctx_for(None), None)).tools == []
    names = {t.name for t in (await handlers.list_tools(ctx_for(member(admin_user, org)), None)).tools}
    assert {"create_course", "delete_course", "get_context"} <= names
    reader = {t.name for t in (await handlers.list_tools(ctx_for(member(admin_user, org, ("mcp:read",))), None)).tools}
    assert "create_course" not in reader and "list_courses" in reader
    learner = {t.name for t in (await handlers.list_tools(ctx_for(member(regular_user, org)), None)).tools}
    assert "create_course" not in learner and "list_courses" in learner
    narrowed = {t.name for t in (await handlers.list_tools(ctx_for(member(admin_user, org), query={"toolsets": "content"}), None)).tools}
    assert narrowed == {"search_tools", "invoke_tool", "get_context", "get_activity_content", "fetch_url"}
    # The default listing leaves other toolsets to search_tools; all lists them.
    assert "list_boards" not in names
    everything = {t.name for t in (await handlers.list_tools(ctx_for(member(admin_user, org), query={"toolsets": "all"}), None)).tools}
    assert names <= everything


async def test_list_tools_org_switched_off(db, org, admin_user, sessions):
    db.add(OrganizationConfig(org_id=org.id, config={"config_version": "2.0", "admin_toggles": {"mcp": {"disabled": True}}}, creation_date="", update_date=""))
    await db.commit()
    assert (await h.Handlers(_registry()).list_tools(ctx_for(member(admin_user, org)), None)).tools == []


# ─── call_tool ───────────────────────────────────────────────────────────────


async def test_call_tool_basics(db, org, admin_user, sessions):
    org = SimpleNamespace(id=org.id)  # rollbacks expire the ORM row
    handlers = h.Handlers(_registry())
    assert body(await handlers.call_tool(ctx_for(None), call("list_courses")))["error"]["code"] == "unauthenticated"
    assert body(await handlers.call_tool(ctx_for(member(admin_user, org)), call("nope")))["error"]["code"] == "unknown_tool"
    result = await handlers.call_tool(ctx_for(member(admin_user, org)), call("create_course"))
    assert body(result) == {"ok": True, "surface": "mcp", "read_only": False}
    # Hidden from a read-only connection, so it is refused as unknown.
    denied = await handlers.call_tool(ctx_for(member(admin_user, org, ("mcp:read",))), call("create_course"))
    assert body(denied)["error"]["code"] == "unknown_tool"
    assert body(await handlers.call_tool(ctx_for(member(admin_user, org)), call("forbidden")))["error"]["code"] == "http_403"
    assert body(await handlers.call_tool(ctx_for(member(admin_user, org)), call("crash")))["error"]["code"] == "internal_error"


async def test_call_tool_rate_limited(db, org, admin_user, sessions):
    org = SimpleNamespace(id=org.id)  # rollbacks expire the ORM row
    with patch.object(h, "_rate_limited", return_value=True):
        result = await h.Handlers(_registry()).call_tool(ctx_for(member(admin_user, org)), call("list_courses"))
    assert body(result)["error"]["code"] == "rate_limited"


def test_rate_limit_helper(admin_user, org):
    p = member(admin_user, org)
    with patch("src.services.security.rate_limiting.check_rate_limit", return_value=(False, 1, 1)):
        assert h._rate_limited(p) is True
    with patch("src.services.security.rate_limiting.check_rate_limit", side_effect=RuntimeError):
        assert h._rate_limited(p) is False


async def test_call_tool_org_states(db, org, admin_user, sessions):
    handlers = h.Handlers(_registry())
    gone = MCPPrincipal(user=admin_user, org_id=999, scopes=frozenset({"mcp:read"}), kind="oauth")
    assert body(await handlers.call_tool(ctx_for(gone), call("list_courses")))["error"]["code"] == "org_not_found"

    with patch("src.security.org_auth.enforce_org_mfa", new_callable=AsyncMock, side_effect=HTTPException(status_code=403, detail={"message": "2FA needed"})):
        blocked = await handlers.call_tool(ctx_for(member(admin_user, org)), call("list_courses"))
    assert body(blocked)["error"] == {"code": "org_policy", "message": "2FA needed", "hint": srv.hint_for("org_policy"), "retryable": False}

    db.add(OrganizationConfig(org_id=org.id, config={"config_version": "2.0", "admin_toggles": {"mcp": {"disabled": True}}}, creation_date="", update_date=""))
    await db.commit()
    assert body(await handlers.call_tool(ctx_for(member(admin_user, org)), call("list_courses")))["error"]["code"] == "mcp_disabled"


async def test_api_token_skips_session_policy(db, org, sessions):
    token = MCPPrincipal(user=APITokenUser(org_id=org.id, rights={"courses": {"action_read": True}}), org_id=org.id, scopes=frozenset({"mcp:read", "mcp:write"}), kind="api_token")
    with patch("src.security.org_auth.enforce_org_mfa", new_callable=AsyncMock) as mfa:
        result = await h.Handlers(_registry()).call_tool(ctx_for(token), call("list_courses"))
    mfa.assert_not_awaited()
    assert not result.is_error


# ─── resources and prompts ───────────────────────────────────────────────────


async def test_resources(db, org, admin_user, sessions):
    org = SimpleNamespace(id=org.id)  # rollbacks expire the ORM row
    handlers = h.Handlers(_registry())
    assert (await handlers.list_resources(ctx_for(None), None)).resources == []
    listed = await handlers.list_resources(ctx_for(member(admin_user, org)), None)
    uris = [str(r.uri) for r in listed.resources]
    assert [u for u in uris if u.startswith(("learnhouse://org", "learnhouse://course"))] == ["learnhouse://org", "learnhouse://course/course_1"]
    assert {"learnhouse://blocks", "learnhouse://branding", "learnhouse://guide/pedagogy", "learnhouse://block/quiz"} <= set(uris)
    templates = await handlers.list_resource_templates(ctx_for(None), None)
    assert {t.name for t in templates.resource_templates} == {
        "course", "activity", "assignment", "path", "community", "activity_markdown", "block", "guide",
    }

    for uri in ("learnhouse://org", "learnhouse://course/course_1", "learnhouse://activity/activity_1"):
        res = await handlers.read_resource(ctx_for(member(admin_user, org)), types.ReadResourceRequestParams(uri=uri))
        assert res.contents[0].uri == uri and '"ok": true' in res.contents[0].text

    for uri in ("https://x.test", "learnhouse://course"):
        with pytest.raises(MCPError):
            await handlers.read_resource(ctx_for(member(admin_user, org)), types.ReadResourceRequestParams(uri=uri))
    with pytest.raises(MCPError):
        await handlers.read_resource(ctx_for(None), types.ReadResourceRequestParams(uri="learnhouse://org"))


async def test_resource_read_denied_paths(db, org, admin_user, sessions):
    org = SimpleNamespace(id=org.id)  # rollbacks expire the ORM row
    handlers = h.Handlers(_registry())
    reader = member(admin_user, org)
    with patch("src.security.org_auth.enforce_org_mfa", new_callable=AsyncMock, side_effect=HTTPException(status_code=403, detail="no")):
        with pytest.raises(MCPError):
            await handlers.read_resource(ctx_for(reader), types.ReadResourceRequestParams(uri="learnhouse://org"))
        listed = [str(r.uri) for r in (await handlers.list_resources(ctx_for(reader), None)).resources]
        assert "learnhouse://org" in listed and not any(u.startswith("learnhouse://course/") for u in listed)
    with patch.object(h, "run_tool", new_callable=AsyncMock, return_value=SimpleNamespace(status="denied", reason="no")):
        with pytest.raises(MCPError):
            await handlers.read_resource(ctx_for(reader), types.ReadResourceRequestParams(uri="learnhouse://org"))
    gone = MCPPrincipal(user=admin_user, org_id=999, scopes=frozenset(), kind="oauth")
    with pytest.raises(MCPError):
        await handlers.read_resource(ctx_for(gone), types.ReadResourceRequestParams(uri="learnhouse://org"))


async def test_prompts():
    handlers = h.Handlers(_registry())
    listed = await handlers.list_prompts(ctx_for(None), None)
    assert {p.name for p in listed.prompts} == set(prompts.PROMPTS)
    result = await handlers.get_prompt(ctx_for(None), types.GetPromptRequestParams(name="draft_course", arguments={"topic": "Rust"}))
    assert "Rust" in result.messages[0].content.text
    report = prompts.render_prompt("learner_report", {"course": "Intro"})
    assert "in the course 'Intro'" in report.messages[0].content.text
    assert "across the organization" in prompts.render_prompt("learner_report", None).messages[0].content.text
    with pytest.raises(MCPError):
        await handlers.get_prompt(ctx_for(None), types.GetPromptRequestParams(name="draft_course", arguments={}))
    with pytest.raises(MCPError):
        await handlers.get_prompt(ctx_for(None), types.GetPromptRequestParams(name="nope"))


