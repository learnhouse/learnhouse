"""Propose-create / propose-update tools.

Each returns a `PreviewEnvelope`-shaped dict. The API persists the envelope
as a pending edit and emits a `preview.{kind}` SSE event. **No mutation
happens here** — the LH API is only read (for current-state snapshots).
"""

from mcp.server.fastmcp import FastMCP

from .. import auth
from ..errors import AtlasToolError
from ..lh_client import LHClient
from ..markdown import markdown_to_tiptap
from ..schemas import (
    ActivityKind,
    ActivityPatch,
    ChapterPatch,
    CoursePatch,
    ResourceRef,
)
from ._common import diff_keys, envelope, first_text, parse_youtube_id


def register(mcp: FastMCP, lh: LHClient) -> None:
    # ─── COURSE ──────────────────────────────────────────────────────────

    @mcp.tool(
        description=(
            "Propose creating a new course in the current organization. Returns "
            "a preview the user must approve. Does NOT create the course."
        )
    )
    async def propose_create_course(
        name: str, description: str = "", public: bool = False
    ) -> dict:
        if not name or not name.strip():
            raise AtlasToolError("VALIDATION_ERROR", "Course name is required.")
        org_id = auth.get_org_id()
        patch = {
            "name": name.strip()[:200],
            "description": description.strip()[:1000],
            "public": public,
            "org_id": org_id,
        }
        return envelope(
            tool="propose_create_course",
            tier="CREATE",
            target=ResourceRef(kind="course", uuid="", name=patch["name"]),
            mode="create",
            summary=f"Create course \"{patch['name']}\"",
            patch=patch,
        )

    @mcp.tool(
        description=(
            "Propose updating an existing course's metadata. Only the fields "
            "you set are changed; all other fields stay as-is. Returns a "
            "preview the user must approve."
        )
    )
    async def propose_update_course(course_uuid: str, patch: CoursePatch) -> dict:
        clean = patch.model_dump(exclude_none=True)
        if not clean:
            raise AtlasToolError(
                "VALIDATION_ERROR",
                "At least one field is required to update a course.",
            )
        current = await lh.get(f"/courses/{course_uuid}")
        changed = diff_keys(clean)
        mode = "rename" if changed == ["name"] else "edit"
        summary = (
            f"Rename course to \"{clean['name']}\""
            if mode == "rename"
            else f"Update course ({', '.join(changed)})"
        )
        return envelope(
            tool="propose_update_course",
            tier="EDIT",
            target=ResourceRef(
                kind="course",
                uuid=course_uuid,
                name=current.get("name", ""),
            ),
            mode=mode,
            summary=summary,
            patch=clean,
            current={k: current.get(k) for k in clean},
        )

    # ─── CHAPTER ─────────────────────────────────────────────────────────

    @mcp.tool(
        description=(
            "Propose adding a new chapter to an existing course. Returns a "
            "preview the user must approve."
        )
    )
    async def propose_create_chapter(
        course_uuid: str, name: str, description: str = ""
    ) -> dict:
        if not name or not name.strip():
            raise AtlasToolError("VALIDATION_ERROR", "Chapter name is required.")
        # Snapshot the parent course so the preview has context.
        course = await lh.get(f"/courses/{course_uuid}")
        patch = {
            "name": name.strip()[:200],
            "description": description.strip()[:1000],
            "course_id": course.get("id"),
        }
        return envelope(
            tool="propose_create_chapter",
            tier="CREATE",
            target=ResourceRef(
                kind="chapter",
                uuid="",
                name=patch["name"],
                parent_course_uuid=course_uuid,
            ),
            mode="create",
            summary=f"Add chapter \"{patch['name']}\" to {course.get('name', 'course')}",
            patch=patch,
        )

    @mcp.tool(
        description="Propose updating a chapter's name or description."
    )
    async def propose_update_chapter(chapter_id: int, patch: ChapterPatch) -> dict:
        clean = patch.model_dump(exclude_none=True)
        if not clean:
            raise AtlasToolError(
                "VALIDATION_ERROR",
                "At least one field is required to update a chapter.",
            )
        current = await lh.get(f"/chapters/{chapter_id}")
        changed = diff_keys(clean)
        mode = "rename" if changed == ["name"] else "edit"
        summary = (
            f"Rename chapter to \"{clean['name']}\""
            if mode == "rename"
            else f"Update chapter ({', '.join(changed)})"
        )
        return envelope(
            tool="propose_update_chapter",
            tier="EDIT",
            target=ResourceRef(
                kind="chapter",
                uuid=str(chapter_id),
                name=current.get("name", ""),
            ),
            mode=mode,
            summary=summary,
            patch=clean,
            current={k: current.get(k) for k in clean},
        )

    # ─── ACTIVITY ────────────────────────────────────────────────────────

    @mcp.tool(
        description=(
            "Propose creating a new activity in an existing chapter. Supported "
            "kinds: 'dynamic' (rich markdown lesson) and 'video' (YouTube URL). "
            "Returns a preview the user must approve."
        )
    )
    async def propose_create_activity(
        chapter_id: int,
        name: str,
        kind: ActivityKind,
        body_markdown: str | None = None,
        youtube_url: str | None = None,
        published: bool = False,
    ) -> dict:
        if not name or not name.strip():
            raise AtlasToolError("VALIDATION_ERROR", "Activity name is required.")
        if kind == "dynamic" and not body_markdown:
            raise AtlasToolError(
                "VALIDATION_ERROR",
                "body_markdown is required for dynamic activities.",
            )
        if kind == "video" and not youtube_url:
            raise AtlasToolError(
                "VALIDATION_ERROR",
                "youtube_url is required for video activities.",
            )

        chapter = await lh.get(f"/chapters/{chapter_id}")

        proposed: dict
        if kind == "dynamic":
            tiptap = markdown_to_tiptap(body_markdown or "")
            proposed = {
                "activity_type": "TYPE_DYNAMIC",
                "activity_sub_type": "SUBTYPE_DYNAMIC_PAGE",
                "name": name.strip()[:200],
                "published": published,
                "body_markdown": body_markdown,
                "content_preview": first_text(tiptap, 240),
                "content_tiptap": tiptap,
            }
        else:
            video_id = parse_youtube_id(youtube_url or "")
            proposed = {
                "activity_type": "TYPE_VIDEO",
                "activity_sub_type": "SUBTYPE_VIDEO_YOUTUBE",
                "name": name.strip()[:200],
                "published": published,
                "youtube_url": youtube_url,
                "youtube_id": video_id,
            }

        return envelope(
            tool="propose_create_activity",
            tier="CREATE",
            target=ResourceRef(
                kind="activity",
                uuid="",
                name=proposed["name"],
                parent_course_uuid=chapter.get("course_uuid"),
                parent_chapter_id=chapter_id,
            ),
            mode="create",
            summary=f"Create {kind} activity \"{proposed['name']}\"",
            proposed=proposed,
        )

    @mcp.tool(
        description=(
            "Propose updating an existing activity. For dynamic activities, "
            "pass `body_markdown` to replace the lesson content. For videos, "
            "pass `youtube_url`. Returns a preview the user must approve."
        )
    )
    async def propose_update_activity(
        activity_uuid: str,
        name: str | None = None,
        body_markdown: str | None = None,
        youtube_url: str | None = None,
        published: bool | None = None,
    ) -> dict:
        ActivityPatch(  # validate
            name=name,
            body_markdown=body_markdown,
            youtube_url=youtube_url,
            published=published,
        )
        if not any(v is not None for v in (name, body_markdown, youtube_url, published)):
            raise AtlasToolError(
                "VALIDATION_ERROR",
                "At least one field is required to update an activity.",
            )

        current = await lh.get(f"/activities/{activity_uuid}")
        sub_type = current.get("activity_sub_type")

        proposed: dict = {}
        if name is not None:
            proposed["name"] = name.strip()[:200]
        if published is not None:
            proposed["published"] = published

        if body_markdown is not None:
            if sub_type != "SUBTYPE_DYNAMIC_PAGE":
                raise AtlasToolError(
                    "VALIDATION_ERROR",
                    "body_markdown can only be set on dynamic activities.",
                )
            tiptap = markdown_to_tiptap(body_markdown)
            proposed["body_markdown"] = body_markdown
            proposed["content_preview"] = first_text(tiptap, 240)
            proposed["content_tiptap"] = tiptap

        if youtube_url is not None:
            if sub_type != "SUBTYPE_VIDEO_YOUTUBE":
                raise AtlasToolError(
                    "VALIDATION_ERROR",
                    "youtube_url can only be set on YouTube video activities.",
                )
            proposed["youtube_id"] = parse_youtube_id(youtube_url)
            proposed["youtube_url"] = youtube_url

        changed = list(proposed.keys())
        mode = "rename" if changed == ["name"] else "replace" if "content_tiptap" in changed else "edit"
        return envelope(
            tool="propose_update_activity",
            tier="EDIT",
            target=ResourceRef(
                kind="activity",
                uuid=activity_uuid,
                name=current.get("name", ""),
            ),
            mode=mode,
            summary=f"Update activity \"{current.get('name', '')}\" ({', '.join(changed)})",
            proposed=proposed,
            current={
                "name": current.get("name"),
                "published": current.get("published"),
                "content": current.get("content"),
            },
            expected_version=current.get("current_version"),
        )
