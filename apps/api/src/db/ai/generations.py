from typing import Optional, Dict
from enum import Enum

from sqlalchemy import JSON, Column, ForeignKey, Index, Text
from sqlmodel import Field, SQLModel


class AIGenerationKind(str, Enum):
    """The kind of artifact an AI generation produced.

    Durable history is kept per-kind so each feature (image picker, editor quiz
    generator, assignment generator) can list only its own past generations.
    The in-progress multi-turn refine chat lives ephemerally in Redis (see
    ``src/services/ai/base.py``); this table is the durable record of the
    artifacts the user actually kept.
    """

    IMAGE = "IMAGE"
    QUIZ = "QUIZ"
    ASSIGNMENT = "ASSIGNMENT"
    SCENARIO = "SCENARIO"


class AIGenerationBase(SQLModel):
    """Common fields for a durable AI generation record."""

    kind: AIGenerationKind
    # The prompt (or last refine message) that produced this artifact.
    prompt: str = Field(default="", sa_column=Column(Text))
    # Links this durable record to the ephemeral Redis refine session (the
    # `chat_history:<session_uuid>` / `chat_meta:<session_uuid>` keys) so the UI
    # can resume the conversation that produced the artifact while it still lives.
    session_uuid: Optional[str] = Field(default=None, index=True)
    # Kind-specific payload:
    #   IMAGE      -> {"file_id", "media_url", "source", "source_image_url"?}
    #   QUIZ       -> the blockQuiz attrs {"quizId", "questions": [...]}
    #   ASSIGNMENT -> {"assignment": {...}, "tasks": [...]}
    result: Dict = Field(default_factory=dict, sa_column=Column(JSON))


class AIGenerationCreate(AIGenerationBase):
    """Model for creating a new AI generation record."""

    org_id: int
    user_id: int
    course_id: Optional[int] = None
    activity_id: Optional[int] = None
    assignment_id: Optional[int] = None


class AIGenerationRead(AIGenerationBase):
    """Model for reading an AI generation record."""

    id: int
    ai_generation_uuid: str
    org_id: int
    user_id: int
    course_id: Optional[int] = None
    activity_id: Optional[int] = None
    assignment_id: Optional[int] = None
    creation_date: Optional[str] = None
    update_date: Optional[str] = None


class AIGeneration(AIGenerationBase, table=True):
    """A durable record of an AI-generated artifact (image, quiz, assignment)."""

    __table_args__ = (
        Index("ix_aigeneration_org_id", "org_id"),
        Index("ix_aigeneration_user_id", "user_id"),
        Index("ix_aigeneration_kind", "kind"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    ai_generation_uuid: str = Field(default="", index=True)
    creation_date: Optional[str] = None
    update_date: Optional[str] = None

    org_id: int = Field(
        sa_column=Column("org_id", ForeignKey("organization.id", ondelete="CASCADE"))
    )
    user_id: int = Field(
        sa_column=Column("user_id", ForeignKey("user.id", ondelete="CASCADE"))
    )
    # Optional context the artifact was generated against. Nullable because an
    # image generated from a standalone thumbnail picker has no course/activity.
    course_id: Optional[int] = Field(
        default=None,
        sa_column=Column("course_id", ForeignKey("course.id", ondelete="CASCADE"), nullable=True),
    )
    activity_id: Optional[int] = Field(
        default=None,
        sa_column=Column("activity_id", ForeignKey("activity.id", ondelete="CASCADE"), nullable=True),
    )
    assignment_id: Optional[int] = Field(
        default=None,
        sa_column=Column("assignment_id", ForeignKey("assignment.id", ondelete="CASCADE"), nullable=True),
    )
