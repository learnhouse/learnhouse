from __future__ import annotations

from typing import Annotated

from mcp.server.fastmcp import FastMCP
from pydantic import Field

from ..client import LearnHouseClient


def register(mcp: FastMCP, client: LearnHouseClient) -> None:
    @mcp.tool(
        name="search_organization",
        description=(
            "Run a single search across courses, collections, and users in the "
            "organization. Good default when the user says 'find X' without "
            "specifying a resource type."
        ),
    )
    async def search_organization(
        query: Annotated[str, Field(min_length=1, max_length=200)],
        page: Annotated[int, Field(ge=1)] = 1,
        limit: Annotated[int, Field(ge=1, le=50)] = 10,
    ) -> dict:
        return await client.get(
            f"/search/org_slug/{client.org_slug}",
            params={"query": query, "page": page, "limit": limit},
        )
