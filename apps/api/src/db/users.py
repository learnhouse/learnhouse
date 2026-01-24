from typing import Optional, TYPE_CHECKING
from pydantic import BaseModel, EmailStr
from sqlmodel import Field, SQLModel
from sqlalchemy import JSON, Column
from src.db.roles import RoleRead

if TYPE_CHECKING:
    from src.db.organizations import OrganizationRead



class UserBase(SQLModel):
    username: str
    first_name: str
    last_name: str
    email: EmailStr
    avatar_image: Optional[str] = ""
    bio: Optional[str] = ""
    details: Optional[dict] = Field(default_factory=dict, sa_column=Column(JSON))
    profile: Optional[dict] = Field(default_factory=dict, sa_column=Column(JSON))

class UserCreate(UserBase):
    first_name: str = ""
    last_name: str = ""
    password: str


class UserUpdate(UserBase):
    username: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: str
    avatar_image: Optional[str] = ""
    bio: Optional[str] = ""
    details: Optional[dict] = Field(default_factory=dict)
    profile: Optional[dict] = Field(default_factory=dict)


class UserUpdatePassword(SQLModel):
    old_password: str
    new_password: str


class UserRead(UserBase):
    id: int
    user_uuid: str


class PublicUser(UserRead):
    pass


class UserRoleWithOrg(BaseModel):
    role: RoleRead
    org: "OrganizationRead"


class UserSession(BaseModel):
    user: UserRead
    roles: list[UserRoleWithOrg]


class AnonymousUser(SQLModel):
    id: int = 0
    user_uuid: str = "user_anonymous"
    username: str = "anonymous"

class InternalUser(SQLModel):
    id: int = 0
    user_uuid: str = "user_internal"
    username: str = "internal"


class User(UserBase, table=True):
    __table_args__ = {"extend_existing": True}
    id: Optional[int] = Field(default=None, primary_key=True)
    password: str = ""
    user_uuid: str = ""
    email_verified: bool = False
    creation_date: str = ""
    update_date: str = ""


# Rebuild models to resolve forward references after all classes are defined
def rebuild_models():
    from src.db.organizations import OrganizationRead  # noqa: F401
    UserRoleWithOrg.model_rebuild()
    UserSession.model_rebuild()

rebuild_models()
