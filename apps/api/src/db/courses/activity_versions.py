from typing import Optional
from sqlalchemy import JSON, Column, ForeignKey, Integer, DateTime
from sqlmodel import Field, SQLModel
from datetime import datetime


class ActivityVersionBase(SQLModel):
    """Base model for activity versions"""
    content: dict = Field(default_factory=dict, sa_column=Column(JSON))
    version_number: int
    created_by_id: Optional[int] = Field(
        default=None,
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="SET NULL"))
    )


class ActivityVersion(ActivityVersionBase, table=True):
    """
    Stores historical versions of activity content.
    Each save creates a new version, keeping the last MAX_ACTIVITY_VERSIONS saves.
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    activity_id: int = Field(
        sa_column=Column(Integer, ForeignKey("activity.id", ondelete="CASCADE"))
    )
    org_id: int = Field(
        sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"))
    )
    created_at: datetime = Field(
        default_factory=datetime.utcnow,
        sa_column=Column(DateTime, default=datetime.utcnow)
    )


class ActivityVersionRead(ActivityVersionBase):
    """Read model for activity versions"""
    id: int
    activity_id: int
    org_id: int
    created_at: datetime
    created_by_username: Optional[str] = None
    created_by_avatar: Optional[str] = None


class ActivityStateRead(SQLModel):
    """
    Lightweight model for checking activity state for conflict detection.
    Used to check if remote state has changed since user started editing.
    """
    activity_uuid: str
    update_date: str
    current_version: int
    last_modified_by_id: Optional[int] = None
    last_modified_by_username: Optional[str] = None
