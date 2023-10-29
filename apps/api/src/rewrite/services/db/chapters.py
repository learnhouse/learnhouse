from typing import Optional
from sqlmodel import Field, SQLModel


class ChapterBase(SQLModel):
    name: str
    description: Optional[str] = ""
    thumbnail_image: Optional[str] = ""
    org_id: int = Field(default=None, foreign_key="organization.id")
    creation_date: str
    update_date: str


class Chapter(ChapterBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    chapter_uuid: str
    creation_date: str
    update_date: str


class ChapterCreate(ChapterBase):
    pass


class ChapterRead(ChapterBase):
    id: int
    chapter_uuid: str
    creation_date: str
    update_date: str
    pass
