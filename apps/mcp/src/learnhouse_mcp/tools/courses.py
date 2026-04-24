from __future__ import annotations

from typing import Annotated

from mcp.server.fastmcp import FastMCP
from pydantic import Field

from ..client import LearnHouseClient


def register(mcp: FastMCP, client: LearnHouseClient) -> None:
    @mcp.tool(
        name="list_courses",
        description=(
            "List courses in the organization, paginated. Results are sorted by "
            "creation_date DESC by default — the API does not expose a sort "
            "parameter, so for other orderings (e.g. by update_date, name) pull a "
            "page and sort client-side on the returned objects, which include "
            "course_uuid, name, description, creation_date, update_date, public, "
            "published, and thumbnail_image. By default only published public "
            "courses are returned; set include_unpublished=True to see drafts "
            "(caller must have update permission on the org)."
        ),
    )
    async def list_courses(
        page: Annotated[int, Field(ge=1, description="1-indexed page number")] = 1,
        limit: Annotated[int, Field(ge=1, le=100, description="Courses per page")] = 20,
        include_unpublished: bool = False,
    ) -> list[dict]:
        return await client.get(
            f"/courses/org_slug/{client.org_slug}/page/{page}/limit/{limit}",
            params={"include_unpublished": str(include_unpublished).lower()},
        )

    @mcp.tool(
        name="count_courses",
        description="Return the total number of courses in the organization.",
    )
    async def count_courses() -> int:
        return await client.get(f"/courses/org_slug/{client.org_slug}/count")

    @mcp.tool(
        name="search_courses",
        description=(
            "Full-text search courses in the organization by title and "
            "description. Returns paginated matches. Use this to find a "
            "course before fetching, editing, or deleting it.\n\n"
            "The search is exact-token; if the first query returns nothing, "
            "drop filler words and retry with the most distinctive token. "
            "Examples:\n"
            "- 'my dns course' → first try 'dns'\n"
            "- 'the python fundamentals one' → first try 'python'\n"
            "- 'aws course' → first try 'aws'\n"
            "If the user's exact phrase doesn't match anything, immediately "
            "retry with just the topic noun(s) — don't ask the user to "
            "rephrase. Stop words to drop: a / an / the / my / our / "
            "course / class / lesson / module / tutorial / training."
        ),
    )
    async def search_courses(
        query: Annotated[str, Field(min_length=1, max_length=200)],
        page: Annotated[int, Field(ge=1)] = 1,
        limit: Annotated[int, Field(ge=1, le=50)] = 10,
    ) -> list[dict]:
        return await client.get(
            f"/courses/org_slug/{client.org_slug}/search",
            params={"query": query, "page": page, "limit": limit},
        )

    @mcp.tool(
        name="get_course",
        description="Retrieve a single course by its UUID. Returns the course metadata only (not chapters/activities).",
    )
    async def get_course(course_uuid: str) -> dict:
        return await client.get(f"/courses/{course_uuid}")

    @mcp.tool(
        name="create_course",
        description=(
            "Create a new empty course in the caller's organization. Returns the "
            "created course including its UUID. The course starts with no "
            "chapters — use create_chapter / create_activity to add content. "
            "Thumbnail is not set via this tool; upload one through the UI."
        ),
    )
    async def create_course(
        name: Annotated[str, Field(min_length=1, max_length=200, description="Course title shown to learners.")],
        description: Annotated[str, Field(max_length=500, description="Short tagline, a sentence or two.")],
        about: Annotated[
            str | None,
            Field(
                description=(
                    "Longer 'about this course' copy shown on the course landing page. "
                    "If omitted, defaults to the `description` so the create call "
                    "doesn't fail on a required field — update the course afterwards "
                    "to add richer about copy."
                ),
            ),
        ] = None,
        learnings: str | None = None,
        tags: Annotated[
            str | None,
            Field(description="Comma-separated tags, e.g. 'python,data-science,beginner'."),
        ] = None,
        public: Annotated[
            bool,
            Field(description="True = discoverable on the public catalog. False = org-only."),
        ] = False,
    ) -> dict:
        form: dict[str, str] = {
            "name": name,
            "description": description,
            "about": about if about is not None else description,
            "public": "true" if public else "false",
            "thumbnail_type": "image",
        }
        if learnings is not None:
            form["learnings"] = learnings
        if tags is not None:
            form["tags"] = tags
        return await client.post_form(
            f"/courses/?org_id={client.org_id}",
            form=form,
        )

    @mcp.tool(
        name="describe_course",
        description=(
            "Return a compact, agent-friendly snapshot of a course: metadata, a "
            "flat list of chapters with activity counts and a per-activity row "
            "(id, uuid, name, activity_type, activity_sub_type, published), and "
            "the latest course updates. Use this as your one-call situational "
            "awareness before planning edits — replaces get_course + "
            "get_course_structure + list_course_updates. Prefer it over "
            "get_course_structure when you only need IDs and summaries."
        ),
    )
    async def describe_course(
        course_uuid: str,
        include_recent_updates: bool = True,
    ) -> dict:
        meta = await client.get(
            f"/courses/{course_uuid}/meta",
            params={"slim": "true", "with_unpublished_activities": "true"},
        )

        chapters_out: list[dict] = []
        total_activities = 0
        published_activities = 0
        for ch in meta.get("chapters") or []:
            acts = ch.get("activities") or []
            activity_rows: list[dict] = []
            for a in acts:
                published = bool(a.get("published"))
                total_activities += 1
                if published:
                    published_activities += 1
                activity_rows.append(
                    {
                        "id": a.get("id"),
                        "uuid": a.get("activity_uuid"),
                        "name": a.get("name"),
                        "activity_type": a.get("activity_type"),
                        "activity_sub_type": a.get("activity_sub_type"),
                        "published": published,
                    }
                )
            chapters_out.append(
                {
                    "id": ch.get("id"),
                    "name": ch.get("name"),
                    "description": ch.get("description"),
                    "activity_count": len(activity_rows),
                    "activities": activity_rows,
                }
            )

        result: dict = {
            "course": {
                "uuid": meta.get("course_uuid"),
                "id": meta.get("id"),
                "name": meta.get("name"),
                "description": meta.get("description"),
                "public": meta.get("public"),
                "published": meta.get("published"),
                "tags": meta.get("tags"),
                "thumbnail_image": meta.get("thumbnail_image"),
                "creation_date": meta.get("creation_date"),
                "update_date": meta.get("update_date"),
            },
            "chapters": chapters_out,
            "totals": {
                "chapters": len(chapters_out),
                "activities": total_activities,
                "published_activities": published_activities,
            },
        }

        if include_recent_updates:
            try:
                updates = await client.get(f"/courses/{course_uuid}/updates")
            except Exception:
                updates = None
            if isinstance(updates, list):
                result["recent_updates"] = [
                    {
                        "title": u.get("title"),
                        "content": (u.get("content") or "")[:400],
                        "creation_date": u.get("creation_date"),
                    }
                    for u in updates[:3]
                ]

        return result

    @mcp.tool(
        name="get_course_structure",
        description=(
            "Retrieve a course with its full structure: chapters and activities nested inside. "
            "Use slim=True to omit heavy activity content/details — best for navigation or "
            "getting a table of contents. Use slim=False when you need the actual content."
        ),
    )
    async def get_course_structure(
        course_uuid: str,
        slim: bool = True,
        with_unpublished_activities: bool = False,
    ) -> dict:
        return await client.get(
            f"/courses/{course_uuid}/meta",
            params={
                "slim": str(slim).lower(),
                "with_unpublished_activities": str(with_unpublished_activities).lower(),
            },
        )

    @mcp.tool(
        name="update_course",
        description=(
            "Update fields on an existing course by UUID. Pass only the fields you want "
            "to change; omitted fields are left untouched. Common fields: name, description, "
            "about, learnings, tags, public, published, open_to_contributors."
        ),
    )
    async def update_course(
        course_uuid: str,
        name: str | None = None,
        description: str | None = None,
        about: str | None = None,
        learnings: str | None = None,
        tags: str | None = None,
        public: bool | None = None,
        published: bool | None = None,
        open_to_contributors: bool | None = None,
    ) -> dict:
        payload = {
            k: v
            for k, v in {
                "name": name,
                "description": description,
                "about": about,
                "learnings": learnings,
                "tags": tags,
                "public": public,
                "published": published,
                "open_to_contributors": open_to_contributors,
            }.items()
            if v is not None
        }
        if not payload:
            raise ValueError("update_course requires at least one field to change.")
        return await client.put(f"/courses/{course_uuid}", json=payload)

    @mcp.tool(
        name="clone_course",
        description=(
            "Create a complete copy of an existing course including chapters, activities, "
            "blocks, and files. The clone gets a new UUID, '(Copy)' appended to its name, "
            "is private by default, and is owned by the caller."
        ),
    )
    async def clone_course(course_uuid: str) -> dict:
        return await client.post(f"/courses/{course_uuid}/clone")

    @mcp.tool(
        name="delete_course",
        description=(
            "DESTRUCTIVE: permanently delete a course and ALL of its chapters, activities, "
            "and uploaded files. This cannot be undone. Always confirm with the user before "
            "calling this tool."
        ),
    )
    async def delete_course(course_uuid: str) -> dict:
        return await client.delete(f"/courses/{course_uuid}")

    @mcp.tool(
        name="list_course_updates",
        description="List announcement-style 'updates' posted on a course (changelog entries, news for enrolled users).",
    )
    async def list_course_updates(course_uuid: str) -> list[dict]:
        return await client.get(f"/courses/{course_uuid}/updates")

    @mcp.tool(
        name="create_course_update",
        description="Post a new announcement/update on a course. Students will see it in the course updates feed.",
    )
    async def create_course_update(
        course_uuid: str,
        title: str,
        content: str,
    ) -> dict:
        return await client.post(
            f"/courses/{course_uuid}/updates",
            json={"title": title, "content": content, "org_id": client.org_id},
        )
