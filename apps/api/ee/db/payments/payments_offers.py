from enum import Enum
from sqlmodel import SQLModel, Field, Column, BigInteger, ForeignKey, String
from typing import Optional
from datetime import datetime
from uuid import uuid4


class OfferTypeEnum(str, Enum):
    SUBSCRIPTION = "subscription"
    ONE_TIME = "one_time"


class OfferPriceTypeEnum(str, Enum):
    CUSTOMER_CHOICE = "customer_choice"
    FIXED_PRICE = "fixed_price"


class PaymentsOfferBase(SQLModel):
    name: str = ""
    description: Optional[str] = ""
    offer_type: OfferTypeEnum = OfferTypeEnum.ONE_TIME
    price_type: OfferPriceTypeEnum = OfferPriceTypeEnum.FIXED_PRICE
    benefits: str = ""
    amount: float = 0.0
    currency: str = "USD"
    is_publicly_listed: bool = True


class PaymentsOffer(PaymentsOfferBase, table=True):
    __table_args__ = {'extend_existing': True}
    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("organization.id", ondelete="CASCADE"))
    )
    payments_config_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("paymentsconfig.id", ondelete="CASCADE"))
    )
    # Optional: link to a PaymentsGroup (for bundles/subscriptions)
    payments_group_id: Optional[int] = Field(
        default=None,
        sa_column=Column(BigInteger, ForeignKey("paymentsgroup.id", ondelete="SET NULL"), nullable=True)
    )
    offer_uuid: str = Field(
        default_factory=lambda: str(uuid4()),
        sa_column=Column(String, unique=True, index=True, nullable=False)
    )
    provider_product_id: str = Field(default="", sa_column=Column(String))
    creation_date: datetime = Field(default_factory=datetime.now)
    update_date: datetime = Field(default_factory=datetime.now)


class PaymentsOfferCreate(PaymentsOfferBase):
    # Optional: link to an existing PaymentsGroup (for bundles/subscriptions)
    payments_group_id: Optional[int] = None
    # Optional: direct resource UUIDs (e.g. "course_xxx") for simple single-course offers
    resource_uuids: list[str] = []


class PaymentsOfferUpdate(PaymentsOfferBase):
    # payments_group_id and resource_uuids are excluded — managed separately
    pass


class PaymentsOfferRead(PaymentsOfferBase):
    id: int
    offer_uuid: str
    org_id: int
    payments_config_id: int
    payments_group_id: Optional[int]
    provider_product_id: str
    creation_date: datetime
    update_date: datetime
