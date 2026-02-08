from typing import Optional
from sqlalchemy import Column, ForeignKey, Integer
from sqlmodel import Field, SQLModel


class DocSectionBase(SQLModel):
    name: str
    description: Optional[str] = None
    icon: Optional[str] = Field(default=None)
    published: bool = Field(default=False)
    order: int = Field(default=0)


class DocSection(DocSectionBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(
        sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"), index=True)
    )
    docspace_id: int = Field(
        sa_column=Column(Integer, ForeignKey("docspace.id", ondelete="CASCADE"), index=True)
    )
    docsection_uuid: str = Field(default="", index=True)
    slug: str = Field(default="")
    creation_date: str = ""
    update_date: str = ""


class DocSectionCreate(SQLModel):
    name: str
    description: Optional[str] = None
    icon: Optional[str] = None
    published: bool = False
    order: int = 0


class DocSectionUpdate(SQLModel):
    name: Optional[str] = None
    description: Optional[str] = None
    icon: Optional[str] = None
    published: Optional[bool] = None
    slug: Optional[str] = None
    order: Optional[int] = None


class SectionChildOrderItem(SQLModel):
    type: str  # "page" or "group"
    id: int


class DocSectionRead(DocSectionBase):
    id: int
    org_id: int
    docspace_id: int
    docsection_uuid: str
    slug: str
    creation_date: str
    update_date: str
