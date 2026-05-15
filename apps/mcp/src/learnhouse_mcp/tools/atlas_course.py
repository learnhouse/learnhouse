"""Atlas COURSE tools: propose/apply pairs + structure suggestion.

``propose_*`` tools read the current state, build a diff-flavoured
preview payload, and return it as ``{ok, preview}`` for the API-side
pipeline to persist into a PendingEdit and emit as a preview card.
``apply_*`` tools run only when the user confirms; they perform the
mutation against the LearnHouse API and return the new server state.
"""

from __future__ import annotations

from typing import Annotated, Any, Optional

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


# Pydantic patch model so Gemini's strict JSON-schema validator can see
# every editable field. Using ``dict[str, Any]`` here produces a schema
# with ``additionalProperties: true`` which Gemini silently strips,
# leaving the LLM unable to pass any keys through — typed fields keep
# the contract.
class CourseEditPatch(BaseModel):
    """Editable fields on a Course. All optional; only present fields apply."""

    name: Optional[str] = Field(default=None, description="Display name shown to learners.")
    description: Optional[str] = Field(default=None, description="Short tagline (1–2 sentences).")
    about: Optional[str] = Field(default=None, description="Longer 'about this course' copy.")
    learnings: Optional[list[str]] = Field(default=None, description="Learner outcome bullets.")
    tags: Optional[list[str]] = Field(default=None, description="Free-form tag list.")
    language: Optional[str] = Field(default=None, description="ISO language code (en, fr, ...).")
    public: Optional[bool] = Field(default=None, description="Listed on the public catalog.")
    published: Optional[bool] = Field(default=None, description="Visible to enrolled learners.")
    open_to_contributors: Optional[bool] = Field(default=None, description="Allow non-author edits.")


def register(mcp: FastMCP, client: LearnHouseClient) -> None:

    # ---- Course edit ---------------------------------------------------

    @mcp.tool(
        name="propose_course_edit",
        description=(
            "Stage an edit to a course's metadata. Set only the fields you "
            "want to change; unset fields leave the current value untouched. "
            "Returns a preview the user must approve before changes apply."
        ),
        meta=tier_meta(TIER_EDIT),
    )
    async def propose_course_edit(
        course_uuid: str,
        patch: CourseEditPatch,
    ) -> dict:
        try:
            current = await client.get(f"/courses/{course_uuid}")
        except Exception as e:
            return from_upstream_http_error(e)
        clean = patch.model_dump(exclude_none=True)
        if not clean:
            return error("invalid_argument", "patch is empty; set at least one field.")
        summary = _summarize_course_patch(clean, current)
        return {
            "ok": True,
            "preview": {
                "kind": "course",
                "tier": TIER_EDIT,
                "target": {
                    "uuid": course_uuid,
                    "name": current.get("name", ""),
                },
                "mode": "edit",
                "summary": summary,
                "proposed": clean,
                "current": {k: current.get(k) for k in clean.keys()},
                "apply_tool_name": "apply_course_edit",
                "apply_payload": {"course_uuid": course_uuid, "patch": clean},
            },
        }

    @mcp.tool(
        name="apply_course_edit",
        description="Apply a previously-approved course edit. Internal — never call directly.",
        meta=tier_meta(TIER_EDIT, is_apply=True),
    )
    async def apply_course_edit(course_uuid: str, patch: dict[str, Any]) -> dict:
        # apply_* tools aren't LLM-visible (filtered by ToolProxy), so we
        # can keep dict here — the apply path is invoked server-side with
        # the typed payload we stored at propose time.
        try:
            updated = await client.put(f"/courses/{course_uuid}", json=patch)
        except Exception as e:
            return from_upstream_http_error(e)
        return {
            "ok": True,
            "target": {"uuid": course_uuid, "name": updated.get("name", "")},
        }

    # ---- Course create -------------------------------------------------

    @mcp.tool(
        name="propose_course_create",
        description=(
            "Stage a brand-new course. The user approves before it's created."
        ),
        meta=tier_meta(TIER_CREATE),
    )
    async def propose_course_create(
        name: Annotated[str, Field(min_length=1, max_length=200)],
        description: Annotated[str, Field(max_length=500)] = "",
        about: str | None = None,
        learnings: list[str] | None = None,
        topic: str | None = None,
    ) -> dict:
        proposed = {
            "name": name,
            "description": description or "",
            "about": about or description or "",
            "learnings": learnings or [],
        }
        return {
            "ok": True,
            "preview": {
                "kind": "course",
                "tier": TIER_CREATE,
                "target": {"uuid": "", "name": name},
                "mode": "create",
                "summary": f"Create course '{name}'.",
                "proposed": proposed,
                "current": None,
                "apply_tool_name": "apply_course_create",
                "apply_payload": proposed,
            },
        }

    @mcp.tool(
        name="apply_course_create",
        description="Apply a previously-approved course create. Internal.",
        meta=tier_meta(TIER_CREATE, is_apply=True),
    )
    async def apply_course_create(
        name: str, description: str = "", about: str | None = None,
        learnings: list[str] | None = None,
    ) -> dict:
        body: dict[str, Any] = {
            "name": name,
            "description": description,
            "about": about or description,
            "learnings": learnings or [],
            "public": False,
            "published": False,
        }
        try:
            created = await client.post("/courses/", json=body)
        except Exception as e:
            return from_upstream_http_error(e)
        return {
            "ok": True,
            "target": {"uuid": created.get("course_uuid", ""), "name": created.get("name", name)},
        }

    # ---- Course delete (destructive) -----------------------------------

    @mcp.tool(
        name="propose_course_delete",
        description=(
            "Stage a course deletion. Computes blast radius (chapters + "
            "activities removed) for the destructive confirm card."
        ),
        meta=tier_meta(TIER_DESTRUCTIVE),
    )
    async def propose_course_delete(course_uuid: str) -> dict:
        try:
            course = await client.get(f"/courses/{course_uuid}")
        except Exception as e:
            return from_upstream_http_error(e)
        try:
            chapters = await client.get(f"/chapters/meta/course_{course_uuid.removeprefix('course_')}")
        except Exception:
            chapters = []
        chap_count = len(chapters or [])
        act_count = sum(len((c or {}).get("activities") or []) for c in (chapters or []))
        name = course.get("name") or ""
        return {
            "ok": True,
            "preview": {
                "kind": "course",
                "tier": TIER_DESTRUCTIVE,
                "target": {"uuid": course_uuid, "name": name},
                "mode": "delete",
                "summary": f"Delete course '{name}'.",
                "proposed": {"delete": True},
                "current": {"name": name, "chapters": chap_count, "activities": act_count},
                "blast_radius": {"chapters": chap_count, "activities": act_count},
                "blast_radius_summary": (
                    f"Permanently removes {chap_count} chapter(s) and "
                    f"{act_count} activity(ies) along with all user progress."
                ),
                "action_label": f"Delete course '{name}'",
                "challenge_phrase": name,
                "apply_tool_name": "apply_course_delete",
                "apply_payload": {"course_uuid": course_uuid},
            },
        }

    @mcp.tool(
        name="apply_course_delete",
        description="Apply a previously-approved course delete. Internal.",
        meta=tier_meta(TIER_DESTRUCTIVE, is_apply=True),
    )
    async def apply_course_delete(
        course_uuid: str, confirmation_phrase: str | None = None
    ) -> dict:
        try:
            await client.delete(f"/courses/{course_uuid}")
        except Exception as e:
            return from_upstream_http_error(e)
        return {"ok": True, "target": {"uuid": course_uuid, "name": ""}}

    # ---- Reorder chapters ----------------------------------------------

    @mcp.tool(
        name="propose_reorder_chapters",
        description="Stage a chapter reordering for the course.",
        meta=tier_meta(TIER_EDIT),
    )
    async def propose_reorder_chapters(
        course_uuid: str,
        new_order: Annotated[
            list[int],
            Field(description="List of chapter IDs in their new display order."),
        ],
    ) -> dict:
        try:
            current_chapters = await client.get(f"/chapters/meta/course_{course_uuid.removeprefix('course_')}")
        except Exception as e:
            return from_upstream_http_error(e)
        current_order = [c.get("id") for c in (current_chapters or [])]
        return {
            "ok": True,
            "preview": {
                "kind": "course",
                "tier": TIER_EDIT,
                "target": {"uuid": course_uuid, "name": ""},
                "mode": "reorder_chapters",
                "summary": "Reorder chapters.",
                "proposed": {"new_order": new_order},
                "current": {"order": current_order},
                "apply_tool_name": "apply_reorder_chapters",
                "apply_payload": {"course_uuid": course_uuid, "new_order": new_order},
            },
        }

    @mcp.tool(
        name="apply_reorder_chapters",
        description="Apply a previously-approved chapter reorder. Internal.",
        meta=tier_meta(TIER_EDIT, is_apply=True),
    )
    async def apply_reorder_chapters(course_uuid: str, new_order: list[int]) -> dict:
        body = {
            "chapters_order_by_ids": [
                {"chapter_id": cid, "activities_order_by_ids": []} for cid in new_order
            ]
        }
        try:
            await client.put(f"/chapters/order/course/{course_uuid}", json=body)
        except Exception as e:
            return from_upstream_http_error(e)
        return {"ok": True, "target": {"uuid": course_uuid, "name": ""}}

    # ---- Structure suggestion (READ; output feeds propose_course_create) -

    @mcp.tool(
        name="suggest_course_structure",
        description=(
            "Draft a chapter/activity skeleton for a topic. Returns a tree "
            "the chat surface renders as a structure proposal card; the "
            "user can edit the tree and then approve it as a propose_course_create."
        ),
        meta=tier_meta("READ"),
    )
    async def suggest_course_structure(
        topic: Annotated[str, Field(min_length=1, max_length=200)],
        audience: str | None = None,
        chapters: Annotated[int, Field(ge=1, le=12)] = 5,
    ) -> dict:
        # The actual LLM-driven draft is generated server-side by the
        # pipeline (it has the planning model + system prompt). This MCP
        # tool only signals the intent and returns a stub tree the
        # pipeline can fill in by invoking generators.suggest_structure.
        return {
            "ok": True,
            "tree": {
                "topic": topic,
                "audience": audience,
                "chapter_count": chapters,
                "chapters": [],
            },
        }


# --- Local helpers ---------------------------------------------------------


def _summarize_course_patch(patch: dict[str, Any], current: dict[str, Any]) -> str:
    """One-sentence summary the preview card subtitles itself with."""
    keys = list(patch.keys())
    if "name" in patch:
        return f"Rename course from '{current.get('name','')}' to '{patch['name']}'."
    if "published" in patch and patch["published"] is not current.get("published"):
        return f"{'Publish' if patch['published'] else 'Unpublish'} the course."
    return "Update course " + ", ".join(keys) + "."
