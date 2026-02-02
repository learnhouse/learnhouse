from typing import List, Optional
from sqlalchemy import Column, ForeignKey, Integer
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel
from enum import Enum
from pydantic import BaseModel
from src.db.users import UserRead
from src.db.trails import TrailRead
from src.db.courses.chapters import ChapterRead
from src.db.resource_authors import ResourceAuthorshipEnum, ResourceAuthorshipStatusEnum


class CourseSEO(BaseModel):
    """SEO configuration for a course stored as JSON"""
    # Basic SEO
    title: Optional[str] = None
    description: Optional[str] = None
    keywords: Optional[str] = None
    canonical_url: Optional[str] = None
    # Open Graph
    og_title: Optional[str] = None
    og_description: Optional[str] = None
    og_image: Optional[str] = None
    # Twitter Card
    twitter_card: Optional[str] = None  # 'summary' | 'summary_large_image'
    twitter_title: Optional[str] = None
    twitter_description: Optional[str] = None
    # Robots & Structured Data
    robots_noindex: bool = False
    robots_nofollow: bool = False
    enable_jsonld: bool = True


class ThumbnailType(str, Enum):
    IMAGE = "image"
    VIDEO = "video"
    BOTH = "both"


class AuthorWithRole(SQLModel):
    user: UserRead
    authorship: ResourceAuthorshipEnum
    authorship_status: ResourceAuthorshipStatusEnum
    creation_date: str
    update_date: str


class CourseBase(SQLModel):
    name: str
    description: Optional[str] = None
    about: Optional[str] = None
    learnings: Optional[str] = None
    tags: Optional[str] = None
    thumbnail_type: Optional[ThumbnailType] = Field(default=ThumbnailType.IMAGE)
    thumbnail_image: Optional[str] = Field(default="")
    thumbnail_video: Optional[str] = Field(default="")
    public: bool
    published: bool = Field(default=False)
    open_to_contributors: bool


class Course(CourseBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(
        sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"))
    )
    course_uuid: str = ""
    creation_date: str = ""
    update_date: str = ""
    seo: Optional[dict] = Field(default=None, sa_column=Column(JSONB))


class CourseCreate(CourseBase):
    org_id: int = Field(default=None, foreign_key="organization.id")
    thumbnail_type: Optional[ThumbnailType] = Field(default=ThumbnailType.IMAGE)
    thumbnail_image: Optional[str] = Field(default="")
    thumbnail_video: Optional[str] = Field(default="")
    pass


class CourseUpdate(CourseBase):
    name: str
    description: Optional[str] = None
    about: Optional[str] = None
    learnings: Optional[str] = None
    tags: Optional[str] = None
    thumbnail_type: Optional[ThumbnailType] = Field(default=ThumbnailType.IMAGE)
    thumbnail_image: Optional[str] = Field(default="")
    thumbnail_video: Optional[str] = Field(default="")
    public: Optional[bool] = None
    published: Optional[bool] = None
    open_to_contributors: Optional[bool] = None
    seo: Optional[dict] = None


class CourseRead(CourseBase):
    id: int
    org_id: int = Field(default=None, foreign_key="organization.id")
    authors: List[AuthorWithRole]
    course_uuid: str
    creation_date: str
    update_date: str
    thumbnail_type: Optional[ThumbnailType] = Field(default=ThumbnailType.IMAGE)
    thumbnail_image: Optional[str] = Field(default="")
    thumbnail_video: Optional[str] = Field(default="")
    seo: Optional[dict] = None
    pass


class FullCourseRead(CourseBase):
    id: int
    org_id: int
    org_uuid: Optional[str] = None
    course_uuid: Optional[str] = None
    creation_date: Optional[str] = None
    update_date: Optional[str] = None
    thumbnail_type: Optional[ThumbnailType] = Field(default=ThumbnailType.IMAGE)
    thumbnail_image: Optional[str] = Field(default="")
    thumbnail_video: Optional[str] = Field(default="")
    seo: Optional[dict] = None
    # Chapters, Activities
    chapters: List[ChapterRead]
    authors: List[AuthorWithRole]
    pass


class FullCourseReadWithTrail(CourseBase):
    id: int
    course_uuid: Optional[str] = None
    creation_date: Optional[str] = None
    update_date: Optional[str] = None
    org_id: int = Field(default=None, foreign_key="organization.id")
    seo: Optional[dict] = None
    authors: List[AuthorWithRole]
    # Chapters, Activities
    chapters: List[ChapterRead]
    # Trail
    trail: TrailRead | None = None
    pass
