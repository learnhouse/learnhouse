from typing import List, Optional
from sqlalchemy import Column, ForeignKey, Integer
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel
from pydantic import BaseModel
from src.db.users import UserRead
from src.db.resource_authors import ResourceAuthorshipEnum, ResourceAuthorshipStatusEnum


class PodcastSEO(BaseModel):
    """SEO configuration for a podcast stored as JSON"""
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


class AuthorWithRole(SQLModel):
    user: UserRead
    authorship: ResourceAuthorshipEnum
    authorship_status: ResourceAuthorshipStatusEnum
    creation_date: str
    update_date: str


class PodcastBase(SQLModel):
    name: str
    description: Optional[str] = None
    about: Optional[str] = None
    tags: Optional[str] = None
    thumbnail_image: Optional[str] = Field(default="")
    public: bool
    published: bool = Field(default=False)


class Podcast(PodcastBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(
        sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"))
    )
    podcast_uuid: str = ""
    creation_date: str = ""
    update_date: str = ""
    seo: Optional[dict] = Field(default=None, sa_column=Column(JSONB))


class PodcastCreate(PodcastBase):
    org_id: int = Field(default=None, foreign_key="organization.id")
    thumbnail_image: Optional[str] = Field(default="")


class PodcastUpdate(SQLModel):
    name: Optional[str] = None
    description: Optional[str] = None
    about: Optional[str] = None
    tags: Optional[str] = None
    thumbnail_image: Optional[str] = Field(default="")
    public: Optional[bool] = None
    published: Optional[bool] = None
    seo: Optional[dict] = None


class PodcastRead(PodcastBase):
    id: int
    org_id: int = Field(default=None, foreign_key="organization.id")
    authors: List[AuthorWithRole]
    podcast_uuid: str
    creation_date: str
    update_date: str
    thumbnail_image: Optional[str] = Field(default="")
    seo: Optional[dict] = None


class PodcastReadWithEpisodeCount(PodcastRead):
    episode_count: int = 0
