from typing import Optional, TYPE_CHECKING
from datetime import datetime
from pydantic import BaseModel, EmailStr
from sqlmodel import Field, SQLModel
from sqlalchemy import JSON, Column, Index
from sqlalchemy.dialects.postgresql import JSONB
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
    extra_metadata: Optional[dict] = Field(default=None, sa_column=Column(JSONB))

class UserCreate(UserBase):
    first_name: str = ""
    last_name: str = ""
    password: str


class UserUpdate(UserBase):
    username: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    # SECURITY: must be EmailStr (not str) so the user-profile update path
    # validates the format. UserBase already types email as EmailStr; this
    # redeclaration is kept only to signal it is a required field on update.
    email: EmailStr
    avatar_image: Optional[str] = ""
    bio: Optional[str] = ""
    details: Optional[dict] = Field(default_factory=dict)
    profile: Optional[dict] = Field(default_factory=dict)
    extra_metadata: Optional[dict] = None


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


class UserReadPublic(SQLModel):
    """User model for public-facing endpoints — excludes sensitive fields.

    SECURITY: This is the view returned to *any* authenticated user when they
    look up *another* user (by id/uuid/username, or via usergroup member lists).
    It must therefore NOT inherit from ``UserBase``, because ``UserBase`` (and
    ``UserRead``) expose PII / internal fields — ``email``, ``signup_method``,
    ``is_superadmin``, ``extra_metadata`` — that would leak to anyone who can
    enumerate user ids. ``details`` and ``profile`` ARE included: they are the
    user's own public profile content (bio extension, links, etc.) that the
    public profile page renders, so they are intentionally exposed.
    """
    id: int
    user_uuid: str
    username: str
    first_name: str
    last_name: str
    email_verified: bool = False
    avatar_image: Optional[str] = ""
    bio: Optional[str] = ""
    details: Optional[dict] = None
    profile: Optional[dict] = None


class UserReadAuthor(SQLModel):
    """Minimal author projection for community comments/discussions.

    SECURITY: comment/discussion authors are returned to *every* reader of a
    thread (often anonymous). It must therefore expose ONLY the fields needed to
    render an author chip — never ``email``, ``is_superadmin``, ``signup_method``
    or the raw ``details``/``profile``/``extra_metadata`` blobs that ``UserRead``
    carries. The frontend reads only id/user_uuid/username/name/avatar.
    """
    id: int
    user_uuid: str
    username: str
    first_name: str
    last_name: str
    avatar_image: Optional[str] = ""


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


class SuperadminAPITokenUser(SQLModel):
    """Represents an authenticated cross-org superadmin API token request.

    Deliberately NOT a subclass of APITokenUser — existing
    ``isinstance(user, APITokenUser)`` org-scope checks continue to reject
    org tokens unchanged, while superadmin tokens are handled via their own
    type and the ``require_superadmin`` dependency.
    """
    id: int = 0  # superadmin_apitoken.id (NOT a user id)
    user_uuid: str = "satoken_user"  # set to token_uuid
    username: str = "superadmin_api_token"
    token_name: str = ""
    created_by_user_id: int = 0  # the superadmin user who minted it


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
    password_changed_at: Optional[datetime] = Field(default=None)
    creation_date: str = ""
    update_date: str = ""


# Rebuild models to resolve forward references after all classes are defined
def rebuild_models():
    from src.db.organizations import OrganizationRead  # noqa: F401
    UserRoleWithOrg.model_rebuild()
    UserSession.model_rebuild()

rebuild_models()
