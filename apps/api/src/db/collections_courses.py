from typing import Optional
from sqlmodel import Field, SQLModel


class CollectionCourse(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    collection_id: int = Field(default=None, foreign_key="collection.id")
    course_id: int = Field(default=None, foreign_key="course.id")
    org_id: int = Field(default=None, foreign_key="organization.id")
    creation_date: str
    update_date: str
