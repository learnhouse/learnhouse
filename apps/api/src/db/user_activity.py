from typing import Optional
from datetime import date, datetime, timezone
from sqlalchemy import (
    Column,
    ForeignKey,
    BigInteger,
    Integer,
    Date,
    DateTime,
    UniqueConstraint,
    Index,
)
from sqlmodel import Field, SQLModel


class UserActivityDay(SQLModel, table=True):
    """
    One row per (org, user, UTC calendar day) on which the user was active.

    Authoritative source for active-user billing. A user is "active" for a
    month when they have >= 2 distinct activity days in that month. Writes are
    idempotent: the unique constraint makes repeated touches within a day a
    no-op (INSERT ... ON CONFLICT DO NOTHING).
    """

    __tablename__ = "user_activity_day"
    __table_args__ = (
        UniqueConstraint(
            "org_id", "user_id", "activity_date",
            name="uq_user_activity_org_user_date",
        ),
        # Serves the month-range aggregation (count active users per org) and
        # the per-member join on the Users page.
        Index("ix_user_activity_org_date", "org_id", "activity_date"),
        Index("ix_user_activity_org_user_date", "org_id", "user_id", "activity_date"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(
        sa_column=Column(
            BigInteger,
            ForeignKey("organization.id", ondelete="CASCADE"),
            nullable=False,
        )
    )
    user_id: int = Field(
        sa_column=Column(
            Integer,
            ForeignKey("user.id", ondelete="CASCADE"),
            nullable=False,
        )
    )
    activity_date: date = Field(sa_column=Column(Date, nullable=False))
    first_seen_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
