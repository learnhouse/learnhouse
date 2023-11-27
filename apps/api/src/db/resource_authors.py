from enum import Enum
from typing import Optional, Union
from pydantic import BaseModel
from sqlalchemy import JSON, Column
from sqlmodel import Field, SQLModel


class ResourceAuthorshipEnum(str, Enum):
    CREATOR = "CREATOR"
    MAINTAINER = "MAINTAINER"
    REPORTER = "REPORTER"


class ResourceAuthor(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    resource_uuid: str
    user_id: int = Field(default=None, foreign_key="user.id")
    authorship: ResourceAuthorshipEnum = ResourceAuthorshipEnum.CREATOR
    creation_date: str = ""
    update_date: str = ""
