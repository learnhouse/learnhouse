from typing import Optional
from datetime import datetime
from enum import Enum
from sqlalchemy import Column, ForeignKey, BigInteger, Index, String, Boolean
from sqlmodel import Field, SQLModel


class PackTypeEnum(str, Enum):
    ai_credits = "ai_credits"
    member_seats = "member_seats"


class PackStatusEnum(str, Enum):
    active = "active"
    cancelled = "cancelled"


class OrgPack(SQLModel, table=True):
    __table_args__ = (
        Index('ix_orgpack_org_status', 'org_id', 'status'),
        Index('ix_orgpack_platform_sub', 'platform_subscription_id', unique=True),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("organization.id", ondelete="CASCADE"))
    )
    pack_type: PackTypeEnum
    pack_id: str  # e.g. "ai_500", "seats_200"
    quantity: int
    status: PackStatusEnum = PackStatusEnum.active
    activated_at: datetime = Field(default_factory=datetime.now)
    cancelled_at: Optional[datetime] = None
    cancel_at_period_end: bool = Field(
        sa_column=Column(Boolean, nullable=False, server_default="false")
    )
    platform_subscription_id: str = Field(
        sa_column=Column(String, nullable=False)
    )


class OrgPackRead(SQLModel):
    id: int
    org_id: int
    pack_type: str
    pack_id: str
    quantity: int
    status: str
    activated_at: datetime
    cancelled_at: Optional[datetime]
    cancel_at_period_end: bool
    platform_subscription_id: str
