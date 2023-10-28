from typing import Optional
from sqlmodel import Field, Session, SQLModel, create_engine, select


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
    password: Optional[str] = None


class UserRead(UserBase):
    id: int


class User(UserBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    password: str = ""
    user_uuid: str = ""
    email_verified: bool = False
    creation_date: str = ""
    update_date: str = ""
