from typing import Optional
from sqlalchemy import JSON, Column
from sqlmodel import Field, SQLModel
from enum import Enum


class ActivityTypeEnum(str, Enum):
    TYPE_VIDEO = "TYPE_VIDEO"
    TYPE_DOCUMENT = "TYPE_DOCUMENT"
    TYPE_DYNAMIC = "TYPE_DYNAMIC"
    TYPE_ASSESSMENT = "TYPE_ASSESSMENT"
    TYPE_CUSTOM = "TYPE_CUSTOM"


class ActivitySubTypeEnum(str, Enum):
    # Dynamic
    SUBTYPE_DYNAMIC_PAGE = "SUBTYPE_DYNAMIC_PAGE"
    # Video
    SUBTYPE_VIDEO_YOUTUBE = "SUBTYPE_VIDEO_YOUTUBE"
    SUBTYPE_VIDEO_HOSTED = "SUBTYPE_VIDEO_HOSTED"
    # Document
    SUBTYPE_DOCUMENT_PDF = "SUBTYPE_DOCUMENT_PDF"
    SUBTYPE_DOCUMENT_DOC = "SUBTYPE_DOCUMENT_DOC"
    # Assessment
    SUBTYPE_ASSESSMENT_QUIZ = "SUBTYPE_ASSESSMENT_QUIZ"
    # Custom
    SUBTYPE_CUSTOM = "SUBTYPE_CUSTOM"


class ActivityBase(SQLModel):
    name: str
    activity_type: ActivityTypeEnum = ActivityTypeEnum.TYPE_CUSTOM
    activity_sub_type: ActivitySubTypeEnum = ActivitySubTypeEnum.SUBTYPE_CUSTOM
    content: dict = Field(default={}, sa_column=Column(JSON))
    published_version: int
    version: int
    course_id: int = Field(default=None, foreign_key="course.id")


class Activity(ActivityBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(default=None, foreign_key="organization.id")
    activity_uuid: str = ""
    creation_date: str = ""
    update_date: str = ""


class ActivityCreate(ActivityBase):
    org_id: int = Field(default=None, foreign_key="organization.id")
    course_id: int = Field(default=None, foreign_key="course.id")
    chapter_id: int
    pass


class ActivityUpdate(ActivityBase):
    activity_id: int
    name: Optional[str]
    activity_type: Optional[ActivityTypeEnum]
    activity_sub_type: Optional[ActivitySubTypeEnum]
    content: dict = Field(default={}, sa_column=Column(JSON))
    published_version: Optional[int]
    version: Optional[int]


class ActivityRead(ActivityBase):
    id: int
    activity_uuid: str
    creation_date: str
    update_date: str
    pass
