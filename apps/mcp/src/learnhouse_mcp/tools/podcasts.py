from __future__ import annotations

from typing import Annotated

from mcp.server.fastmcp import FastMCP
from pydantic import Field

from ..client import LearnHouseClient


def register(mcp: FastMCP, client: LearnHouseClient) -> None:
    @mcp.tool(
        name="list_podcasts",
        description="List podcasts in the organization, paginated.",
    )
    async def list_podcasts(
        page: Annotated[int, Field(ge=1)] = 1,
        limit: Annotated[int, Field(ge=1, le=100)] = 20,
    ) -> list[dict]:
        return await client.get(
            f"/podcasts/org_slug/{client.org_slug}/page/{page}/limit/{limit}"
        )

    @mcp.tool(
        name="get_podcast",
        description="Retrieve a podcast by its UUID.",
    )
    async def get_podcast(podcast_uuid: str) -> dict:
        return await client.get(f"/podcasts/{podcast_uuid}")

    @mcp.tool(
        name="list_podcast_episodes",
        description=(
            "List every episode for a podcast. By default only published episodes "
            "are returned; set include_unpublished=True to include drafts."
        ),
    )
    async def list_podcast_episodes(
        podcast_uuid: str,
        include_unpublished: bool = False,
    ) -> list[dict]:
        return await client.get(
            f"/podcasts/{podcast_uuid}/episodes",
            params={"include_unpublished": str(include_unpublished).lower()},
        )

    @mcp.tool(
        name="create_podcast_episode",
        description=(
            "Create a new text-only episode (no audio file). The audio_file can be "
            "uploaded later via the LearnHouse UI. Use this for drafting an episode "
            "list from an outline."
        ),
    )
    async def create_podcast_episode(
        podcast_uuid: str,
        title: str,
        description: str | None = None,
        duration_seconds: int = 0,
        published: bool = False,
    ) -> dict:
        form = {
            "title": title,
            "description": description or "",
            "duration_seconds": str(duration_seconds),
            "published": str(published).lower(),
        }
        return await client.post_form(f"/podcasts/{podcast_uuid}/episodes", form)

    @mcp.tool(
        name="update_podcast_episode",
        description=(
            "Update a podcast episode by UUID. Only provided fields are changed. "
            "Cannot change audio_file or thumbnail here — use the LearnHouse UI for that."
        ),
    )
    async def update_podcast_episode(
        episode_uuid: str,
        title: str | None = None,
        description: str | None = None,
        duration_seconds: int | None = None,
        episode_number: int | None = None,
        published: bool | None = None,
        order: int | None = None,
    ) -> dict:
        payload = {
            k: v
            for k, v in {
                "title": title,
                "description": description,
                "duration_seconds": duration_seconds,
                "episode_number": episode_number,
                "published": published,
                "order": order,
            }.items()
            if v is not None
        }
        if not payload:
            raise ValueError("update_podcast_episode requires at least one field to change.")
        return await client.put(f"/podcasts/episodes/{episode_uuid}", json=payload)

    @mcp.tool(
        name="delete_podcast_episode",
        description="DESTRUCTIVE: delete a podcast episode by UUID. Confirm with the user before calling.",
    )
    async def delete_podcast_episode(episode_uuid: str) -> dict:
        return await client.delete(f"/podcasts/episodes/{episode_uuid}")
