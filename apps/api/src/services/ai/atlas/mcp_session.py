"""Thin Atlas-side MCP session opener.

The pipeline and the apply flow both need a short-lived MCP session to
talk to the LearnHouse MCP server (catalog reads, ``apply_*``
invocations). pydantic-ai's ``MCPServerStreamableHTTP`` handles the
*LLM-driven* tool calls inside the agent loop; this helper handles the
*server-driven* calls that happen outside the agent (apply, catalog
preload).

We could reuse the legacy ``atlas/mcp_client.py``'s
``open_mcp_session`` directly, but pinning to a small Atlas-owned
helper means we can swap the implementation later without touching
every call site.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

from config.config import get_learnhouse_config


@asynccontextmanager
async def open_atlas_mcp(session_token: str) -> AsyncIterator[ClientSession]:
    """Open an authenticated Streamable HTTP MCP session.

    ``session_token`` is the ``lh_*`` Atlas token issued by
    ``POST /ai/atlas/session``; the MCP middleware validates it and
    resolves it to a (user_uuid, org_id, rights) context-var that the
    Atlas tool bodies consume.
    """
    cfg = get_learnhouse_config()
    url = getattr(cfg.ai_config, "mcp_internal_url", None) or "http://127.0.0.1:8765/mcp"
    headers = {"Authorization": f"Bearer {session_token}"}
    async with streamablehttp_client(url, headers=headers) as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()
            yield session
