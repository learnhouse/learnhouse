from typing import Optional
from enum import Enum
from sqlalchemy import Column, ForeignKey, Integer
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


class DocGroupTypeEnum(str, Enum):
    STANDARD = "STANDARD"
    API_REFERENCE = "API_REFERENCE"


class DocGroupBase(SQLModel):
    name: str
    description: Optional[str] = None
    icon: Optional[str] = Field(default=None)
    group_type: DocGroupTypeEnum = Field(default=DocGroupTypeEnum.STANDARD)
    order: int = Field(default=0)


class DocGroup(DocGroupBase, table=True):
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
    docgroup_uuid: str = Field(default="", index=True)
    api_config: Optional[dict] = Field(default=None, sa_column=Column(JSONB))
    creation_date: str = ""
    update_date: str = ""


class DocGroupCreate(SQLModel):
    name: str
    description: Optional[str] = None
    icon: Optional[str] = None
    group_type: DocGroupTypeEnum = DocGroupTypeEnum.STANDARD
    api_config: Optional[dict] = None
    order: int = 0


class DocGroupUpdate(SQLModel):
    name: Optional[str] = None
    description: Optional[str] = None
    icon: Optional[str] = None
    group_type: Optional[DocGroupTypeEnum] = None
    api_config: Optional[dict] = None
    order: Optional[int] = None


class DocGroupRead(DocGroupBase):
    id: int
    org_id: int
    docspace_id: int
    docsection_id: int
    docgroup_uuid: str
    api_config: Optional[dict] = None
    creation_date: str
    update_date: str
