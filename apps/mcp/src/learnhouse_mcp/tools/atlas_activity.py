"""Atlas ACTIVITY tools: propose/apply for create, rename, body rewrite,
duplicate, publish-state, delete, plus a dynamic-activity quiz add.

Body rewrites accept markdown from the LLM and convert to Tiptap inside
the apply path so the preview can show before/after without storing
two formats. The optimistic-lock check (``expected_version`` →
``current_version``) lives in ``apply_activity_body_rewrite``.
"""

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
    markdown_to_tiptap,
    tier_meta,
)


class QuizChoice(BaseModel):
    """One answer choice on a quiz question."""

    text: str = Field(description="Answer text shown to the learner.")
    correct: bool = Field(default=False, description="Mark as the correct answer.")


class QuizQuestion(BaseModel):
    """One quiz question (single-select multiple choice)."""

    prompt: str = Field(description="The question text.")
    choices: list[QuizChoice] = Field(
        description="Answer choices; mark at least one with correct=true."
    )
    explanation: Optional[str] = Field(
        default=None, description="Optional rationale shown after the learner answers."
    )


def register(mcp: FastMCP, client: LearnHouseClient) -> None:

    # ---- Rename --------------------------------------------------------

    @mcp.tool(
        name="propose_activity_rename",
        description="Stage a rename of one activity.",
        meta=tier_meta(TIER_EDIT),
    )
    async def propose_activity_rename(activity_uuid: str, new_name: str) -> dict:
        try:
            activity = await client.get(f"/activities/{activity_uuid}")
        except Exception as e:
            return from_upstream_http_error(e)
        if not new_name or new_name.strip() == (activity.get("name") or "").strip():
            return error("invalid_argument", "new_name is empty or unchanged.")
        return {
            "ok": True,
            "preview": {
                "kind": "activity",
                "tier": TIER_EDIT,
                "target": {
                    "uuid": activity_uuid,
                    "name": activity.get("name", ""),
                    "parent_chapter_id": _parent_chapter_id(activity),
                },
                "mode": "rename",
                "summary": (
                    f"Rename activity from '{activity.get('name','')}' to '{new_name}'."
                ),
                "proposed": {
                    "name": new_name,
                    "activity_type": activity.get("activity_type"),
                    "activity_sub_type": activity.get("activity_sub_type"),
                    "content": activity.get("content"),
                },
                "current": {
                    "name": activity.get("name"),
                    "activity_type": activity.get("activity_type"),
                    "activity_sub_type": activity.get("activity_sub_type"),
                    "content": activity.get("content"),
                },
                "expected_version": activity.get("current_version"),
                "apply_tool_name": "apply_activity_rename",
                "apply_payload": {"activity_uuid": activity_uuid, "name": new_name},
            },
        }

    @mcp.tool(
        name="apply_activity_rename",
        description="Apply an approved rename. Internal.",
        meta=tier_meta(TIER_EDIT, is_apply=True),
    )
    async def apply_activity_rename(
        activity_uuid: str,
        name: str,
        expected_version: int | None = None,
        confirmation_phrase: str | None = None,
    ) -> dict:
        updated = await _update_activity(client, activity_uuid, {"name": name})
        if isinstance(updated, dict) and updated.get("ok") is False:
            return updated
        return {
            "ok": True,
            "target": {"uuid": activity_uuid, "name": updated.get("name", name)},
            "version_after": updated.get("current_version"),
            "undo_token": "rename",
        }

    # ---- Body rewrite --------------------------------------------------

    @mcp.tool(
        name="propose_activity_body_rewrite",
        description=(
            "Stage a rewrite of an activity's body. Supports dynamic "
            "(rich Tiptap) and assignment (markdown description) types. "
            "Provide the new content as markdown; the server converts to "
            "Tiptap for dynamic activities and stores it as markdown for "
            "assignments. mode='replace' overwrites; mode='append' adds "
            "to the end."
        ),
        meta=tier_meta(TIER_EDIT),
    )
    async def propose_activity_body_rewrite(
        activity_uuid: str,
        markdown: Annotated[str, Field(min_length=1)],
        mode: Literal["replace", "append"] = "replace",
        summary: Annotated[str, Field(max_length=200)] = "",
    ) -> dict:
        try:
            activity = await client.get(f"/activities/{activity_uuid}")
        except Exception as e:
            return from_upstream_http_error(e)

        a_type = activity.get("activity_type")
        a_sub = activity.get("activity_sub_type")

        if a_type == "TYPE_DYNAMIC" and a_sub == "SUBTYPE_DYNAMIC_PAGE":
            new_content = markdown_to_tiptap(markdown)
            if mode == "append" and isinstance(activity.get("content"), dict):
                current_doc = activity["content"]
                combined = {
                    "type": "doc",
                    "content": (current_doc.get("content") or []) + (new_content.get("content") or []),
                }
                new_content = combined
        elif a_type == "TYPE_ASSIGNMENT":
            existing = (activity.get("content") or {}).get("description") or ""
            body = markdown if mode == "replace" else (existing + "\n\n" + markdown)
            new_content = {"description": body}
        else:
            return error(
                "type_not_supported",
                f"Body rewrite is not supported for activity_type={a_type}.",
            )

        return {
            "ok": True,
            "preview": {
                "kind": "activity",
                "tier": TIER_EDIT,
                "target": {
                    "uuid": activity_uuid,
                    "name": activity.get("name", ""),
                    "parent_chapter_id": _parent_chapter_id(activity),
                },
                "mode": mode,
                "summary": summary or f"Rewrite body of '{activity.get('name','')}'.",
                "proposed": {
                    "name": activity.get("name"),
                    "activity_type": a_type,
                    "activity_sub_type": a_sub,
                    "content": new_content,
                },
                "current": {
                    "name": activity.get("name"),
                    "activity_type": a_type,
                    "activity_sub_type": a_sub,
                    "content": activity.get("content"),
                },
                "expected_version": activity.get("current_version"),
                "apply_tool_name": "apply_activity_body_rewrite",
                "apply_payload": {
                    "activity_uuid": activity_uuid,
                    "content": new_content,
                },
            },
        }

    @mcp.tool(
        name="apply_activity_body_rewrite",
        description="Apply an approved body rewrite. Internal.",
        meta=tier_meta(TIER_EDIT, is_apply=True),
    )
    async def apply_activity_body_rewrite(
        activity_uuid: str,
        content: dict[str, Any],
        expected_version: int | None = None,
        confirmation_phrase: str | None = None,
    ) -> dict:
        if expected_version is not None:
            try:
                state = await client.get(f"/activities/{activity_uuid}/state")
            except Exception as e:
                return from_upstream_http_error(e)
            if int(state.get("current_version", 0)) != int(expected_version):
                return error(
                    "stale_version",
                    "Activity was edited elsewhere; refresh and try again.",
                    current_version=state.get("current_version"),
                    expected=expected_version,
                )
        updated = await _update_activity(client, activity_uuid, {"content": content})
        if isinstance(updated, dict) and updated.get("ok") is False:
            return updated
        return {
            "ok": True,
            "target": {"uuid": activity_uuid, "name": updated.get("name", "")},
            "version_after": updated.get("current_version"),
            "undo_token": None,
        }

    # ---- Create --------------------------------------------------------

    @mcp.tool(
        name="propose_activity_create",
        description=(
            "Stage a new activity in a chapter. activity_type must be one "
            "of: dynamic, video, document, assignment. Use propose_activity_"
            "body_rewrite after apply to fill in the body."
        ),
        meta=tier_meta(TIER_CREATE),
    )
    async def propose_activity_create(
        chapter_uuid: str,
        name: str,
        activity_type: Literal["dynamic", "video", "document", "assignment"],
        position: int | None = None,
        initial_brief: str | None = None,
    ) -> dict:
        try:
            chapter = await client.get(f"/chapters/{chapter_uuid}")
        except Exception as e:
            return from_upstream_http_error(e)
        type_map = {
            "dynamic": ("TYPE_DYNAMIC", "SUBTYPE_DYNAMIC_PAGE"),
            "video":   ("TYPE_VIDEO", "SUBTYPE_VIDEO_YOUTUBE"),
            "document":("TYPE_DOCUMENT", "SUBTYPE_DOCUMENT_PDF"),
            "assignment":("TYPE_ASSIGNMENT", "SUBTYPE_ASSIGNMENT_ANY"),
        }
        a_type, a_sub = type_map[activity_type]
        return {
            "ok": True,
            "preview": {
                "kind": "activity",
                "tier": TIER_CREATE,
                "target": {
                    "uuid": "",
                    "name": name,
                    "parent_chapter_id": chapter.get("id"),
                },
                "mode": "create",
                "summary": f"Add {activity_type} activity '{name}' to '{chapter.get('name','')}'.",
                "proposed": {
                    "name": name,
                    "activity_type": a_type,
                    "activity_sub_type": a_sub,
                    "content": {"description": initial_brief} if a_type == "TYPE_ASSIGNMENT" and initial_brief else {},
                },
                "current": None,
                "apply_tool_name": "apply_activity_create",
                "apply_payload": {
                    "chapter_uuid": chapter_uuid,
                    "name": name,
                    "activity_type": activity_type,
                    "position": position,
                    "initial_brief": initial_brief,
                },
            },
        }

    @mcp.tool(
        name="apply_activity_create",
        description="Apply an approved activity create. Internal.",
        meta=tier_meta(TIER_CREATE, is_apply=True),
    )
    async def apply_activity_create(
        chapter_uuid: str,
        name: str,
        activity_type: Literal["dynamic", "video", "document", "assignment"],
        position: int | None = None,
        initial_brief: str | None = None,
        confirmation_phrase: str | None = None,
    ) -> dict:
        try:
            chapter = await client.get(f"/chapters/{chapter_uuid}")
        except Exception as e:
            return from_upstream_http_error(e)
        type_map = {
            "dynamic": ("TYPE_DYNAMIC", "SUBTYPE_DYNAMIC_PAGE", {}),
            "video":   ("TYPE_VIDEO", "SUBTYPE_VIDEO_YOUTUBE", {}),
            "document":("TYPE_DOCUMENT", "SUBTYPE_DOCUMENT_PDF", {}),
            "assignment":("TYPE_ASSIGNMENT", "SUBTYPE_ASSIGNMENT_ANY",
                          {"description": initial_brief or ""}),
        }
        a_type, a_sub, content = type_map[activity_type]
        body = {
            "name": name,
            "activity_type": a_type,
            "activity_sub_type": a_sub,
            "content": content,
            "chapter_id": chapter.get("id"),
            "course_id": chapter.get("course_id"),
            "org_id": chapter.get("org_id"),
            "published": False,
        }
        try:
            created = await client.post("/activities/", json=body)
        except Exception as e:
            return from_upstream_http_error(e)
        return {
            "ok": True,
            "target": {
                "uuid": created.get("activity_uuid", ""),
                "name": created.get("name", name),
                "parent_chapter_id": chapter.get("id"),
            },
            "version_after": created.get("current_version"),
        }

    # ---- Delete (destructive) ------------------------------------------

    @mcp.tool(
        name="propose_activity_delete",
        description="Stage an activity deletion.",
        meta=tier_meta(TIER_DESTRUCTIVE),
    )
    async def propose_activity_delete(activity_uuid: str) -> dict:
        try:
            activity = await client.get(f"/activities/{activity_uuid}")
        except Exception as e:
            return from_upstream_http_error(e)
        name = activity.get("name") or ""
        return {
            "ok": True,
            "preview": {
                "kind": "activity",
                "tier": TIER_DESTRUCTIVE,
                "target": {
                    "uuid": activity_uuid,
                    "name": name,
                    "parent_chapter_id": _parent_chapter_id(activity),
                },
                "mode": "delete",
                "summary": f"Delete activity '{name}'.",
                "proposed": {"delete": True},
                "current": {
                    "name": name,
                    "activity_type": activity.get("activity_type"),
                    "activity_sub_type": activity.get("activity_sub_type"),
                    "content": activity.get("content"),
                },
                "blast_radius": {"versions": activity.get("current_version", 0)},
                "blast_radius_summary": (
                    "Removes the activity and all its version history."
                ),
                "action_label": f"Delete activity '{name}'",
                "challenge_phrase": name,
                "apply_tool_name": "apply_activity_delete",
                "apply_payload": {"activity_uuid": activity_uuid},
            },
        }

    @mcp.tool(
        name="apply_activity_delete",
        description="Apply an approved activity delete. Internal.",
        meta=tier_meta(TIER_DESTRUCTIVE, is_apply=True),
    )
    async def apply_activity_delete(
        activity_uuid: str, confirmation_phrase: str | None = None
    ) -> dict:
        try:
            await client.delete(f"/activities/{activity_uuid}")
        except Exception as e:
            return from_upstream_http_error(e)
        return {"ok": True, "target": {"uuid": activity_uuid, "name": ""}}

    # ---- Duplicate -----------------------------------------------------

    @mcp.tool(
        name="propose_activity_duplicate",
        description="Stage duplicating an activity into the same or another chapter.",
        meta=tier_meta(TIER_CREATE),
    )
    async def propose_activity_duplicate(
        activity_uuid: str,
        target_chapter_uuid: str | None = None,
        new_name: str | None = None,
    ) -> dict:
        try:
            activity = await client.get(f"/activities/{activity_uuid}")
        except Exception as e:
            return from_upstream_http_error(e)
        proposed_name = new_name or f"{activity.get('name','')} (Copy)"
        return {
            "ok": True,
            "preview": {
                "kind": "activity",
                "tier": TIER_CREATE,
                "target": {"uuid": "", "name": proposed_name},
                "mode": "duplicate",
                "summary": f"Duplicate '{activity.get('name','')}' as '{proposed_name}'.",
                "proposed": {
                    "name": proposed_name,
                    "activity_type": activity.get("activity_type"),
                    "activity_sub_type": activity.get("activity_sub_type"),
                    "content": activity.get("content"),
                },
                "current": {"name": activity.get("name"), "content": activity.get("content")},
                "apply_tool_name": "apply_activity_duplicate",
                "apply_payload": {
                    "source_uuid": activity_uuid,
                    "target_chapter_uuid": target_chapter_uuid,
                    "new_name": proposed_name,
                },
            },
        }

    @mcp.tool(
        name="apply_activity_duplicate",
        description="Apply an approved duplicate. Internal.",
        meta=tier_meta(TIER_CREATE, is_apply=True),
    )
    async def apply_activity_duplicate(
        source_uuid: str,
        target_chapter_uuid: str | None = None,
        new_name: str | None = None,
        confirmation_phrase: str | None = None,
    ) -> dict:
        try:
            source = await client.get(f"/activities/{source_uuid}")
        except Exception as e:
            return from_upstream_http_error(e)
        chap_uuid = target_chapter_uuid
        if not chap_uuid:
            # Find the source chapter via /chapters lookup using its id
            chap_id = _parent_chapter_id(source)
            if chap_id is None:
                return error("not_found", "Could not determine source chapter for duplicate.")
            body = {
                "name": new_name or f"{source.get('name','')} (Copy)",
                "activity_type": source.get("activity_type"),
                "activity_sub_type": source.get("activity_sub_type"),
                "content": source.get("content"),
                "chapter_id": chap_id,
                "course_id": source.get("course_id"),
                "org_id": source.get("org_id"),
                "published": False,
            }
        else:
            try:
                target = await client.get(f"/chapters/{chap_uuid}")
            except Exception as e:
                return from_upstream_http_error(e)
            body = {
                "name": new_name or f"{source.get('name','')} (Copy)",
                "activity_type": source.get("activity_type"),
                "activity_sub_type": source.get("activity_sub_type"),
                "content": source.get("content"),
                "chapter_id": target.get("id"),
                "course_id": target.get("course_id"),
                "org_id": target.get("org_id"),
                "published": False,
            }
        try:
            created = await client.post("/activities/", json=body)
        except Exception as e:
            return from_upstream_http_error(e)
        return {
            "ok": True,
            "target": {
                "uuid": created.get("activity_uuid", ""),
                "name": created.get("name", body["name"]),
            },
        }

    # ---- Publish / unpublish (destructive) -----------------------------

    @mcp.tool(
        name="propose_activity_publish",
        description="Stage a bulk publish/unpublish for one or more activities.",
        meta=tier_meta(TIER_DESTRUCTIVE),
    )
    async def propose_activity_publish(
        activity_uuids: list[str], published: bool
    ) -> dict:
        if not activity_uuids:
            return error("invalid_argument", "activity_uuids is empty.")
        names: list[str] = []
        for u in activity_uuids[:5]:
            try:
                a = await client.get(f"/activities/{u}")
                names.append(a.get("name") or u)
            except Exception:
                names.append(u)
        verb = "Publish" if published else "Unpublish"
        return {
            "ok": True,
            "preview": {
                "kind": "activity",
                "tier": TIER_DESTRUCTIVE,
                "target": {
                    "uuid": activity_uuids[0],
                    "name": names[0] if names else "",
                },
                "mode": "publish",
                "summary": f"{verb} {len(activity_uuids)} activity(ies).",
                "proposed": {"published": published, "activity_uuids": activity_uuids},
                "current": {"sample_names": names},
                "blast_radius": {"count": len(activity_uuids), "published": published},
                "blast_radius_summary": (
                    f"Changes the publication state of {len(activity_uuids)} "
                    f"activity(ies). {'Visible to learners' if published else 'Hidden from learners'}."
                ),
                "action_label": f"{verb} {len(activity_uuids)} activity(ies)",
                "challenge_phrase": f"{verb.lower()} {len(activity_uuids)}",
                "apply_tool_name": "apply_activity_publish",
                "apply_payload": {"activity_uuids": activity_uuids, "published": published},
            },
        }

    @mcp.tool(
        name="apply_activity_publish",
        description="Apply an approved bulk publish toggle. Internal.",
        meta=tier_meta(TIER_DESTRUCTIVE, is_apply=True),
    )
    async def apply_activity_publish(
        activity_uuids: list[str],
        published: bool,
        confirmation_phrase: str | None = None,
    ) -> dict:
        for u in activity_uuids:
            try:
                await client.put(f"/activities/{u}", json={"published": published})
            except Exception as e:
                return from_upstream_http_error(e)
        return {
            "ok": True,
            "target": {"uuid": activity_uuids[0] if activity_uuids else "", "name": ""},
        }

    # ---- Quiz add (dynamic activities only) ----------------------------

    @mcp.tool(
        name="propose_quiz_add",
        description=(
            "Stage adding a quiz block to a dynamic activity. questions "
            "is a list of objects: {prompt, choices:[{text,correct}], "
            "explanation?}."
        ),
        meta=tier_meta(TIER_CREATE),
    )
    async def propose_quiz_add(
        activity_uuid: str, questions: list[QuizQuestion]
    ) -> dict:
        if not questions:
            return error("invalid_argument", "questions is empty.")
        try:
            activity = await client.get(f"/activities/{activity_uuid}")
        except Exception as e:
            return from_upstream_http_error(e)
        if activity.get("activity_type") != "TYPE_DYNAMIC":
            return error(
                "type_not_supported",
                "Quiz add is only supported for dynamic activities.",
            )
        # Convert typed questions back to plain dicts for the Tiptap node
        # attrs payload (and for the apply call which re-uses the dict).
        questions_payload = [q.model_dump(exclude_none=True) for q in questions]
        quiz_node = _build_quiz_node(questions_payload)
        current_doc = activity.get("content") or {"type": "doc", "content": []}
        new_doc = {
            "type": "doc",
            "content": (current_doc.get("content") or []) + [quiz_node],
        }
        return {
            "ok": True,
            "preview": {
                "kind": "activity",
                "tier": TIER_CREATE,
                "target": {
                    "uuid": activity_uuid,
                    "name": activity.get("name", ""),
                    "parent_chapter_id": _parent_chapter_id(activity),
                },
                "mode": "append",
                "summary": f"Append a {len(questions)}-question quiz to '{activity.get('name','')}'.",
                "proposed": {
                    "name": activity.get("name"),
                    "activity_type": activity.get("activity_type"),
                    "activity_sub_type": activity.get("activity_sub_type"),
                    "content": new_doc,
                },
                "current": {
                    "name": activity.get("name"),
                    "content": current_doc,
                },
                "expected_version": activity.get("current_version"),
                "apply_tool_name": "apply_quiz_add",
                "apply_payload": {"activity_uuid": activity_uuid, "content": new_doc},
            },
        }

    @mcp.tool(
        name="apply_quiz_add",
        description="Apply an approved quiz add. Internal.",
        meta=tier_meta(TIER_CREATE, is_apply=True),
    )
    async def apply_quiz_add(
        activity_uuid: str,
        content: dict[str, Any],
        expected_version: int | None = None,
        confirmation_phrase: str | None = None,
    ) -> dict:
        if expected_version is not None:
            try:
                state = await client.get(f"/activities/{activity_uuid}/state")
            except Exception as e:
                return from_upstream_http_error(e)
            if int(state.get("current_version", 0)) != int(expected_version):
                return error("stale_version", "Activity was edited elsewhere.")
        updated = await _update_activity(client, activity_uuid, {"content": content})
        if isinstance(updated, dict) and updated.get("ok") is False:
            return updated
        return {
            "ok": True,
            "target": {"uuid": activity_uuid, "name": updated.get("name", "")},
            "version_after": updated.get("current_version"),
        }


# --- helpers ---------------------------------------------------------------


async def _update_activity(
    client: LearnHouseClient, activity_uuid: str, patch: dict[str, Any]
) -> dict:
    try:
        return await client.put(f"/activities/{activity_uuid}", json=patch)
    except Exception as e:
        return from_upstream_http_error(e)


def _parent_chapter_id(activity: dict[str, Any]) -> int | None:
    """Pull the parent chapter id off an activity payload (varies by endpoint)."""
    if not isinstance(activity, dict):
        return None
    for k in ("chapter_id", "parent_chapter_id"):
        if activity.get(k) is not None:
            try:
                return int(activity[k])
            except Exception:
                return None
    return None


def _build_quiz_node(questions: list[dict[str, Any]]) -> dict[str, Any]:
    """Render a list of question dicts into a Tiptap blockQuiz node.

    The frontend's quiz block reads ``attrs.questions`` so we keep the
    quiz content as a single attrs payload rather than nested children;
    that's the shape ``BlockQuiz`` already renders.
    """
    return {
        "type": "blockQuiz",
        "attrs": {"questions": questions},
    }
