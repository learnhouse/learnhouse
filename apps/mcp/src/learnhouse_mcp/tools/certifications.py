from __future__ import annotations

from mcp.server.fastmcp import FastMCP

from ..client import LearnHouseClient


def register(mcp: FastMCP, client: LearnHouseClient) -> None:
    @mcp.tool(
        name="list_course_certifications",
        description="List the certification definitions attached to a course (by course UUID).",
    )
    async def list_course_certifications(course_uuid: str) -> list[dict]:
        return await client.get(f"/certifications/course/{course_uuid}")

    @mcp.tool(
        name="get_certification",
        description="Get a certification definition by UUID.",
    )
    async def get_certification(certification_uuid: str) -> dict:
        return await client.get(f"/certifications/{certification_uuid}")

    @mcp.tool(
        name="create_certification",
        description=(
            "Create a certification definition for a course. The `config` dict holds "
            "the certificate template configuration (title, signatories, layout); "
            "pass an empty dict to start from defaults and customise later."
        ),
    )
    async def create_certification(course_id: int, config: dict | None = None) -> dict:
        body = {"course_id": course_id, "config": config or {}}
        return await client.post("/certifications/", json=body)

    @mcp.tool(
        name="update_certification",
        description="Update a certification's config by UUID.",
    )
    async def update_certification(certification_uuid: str, config: dict) -> dict:
        return await client.put(
            f"/certifications/{certification_uuid}", json={"config": config}
        )

    @mcp.tool(
        name="delete_certification",
        description="DESTRUCTIVE: delete a certification definition by UUID. Confirm before calling.",
    )
    async def delete_certification(certification_uuid: str) -> dict:
        return await client.delete(f"/certifications/{certification_uuid}")

    @mcp.tool(
        name="list_user_certifications",
        description="List every certification earned by the authenticated user.",
    )
    async def list_user_certifications() -> list[dict]:
        return await client.get("/certifications/user/all")
