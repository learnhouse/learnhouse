from typing import List, Optional
from sqlalchemy import Column, Enum as SAEnum, ForeignKey, Index, Integer
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel
from enum import Enum
from pydantic import BaseModel, field_validator, model_validator
from src.db.organization_config import CourseEndConfig, safe_course_end_link
from src.db.users import UserReadAuthor
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


class CourseCompletionConfig(CourseEndConfig):
    """Per-course completion screen, stored at ``extra_metadata["course_end"]``.

    Empty text fields fall back to the organization's course-end config, then to
    the screen's defaults. Every option defaults to how the screen looked before
    it was configurable. These are public strings: anyone who can read the
    course sees them.
    """

    title: str = Field(default="", max_length=120)
    show_confetti: bool = True
    show_back_button: bool = True
    secondary_button_text: str = Field(default="", max_length=60)
    secondary_button_link: str = Field(default="", max_length=2048)

    @field_validator("title", "secondary_button_text", "secondary_button_link")
    @classmethod
    def _strip_extra(cls, value: str) -> str:
        return value.strip()

    @field_validator("secondary_button_link")
    @classmethod
    def _safe_secondary_link(cls, value: str) -> str:
        return safe_course_end_link(value, "secondary_button_link")

    @model_validator(mode="after")
    def _secondary_needs_text(self) -> "CourseCompletionConfig":
        if self.secondary_button_link and not self.secondary_button_text:
            raise ValueError("secondary_button_text is required when secondary_button_link is set")
        return self


class ThumbnailType(str, Enum):
    IMAGE = "image"
    VIDEO = "video"
    BOTH = "both"


class AuthorWithRole(SQLModel):
    # SECURITY: authors are returned to every reader of the resource (anonymous
    # included on public ones), so only the author-chip projection goes out,
    # never email/is_superadmin/signup_method/extra_metadata.
    user: UserReadAuthor
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
    __table_args__ = (
        Index("ix_course_org_public_published_created", "org_id", "public", "published", "creation_date"),
        {"extend_existing": True},
    )
    id: Optional[int] = Field(default=None, primary_key=True)
    thumbnail_type: Optional[ThumbnailType] = Field(
        default=ThumbnailType.IMAGE,
        sa_column=Column(SAEnum(ThumbnailType, name="thumbnail_type"), nullable=True),
    )
    org_id: int = Field(
        sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"), index=True)
    )
    course_uuid: str = Field(default="", index=True)
    # Human-readable URL key, unique per org (see services/seo/slugs.py).
    slug: Optional[str] = Field(default=None, max_length=100)
    # Source language of the course texts (see db/courses/translations.py).
    default_locale: Optional[str] = Field(default=None, max_length=20)
    creation_date: str = ""
    update_date: str = ""
    seo: Optional[dict] = Field(default=None, sa_column=Column(JSONB))
    extra_metadata: Optional[dict] = Field(default=None, sa_column=Column(JSONB))
    # Drip content schedule (see db/courses/drip.py). Only written through the
    # course drip schedule endpoint, which checks the plan.
    drip_settings: Optional[dict] = Field(default=None, sa_column=Column(JSONB))


class CourseCreate(CourseBase):
    org_id: int = Field(default=None, foreign_key="organization.id")
    thumbnail_type: Optional[ThumbnailType] = Field(default=ThumbnailType.IMAGE)
    thumbnail_image: Optional[str] = Field(default="")
    thumbnail_video: Optional[str] = Field(default="")
    extra_metadata: Optional[dict] = None
    pass


class CourseUpdate(SQLModel):
    name: Optional[str] = None
    description: Optional[str] = None
    about: Optional[str] = None
    learnings: Optional[str] = None
    tags: Optional[str] = None
    thumbnail_type: Optional[ThumbnailType] = None
    thumbnail_image: Optional[str] = None
    thumbnail_video: Optional[str] = None
    public: Optional[bool] = None
    published: Optional[bool] = None
    open_to_contributors: Optional[bool] = None
    seo: Optional[dict] = None
    extra_metadata: Optional[dict] = None


class CourseRead(CourseBase):
    id: int
    org_id: int = Field(default=None, foreign_key="organization.id")
    authors: List[AuthorWithRole]
    course_uuid: str
    slug: Optional[str] = None
    creation_date: str
    update_date: str
    thumbnail_type: Optional[ThumbnailType] = Field(default=ThumbnailType.IMAGE)
    thumbnail_image: Optional[str] = Field(default="")
    thumbnail_video: Optional[str] = Field(default="")
    seo: Optional[dict] = None
    extra_metadata: Optional[dict] = None
    drip_settings: Optional[dict] = None
    # Multilingual courses: the source language, the published language
    # versions, and (on reads with ?lang=) the language the texts are in.
    default_locale: Optional[str] = None
    available_locales: List[str] = []
    locale: Optional[str] = None
    requested_locale: Optional[str] = None
    translation_fallback: bool = False


class FullCourseRead(CourseBase):
    id: int
    org_id: int
    org_uuid: Optional[str] = None
    course_uuid: Optional[str] = None
    slug: Optional[str] = None
    creation_date: Optional[str] = None
    update_date: Optional[str] = None
    thumbnail_type: Optional[ThumbnailType] = Field(default=ThumbnailType.IMAGE)
    thumbnail_image: Optional[str] = Field(default="")
    thumbnail_video: Optional[str] = Field(default="")
    seo: Optional[dict] = None
    extra_metadata: Optional[dict] = None
    drip_settings: Optional[dict] = None
    # Multilingual courses: the source language, the published language
    # versions, and (on reads with ?lang=) the language the texts are in.
    default_locale: Optional[str] = None
    available_locales: List[str] = []
    locale: Optional[str] = None
    requested_locale: Optional[str] = None
    translation_fallback: bool = False
    # Chapters, Activities
    chapters: List[ChapterRead]
    authors: List[AuthorWithRole]
    pass


class FullCourseReadWithTrail(CourseBase):
    id: int
    course_uuid: Optional[str] = None
    slug: Optional[str] = None
    creation_date: Optional[str] = None
    update_date: Optional[str] = None
    org_id: int = Field(default=None, foreign_key="organization.id")
    seo: Optional[dict] = None
    extra_metadata: Optional[dict] = None
    drip_settings: Optional[dict] = None
    # Multilingual courses: the source language, the published language
    # versions, and (on reads with ?lang=) the language the texts are in.
    default_locale: Optional[str] = None
    available_locales: List[str] = []
    locale: Optional[str] = None
    requested_locale: Optional[str] = None
    translation_fallback: bool = False
    authors: List[AuthorWithRole]
    # Chapters, Activities
    chapters: List[ChapterRead]
    # Trail
    trail: TrailRead | None = None
    pass
