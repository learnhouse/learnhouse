from typing import List, Optional, TYPE_CHECKING
from pydantic import BaseModel
from sqlalchemy import JSON, Column
from sqlmodel import Field, SQLModel
from src.db.roles import RoleRead
from src.db.usergroups import UserGroupRead

from src.db.organization_config import OrganizationConfig

if TYPE_CHECKING:
    from src.db.users import UserRead


class OrganizationBase(SQLModel):
    name: str
    description: Optional[str] = None
    about: Optional[str] = None
    socials: Optional[dict] = Field(default_factory=dict, sa_column=Column(JSON))
    links: Optional[dict] = Field(default_factory=dict, sa_column=Column(JSON))
    scripts: Optional[dict] = Field(default_factory=dict, sa_column=Column(JSON))
    logo_image: Optional[str] = None
    thumbnail_image: Optional[str] = None
    previews: Optional[dict] = Field(default_factory=dict, sa_column=Column(JSON))
    explore: Optional[bool] = Field(default=False)
    label: Optional[str] = None
    slug: str
    email: str


class Organization(OrganizationBase, table=True):
    __table_args__ = {"extend_existing": True}
    id: Optional[int] = Field(default=None, primary_key=True)
    org_uuid: str = Field(default="", unique=True)
    slug: str = Field(unique=True, index=True)  # Override to add unique constraint
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
    scripts: Optional[dict] = None
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
    config: Optional[OrganizationConfig | dict] = None
    creation_date: str
    update_date: str


class OrganizationUser(BaseModel):
    user: "UserRead"
    role: RoleRead
    usergroups: List[UserGroupRead] = []
    joined_at: Optional[str] = None


# Rebuild models to resolve forward references after all classes are defined
def rebuild_models():
    from src.db.users import UserRead  # noqa: F401
    OrganizationUser.model_rebuild()

rebuild_models()
