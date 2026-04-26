from datetime import datetime
from enum import Enum
from typing import  Optional
from sqlalchemy import JSON
from sqlmodel import Field, SQLModel, Column, BigInteger, ForeignKey

# ---------------------------------------------------------------------------
# Payment provider registry
# To add a new provider: add its value here and implement a corresponding
# service module at ee/services/payments/payments_<provider>.py that handles
# credential retrieval, OAuth/API-key connection, checkout sessions, and
# webhooks. No changes to the config model are required.
# ---------------------------------------------------------------------------
class PaymentProviderEnum(str, Enum):
    STRIPE = "stripe"
    MOYASAR = "moyasar"
    # LEMON_SQUEEZY = "lemon_squeezy"  # example future provider
    # PADDLE = "paddle"                # example future provider


class PaymentsModeEnum(str, Enum):
    standard = "standard"  # org connects their own Stripe account via OAuth
    express = "express"    # LearnHouse creates a Stripe Express account on the org's behalf


class PaymentsConfigBase(SQLModel):
    enabled: bool = True
    active: bool = False
    provider: PaymentProviderEnum = PaymentProviderEnum.STRIPE
    mode: PaymentsModeEnum = Field(default=PaymentsModeEnum.standard)
    provider_specific_id: str | None = None
    provider_config: dict = Field(default_factory=dict, sa_column=Column(JSON))


class PaymentsConfig(PaymentsConfigBase, table=True):
    __table_args__ = {'extend_existing': True}
    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("organization.id", ondelete="CASCADE"))
    )
    creation_date: datetime = Field(default_factory=datetime.now)
    update_date: datetime = Field(default_factory=datetime.now)


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
