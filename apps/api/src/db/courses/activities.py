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
    TYPE_SCORM = "TYPE_SCORM"


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
    # SCORM
    SUBTYPE_SCORM_12 = "SUBTYPE_SCORM_12"
    SUBTYPE_SCORM_2004 = "SUBTYPE_SCORM_2004"


class ActivityBase(SQLModel):
    name: str
    activity_type: ActivityTypeEnum 
    activity_sub_type: ActivitySubTypeEnum 
    content: dict = Field(default_factory=dict, sa_column=Column(JSON))
    details: Optional[dict] = Field(default=None, sa_column=Column(JSON))
    published: bool = False


class Activity(ActivityBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(
        sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"), index=True)
    )
    course_id: int = Field(
        default=None,
        sa_column=Column(Integer, ForeignKey("course.id", ondelete="CASCADE"), index=True),
    )
    activity_uuid: str = Field(default="", index=True)
    creation_date: str = ""
    update_date: str = ""
    # Versioning fields
    current_version: int = Field(default=1)
    last_modified_by_id: Optional[int] = Field(
        default=None,
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="SET NULL"))
    )


class ActivityCreate(ActivityBase):
    chapter_id: int
    activity_type: ActivityTypeEnum = ActivityTypeEnum.TYPE_CUSTOM
    activity_sub_type: ActivitySubTypeEnum = ActivitySubTypeEnum.SUBTYPE_CUSTOM
    details: dict = Field(default_factory=dict, sa_column=Column(JSON))
    pass


class ActivityUpdate(SQLModel):
    name: Optional[str] = None
    content: Optional[dict] = None
    activity_type: Optional[ActivityTypeEnum] = None
    activity_sub_type: Optional[ActivitySubTypeEnum] = None
    details: Optional[dict] = None
    published: Optional[bool] = None
    published_version: Optional[int] = None
    version: Optional[int] = None


class ActivityRead(ActivityBase):
    id: int
    org_id: int
    course_id: int
    activity_uuid: str
    creation_date: str
    update_date: str
    details: Optional[dict] = Field(default=None, sa_column=Column(JSON))
    # Versioning fields
    current_version: int = 1
    last_modified_by_id: Optional[int] = None
    last_modified_by_username: Optional[str] = None
