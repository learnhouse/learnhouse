from typing import Optional
from pydantic import BaseModel
from sqlmodel import Field, SQLModel

from src.db.roles import RoleRead
from src.db.organizations import OrganizationRead


class UserBase(SQLModel):
    username: str
    first_name: str
    last_name: str
    email: str
    avatar_image: Optional[str] = ""
    bio: Optional[str] = ""


class UserCreate(UserBase):
    password: str


class UserUpdate(UserBase):
    username: str
    first_name: Optional[str]
    last_name: Optional[str]
    email: str
    avatar_image: Optional[str] = ""
    bio: Optional[str] = ""


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
    org: OrganizationRead


class UserSession(BaseModel):
    user: UserRead
    roles: list[UserRoleWithOrg]


class AnonymousUser(SQLModel):
    id: int = 0
    user_uuid: str = "user_anonymous"
    username: str = "anonymous"


class User(UserBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    password: str = ""
    user_uuid: str = ""
    email_verified: bool = False
    creation_date: str = ""
    update_date: str = ""
