from typing import Optional
from pydantic import BaseModel
from sqlalchemy import Column, ForeignKey, Integer, String, Index
from sqlmodel import Field, SQLModel


class SuperadminAPITokenBase(SQLModel):
    """Base model for superadmin API tokens (cross-org)."""
    name: str = Field(max_length=100)
    description: Optional[str] = Field(default=None, max_length=500)


class SuperadminAPIToken(SuperadminAPITokenBase, table=True):
    """Database model for superadmin API tokens.

    Distinct from the org-scoped APIToken: no org_id (cross-org by design),
    no rights (all-or-nothing scope). Token secret prefix is ``lh_sa_`` to
    distinguish from org tokens (``lh_``).
    """
    __tablename__ = "superadmin_apitoken"
    __table_args__ = (
        Index("ix_superadmin_apitoken_token_hash", "token_hash"),
        Index("ix_superadmin_apitoken_created_by", "created_by_user_id"),
        {"extend_existing": True},
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    token_uuid: str = Field(default="", max_length=100)  # satoken_{uuid4()}
    token_prefix: str = Field(default="", max_length=15)  # first 15 chars, e.g. "lh_sa_abc1234"
    token_hash: str = Field(default="", sa_column=Column(String(64)))  # SHA-256 hex
    created_by_user_id: int = Field(
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="CASCADE"), nullable=False)
    )
    creation_date: str = ""
    update_date: str = ""
    last_used_at: Optional[str] = None
    expires_at: Optional[str] = None  # None = never expires
    is_active: bool = Field(default=True)  # False = revoked


class SuperadminAPITokenCreate(BaseModel):
    name: str
    description: Optional[str] = None
    expires_at: Optional[str] = None


class SuperadminAPITokenUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    expires_at: Optional[str] = None


class SuperadminAPITokenRead(BaseModel):
    id: int
    token_uuid: str
    name: str
    description: Optional[str] = None
    token_prefix: str
    created_by_user_id: int
    creation_date: str
    update_date: str
    last_used_at: Optional[str] = None
    expires_at: Optional[str] = None
    is_active: bool


class SuperadminAPITokenCreatedResponse(BaseModel):
    """Returned only on creation — the only response that includes the plaintext token."""
    token: str
    token_uuid: str
    name: str
    description: Optional[str] = None
    token_prefix: str
    created_by_user_id: int
    creation_date: str
    expires_at: Optional[str] = None
