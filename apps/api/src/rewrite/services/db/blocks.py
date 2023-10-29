from typing import Optional
from sqlalchemy import JSON, Column
from sqlmodel import Field, SQLModel
from enum import Enum


class BlockTypeEnum(str, Enum):
    QUIZ_BLOCK = "QUIZ_BLOCK"
    VIDEO_BLOCK = "VIDEO_BLOCK"
    DOCUMENT_PDF_BLOCK = "DOCUMENT_PDF_BLOCK"
    IMAGE_BLOCK = "IMAGE_BLOCK"
    CUSTOM = "CUSTOM"


class BlockBase(SQLModel):
    id: Optional[int] = Field(default=None, primary_key=True)
    block_type: BlockTypeEnum = BlockTypeEnum.CUSTOM
    content: dict = Field(default={}, sa_column=Column(JSON))


class Block(BlockBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    content: dict = Field(default={}, sa_column=Column(JSON))
    org_id: int = Field(default=None, foreign_key="organization.id")
    course_id: int = Field(default=None, foreign_key="course.id")
    chapter_id: int = Field(default=None, foreign_key="chapter.id")
    activity_id: int = Field(default=None, foreign_key="activity.id")
    block_uuid: str
    creation_date: str
    update_date: str

class BlockCreate(BlockBase):
    pass

class BlockRead(BlockBase):
    id: int
    org_id: int = Field(default=None, foreign_key="organization.id")
    course_id: int = Field(default=None, foreign_key="course.id")
    chapter_id: int = Field(default=None, foreign_key="chapter.id")
    activity_id: int = Field(default=None, foreign_key="activity.id")
    block_uuid: str
    creation_date: str
    update_date: str
    pass