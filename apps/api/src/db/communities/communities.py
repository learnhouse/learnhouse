from typing import Optional, List
from sqlalchemy import Column, ForeignKey, Integer, Text, JSON
from sqlmodel import Field, SQLModel


class CommunityBase(SQLModel):
    name: str
    description: Optional[str] = Field(default=None, sa_column=Column(Text))
    public: bool = True
    thumbnail_image: Optional[str] = Field(default="")


class Community(CommunityBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(
        sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"))
    )
    course_id: Optional[int] = Field(
        default=None,
        sa_column=Column(Integer, ForeignKey("course.id", ondelete="SET NULL"))
    )
    community_uuid: str = ""
    moderation_words: List[str] = Field(default=[], sa_column=Column(JSON, default=[]))
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


class CommunityRead(CommunityBase):
    id: int
    org_id: int = Field(default=None, foreign_key="organization.id")
    course_id: Optional[int] = Field(default=None, foreign_key="course.id")
    community_uuid: str
    moderation_words: List[str] = []
    creation_date: str
    update_date: str
