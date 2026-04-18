from typing import Optional, List, Dict, Any
from sqlalchemy import Column, ForeignKey, Index, Integer, Text, JSON
from sqlmodel import Field, SQLModel


DEFAULT_MODERATION_SETTINGS: Dict[str, Any] = {
    "block_links": False,
    "min_post_length": 0,
    "max_post_length": 0,
    "max_comment_length": 0,
    "slow_mode_seconds": 0,
    "max_posts_per_day": 0,
    "min_account_age_days": 0,
    "require_email_verified": False,
    "disable_reactions": False,
    "auto_lock_days": 0,
}


class CommunityBase(SQLModel):
    name: str
    description: Optional[str] = Field(default=None, sa_column=Column(Text))
    public: bool = True
    thumbnail_image: Optional[str] = Field(default="")


class Community(CommunityBase, table=True):
    __table_args__ = (
        Index("ix_community_org_id", "org_id"),
        Index("ix_community_course_id", "course_id"),
    )
    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(
        sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"))
    )
    course_id: Optional[int] = Field(
        default=None,
        sa_column=Column(Integer, ForeignKey("course.id", ondelete="SET NULL"))
    )
    community_uuid: str = Field(default="", index=True)
    moderation_words: List[str] = Field(default=[], sa_column=Column(JSON, default=[]))
    moderation_settings: Optional[Dict[str, Any]] = Field(
        default=None, sa_column=Column(JSON, nullable=True)
    )
    creation_date: str = ""
    update_date: str = ""


class CommunityCreate(CommunityBase):
    org_id: int = Field(default=None, foreign_key="organization.id")
    course_id: Optional[int] = Field(default=None, foreign_key="course.id")


class CommunityUpdate(SQLModel):
    name: Optional[str] = None
    description: Optional[str] = None
    public: Optional[bool] = None
    moderation_words: Optional[List[str]] = None
    moderation_settings: Optional[Dict[str, Any]] = None


class CommunityRead(CommunityBase):
    id: int
    org_id: int = Field(default=None, foreign_key="organization.id")
    course_id: Optional[int] = Field(default=None, foreign_key="course.id")
    community_uuid: str
    moderation_words: List[str] = []
    moderation_settings: Optional[Dict[str, Any]] = None
    creation_date: str
    update_date: str
