"""Embedded MCP server exposing the agent tool registry.

Built on the MCP SDK's low-level Server (registry-driven schemas, no
signature introspection) and served over stateless streamable HTTP —
every request is self-contained, so there is no session state to tear
down and no cross-request task-group coupling.

Auth happens in `src/security/mcp_auth.py` (the `/mcp` mount is wrapped
by MCPAuthMiddleware); handlers read the resolved APITokenUser from its
contextvar. Every call funnels through the registry's `run_tool`
pipeline in execute mode: token bucket rights + org scope bound
everything, and DESTRUCTIVE tools additionally require `confirm: true`.
"""

from __future__ import annotations

import json
import logging
from typing import Any

import mcp.types as types
from mcp.server.lowlevel import Server
from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
from sqlmodel import select

from src.core.events.database import _async_session_factory
from src.db.organizations import Organization
from src.security.mcp_auth import current_mcp_principal
from src.services.ai.tools import get_registry
from src.services.ai.tools.base import (
    ActionTier,
    ToolContext,
    make_synthetic_request,
)
from src.services.ai.tools.registry import ToolRegistry, run_tool

logger = logging.getLogger(__name__)

SERVER_NAME = "learnhouse"

_CONFIRM_PROPERTY = {
    "type": "boolean",
    "description": (
        "Destructive action opt-in. First call without it to see the "
        "denial explaining what will be deleted, then retry with "
        "confirm=true."
    ),
}


def _input_schema(spec) -> dict[str, Any]:
    schema = spec.params_model.model_json_schema()
    if spec.tier is ActionTier.DESTRUCTIVE:
        schema.setdefault("properties", {}).setdefault(
            "confirm", dict(_CONFIRM_PROPERTY)
        )
    return schema


def _tool_listing(registry: ToolRegistry) -> list[types.Tool]:
    out = []
    for spec in registry.specs():
        description = spec.description
        if spec.tier is ActionTier.DESTRUCTIVE:
            description = f"[DESTRUCTIVE] {description}"
        out.append(
            types.Tool(
                name=spec.name,
                description=description,
                inputSchema=_input_schema(spec),
            )
        )
    return out


async def _dispatch_tool(
    registry: ToolRegistry, name: str, arguments: dict[str, Any] | None
) -> dict[str, Any]:
    principal = current_mcp_principal.get()
    if principal is None:
        # The auth middleware always sets this; reaching here means the
        # server was mounted without it. Fail closed.
        return {"status": "denied", "code": "unauthenticated", "reason": "No principal"}

    async with _async_session_factory() as db_session:
        org = (
            await db_session.execute(
                select(Organization).where(Organization.id == principal.org_id)
            )
        ).scalars().first()
        if org is None:
            return {
                "status": "denied",
                "code": "org_not_found",
                "reason": "The token's organization no longer exists",
            }

        ctx = ToolContext(
            request=make_synthetic_request(),
            db_session=db_session,
            user=principal,
            org=org,
            org_slug=org.slug,
            mode="execute",
            scope_key=f"token:{principal.user_uuid}",
        )

        try:
            outcome = await run_tool(registry, name, arguments or {}, ctx)
            if outcome.status == "executed":
                await db_session.commit()
            else:
                await db_session.rollback()
        except Exception:
            await db_session.rollback()
            logger.exception("mcp: tool %s crashed", name)
            return {
                "status": "denied",
                "code": "internal_error",
                "reason": "Tool execution failed",
            }

    if outcome.status == "executed":
        return {"status": "executed", "result": outcome.result}
    return {
        "status": outcome.status,
        "code": outcome.denied_code,
        "reason": outcome.reason,
    }


def build_mcp_server(registry: ToolRegistry | None = None) -> Server:
    registry = registry or get_registry()
    server: Server = Server(SERVER_NAME)

    @server.list_tools()
    async def _list_tools() -> list[types.Tool]:
        return _tool_listing(registry)

    @server.call_tool(validate_input=False)
    async def _call_tool(name: str, arguments: dict[str, Any] | None):
        payload = await _dispatch_tool(registry, name, arguments)
        return [types.TextContent(type="text", text=json.dumps(payload, default=str))]

    return server


def build_mcp_session_manager(
    registry: ToolRegistry | None = None,
) -> StreamableHTTPSessionManager:
    """Stateless streamable-HTTP manager. Its `.run()` context must be
    entered from app startup (Starlette mounts don't run sub-app
    lifespans) — see src/core/events/events.py."""
    return StreamableHTTPSessionManager(
        app=build_mcp_server(registry),
        event_store=None,
        json_response=True,
        stateless=True,
    )


class MCPASGIApp:
    """Minimal ASGI adapter delegating to the session manager."""

    def __init__(self, manager: StreamableHTTPSessionManager):
        self.manager = manager

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http":
            return
        await self.manager.handle_request(scope, receive, send)
