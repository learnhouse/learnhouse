"""Resources and argument completion for the MCP server.

Every resource is answered by a read tool, run through the same pipeline as
a tool call, so a resource never shows what the member could not read with
the tool. Adding a resource is one `ResourceDef`: its URI, the tool that
reads it, and which listing (if any) names concrete ones in resources/list.

Completion suggests values for prompt arguments (names, as the user would
say them) and resource template arguments (ids), from what the member can
see: the same search and list tools an agent would use.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

# A URI is learnhouse://<kind> or learnhouse://<kind>/<id>.
URI = re.compile(r"^learnhouse://(?P<kind>[a-z_]{2,40})(?:/(?P<id>[A-Za-z0-9_-]{1,100}))?$")


@dataclass(frozen=True)
class ResourceDef:
    kind: str
    # Read tool answering the resource, and the argument the id goes in
    # (None for a resource without an id, like the organization).
    tool: str
    arg: str | None
    title: str
    description: str
    extra_args: dict[str, Any] = field(default_factory=dict)
    # List tool naming concrete resources in resources/list: (tool, args).
    listed_by: tuple[str, dict[str, Any]] | None = None
    # Search kind used to complete the template's id argument.
    search_kind: str | None = None

    @property
    def template(self) -> str | None:
        return f"learnhouse://{self.kind}/{{{self.arg}}}" if self.arg else None

    def uri(self, ident: str | None = None) -> str:
        return f"learnhouse://{self.kind}/{ident}" if ident else f"learnhouse://{self.kind}"

    def tool_args(self, ident: str | None) -> dict[str, Any]:
        return {**({self.arg: ident} if self.arg else {}), **self.extra_args}


RESOURCES: dict[str, ResourceDef] = {
    r.kind: r
    for r in (
        ResourceDef(
            kind="org",
            tool="get_context",
            arg=None,
            title="Organization overview",
            description="The organization, your role, its plan features and link formats.",
        ),
        ResourceDef(
            kind="course",
            tool="get_course",
            arg="course_uuid",
            title="Course structure",
            description="A course's chapters and activities, in order.",
            listed_by=("list_courses", {"limit": 50}),
            search_kind="course",
        ),
        ResourceDef(
            kind="activity",
            tool="get_activity_content",
            arg="activity_uuid",
            title="Activity content",
            description="A page's content as Markdown.",
            extra_args={"format": "markdown"},
            search_kind="activity",
        ),
        ResourceDef(
            kind="assignment",
            tool="get_assignment",
            arg="assignment_uuid",
            title="Assignment",
            description="An assignment with its tasks, due date and grading settings.",
            extra_args={"include_task_contents": True},
            search_kind="assignment",
        ),
        ResourceDef(
            kind="path",
            tool="get_path",
            arg="path_uuid",
            title="Learning path",
            description="A learning path's settings and its courses in order.",
            listed_by=("list_paths", {"limit": 50}),
            search_kind="path",
        ),
        ResourceDef(
            kind="community",
            tool="get_community",
            arg="community_uuid",
            title="Community",
            description="A community's settings and recent discussions.",
            search_kind="community",
        ),
    )
}


def parse_uri(uri: str) -> tuple[ResourceDef, str | None] | None:
    """The resource a URI names and its id, or None when it names none."""
    match = URI.match(uri or "")
    if not match:
        return None
    resource = RESOURCES.get(match.group("kind"))
    ident = match.group("id")
    if resource is None or bool(ident) != bool(resource.arg):
        return None
    return resource, ident


# Template argument -> search kind, for completing resource template ids.
TEMPLATE_ARGS: dict[str, str] = {r.arg: r.search_kind for r in RESOURCES.values() if r.arg and r.search_kind}

# Search kind -> list tool giving a first page when nothing is typed yet.
FIRST_PAGE: dict[str, str] = {"course": "list_courses", "path": "list_paths", "community": "list_communities"}

MAX_COMPLETIONS = 20


def completion_values(found: Any, *, by: str) -> list[str]:
    """Values out of a search or list result: names (by="name") for prompt
    arguments, ids (by="uuid") for resource template arguments."""
    if not isinstance(found, dict):
        return []
    rows = found.get("matches") if "matches" in found else found.get("items")
    values: list[str] = []
    for row in rows or []:
        # Only things that can be opened: a match without an id is not one.
        if not isinstance(row, dict) or not row.get("uuid"):
            continue
        value = row.get(by)
        if isinstance(value, str) and value and value not in values:
            values.append(value)
    return values[:MAX_COMPLETIONS]
