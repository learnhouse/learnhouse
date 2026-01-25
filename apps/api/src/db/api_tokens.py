from typing import Optional, Union
from pydantic import BaseModel
from sqlalchemy import JSON, Column, ForeignKey, Integer, String, Index
from sqlmodel import Field, SQLModel
from src.db.roles import Rights


class APITokenBase(SQLModel):
    """Base model for API tokens"""
    name: str = Field(max_length=100)
    description: Optional[str] = Field(default=None, max_length=500)
    rights: Optional[Union[Rights, dict]] = Field(default=None, sa_column=Column(JSON))


class APIToken(APITokenBase, table=True):
    """Database model for API tokens"""
    __tablename__ = "apitoken"
    __table_args__ = (
        Index("ix_apitoken_token_hash", "token_hash"),
        Index("ix_apitoken_org_id", "org_id"),
        {"extend_existing": True}
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    token_uuid: str = Field(default="", max_length=100)  # format: apitoken_{uuid4()}
    token_prefix: str = Field(default="", max_length=12)  # first 12 chars, e.g., "lh_abc12345"
    token_hash: str = Field(default="", sa_column=Column(String(64)))  # SHA-256 hash, 64 chars
    org_id: int = Field(
        sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False)
    )
    created_by_user_id: int = Field(
        sa_column=Column(Integer, ForeignKey("user.id"), nullable=False)
    )
    creation_date: str = ""
    update_date: str = ""
    last_used_at: Optional[str] = None
    expires_at: Optional[str] = None  # None = never expires
    is_active: bool = Field(default=True)  # False = revoked


class APITokenCreate(BaseModel):
    """Model for creating a new API token"""
    name: str
    description: Optional[str] = None
    rights: Optional[Union[Rights, dict]] = None
    expires_at: Optional[str] = None


class APITokenUpdate(BaseModel):
    """Model for updating an API token"""
    name: Optional[str] = None
    description: Optional[str] = None
    rights: Optional[Union[Rights, dict]] = None
    expires_at: Optional[str] = None


class APITokenRead(BaseModel):
    """Model for reading an API token (without sensitive data)"""
    id: int
    token_uuid: str
    name: str
    description: Optional[str] = None
    token_prefix: str
    org_id: int
    rights: Optional[Union[Rights, dict]] = None
    created_by_user_id: int
    creation_date: str
    update_date: str
    last_used_at: Optional[str] = None
    expires_at: Optional[str] = None
    is_active: bool


class APITokenCreatedResponse(BaseModel):
    """
    Response model when a new API token is created.
    This is the ONLY time the full token is shown.
    """
    token: str  # The full token (only shown once!)
    token_uuid: str
    name: str
    description: Optional[str] = None
    token_prefix: str
    org_id: int
    rights: Optional[Union[Rights, dict]] = None
    created_by_user_id: int
    creation_date: str
    expires_at: Optional[str] = None
