from __future__ import annotations

from typing import Annotated

from mcp.server.fastmcp import FastMCP
from pydantic import Field

from ..client import LearnHouseClient


def register(mcp: FastMCP, client: LearnHouseClient) -> None:
    @mcp.tool(
        name="list_collections",
        description=(
            "List collections (groups of courses) in the organization, paginated. "
            "Collections are used to bundle related courses for a learning path or track."
        ),
    )
    async def list_collections(
        page: Annotated[int, Field(ge=1)] = 1,
        limit: Annotated[int, Field(ge=1, le=100)] = 20,
    ) -> list[dict]:
        return await client.get(
            f"/collections/org/{client.org_id}/page/{page}/limit/{limit}"
        )

    @mcp.tool(
        name="get_collection",
        description="Retrieve a single collection by its UUID, including its list of courses.",
    )
    async def get_collection(collection_uuid: str) -> dict:
        return await client.get(f"/collections/{collection_uuid}")

    @mcp.tool(
        name="create_collection",
        description=(
            "Create a new collection bundling a list of courses. Pass the numeric "
            "course IDs to include. Set public=True to make it visible to everyone."
        ),
    )
    async def create_collection(
        name: str,
        courses: list[int],
        description: str = "",
        public: bool = False,
    ) -> dict:
        body = {
            "name": name,
            "description": description,
            "public": public,
            "courses": courses,
            "org_id": client.org_id,
        }
        return await client.post("/collections/", json=body)

    @mcp.tool(
        name="update_collection",
        description=(
            "Update a collection by UUID. Any field can be omitted to leave it "
            "unchanged. Pass `courses` to replace the course list entirely. "
            "Note: `courses` takes NUMERIC COURSE IDs (not UUIDs) — resolve them "
            "from get_course or get_course_structure (the `id` field on the course "
            "object). To add or remove courses, use add_courses_to_collection / "
            "remove_courses_from_collection which handle the fetch-modify-write "
            "for you."
        ),
    )
    async def update_collection(
        collection_uuid: str,
        name: str | None = None,
        description: str | None = None,
        public: bool | None = None,
        courses: list[int] | None = None,
    ) -> dict:
        payload = {
            k: v
            for k, v in {
                "name": name,
                "description": description,
                "public": public,
                "courses": courses,
            }.items()
            if v is not None
        }
        if not payload:
            raise ValueError("update_collection requires at least one field to change.")
        return await client.put(f"/collections/{collection_uuid}", json=payload)

    @mcp.tool(
        name="add_courses_to_collection",
        description=(
            "Add one or more courses to a collection without clobbering the ones "
            "already in it. Pass numeric course IDs (not UUIDs). Duplicates are "
            "deduped automatically."
        ),
    )
    async def add_courses_to_collection(
        collection_uuid: str,
        course_ids: Annotated[list[int], Field(min_length=1)],
    ) -> dict:
        current = await client.get(f"/collections/{collection_uuid}")
        existing = [
            c.get("id") for c in (current.get("courses") or []) if isinstance(c, dict)
        ]
        existing = [c for c in existing if isinstance(c, int)]
        merged = list(dict.fromkeys([*existing, *course_ids]))
        return await client.put(
            f"/collections/{collection_uuid}", json={"courses": merged}
        )

    @mcp.tool(
        name="remove_courses_from_collection",
        description=(
            "Remove one or more courses from a collection. Pass numeric course IDs "
            "(not UUIDs). Missing ids are a no-op."
        ),
    )
    async def remove_courses_from_collection(
        collection_uuid: str,
        course_ids: Annotated[list[int], Field(min_length=1)],
    ) -> dict:
        current = await client.get(f"/collections/{collection_uuid}")
        existing = [
            c.get("id") for c in (current.get("courses") or []) if isinstance(c, dict)
        ]
        existing = [c for c in existing if isinstance(c, int)]
        drop = set(course_ids)
        remaining = [c for c in existing if c not in drop]
        return await client.put(
            f"/collections/{collection_uuid}", json={"courses": remaining}
        )

    @mcp.tool(
        name="delete_collection",
        description=(
            "DESTRUCTIVE: delete a collection by UUID. The courses inside are NOT "
            "deleted, only the grouping. Confirm with the user before calling."
        ),
    )
    async def delete_collection(collection_uuid: str) -> dict:
        return await client.delete(f"/collections/{collection_uuid}")
