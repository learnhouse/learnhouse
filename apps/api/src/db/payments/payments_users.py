from enum import Enum
from sqlmodel import SQLModel, Field, Column, BigInteger, ForeignKey, String, JSON
from typing import Optional
from datetime import datetime

class PaymentUserStatusEnum(str, Enum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    
class PaymentsUserBase(SQLModel):
    user_id: int = Field(sa_column=Column(BigInteger, ForeignKey("user.id", ondelete="CASCADE")))
    status: PaymentUserStatusEnum = PaymentUserStatusEnum.ACTIVE
    payment_product_id: int = Field(sa_column=Column(BigInteger, ForeignKey("paymentsproduct.id", ondelete="CASCADE")))
    org_id: int = Field(sa_column=Column(BigInteger, ForeignKey("organization.id", ondelete="CASCADE")))

class PaymentsUser(PaymentsUserBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    creation_date: datetime = Field(default=datetime.now())
    update_date: datetime = Field(default=datetime.now())
