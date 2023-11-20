from typing import Optional
from sqlmodel import Field, SQLModel
from enum import Enum

class ChapterActivity(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    order: int
    chapter_id: int = Field(default=None, foreign_key="chapter.id", )
    activity_id: int = Field(default=None, foreign_key="activity.id")
    course_id : int = Field(default=None, foreign_key="course.id")
    org_id : int = Field(default=None, foreign_key="organization.id")
    creation_date: str
    update_date: str