"""Read-only tools. Silent (no preview cards); the LLM gets data inline.

Returns are slimmed to the fields the LLM actually needs to reason about
courses/chapters/activities — full Pydantic models from LH are too noisy
and bloat the context window.
"""

from typing import Any

from mcp.server.fastmcp import FastMCP

from .. import auth
from ..lh_client import LHClient


def _slim_course(c: dict[str, Any]) -> dict[str, Any]:
    return {
        "course_uuid": c.get("course_uuid"),
        "name": c.get("name"),
        "description": c.get("description"),
        "published": c.get("published"),
        "public": c.get("public"),
        "tags": c.get("tags"),
    }


def _slim_chapter(ch: dict[str, Any]) -> dict[str, Any]:
    return {
        "chapter_id": ch.get("id") or ch.get("chapter_id"),
        "name": ch.get("name"),
        "description": ch.get("description"),
        "order": ch.get("order"),
        "activity_count": len(ch.get("activities") or []),
    }


def _slim_activity(a: dict[str, Any]) -> dict[str, Any]:
    return {
        "activity_uuid": a.get("activity_uuid"),
        "name": a.get("name"),
        "activity_type": a.get("activity_type"),
        "activity_sub_type": a.get("activity_sub_type"),
        "published": a.get("published"),
        "order": a.get("order"),
        "current_version": a.get("current_version"),
    }


def register(mcp: FastMCP, lh: LHClient) -> None:
    @mcp.tool(
        description=(
            "List courses in the current organization. If `query` is provided, "
            "performs a full-text search; otherwise returns the first page."
        )
    )
    async def list_courses(query: str | None = None, limit: int = 20) -> list[dict]:
        org_slug = auth.get_org_slug()
        capped = max(1, min(50, limit))
        if query:
            data = await lh.get(
                f"/courses/org_slug/{org_slug}/search",
                params={"query": query[:200], "page": 1, "limit": capped},
            )
        else:
            data = await lh.get(
                f"/courses/org_slug/{org_slug}/page/1/limit/{capped}"
            )
        rows = data if isinstance(data, list) else []
        return [_slim_course(c) for c in rows]

    @mcp.tool(
        description=(
            "Fetch a course's full structure: metadata + chapters + ordered "
            "activity summaries. Use this when the LLM needs to reason about "
            "what's already in the course before proposing changes."
        )
    )
    async def get_course(course_uuid: str) -> dict:
        data = await lh.get(f"/courses/{course_uuid}/meta", params={"slim": "true"})
        course = data.get("course", data) if isinstance(data, dict) else {}
        chapters_raw = data.get("chapters", []) if isinstance(data, dict) else []
        chapters: list[dict] = []
        for ch in chapters_raw:
            chapter = _slim_chapter(ch)
            chapter["activities"] = [
                _slim_activity(a) for a in (ch.get("activities") or [])
            ]
            chapters.append(chapter)
        return {
            **_slim_course(course),
            "chapter_count": len(chapters),
            "activity_count": sum(c["activity_count"] for c in chapters),
            "chapters": chapters,
        }

    @mcp.tool(description="Fetch a single chapter (metadata + activity summaries).")
    async def get_chapter(chapter_id: int) -> dict:
        ch = await lh.get(f"/chapters/{chapter_id}")
        slim = _slim_chapter(ch)
        slim["activities"] = [_slim_activity(a) for a in (ch.get("activities") or [])]
        return slim

    @mcp.tool(
        description=(
            "Fetch a single activity by UUID. For dynamic activities the content "
            "is the raw Tiptap JSON; for videos it's the URL/title; etc."
        )
    )
    async def get_activity(activity_uuid: str) -> dict:
        a = await lh.get(f"/activities/{activity_uuid}")
        slim = _slim_activity(a)
        slim["content"] = a.get("content")
        return slim

    @mcp.tool(
        description=(
            "Search the current organization across courses (title+description). "
            "Returns ranked candidates with kind/uuid/name to disambiguate "
            "free-form references the user might make."
        )
    )
    async def search_org(query: str, limit: int = 10) -> list[dict]:
        org_slug = auth.get_org_slug()
        capped = max(1, min(20, limit))
        rows = await lh.get(
            f"/courses/org_slug/{org_slug}/search",
            params={"query": query[:200], "page": 1, "limit": capped},
        )
        out: list[dict] = []
        for c in rows or []:
            name = c.get("name") or ""
            out.append(
                {
                    "kind": "course",
                    "uuid": c.get("course_uuid"),
                    "name": name,
                    "label": f"course · {name}",
                    "score": 1.0,
                }
            )
        return out
