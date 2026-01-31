from typing import Optional, Literal
from datetime import datetime
from sqlalchemy import Column, ForeignKey, BigInteger, Index
from sqlmodel import Field, SQLModel


class UsageEvent(SQLModel, table=True):
    """
    Event-based usage tracking for billing.
    Records when members/courses are added or removed.
    """
    __table_args__ = (
        Index('ix_usage_event_org_feature_ts', 'org_id', 'feature', 'timestamp'),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("organization.id", ondelete="CASCADE"))
    )
    feature: str  # "members" or "courses"
    event_type: str  # "add" or "remove"
    timestamp: datetime = Field(default_factory=datetime.now)
    usage_after: int  # Total count after this event


class UsageEventRead(SQLModel):
    """Read model for usage events."""
    id: int
    org_id: int
    feature: str
    event_type: str
    timestamp: datetime
    usage_after: int
