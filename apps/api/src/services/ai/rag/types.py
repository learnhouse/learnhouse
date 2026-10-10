"""Shared shapes for the RAG pipeline.

Everything that gets indexed is addressed by a ``ContentRef``: one activity, or
one course's own text (course and chapter metadata). A source module turns a
ref into ``Segment``s, the pipeline turns segments into embedded rows, and
retrieval turns rows back into ``Source``s for the copilot.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from enum import Enum
from typing import Literal, Optional


class SourceType(str, Enum):
    """What a chunk was extracted from. Stored on each row and sent to clients."""

    COURSE = "course"
    CHAPTER = "chapter"
    PAGE = "dynamic_page"
    DOCUMENT = "document_activity"
    PDF_BLOCK = "pdf_block"
    IMAGE_BLOCK = "image_block"
    AUDIO_BLOCK = "audio_block"
    VIDEO_BLOCK = "video_block"
    VIDEO = "video"
    ASSIGNMENT = "assignment"
    SCORM = "scorm"
    CUSTOM = "custom"
    CUSTOM_BLOCK = "custom_block"
    # Activity name and details only: embeds, markdown links, YouTube videos and
    # media that has no transcript yet. Keeps every activity findable.
    ACTIVITY = "activity"


@dataclass(frozen=True)
class ContentRef:
    kind: Literal["activity", "course"]
    id: int

    @classmethod
    def activity(cls, activity_id: int) -> "ContentRef":
        return cls("activity", activity_id)

    @classmethod
    def course(cls, course_id: int) -> "ContentRef":
        return cls("course", course_id)

    @property
    def key(self) -> str:
        return f"{self.kind}:{self.id}"

    @classmethod
    def parse(cls, key: str) -> Optional["ContentRef"]:
        kind, _, raw_id = key.partition(":")
        if kind not in ("activity", "course") or not raw_id.isdigit():
            return None
        return cls(kind, int(raw_id))  # type: ignore[arg-type]


@dataclass(frozen=True)
class Segment:
    """A run of text from one place in a source. Chunked before embedding."""

    text: str
    source_type: SourceType
    block_uuid: Optional[str] = None
    # {"page": 4} for documents, {"start": 192.0} for timed media.
    locator: Optional[dict] = None
    # Course-level rows: the chapter this segment describes.
    chapter_name: Optional[str] = None


@dataclass
class Source:
    """One citable source, as sent to the copilot and stored in chat history.

    Keeps the legacy keys (activity_name, chapter_name, course_name) so saved
    conversations and older clients keep rendering.
    """

    source_type: str
    course_uuid: str
    course_name: str
    chapter_name: str = ""
    activity_uuid: Optional[str] = None
    activity_name: str = ""
    block_uuid: Optional[str] = None
    locator: Optional[dict] = None
    title: str = ""
    snippet: str = ""
    similarity: Optional[float] = None

    def to_dict(self) -> dict:
        return asdict(self)
