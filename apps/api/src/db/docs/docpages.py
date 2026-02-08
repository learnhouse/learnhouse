from typing import Optional, List
from enum import Enum
from sqlalchemy import Column, ForeignKey, Integer
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


class DocPageTypeEnum(str, Enum):
    MARKDOWN = "MARKDOWN"
    COURSE_ACTIVITY = "COURSE_ACTIVITY"
    LINK = "LINK"
    EMBED = "EMBED"
    NOCODE = "NOCODE"
    COMMUNITY = "COMMUNITY"


class DocPageBase(SQLModel):
    name: str
    page_type: DocPageTypeEnum = Field(default=DocPageTypeEnum.MARKDOWN)
    icon: Optional[str] = Field(default=None)
    published: bool = Field(default=False)
    order: int = Field(default=0)


class DocPage(DocPageBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(
        sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"), index=True)
    )
    docspace_id: int = Field(
        sa_column=Column(Integer, ForeignKey("docspace.id", ondelete="CASCADE"), index=True)
    )
    docsection_id: int = Field(
        sa_column=Column(Integer, ForeignKey("docsection.id", ondelete="CASCADE"), index=True)
    )
    docgroup_id: Optional[int] = Field(
        default=None,
        sa_column=Column(Integer, ForeignKey("docgroup.id", ondelete="SET NULL"), nullable=True, index=True)
    )
    parent_page_id: Optional[int] = Field(
        default=None,
        sa_column=Column(Integer, ForeignKey("docpage.id", ondelete="CASCADE"), nullable=True, index=True)
    )
    docpage_uuid: str = Field(default="", index=True)
    slug: str = Field(default="")
    content: Optional[dict] = Field(default=None, sa_column=Column(JSONB))
    creation_date: str = ""
    update_date: str = ""


class DocPageCreate(SQLModel):
    name: str
    page_type: DocPageTypeEnum = DocPageTypeEnum.MARKDOWN
    icon: Optional[str] = None
    content: Optional[dict] = None
    published: bool = False
    order: int = 0
    parent_page_id: Optional[int] = None


class DocPageUpdate(SQLModel):
    name: Optional[str] = None
    page_type: Optional[DocPageTypeEnum] = None
    icon: Optional[str] = None
    content: Optional[dict] = None
    published: Optional[bool] = None
    slug: Optional[str] = None
    order: Optional[int] = None


class DocPageMove(SQLModel):
    docgroup_uuid: Optional[str] = None  # None = ungroup (move to section level)
    order: Optional[int] = None


class DocPageRead(DocPageBase):
    id: int
    org_id: int
    docspace_id: int
    docsection_id: int
    docgroup_id: Optional[int] = None
    parent_page_id: Optional[int] = None
    docpage_uuid: str
    slug: str
    content: Optional[dict] = None
    creation_date: str
    update_date: str
    subpages: Optional[List] = None


class DocPageSearchResult(SQLModel):
    docpage_uuid: str
    name: str
    slug: str
    page_type: DocPageTypeEnum
    section_slug: str
    parent_page_uuid: Optional[str] = None
