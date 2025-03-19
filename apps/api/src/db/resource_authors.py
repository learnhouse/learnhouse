from enum import Enum
from typing import Optional
from sqlalchemy import Column, ForeignKey, Integer
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
    id: Optional[int] = Field(default=None, primary_key=True)
    resource_uuid: str
    user_id: int = Field(
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="CASCADE"))
    )
    authorship: ResourceAuthorshipEnum = ResourceAuthorshipEnum.CREATOR
    authorship_status: ResourceAuthorshipStatusEnum = ResourceAuthorshipStatusEnum.ACTIVE
    creation_date: str = ""
    update_date: str = ""
