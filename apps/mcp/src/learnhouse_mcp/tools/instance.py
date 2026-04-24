from __future__ import annotations

from mcp.server.fastmcp import FastMCP

from ..client import LearnHouseClient


def register(mcp: FastMCP, client: LearnHouseClient) -> None:
    @mcp.tool(
        name="get_instance_info",
        description=(
            "Return information about the LearnHouse instance this MCP server is "
            "connected to (site name, version, hosting mode, enabled features). "
            "Useful as a connectivity check."
        ),
    )
    async def get_instance_info() -> dict:
        return await client.get("/instance/info")

    @mcp.tool(
        name="get_plan_limits",
        description="Return the public plan tiers and their feature limits (courses, members, admin seats, AI credits).",
    )
    async def get_plan_limits() -> dict:
        return await client.get("/plans")
