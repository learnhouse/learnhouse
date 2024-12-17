from typing import Optional
from pydantic import BaseModel
from sqlmodel import Field, SQLModel, JSON, Column
from src.db.roles import RoleRead

from src.db.organization_config import OrganizationConfig


class OrganizationBase(SQLModel):
    name: str
    description: Optional[str]
    about: Optional[str]
    socials: Optional[dict] = Field(default={}, sa_column=Column(JSON))
    links: Optional[dict] = Field(default={}, sa_column=Column(JSON))
    logo_image: Optional[str]
    thumbnail_image: Optional[str]
    previews: Optional[dict] = Field(default={}, sa_column=Column(JSON))
    explore: Optional[bool] = Field(default=False)
    label: Optional[str]
    slug: str
    email: str


class Organization(OrganizationBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    org_uuid: str = ""
    creation_date: str = ""
    update_date: str = ""

class OrganizationWithConfig(BaseModel):
    org: Organization
    config: OrganizationConfig


class OrganizationUpdate(SQLModel):
    name: Optional[str] = None
    description: Optional[str] = None
    about: Optional[str] = None
    socials: Optional[dict] = None
    links: Optional[dict] = None
    logo_image: Optional[str] = None
    thumbnail_image: Optional[str] = None
    previews: Optional[dict] = None
    label: Optional[str] = None
    slug: Optional[str] = None
    email: Optional[str] = None
    explore: Optional[bool] = None

class OrganizationCreate(OrganizationBase):
    pass


class OrganizationRead(OrganizationBase):
    id: int
    org_uuid: str
    config: Optional[OrganizationConfig | dict]
    creation_date: str
    update_date: str


class OrganizationUser(BaseModel):
    from src.db.users import UserRead
    user: UserRead
    role: RoleRead
