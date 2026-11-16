"""Finding tools when there are hundreds, and the shapes results come in.

* Toolset defaults: without ``?toolsets=`` a connection lists the course
  building set (DEFAULT_TOOLSETS) plus the two tools below; ``?toolsets=all``
  lists everything, and named sets or presets work as before.
* ``search_tools`` finds any tool this connection may use, listed or not, by
  words in its name, title or description, and returns its input schema.
* ``invoke_tool`` calls a tool by name for clients that only let the model
  call listed tools. It is dispatched exactly like a direct call (same
  checks, same approvals, bound to the real tool name and arguments).
* Output schemas: every tool declares the shape of its structuredContent,
  loose enough that any result of the tool fits it.
* Cursors for the protocol lists (tools, resources, prompts).
"""

from __future__ import annotations

import base64
import json
import re
from typing import Any

import mcp_types as types

from src.services.ai.tools.base import ActionTier, ToolSpec

# What a connection lists when it names no toolsets: building and editing
# courses. Everything else is one search_tools away.
DEFAULT_TOOLSETS = ("core", "courses", "content", "build")
TOOLS_PAGE = 100
RESOURCES_PAGE = 100
PROMPTS_PAGE = 50

SEARCH_TOOLS = "search_tools"
INVOKE_TOOL = "invoke_tool"
META_TOOLS = (SEARCH_TOOLS, INVOKE_TOOL)


# ─── cursors ─────────────────────────────────────────────────────────────────


def encode_cursor(offset: int) -> str:
    return base64.urlsafe_b64encode(json.dumps({"o": offset}).encode()).decode().rstrip("=")


def decode_cursor(cursor: str | None) -> int:
    """Offset from a cursor; raises ValueError for one we did not make."""
    if not cursor:
        return 0
    data = json.loads(base64.urlsafe_b64decode(cursor.encode() + b"==").decode())
    offset = int(data["o"])
    if offset < 0:
        raise ValueError("negative offset")
    return offset


def paginate(items: list, cursor: str | None, size: int) -> tuple[list, str | None]:
    start = decode_cursor(cursor)
    chunk = items[start : start + size]
    nxt = encode_cursor(start + size) if start + size < len(items) else None
    return chunk, nxt


# ─── output schemas ──────────────────────────────────────────────────────────

_NULLABLE_STRING = {"type": ["string", "null"]}
_REF = {
    "type": "object",
    "description": "A pointer to something in LearnHouse: kind, uuid, name and url.",
    "properties": {"kind": {"type": "string"}, "uuid": {"type": "string"}, "name": _NULLABLE_STRING, "url": _NULLABLE_STRING},
}
_ERROR = {"type": "object", "description": "Present only on errors (isError is then true)."}

LIST_SCHEMA = {
    "type": "object",
    "properties": {
        "items": {"type": "array", "items": {"type": "object"}, "description": "This page of results."},
        "total": {"type": "integer"},
        "has_more": {"type": "boolean"},
        "next_cursor": {**_NULLABLE_STRING, "description": "Pass as cursor for the next page; null on the last page."},
    },
}
WRITE_SCHEMA = {
    "type": "object",
    "properties": {
        "ok": {"type": "boolean", "description": "true when everything asked was done."},
        "summary": {"type": "string", "description": "One line on what changed."},
        "undo": {"type": "object", "description": "A call that puts things back, when there is one."},
        "resolved": {"type": "object", "description": "Names you gave, and what they were taken to mean."},
    },
}
READ_SCHEMA = {"type": "object", "properties": {"resolved": {"type": "object"}}}

OUTPUT_SCHEMAS: dict[str, dict] = {
    "build_course": {
        "type": "object",
        "properties": {
            "ok": {"type": "boolean"},
            "dry_run": {"type": "boolean"},
            "summary": {"type": "string"},
            "course": _REF,
            "editor_url": {"type": "string"},
            "counts": {"type": "object", "additionalProperties": {"type": "integer"}},
            "steps": {"type": "array", "items": {"type": "object"}, "description": "dry_run: the plan, one step per item."},
            "chapters": {"type": "array", "items": {"type": "object"}},
            "ids": {"type": "object", "description": "course_uuid plus chapter and activity uuids by key."},
            "failed": {"type": "array", "items": {"type": "object"}},
            "resume": {"type": "object"},
            "needs_approval": {"type": ["array", "null"], "items": {"type": "string"}},
            "replayed": {"type": "boolean"},
        },
    },
    "score_course": {
        "type": "object",
        "properties": {
            "course": _REF,
            "score": {"type": "integer", "minimum": 0, "maximum": 100},
            "grade": {"type": "string"},
            "scores": {"type": "object", "additionalProperties": {"type": "integer"}},
            "figures": {"type": "object"},
            "objectives": {"type": ["array", "null"]},
            "fixes": {"type": "array", "items": {"type": "object"}},
            "summary": {"type": "string"},
        },
    },
    "validate_content": {
        "type": "object",
        "properties": {
            "valid": {"type": "boolean"},
            "problems": {"type": "array", "items": {"type": "string"}},
            "blocks": {"type": "object", "additionalProperties": {"type": "integer"}},
            "needs_approval": {"type": "array", "items": {"type": "string"}},
            "markdown": {"type": "string"},
            "doc": {"type": "object"},
        },
    },
    SEARCH_TOOLS: {
        "type": "object",
        "properties": {
            "items": {"type": "array", "items": {"type": "object"}},
            "toolsets": {"type": "array", "items": {"type": "object"}},
            "total": {"type": "integer"},
            "has_more": {"type": "boolean"},
            "next_cursor": _NULLABLE_STRING,
        },
    },
}


def is_list_tool(spec: ToolSpec) -> bool:
    return spec.tier is ActionTier.READ and "cursor" in spec.params_model.model_fields


def output_schema(spec: ToolSpec) -> dict:
    """The structuredContent shape. Never `required` and always open, so a
    client validating results never rejects a real one."""
    if spec.name in OUTPUT_SCHEMAS:
        schema = OUTPUT_SCHEMAS[spec.name]
    elif is_list_tool(spec):
        schema = LIST_SCHEMA
    elif spec.tier is ActionTier.READ:
        schema = READ_SCHEMA
    else:
        schema = WRITE_SCHEMA
    out = json.loads(json.dumps(schema))
    out["properties"]["result"] = {"description": "Set when the tool returns something other than an object."}
    out["additionalProperties"] = True
    return out


# ─── meta tools ──────────────────────────────────────────────────────────────


def meta_tool_definitions() -> list[types.Tool]:
    return [
        types.Tool(
            name=SEARCH_TOOLS,
            title="Search tools",
            description=(
                "Find any LearnHouse tool this connection can use, including ones not in the current tool "
                "list (paths, communities, people, org settings, ...). Search by words (query) and/or "
                "toolset; returns each tool's name, purpose and input schema. Call the tool directly, or "
                "through invoke_tool if your app only allows listed tools. Omit both to see the toolsets."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "maxLength": 200, "description": "Words like 'enroll learners' or 'certificate'."},
                    "toolset": {"type": "string", "maxLength": 40, "description": "Only this toolset (e.g. teaching, people)."},
                    "include_schema": {"type": "boolean", "description": "Return input schemas (default true)."},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 50, "description": "Default 10."},
                    "cursor": {"type": "string", "description": "next_cursor from the previous page."},
                },
                "additionalProperties": False,
            },
            output_schema=output_schema_for_meta(SEARCH_TOOLS),
            annotations=types.ToolAnnotations(
                title="Search tools", read_only_hint=True, destructive_hint=False, idempotent_hint=True, open_world_hint=False
            ),
        ),
        types.Tool(
            name=INVOKE_TOOL,
            title="Call a tool by name",
            description=(
                "Call a LearnHouse tool found with search_tools that is not in your tool list. Same checks "
                "and approvals as calling it directly; for an approval, call invoke_tool again with the same "
                "name and arguments plus approval_id inside arguments."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "name": {"type": "string", "maxLength": 100, "description": "The tool's name, from search_tools."},
                    "arguments": {"type": "object", "description": "The tool's arguments, matching its input schema."},
                },
                "required": ["name"],
                "additionalProperties": False,
            },
            output_schema={"type": "object", "additionalProperties": True},
            annotations=types.ToolAnnotations(
                title="Call a tool by name", read_only_hint=False, destructive_hint=True, idempotent_hint=False, open_world_hint=True
            ),
        ),
    ]


def output_schema_for_meta(name: str) -> dict:
    out = json.loads(json.dumps(OUTPUT_SCHEMAS[name]))
    out["additionalProperties"] = True
    return out


_WORDS = re.compile(r"[a-z0-9]+")


_QUERY_STOP = frozenset("a an the to of in on for and or my me i with by from all any".split())


def _score(spec: ToolSpec, words: list[str]) -> float:
    """Words in the tool's name count most (whole word, then prefix), then
    its title, then its description; the query's first word matching the
    tool's verb breaks ties ("enroll learners" -> enroll_users_in_course)."""
    tokens = spec.name.split("_")
    title = (spec.title or "").lower()
    desc = spec.description.lower()
    score = 0.0
    for i, w in enumerate(words):
        stem = w[:-1] if len(w) > 4 and w.endswith("s") else w
        if stem in tokens or w in tokens:
            score += 4 + (2 if i == 0 and tokens and tokens[0] in (w, stem) else 0)
        elif any(t.startswith(stem) or stem.startswith(t) and len(t) > 3 for t in tokens):
            score += 3
        if stem in title:
            score += 1.5
        if stem in desc:
            score += 1
    return score


def search(specs: list[ToolSpec], listed: set[str], query: str | None, toolset: str | None,
           include_schema: bool, limit: int, cursor: str | None, definition) -> dict:
    """search_tools over the specs this connection may call."""
    pool = [s for s in specs if not toolset or (s.toolset or "core") == toolset]
    counts: dict[str, list[int]] = {}
    for s in specs:
        entry = counts.setdefault(s.toolset or "core", [0, 0])
        entry[0] += 1
        entry[1] += s.name in listed
    toolsets = [{"name": k, "tools": v[0], "listed": v[1]} for k, v in counts.items()]
    words = [w for w in _WORDS.findall((query or "").lower()) if len(w) > 1 and w not in _QUERY_STOP]
    if words:
        scored = [(s, _score(s, words)) for s in pool]
        pool = [s for s, sc in sorted(scored, key=lambda x: -x[1]) if sc > 0]
    elif not toolset:
        return {
            "items": [],
            "toolsets": toolsets,
            "total": 0,
            "has_more": False,
            "next_cursor": None,
            "hint": "Pass query (words) or toolset to list tools.",
        }
    chunk, nxt = paginate(pool, cursor, limit)
    items = []
    for s in chunk:
        item: dict[str, Any] = {
            "name": s.name,
            "title": s.title,
            "toolset": s.toolset or "core",
            "description": s.description,
            "read_only": s.tier is ActionTier.READ,
            "may_need_approval": s.may_need_approval,
            "listed": s.name in listed,
        }
        if include_schema:
            item["input_schema"] = definition(s).input_schema
        items.append(item)
    return {"items": items, "toolsets": toolsets, "total": len(pool), "has_more": nxt is not None, "next_cursor": nxt}
