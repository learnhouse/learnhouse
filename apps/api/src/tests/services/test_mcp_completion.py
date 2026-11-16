"""Resources, prompt gating and argument completion on the MCP server
(src/services/mcp/resources.py and the matching handlers)."""

from contextlib import asynccontextmanager
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import patch

import mcp_types as types
import pytest
from mcp.shared.exceptions import MCPError

from src.db.organization_config import OrganizationConfig
from src.services.ai.tools import ToolRegistry
from src.services.mcp import handlers as h
from src.services.mcp import prompts, resources
from src.services.mcp import server as srv
from src.tests.services.test_mcp_server import _spec, ctx_for, member

SEEN: list[tuple[str, dict]] = []


def _answer(name):
    async def run(ctx, params):
        SEEN.append((name, params.model_dump()))
        if name == "search":
            return {
                "matches": [
                    {"kind": "course", "uuid": "course_1", "name": "Intro to Rust"},
                    {"kind": "course", "uuid": "course_2", "name": "Rust in Practice"},
                    {"kind": "course", "uuid": "course_1", "name": "Intro to Rust"},
                    {"kind": "course", "name": "no uuid"},
                ],
            }
        if name in ("list_courses", "list_paths"):
            prefix = "course" if name == "list_courses" else "path"
            return {"items": [{"kind": prefix, "uuid": f"{prefix}_9", "name": f"First {prefix}"}], "has_more": True}
        return {"ok": True, "tool": name}

    return run


def _params_for(name):
    from pydantic import BaseModel, Field

    fields = {
        "search": {"query": (str, ...), "kinds": (list, None), "limit": (int, 10)},
        "list_courses": {"limit": (int, 20)},
        "list_paths": {"limit": (int, 20)},
        "get_path": {"path_uuid": (str, ...)},
        "get_assignment": {"assignment_uuid": (str, ...), "include_task_contents": (bool, False)},
    }.get(name, {})
    from pydantic import create_model

    return create_model(f"{name}_params", __base__=BaseModel, **{k: (t, Field(d)) for k, (t, d) in fields.items()})


def _registry():
    r = ToolRegistry()
    for name, feature in (
        ("get_context", None), ("search", None), ("list_courses", None), ("get_course", None),
        ("list_paths", "paths"), ("get_path", "paths"), ("get_assignment", None),
    ):
        spec = _spec(name, execute=_answer(name), feature=feature, toolset="core")
        r.register(replace(spec, params_model=_params_for(name)))
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


@pytest.fixture(autouse=True)
def clear_seen():
    SEEN.clear()
    yield


def complete(ref, name, value):
    return types.CompleteRequestParams(ref=ref, argument=types.CompletionArgument(name=name, value=value))


# ─── resources ───────────────────────────────────────────────────────────────


def test_parse_uri_and_templates():
    course, ident = resources.parse_uri("learnhouse://course/course_1")
    assert course.tool == "get_course" and ident == "course_1"
    assert course.tool_args("course_1") == {"course_uuid": "course_1"}
    assert resources.parse_uri("learnhouse://org")[0].tool_args(None) == {}
    # An id where none goes, none where one does, and unknown kinds.
    for uri in ("learnhouse://org/x", "learnhouse://path", "learnhouse://nope/x", "https://x", None):
        assert resources.parse_uri(uri) is None
    assert resources.RESOURCES["path"].template == "learnhouse://path/{path_uuid}"
    assert resources.RESOURCES["org"].template is None
    assert srv.parse_resource_uri("learnhouse://path/path_1") == ("path", "path_1")
    assert resources.TEMPLATE_ARGS["activity_uuid"] == "activity"


def test_completion_values():
    found = {"matches": [{"uuid": "a", "name": "A"}, {"uuid": "a", "name": "A"}, "junk", {"name": ""}]}
    assert resources.completion_values(found, by="uuid") == ["a"]
    assert resources.completion_values({"items": [{"uuid": "b", "name": "B"}, {"name": "C"}]}, by="name") == ["B"]
    assert resources.completion_values(None, by="name") == []


async def test_paths_are_listed_and_read(db, org, admin_user, sessions):
    org = SimpleNamespace(id=org.id)
    handlers = h.Handlers(_registry())
    listed = await handlers.list_resources(ctx_for(member(admin_user, org)), None)
    assert [str(r.uri) for r in listed.resources if str(r.uri).startswith(("learnhouse://org", "learnhouse://course", "learnhouse://path"))] == [
        "learnhouse://org", "learnhouse://course/course_9", "learnhouse://path/path_9",
    ]
    read = await handlers.read_resource(
        ctx_for(member(admin_user, org)), types.ReadResourceRequestParams(uri="learnhouse://path/path_1")
    )
    assert '"tool": "get_path"' in read.contents[0].text
    assert SEEN[-1] == ("get_path", {"path_uuid": "path_1"})
    await handlers.read_resource(
        ctx_for(member(admin_user, org)), types.ReadResourceRequestParams(uri="learnhouse://assignment/assignment_1")
    )
    assert SEEN[-1] == ("get_assignment", {"assignment_uuid": "assignment_1", "include_task_contents": True})


async def test_nothing_listed_while_connections_are_off(db, org, admin_user, sessions):
    db.add(OrganizationConfig(org_id=org.id, config={"config_version": "2.0", "admin_toggles": {"mcp": {"disabled": True}}}, creation_date="", update_date=""))
    await db.commit()
    principal = member(admin_user, org)
    handlers = h.Handlers(_registry())
    assert (await handlers.list_resources(ctx_for(principal), None)).resources == []
    assert (await handlers.list_prompts(ctx_for(principal), None)).prompts == []
    with pytest.raises(MCPError):
        await handlers.get_prompt(ctx_for(principal), types.GetPromptRequestParams(name="draft_course", arguments={"topic": "x"}))


# ─── prompts ─────────────────────────────────────────────────────────────────


async def test_prompts_follow_features_and_access(db, org, admin_user, regular_user, sessions):
    db.add(OrganizationConfig(org_id=org.id, config={"config_version": "2.0", "admin_toggles": {"paths": {"disabled": True}}}, creation_date="", update_date=""))
    await db.commit()
    handlers = h.Handlers(_registry())
    admin = {p.name for p in (await handlers.list_prompts(ctx_for(member(admin_user, org)), None)).prompts}
    assert "build_learning_path" not in admin and {"draft_course", "add_quiz", "grade_submissions"} <= admin
    reader = {p.name for p in (await handlers.list_prompts(ctx_for(member(admin_user, org, ("mcp:read",))), None)).prompts}
    assert "add_quiz" not in reader and "review_course" in reader
    # A prompt that is not offered cannot be fetched either.
    with pytest.raises(MCPError):
        await handlers.get_prompt(
            ctx_for(member(admin_user, org)), types.GetPromptRequestParams(name="build_learning_path", arguments={"goal": "x"})
        )
    with pytest.raises(MCPError):
        await handlers.get_prompt(
            ctx_for(member(regular_user, org)), types.GetPromptRequestParams(name="draft_course", arguments={"topic": "x"})
        )
    ok = await handlers.get_prompt(
        ctx_for(member(admin_user, org)), types.GetPromptRequestParams(name="add_quiz", arguments={"activity": "Loops"})
    )
    assert "Loops" in ok.messages[0].content.text and "not specified questions" in ok.messages[0].content.text


def test_new_prompts_render():
    for name, args in (
        ("grade_submissions", {"assignment": "Essay 1", "rubric": "clarity"}),
        ("build_learning_path", {"goal": "become a data analyst"}),
        ("community_digest", {"community": "Makers"}),
    ):
        text = prompts.render_prompt(name, args).messages[0].content.text
        assert all(value in text for value in args.values())
    assert prompts.PROMPTS["build_learning_path"].feature == "paths"
    assert not prompts.prompt_allowed(prompts.PROMPTS["community_digest"], True, None, {"communities": False})
    assert prompts.prompt_allowed(prompts.PROMPTS["community_digest"], True, None, {"communities": True})


# ─── completion ──────────────────────────────────────────────────────────────


async def test_complete_prompt_argument_with_names(db, org, admin_user, sessions):
    org = SimpleNamespace(id=org.id)
    handlers = h.Handlers(_registry())
    ctx = ctx_for(member(admin_user, org))
    out = await handlers.complete(ctx, complete(types.PromptReference(type="ref/prompt", name="review_course"), "course", "rust"))
    assert out.completion.values == ["Intro to Rust", "Rust in Practice"]
    assert SEEN[-1] == ("search", {"query": "rust", "kinds": ["course"], "limit": resources.MAX_COMPLETIONS})
    # Nothing typed yet: the first page of courses.
    first = await handlers.complete(ctx, complete(types.PromptReference(type="ref/prompt", name="review_course"), "course", ""))
    assert first.completion.values == ["First course"] and first.completion.has_more is True


async def test_complete_resource_template_with_ids(db, org, admin_user, sessions):
    org = SimpleNamespace(id=org.id)
    handlers = h.Handlers(_registry())
    ctx = ctx_for(member(admin_user, org))
    ref = types.ResourceTemplateReference(type="ref/resource", uri="learnhouse://course/{course_uuid}")
    out = await handlers.complete(ctx, complete(ref, "course_uuid", "Rust"))
    assert out.completion.values == ["course_1", "course_2"]
    path_ref = types.ResourceTemplateReference(type="ref/resource", uri="learnhouse://path/{path_uuid}")
    assert (await handlers.complete(ctx, complete(path_ref, "path_uuid", ""))).completion.values == ["path_9"]


async def test_complete_returns_nothing_it_cannot_answer(db, org, admin_user, sessions):
    org = SimpleNamespace(id=org.id)
    handlers = h.Handlers(_registry())
    ctx = ctx_for(member(admin_user, org))
    prompt = types.PromptReference(type="ref/prompt", name="draft_course")
    cases = [
        (ctx_for(None), complete(prompt, "topic", "ru")),            # signed out
        (ctx, complete(prompt, "topic", "rust")),                     # free text argument
        (ctx, complete(types.PromptReference(type="ref/prompt", name="nope"), "x", "ab")),
        (ctx, complete(types.PromptReference(type="ref/prompt", name="improve_activity"), "activity", "")),  # no first page
        (ctx, complete(types.ResourceTemplateReference(type="ref/resource", uri="x"), "nope", "ab")),
    ]
    for c, params in cases:
        assert (await handlers.complete(c, params)).completion.values == []
    with patch.object(h.Handlers, "_read_tool", side_effect=MCPError(-32002, "no")):
        out = await handlers.complete(ctx, complete(types.PromptReference(type="ref/prompt", name="review_course"), "course", "rust"))
    assert out.completion.values == []


def test_server_advertises_completion():
    server = srv.build_mcp_server(_registry())
    assert "Learning paths" in server.instructions
    caps = server.get_capabilities()
    assert caps.completions is not None


def test_toolset_presets():
    known = ("core", "courses", "content", "advanced", "paths", "library", "people", "org", "teaching")
    authoring = srv.requested_toolsets(SimpleNamespace(query_params={"toolsets": "authoring"}), known)
    assert authoring == {"core", "courses", "content", "advanced", "paths", "library"}

