"""Tests for the MKA Brand Center AI integration. The live MCP is never contacted."""

from __future__ import annotations

import pytest
from pydantic_ai.mcp import MCPToolset
from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart
from pydantic_ai.models.function import AgentInfo, DeltaToolCall, FunctionModel
from pydantic_ai.toolsets import FunctionToolset

from src.services.ai import mka_brand
from src.services.ai.llm import client
from src.services.ai.mka_brand import breaker, config, floor, images, toolset


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("MKA_BRANDCENTER_TOKEN", "test-token-not-real")
    monkeypatch.delenv("MKA_BRANDCENTER_URL", raising=False)
    monkeypatch.setattr(floor, "_schedule_refresh", lambda: None)
    breaker.reset()
    floor._reset_for_tests()
    yield
    breaker.reset()
    floor._reset_for_tests()


def _server() -> tuple[FunctionToolset, list[str]]:
    """Stand-in for the MCP server: a FunctionToolset (fastmcp's server extra is not installed)."""
    calls: list[str] = []
    srv = FunctionToolset()

    @srv.tool_plain
    def check_copy(brand: str, text: str) -> str:
        calls.append("check_copy")
        return "ok"

    @srv.tool_plain
    def get_culture_guardrails() -> str:
        calls.append("get_culture_guardrails")
        return "G1"

    @srv.tool_plain
    def compose_graphic(brand: str) -> str:
        calls.append("compose_graphic")
        return "nope"

    return srv, calls


def _use_server(monkeypatch, srv):
    monkeypatch.setattr(toolset, "_new_mcp_toolset", lambda: srv)


def _patch_model(monkeypatch, model):
    monkeypatch.setattr(client, "build_model", lambda name: model)


# ---- disabled / kill switch -------------------------------------------------


def test_disabled_without_token(monkeypatch):
    monkeypatch.delenv("MKA_BRANDCENTER_TOKEN")
    assert not config.enabled()
    assert mka_brand.augment("sys") == "sys"
    assert mka_brand.augment(None) is None
    assert toolset.get_toolset() is None
    assert mka_brand.toolsets_for(object()) is None


async def test_disabled_agent_identical_to_upstream(monkeypatch):
    monkeypatch.delenv("MKA_BRANDCENTER_TOKEN")
    seen = {}

    def fn(messages, info: AgentInfo):
        seen["tools"] = [t.name for t in info.function_tools]
        seen["system"] = [
            p.content for m in messages for p in getattr(m, "parts", []) if p.part_kind == "system-prompt"
        ]
        return ModelResponse(parts=[TextPart("hi")])

    _patch_model(monkeypatch, FunctionModel(fn))
    out = await client.generate(model_name="x", user_prompt="u", system_prompt="SYS")
    assert out == "hi"
    assert seen == {"tools": [], "system": ["SYS"]}


# ---- allow-list -------------------------------------------------------------


async def test_allow_list_filters_tools(monkeypatch):
    srv, _ = _server()
    _use_server(monkeypatch, srv)
    seen = {}

    def fn(messages, info: AgentInfo):
        seen["tools"] = sorted(t.name for t in info.function_tools)
        return ModelResponse(parts=[TextPart("done")])

    _patch_model(monkeypatch, FunctionModel(fn))
    await client.generate(model_name="x", user_prompt="u")
    assert seen["tools"] == ["check_copy", "get_culture_guardrails"]
    assert "compose_graphic" not in seen["tools"]


def test_toolsets_for_skips_models_without_tool_support():
    class _P:
        supports_tools = False

    class _M:
        profile = _P()

    assert mka_brand.toolsets_for(_M()) is None


# ---- breaker / fail-open ----------------------------------------------------


async def test_breaker_opens_on_connect_error_and_generation_succeeds(monkeypatch):
    monkeypatch.setattr(
        toolset, "_new_mcp_toolset", lambda: MCPToolset("http://127.0.0.1:9/mcp", init_timeout=1.0)
    )

    def fn(messages, info: AgentInfo):
        assert [t.name for t in info.function_tools] == []
        return ModelResponse(parts=[TextPart("still works")])

    _patch_model(monkeypatch, FunctionModel(fn))
    out = await client.generate(model_name="x", user_prompt="u")
    assert out == "still works"
    assert breaker.is_open()
    # While open, no toolset is built at all.
    assert mka_brand.toolsets_for(object()) is None


async def test_tool_call_failure_is_swallowed(monkeypatch):
    srv = FunctionToolset()

    @srv.tool_plain
    def check_copy(brand: str, text: str) -> str:
        raise RuntimeError("boom")

    _use_server(monkeypatch, srv)

    def fn(messages, info: AgentInfo):
        if any(p.part_kind == "tool-return" or p.part_kind == "retry-prompt" for m in messages for p in getattr(m, "parts", [])):
            return ModelResponse(parts=[TextPart("recovered")])
        return ModelResponse(parts=[ToolCallPart("check_copy", {"brand": "b", "text": "t"})])

    _patch_model(monkeypatch, FunctionModel(fn))
    assert await client.generate(model_name="x", user_prompt="u") == "recovered"
    assert breaker.is_open()


# ---- floor ------------------------------------------------------------------


async def test_floor_uses_last_good_cache_when_mcp_down(monkeypatch):
    async def ok():
        return "GUARDRAIL-ONE"

    monkeypatch.setattr(floor, "_fetch", ok)
    await floor.refresh()
    assert "GUARDRAIL-ONE" in mka_brand.augment("sys")

    async def down():
        raise ConnectionError("down")

    monkeypatch.setattr(floor, "_fetch", down)
    breaker.reset()
    await floor.refresh()
    assert breaker.is_open()
    out = mka_brand.augment("sys")
    assert "GUARDRAIL-ONE" in out and out.endswith("sys")


def test_augment_size_cap_and_fidelity_clause():
    floor._cache["text"] = "x" * 50_000
    floor._cache["at"] = 10**12
    out = floor.build_block()
    assert len(out) <= floor.MAX_BLOCK_CHARS
    assert "preserve the source meaning verbatim" in out
    assert "preserve the source meaning verbatim" in mka_brand.augment(None)


def test_floor_drops_draft_entries():
    cleaned = floor._clean('keep me\n\nconfidence: "draft" unreviewed\n\nconfidence: reviewed ok')
    assert "unreviewed" not in cleaned and "keep me" in cleaned and "reviewed ok" in cleaned


def test_floor_prepends_to_system_prompt():
    out = mka_brand.augment("ORIGINAL")
    assert out.startswith("MKA USA brand") and out.endswith("ORIGINAL")


# ---- images -----------------------------------------------------------------


async def test_image_prompt_fail_open(monkeypatch):
    async def boom(name, args):
        raise ConnectionError("down")

    monkeypatch.setattr(toolset, "call_tool_text", boom)
    out = await mka_brand.brand_image_prompt("a mosque at dawn")
    assert out.startswith("a mosque at dawn") and images.TEXT_FREE_CLAUSE in out
    assert breaker.is_open()


async def test_image_prompt_uses_built_prompt_and_respects_cap(monkeypatch):
    async def fake(name, args):
        return "BUILT PROMPT " + "z" * 500 + "\n\nrules applied" if name == "build_illustration_prompt" else "G"

    monkeypatch.setattr(toolset, "call_tool_text", fake)
    out = await mka_brand.brand_image_prompt("subject", max_chars=200)
    assert out.startswith("BUILT PROMPT") and len(out) <= 200 and out.endswith(images.TEXT_FREE_CLAUSE)


async def test_image_edit_mode_keeps_instruction(monkeypatch):
    async def fail(name, args):
        raise AssertionError("must not call MCP for edits")

    monkeypatch.setattr(toolset, "call_tool_text", fail)
    out = await mka_brand.brand_image_prompt("make it darker", editing=True)
    assert out.startswith("make it darker") and images.TEXT_FREE_CLAUSE in out


async def test_image_prompt_disabled_is_identity(monkeypatch):
    monkeypatch.delenv("MKA_BRANDCENTER_TOKEN")
    assert await mka_brand.brand_image_prompt("p") == "p"


# ---- streaming + budget -----------------------------------------------------


async def test_streaming_with_tool_call_yields_full_text(monkeypatch):
    srv, calls = _server()
    _use_server(monkeypatch, srv)

    async def stream_fn(messages, info: AgentInfo):
        returned = any(p.part_kind == "tool-return" for m in messages for p in getattr(m, "parts", []))
        if not returned:
            yield {0: DeltaToolCall(name="check_copy", json_args='{"brand":"b","text":"t"}', tool_call_id="c1")}
        else:
            yield "Hello "
            yield "world"

    _patch_model(monkeypatch, FunctionModel(stream_function=stream_fn))
    chunks = [c async for c in client.generate_stream(model_name="x", user_prompt="u")]
    assert "".join(chunks) == "Hello world"
    assert calls == ["check_copy"]


async def test_tool_call_budget_then_continues_without_tools(monkeypatch):
    srv, calls = _server()
    _use_server(monkeypatch, srv)

    def fn(messages, info: AgentInfo):
        if info.function_tools:
            return ModelResponse(parts=[ToolCallPart("get_culture_guardrails", {})])
        return ModelResponse(parts=[TextPart("final")])

    _patch_model(monkeypatch, FunctionModel(fn))
    out = await client.generate(model_name="x", user_prompt="u")
    assert out == "final"
    assert len(calls) == config.MAX_TOOL_CALLS_PER_RUN
