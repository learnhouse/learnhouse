"""AI grading results for assignment submissions.

One row per (assignment, learner): the latest AI grading run for that
learner's current attempt. In SUGGEST mode it holds a DRAFT the teacher
accepts, edits or discards; in AUTO mode the grade is applied straight away
and the row stays as the record that the grade came from AI (APPLIED).

The table is instructor-only. No learner read path touches it, so a draft is
never visible to the learner before a teacher accepts it. A retry deletes the
row with the rest of the attempt.
"""

from enum import Enum
from typing import Any, Dict, List, Optional

from sqlalchemy import JSON, Column, ForeignKey, Text, UniqueConstraint
from sqlmodel import Field, SQLModel


class AIGradeStatusEnum(str, Enum):
    DRAFT = "DRAFT"  # waiting for a teacher (SUGGEST mode)
    APPLIED = "APPLIED"  # written to the submission as its grade
    DISCARDED = "DISCARDED"  # a teacher threw the draft away
    FAILED = "FAILED"  # the run did not produce a grade (credits refunded)


class AssignmentAIGrade(SQLModel, table=True):
    __table_args__ = (
        UniqueConstraint(
            "assignment_id", "user_id", name="uq_assignmentaigrade_assignment_user"
        ),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    assignment_ai_grade_uuid: str = Field(index=True)
    assignment_id: int = Field(
        sa_column=Column(
            "assignment_id",
            ForeignKey("assignment.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        )
    )
    user_id: int = Field(
        sa_column=Column(
            "user_id", ForeignKey("user.id", ondelete="CASCADE"), nullable=False
        )
    )
    org_id: int = Field(
        sa_column=Column(
            "org_id", ForeignKey("organization.id", ondelete="CASCADE"), nullable=False
        )
    )
    # AIGradeStatusEnum / AIGradingModeEnum values, stored as plain strings.
    status: str = Field(default=AIGradeStatusEnum.DRAFT.value)
    mode: str = Field(default="SUGGEST")
    attempt_number: int = 1
    overall_feedback: Optional[str] = Field(default=None, sa_column=Column(Text))
    # [{assignment_task_uuid, title, assignment_type, score, max_score,
    #   feedback, scored_by: "ai" | "checker", submitted}]
    tasks: List[Dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSON))
    confidence: Optional[str] = None  # high | medium | low
    notes: Optional[str] = Field(default=None, sa_column=Column(Text))
    # What the model was given, for the teacher: file kinds, media durations,
    # a transcript excerpt per audio/video file, truncation notes.
    sources: List[Dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSON))
    credits_charged: int = 0
    model: Optional[str] = None
    error: Optional[str] = None
    # Who asked for it (None = automatic on hand-in) and who applied it
    # (None = applied automatically).
    triggered_by: Optional[int] = None
    applied_by: Optional[int] = None
    creation_date: str = ""
    update_date: str = ""


class AssignmentAIGradeTaskOverride(SQLModel):
    assignment_task_uuid: str
    score: Optional[float] = None
    feedback: Optional[str] = None


class AssignmentAIGradeAccept(SQLModel):
    """Body of the accept endpoint: the teacher's edits, if any."""

    overall_feedback: Optional[str] = None
    tasks: Optional[List[AssignmentAIGradeTaskOverride]] = None


class AssignmentAIGradeRead(SQLModel):
    assignment_ai_grade_uuid: str
    assignment_id: int
    user_id: int
    status: str
    mode: str
    attempt_number: int
    overall_feedback: Optional[str] = None
    tasks: List[Dict[str, Any]] = []
    confidence: Optional[str] = None
    notes: Optional[str] = None
    sources: List[Dict[str, Any]] = []
    credits_charged: int = 0
    model: Optional[str] = None
    error: Optional[str] = None
    triggered_by: Optional[int] = None
    applied_by: Optional[int] = None
    creation_date: str = ""
    update_date: str = ""
