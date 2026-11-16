"""Core hooks for the Agent API (EE): the ``agent`` token rights bucket, its
place in the API token docs, and the routes an embed session may reach."""

import pytest

from src.security.embed_session import is_embed_route
from src.services.api_tokens.api_tokens import _TOKEN_BUCKET_CAPS, cap_token_rights
from src.services.api_tokens.openapi_spec import build_api_token_openapi_spec


def test_agent_bucket_is_capped_by_org_rights():
    assert _TOKEN_BUCKET_CAPS["agent"] == "organizations"

    class Role:
        id = 99
        rights = {"organizations": {"action_read": True, "action_update": False}}

    capped = cap_token_rights({"agent": {"action_read": True, "action_update": True}}, Role())
    assert capped["agent"] == {"action_read": True, "action_update": False}


def test_agent_routes_are_in_the_token_docs():
    spec = build_api_token_openapi_spec({"paths": {
        "/api/v1/agent/conversations": {"post": {"tags": ["agent"]}},
        "/api/v1/ai/atlas/chat": {"post": {"tags": ["ai"]}},
    }, "tags": []})
    assert set(spec["paths"]) == {"/api/v1/agent/conversations"}
    assert any(t["name"] == "agent" and "Scope `agent`" in t["description"] for t in spec["tags"])


@pytest.mark.parametrize(
    "method, path",
    [
        ("GET", "/api/v1/agent/agents"),
        ("GET", "/api/v1/agent/agents/copilot"),
        ("GET", "/api/v1/agent/views/schema"),
        ("GET", "/api/v1/agent/conversations"),
        ("GET", "/api/v1/agent/conversations/agconv_x1"),
        ("GET", "/api/v1/agent/conversations/agconv_x1/messages"),
        ("GET", "/api/v1/agent/conversations/agconv_x1/stream"),
        ("POST", "/api/v1/agent/conversations"),
        ("POST", "/api/v1/agent/conversations/agconv_x1/messages"),
        ("POST", "/api/v1/agent/conversations/agconv_x1/cancel"),
        ("DELETE", "/api/v1/agent/conversations/agconv_x1"),
    ],
)
def test_embed_sessions_reach_the_learner_agent_routes(method, path):
    assert is_embed_route(method, path) is True


@pytest.mark.parametrize(
    "method, path",
    [
        ("GET", "/api/v1/agent/agents/atlas/tools"),
        ("POST", "/api/v1/agent/approvals/pnd_1/approve"),
        ("POST", "/api/v1/agent/approvals/pnd_1/deny"),
        ("POST", "/api/v1/agent/conversations/agconv_x1/tool-results"),
        ("POST", "/api/v1/agent/templates/render"),
        ("DELETE", "/api/v1/agent/conversations"),
    ],
)
def test_embed_sessions_never_reach_atlas_or_approvals(method, path):
    assert is_embed_route(method, path) is False
