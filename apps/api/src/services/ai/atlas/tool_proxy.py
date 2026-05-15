"""Typed wrapper around the MCP client.

Atlas talks to the MCP server for every tool call (per locked decision
in the rewrite plan). This proxy adds three things the bare client
doesn't give us:

  1. Tier-aware catalog. Reads ``Tool.meta['atlas.tier']`` etc. and
     builds a typed ``ToolSpec`` per tool. The LLM-visible catalog
     excludes ``apply_*`` tools so the model can never bypass the
     pending-edit gate by calling apply directly.

  2. Structured error parsing. When an MCP tool returns ``isError=True``
     with a ``structuredContent`` of shape ``{ok:false, code, message,
     details, retriable}``, we hydrate it into a ``ToolError`` instead
     of regex-parsing a stringified payload.

  3. Cross-tier guard. ``call_for_llm`` runs the
     ``evaluate_guard()`` check before dispatching, so any LLM-driven
     attempt to chain DESTRUCTIVE after another tool is blocked at the
     proxy boundary, not in tool bodies.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Optional

from mcp import ClientSession
from mcp.types import CallToolResult, Tool

from src.services.ai.atlas.tiers import (
    GuardDecision,
    ToolError,
    ToolSpec,
    TurnState,
    evaluate_guard,
)

logger = logging.getLogger(__name__)


class ToolCallOutcome:
    """Result of a single MCP tool call.

    Exactly one of ``error`` or (``structured`` / ``text``) is meaningful;
    ``ok`` is the canonical success flag.
    """

    __slots__ = ("ok", "error", "structured", "text", "raw")

    def __init__(
        self,
        ok: bool,
        *,
        error: Optional[ToolError] = None,
        structured: Optional[dict[str, Any]] = None,
        text: Optional[str] = None,
        raw: Optional[CallToolResult] = None,
    ) -> None:
        self.ok = ok
        self.error = error
        self.structured = structured
        self.text = text
        self.raw = raw

    def __repr__(self) -> str:
        return f"ToolCallOutcome(ok={self.ok}, error={self.error}, has_structured={self.structured is not None})"


class ToolProxy:
    """Per-turn handle on an open MCP session + its parsed tool catalog."""

    def __init__(self, session: ClientSession) -> None:
        self._session = session
        self._specs: dict[str, ToolSpec] = {}
        self._tools: dict[str, Tool] = {}

    async def load_catalog(self) -> None:
        """Fetch tools from the MCP server and build typed specs."""
        result = await self._session.list_tools()
        for tool in getattr(result, "tools", []) or []:
            meta = _extract_meta(tool)
            spec = ToolSpec.from_mcp_meta(
                name=tool.name,
                description=tool.description or "",
                meta=meta,
            )
            self._specs[tool.name] = spec
            self._tools[tool.name] = tool

    # -- Catalog access ---------------------------------------------------

    def all_specs(self) -> list[ToolSpec]:
        return list(self._specs.values())

    def llm_visible_tools(self) -> list[Tool]:
        """The slice of the catalog the LLM sees.

        Filters out anything tagged ``atlas.is_apply=True`` so the model
        can never call apply_* directly; those only run via the
        ``/pending/{id}/apply`` HTTP path.
        """
        out: list[Tool] = []
        for name, tool in self._tools.items():
            spec = self._specs.get(name)
            if spec and spec.is_apply:
                continue
            out.append(tool)
        return out

    def spec(self, name: str) -> Optional[ToolSpec]:
        return self._specs.get(name)

    # -- Dispatch ---------------------------------------------------------

    async def call_for_llm(
        self, name: str, args: dict[str, Any], state: TurnState
    ) -> ToolCallOutcome:
        """Dispatch an LLM-initiated tool call through the cross-tier guard.

        Returns a synthetic error outcome (without ever hitting the MCP
        server) when the guard rejects, so the model can see the
        guidance in its next step and adjust.
        """
        spec = self._specs.get(name)
        if spec is None:
            return _synthetic_error(
                "unknown_tool",
                f"Tool '{name}' is not in this turn's Atlas catalog.",
            )
        decision: GuardDecision = evaluate_guard(spec, state)
        if not decision.allowed:
            return _synthetic_error("guard_blocked", decision.reason or "Blocked by tier guard.")
        state.has_emitted_tools = True
        state.emitted_tool_names.append(name)
        return await self._raw_call(name, args)

    async def call_apply(self, name: str, args: dict[str, Any]) -> ToolCallOutcome:
        """Dispatch an ``apply_*`` tool from the HTTP /apply endpoint.

        Skips the LLM-visible filter and the cross-tier guard — apply is
        already gated by the pending-edit FSM (CAS in
        ``PendingStore.mark_applying``) and by the destructive challenge
        verification in the router.
        """
        return await self._raw_call(name, args)

    # -- Internals --------------------------------------------------------

    async def _raw_call(self, name: str, args: dict[str, Any]) -> ToolCallOutcome:
        try:
            result = await self._session.call_tool(name, args or {})
        except Exception as e:
            logger.warning("MCP tool call '%s' raised: %s", name, e)
            return _synthetic_error("upstream_unavailable", str(e), retriable=True)

        return _parse_outcome(result)


# --- Parsing helpers --------------------------------------------------------


def _extract_meta(tool: Tool) -> dict[str, Any]:
    """Pull the ``_meta`` dict off a Tool, handling Python-attr and
    raw-dict cases.

    Fail-safe: any decode failure returns an empty dict, which makes
    ``ToolSpec.from_mcp_meta`` fall back to its conservative defaults.
    """
    raw = getattr(tool, "meta", None)
    if raw is None:
        return {}
    if isinstance(raw, dict):
        return raw
    try:
        return dict(raw)
    except Exception:
        return {}


def _parse_outcome(result: CallToolResult) -> ToolCallOutcome:
    """Hydrate an MCP CallToolResult into the typed outcome shape."""
    is_error = bool(getattr(result, "isError", False))
    structured = getattr(result, "structuredContent", None)
    text = _join_text_parts(getattr(result, "content", None) or [])

    if is_error:
        error = _coerce_error(structured, text)
        return ToolCallOutcome(ok=False, error=error, structured=structured, text=text, raw=result)

    return ToolCallOutcome(ok=True, structured=structured, text=text, raw=result)


def _coerce_error(structured: Any, text: Optional[str]) -> ToolError:
    """Build a ``ToolError`` from whatever the tool sent back.

    Order of preference:
      1. ``structuredContent`` with ``{ok:false, code, message, ...}`` —
         hydrate fields directly.
      2. ``structuredContent`` plain dict — best-effort.
      3. Text content parsed as JSON.
      4. Plain text — fallback as ``code='internal_error'``.
    """
    if isinstance(structured, dict):
        if structured.get("code") or structured.get("message"):
            return ToolError(
                code=str(structured.get("code", "internal_error")),
                message=str(structured.get("message", "Tool error.")),
                retriable=bool(structured.get("retriable", False)),
                details={k: v for k, v in structured.items()
                         if k not in ("code", "message", "retriable", "ok")},
            )
    if text:
        try:
            parsed = json.loads(text)
            if isinstance(parsed, dict):
                return ToolError(
                    code=str(parsed.get("code", "internal_error")),
                    message=str(parsed.get("message", text)),
                    retriable=bool(parsed.get("retriable", False)),
                    details=parsed,
                )
        except Exception:
            pass
    return ToolError(code="internal_error", message=text or "Tool error.", retriable=False)


def _join_text_parts(parts: list[Any]) -> Optional[str]:
    """Concatenate text-typed content parts into one string."""
    chunks: list[str] = []
    for part in parts:
        part_type = getattr(part, "type", None)
        if part_type == "text":
            chunks.append(getattr(part, "text", "") or "")
    return "\n".join(c for c in chunks if c) or None


def _synthetic_error(code: str, message: str, *, retriable: bool = False) -> ToolCallOutcome:
    """Build an outcome that looks like a tool failure without making a
    network call. Used by the guard and the unknown-tool path."""
    return ToolCallOutcome(
        ok=False,
        error=ToolError(code=code, message=message, retriable=retriable),
    )
