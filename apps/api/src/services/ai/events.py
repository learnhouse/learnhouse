"""Pydantic models for the agent SSE event stream.

Mirrors the TypeScript discriminated union in
`apps/web/services/ai/atlas.ts`. This is the wire contract — keep field
names and event types in sync with the frontend.

`serialize(event)` returns a raw SSE frame string suitable for FastAPI's
`StreamingResponse` (the house convention — see
`src/routers/ai/magicblocks.py`). The frontend parser handles both LF and
CRLF framing and reads the SSE `event:` name as the discriminant when the
JSON body lacks a `type` field.

`preview.action` is a backend-side addition for domains that have no typed
preview card yet (communities, boards, users, ...); the frontend SSE switch
ignores unknown event types, so it is forward-compatible.
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
    # `kind` is a free string so the resolver can surface non-editor entities
    # (community, board, user, ...). The frontend renders it as a label.
    kind: str
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
    kind: str
    uuid: str
    name: str
    via: str
    score: float | None = None


class EntityAmbiguousEvent(BaseModel):
    type: Literal["entity.ambiguous"] = "entity.ambiguous"
    kind: str
    selector: str
    candidates: list[CandidateDTO]


class EntityNotFoundEvent(BaseModel):
    type: Literal["entity.not_found"] = "entity.not_found"
    kind: str
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


class PreviewActionEvent(BaseModel):
    """Generic pending-action preview for domains without a typed card.

    `target` is a loose ref: {kind, uuid?, name?} — kinds beyond the editor
    trio (community, board, playground, folder, media, user, usergroup,
    role, org, assignment, discussion, ...).
    """

    type: Literal["preview.action"] = "preview.action"
    pending_id: str
    tool: str
    tier: str
    target: dict[str, Any]
    summary: str
    args_redacted: dict[str, Any] | None = None


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
    target: ResourceRefDTO | dict[str, Any]
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


AgentEvent = Annotated[
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
    | PreviewActionEvent
    | ResultsListEvent
    | StructureProposalEvent
    | ConfirmRequiredEvent
    | AppliedEvent
    | PendingDroppedEvent
    | ErrorEvent
    | DoneEvent,
    Field(discriminator="type"),
]


def serialize(event: BaseModel) -> str:
    """Encode an event model as a raw SSE frame for `StreamingResponse`.

    Sets the SSE `event:` name to the discriminant type and JSON-encodes the
    payload on the `data:` line. The frontend parser injects `type` from the
    event name when absent, and we also keep `type` in the JSON body so
    data-only consumers work too.
    """
    payload = event.model_dump_json(exclude_none=True)
    return f"event: {event.type}\ndata: {payload}\n\n"  # type: ignore[attr-defined]
