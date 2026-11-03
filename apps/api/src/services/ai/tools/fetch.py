"""fetch: open anything by its id.

One read for every kind of object, so an agent that found something with
search (or got an id from any result) does not have to pick the matching
get_ tool first. ChatGPT's research and company knowledge modes also expect a
`fetch(id)` next to `search`, returning {id, title, text, url, metadata}.

Each kind is answered by the tool that already reads it (get_course,
get_activity_content, get_discussion, ...), run through the same pipeline, so
the plan, scope, role and org checks of that tool apply unchanged.
"""

from __future__ import annotations

import json
from typing import Any

from fastapi import HTTPException
from pydantic import BaseModel, Field

from src.security.rbac import AccessAction
from src.services.ai.tools import refs, results
from src.services.ai.tools.base import ActionTier, ToolContext, ToolDenied, ToolSpec

TEXT_BUDGET = 30_000


class FetchParams(BaseModel):
    id: str = Field(
        ...,
        min_length=3,
        max_length=120,
        description="Any id from search or another result: course_..., chapter_..., activity_..., assignment_..., discussion_..., user_...",
    )


def _outline_text(chapters: list[dict]) -> str:
    # Headings, not numbers: chapter names often carry their own numbering.
    lines: list[str] = []
    for chapter in chapters:
        lines.append(f"## {chapter.get('name')} ({chapter.get('uuid')})")
        for activity in chapter.get("activities") or []:
            state = "" if activity.get("published", True) else " [draft]"
            lines.append(f"- {activity.get('name')} ({activity.get('uuid')}, {activity.get('type', 'page')}){state}")
        lines.append("")
    return "\n".join(lines).rstrip()


def _json_text(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False, indent=1, default=str)


async def _parent_uuid(ctx: ToolContext, kind: str, uuid: str) -> str:
    """The id of the object a chapter, task or comment belongs to."""
    row = await refs.load(ctx, kind, uuid)
    if kind == "chapter":
        from src.db.courses.courses import Course

        course = await ctx.db_session.get(Course, row.course_id)
        return course.course_uuid
    if kind == "assignment_task":
        from src.db.courses.assignments import Assignment

        return (await ctx.db_session.get(Assignment, row.assignment_id)).assignment_uuid
    from src.db.communities.discussions import Discussion

    return (await ctx.db_session.get(Discussion, row.discussion_id)).discussion_uuid


# kind -> (tool, argument name, extra arguments)
_READERS: dict[str, tuple[str, str, dict]] = {
    "course": ("get_course", "course_uuid", {}),
    "activity": ("get_activity_content", "activity_uuid", {"format": "markdown"}),
    "assignment": ("get_assignment", "assignment_uuid", {"include_task_contents": True}),
    "community": ("get_community", "community_uuid", {}),
    "discussion": ("get_discussion", "discussion_uuid", {}),
    "playground": ("get_playground", "playground_uuid", {}),
    "board": ("get_board", "board_uuid", {}),
    "folder": ("browse_library", "folder_uuid", {}),
    "usergroup": ("get_usergroup", "usergroup_uuid", {}),
    "role": ("get_role", "role_uuid", {}),
    "user": ("get_member", "member", {}),
    "path": ("get_path", "path_uuid", {}),
}
_VIA_PARENT = {"chapter": "course", "assignment_task": "assignment", "comment": "discussion"}


async def _fetch(ctx: ToolContext, p: FetchParams):
    from src.services.ai.tools import get_registry
    from src.services.ai.tools.registry import run_tool

    kind = refs.kind_of(p.id)
    if kind is None and "-" in p.id and len(p.id) == 36:
        kind = "playground"  # playgrounds made before prefixes have bare uuids
    target = p.id
    if kind in _VIA_PARENT:
        target = await _parent_uuid(ctx, kind, p.id)
        kind = _VIA_PARENT[kind]
    if kind not in _READERS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"fetch cannot open '{p.id}'. It opens course_, chapter_, activity_, assignment_, "
                "community_, discussion_, comment_, folder_, board_, playground, usergroup_, role_, "
                "path_ and user_ ids; find one with search."
            ),
        )
    tool, arg, extra = _READERS[kind]
    outcome = await run_tool(get_registry(), tool, {arg: target, **extra}, ctx)
    if outcome.status != "executed":
        # The reader's own refusal, code and all, so its hint still applies.
        raise ToolDenied(outcome.denied_code or "denied", outcome.reason or f"{tool} refused this id.")
    data = outcome.result if isinstance(outcome.result, dict) else {"result": outcome.result}

    # Some readers nest the object under its kind ({"discussion": {...}, "replies": [...]}).
    head = data.get(kind) if isinstance(data.get(kind), dict) else data
    title = head.get("name") or head.get("title") or data.get("name") or data.get("title")
    url = head.get("url") or data.get("url")
    metadata: dict[str, Any] = {"kind": kind, "read_with": tool}
    if kind == "course":
        chapters = data.get("chapters") or []
        if p.id != target:  # a chapter: only its part of the outline
            chapters = [c for c in chapters if c.get("uuid") == p.id]
            title = chapters[0].get("name") if chapters else title
            metadata.update(kind="chapter", course=refs.ref("course", target, data.get("name"), url))
        head = [f"# {title}"]
        if p.id == target and data.get("description"):
            head.append(str(data["description"]))
        text = "\n\n".join(head + [_outline_text(chapters)])
        metadata.update(results.pick(data, ("published", "public", "can_edit", "editor_url")))
    elif kind == "activity":
        activity = data.get("activity") or {}
        title, url = activity.get("name"), activity.get("url")
        text = data.get("markdown") or ""
        metadata.update(results.pick(data, ("version", "truncated", "guidance")))
        metadata["editor_url"] = activity.get("editor_url")
    else:
        text = _json_text({k: v for k, v in data.items() if k != "note"})
    if len(text) > TEXT_BUDGET:
        text = text[:TEXT_BUDGET] + "\n[cut here: read the rest with " + tool + "]"
        metadata["truncated"] = True
    out = {"id": p.id, "title": title, "url": url, "text": text, "metadata": metadata}
    if "note" in data:
        out["note"] = data["note"]  # member-written content stays marked as such
    return out


SPECS: list[ToolSpec] = [
    ToolSpec(
        name="fetch",
        title="Open by id",
        description=(
            "Open anything by its id (from search or any result) and get its readable text: a "
            "course or chapter outline, a page as Markdown, an assignment with its tasks, a "
            "discussion with replies, a learning path with its courses, a member's profile. Returns {id, title, url, text, metadata}."
        ),
        params_model=FetchParams,
        tier=ActionTier.READ,
        rights_bucket=None,
        access_action=AccessAction.READ,
        execute=_fetch,
        idempotent=True,
    ),
]
