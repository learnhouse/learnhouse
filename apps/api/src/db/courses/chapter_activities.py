from typing import Optional
from sqlalchemy import BigInteger, Column, ForeignKey, Integer, UniqueConstraint
from sqlmodel import Field, SQLModel

class ChapterActivity(SQLModel, table=True):
    __table_args__ = (
        UniqueConstraint('chapter_id', 'activity_id', name='uq_chapteractivity_chapter_activity'),
    )
    id: Optional[int] = Field(default=None, primary_key=True)
    order: int
    chapter_id: int = Field(sa_column=Column(BigInteger, ForeignKey("chapter.id", ondelete="CASCADE"), index=True))
    activity_id: int = Field(sa_column=Column(BigInteger, ForeignKey("activity.id", ondelete="CASCADE"), index=True))
    course_id : int = Field(sa_column=Column(BigInteger, ForeignKey("course.id", ondelete="CASCADE"), index=True))
    org_id: int = Field(
        sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"), index=True)
    )
    creation_date: str
    update_date: str