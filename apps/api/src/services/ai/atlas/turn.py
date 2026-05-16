"""Turn orchestration + pydantic-ai message → AtlasEvent translation.

We use `agent.run()` (non-streaming) instead of `agent.iter()` because
the latter's task-group / cancel-scope lifecycle clashes with sse_starlette's
EventSourceResponse generator. After the run completes we walk
`result.all_messages()` and emit one AtlasEvent per part — tool calls,
tool results, and the final text — in order.

The result is functionally streaming from the user's perspective (each
event is sent over SSE the instant it's produced from the message walk)
but the LLM call itself is not chunk-streamed. We can revisit incremental
text streaming later once pydantic-ai's MCP toolset cancel-scope issue
is upstream-fixed.
"""

from __future__ import annotations

import logging
import time
import uuid
from collections.abc import AsyncGenerator
from typing import Any

from pydantic_ai.messages import (
    TextPart,
    ToolCallPart,
    ToolReturnPart,
)

from . import events as ev
from .agent import build_agent
from .deps import AtlasDeps
from .pending import (
    PendingStore,
    build_confirmation_challenge,
)

logger = logging.getLogger(__name__)

_READ_TOOLS = {
    "list_courses",
    "get_course",
    "get_chapter",
    "get_activity",
    "search_org",
}


async def run_turn(
    *,
    deps: AtlasDeps,
    user_message: str,
    pending_store: PendingStore,
    model: str,
    mcp_url: str,
    new_chat: bool,
    api_key: str | None = None,
) -> AsyncGenerator[dict[str, Any], None]:
    """Yield serialized SSE events for one turn."""
    if new_chat:
        yield ev.serialize(ev.SessionEvent(aichat_uuid=deps.aichat_uuid))

    agent = build_agent(model=model, mcp_url=mcp_url, deps=deps, api_key=api_key)

    started_at = time.monotonic()
    try:
        result = await agent.run(user_message, deps=deps)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Atlas turn failed")
        yield ev.serialize(
            ev.ErrorEvent(
                code="TURN_FAILED",
                message=str(exc) or "Atlas encountered an unexpected error.",
                retriable=True,
            )
        )
        yield ev.serialize(ev.DoneEvent())
        return

    for serialized in _walk_messages(
        messages=result.all_messages(),
        deps=deps,
        pending_store=pending_store,
        elapsed_ms=int((time.monotonic() - started_at) * 1000),
    ):
        yield serialized

    yield ev.serialize(ev.DoneEvent())


def _walk_messages(
    *,
    messages: list,
    deps: AtlasDeps,
    pending_store: PendingStore,
    elapsed_ms: int,
) -> list[dict[str, Any]]:
    """Translate the agent's message history into AtlasEvent serialized dicts.

    pydantic-ai exposes the conversation as a list of ModelRequest /
    ModelResponse messages, each containing typed Parts. We only care
    about ToolCallPart, ToolReturnPart, and TextPart — the rest
    (ThinkingPart, etc.) don't have user-visible counterparts.
    """
    out: list[dict[str, Any]] = []
    # Index tool calls by tool_call_id so we can pair them with results.
    pending_calls: dict[str, dict[str, Any]] = {}

    for msg in messages:
        parts = getattr(msg, "parts", None) or []
        for part in parts:
            if isinstance(part, ToolCallPart):
                call_id = part.tool_call_id or uuid.uuid4().hex
                pending_calls[call_id] = {
                    "name": part.tool_name,
                    "args": _coerce_args(part.args),
                    "started": time.monotonic(),
                }
                out.append(
                    ev.serialize(
                        ev.ToolStartEvent(
                            call_id=call_id,
                            name=part.tool_name,
                            args_redacted=_redact_args(_coerce_args(part.args)),
                        )
                    )
                )

            elif isinstance(part, ToolReturnPart):
                call_id = part.tool_call_id or ""
                call_info = pending_calls.pop(call_id, None)
                name = part.tool_name or (call_info["name"] if call_info else "")
                content = part.content

                # MCP tool results from FastMCP come back as JSON-encoded
                # content in either dict or list form, depending on the
                # tool's return type.
                tool_result = _normalize_tool_result(content)
                ok = not _looks_like_error(tool_result)

                if ok and name in _READ_TOOLS:
                    # `list_*` and `search_*` return lists; `get_*` returns
                    # a single dict — wrap the dict in a 1-element list so
                    # the frontend's results renderer always sees an array.
                    if isinstance(tool_result, list):
                        items = tool_result
                    elif isinstance(tool_result, dict):
                        items = [tool_result]
                    else:
                        items = []
                    out.append(
                        ev.serialize(
                            ev.ResultsListEvent(kind=name, items=items)
                        )
                    )
                elif ok and isinstance(tool_result, dict) and tool_result.get("pending_id"):
                    # PreviewEnvelope-shaped result → persist as pending + emit preview.
                    edit, superseded = pending_store.create(
                        envelope=tool_result,
                        aichat_uuid=deps.aichat_uuid,
                        org_id=deps.org_id,
                        user_id=getattr(deps.current_user, "id", 0),
                    )
                    for old in superseded:
                        out.append(
                            ev.serialize(
                                ev.PendingDroppedEvent(
                                    pending_id=old, reason="superseded"
                                )
                            )
                        )
                    preview = _build_preview_event(tool_result)
                    if preview is not None:
                        out.append(ev.serialize(preview))
                    if name == "propose_course_structure":
                        out.append(
                            ev.serialize(
                                ev.StructureProposalEvent(
                                    tree=tool_result.get("patch") or {}
                                )
                            )
                        )
                    if edit.requires_confirmation:
                        challenge = build_confirmation_challenge(edit)
                        out.append(
                            ev.serialize(
                                ev.ConfirmRequiredEvent(
                                    pending_id=edit.pending_id,
                                    challenge=ev.ConfirmationChallengeDTO(**challenge),
                                )
                            )
                        )
                elif not ok and isinstance(tool_result, dict):
                    out.append(
                        ev.serialize(
                            ev.ErrorEvent(
                                code=str(tool_result.get("code", "TOOL_ERROR")),
                                message=str(tool_result.get("message", "Tool failed")),
                                retriable=bool(tool_result.get("retriable", False)),
                            )
                        )
                    )

                duration_ms = (
                    int((time.monotonic() - call_info["started"]) * 1000)
                    if call_info
                    else None
                )
                out.append(
                    ev.serialize(
                        ev.ToolEndEvent(
                            call_id=call_id,
                            name=name,
                            ok=ok,
                            duration_ms=duration_ms,
                        )
                    )
                )

            elif isinstance(part, TextPart):
                if part.content:
                    out.append(ev.serialize(ev.MessageDeltaEvent(delta=part.content)))

    return out


# ─── Helpers ─────────────────────────────────────────────────────────────


def _coerce_args(args: Any) -> dict[str, Any]:
    if isinstance(args, dict):
        return args
    if isinstance(args, str):
        try:
            import json

            data = json.loads(args)
            if isinstance(data, dict):
                return data
        except Exception:
            return {"raw": args}
    return {}


def _redact_args(args: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k, v in args.items():
        if isinstance(v, str) and len(v) > 200:
            out[k] = v[:200] + "…"
        else:
            out[k] = v
    return out


def _normalize_tool_result(content: Any) -> Any:
    """MCP tool returns arrive as either the value directly (dict/list) or
    wrapped in a list of TextContent parts that JSON-encode the payload.
    Normalize to the underlying value."""
    import json

    if isinstance(content, (dict, list)):
        return content
    if isinstance(content, str):
        try:
            return json.loads(content)
        except Exception:
            return content
    # FastMCP returns a list of content parts, each with .text
    if isinstance(content, (tuple, list)):
        for item in content:
            text = getattr(item, "text", None)
            if isinstance(text, str):
                try:
                    return json.loads(text)
                except Exception:
                    return text
    text = getattr(content, "text", None)
    if isinstance(text, str):
        try:
            return json.loads(text)
        except Exception:
            return text
    return content


def _looks_like_error(result: Any) -> bool:
    if isinstance(result, dict):
        return result.get("ok") is False or bool(result.get("error"))
    return False


def _build_preview_event(envelope: dict[str, Any]) -> Any | None:
    target = envelope.get("target") or {}
    kind = target.get("kind")
    pid = envelope.get("pending_id")
    summary = envelope.get("summary", "")
    mode = envelope.get("mode", "edit")
    current = envelope.get("current")
    if not pid or not kind:
        return None
    target_dto = ev.ResourceRefDTO(**target)
    if kind == "activity":
        return ev.PreviewActivityEvent(
            pending_id=pid,
            target=target_dto,
            proposed=envelope.get("proposed") or {},
            current=current,
            summary=summary,
            mode=mode,
            expected_version=envelope.get("expected_version"),
        )
    if kind == "chapter":
        return ev.PreviewChapterEvent(
            pending_id=pid,
            target=target_dto,
            patch=envelope.get("patch") or {},
            current=current,
            summary=summary,
            mode=mode,
        )
    if kind == "course":
        return ev.PreviewCourseEvent(
            pending_id=pid,
            target=target_dto,
            patch=envelope.get("patch") or {},
            current=current,
            summary=summary,
            mode=mode,
        )
    return None
