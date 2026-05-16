"""High-level macro tools. Currently: `propose_course_structure`.

Lets the LLM propose a full chapter+activity tree for an existing course
in one shot. The API explodes the envelope into ordered service-layer
calls in a single transaction on apply.
"""

from mcp.server.fastmcp import FastMCP

from ..errors import AtlasToolError
from ..lh_client import LHClient
from ..markdown import markdown_to_tiptap
from ..schemas import ChapterPlan, ResourceRef
from ._common import envelope, first_text, parse_youtube_id


def register(mcp: FastMCP, lh: LHClient) -> None:
    @mcp.tool(
        description=(
            "Propose a full course structure (chapters with nested activities) "
            "for an existing course. All activities must be 'dynamic' (markdown) "
            "or 'video' (YouTube URL). Returns a single preview the user must "
            "approve to materialize the whole tree in one transaction."
        )
    )
    async def propose_course_structure(
        course_uuid: str, chapters: list[ChapterPlan]
    ) -> dict:
        if not chapters:
            raise AtlasToolError(
                "VALIDATION_ERROR",
                "At least one chapter is required.",
            )
        if len(chapters) > 30:
            raise AtlasToolError(
                "VALIDATION_ERROR",
                "Cap of 30 chapters per structure proposal.",
            )

        course = await lh.get(f"/courses/{course_uuid}")

        normalized_chapters: list[dict] = []
        total_activities = 0
        for ch in chapters:
            normalized_acts: list[dict] = []
            for act in ch.activities:
                if act.kind == "dynamic":
                    if not act.body_markdown:
                        raise AtlasToolError(
                            "VALIDATION_ERROR",
                            f"Activity '{act.name}' is dynamic but has no body_markdown.",
                        )
                    tiptap = markdown_to_tiptap(act.body_markdown)
                    normalized_acts.append(
                        {
                            "name": act.name,
                            "kind": "dynamic",
                            "body_markdown": act.body_markdown,
                            "content_preview": first_text(tiptap, 200),
                            "content_tiptap": tiptap,
                        }
                    )
                else:
                    if not act.youtube_url:
                        raise AtlasToolError(
                            "VALIDATION_ERROR",
                            f"Activity '{act.name}' is video but has no youtube_url.",
                        )
                    video_id = parse_youtube_id(act.youtube_url)
                    normalized_acts.append(
                        {
                            "name": act.name,
                            "kind": "video",
                            "youtube_url": act.youtube_url,
                            "youtube_id": video_id,
                        }
                    )
            total_activities += len(normalized_acts)
            normalized_chapters.append(
                {
                    "name": ch.name,
                    "description": ch.description,
                    "activities": normalized_acts,
                }
            )

        return envelope(
            tool="propose_course_structure",
            tier="CREATE",
            target=ResourceRef(
                kind="course",
                uuid=course_uuid,
                name=course.get("name", ""),
            ),
            mode="create",
            summary=(
                f"Propose structure for \"{course.get('name', '')}\": "
                f"{len(normalized_chapters)} chapters, {total_activities} activities"
            ),
            patch={
                "course_uuid": course_uuid,
                "chapters": normalized_chapters,
            },
        )
