from typing import Optional
from sqlalchemy import Column, ForeignKey, Integer
from sqlmodel import Field, SQLModel


class UserGroupBase(SQLModel):
    name: str
    description: str

class UserGroup(UserGroupBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(
        sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"))
    )
    usergroup_uuid: str = ""
    creation_date: str = ""
    update_date: str = ""

class UserGroupCreate(UserGroupBase):
    org_id: int = Field(default=None, foreign_key="organization.id")
    pass

class UserGroupUpdate(UserGroupBase):
    name: str
    description: str

class UserGroupRead(UserGroupBase):
    id: int
    org_id: int = Field(default=None, foreign_key="organization.id")
    usergroup_uuid: str
    creation_date: str
    update_date: str
    pass
