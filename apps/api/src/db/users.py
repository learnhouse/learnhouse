from typing import Optional
from sqlmodel import Field, SQLModel


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
    user_id: int
    old_password: str
    new_password: str


class UserRead(UserBase):
    id: int

class PublicUser(UserRead):
    pass

class User(UserBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    password: str = ""
    user_uuid: str = ""
    email_verified: bool = False
    creation_date: str = ""
    update_date: str = ""
