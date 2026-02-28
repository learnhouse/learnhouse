from sqlmodel import SQLModel, Field, Column, BigInteger, ForeignKey, JSON
from typing import Optional
from datetime import datetime
from enum import Enum


class EnrollmentStatusEnum(str, Enum):
    PENDING = "pending"
    COMPLETED = "completed"
    ACTIVE = "active"
    CANCELLED = "cancelled"
    FAILED = "failed"
    REFUNDED = "refunded"


class PaymentsEnrollmentBase(SQLModel):
    status: EnrollmentStatusEnum = EnrollmentStatusEnum.PENDING
    provider_specific_data: dict = Field(default_factory=dict, sa_column=Column(JSON))


class PaymentsEnrollment(PaymentsEnrollmentBase, table=True):
    __table_args__ = {'extend_existing': True}
    id: Optional[int] = Field(default=None, primary_key=True)
    offer_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("paymentsoffer.id", ondelete="CASCADE"))
    )
    user_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("user.id", ondelete="CASCADE"))
    )
    org_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("organization.id", ondelete="CASCADE"))
    )
    creation_date: datetime = Field(default_factory=datetime.now)
    update_date: datetime = Field(default_factory=datetime.now)


class PaymentsEnrollmentRead(PaymentsEnrollmentBase):
    id: int
    offer_id: int
    user_id: int
    org_id: int
    creation_date: datetime
    update_date: datetime
