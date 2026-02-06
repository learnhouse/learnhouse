from typing import Optional
from pydantic import BaseModel
from sqlalchemy import JSON, Column, ForeignKey, Integer
from sqlmodel import Field, SQLModel
from enum import Enum

from src.db.trail_steps import TrailStep


class TrailRunEnum(str, Enum):
    RUN_TYPE_COURSE = "RUN_TYPE_COURSE"


class StatusEnum(str, Enum):
    STATUS_IN_PROGRESS = "STATUS_IN_PROGRESS"
    STATUS_COMPLETED = "STATUS_COMPLETED"
    STATUS_PAUSED = "STATUS_PAUSED"
    STATUS_CANCELLED = "STATUS_CANCELLED"


class TrailRun(SQLModel, table=True):
    __table_args__ = {"extend_existing": True}
    id: Optional[int] = Field(default=None, primary_key=True)
    data: dict = Field(default_factory=dict, sa_column=Column(JSON))
    status: StatusEnum = StatusEnum.STATUS_IN_PROGRESS
    # foreign keys
    trail_id: int = Field(
        sa_column=Column(Integer, ForeignKey("trail.id", ondelete="CASCADE"), index=True)
    )
    course_id: int = Field(
        sa_column=Column(Integer, ForeignKey("course.id", ondelete="CASCADE"), index=True)
    )
    org_id: int = Field(
        sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"))
    )
    user_id: int = Field(
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="CASCADE"), index=True)
    )
    # timestamps
    creation_date: str
    update_date: str


class TrailRunCreate(SQLModel):
    data: dict = Field(default_factory=dict)
    status: StatusEnum = StatusEnum.STATUS_IN_PROGRESS
    trail_id: int
    course_id: int
    org_id: int
    user_id: int
    creation_date: str
    update_date: str


# trick because Lists are not supported in SQLModel (runs: list[TrailStep] )
class TrailRunRead(BaseModel):
    id: Optional[int] = None
    data: dict = Field(default_factory=dict)
    status: StatusEnum = StatusEnum.STATUS_IN_PROGRESS
    # foreign keys
    trail_id: Optional[int] = None
    course_id: Optional[int] = None
    org_id: Optional[int] = None
    user_id: Optional[int] = None
    # course object
    course: Optional[dict] = None
    # timestamps
    creation_date: Optional[str] = None
    update_date: Optional[str] = None
    # number of activities in course
    course_total_steps: int = 0
    steps: list[TrailStep] = Field(default_factory=list)
