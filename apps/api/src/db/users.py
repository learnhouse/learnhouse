from typing import Optional, TYPE_CHECKING
from pydantic import BaseModel, EmailStr
from sqlmodel import Field, SQLModel
from sqlalchemy import JSON, Column, Index
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
    email_verified: bool = False
    last_login_at: Optional[str] = None
    signup_method: Optional[str] = None
    is_superadmin: bool = False


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


class APITokenUser(SQLModel):
    """
    Represents an authenticated API token request.
    Used to identify requests made with API tokens instead of user sessions.
    """
    id: int = 0  # Token ID
    user_uuid: str = "apitoken_user"  # Will be set to token_uuid
    username: str = "api_token"
    org_id: int  # CRITICAL: Organization scope - token can only access this org
    rights: Optional[dict] = None  # Token's rights/permissions
    token_name: str = ""
    created_by_user_id: int = 0  # User who created the token


class User(UserBase, table=True):
    __table_args__ = (
        Index("ix_user_email", "email"),
        {"extend_existing": True},
    )
    id: Optional[int] = Field(default=None, primary_key=True)
    password: str = ""
    user_uuid: str = Field(default="", index=True)
    email_verified: bool = False
    email_verified_at: Optional[str] = None
    failed_login_attempts: int = 0
    locked_until: Optional[str] = None
    last_login_at: Optional[str] = None
    last_login_ip: Optional[str] = None
    signup_method: Optional[str] = None
    is_superadmin: bool = Field(default=False)
    creation_date: str = ""
    update_date: str = ""


# Rebuild models to resolve forward references after all classes are defined
def rebuild_models():
    from src.db.organizations import OrganizationRead  # noqa: F401
    UserRoleWithOrg.model_rebuild()
    UserSession.model_rebuild()

rebuild_models()
