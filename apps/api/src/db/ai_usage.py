"""AI usage ledger: one row per metered AI request.

Written by ``src.services.ai.metering`` when a charge settles (or is refunded).
It is what the usage page breaks down by feature and member, and what the
platform console's "AI costs" view compares against provider cost.
"""

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import JSON, BigInteger, Column, DateTime, ForeignKey, Index, Integer, String
from sqlmodel import Field, SQLModel


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class AIUsageEvent(SQLModel, table=True):
    __tablename__ = "ai_usage_event"
    __table_args__ = (
        Index("ix_ai_usage_event_org_created", "org_id", "created_at"),
        Index("ix_ai_usage_event_feature_created", "feature", "created_at"),
        Index("ix_ai_usage_event_charge_key", "charge_key", unique=True),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(sa_column=Column(BigInteger, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False))
    # The member who asked (None for system/background work without a user).
    user_id: Optional[int] = Field(default=None, sa_column=Column(Integer, nullable=True))
    feature: str = Field(sa_column=Column(String(64), nullable=False))
    # ok | refunded | partial (settled for less than the cost: out of credits mid-run)
    status: str = Field(default="ok", sa_column=Column(String(16), nullable=False, server_default="ok"))
    credits: int = Field(default=0, sa_column=Column(Integer, nullable=False, server_default="0"))
    # Provider list-price cost at the time of the request, in micro-dollars.
    cost_micros: int = Field(default=0, sa_column=Column(BigInteger, nullable=False, server_default="0"))
    units: float = Field(default=1.0)
    requests: int = Field(default=0, sa_column=Column(Integer, nullable=False, server_default="0"))
    input_tokens: int = Field(default=0, sa_column=Column(BigInteger, nullable=False, server_default="0"))
    output_tokens: int = Field(default=0, sa_column=Column(BigInteger, nullable=False, server_default="0"))
    # Per-model breakdown: [{model, input_tokens, output_tokens, ..., cost_usd}]
    models: Optional[list] = Field(default=None, sa_column=Column(JSON, nullable=True))
    # Idempotency key: a retried / reconnected request with the same key is not charged twice.
    charge_key: str = Field(sa_column=Column(String(128), nullable=False))
    created_at: datetime = Field(
        default_factory=_utcnow, sa_column=Column(DateTime(timezone=True), nullable=False)
    )
