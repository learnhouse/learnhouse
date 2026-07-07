"""Tests for the embedded MCP server assembly (registry-driven tools)."""

from unittest.mock import patch

import pytest
from pydantic import BaseModel

from src.db.users import APITokenUser
from src.security.mcp_auth import current_mcp_principal
from src.security.rbac import AccessAction
from src.services.ai.mcp import server as mcp_server
from src.services.ai.mcp.server import (
    _dispatch_tool,
    _tool_listing,
    build_mcp_server,
)
from src.services.ai.tools import ActionTier, ToolRegistry, ToolSpec


class _Params(BaseModel):
    value: str = "x"
    confirm: bool | None = None


async def _echo(ctx, params):
    return {"ok": True, "org": ctx.org.id}


def _registry():
    r = ToolRegistry()
    r.register_all(
        [
            ToolSpec(
                name="t_read",
                description="read tool",
                params_model=_Params,
                tier=ActionTier.READ,
                rights_bucket="courses",
                access_action=AccessAction.READ,
                execute=_echo,
            ),
            ToolSpec(
                name="t_destroy",
                description="delete tool",
                params_model=_Params,
                tier=ActionTier.DESTRUCTIVE,
                rights_bucket="courses",
                access_action=AccessAction.DELETE,
                execute=_echo,
            ),
        ]
    )
    return r


def test_listing_marks_destructive_and_injects_confirm():
    tools = _tool_listing(_registry())
    by_name = {t.name: t for t in tools}
    assert set(by_name) == {"t_read", "t_destroy"}
    assert by_name["t_destroy"].description.startswith("[DESTRUCTIVE]")
    assert "confirm" in by_name["t_destroy"].inputSchema["properties"]
    assert not by_name["t_read"].description.startswith("[DESTRUCTIVE]")


def test_build_mcp_server_constructs():
    server = build_mcp_server(_registry())
    assert server.name == "learnhouse"


async def test_dispatch_without_principal_fails_closed():
    payload = await _dispatch_tool(_registry(), "t_read", {})
    assert payload["status"] == "denied"
    assert payload["code"] == "unauthenticated"


@pytest.fixture
def principal(org):
    return APITokenUser(
        id=0,
        user_uuid="apitoken_mcp",
        username="api_token_mcp",
        org_id=org.id,
        rights={
            "courses": {
                "action_create": True,
                "action_read": True,
                "action_update": True,
                "action_delete": True,
            }
        },
        created_by_user_id=1,
    )


class _SessionFactory:
    """Async context manager yielding the test db session."""

    def __init__(self, db):
        self.db = db

    def __call__(self):
        return self

    async def __aenter__(self):
        return self.db

    async def __aexit__(self, *exc):
        return None


async def test_dispatch_executes_with_principal(db, org, principal):
    token_ctx = current_mcp_principal.set(principal)
    try:
        with patch.object(mcp_server, "_async_session_factory", _SessionFactory(db)), \
             patch.object(db, "commit"), patch.object(db, "rollback"):
            payload = await _dispatch_tool(_registry(), "t_read", {"value": "hi"})
    finally:
        current_mcp_principal.reset(token_ctx)
    assert payload["status"] == "executed"
    assert payload["result"] == {"ok": True, "org": org.id}


async def test_dispatch_destructive_without_confirm_denied(db, org, principal):
    token_ctx = current_mcp_principal.set(principal)
    try:
        with patch.object(mcp_server, "_async_session_factory", _SessionFactory(db)), \
             patch.object(db, "commit"), patch.object(db, "rollback"):
            payload = await _dispatch_tool(_registry(), "t_destroy", {})
    finally:
        current_mcp_principal.reset(token_ctx)
    assert payload["status"] == "denied"
    assert payload["code"] == "confirmation_required"


async def test_dispatch_org_gone_denied(db, principal):
    principal.org_id = 424242
    token_ctx = current_mcp_principal.set(principal)
    try:
        with patch.object(mcp_server, "_async_session_factory", _SessionFactory(db)):
            payload = await _dispatch_tool(_registry(), "t_read", {})
    finally:
        current_mcp_principal.reset(token_ctx)
    assert payload["status"] == "denied"
    assert payload["code"] == "org_not_found"
