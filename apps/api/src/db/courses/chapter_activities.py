from typing import Optional
from sqlalchemy import BigInteger, Column, ForeignKey, Integer
from sqlmodel import Field, SQLModel

class ChapterActivity(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    order: int
    chapter_id: int = Field(sa_column=Column(BigInteger, ForeignKey("chapter.id", ondelete="CASCADE")))
    activity_id: int = Field(sa_column=Column(BigInteger, ForeignKey("activity.id", ondelete="CASCADE")))
    course_id : int = Field(sa_column=Column(BigInteger, ForeignKey("course.id", ondelete="CASCADE")))
    org_id: int = Field(
        sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"))
    )
    creation_date: str
    update_date: str