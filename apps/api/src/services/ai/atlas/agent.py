"""Pydantic-AI Agent factory.

Builds a fresh `Agent` per turn so the MCP toolset gets the caller's
session token attached as request headers without leaking across users.
The toolset reaches into the standalone `apps/mcp` server via Streamable
HTTP transport.

`@agent.system_prompt` injects the per-turn focus block from
`render_focus_block` using `ctx.deps`.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

import contextlib
import functools

from mcp.client.streamable_http import streamablehttp_client
from pydantic_ai import Agent, RunContext
from pydantic_ai.mcp import MCPServerStreamableHTTP
from pydantic_ai.models.google import GoogleModel, GoogleModelSettings
from pydantic_ai.providers.google import GoogleProvider

from .prompts import BASE_SYSTEM_PROMPT, render_focus_block

if TYPE_CHECKING:
    from .deps import AtlasDeps


class _NoTerminateMCPServer(MCPServerStreamableHTTP):
    """MCP toolset variant that does NOT send a DELETE on close.

    pydantic-ai's default `MCPServerStreamableHTTP.client_streams` calls
    `streamablehttp_client(...)` which defaults `terminate_on_close=True`
    — the DELETE then runs during context exit. When the SSE response
    generator finishes, asyncio cancels the surrounding scope, and the
    DELETE request hits a cancelled anyio cancel scope:

      RuntimeError: Attempted to exit a cancel scope that isn't the
      current tasks's current cancel scope

    Setting `terminate_on_close=False` makes session cleanup a no-op
    (the server lets the session expire on its own TTL). This avoids
    the cleanup-on-cancel race entirely.
    """

    @contextlib.asynccontextmanager
    async def client_streams(self):  # type: ignore[override]
        if self.http_client and self.headers:
            raise ValueError("`http_client` is mutually exclusive with `headers`.")
        if self.http_client is not None:

            def httpx_client_factory(headers=None, timeout=None, auth=None):
                assert self.http_client is not None
                return self.http_client

            async with streamablehttp_client(
                url=self.url,
                timeout=self.timeout,
                sse_read_timeout=self.read_timeout,
                httpx_client_factory=httpx_client_factory,
                terminate_on_close=False,
            ) as (read_stream, write_stream, *_):
                yield read_stream, write_stream
        else:
            async with streamablehttp_client(
                url=self.url,
                headers=self.headers,
                timeout=self.timeout,
                sse_read_timeout=self.read_timeout,
                terminate_on_close=False,
            ) as (read_stream, write_stream, *_):
                yield read_stream, write_stream


def build_agent(
    *,
    model: str,
    mcp_url: str,
    deps: "AtlasDeps",
    api_key: str | None = None,
) -> Agent:
    """Build an agent scoped to a single turn.

    `model` is either a provider-prefixed string (e.g.
    "google-gla:gemini-2.5-flash") or a bare model name; we strip the
    `google-gla:` prefix and construct a `GoogleModel` with an explicit
    API key so we don't depend on `GOOGLE_API_KEY` being in the
    environment (LH stores it as `LEARNHOUSE_GEMINI_API_KEY` in its own
    config). `mcp_url` is the Streamable HTTP endpoint (typically
    `http://127.0.0.1:8765/mcp`).
    """
    headers: dict[str, str] = {
        "Authorization": f"Bearer {deps.session_token}",
        "X-LH-Org-Id": str(deps.org_id),
        "X-LH-Org-Slug": deps.org_slug,
    }
    mcp = _NoTerminateMCPServer(url=mcp_url, headers=headers)

    bare_model = model.split(":", 1)[1] if model.startswith("google-gla:") else model
    if api_key:
        google_model = GoogleModel(bare_model, provider=GoogleProvider(api_key=api_key))
    else:
        google_model = GoogleModel(bare_model)

    # Disable Gemini 2.5's "thinking" mode and reserve generous output
    # tokens. With thinking enabled the model can burn its entire output
    # budget on internal reasoning and return `parts: null` — pydantic-ai
    # then raises `Content field missing from Gemini response`.
    model_settings = GoogleModelSettings(
        google_thinking_config={"thinking_budget": 0},
        max_tokens=4096,
        temperature=0.4,
    )

    agent: Agent = Agent(
        google_model,
        deps_type=type(deps),
        toolsets=[mcp],
        system_prompt=BASE_SYSTEM_PROMPT,
        model_settings=model_settings,
    )

    @agent.system_prompt
    def focus_prompt(ctx: RunContext) -> str:
        d = ctx.deps  # type: ignore[assignment]
        return render_focus_block(
            page_context=d.page_context,
            course_snapshot=d.course_snapshot,
            references=d.references,
        )

    return agent
