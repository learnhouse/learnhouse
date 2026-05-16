"""Typed envelopes returned by Atlas MCP tools.

The API parses these to emit `preview.*` / `confirm.required` SSE events and
to persist pending edits in Redis. The shapes here are the wire contract
between MCP and API — keep them stable.

Important: the frontend's `preview.activity` event uses `proposed` as the
field name (carrying the proposed activity state), while `preview.course`
and `preview.chapter` use `patch`. We mirror that here so the API can copy
fields through verbatim.
"""

from typing import Any, Literal

from pydantic import BaseModel, Field

Tier = Literal["READ", "CREATE", "EDIT", "DESTRUCTIVE"]

ResourceKind = Literal["course", "chapter", "activity"]


class ResourceRef(BaseModel):
    kind: ResourceKind
    uuid: str
    name: str
    parent_course_uuid: str | None = None
    parent_chapter_id: int | None = None


class PreviewEnvelope(BaseModel):
    pending_id: str
    tool: str
    tier: Tier
    target: ResourceRef
    mode: str
    summary: str
    patch: dict[str, Any] | None = None
    proposed: dict[str, Any] | None = None
    current: dict[str, Any] | None = None
    requires_confirmation: bool = False
    expected_version: int | None = None
    blast_radius: dict[str, Any] | None = None


class CandidateDTO(BaseModel):
    kind: ResourceKind
    uuid: str
    name: str
    label: str
    score: float
    parent_course_uuid: str | None = None
    parent_chapter_id: int | None = None


# ─── Tool input shapes ────────────────────────────────────────────────────


class CoursePatch(BaseModel):
    name: str | None = None
    description: str | None = None
    about: str | None = None
    learnings: str | None = None
    tags: str | None = None
    public: bool | None = None
    published: bool | None = None


class ChapterPatch(BaseModel):
    name: str | None = None
    description: str | None = None


ActivityKind = Literal["dynamic", "video"]


class ActivityCreateInput(BaseModel):
    chapter_id: int
    name: str = Field(min_length=1, max_length=200)
    kind: ActivityKind
    body_markdown: str | None = None
    youtube_url: str | None = None
    published: bool = False


class ActivityPatch(BaseModel):
    name: str | None = None
    body_markdown: str | None = None
    youtube_url: str | None = None
    published: bool | None = None


class ActivityPlan(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    kind: ActivityKind
    body_markdown: str | None = None
    youtube_url: str | None = None


class ChapterPlan(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    activities: list[ActivityPlan] = Field(default_factory=list)
