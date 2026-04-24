from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

logger = logging.getLogger(__name__)


@asynccontextmanager
async def open_mcp_session(
    mcp_url: str, token: str
) -> AsyncIterator[ClientSession]:
    """
    Open a short-lived Streamable HTTP session to the LearnHouse MCP server,
    authenticated as the caller's token. The MCP server is responsible for
    enforcing the org boundary; this client doesn't add any extra checks.
    """
    headers = {"Authorization": f"Bearer {token}"}
    async with streamablehttp_client(mcp_url, headers=headers) as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()
            yield session


def mcp_tool_to_gemini_schema(tool: Any) -> dict:
    """
    Convert one MCP tool descriptor into a Gemini `FunctionDeclaration`-shaped
    dict. MCP tools carry a JSON Schema in `inputSchema`; Gemini consumes the
    same shape under `parameters` but with a narrower grammar — we strip and
    normalize a handful of keywords Pydantic emits that Gemini's validator
    rejects.
    """
    raw = dict(tool.inputSchema or {"type": "object", "properties": {}})
    parameters = _normalize_schema_for_gemini(raw)
    return {
        "name": tool.name,
        "description": tool.description or "",
        "parameters": parameters,
    }


_GEMINI_SCHEMA_STRIP_KEYS = {
    "$schema",
    "$id",
    "$defs",
    "definitions",
    "additionalProperties",
    "title",
    "default",
    "examples",
    "readOnly",
    "writeOnly",
    "deprecated",
    "$ref",
    "discriminator",
}


def _normalize_schema_for_gemini(schema: Any) -> Any:
    """
    Gemini's schema validator is stricter than JSON Schema. Fix the common
    Pydantic-emitted shapes it rejects:

    - Strip keywords it doesn't know (`$defs`, `title`, `default`, …).
    - Collapse `Optional[T]` — represented as ``anyOf: [{...}, {type: null}]`` —
      to just the non-null variant, since Gemini doesn't accept nullable
      unions.
    - After collapsing, keep only `required` entries that still exist in
      `properties` (Pydantic sometimes lists keys whose type unwrapped to
      nothing).
    """
    if isinstance(schema, list):
        return [_normalize_schema_for_gemini(v) for v in schema]
    if not isinstance(schema, dict):
        return schema

    # Optional[T] unwrap: {"anyOf": [T, {"type": "null"}]}  →  T
    any_of = schema.get("anyOf") or schema.get("oneOf")
    if isinstance(any_of, list) and len(any_of) == 2:
        non_nulls = [
            branch for branch in any_of
            if not (isinstance(branch, dict) and branch.get("type") == "null")
        ]
        if len(non_nulls) == 1 and isinstance(non_nulls[0], dict):
            merged = dict(non_nulls[0])
            # Preserve description / title-like siblings from the parent.
            for k, v in schema.items():
                if k not in ("anyOf", "oneOf") and k not in merged:
                    merged[k] = v
            return _normalize_schema_for_gemini(merged)

    # Recursively normalize children, dropping Gemini-unfriendly keys.
    # `properties` and `$defs` values are maps of *user-defined names* to
    # subschemas; their keys must not be filtered by the keyword blocklist.
    cleaned: dict[str, Any] = {}
    for k, v in schema.items():
        if k in _GEMINI_SCHEMA_STRIP_KEYS:
            continue
        if k in ("properties", "patternProperties") and isinstance(v, dict):
            cleaned[k] = {
                name: _normalize_schema_for_gemini(sub) for name, sub in v.items()
            }
        else:
            cleaned[k] = _normalize_schema_for_gemini(v)

    # Reconcile required ↔ properties. Drop required entries whose property
    # was pruned (or never existed).
    props = cleaned.get("properties")
    required = cleaned.get("required")
    if isinstance(props, dict) and isinstance(required, list):
        filtered = [r for r in required if isinstance(r, str) and r in props]
        if filtered:
            cleaned["required"] = filtered
        else:
            cleaned.pop("required", None)

    return cleaned


def stringify_tool_result(result: Any) -> str:
    """
    Turn an MCP `CallToolResult` into a compact string Gemini can consume as a
    function_response. MCP returns a list of `content` parts — we join text
    parts and flag non-text parts so the agent can still reason about them.
    """
    if result is None:
        return "null"

    is_error = bool(getattr(result, "isError", False))
    parts = getattr(result, "content", None) or []
    text_chunks: list[str] = []
    for part in parts:
        part_type = getattr(part, "type", None)
        if part_type == "text":
            text_chunks.append(getattr(part, "text", ""))
        else:
            text_chunks.append(f"[non-text content: {part_type}]")

    structured = getattr(result, "structuredContent", None)
    if structured is not None:
        import json
        text_chunks.append(json.dumps(structured, default=str)[:4000])

    body = "\n".join(c for c in text_chunks if c) or "(empty result)"
    return f"ERROR: {body}" if is_error else body
