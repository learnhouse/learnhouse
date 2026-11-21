"""Peer review on assignments.

Three tables, all new (nothing here touches the assignment tables):

- ``assignment_peer_review_settings``: one row per assignment. Peer review is
  opt-in: with no row, or ``enabled = False``, the assignment behaves exactly as
  before. Holds the rubric, the comment prompts, the practice (calibration)
  samples and the toggles for the optional steps.
- ``assignment_peer_review``: one row per review. ``kind`` says what is being
  reviewed: a classmate's submission (``peer``), the learner's own work
  (``self``) or an instructor-scored practice sample (``calibration``).
  ``attempt_number`` pins a review to the reviewee's attempt, so a retry starts
  a fresh round while older reviews stay as history.
- ``assignment_peer_reflection``: the learner's revision plan, one per
  assignment and learner.

Peer review never writes the official grade: ``AssignmentUserSubmission`` is
only ever read. Enums are stored as plain strings (validated by the request
models below), so adding a value never needs a Postgres enum migration.
"""

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field as PField, field_validator
from sqlalchemy import JSON, Boolean, Column, ForeignKey, Index, Integer, String, Text, UniqueConstraint, text
from sqlmodel import Field, SQLModel


ANONYMITY_MODES = ("double_blind", "anonymous_reviewer", "named")
SCORE_MODES = ("feedback_only", "suggest_grade")
REVIEW_KINDS = ("peer", "self", "calibration")
REVIEW_STATUSES = ("assigned", "submitted", "discarded")

# Used whenever ``prompts`` is NULL (the UI shows translated labels by key).
DEFAULT_PROMPTS: list[dict[str, Any]] = [
    {"key": "strength", "label": "What works well", "min_chars": 40},
    {"key": "suggestion", "label": "One thing to improve, and how", "min_chars": 40},
    {"key": "question", "label": "A question for the author", "min_chars": 0},
]


class AssignmentPeerReviewSettings(SQLModel, table=True):
    __tablename__ = "assignment_peer_review_settings"
    __table_args__ = (
        UniqueConstraint("assignment_id", name="uq_assignment_peer_review_settings_assignment"),
        Index("ix_assignment_peer_review_settings_org_id", "org_id"),
        {"extend_existing": True},
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    assignment_id: int = Field(
        sa_column=Column(Integer, ForeignKey("assignment.id", ondelete="CASCADE"), nullable=False)
    )
    org_id: int = Field(
        sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False)
    )

    enabled: bool = Field(default=False, sa_column=Column(Boolean, nullable=False, default=False))
    reviews_required: int = Field(default=3, sa_column=Column(Integer, nullable=False, default=3))
    require_reviews_to_see_feedback: bool = Field(
        default=True, sa_column=Column(Boolean, nullable=False, default=True)
    )
    # ISO date or datetime, same free-form semantics as Assignment.due_date.
    review_due_date: Optional[str] = Field(default=None, sa_column=Column(String, nullable=True))
    anonymity: str = Field(default="double_blind", sa_column=Column(String(32), nullable=False))

    self_review_enabled: bool = Field(default=True, sa_column=Column(Boolean, nullable=False, default=True))
    calibration_enabled: bool = Field(default=True, sa_column=Column(Boolean, nullable=False, default=True))
    helpfulness_enabled: bool = Field(default=True, sa_column=Column(Boolean, nullable=False, default=True))
    revision_plan_enabled: bool = Field(default=True, sa_column=Column(Boolean, nullable=False, default=True))

    # [{key, label, min_chars}]; NULL means DEFAULT_PROMPTS.
    prompts: Optional[list] = Field(default=None, sa_column=Column(JSON, nullable=True))
    # [{id, title, description, levels: [{id, points, label, description}]}]
    rubric: list = Field(default_factory=list, sa_column=Column(JSON, nullable=False, default=list))
    score_mode: str = Field(default="feedback_only", sa_column=Column(String(32), nullable=False))
    min_reviews_for_score: int = Field(default=3, sa_column=Column(Integer, nullable=False, default=3))
    # [{id, title, content, scores: {criterion_id: level_id}, explanation}]
    calibration_samples: list = Field(
        default_factory=list, sa_column=Column(JSON, nullable=False, default=list)
    )

    creation_date: str = Field(sa_column=Column(String, nullable=False))
    update_date: str = Field(sa_column=Column(String, nullable=False))


class AssignmentPeerReview(SQLModel, table=True):
    __tablename__ = "assignment_peer_review"
    __table_args__ = (
        Index(
            "uq_assignment_peer_review_peer",
            "assignment_id", "reviewer_user_id", "reviewee_user_id", "attempt_number",
            unique=True,
            postgresql_where=text("kind = 'peer'"), sqlite_where=text("kind = 'peer'"),
        ),
        Index(
            "uq_assignment_peer_review_self",
            "assignment_id", "reviewer_user_id",
            unique=True,
            postgresql_where=text("kind = 'self'"), sqlite_where=text("kind = 'self'"),
        ),
        Index(
            "uq_assignment_peer_review_calibration",
            "assignment_id", "reviewer_user_id", "calibration_sample_id",
            unique=True,
            postgresql_where=text("kind = 'calibration'"), sqlite_where=text("kind = 'calibration'"),
        ),
        Index("ix_assignment_peer_review_reviewee", "assignment_id", "reviewee_user_id"),
        Index("ix_assignment_peer_review_reviewer", "assignment_id", "reviewer_user_id"),
        {"extend_existing": True},
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    review_uuid: str = Field(sa_column=Column(String(64), nullable=False, unique=True, index=True))
    assignment_id: int = Field(
        sa_column=Column(Integer, ForeignKey("assignment.id", ondelete="CASCADE"), nullable=False)
    )
    org_id: int = Field(
        sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False)
    )
    reviewer_user_id: int = Field(
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="CASCADE"), nullable=False)
    )
    # NULL for calibration reviews (the "reviewee" is an instructor sample).
    reviewee_user_id: Optional[int] = Field(
        default=None, sa_column=Column(Integer, ForeignKey("user.id", ondelete="CASCADE"), nullable=True)
    )

    kind: str = Field(sa_column=Column(String(16), nullable=False))
    calibration_sample_id: Optional[str] = Field(default=None, sa_column=Column(String(64), nullable=True))
    # The reviewee's submission attempt this review is about (1 for calibration).
    attempt_number: int = Field(default=1, sa_column=Column(Integer, nullable=False, default=1))

    status: str = Field(default="assigned", sa_column=Column(String(16), nullable=False))
    scores: dict = Field(default_factory=dict, sa_column=Column(JSON, nullable=False, default=dict))
    comments: dict = Field(default_factory=dict, sa_column=Column(JSON, nullable=False, default=dict))
    criterion_comments: dict = Field(
        default_factory=dict, sa_column=Column(JSON, nullable=False, default=dict)
    )

    # Back-evaluation by the reviewee.
    helpfulness: Optional[int] = Field(default=None, sa_column=Column(Integer, nullable=True))
    helpfulness_note: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    flagged: bool = Field(default=False, sa_column=Column(Boolean, nullable=False, default=False))
    flag_reason: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))
    # Moderation by an instructor. A discarded review with NULL discarded_by
    # was closed by the system (the reviewee started a new attempt).
    discarded_by: Optional[int] = Field(
        default=None, sa_column=Column(Integer, ForeignKey("user.id", ondelete="SET NULL"), nullable=True)
    )
    discard_reason: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))

    assigned_at: Optional[str] = Field(default=None, sa_column=Column(String, nullable=True))
    submitted_at: Optional[str] = Field(default=None, sa_column=Column(String, nullable=True))
    creation_date: str = Field(sa_column=Column(String, nullable=False))
    update_date: str = Field(sa_column=Column(String, nullable=False))


class AssignmentPeerReflection(SQLModel, table=True):
    __tablename__ = "assignment_peer_reflection"
    __table_args__ = (
        UniqueConstraint("assignment_id", "user_id", name="uq_assignment_peer_reflection_assignment_user"),
        {"extend_existing": True},
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    assignment_id: int = Field(
        sa_column=Column(Integer, ForeignKey("assignment.id", ondelete="CASCADE"), nullable=False)
    )
    org_id: int = Field(
        sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False)
    )
    user_id: int = Field(
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="CASCADE"), nullable=False)
    )
    plan: str = Field(default="", sa_column=Column(Text, nullable=False, default=""))
    creation_date: str = Field(sa_column=Column(String, nullable=False))
    update_date: str = Field(sa_column=Column(String, nullable=False))


# ---------------------------------------------------------------------------
# Request bodies
# ---------------------------------------------------------------------------

MAX_COMMENT_CHARS = 5000
MAX_CRITERION_COMMENT_CHARS = 2000


def _unique(ids: list[str], what: str) -> None:
    if len(set(ids)) != len(ids):
        raise ValueError(f"{what} ids must be unique")


class PeerReviewLevelIn(BaseModel):
    id: str = PField(min_length=1, max_length=64)
    points: float = PField(ge=0, le=1000)
    label: str = PField(min_length=1, max_length=200)
    description: Optional[str] = PField(default=None, max_length=2000)


class PeerReviewCriterionIn(BaseModel):
    id: str = PField(min_length=1, max_length=64)
    title: str = PField(min_length=1, max_length=200)
    description: Optional[str] = PField(default=None, max_length=2000)
    levels: list[PeerReviewLevelIn] = PField(min_length=2, max_length=6)

    @field_validator("levels")
    @classmethod
    def _levels_unique(cls, value):
        _unique([lv.id for lv in value], "Level")
        return value


class PeerReviewPromptIn(BaseModel):
    key: str = PField(min_length=1, max_length=64)
    label: str = PField(min_length=1, max_length=200)
    min_chars: int = PField(default=0, ge=0, le=2000)


class PeerReviewCalibrationSampleIn(BaseModel):
    id: str = PField(min_length=1, max_length=64)
    title: str = PField(min_length=1, max_length=200)
    content: str = PField(default="", max_length=20000)
    scores: dict[str, str] = PField(default_factory=dict)
    explanation: Optional[str] = PField(default=None, max_length=5000)


class PeerReviewSettingsUpdate(BaseModel):
    """Upsert body. Fields left out keep their current value; ``prompts``
    sent as null goes back to the default prompts."""

    enabled: Optional[bool] = None
    reviews_required: Optional[int] = PField(default=None, ge=1, le=10)
    require_reviews_to_see_feedback: Optional[bool] = None
    review_due_date: Optional[str] = PField(default=None, max_length=64)
    anonymity: Optional[Literal["double_blind", "anonymous_reviewer", "named"]] = None
    self_review_enabled: Optional[bool] = None
    calibration_enabled: Optional[bool] = None
    helpfulness_enabled: Optional[bool] = None
    revision_plan_enabled: Optional[bool] = None
    prompts: Optional[list[PeerReviewPromptIn]] = PField(default=None, min_length=1, max_length=5)
    rubric: Optional[list[PeerReviewCriterionIn]] = PField(default=None, max_length=10)
    score_mode: Optional[Literal["feedback_only", "suggest_grade"]] = None
    min_reviews_for_score: Optional[int] = PField(default=None, ge=1, le=10)
    calibration_samples: Optional[list[PeerReviewCalibrationSampleIn]] = PField(default=None, max_length=10)

    @field_validator("prompts")
    @classmethod
    def _prompts_unique(cls, value):
        if value is not None:
            _unique([p.key for p in value], "Prompt")
        return value

    @field_validator("rubric")
    @classmethod
    def _criteria_unique(cls, value):
        if value is not None:
            _unique([c.id for c in value], "Criterion")
        return value

    @field_validator("calibration_samples")
    @classmethod
    def _samples_unique(cls, value):
        if value is not None:
            _unique([s.id for s in value], "Sample")
        return value


class PeerReviewSaveBody(BaseModel):
    scores: dict[str, str] = PField(default_factory=dict)
    comments: dict[str, str] = PField(default_factory=dict)
    criterion_comments: Optional[dict[str, str]] = None
    submit: bool = False


class PeerSelfReviewBody(BaseModel):
    scores: dict[str, str] = PField(default_factory=dict)
    comments: dict[str, str] = PField(default_factory=dict)
    criterion_comments: Optional[dict[str, str]] = None


class PeerCalibrationBody(BaseModel):
    scores: dict[str, str] = PField(default_factory=dict)


class PeerRateBody(BaseModel):
    helpfulness: int = PField(ge=1, le=5)
    note: Optional[str] = PField(default=None, max_length=1000)


class PeerFlagBody(BaseModel):
    reason: str = PField(min_length=1, max_length=1000)


class PeerDiscardBody(BaseModel):
    reason: Optional[str] = PField(default=None, max_length=1000)


class PeerReflectionBody(BaseModel):
    plan: str = PField(max_length=10000)
