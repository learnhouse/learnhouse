from enum import Enum
from typing import Optional
from sqlmodel import Field, SQLModel
from sqlalchemy import ForeignKey, JSON, Column, Integer


class TrailStepTypeEnum(str, Enum):
    STEP_TYPE_READABLE_ACTIVITY = "STEP_TYPE_READABLE_ACTIVITY"
    STEP_TYPE_ASSIGNMENT_ACTIVITY = "STEP_TYPE_ASSIGNMENT_ACTIVITY"
    STEP_TYPE_CUSTOM_ACTIVITY = "STEP_TYPE_CUSTOM_ACTIVITY"


class TrailStep(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    complete: bool
    teacher_verified: bool
    grade: str
    data: dict = Field(default={}, sa_column=Column(JSON))
    # foreign keys
    trailrun_id: int = Field(
        sa_column=Column(Integer, ForeignKey("trailrun.id", ondelete="CASCADE"))
    )
    trail_id: int = Field(
        sa_column=Column(Integer, ForeignKey("trail.id", ondelete="CASCADE"))
    )
    activity_id: int = Field(
        sa_column=Column(Integer, ForeignKey("activity.id", ondelete="CASCADE"))
    )
    course_id: int = Field(
        sa_column=Column(Integer, ForeignKey("course.id", ondelete="CASCADE"))
    )
    org_id: int = Field(
        sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"))
    )
    user_id: int = Field(
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="CASCADE"))
    )
    # timestamps
    creation_date: str
    update_date: str


# note : prepare assignments support
# an assignment object will be linked to a trail step object in the future
