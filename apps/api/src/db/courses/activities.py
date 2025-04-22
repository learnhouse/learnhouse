from typing import Optional
from sqlalchemy import JSON, Column, ForeignKey, Integer
from sqlmodel import Field, SQLModel
from enum import Enum


class ActivityTypeEnum(str, Enum):
    TYPE_VIDEO = "TYPE_VIDEO"
    TYPE_DOCUMENT = "TYPE_DOCUMENT"
    TYPE_DYNAMIC = "TYPE_DYNAMIC"
    TYPE_ASSIGNMENT = "TYPE_ASSIGNMENT"
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
    # Assignment
    SUBTYPE_ASSIGNMENT_ANY = "SUBTYPE_ASSIGNMENT_ANY"
    # Custom
    SUBTYPE_CUSTOM = "SUBTYPE_CUSTOM"


class ActivityBase(SQLModel):
    name: str
    activity_type: ActivityTypeEnum 
    activity_sub_type: ActivitySubTypeEnum 
    content: dict = Field(default={}, sa_column=Column(JSON))
    details: Optional[dict] = Field(default=None, sa_column=Column(JSON))
    published: bool = False


class Activity(ActivityBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(
        sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"))
    )
    course_id: int = Field(
        default=None,
        sa_column=Column(Integer, ForeignKey("course.id", ondelete="CASCADE")),
    )
    activity_uuid: str = ""
    creation_date: str = ""
    update_date: str = ""


class ActivityCreate(ActivityBase):
    chapter_id: int
    activity_type: ActivityTypeEnum = ActivityTypeEnum.TYPE_CUSTOM
    activity_sub_type: ActivitySubTypeEnum = ActivitySubTypeEnum.SUBTYPE_CUSTOM
    details: dict = Field(default={}, sa_column=Column(JSON))
    pass


class ActivityUpdate(ActivityBase):
    name: Optional[str]
    content: dict = Field(default={}, sa_column=Column(JSON))
    activity_type: Optional[ActivityTypeEnum] 
    activity_sub_type: Optional[ActivitySubTypeEnum] 
    details: Optional[dict] = Field(default=None, sa_column=Column(JSON))
    published_version: Optional[int]
    version: Optional[int]


class ActivityRead(ActivityBase):
    id: int
    org_id: int
    course_id: int
    activity_uuid: str
    creation_date: str
    update_date: str
    details: Optional[dict] = Field(default=None, sa_column=Column(JSON))
    pass
