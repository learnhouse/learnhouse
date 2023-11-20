from enum import Enum
from typing import Optional, Union
from pydantic import BaseModel
from sqlalchemy import JSON, Column
from sqlmodel import Field, SQLModel


# Rights
class Permission(BaseModel):
    action_create: bool
    action_read: bool
    action_update: bool
    action_delete: bool

    def __getitem__(self, item):
        return getattr(self, item)


class Rights(BaseModel):
    courses: Permission
    users: Permission
    collections: Permission
    organizations: Permission
    coursechapters: Permission
    activities: Permission

    def __getitem__(self, item):
        return getattr(self, item)


# Database Models


class RoleTypeEnum(str, Enum):
    TYPE_ORGANIZATION = "TYPE_ORGANIZATION"  # Organization roles are associated with an organization, they are used to define the rights of a user in an organization
    TYPE_ORGANIZATION_API_TOKEN = "TYPE_ORGANIZATION_API_TOKEN"  # Organization API Token roles are associated with an organization, they are used to define the rights of an API Token in an organization
    TYPE_GLOBAL = "TYPE_GLOBAL"  # Global roles are not associated with an organization, they are used to define the default rights of a user


class RoleBase(SQLModel):
    name: str
    description: Optional[str]
    rights: Optional[Union[Rights,dict]]  = Field(default={}, sa_column=Column(JSON))


class Role(RoleBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(default=None, foreign_key="organization.id")
    role_type: RoleTypeEnum = RoleTypeEnum.TYPE_GLOBAL
    role_uuid: str = ""
    creation_date: str = ""
    update_date: str = ""


class RoleCreate(RoleBase):
    org_id: Optional[int] = Field(default=None, foreign_key="organization.id")
    


class RoleUpdate(SQLModel):
    role_id: int = Field(default=None, foreign_key="role.id")
    name: Optional[str]
    description: Optional[str]
    rights: Optional[Union[Rights,dict]] = Field(default={}, sa_column=Column(JSON))
