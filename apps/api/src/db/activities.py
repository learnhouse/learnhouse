from typing import Literal, Optional
from sqlalchemy import JSON, Column
from sqlmodel import Field, Session, SQLModel, create_engine, select
from enum import Enum


class ActivityTypeEnum(str, Enum):
    VIDEO = "VIDEO"
    DOCUMENT = "DOCUMENT"
    DYNAMIC = "DYNAMIC"
    ASSESSMENT = "ASSESSMENT"
    CUSTOM = "CUSTOM"


class ActivitySubTypeEnum(str, Enum):
    # Dynamic
    DYNAMIC_PAGE = "DYNAMIC_PAGE"
    # Video
    VIDEO_YOUTUBE = "VIDEO_YOUTUBE"
    VIDEO_HOSTED = "VIDEO_HOSTED"
    # Document
    DOCUMENT_PDF = "DOCUMENT_PDF"
    DOCUMENT_DOC = "DOCUMENT_GDOC"
    # Assessment
    ASSESSMENT_QUIZ = "ASSESSMENT_QUIZ"
    # Custom
    CUSTOM = "CUSTOM"


class ActivityBase(SQLModel):
    name: str
    activity_type: ActivityTypeEnum = ActivityTypeEnum.CUSTOM
    activity_sub_type: ActivitySubTypeEnum = ActivitySubTypeEnum.CUSTOM
    slug: str
    content: dict = Field(default={}, sa_column=Column(JSON))
    published_version: int
    version: int
    org_id: int = Field(default=None, foreign_key="organization.id")
    course_id: int = Field(default=None, foreign_key="course.id")


class Activity(ActivityBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    activity_uuid: str
    creation_date: str
    update_date: str


class ActivityCreate(ActivityBase):
    pass


class ActivityRead(ActivityBase):
    id: int
    activity_uuid: str
    creation_date: str
    update_date: str
    pass
