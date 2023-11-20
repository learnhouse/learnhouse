from typing import Optional
from sqlmodel import Field, SQLModel

class CourseChapter(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    order: int
    course_id: int = Field(default=None, foreign_key="course.id")
    chapter_id: int = Field(default=None, foreign_key="chapter.id")
    org_id : int = Field(default=None, foreign_key="organization.id")
    creation_date: str
    update_date: str