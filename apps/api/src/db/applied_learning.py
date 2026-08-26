from datetime import datetime, timezone
from typing import Optional

from sqlmodel import SQLModel, Field, Column, JSON


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat()


class AppliedLearningEntry(SQLModel, table=True):
    """A learner's durable record of applying a lesson in real work."""

    __tablename__ = "applied_learning_entry"

    id: Optional[int] = Field(default=None, primary_key=True)
    entry_uuid: str = Field(index=True, unique=True)
    user_id: int = Field(index=True)
    org_id: int = Field(index=True)
    course_uuid: str = Field(index=True)
    activity_uuid: str = Field(index=True)
    activity_name: str = ""
    module_name: str = ""
    planned_application: str = ""
    previous_application: str = ""
    measurable_change: str = ""
    evidence_notes: str = ""
    application_status: str = Field(default="planned", index=True)
    created_at: str = Field(default_factory=utc_now_iso)
    updated_at: str = Field(default_factory=utc_now_iso)


class AppliedLearningEntryRead(SQLModel):
    id: int
    entry_uuid: str
    user_id: int
    org_id: int
    course_uuid: str
    activity_uuid: str
    activity_name: str
    module_name: str
    planned_application: str
    previous_application: str
    measurable_change: str
    evidence_notes: str
    application_status: str
    created_at: str
    updated_at: str


class AppliedLearningCapstone(SQLModel, table=True):
    """A capstone draft assembled from selected applied-learning entries."""

    __tablename__ = "applied_learning_capstone"

    id: Optional[int] = Field(default=None, primary_key=True)
    capstone_uuid: str = Field(index=True, unique=True)
    user_id: int = Field(index=True)
    org_id: int = Field(index=True)
    title: str
    challenge: str = ""
    what_i_applied: str = ""
    measurable_impact: str = ""
    lessons_learned: str = ""
    next_steps: str = ""
    selected_entry_uuids: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    status: str = Field(default="draft", index=True)
    created_at: str = Field(default_factory=utc_now_iso)
    updated_at: str = Field(default_factory=utc_now_iso)


class AppliedLearningCapstoneRead(SQLModel):
    id: int
    capstone_uuid: str
    user_id: int
    org_id: int
    title: str
    challenge: str
    what_i_applied: str
    measurable_impact: str
    lessons_learned: str
    next_steps: str
    selected_entry_uuids: list[str]
    status: str
    created_at: str
    updated_at: str
