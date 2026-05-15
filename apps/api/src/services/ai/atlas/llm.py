"""pydantic-ai Agent factory + provider wiring.

The Atlas pipeline runs through a single ``pydantic_ai.Agent`` per turn.
The agent's toolset is the LearnHouse MCP server, filtered so apply_*
tools are never visible to the LLM. A ``process_tool_call`` hook
enforces the cross-tier guard before each MCP call.

Why pydantic-ai over the bare ``google-genai`` SDK:
  - Typed dep injection (``RunContext[AtlasDeps]``) — tools see the DB
    session, user, and per-turn state without globals.
  - Native async streaming, no thread bridge.
  - Builtin MCP toolset that handles tool discovery + JSON-schema
    conversion + tool-call/response round-tripping.
  - One ``Agent`` instance per pipeline keeps unit tests trivial.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Optional

from pydantic_ai import Agent
from pydantic_ai.mcp import MCPServerStreamableHTTP
from pydantic_ai.models.google import GoogleModel
from pydantic_ai.providers.google import GoogleProvider

from config.config import get_learnhouse_config
from src.services.ai.atlas.deps import AtlasDeps
from src.services.ai.atlas.tiers import (
    GuardDecision,
    ToolSpec,
    TurnState,
    evaluate_guard,
)

logger = logging.getLogger(__name__)


PLANNING_MODEL_NAME = "gemini-2.5-flash"


@dataclass
class AtlasAgentBundle:
    """Per-turn bundle holding the agent + its MCP toolset + turn state.

    The pipeline constructs this once at the top of ``run_turn`` and
    discards it at the end. The MCP toolset's connection is opened by
    pydantic-ai when the run starts and closed on exit.
    """

    agent: Agent
    mcp: MCPServerStreamableHTTP
    turn_state: TurnState
    tool_specs: dict[str, ToolSpec]


def build_agent(
    *,
    system_prompt: str,
    session_token: str,
    tool_specs: dict[str, ToolSpec],
    turn_state: TurnState,
    on_guard_block: Optional[Callable[[str, str], Awaitable[None]]] = None,
) -> AtlasAgentBundle:
    """Create a fresh Agent + MCP toolset for one turn.

    ``tool_specs`` is the pre-built tier catalog from ``ToolProxy``.
    ``on_guard_block`` is invoked when the cross-tier guard blocks an LLM
    tool call so the pipeline can surface a synthetic error event.
    """

    cfg = get_learnhouse_config()
    api_key = getattr(cfg.ai_config, "gemini_api_key", None)
    if not api_key:
        raise RuntimeError("Gemini API key not configured for Atlas planning model.")

    mcp_url = getattr(cfg.ai_config, "mcp_internal_url", None) or "http://127.0.0.1:8765/mcp"

    async def _guard(ctx, call_tool, name: str, tool_args: dict[str, Any] | Any):
        """Intercept every MCP tool call before it leaves the agent.

        Enforces both guard invariants (apply_* unreachable, no chain to
        DESTRUCTIVE after another tool). On block: notify the pipeline
        so it can stream a synthetic error event back, and return a
        machine-readable payload to the model so it can recover.
        """
        spec = tool_specs.get(name)
        if spec is None:
            # Unknown tool — let pydantic-ai surface the schema mismatch.
            return await call_tool(name, tool_args, None)
        decision: GuardDecision = evaluate_guard(spec, turn_state)
        if not decision.allowed:
            reason = decision.reason or "Blocked by Atlas tier guard."
            if on_guard_block is not None:
                try:
                    await on_guard_block(name, reason)
                except Exception:
                    logger.exception("on_guard_block raised")
            return {"ok": False, "code": "guard_blocked", "message": reason}
        turn_state.has_emitted_tools = True
        turn_state.emitted_tool_names.append(name)
        return await call_tool(name, tool_args, None)

    mcp_toolset = MCPServerStreamableHTTP(
        url=mcp_url,
        headers={"Authorization": f"Bearer {session_token}"},
        process_tool_call=_guard,
    )

    # Exclude apply_* from the LLM-visible catalog. The filter operates on
    # the live MCP tool list at run time, so it tracks any new apply_*
    # tool added to the MCP server without changes here.
    llm_toolset = mcp_toolset.filtered(
        lambda ctx, tool: not (
            tool.name.startswith("apply_")
            or (tool_specs.get(tool.name) and tool_specs[tool.name].is_apply)
        )
    )

    provider = GoogleProvider(api_key=api_key)
    model = GoogleModel(PLANNING_MODEL_NAME, provider=provider)

    agent: Agent = Agent(
        model=model,
        system_prompt=system_prompt,
        deps_type=AtlasDeps,
        toolsets=[llm_toolset],
    )
    return AtlasAgentBundle(
        agent=agent, mcp=mcp_toolset, turn_state=turn_state, tool_specs=tool_specs
    )
