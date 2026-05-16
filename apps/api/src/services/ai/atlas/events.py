"""Pydantic models for the Atlas SSE event stream.

Mirrors the TypeScript discriminated union in
`apps/web/services/ai/atlas.ts` (lines ~104-146). This is the wire
contract — keep field names and event types in sync with the frontend.

`serialize(event)` returns the dict suitable for `EventSourceResponse`
(`event`: type, `data`: JSON-encoded payload). The frontend parser already
handles both named-event and data-only framings.
"""

from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field

# ─── Resource refs and DTOs ───────────────────────────────────────────────


class ResourceRefDTO(BaseModel):
    kind: Literal["course", "chapter", "activity"]
    uuid: str
    name: str
    parent_course_uuid: str | None = None
    parent_chapter_id: int | None = None


class CandidateDTO(BaseModel):
    kind: Literal["course", "chapter", "activity"]
    uuid: str
    name: str
    label: str
    score: float
    parent_course_uuid: str | None = None
    parent_chapter_id: int | None = None


class ConfirmationChallengeDTO(BaseModel):
    pending_id: str
    action_label: str
    blast_radius_summary: str
    challenge_phrase: str
    challenge_kind: Literal["type_name", "type_phrase"]


# ─── Events ───────────────────────────────────────────────────────────────


class SessionEvent(BaseModel):
    type: Literal["session"] = "session"
    aichat_uuid: str


class MessageDeltaEvent(BaseModel):
    type: Literal["message.delta"] = "message.delta"
    delta: str


class ToolStartEvent(BaseModel):
    type: Literal["tool.start"] = "tool.start"
    call_id: str
    name: str
    args_redacted: dict[str, Any] | None = None


class ToolEndEvent(BaseModel):
    type: Literal["tool.end"] = "tool.end"
    call_id: str
    name: str | None = None
    ok: bool
    duration_ms: int | None = None


class EntityResolvedEvent(BaseModel):
    type: Literal["entity.resolved"] = "entity.resolved"
    kind: Literal["course", "chapter", "activity"]
    uuid: str
    name: str
    via: str
    score: float | None = None


class EntityAmbiguousEvent(BaseModel):
    type: Literal["entity.ambiguous"] = "entity.ambiguous"
    kind: Literal["course", "chapter", "activity"]
    selector: str
    candidates: list[CandidateDTO]


class EntityNotFoundEvent(BaseModel):
    type: Literal["entity.not_found"] = "entity.not_found"
    kind: Literal["course", "chapter", "activity"]
    selector: str
    suggestions: list[CandidateDTO]


PreviewActivityMode = Literal[
    "rename", "create", "replace", "append", "duplicate", "publish", "delete"
]


class PreviewActivityEvent(BaseModel):
    type: Literal["preview.activity"] = "preview.activity"
    pending_id: str
    target: ResourceRefDTO
    proposed: dict[str, Any]
    current: dict[str, Any] | None = None
    summary: str
    mode: PreviewActivityMode
    expected_version: int | None = None


PreviewChapterMode = Literal[
    "rename", "create", "edit", "delete", "move_activities", "reorder"
]


class PreviewChapterEvent(BaseModel):
    type: Literal["preview.chapter"] = "preview.chapter"
    pending_id: str
    target: ResourceRefDTO
    patch: dict[str, Any]
    current: dict[str, Any] | None = None
    summary: str
    mode: PreviewChapterMode


PreviewCourseMode = Literal["create", "edit", "delete", "reorder_chapters", "rename"]


class PreviewCourseEvent(BaseModel):
    type: Literal["preview.course"] = "preview.course"
    pending_id: str
    target: ResourceRefDTO
    patch: dict[str, Any]
    current: dict[str, Any] | None = None
    summary: str
    mode: PreviewCourseMode


class ResultsListEvent(BaseModel):
    type: Literal["results.list"] = "results.list"
    kind: str
    items: list[dict[str, Any]]


class StructureProposalEvent(BaseModel):
    type: Literal["structure.proposal"] = "structure.proposal"
    tree: dict[str, Any]


class ConfirmRequiredEvent(BaseModel):
    type: Literal["confirm.required"] = "confirm.required"
    pending_id: str
    challenge: ConfirmationChallengeDTO


class AppliedEvent(BaseModel):
    type: Literal["applied"] = "applied"
    pending_id: str
    target: ResourceRefDTO
    version_after: int | None = None
    undo_token: str | None = None


class PendingDroppedEvent(BaseModel):
    type: Literal["pending.dropped"] = "pending.dropped"
    pending_id: str
    reason: Literal["superseded", "cancelled", "expired", "subject_change"]


class ErrorEvent(BaseModel):
    type: Literal["error"] = "error"
    code: str
    message: str
    retriable: bool | None = None


class DoneEvent(BaseModel):
    type: Literal["done"] = "done"


AtlasEvent = Annotated[
    SessionEvent
    | MessageDeltaEvent
    | ToolStartEvent
    | ToolEndEvent
    | EntityResolvedEvent
    | EntityAmbiguousEvent
    | EntityNotFoundEvent
    | PreviewActivityEvent
    | PreviewChapterEvent
    | PreviewCourseEvent
    | ResultsListEvent
    | StructureProposalEvent
    | ConfirmRequiredEvent
    | AppliedEvent
    | PendingDroppedEvent
    | ErrorEvent
    | DoneEvent,
    Field(discriminator="type"),
]


def serialize(event: BaseModel) -> dict[str, Any]:
    """Convert an event model into the dict shape sse-starlette expects.

    `EventSourceResponse` accepts `{event, data}` where data is a string
    (typically JSON). The frontend reads both the named event and parses
    the JSON payload to discriminate on `type`.
    """
    return {"event": event.type, "data": event.model_dump_json(exclude_none=True)}  # type: ignore[attr-defined]
