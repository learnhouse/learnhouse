from typing import Optional
from pydantic import BaseModel
from sqlmodel import Field, SQLModel
from src.db.roles import RoleRead

from src.db.organization_config import OrganizationConfig


class OrganizationBase(SQLModel):
    name: str
    description: Optional[str]
    slug: str
    email: str
    logo_image: Optional[str]


class Organization(OrganizationBase, table=True):
    id: int = Field(default=1, primary_key=True)
    org_uuid: str = ""
    creation_date: str = ""
    update_date: str = ""

class OrganizationWithConfig(BaseModel):
    org: Organization
    config: OrganizationConfig


class OrganizationUpdate(OrganizationBase):
    pass


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
