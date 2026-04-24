from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any, AsyncGenerator

from google import genai
from google.genai import types

from config.config import get_learnhouse_config
from src.services.ai.atlas.mcp_client import (
    mcp_tool_to_gemini_schema,
    open_mcp_session,
    stringify_tool_result,
)

logger = logging.getLogger(__name__)

# Cap tool-call iterations per user turn so a model that gets into a loop
# can't burn API credits indefinitely. 20 is generous — normal conversations
# wrap up in 1–5 calls.
MAX_TOOL_ITERATIONS = 20

SYSTEM_INSTRUCTION = """You are Atlas, the in-product agent for
LearnHouse. You help instructors build and edit courses by chatting.
Tool descriptions tell you what each tool does — read them and trust
them.

# Voice
Decisive, brief, no apologies, no "I'll now proceed…" filler. State
what you chose and what you did, not what you're about to do. "Go",
"do it", "you choose", "trust you", "whatever" → authorization. Don't
re-ask.

# Defaults — never interrogate for these
Course descriptions, names, due dates (30 days), grading (PERCENTAGE),
quiz questions (write 3-5 yourself with 3-4 options each, one
correct). Pick sensible values from the topic; say what you chose.

# Working on a course
If the user names a course, call `focus_course` once if none is
already pinned (see "Current session state" below). Then use the
`focus_*` tools by chapter / activity NAME — never type UUIDs, never
call the `update_*` / `create_*` / `delete_*` primitives for that
course's content. Never use the words "focus", "pinned", or "context"
when talking to the user.

# Plan-then-build (compose_* only)
For `compose_course` / `compose_chapter` / `compose_assignment`, emit
a STRUCTURED plan inside a fenced block tagged `atlas-course-plan` so
the UI can render it as a proper card. Optional one-line lead-in
sentence above the block; END the message with `<!--atlas:confirm-->`
on its own line (the UI turns it into Approve / Cancel buttons).

Required format — emit JSON exactly like this, no other prose:

```atlas-course-plan
{
  "title": "Short Title",
  "description": "One-line description shown under the title.",
  "chapters": [
    {
      "name": "Chapter Name",
      "activities": [
        { "name": "Activity name", "kind": "dynamic" },
        { "name": "Knowledge check", "kind": "quiz" }
      ]
    },
    {
      "name": "Next Chapter",
      "activities": [
        { "name": "Activity name", "kind": "dynamic" }
      ]
    }
  ]
}
```

Activity `kind` is one of: `dynamic` (markdown body, default), `quiz`
(inline knowledge check), `video` (external YouTube/Vimeo), `pdf`
(uploaded document), `assignment` (graded with submissions). For
`compose_chapter` plans, omit the `title` and `description` fields and
just emit `chapters: [...]` with one entry. For `compose_assignment`
plans, use `{ "assignment": {...}, "tasks": [...] }` shape — but text
markdown is fine for assignment plans, they're simpler.

Never emit a markdown course plan with `### N. Name` headings or bare
paragraphs — always the JSON shape above.

When the user asks for a revision, change something MEANINGFUL, not
cosmetic. "Shorter title" means cut to roughly half the length. If
the user keeps asking shorter, keep cutting. Don't re-emit a plan
that's almost identical to the previous one — if you're unsure what
they want shortened, ask once with a one-line question.

After the marker, STOP and wait. Approve / "go" / silence → execute.
Cancel / "no" → drop it. Anything else → revise plan, emit marker,
wait again.

# Authoring rich content
After `compose_course` builds the structure, write each activity's
body with `fill_activity` (replace) or `append_to_activity` (preserve
existing) — one call per activity, ~250-500 words, with markdown that
includes code blocks for technical material, tables / blockquotes
where useful, links. Don't pack all activities' content into a single
compose call — they end up thin.

# Errors
If a tool_result has a `guidance` field, follow it. If a focus tool
reports the change went through and the user insists nothing happened,
run `describe_focused` once — if state matches what you set, say so
and suggest a hard refresh; don't loop the same call.

Confirm first for deletes; everything else, just do it.

"""


async def _run_stream_in_thread(stream_fn, *args, **kwargs):
    """
    google-genai's streaming iterator is synchronous. Push it onto a worker
    thread and bridge chunks back through an asyncio.Queue so the SSE
    generator stays fully async and never blocks the event loop.
    """
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()
    SENTINEL = object()

    def _producer():
        try:
            for chunk in stream_fn(*args, **kwargs):
                asyncio.run_coroutine_threadsafe(queue.put(chunk), loop).result()
        except Exception as exc:  # noqa: BLE001
            asyncio.run_coroutine_threadsafe(queue.put(exc), loop).result()
        finally:
            asyncio.run_coroutine_threadsafe(queue.put(SENTINEL), loop).result()

    task = loop.run_in_executor(None, _producer)
    try:
        while True:
            item = await queue.get()
            if item is SENTINEL:
                return
            if isinstance(item, Exception):
                raise item
            yield item
    finally:
        await task


def _extract_text_and_calls(chunk) -> tuple[str, list]:
    """Pull text fragments and function_call parts out of one streaming chunk."""
    text_out = ""
    calls = []
    candidates = getattr(chunk, "candidates", None) or []
    if not candidates:
        return text_out, calls
    parts = getattr(candidates[0].content, "parts", None) or []
    for part in parts:
        text = getattr(part, "text", None)
        if text:
            text_out += text
        fc = getattr(part, "function_call", None)
        if fc is not None and getattr(fc, "name", None):
            calls.append(fc)
    return text_out, calls


_API_STATUS_RE = re.compile(r"LearnHouse API (\d{3})\s*:\s*(.*)", re.DOTALL)


def _translate_tool_error(tool_name: str, raw_summary: str) -> str | None:
    """
    Parse the `ERROR: LearnHouse API <status>: <detail>` prefix that
    `stringify_tool_result` already emits and return a short directive the
    model can follow on its next turn. Returns None for ambiguous errors so
    the model gets to see the raw detail instead.
    """
    if not raw_summary.startswith("ERROR:"):
        return None
    body = raw_summary[len("ERROR:"):].strip()
    m = _API_STATUS_RE.match(body)
    if not m:
        # Non-HTTP error (network, internal, stringification). Keep raw.
        return None
    status = int(m.group(1))
    detail = m.group(2).strip()

    if status == 400:
        return (
            f"Invalid arguments to `{tool_name}`: {detail[:200]}. "
            "Re-read the tool's schema or the parent object before retrying."
        )
    if status == 401:
        return (
            "Atlas session expired mid-turn. Stop and ask the user to "
            "refresh the page so a new session token is minted."
        )
    if status == 403:
        return (
            f"The user's role doesn't allow `{tool_name}` "
            f"({detail[:200] or 'forbidden'}). Explain this to the user and "
            "stop — don't try a workaround."
        )
    if status == 404:
        return (
            f"`{tool_name}` target doesn't exist: {detail[:200]}. Re-fetch "
            "the parent (course / chapter / activity) to confirm current "
            "IDs before retrying — do NOT invent UUIDs."
        )
    if status == 409:
        return (
            f"Conflict on `{tool_name}` (duplicate or stale state): "
            f"{detail[:200]}. Re-read the current state, then retry once."
        )
    if status == 422:
        # Trim FastAPI's verbose detail structure to the first invalid field
        # name if we can find one, otherwise pass the raw detail through.
        field_match = re.search(r"'([^']+)' is (missing|required|not defined)", detail)
        field = field_match.group(1) if field_match else None
        if field:
            return (
                f"`{tool_name}` rejected: field `{field}` is required or "
                "invalid. Fix just that field and retry."
            )
        return (
            f"`{tool_name}` validation failed: {detail[:300]}. Fix the "
            "offending field and retry."
        )
    if 500 <= status < 600:
        return (
            f"Server error calling `{tool_name}` ({status}). Retry once; "
            "if it fails again, stop and surface the error to the user."
        )
    return None


async def _current_focus_note(mcp) -> str | None:
    """
    Ask the MCP server for the currently focused course (if any) and
    return a one-line note the agent can read. Silent no-op when nothing
    is focused — the agent is then free to resolve the target on its own
    via find_activity or focus_course.
    """
    try:
        result = await mcp.call_tool("describe_focused", {})
    except Exception:
        return None
    summary = stringify_tool_result(result)
    if not summary or summary.startswith("ERROR:"):
        return None
    try:
        data = json.loads(summary)
    except (TypeError, ValueError):
        # describe_focused prints JSON — if parsing fails, skip silently.
        return None
    focused = data.get("focused")
    if not isinstance(focused, dict) or not focused.get("name"):
        return None
    course_name = focused.get("name")
    chapters = data.get("chapters") or []
    totals = data.get("totals") or {}
    chap_count = totals.get("chapters", len(chapters))
    act_count = totals.get("activities", sum(len(c.get("activities") or []) for c in chapters))
    return (
        f"A course is already pinned for this user: **{course_name}** "
        f"({chap_count} chapters, {act_count} activities). Use the focus_* tools "
        "on it directly; do not ask the user 'which course' and do not mention "
        "pinning/focusing/context in your reply. If the user clearly switches "
        "to a different course, call focus_course silently and continue."
    )


def _history_to_contents(history: list[dict]) -> list[dict]:
    """Convert a simple [{role, content}] chat history into Gemini contents."""
    contents: list[dict] = []
    for msg in history or []:
        role = msg.get("role")
        content = msg.get("content", "")
        if role not in ("user", "model"):
            continue
        if not content:
            continue
        contents.append({"role": role, "parts": [{"text": content}]})
    return contents


async def run_atlas_turn(
    user_message: str,
    history: list[dict],
    session_token: str,
) -> AsyncGenerator[dict, None]:
    """
    Run one chat turn end-to-end. Yields SSE-shaped events:
      {'type': 'start'}
      {'type': 'chunk', 'content': str}
      {'type': 'tool_call', 'name': str, 'args': dict, 'call_id': str}
      {'type': 'tool_result', 'call_id': str, 'summary': str, 'is_error': bool}
      {'type': 'done'}
      {'type': 'error', 'message': str}
    """
    config = get_learnhouse_config()
    api_key = getattr(config.ai_config, "gemini_api_key", None)
    if not api_key:
        yield {"type": "error", "message": "Gemini API key not configured on this instance."}
        return

    mcp_url = getattr(config.ai_config, "mcp_internal_url", None) or "http://127.0.0.1:8765/mcp"
    model = getattr(config.ai_config, "atlas_model", None) or "gemini-2.5-flash"

    yield {"type": "start"}

    client = genai.Client(api_key=api_key)

    try:
        async with open_mcp_session(mcp_url, session_token) as mcp:
            tool_list = await mcp.list_tools()
            declarations = [mcp_tool_to_gemini_schema(t) for t in tool_list.tools]
            gemini_tool = types.Tool(function_declarations=declarations)

            # Peek at the server-side focus state and bake it into the
            # system instruction for this turn. Without this, the agent
            # forgets which course it was working on between turns and
            # starts asking the user — leaking an internal mechanic that
            # the user shouldn't have to think about.
            focus_note = await _current_focus_note(mcp)
            turn_instruction = SYSTEM_INSTRUCTION
            if focus_note:
                turn_instruction = f"{SYSTEM_INSTRUCTION}\n\n# Current session state\n\n{focus_note}"

            gen_config = types.GenerateContentConfig(
                tools=[gemini_tool],
                system_instruction=turn_instruction,
            )

            contents: list[Any] = _history_to_contents(history)
            contents.append({"role": "user", "parts": [{"text": user_message}]})

            for _ in range(MAX_TOOL_ITERATIONS):
                collected_text = ""
                collected_calls: list = []

                stream = _run_stream_in_thread(
                    client.models.generate_content_stream,
                    model=model,
                    contents=contents,
                    config=gen_config,
                )
                async for chunk in stream:
                    text, calls = _extract_text_and_calls(chunk)
                    if text:
                        collected_text += text
                        yield {"type": "chunk", "content": text}
                    if calls:
                        collected_calls.extend(calls)

                if not collected_calls:
                    yield {"type": "done"}
                    return

                # Append the model turn that contained these function calls,
                # then execute them all and append their results as the next
                # user turn — Gemini requires call/response pairing per turn.
                model_parts: list[dict] = []
                if collected_text:
                    model_parts.append({"text": collected_text})
                for fc in collected_calls:
                    model_parts.append(
                        {
                            "function_call": {
                                "name": fc.name,
                                "args": dict(fc.args or {}),
                            }
                        }
                    )
                contents.append({"role": "model", "parts": model_parts})

                response_parts: list[dict] = []
                for fc in collected_calls:
                    call_id = f"{fc.name}:{id(fc)}"
                    args_dict = dict(fc.args or {})
                    yield {
                        "type": "tool_call",
                        "name": fc.name,
                        "args": args_dict,
                        "call_id": call_id,
                    }
                    try:
                        result = await mcp.call_tool(fc.name, args_dict)
                        summary = stringify_tool_result(result)
                        is_error = summary.startswith("ERROR: ")
                    except Exception as exc:  # noqa: BLE001 — surface to agent
                        logger.exception("Atlas tool call failed: %s", fc.name)
                        summary = f"ERROR: {exc}"
                        is_error = True
                    guidance = _translate_tool_error(fc.name, summary) if is_error else None
                    result_event: dict[str, Any] = {
                        "type": "tool_result",
                        "call_id": call_id,
                        "summary": summary[:2000],
                        "is_error": is_error,
                    }
                    if guidance:
                        result_event["guidance"] = guidance
                    yield result_event
                    response_payload: dict[str, Any] = {
                        "result": summary[:4000],
                        "is_error": is_error,
                    }
                    if guidance:
                        response_payload["guidance"] = guidance
                    response_parts.append(
                        {
                            "function_response": {
                                "name": fc.name,
                                "response": response_payload,
                            }
                        }
                    )
                contents.append({"role": "user", "parts": response_parts})

            yield {
                "type": "error",
                "message": (
                    f"Atlas hit the {MAX_TOOL_ITERATIONS}-tool-call limit for this "
                    "turn — either the task is unusually large or the model is "
                    "looping. Try rephrasing the request."
                ),
            }
    except Exception as exc:  # noqa: BLE001
        logger.exception("Atlas turn failed")
        yield {"type": "error", "message": f"Atlas encountered an internal error: {exc}"}
