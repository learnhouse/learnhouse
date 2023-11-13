from typing import Optional
from sqlmodel import Field, SQLModel


class OrganizationBase(SQLModel):
    name: str
    description: Optional[str] = ""
    slug: str
    email: str
    logo_image: Optional[str] = ""


class Organization(OrganizationBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    org_uuid: str = ""
    creation_date: str = ""
    update_date: str = ""

class OrganizationUpdate(OrganizationBase):
    org_id: int

class OrganizationCreate(OrganizationBase):
    pass


class OrganizationRead(OrganizationBase):
    id: int
    org_uuid: str
