"""Atlas SSE event protocol.

The single source of truth for what flows over POST /ai/atlas/chat. Every
event the pipeline yields is a discriminated-union member here; the
serializer turns it into the ``{"event": "...", "data": "..."}`` shape
``sse-starlette`` consumes.

This replaces the old free-form ``data: {...}\\n\\n`` dump plus the
out-of-band channels (``<!-- atlas:confirm -->`` HTML comments,
``​​​atlas-course-plan`` markdown fences, JSON.parsed
``tool.summary`` strings). The frontend handler is a typed
``switch (event.type)``.
"""

from __future__ import annotations

import json
from typing import Annotated, Any, Literal, Optional, Union

from pydantic import BaseModel, Field

from src.services.ai.atlas.tiers import ConfirmationChallenge


# --- Shared sub-shapes -------------------------------------------------------


class ResourceRef(BaseModel):
    """A pointer to a course/chapter/activity used inside event payloads."""

    kind: Literal["course", "chapter", "activity"]
    uuid: str
    name: str
    parent_course_uuid: Optional[str] = None
    parent_chapter_id: Optional[int] = None


class Candidate(BaseModel):
    """One entry in an ambiguous-resolution or not-found suggestion list."""

    kind: Literal["course", "chapter", "activity"]
    uuid: str
    name: str
    label: str = Field(description='Display string, e.g. "Chapter 1 · Introduction"')
    score: float = 0.0
    parent_course_uuid: Optional[str] = None
    parent_chapter_id: Optional[int] = None


# --- Events ------------------------------------------------------------------
#
# Each event class has a literal ``type`` field used as the discriminator.
# The ``sse_event`` and ``sse_data`` are computed at serialization time.


class SessionEvent(BaseModel):
    """Sent once, at the start of every chat turn, so the client can pin
    its UI to the (possibly newly-minted) chat session uuid."""

    type: Literal["session"] = "session"
    aichat_uuid: str


class MessageDeltaEvent(BaseModel):
    """One incremental text chunk emitted by the model."""

    type: Literal["message.delta"] = "message.delta"
    delta: str


class ToolStartEvent(BaseModel):
    """Telemetry: the pipeline is about to dispatch a tool call."""

    type: Literal["tool.start"] = "tool.start"
    call_id: str
    name: str
    args_redacted: dict[str, Any] = Field(default_factory=dict)


class ToolEndEvent(BaseModel):
    """Telemetry: tool dispatch returned."""

    type: Literal["tool.end"] = "tool.end"
    call_id: str
    ok: bool
    duration_ms: int = 0


class EntityResolvedEvent(BaseModel):
    """A single entity was resolved from the user's selector."""

    type: Literal["entity.resolved"] = "entity.resolved"
    kind: Literal["course", "chapter", "activity"]
    uuid: str
    name: str
    via: Literal["chip", "page", "uuid", "recent", "exact", "ordinal", "fuzzy"]
    score: float = 1.0


class EntityAmbiguousEvent(BaseModel):
    """Multiple candidates matched; halt and surface a picker."""

    type: Literal["entity.ambiguous"] = "entity.ambiguous"
    kind: Literal["course", "chapter", "activity"]
    selector: str
    candidates: list[Candidate]


class EntityNotFoundEvent(BaseModel):
    """No match; surface closest neighbours as suggestions."""

    type: Literal["entity.not_found"] = "entity.not_found"
    kind: Literal["course", "chapter", "activity"]
    selector: str
    suggestions: list[Candidate]


class PreviewActivityEvent(BaseModel):
    """Activity-edit preview card payload (full snapshot before & after)."""

    type: Literal["preview.activity"] = "preview.activity"
    pending_id: str
    target: ResourceRef
    proposed: dict[str, Any]
    current: Optional[dict[str, Any]] = None
    summary: str
    mode: Literal["rename", "create", "replace", "append", "duplicate", "publish", "delete"]
    expected_version: Optional[int] = None


class PreviewChapterEvent(BaseModel):
    """Chapter-edit preview card payload."""

    type: Literal["preview.chapter"] = "preview.chapter"
    pending_id: str
    target: ResourceRef
    patch: dict[str, Any]
    current: Optional[dict[str, Any]] = None
    summary: str
    mode: Literal["rename", "create", "edit", "delete", "move_activities", "reorder"]


class PreviewCourseEvent(BaseModel):
    """Course-edit preview card payload."""

    type: Literal["preview.course"] = "preview.course"
    pending_id: str
    target: ResourceRef
    patch: dict[str, Any]
    current: Optional[dict[str, Any]] = None
    summary: str
    mode: Literal["create", "edit", "delete", "reorder_chapters"]


class ResultsListEvent(BaseModel):
    """A list of items returned by a READ tool (replaces ``atlas-results``)."""

    type: Literal["results.list"] = "results.list"
    kind: str
    items: list[dict[str, Any]]


class StructureProposalEvent(BaseModel):
    """Draft course tree from suggest_course_structure (replaces
    ``atlas-course-plan``)."""

    type: Literal["structure.proposal"] = "structure.proposal"
    tree: dict[str, Any]


class ConfirmRequiredEvent(BaseModel):
    """Destructive proposal stage: render a type-back challenge."""

    type: Literal["confirm.required"] = "confirm.required"
    pending_id: str
    challenge: ConfirmationChallenge


class AppliedEvent(BaseModel):
    """A pending edit was applied successfully."""

    type: Literal["applied"] = "applied"
    pending_id: str
    target: ResourceRef
    version_after: Optional[int] = None
    undo_token: Optional[str] = None


class PendingDroppedEvent(BaseModel):
    """A pending edit was discarded (superseded, cancelled, or expired)."""

    type: Literal["pending.dropped"] = "pending.dropped"
    pending_id: str
    reason: Literal["superseded", "cancelled", "expired", "subject_change"]


class ErrorEvent(BaseModel):
    """A tool, the LLM, or the pipeline failed."""

    type: Literal["error"] = "error"
    code: str
    message: str
    retriable: bool = False


class DoneEvent(BaseModel):
    """Always the last event of a turn; the client can close the reader."""

    type: Literal["done"] = "done"


AtlasEvent = Annotated[
    Union[
        SessionEvent,
        MessageDeltaEvent,
        ToolStartEvent,
        ToolEndEvent,
        EntityResolvedEvent,
        EntityAmbiguousEvent,
        EntityNotFoundEvent,
        PreviewActivityEvent,
        PreviewChapterEvent,
        PreviewCourseEvent,
        ResultsListEvent,
        StructureProposalEvent,
        ConfirmRequiredEvent,
        AppliedEvent,
        PendingDroppedEvent,
        ErrorEvent,
        DoneEvent,
    ],
    Field(discriminator="type"),
]


def serialize(event: BaseModel) -> dict[str, str]:
    """Render a pydantic event into ``sse-starlette``'s envelope shape.

    sse-starlette's ``EventSourceResponse`` accepts dicts with ``event``
    and ``data`` keys. We use ``model_dump(exclude_none=True)`` so absent
    optional fields don't appear over the wire.
    """
    return {
        "event": event.type,  # type: ignore[attr-defined]
        "data": json.dumps(event.model_dump(exclude_none=True), default=str),
    }
