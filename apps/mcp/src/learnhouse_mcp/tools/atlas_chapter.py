"""Atlas CHAPTER tools: propose/apply pairs for create/edit/delete + move."""

from __future__ import annotations

from typing import Annotated, Any, Literal, Optional

from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel, Field

from ..client import LearnHouseClient
from .atlas_common import (
    TIER_CREATE,
    TIER_DESTRUCTIVE,
    TIER_EDIT,
    error,
    from_upstream_http_error,
    tier_meta,
)


class ChapterEditPatch(BaseModel):
    """Editable fields on a Chapter. All optional."""

    name: Optional[str] = Field(default=None, description="Display name.")
    description: Optional[str] = Field(default=None, description="Short summary.")
    thumbnail_image: Optional[str] = Field(default=None, description="Image URL only — no file upload via this tool.")
    lock_type: Optional[Literal["public", "authenticated", "restricted"]] = Field(
        default=None, description="Who can read this chapter's contents."
    )


def register(mcp: FastMCP, client: LearnHouseClient) -> None:

    # ---- Create --------------------------------------------------------

    @mcp.tool(
        name="propose_chapter_create",
        description=(
            "Stage a new empty chapter at the end of a course (or at a "
            "specific position when supplied)."
        ),
        meta=tier_meta(TIER_CREATE),
    )
    async def propose_chapter_create(
        course_uuid: str,
        name: Annotated[str, Field(min_length=1, max_length=200)],
        description: str | None = None,
        position: Annotated[int | None, Field(ge=0)] = None,
    ) -> dict:
        proposed = {"course_uuid": course_uuid, "name": name, "description": description or ""}
        return {
            "ok": True,
            "preview": {
                "kind": "chapter",
                "tier": TIER_CREATE,
                "target": {"uuid": "", "name": name, "parent_course_uuid": course_uuid},
                "mode": "create",
                "summary": f"Add chapter '{name}' to the course.",
                "proposed": proposed,
                "current": None,
                "apply_tool_name": "apply_chapter_create",
                "apply_payload": {
                    "course_uuid": course_uuid,
                    "name": name,
                    "description": description or "",
                    "position": position,
                },
            },
        }

    @mcp.tool(
        name="apply_chapter_create",
        description="Apply an approved chapter create. Internal.",
        meta=tier_meta(TIER_CREATE, is_apply=True),
    )
    async def apply_chapter_create(
        course_uuid: str,
        name: str,
        description: str = "",
        position: int | None = None,
    ) -> dict:
        try:
            course = await client.get(f"/courses/{course_uuid}")
        except Exception as e:
            return from_upstream_http_error(e)
        body = {
            "name": name,
            "description": description,
            "course_id": course.get("id"),
            "org_id": course.get("org_id"),
        }
        try:
            created = await client.post("/chapters/", json=body)
        except Exception as e:
            return from_upstream_http_error(e)
        return {
            "ok": True,
            "target": {
                "uuid": created.get("chapter_uuid", ""),
                "name": created.get("name", name),
                "parent_course_uuid": course_uuid,
            },
        }

    # ---- Edit ----------------------------------------------------------

    @mcp.tool(
        name="propose_chapter_edit",
        description=(
            "Stage a chapter edit. patch may include name, description, "
            "lock_type, thumbnail_image (URL only), extra_metadata."
        ),
        meta=tier_meta(TIER_EDIT),
    )
    async def propose_chapter_edit(
        chapter_uuid: str,
        patch: ChapterEditPatch,
    ) -> dict:
        try:
            chapter = await client.get(f"/chapters/{chapter_uuid}")
        except Exception as e:
            return from_upstream_http_error(e)
        clean = patch.model_dump(exclude_none=True)
        if not clean:
            return error("invalid_argument", "patch is empty; set at least one field.")
        chapter_id = chapter.get("id")
        course_uuid = chapter.get("course_uuid") or chapter.get("course", {}).get("course_uuid")
        return {
            "ok": True,
            "preview": {
                "kind": "chapter",
                "tier": TIER_EDIT,
                "target": {
                    "uuid": chapter_uuid,
                    "name": chapter.get("name", ""),
                    "parent_course_uuid": course_uuid,
                },
                "mode": "rename" if list(clean.keys()) == ["name"] else "edit",
                "summary": _summarize_chapter_patch(clean, chapter),
                "proposed": clean,
                "current": {k: chapter.get(k) for k in clean.keys()},
                "apply_tool_name": "apply_chapter_edit",
                "apply_payload": {"chapter_id": chapter_id, "patch": clean},
            },
        }

    @mcp.tool(
        name="apply_chapter_edit",
        description="Apply an approved chapter edit. Internal.",
        meta=tier_meta(TIER_EDIT, is_apply=True),
    )
    async def apply_chapter_edit(chapter_id: int, patch: dict[str, Any]) -> dict:
        try:
            updated = await client.put(f"/chapters/{chapter_id}", json=patch)
        except Exception as e:
            return from_upstream_http_error(e)
        return {
            "ok": True,
            "target": {
                "uuid": updated.get("chapter_uuid", ""),
                "name": updated.get("name", ""),
            },
        }

    # ---- Delete (destructive) ------------------------------------------

    @mcp.tool(
        name="propose_chapter_delete",
        description=(
            "Stage a chapter deletion. Surfaces the activities that will "
            "be removed for the destructive confirm card."
        ),
        meta=tier_meta(TIER_DESTRUCTIVE),
    )
    async def propose_chapter_delete(chapter_uuid: str) -> dict:
        try:
            chapter = await client.get(f"/chapters/{chapter_uuid}")
        except Exception as e:
            return from_upstream_http_error(e)
        activities = (chapter.get("activities") or [])
        name = chapter.get("name") or ""
        act_count = len(activities)
        course_uuid = chapter.get("course_uuid") or chapter.get("course", {}).get("course_uuid")
        return {
            "ok": True,
            "preview": {
                "kind": "chapter",
                "tier": TIER_DESTRUCTIVE,
                "target": {
                    "uuid": chapter_uuid,
                    "name": name,
                    "parent_course_uuid": course_uuid,
                },
                "mode": "delete",
                "summary": f"Delete chapter '{name}' and its {act_count} activities.",
                "proposed": {"delete": True},
                "current": {
                    "name": name,
                    "activities": [
                        {"uuid": a.get("activity_uuid"), "name": a.get("name")}
                        for a in activities
                    ],
                },
                "blast_radius": {"activities": act_count},
                "blast_radius_summary": (
                    f"Permanently removes {act_count} activity(ies) and any "
                    f"user progress/attempts attached to them."
                ),
                "action_label": f"Delete chapter '{name}'",
                "challenge_phrase": name,
                "apply_tool_name": "apply_chapter_delete",
                "apply_payload": {"chapter_id": chapter.get("id")},
            },
        }

    @mcp.tool(
        name="apply_chapter_delete",
        description="Apply an approved chapter delete. Internal.",
        meta=tier_meta(TIER_DESTRUCTIVE, is_apply=True),
    )
    async def apply_chapter_delete(
        chapter_id: int, confirmation_phrase: str | None = None
    ) -> dict:
        try:
            await client.delete(f"/chapters/{chapter_id}")
        except Exception as e:
            return from_upstream_http_error(e)
        return {"ok": True, "target": {"uuid": "", "name": ""}}

    # ---- Move activities between chapters ------------------------------

    @mcp.tool(
        name="propose_activities_move",
        description=(
            "Stage moving one or more activities to a different chapter "
            "(optionally at a specific position)."
        ),
        meta=tier_meta(TIER_EDIT),
    )
    async def propose_activities_move(
        activity_uuids: list[str],
        target_chapter_uuid: str,
        target_position: Annotated[int | None, Field(ge=0)] = None,
    ) -> dict:
        if not activity_uuids:
            return error("invalid_argument", "activity_uuids is empty.")
        try:
            target = await client.get(f"/chapters/{target_chapter_uuid}")
        except Exception as e:
            return from_upstream_http_error(e)
        proposed = {
            "activity_uuids": activity_uuids,
            "target_chapter_uuid": target_chapter_uuid,
            "target_position": target_position,
        }
        return {
            "ok": True,
            "preview": {
                "kind": "chapter",
                "tier": TIER_EDIT,
                "target": {
                    "uuid": target_chapter_uuid,
                    "name": target.get("name", ""),
                    "parent_course_uuid": target.get("course_uuid"),
                },
                "mode": "move_activities",
                "summary": (
                    f"Move {len(activity_uuids)} activity(ies) "
                    f"into '{target.get('name', '')}'."
                ),
                "proposed": proposed,
                "current": {"target_chapter": target.get("name", "")},
                "apply_tool_name": "apply_activities_move",
                "apply_payload": proposed,
            },
        }

    @mcp.tool(
        name="apply_activities_move",
        description="Apply an approved activities-move. Internal.",
        meta=tier_meta(TIER_EDIT, is_apply=True),
    )
    async def apply_activities_move(
        activity_uuids: list[str],
        target_chapter_uuid: str,
        target_position: int | None = None,
    ) -> dict:
        try:
            target = await client.get(f"/chapters/{target_chapter_uuid}")
        except Exception as e:
            return from_upstream_http_error(e)
        chap_id = target.get("id")
        # Update each activity's chapter_id; ordering is handled by the
        # chapter-level reorder endpoint when target_position is set.
        for act_uuid in activity_uuids:
            try:
                await client.put(
                    f"/activities/{act_uuid}",
                    json={"chapter_id": chap_id},
                )
            except Exception as e:
                return from_upstream_http_error(e)
        return {
            "ok": True,
            "target": {"uuid": target_chapter_uuid, "name": target.get("name", "")},
        }


def _summarize_chapter_patch(patch: dict[str, Any], current: dict[str, Any]) -> str:
    if "name" in patch and len(patch) == 1:
        return f"Rename chapter from '{current.get('name','')}' to '{patch['name']}'."
    return "Update chapter " + ", ".join(patch.keys()) + "."
