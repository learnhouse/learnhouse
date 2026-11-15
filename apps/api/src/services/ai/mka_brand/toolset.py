"""Brand Center MCP toolset: read-only allow-list, per-run call budget, fail-open guard."""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any, Optional

from pydantic_ai.toolsets.wrapper import WrapperToolset

from src.services.ai.mka_brand import breaker, config

logger = logging.getLogger(__name__)

UNAVAILABLE_MESSAGE = "Brand Center is unavailable right now. Continue without it."


@dataclass
class _RunState:
    disabled: bool = False
    entered: bool = False
    calls: int = 0
    latency_ms: float = 0.0
    tool_names: list[str] = field(default_factory=list)


@dataclass
class GuardedBrandToolset(WrapperToolset):
    """Wraps an MCP toolset so connect/list/call failures degrade to "no tools"."""

    state: _RunState = field(default_factory=_RunState)

    async def __aenter__(self):
        try:
            await self.wrapped.__aenter__()
            self.state.entered = True
        except Exception as exc:  # noqa: BLE001 (fail-open on any MCP failure)
            self.state.disabled = True
            breaker.trip(type(exc).__name__)
        return self

    async def __aexit__(self, *args: Any) -> bool | None:
        try:
            if self.state.entered:
                self.state.entered = False
                await self.wrapped.__aexit__(*args)
        except Exception as exc:  # noqa: BLE001
            logger.debug("mka_brand toolset exit error: %s", type(exc).__name__)
        finally:
            self._log_summary()
        return None

    def _log_summary(self) -> None:
        s = self.state
        if s.calls or s.disabled:
            logger.info(
                "mka_brand tools=%s calls=%d mcp_latency_ms=%.0f disabled=%s",
                ",".join(s.tool_names) or "-",
                s.calls,
                s.latency_ms,
                s.disabled,
            )

    async def get_tools(self, ctx):
        s = self.state
        if s.disabled or s.calls >= config.MAX_TOOL_CALLS_PER_RUN:
            return {}
        try:
            tools = await self.wrapped.get_tools(ctx)
        except Exception as exc:  # noqa: BLE001
            s.disabled = True
            breaker.trip(type(exc).__name__)
            return {}
        return {n: t for n, t in tools.items() if n in config.ALLOWED_TOOLS}

    async def call_tool(self, name, tool_args, ctx, tool):
        s = self.state
        start = time.monotonic()
        try:
            return await self.wrapped.call_tool(name, tool_args, ctx, tool)
        except Exception as exc:  # noqa: BLE001
            s.disabled = True
            breaker.trip(type(exc).__name__)
            return UNAVAILABLE_MESSAGE
        finally:
            s.calls += 1
            s.latency_ms += (time.monotonic() - start) * 1000
            s.tool_names.append(name)


def _new_mcp_toolset() -> Any:
    from pydantic_ai.mcp import MCPToolset

    return MCPToolset(
        config.url(),
        headers=config.headers(),
        init_timeout=config.INIT_TIMEOUT_S,
        read_timeout=config.CALL_TIMEOUT_S,
        max_retries=1,
    )


def get_toolset(factory=None) -> Optional[GuardedBrandToolset]:
    """A fresh per-run guarded toolset, or None when disabled / breaker open.

    ``factory`` (tests) returns the underlying MCP toolset.
    """
    if not config.enabled() or breaker.is_open():
        return None
    return GuardedBrandToolset(wrapped=(factory or _new_mcp_toolset)())


def toolsets_for(model: Any) -> Optional[list]:
    """Toolsets for ``Agent(toolsets=...)``; None when disabled or the model has no tool support."""
    profile = getattr(model, "profile", None)
    if profile is not None and getattr(profile, "supports_tools", True) is False:
        return None
    t = get_toolset()
    return [t] if t is not None else None


async def call_tool_text(name: str, arguments: dict[str, Any]) -> str:
    """Direct (non-model) tool call returning concatenated text. Raises on failure."""
    from fastmcp import Client
    from fastmcp.client.transports import StreamableHttpTransport

    transport = StreamableHttpTransport(config.url(), headers=config.headers())
    async with Client(
        transport, timeout=config.CALL_TIMEOUT_S, init_timeout=config.INIT_TIMEOUT_S
    ) as client:
        result = await client.call_tool(name, arguments, timeout=config.CALL_TIMEOUT_S)
    parts = [getattr(c, "text", "") or "" for c in (result.content or [])]
    return "\n\n".join(p for p in parts if p)
