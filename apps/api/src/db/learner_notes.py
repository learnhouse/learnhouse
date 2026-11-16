"""Private learner notes on an activity.

A note belongs to one person and is served to that person only: there is no
endpoint, admin view or export that reads another user's notes. Every foreign
key cascades, so a note goes away with its author, the organization, the
course or the activity. Removing someone from the organization deletes their
notes there too (``purge_member_notes``), so the privacy model is simply:
"your notes live as long as your membership and the lesson do".

``content`` is a TipTap document restricted to a small, sanitized schema
(see ``services/courses/activities/learner_notes_content.py``);
``plain_text`` is derived from it on the server for search and export.
"""

from typing import Literal, Optional

from pydantic import BaseModel, Field as PydanticField
from sqlalchemy import JSON, Column, ForeignKey, Index, Integer, String, Text
from sqlmodel import Field, SQLModel

PLAIN_TEXT_MAX = 20_000
CONTENT_MAX_BYTES = 64_000
ANCHOR_REF_MAX = 200
ANCHOR_LABEL_MAX = 200
NOTES_PER_ACTIVITY_MAX = 200

AnchorKind = Literal["heading", "block", "video"]


class LearnerNote(SQLModel, table=True):
    __tablename__ = "learner_note"
    __table_args__ = (
        Index("ix_learner_note_user_activity", "user_id", "activity_id"),
        Index("ix_learner_note_user_org_course", "user_id", "org_id", "course_id"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    note_uuid: str = Field(sa_column=Column(String, nullable=False, unique=True, index=True))
    org_id: int = Field(
        sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False, index=True)
    )
    user_id: int = Field(
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="CASCADE"), nullable=False)
    )
    course_id: int = Field(
        sa_column=Column(Integer, ForeignKey("course.id", ondelete="CASCADE"), nullable=False, index=True)
    )
    activity_id: int = Field(
        sa_column=Column(Integer, ForeignKey("activity.id", ondelete="CASCADE"), nullable=False, index=True)
    )
    content: dict = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    plain_text: str = Field(default="", sa_column=Column(Text, nullable=False, server_default=""))
    # Where in the lesson the note points: a heading id, a block id or a
    # moment of the video (seconds).
    anchor_kind: Optional[str] = Field(default=None, sa_column=Column(String(16), nullable=True))
    anchor_ref: Optional[str] = Field(default=None, sa_column=Column(String(ANCHOR_REF_MAX), nullable=True))
    anchor_label: Optional[str] = Field(default=None, sa_column=Column(String(ANCHOR_LABEL_MAX), nullable=True))
    anchor_seconds: Optional[int] = Field(default=None, sa_column=Column(Integer, nullable=True))
    created_at: str = ""
    updated_at: str = ""


# ─── API shapes ──────────────────────────────────────────────────────────────


class NoteAnchor(BaseModel):
    kind: AnchorKind
    ref: Optional[str] = PydanticField(default=None, max_length=ANCHOR_REF_MAX)
    label: Optional[str] = PydanticField(default=None, max_length=ANCHOR_LABEL_MAX)
    seconds: Optional[int] = PydanticField(default=None, ge=0, le=24 * 3600)


class NoteCreate(BaseModel):
    content: dict = PydanticField(default_factory=dict)
    anchor: Optional[NoteAnchor] = None


class NoteUpdate(BaseModel):
    content: Optional[dict] = None
    anchor: Optional[NoteAnchor] = None
    # An explicit null anchor clears it; leaving the field out keeps it.
    clear_anchor: bool = False


class NoteRead(BaseModel):
    note_uuid: str
    activity_uuid: str
    course_uuid: str
    content: dict
    plain_text: str
    anchor: Optional[NoteAnchor] = None
    created_at: str
    updated_at: str


class NoteCourseRef(BaseModel):
    course_uuid: str
    name: str
    slug: Optional[str] = None
    thumbnail_image: Optional[str] = None


class NoteActivityRef(BaseModel):
    activity_uuid: str
    name: str
    activity_type: str
    chapter_name: Optional[str] = None


class NoteWithContext(NoteRead):
    course: NoteCourseRef
    activity: NoteActivityRef


class NoteList(BaseModel):
    notes: list[NoteWithContext]
    total: int
