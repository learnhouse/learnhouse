from enum import Enum
from typing import Optional
from sqlalchemy import JSON, Column
from sqlmodel import Field, SQLModel
from sqlalchemy import BigInteger, Column, ForeignKey
from sqlmodel import Field, SQLModel


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
        sa_column=Column(BigInteger, ForeignKey("trailrun.id", ondelete="CASCADE"))
    )
    trail_id: int = Field(default=None, foreign_key="trail.id")
    activity_id: int = Field(default=None, foreign_key="activity.id")
    course_id: int = Field(default=None, foreign_key="course.id")
    org_id: int = Field(default=None, foreign_key="organization.id")
    user_id: int = Field(default=None, foreign_key="user.id")
    # timestamps
    creation_date: str
    update_date: str


# note : prepare assignments support
# an assignment object will be linked to a trail step object in the future
