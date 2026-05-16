"""Propose-delete tools. Always require user confirmation (typed phrase).

These tools fetch the target's current state to populate `blast_radius`
(number of nested resources that will be cascade-deleted) so the frontend
can render an accurate warning.
"""

from mcp.server.fastmcp import FastMCP

from ..lh_client import LHClient
from ..schemas import ResourceRef
from ._common import envelope


def register(mcp: FastMCP, lh: LHClient) -> None:
    @mcp.tool(
        description=(
            "Propose deleting a course. This is irreversible and cascades to "
            "all chapters and activities. Returns a preview the user must "
            "type-confirm before the deletion runs."
        )
    )
    async def propose_delete_course(course_uuid: str) -> dict:
        meta = await lh.get(f"/courses/{course_uuid}/meta", params={"slim": "true"})
        course = meta.get("course", meta) if isinstance(meta, dict) else {}
        chapters = meta.get("chapters", []) if isinstance(meta, dict) else []
        activity_count = sum(
            len(c.get("activities") or []) for c in chapters
        )
        return envelope(
            tool="propose_delete_course",
            tier="DESTRUCTIVE",
            target=ResourceRef(
                kind="course",
                uuid=course_uuid,
                name=course.get("name", ""),
            ),
            mode="delete",
            summary=f"Delete course \"{course.get('name', '')}\"",
            current={"name": course.get("name"), "description": course.get("description")},
            requires_confirmation=True,
            blast_radius={
                "chapters": len(chapters),
                "activities": activity_count,
            },
        )

    @mcp.tool(
        description=(
            "Propose deleting a chapter. Cascades to all activities inside it. "
            "Returns a preview the user must type-confirm."
        )
    )
    async def propose_delete_chapter(chapter_id: int) -> dict:
        ch = await lh.get(f"/chapters/{chapter_id}")
        activities = ch.get("activities") or []
        return envelope(
            tool="propose_delete_chapter",
            tier="DESTRUCTIVE",
            target=ResourceRef(
                kind="chapter",
                uuid=str(chapter_id),
                name=ch.get("name", ""),
                parent_course_uuid=ch.get("course_uuid"),
            ),
            mode="delete",
            summary=f"Delete chapter \"{ch.get('name', '')}\"",
            current={"name": ch.get("name"), "description": ch.get("description")},
            requires_confirmation=True,
            blast_radius={"activities": len(activities)},
        )

    @mcp.tool(
        description=(
            "Propose deleting an activity. Returns a preview the user must "
            "type-confirm."
        )
    )
    async def propose_delete_activity(activity_uuid: str) -> dict:
        a = await lh.get(f"/activities/{activity_uuid}")
        return envelope(
            tool="propose_delete_activity",
            tier="DESTRUCTIVE",
            target=ResourceRef(
                kind="activity",
                uuid=activity_uuid,
                name=a.get("name", ""),
            ),
            mode="delete",
            summary=f"Delete activity \"{a.get('name', '')}\"",
            current={
                "name": a.get("name"),
                "activity_type": a.get("activity_type"),
                "activity_sub_type": a.get("activity_sub_type"),
            },
            requires_confirmation=True,
            blast_radius={},
        )
