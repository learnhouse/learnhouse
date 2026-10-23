"""
Database model and schemas for IranKish (Shaparak) course payments.

A row tracks one attempt by a user to buy access to a course through the
IranKish IPG. The lifecycle is:

    PENDING   -> a token was obtained and the user was redirected to the gateway
    PAID      -> the gateway POSTed a successful result to our callback (card
                 charged) but we have not yet confirmed it
    COMPLETED -> we called the confirmation service, the gateway settled, and
                 the buyer was granted course access
    FAILED    -> the gateway reported a failure / the user cancelled
    REVERSED  -> a completed payment was later reversed (refunded)

Access is granted by adding the buyer to the course's UserGroup (the same
primitive the rest of the platform uses for course access): on COMPLETED we
ensure a ``UserGroupUser`` row exists for the buyer in a per-course payment
UserGroup. See ``src/services/payments/irankish/irankish.py``.
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


class IranKishPaymentStatusEnum(str, Enum):
    PENDING = "PENDING"
    PAID = "PAID"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    REVERSED = "REVERSED"


class IranKishPayment(SQLModel, table=True):
    """One IranKish payment attempt for a course purchase."""

    __tablename__ = "irankish_payment"
    __table_args__ = (
        Index("ix_irankish_payment_uuid", "payment_uuid"),
        Index("ix_irankish_payment_org_id", "org_id"),
        Index("ix_irankish_payment_user_id", "user_id"),
        Index("ix_irankish_payment_course_id", "course_id"),
        Index("ix_irankish_payment_request_id", "request_id"),
        Index("ix_irankish_payment_token", "token"),
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

    # Amount in IRR (Rial), the gateway's unit. A course is bought for a fixed
    # amount captured when the payment is created.
    amount: int = Field(sa_column=Column(Integer, nullable=False))

    # ``request_id`` is the unique id we send as the gateway ``requestId`` and
    # later echo as ``invoiceId`` on confirmation. ``token`` is the gateway
    # ``tokenIdentity`` returned by the token service.
    request_id: str = Field(sa_column=Column(String(20), nullable=False))
    token: Optional[str] = Field(default=None, sa_column=Column(String(48)))

    # Values the gateway returns on its callback, needed to confirm the payment.
    retrieval_reference_number: Optional[str] = Field(
        default=None, sa_column=Column(String(12))
    )
    system_trace_audit_number: Optional[str] = Field(
        default=None, sa_column=Column(String(6))
    )
    masked_pan: Optional[str] = Field(default=None, sa_column=Column(String(19)))
    # The raw ISO-8583 response code from the callback / confirmation, for audit.
    response_code: Optional[str] = Field(default=None, sa_column=Column(String(4)))

    status: IranKishPaymentStatusEnum = Field(
        default=IranKishPaymentStatusEnum.PENDING,
        sa_column=Column(
            SAEnum(IranKishPaymentStatusEnum, name="irankishpaymentstatusenum"),
            nullable=False,
        ),
    )

    creation_date: str = ""
    update_date: str = ""


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------


class IranKishCheckoutCreate(BaseModel):
    """Start a purchase of ``course_id`` for the amount configured for it."""

    course_id: int


class IranKishCheckoutResponse(BaseModel):
    """What the frontend needs to render the auto-submitting redirect form.

    The browser must POST ``form_fields`` to ``payment_url`` as
    ``application/x-www-form-urlencoded`` to land the cardholder on the gateway.
    """

    payment_uuid: str
    payment_url: str
    form_fields: dict
    amount: int


class IranKishPaymentRead(BaseModel):
    id: int
    payment_uuid: str
    org_id: int
    user_id: int
    course_id: int
    amount: int
    request_id: str
    token: Optional[str] = None
    retrieval_reference_number: Optional[str] = None
    system_trace_audit_number: Optional[str] = None
    masked_pan: Optional[str] = None
    response_code: Optional[str] = None
    status: IranKishPaymentStatusEnum
    creation_date: str
    update_date: str
