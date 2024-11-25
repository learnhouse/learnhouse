from openai import BaseModel
from sqlmodel import SQLModel, Field, Column, BigInteger, ForeignKey, JSON
from typing import Optional
from datetime import datetime
from enum import Enum

class PaymentStatusEnum(str, Enum):
    PENDING = "pending"
    COMPLETED = "completed"
    ACTIVE = "active"
    CANCELLED = "cancelled"
    FAILED = "failed"
    REFUNDED = "refunded"


class ProviderSpecificData(BaseModel):
    stripe_customer: dict | None = None
    custom_customer: dict | None = None

class PaymentsUserBase(SQLModel):
    status: PaymentStatusEnum = PaymentStatusEnum.PENDING
    provider_specific_data: dict = Field(default={}, sa_column=Column(JSON))

class PaymentsUser(PaymentsUserBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("user.id", ondelete="CASCADE"))
    )
    org_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("organization.id", ondelete="CASCADE"))
    )
    payment_product_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("paymentsproduct.id", ondelete="CASCADE"))
    )
    creation_date: datetime = Field(default=datetime.now())
    update_date: datetime = Field(default=datetime.now())

