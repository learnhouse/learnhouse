from __future__ import annotations

from typing import Annotated

from mcp.server.fastmcp import FastMCP
from pydantic import Field

from ..client import LearnHouseClient


def register(mcp: FastMCP, client: LearnHouseClient) -> None:
    @mcp.tool(
        name="list_chapters",
        description=(
            "List chapters for a course, paginated. Pass the numeric course_id "
            "(not the UUID) — you can find it in the output of get_course or "
            "get_course_structure."
        ),
    )
    async def list_chapters(
        course_id: int,
        page: Annotated[int, Field(ge=1)] = 1,
        limit: Annotated[int, Field(ge=1, le=100)] = 50,
    ) -> list[dict]:
        return await client.get(f"/chapters/course/{course_id}/page/{page}/limit/{limit}")

    @mcp.tool(
        name="get_chapter",
        description="Retrieve a single chapter by its numeric ID.",
    )
    async def get_chapter(chapter_id: int) -> dict:
        return await client.get(f"/chapters/{chapter_id}")

    @mcp.tool(
        name="create_chapter",
        description=(
            "Create a new chapter inside a course. Pass the numeric course_id. "
            "The new chapter is appended to the end of the course's chapter list."
        ),
    )
    async def create_chapter(
        course_id: int,
        name: str,
        description: str | None = None,
    ) -> dict:
        body = {
            "name": name,
            "description": description or "",
            "course_id": course_id,
            "org_id": client.org_id,
        }
        return await client.post("/chapters/", json=body)

    @mcp.tool(
        name="update_chapter",
        description=(
            "Update an existing chapter's name or description by ID. Only provided "
            "fields are changed."
        ),
    )
    async def update_chapter(
        chapter_id: int,
        name: str | None = None,
        description: str | None = None,
    ) -> dict:
        payload = {k: v for k, v in {"name": name, "description": description}.items() if v is not None}
        if not payload:
            raise ValueError("update_chapter requires at least one field to change.")
        return await client.put(f"/chapters/{chapter_id}", json=payload)

    @mcp.tool(
        name="delete_chapter",
        description=(
            "DESTRUCTIVE: delete a chapter and detach its activities from the course. "
            "Confirm with the user before calling."
        ),
    )
    async def delete_chapter(chapter_id: int) -> dict:
        return await client.delete(f"/chapters/{chapter_id}")

    @mcp.tool(
        name="reorder_course_structure",
        description=(
            "Reorder a course's chapters AND each chapter's activities in a single "
            "call. Pass the course_uuid and the full tree you want — any chapter or "
            "activity not listed keeps its existing position, but it is safer to "
            "list everything to avoid ambiguity. The `structure` argument is a list "
            "of {chapter_id, activity_ids} entries whose list order becomes the new "
            "order. Resolve ids via get_course_structure first."
        ),
    )
    async def reorder_course_structure(
        course_uuid: str,
        structure: Annotated[
            list[dict],
            Field(
                description=(
                    "List of chapters in desired order. Each entry: "
                    "{\"chapter_id\": <int>, \"activity_ids\": [<int>, <int>, ...]}."
                ),
            ),
        ],
    ) -> dict:
        body = {
            "chapter_order_by_ids": [
                {
                    "chapter_id": int(ch["chapter_id"]),
                    "activities_order_by_ids": [
                        {"activity_id": int(aid)}
                        for aid in (ch.get("activity_ids") or [])
                    ],
                }
                for ch in structure
            ],
        }
        return await client.put(
            f"/chapters/course/{course_uuid}/order", json=body
        )
