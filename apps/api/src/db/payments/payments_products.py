from enum import Enum
from sqlmodel import SQLModel, Field, Column, BigInteger, ForeignKey, String, JSON
from typing import Optional
from datetime import datetime

class PaymentProductTypeEnum(str, Enum):
    SUBSCRIPTION = "subscription"
    ONE_TIME = "one_time"

class PaymentsProductBase(SQLModel):
    name: str = ""
    description: Optional[str] = ""
    product_type: PaymentProductTypeEnum = PaymentProductTypeEnum.ONE_TIME
    benefits: str = ""
    amount: float = 0.0
    currency: str = "USD"

class PaymentsProduct(PaymentsProductBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("organization.id", ondelete="CASCADE"))
    )
    payments_config_id: int = Field(sa_column=Column(BigInteger, ForeignKey("paymentsconfig.id", ondelete="CASCADE")))
    provider_product_id: str = Field(sa_column=Column(String))
    creation_date: datetime = Field(default=datetime.now())
    update_date: datetime = Field(default=datetime.now())

class PaymentsProductCreate(PaymentsProductBase):
    pass

class PaymentsProductUpdate(PaymentsProductBase):
    pass

class PaymentsProductRead(PaymentsProductBase):
    id: int
    org_id: int
    payments_config_id: int
    creation_date: datetime
    update_date: datetime
