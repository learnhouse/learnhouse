"""Atlas READ tools — no mutations, no preview cards.

Returns structured payloads the API-side pipeline can stream as
``results.list`` cards or feed to the agent's reasoning. Every tool
here is tagged ``atlas.tier=READ`` so the cross-tier guard never
blocks them.
"""

from __future__ import annotations

from typing import Annotated

from mcp.server.fastmcp import FastMCP
from pydantic import Field

from ..client import LearnHouseClient
from .atlas_common import TIER_READ, error, from_upstream_http_error, tier_meta


def register(mcp: FastMCP, client: LearnHouseClient) -> None:
    @mcp.tool(
        name="atlas_list_courses",
        description=(
            "List courses in the organization. Pass include_unpublished=True to "
            "see drafts (caller must have edit rights). Always returns "
            "{ok, items, results_kind} so the chat surface renders a results "
            "card."
        ),
        meta=tier_meta(TIER_READ),
    )
    async def atlas_list_courses(
        page: Annotated[int, Field(ge=1)] = 1,
        limit: Annotated[int, Field(ge=1, le=50)] = 10,
        include_unpublished: bool = True,
    ) -> dict:
        try:
            items = await client.get(
                f"/courses/org_slug/{client.org_slug}/page/{page}/limit/{limit}",
                params={"include_unpublished": str(include_unpublished).lower()},
            )
        except Exception as e:
            return from_upstream_http_error(e)
        return {
            "ok": True,
            "results_kind": "courses",
            "items": [
                {
                    "uuid": c.get("course_uuid"),
                    "name": c.get("name"),
                    "description": c.get("description"),
                    "published": c.get("published"),
                    "public": c.get("public"),
                    "thumbnail_image": c.get("thumbnail_image"),
                }
                for c in (items or [])
            ],
        }

    @mcp.tool(
        name="atlas_describe_course",
        description=(
            "Get a course's metadata and its full chapter→activity tree. "
            "Use this to read the current structure before proposing edits, "
            "or to answer questions about what the course contains."
        ),
        meta=tier_meta(TIER_READ),
    )
    async def atlas_describe_course(course_uuid: str) -> dict:
        try:
            course = await client.get(f"/courses/meta/course_{course_uuid.removeprefix('course_')}")
        except Exception:
            try:
                course = await client.get(f"/courses/{course_uuid}")
            except Exception as e:
                return from_upstream_http_error(e)
        return {"ok": True, "course": course}

    @mcp.tool(
        name="atlas_describe_chapter",
        description="Get a chapter's metadata + its activities in order.",
        meta=tier_meta(TIER_READ),
    )
    async def atlas_describe_chapter(chapter_uuid: str) -> dict:
        try:
            chapter = await client.get(f"/chapters/{chapter_uuid}")
        except Exception as e:
            return from_upstream_http_error(e)
        return {"ok": True, "chapter": chapter}

    @mcp.tool(
        name="atlas_describe_activity",
        description=(
            "Get a single activity by UUID, including its content body. "
            "Required before proposing a body rewrite or rename."
        ),
        meta=tier_meta(TIER_READ),
    )
    async def atlas_describe_activity(activity_uuid: str) -> dict:
        try:
            activity = await client.get(f"/activities/{activity_uuid}")
        except Exception as e:
            return from_upstream_http_error(e)
        return {"ok": True, "activity": activity}

    @mcp.tool(
        name="atlas_get_activity_state",
        description=(
            "Get an activity's optimistic-lock state: current_version, "
            "update_date, last_modified_by_username. Used before "
            "proposing a body rewrite to capture the expected_version."
        ),
        meta=tier_meta(TIER_READ),
    )
    async def atlas_get_activity_state(activity_uuid: str) -> dict:
        try:
            state = await client.get(f"/activities/{activity_uuid}/state")
        except Exception as e:
            return from_upstream_http_error(e)
        return {"ok": True, "state": state}

    @mcp.tool(
        name="atlas_search_org",
        description=(
            "Full-text search across the organization: courses, chapters, "
            "activities, collections. Useful when the user references "
            "something by topic rather than name."
        ),
        meta=tier_meta(TIER_READ),
    )
    async def atlas_search_org(
        query: Annotated[str, Field(min_length=1, max_length=200)],
        kind: Annotated[
            str | None,
            Field(description="Restrict to one kind: course | chapter | activity"),
        ] = None,
        limit: Annotated[int, Field(ge=1, le=50)] = 15,
    ) -> dict:
        try:
            params: dict = {"query": query, "limit": limit}
            if kind:
                params["kind"] = kind
            items = await client.get(
                f"/courses/org_slug/{client.org_slug}/search", params=params
            )
        except Exception as e:
            return from_upstream_http_error(e)
        if not isinstance(items, list):
            return error("internal_error", "Search returned unexpected payload.")
        return {"ok": True, "results_kind": "search", "items": items}
