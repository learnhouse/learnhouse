from typing import Any, List, Optional
from pydantic import BaseModel
from sqlalchemy import Column, ForeignKey
from sqlmodel import Field, SQLModel
from src.db.activities import ActivityRead


class ChapterBase(SQLModel):
    name: str
    description: Optional[str] = ""
    thumbnail_image: Optional[str] = ""
    org_id: int = Field(default=None, foreign_key="organization.id")
    course_id: int = Field(
        sa_column=Column("course_id", ForeignKey("course.id", ondelete="CASCADE"))
    )


class Chapter(ChapterBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    course_id: int = Field(
        sa_column=Column("course_id", ForeignKey("course.id", ondelete="CASCADE"))
    )
    chapter_uuid: str = ""
    creation_date: str = ""
    update_date: str = ""


class ChapterCreate(ChapterBase):
    # referenced order here will be ignored and just used for validation
    # used order will be the next available.
    pass


class ChapterUpdate(ChapterBase):
    name: Optional[str]
    description: Optional[str]
    thumbnail_image: Optional[str]
    course_id: Optional[int]
    org_id: Optional[int]


class ChapterRead(ChapterBase):
    id: int
    activities: List[ActivityRead]
    chapter_uuid: str
    creation_date: str
    update_date: str
    pass


class ActivityOrder(BaseModel):
    activity_id: int


class ChapterOrder(BaseModel):
    chapter_id: int
    activities_order_by_ids: List[ActivityOrder]


class ChapterUpdateOrder(BaseModel):
    chapter_order_by_ids: List[ChapterOrder]


class DepreceatedChaptersRead(BaseModel):
    chapterOrder: Any
    chapters: Any
    activities: Any
    pass
