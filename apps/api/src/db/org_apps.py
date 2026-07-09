from typing import Optional
from pydantic import BaseModel
from sqlalchemy import JSON, Column, ForeignKey, Integer, Index, UniqueConstraint
from sqlmodel import Field, SQLModel


class OrgAppBase(SQLModel):
    """Base model for installed third-party apps"""
    slug: str = Field(max_length=40)
    name: str = Field(max_length=100)
    description: Optional[str] = Field(default=None, max_length=500)
    version: str = Field(max_length=30)


class OrgApp(OrgAppBase, table=True):
    """
    A third-party app installed in an organization.

    Apps are frontend-only static bundles uploaded as zips. They never run
    server-side code; at runtime they act through short-lived app-session
    tokens whose rights are the intersection of the admin-approved scopes
    and the acting user's own rights.
    """
    __tablename__ = "orgapp"
    __table_args__ = (
        Index("ix_orgapp_org_id", "org_id"),
        Index("ix_orgapp_app_uuid", "app_uuid"),
        UniqueConstraint("org_id", "slug", name="uq_orgapp_org_slug"),
        {"extend_existing": True},
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    app_uuid: str = Field(default="", max_length=100)  # format: orgapp_{uuid4()}
    org_id: int = Field(
        sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False)
    )
    created_by_user_id: int = Field(
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="CASCADE"), nullable=False)
    )
    icon_path: Optional[str] = Field(default=None, max_length=255)
    entry_point: str = Field(default="index.html", max_length=255)
    manifest: dict = Field(default={}, sa_column=Column(JSON))
    # Rights-shaped dict derived from the scopes the admin approved at install.
    # None until approved; a pending app has no runtime capability at all.
    approved_scopes: Optional[dict] = Field(default=None, sa_column=Column(JSON))
    status: str = Field(default="pending", max_length=20)  # pending | installed
    enabled: bool = Field(default=False)
    storage_prefix: str = Field(default="", max_length=255)
    creation_date: str = ""
    update_date: str = ""


class OrgAppRead(BaseModel):
    """Read model for an installed app (safe for org members)"""
    id: int
    app_uuid: str
    org_id: int
    slug: str
    name: str
    description: Optional[str] = None
    version: str
    icon_path: Optional[str] = None
    status: str
    enabled: bool
    creation_date: str
    update_date: str


class OrgAppAdminRead(OrgAppRead):
    """Read model for admins — includes scopes and manifest for review"""
    manifest: dict
    approved_scopes: Optional[dict] = None
    requested_scopes: list[str] = []
    created_by_user_id: int


class OrgAppApprove(BaseModel):
    """Admin approval payload: the scope strings being granted.

    Must be a subset of the manifest's requested scopes — the server
    re-validates; the client cannot grant more than the app asked for.
    """
    scopes: list[str]


class OrgAppUpdate(BaseModel):
    """Model for updating an installed app (enable/disable)"""
    enabled: Optional[bool] = None


class OrgAppSessionResponse(BaseModel):
    """Response when the host page mints an app session"""
    token: str
    expires_at: str
    iframe_url: str
    app: OrgAppRead
