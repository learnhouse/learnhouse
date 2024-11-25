from datetime import datetime
from enum import Enum
from typing import  Optional
from sqlalchemy import JSON
from sqlmodel import Field, SQLModel, Column, BigInteger, ForeignKey

# PaymentsConfig 
class PaymentProviderEnum(str, Enum):
    STRIPE = "stripe"
    
class PaymentsConfigBase(SQLModel):
    enabled: bool = True
    active: bool = False
    provider: PaymentProviderEnum = PaymentProviderEnum.STRIPE
    provider_specific_id: str | None = None
    provider_config: dict = Field(default={}, sa_column=Column(JSON))


class PaymentsConfig(PaymentsConfigBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("organization.id", ondelete="CASCADE"))
    )
    creation_date: datetime = Field(default=datetime.now())
    update_date: datetime = Field(default=datetime.now())


class PaymentsConfigCreate(PaymentsConfigBase):
    pass


class PaymentsConfigUpdate(PaymentsConfigBase):
    enabled: Optional[bool] = True
    provider_config: Optional[dict] = None
    provider_specific_id: Optional[str] = None


class PaymentsConfigRead(PaymentsConfigBase):
    id: int
    org_id: int
    creation_date: datetime
    update_date: datetime


class PaymentsConfigDelete(SQLModel):
    id: int