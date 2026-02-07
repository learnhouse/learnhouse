from enum import Enum
from typing import Optional
from sqlalchemy import Column, ForeignKey, Integer, Index
from sqlmodel import Field, SQLModel


class ResourceAuthorshipEnum(str, Enum):
    CREATOR = "CREATOR"
    CONTRIBUTOR = "CONTRIBUTOR"
    MAINTAINER = "MAINTAINER"
    REPORTER = "REPORTER"

class ResourceAuthorshipStatusEnum(str, Enum):
    ACTIVE = "ACTIVE"
    PENDING = "PENDING"
    INACTIVE = "INACTIVE"


class ResourceAuthor(SQLModel, table=True):
    __table_args__ = (
        Index("ix_resourceauthor_resource_uuid_user_id", "resource_uuid", "user_id"),
    )
    id: Optional[int] = Field(default=None, primary_key=True)
    resource_uuid: str = Field(index=True)
    user_id: int = Field(
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="CASCADE"), index=True)
    )
    authorship: ResourceAuthorshipEnum
    authorship_status: ResourceAuthorshipStatusEnum
    creation_date: str = ""
    update_date: str = ""
