"""Tool discovery, output schemas, pagination, progress, static resources and
the dual JSON/stream transport of the MCP server (discovery.py, handlers.py,
resources.py, server.py)."""

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import mcp_types as types
import pytest
from mcp.shared.exceptions import MCPError
from pydantic import BaseModel, ConfigDict

from src.db.organization_config import OrganizationConfig
from src.security.rbac import AccessAction
from src.services.ai.tools import ActionTier, ToolSpec
from src.services.mcp import discovery as disc
from src.services.mcp import handlers as h
from src.services.mcp import resources
from src.services.mcp import server as srv
from src.tests.services.test_mcp_server import (
    _ok,
    _registry,
    body,
    call,
    ctx_for,
    member,
    sessions,  # noqa: F401  (fixture)
)


class _Sorted(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sort: str = "name"
    limit: int = 10
    cursor: str | None = None


def _paged_registry():
    from typing import Literal

    class P(BaseModel):
        model_config = ConfigDict(extra="forbid")
        sort: Literal["name", "newest"] = "name"
        limit: int = 10
        cursor: str | None = None

    async def build(ctx, params):
        from src.services.ai.tools.progress import report_progress

        for i in range(3):
            report_progress(i + 1, 3, f"step {i + 1}")
        return {"ok": True, "summary": "Built it"}

    r = _registry()
    r.register_all([
        ToolSpec(name="list_things", description="List things, paged.", params_model=P, tier=ActionTier.READ,
                 rights_bucket="courses", access_action=AccessAction.READ, execute=_ok, toolset="courses"),
        ToolSpec(name="enroll_people", description="Enroll people in a course.", params_model=P, tier=ActionTier.CREATE,
                 rights_bucket="courses", access_action=AccessAction.CREATE, execute=_ok, toolset="teaching", title="Enroll"),
        ToolSpec(name="build_thing", description="Build something long.", params_model=P, tier=ActionTier.CREATE,
                 rights_bucket="courses", access_action=AccessAction.CREATE, execute=build, toolset="courses"),
    ])
    return r


# ─── cursors and schemas ─────────────────────────────────────────────────────


def test_cursors_round_trip_and_reject_garbage():
    assert disc.decode_cursor(None) == 0 and disc.decode_cursor(disc.encode_cursor(7)) == 7
    for bad in ("garbage", disc.encode_cursor(-1)):
        with pytest.raises(Exception):
            disc.decode_cursor(bad)
    items = list(range(5))
    page, nxt = disc.paginate(items, None, 2)
    assert page == [0, 1] and disc.paginate(items, nxt, 2) == ([2, 3], disc.encode_cursor(4))
    assert disc.paginate(items, disc.encode_cursor(4), 2) == ([4], None)


def test_output_schemas_are_open_and_fit_the_tool():
    reg = _paged_registry()
    listed = disc.output_schema(reg.get("list_things"))
    assert set(listed["properties"]) >= {"items", "next_cursor", "has_more", "result"} and listed["additionalProperties"] is True
    assert "required" not in listed
    assert "summary" in disc.output_schema(reg.get("enroll_people"))["properties"]
    assert set(disc.output_schema(reg.get("get_course"))["properties"]) == {"resolved", "result"}
    named = disc.output_schema(SimpleNamespace(name="build_course", tier=ActionTier.CREATE, params_model=_Sorted))
    assert "ids" in named["properties"]
    tool = srv.tool_definition(reg.get("list_things"))
    assert tool.output_schema == listed
    meta = {t.name: t for t in disc.meta_tool_definitions()}
    assert meta["search_tools"].annotations.read_only_hint and not meta["invoke_tool"].annotations.read_only_hint


def test_search_ranks_name_words_first():
    reg = _paged_registry()
    specs = reg.specs()
    out = disc.search(specs, {"list_things"}, "enroll people", None, True, 5, None, srv.tool_definition)
    assert out["items"][0]["name"] == "enroll_people" and out["items"][0]["input_schema"]["type"] == "object"
    assert not out["items"][0]["listed"] and out["total"] >= 1
    by_set = disc.search(specs, set(), None, "teaching", False, 5, None, srv.tool_definition)
    assert [i["name"] for i in by_set["items"]] == ["enroll_people"] and "input_schema" not in by_set["items"][0]
    overview = disc.search(specs, set(), None, None, True, 5, None, srv.tool_definition)
    assert overview["items"] == [] and overview["hint"] and {t["name"] for t in overview["toolsets"]} >= {"courses", "teaching"}
    prefix = disc.search(specs, set(), "listing things", None, True, 5, None, srv.tool_definition)
    assert prefix["items"][0]["name"] == "list_things"
    assert disc.search(specs, set(), "the of", None, True, 5, None, srv.tool_definition)["hint"]


# ─── handlers ────────────────────────────────────────────────────────────────


async def test_search_tools_and_invoke_tool(db, org, admin_user, sessions):  # noqa: F811 (fixture)
    org = SimpleNamespace(id=org.id)
    handlers = h.Handlers(_paged_registry())
    who = ctx_for(member(admin_user, org))
    found = body(await handlers.call_tool(who, call("search_tools", {"query": "enroll", "limit": 2})))
    assert found["items"][0]["name"] == "enroll_people" and found["items"][0]["listed"] is False
    for args, code in (({"limit": 0}, "invalid_args"), ({"toolset": "nope"}, "invalid_args"), ({"query": "enroll", "cursor": "garbage"}, "invalid_cursor")):
        out = body(await handlers.call_tool(who, call("search_tools", args)))
        assert out["error"]["code"] == code, args
    assert "allowed" in json.dumps(body(await handlers.call_tool(who, call("search_tools", {"toolset": "nope"}))))
    # invoke_tool runs the real tool with the real checks.
    ran = body(await handlers.call_tool(who, call("invoke_tool", {"name": "enroll_people", "arguments": {}})))
    assert ran["ok"] is True
    with patch.object(h.approvals, "create", return_value=SimpleNamespace(id="apr_1")):
        held = body(await handlers.call_tool(who, call("invoke_tool", {"name": "delete_course", "arguments": {"course_uuid": "course_1"}})))
    assert held["error"]["code"] == "approval_required"
    for bad in ({"name": "search_tools"}, {"name": 5}, {"name": "enroll_people", "arguments": []}):
        assert body(await handlers.call_tool(who, call("invoke_tool", bad)))["error"]["code"] == "invalid_args"
    unknown = body(await handlers.call_tool(who, call("invoke_tool", {"name": "enrol_people"})))
    assert unknown["error"]["code"] == "unknown_tool" and unknown["error"]["did_you_mean"] == ["enroll_people"]
    with patch.object(h, "_rate_limited", return_value=True):
        assert body(await handlers.call_tool(who, call("search_tools", {})))["error"]["code"] == "rate_limited"


async def test_search_tools_when_mcp_is_off(db, org, admin_user, sessions):  # noqa: F811 (fixture)
    db.add(OrganizationConfig(org_id=org.id, config={"config_version": "2.0", "admin_toggles": {"mcp": {"disabled": True}}}, creation_date="", update_date=""))
    await db.commit()
    out = body(await h.Handlers(_paged_registry()).call_tool(ctx_for(member(admin_user, SimpleNamespace(id=org.id))), call("search_tools", {"query": "x"})))
    assert out["error"]["code"] == "mcp_disabled"


async def test_invalid_args_list_fields_and_allowed_values(db, org, admin_user, sessions):  # noqa: F811 (fixture)
    handlers = h.Handlers(_paged_registry())
    out = body(await handlers.call_tool(ctx_for(member(admin_user, SimpleNamespace(id=org.id))), call("list_things", {"sort": "random", "bogus": 1})))
    fields = {f["field"]: f for f in out["error"]["fields"]}
    assert "'name' or 'newest'" in fields["sort"]["allowed"] and fields["bogus"]["problem"] == "unknown argument; remove it"
    assert h.invalid_fields(_paged_registry().get("list_things"), {}) is None


async def test_tool_list_pages(db, org, admin_user, sessions, monkeypatch):  # noqa: F811 (fixture)
    monkeypatch.setattr(disc, "TOOLS_PAGE", 4)
    handlers = h.Handlers(_paged_registry())
    who = ctx_for(member(admin_user, SimpleNamespace(id=org.id)), query={"toolsets": "all"})
    names, cursor, pages = [], None, 0
    while True:
        page = await handlers.list_tools(who, types.PaginatedRequestParams(cursor=cursor))
        names += [t.name for t in page.tools]
        pages += 1
        cursor = page.next_cursor
        if not cursor:
            break
    assert pages > 2 and names[:2] == ["search_tools", "invoke_tool"] and len(names) == len(set(names))
    with pytest.raises(MCPError):
        await handlers.list_tools(who, types.PaginatedRequestParams(cursor="garbage"))


class _Session:
    def __init__(self):
        self.progress = []
        self.logs = []

    async def report_progress(self, done, total, message):
        self.progress.append((done, total, message))

    async def send_log_message(self, level, data, logger=None, related_request_id=None):
        self.logs.append((level, data))


async def test_progress_and_log_notifications(db, org, admin_user, sessions):  # noqa: F811 (fixture)
    handlers = h.Handlers(_paged_registry())
    who = ctx_for(member(admin_user, SimpleNamespace(id=org.id)))
    session = _Session()
    who.session = session
    who.meta = {"progress_token": "tok-1"}
    who.request_id = 3
    out = await handlers.call_tool(who, call("build_thing"))
    assert not out.is_error
    assert session.progress == [(1, 3, "step 1"), (2, 3, "step 2"), (3, 3, "step 3")]
    assert session.logs == [("info", {"tool": "build_thing", "summary": "Built it"})]
    # Without a progress token nothing is sent; a broken log channel is ignored.
    quiet = _Session()
    who.session, who.meta = quiet, None
    await handlers.call_tool(who, call("build_thing"))
    assert quiet.progress == []
    broken = SimpleNamespace(send_log_message=AsyncMock(side_effect=RuntimeError("gone")))
    await h._log(SimpleNamespace(session=broken), "info", {})
    await h._log(SimpleNamespace(session=None), "info", {})
    await h._flush_progress(None)


# ─── resources, prompts, completion ──────────────────────────────────────────


async def test_static_resources_branding_and_markdown(db, org, admin_user, sessions):  # noqa: F811 (fixture)
    db.add(OrganizationConfig(org_id=org.id, config={"config_version": "2.0", "customization": {"general": {"color": "#112233", "font": "Inter"}}}, creation_date="", update_date=""))
    await db.commit()
    org_ns = SimpleNamespace(id=org.id)
    handlers = h.Handlers(_registry())
    who = ctx_for(member(admin_user, org_ns))

    async def read(uri):
        return (await handlers.read_resource(who, types.ReadResourceRequestParams(uri=uri))).contents[0]

    blocks = json.loads((await read("learnhouse://blocks")).text)
    assert len(blocks["blocks"]) == 27 and blocks["blocks"][0]["schema"].startswith("learnhouse://block/")
    quiz = json.loads((await read("learnhouse://block/quiz")).text)
    assert quiz["schema"]["properties"]["questions"] and quiz["example"]["type"] == "quiz"
    guide = await read("learnhouse://guide/course-spec")
    assert guide.mime_type == "text/markdown" and '"idempotency_key"' in guide.text
    brand = json.loads((await read("learnhouse://branding")).text)
    assert brand["brand_color"] == "#112233" and brand["font"] == "Inter" and "theme" in brand
    with pytest.raises(MCPError, match="Known"):
        await read("learnhouse://block/nope")
    md = await read("learnhouse://activity_markdown/activity_1")
    assert md.mime_type == "text/markdown"
    with patch.object(h, "run_tool", new=AsyncMock(return_value=SimpleNamespace(status="executed", result={"markdown": "# Hi"}))):
        assert (await read("learnhouse://activity_markdown/activity_1")).text == "# Hi"
    with patch.object(h, "_rate_limited", return_value=True), pytest.raises(MCPError):
        await read("learnhouse://branding")


async def test_static_resources_respect_the_org_switch(db, org, admin_user, sessions):  # noqa: F811 (fixture)
    db.add(OrganizationConfig(org_id=org.id, config={"config_version": "2.0", "admin_toggles": {"mcp": {"disabled": True}}}, creation_date="", update_date=""))
    await db.commit()
    handlers = h.Handlers(_registry())
    who = ctx_for(member(admin_user, SimpleNamespace(id=org.id)))
    for uri in ("learnhouse://blocks", "learnhouse://branding"):
        with pytest.raises(MCPError):
            await handlers.read_resource(who, types.ReadResourceRequestParams(uri=uri))


async def test_resource_and_prompt_pages(db, org, admin_user, sessions, monkeypatch):  # noqa: F811 (fixture)
    monkeypatch.setattr(disc, "RESOURCES_PAGE", 10)
    monkeypatch.setattr(disc, "PROMPTS_PAGE", 3)
    handlers = h.Handlers(_registry())
    who = ctx_for(member(admin_user, SimpleNamespace(id=org.id)))
    first = await handlers.list_resources(who, types.PaginatedRequestParams())
    second = await handlers.list_resources(who, types.PaginatedRequestParams(cursor=first.next_cursor))
    assert len(first.resources) == 10 and first.next_cursor and {str(r.uri) for r in first.resources}.isdisjoint({str(r.uri) for r in second.resources})
    prompts = await handlers.list_prompts(who, types.PaginatedRequestParams())
    assert len(prompts.prompts) == 3 and prompts.next_cursor
    for method in (handlers.list_resources, handlers.list_prompts):
        with pytest.raises(MCPError):
            await method(who, types.PaginatedRequestParams(cursor="garbage"))


async def test_static_completions(db, org, admin_user, sessions):  # noqa: F811 (fixture)
    handlers = h.Handlers(_registry())
    who = ctx_for(member(admin_user, SimpleNamespace(id=org.id)))

    async def complete(ref, name, value):
        out = await handlers.complete(who, types.CompleteRequestParams(ref=ref, argument=types.CompletionArgument(name=name, value=value)))
        return out.completion.values

    block_ref = types.ResourceTemplateReference(type="ref/resource", uri="learnhouse://block/{type}")
    assert await complete(block_ref, "type", "fl") == ["flashcards"]
    assert "web_preview" in await complete(block_ref, "type", "preview")
    assert await complete(types.ResourceTemplateReference(type="ref/resource", uri="learnhouse://guide/{topic}"), "topic", "ped") == ["pedagogy"]
    assert "fr" in await complete(types.PromptReference(type="ref/prompt", name="translate_course"), "locale", "f")
    assert resources.complete_static(("a", "ba"), "a") == ["a", "ba"]


def test_new_prompts_render():
    from src.services.mcp.prompts import PROMPTS, render_prompt

    for name in ("course_from_document", "course_from_url", "improve_course", "add_assessments", "translate_course"):
        prompt = PROMPTS[name]
        args = {a.name: "x" for a in prompt.args if a.required}
        text = render_prompt(name, args).messages[0].content.text
        assert "LearnHouse" in text and "{" not in text.replace("{{", "")
    assert "build_course" in render_prompt("draft_course", {"topic": "plants"}).messages[0].content.text


# ─── transport ───────────────────────────────────────────────────────────────


class _Manager:
    def __init__(self):
        self.seen = []
        self.entered = False

    def run(self):
        import contextlib

        manager = self

        @contextlib.asynccontextmanager
        async def go():
            manager.entered = True
            yield

        return go()

    async def handle_request(self, scope, receive, send):
        chunks = []
        while True:
            message = await receive()
            chunks.append(message.get("body", b""))
            if not message.get("more_body"):
                break
        self.seen.append(b"".join(chunks))


def _receiver(*bodies):
    messages = [{"type": "http.request", "body": b, "more_body": i < len(bodies) - 1} for i, b in enumerate(bodies)]

    async def receive():
        return messages.pop(0)

    return receive


async def test_dual_manager_streams_only_progress_requests(monkeypatch):
    plain, stream = _Manager(), _Manager()
    dual = srv.DualSessionManager(plain, stream)
    async with dual.run():
        assert plain.entered and stream.entered
    sse = [(b"accept", b"application/json, text/event-stream")]
    await dual.handle_request({"type": "http", "method": "POST", "headers": sse}, _receiver(b'{"params":{"_meta":{"progressToken":1}}}'), None)
    await dual.handle_request({"type": "http", "method": "POST", "headers": sse}, _receiver(b'{"method":"tools/list"}'), None)
    await dual.handle_request({"type": "http", "method": "POST", "headers": [(b"accept", b"application/json")]}, _receiver(b'{"progressToken":2}'), None)
    await dual.handle_request({"type": "http", "method": "GET", "headers": []}, _receiver(b""), None)
    assert stream.seen == [b'{"params":{"_meta":{"progressToken":1}}}']
    assert plain.seen == [b'{"method":"tools/list"}', b'{"progressToken":2}', b""]
    # A body read in chunks arrives whole; one over the cap streams through the rest untouched.
    await dual.handle_request({"type": "http", "method": "POST", "headers": sse}, _receiver(b'{"a":', b"1}"), None)
    assert plain.seen[-1] == b'{"a":1}'
    monkeypatch.setattr(srv, "MAX_BODY", 3)
    await dual.handle_request({"type": "http", "method": "POST", "headers": sse}, _receiver(b"abcd", b"ef"), None)
    assert plain.seen[-1] == b"abcdef"
    manager = srv.build_mcp_session_manager(_registry())
    assert isinstance(manager, srv.DualSessionManager)
