"""
Database model and schemas for ZarinPal course payments.

A row tracks one attempt by a user to buy access to a course through the
ZarinPal payment gateway (REST API v4). The lifecycle is:

    PENDING   -> a payment was requested, an ``authority`` was obtained, and the
                 user was redirected to ZarinPal's StartPay page
    COMPLETED -> the user returned with Status=OK and the verify call reported
                 a success code (100) or already-verified (101); the buyer was
                 granted course access
    FAILED    -> the user returned with Status=NOK (cancelled / declined) or the
                 verify call reported a non-success code

Unlike IranKish (which has an intermediate PAID state before a separate
confirmation call), ZarinPal settles in a single verify step, so there is no
distinct PAID state; a verified payment goes straight to COMPLETED.

Access is granted by adding the buyer to the course's UserGroup (the same
primitive the rest of the platform uses for course access): on COMPLETED we
ensure a ``UserGroupUser`` row exists for the buyer in a per-course payment
UserGroup. See ``src/services/payments/zarinpal/zarinpal.py``.
"""

from enum import Enum
from typing import Optional

from pydantic import BaseModel
from sqlalchemy import (
    Column,
    Enum as SAEnum,
    ForeignKey,
    Index,
    Integer,
    String,
)
from sqlmodel import Field, SQLModel


class ZarinPalPaymentStatusEnum(str, Enum):
    PENDING = "PENDING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    REVERSED = "REVERSED"


class ZarinPalPayment(SQLModel, table=True):
    """One ZarinPal payment attempt for a course purchase."""

    __tablename__ = "zarinpal_payment"
    __table_args__ = (
        Index("ix_zarinpal_payment_uuid", "payment_uuid"),
        Index("ix_zarinpal_payment_org_id", "org_id"),
        Index("ix_zarinpal_payment_user_id", "user_id"),
        Index("ix_zarinpal_payment_course_id", "course_id"),
        Index("ix_zarinpal_payment_authority", "authority"),
        {"extend_existing": True},
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    payment_uuid: str = Field(default="", max_length=100)

    org_id: int = Field(
        sa_column=Column(
            Integer, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False
        )
    )
    user_id: int = Field(
        sa_column=Column(
            Integer, ForeignKey("user.id", ondelete="CASCADE"), nullable=False
        )
    )
    course_id: int = Field(
        sa_column=Column(
            Integer, ForeignKey("course.id", ondelete="CASCADE"), nullable=False
        )
    )

    # Amount in IRR (Rial). A course is bought for a fixed amount captured when
    # the payment is created. ZarinPal expects the amount again at verify time,
    # so it is stored here to re-send and to detect tampered callbacks.
    amount: int = Field(sa_column=Column(Integer, nullable=False))

    # ``authority`` is the 36/38-char payment identifier ZarinPal returns from
    # the payment-request call and echoes back on the callback as ``Authority``.
    # It is the key by which the callback locates this row.
    authority: Optional[str] = Field(default=None, sa_column=Column(String(64)))

    # ``ref_id`` is the settled transaction reference returned by verify; it is
    # the receipt number shown to the buyer. ``card_pan`` is the masked card
    # number ZarinPal returns on a successful verify.
    ref_id: Optional[str] = Field(default=None, sa_column=Column(String(32)))
    card_pan: Optional[str] = Field(default=None, sa_column=Column(String(20)))

    # The integer code ZarinPal returned on the request/verify call, for audit
    # (100 = success, 101 = already verified, other = failure).
    code: Optional[int] = Field(default=None, sa_column=Column(Integer))

    status: ZarinPalPaymentStatusEnum = Field(
        default=ZarinPalPaymentStatusEnum.PENDING,
        sa_column=Column(
            SAEnum(ZarinPalPaymentStatusEnum, name="zarinpalpaymentstatusenum"),
            nullable=False,
        ),
    )

    creation_date: str = ""
    update_date: str = ""


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------


class ZarinPalCheckoutCreate(BaseModel):
    """Start a purchase of ``course_id`` for the amount configured for it."""

    course_id: int


class ZarinPalCheckoutResponse(BaseModel):
    """What the frontend needs to send the buyer to the gateway.

    ZarinPal uses a plain browser redirect (GET) rather than a form POST, so the
    caller only needs to navigate the browser to ``payment_url``.
    """

    payment_uuid: str
    payment_url: str
    authority: str
    amount: int


class ZarinPalPaymentRead(BaseModel):
    id: int
    payment_uuid: str
    org_id: int
    user_id: int
    course_id: int
    amount: int
    authority: Optional[str] = None
    ref_id: Optional[str] = None
    card_pan: Optional[str] = None
    code: Optional[int] = None
    status: ZarinPalPaymentStatusEnum
    creation_date: str
    update_date: str
