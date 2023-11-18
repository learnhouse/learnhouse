from typing import Optional
from pydantic import BaseModel
from sqlalchemy import JSON, Column
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
    id: Optional[int] = Field(default=None, primary_key=True)
    data: dict = Field(default={}, sa_column=Column(JSON))
    status: StatusEnum = StatusEnum.STATUS_IN_PROGRESS
    # foreign keys
    trail_id: int = Field(default=None, foreign_key="trail.id")
    course_id: int = Field(default=None, foreign_key="course.id")
    org_id: int = Field(default=None, foreign_key="organization.id")
    user_id: int = Field(default=None, foreign_key="user.id")
    # timestamps
    creation_date: str
    update_date: str


class TrailRunCreate(TrailRun):
    pass


# trick because Lists are not supported in SQLModel (runs: list[TrailStep] )
class TrailRunRead(BaseModel):
    id: Optional[int] = Field(default=None, primary_key=True)
    data: dict = Field(default={}, sa_column=Column(JSON))
    status: StatusEnum = StatusEnum.STATUS_IN_PROGRESS
    # foreign keys
    trail_id: int = Field(default=None, foreign_key="trail.id")
    course_id: int = Field(default=None, foreign_key="course.id")
    org_id: int = Field(default=None, foreign_key="organization.id")
    user_id: int = Field(default=None, foreign_key="user.id")
    # timestamps
    creation_date: str
    update_date: str
    steps: list[TrailStep]
    pass
