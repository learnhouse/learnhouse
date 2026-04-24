from __future__ import annotations

from typing import Annotated, Any
from uuid import uuid4

from mcp.server.fastmcp import FastMCP
from pydantic import Field

from ..client import LearnHouseClient


def register(mcp: FastMCP, client: LearnHouseClient) -> None:
    @mcp.tool(
        name="magicblock_start",
        description=(
            "Generate the HTML for a new MagicBlock (an AI-authored section of a "
            "DYNAMIC activity) from a natural-language prompt. Opens a server-side "
            "MagicBlocks session and collects the full SSE stream into a single "
            "result. Returns {session_uuid, block_uuid, html_content, "
            "iteration_count, event_count}. Only the prompt and the target "
            "activity_uuid are required — block_uuid is auto-minted if you omit "
            "it, and the context fields (course_title, course_description, "
            "activity_name, activity_content_summary) are auto-populated from the "
            "activity's course unless you supply overrides."
        ),
    )
    async def magicblock_start(
        activity_uuid: str,
        prompt: Annotated[
            str,
            Field(
                min_length=3,
                description="The natural-language instruction for what the block should contain.",
            ),
        ],
        block_uuid: Annotated[
            str | None,
            Field(
                description=(
                    "Block identifier. Pass the existing block's UUID when "
                    "regenerating its contents; leave empty to mint a fresh one."
                ),
            ),
        ] = None,
        context: Annotated[
            dict[str, Any] | None,
            Field(
                description=(
                    "Optional overrides for the 4 context fields "
                    "(course_title, course_description, activity_name, "
                    "activity_content_summary). Any missing field is filled from "
                    "the activity + course API."
                ),
            ),
        ] = None,
    ) -> dict:
        resolved_context = await _resolve_magicblock_context(
            client, activity_uuid, context or {}
        )
        body: dict[str, Any] = {
            "activity_uuid": activity_uuid,
            "block_uuid": block_uuid or f"block_{uuid4().hex}",
            "prompt": prompt,
            "context": resolved_context,
        }
        events, html = await client.post_sse_collect(
            "/magicblocks/start", json=body
        )
        session_uuid = next(
            (e.get("session_uuid") for e in events if e.get("type") == "done"),
            None,
        )
        error = next(
            (e.get("message") for e in events if e.get("type") == "error"),
            None,
        )
        if error:
            raise RuntimeError(f"MagicBlocks generation failed: {error}")
        return {
            "session_uuid": session_uuid,
            "block_uuid": body["block_uuid"],
            "html_content": html,
            "iteration_count": 1,
            "event_count": len(events),
        }

    @mcp.tool(
        name="magicblock_iterate",
        description=(
            "Continue refining a MagicBlock by sending another instruction to an "
            "existing session. Capped at 6 iterations per session server-side. "
            "Pass the session_uuid returned by magicblock_start along with the "
            "same activity_uuid and block_uuid, the follow-up `message`, and "
            "optionally the current rendered HTML for context."
        ),
    )
    async def magicblock_iterate(
        session_uuid: str,
        activity_uuid: str,
        block_uuid: str,
        message: Annotated[str, Field(min_length=1)],
        current_html: str | None = None,
    ) -> dict:
        body: dict[str, Any] = {
            "session_uuid": session_uuid,
            "activity_uuid": activity_uuid,
            "block_uuid": block_uuid,
            "message": message,
        }
        if current_html is not None:
            body["current_html"] = current_html
        events, html = await client.post_sse_collect(
            "/magicblocks/iterate", json=body
        )
        error = next(
            (e.get("message") for e in events if e.get("type") == "error"),
            None,
        )
        if error:
            raise RuntimeError(f"MagicBlocks iteration failed: {error}")
        return {
            "session_uuid": session_uuid,
            "block_uuid": block_uuid,
            "html_content": html,
            "event_count": len(events),
        }

    async def _resolve_magicblock_context(
        lh_client: LearnHouseClient,
        activity_uuid: str,
        overrides: dict[str, Any],
    ) -> dict[str, str]:
        """
        MagicBlocks requires all four context fields (course_title,
        course_description, activity_name, activity_content_summary). Rather
        than force the agent to thread that plumbing through every tool call,
        we resolve any missing field from the API ourselves.
        """
        needed = {
            "course_title",
            "course_description",
            "activity_name",
            "activity_content_summary",
        }
        merged: dict[str, str] = {
            k: str(v) for k, v in (overrides or {}).items() if isinstance(v, (str, int, float))
        }
        if needed.issubset(merged.keys()) and all(merged[k] for k in needed):
            return merged

        activity = await lh_client.get(f"/activities/{activity_uuid}")
        activity_name = activity.get("name") or ""
        content = activity.get("content") or {}
        summary_source = content if isinstance(content, dict) else {}
        activity_summary = (
            summary_source.get("summary")
            or summary_source.get("description")
            or str(content)[:500]
            if content
            else ""
        )

        course_title = ""
        course_description = ""
        course_id = activity.get("course_id")
        if course_id:
            try:
                course = await lh_client.get(f"/courses/id/{int(course_id)}")
            except Exception:
                course = None
            if isinstance(course, dict):
                course_title = course.get("name") or ""
                course_description = course.get("description") or ""

        merged.setdefault("course_title", course_title or "Untitled course")
        merged.setdefault("course_description", course_description or "No description.")
        merged.setdefault("activity_name", activity_name or "Untitled activity")
        merged.setdefault(
            "activity_content_summary", activity_summary or "No existing content."
        )
        # Guarantee non-empty strings — Gemini and the backend both dislike
        # empty context fields.
        for k in needed:
            if not merged.get(k):
                merged[k] = "(unspecified)"
        return merged

    @mcp.tool(
        name="magicblock_get_session",
        description=(
            "Read the state of a MagicBlocks session: iteration count, remaining "
            "iterations, the latest rendered HTML, and full message history."
        ),
    )
    async def magicblock_get_session(session_uuid: str) -> dict:
        return await client.get(f"/magicblocks/session/{session_uuid}")
