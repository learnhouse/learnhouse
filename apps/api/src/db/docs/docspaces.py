from typing import List, Optional
from sqlalchemy import Column, ForeignKey, Integer
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel
from pydantic import BaseModel


class DocSpaceSEO(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    keywords: Optional[str] = None
    canonical_url: Optional[str] = None
    og_title: Optional[str] = None
    og_description: Optional[str] = None
    og_image: Optional[str] = None
    twitter_card: Optional[str] = None
    twitter_title: Optional[str] = None
    twitter_description: Optional[str] = None
    robots_noindex: bool = False
    robots_nofollow: bool = False
    enable_jsonld: bool = True


class DocSpaceBase(SQLModel):
    name: str
    description: Optional[str] = None
    thumbnail_image: Optional[str] = Field(default="")
    public: bool
    published: bool = Field(default=False)


class DocSpace(DocSpaceBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(
        sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"), index=True)
    )
    docspace_uuid: str = Field(default="", index=True)
    is_default: bool = Field(default=False)
    slug: str = Field(default="")
    creation_date: str = ""
    update_date: str = ""
    seo: Optional[dict] = Field(default=None, sa_column=Column(JSONB))
    nav_config: Optional[dict] = Field(default=None, sa_column=Column(JSONB))


class DocSpaceCreate(DocSpaceBase):
    org_id: int = Field(default=None, foreign_key="organization.id")
    thumbnail_image: Optional[str] = Field(default="")


class DocSpaceUpdate(SQLModel):
    name: Optional[str] = None
    description: Optional[str] = None
    thumbnail_image: Optional[str] = None
    public: Optional[bool] = None
    published: Optional[bool] = None
    slug: Optional[str] = None
    seo: Optional[dict] = None
    nav_config: Optional[dict] = None


class DocSpaceRead(DocSpaceBase):
    id: int
    org_id: int
    docspace_uuid: str
    is_default: bool
    slug: str
    creation_date: str
    update_date: str
    seo: Optional[dict] = None
    nav_config: Optional[dict] = None


class DocSectionInMeta(SQLModel):
    id: int
    org_id: int
    docspace_id: int
    docsection_uuid: str
    name: str
    description: Optional[str] = None
    icon: Optional[str] = None
    published: bool
    slug: str
    order: int
    creation_date: str
    update_date: str
    groups: list = Field(default_factory=list)
    pages: list = Field(default_factory=list)


class FullDocSpaceRead(DocSpaceBase):
    id: int
    org_id: int
    docspace_uuid: str
    is_default: bool
    slug: str
    creation_date: str
    update_date: str
    seo: Optional[dict] = None
    nav_config: Optional[dict] = None
    sections: List[DocSectionInMeta] = Field(default_factory=list)
