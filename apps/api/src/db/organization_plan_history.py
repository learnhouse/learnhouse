from typing import Optional
from datetime import datetime, timezone
from sqlalchemy import (
    Column,
    ForeignKey,
    BigInteger,
    String,
    DateTime,
    Index,
)
from sqlmodel import Field, SQLModel


class OrganizationPlanHistory(SQLModel, table=True):
    """
    Append-only log of an organization's SaaS plan over time.

    One row per plan change: from `effective_from` until the next row's
    `effective_from`, the org was on `plan`. Active-user overage is billed in
    arrears (up to a year in arrears for annual subscriptions), so the plan the
    org is on *today* is not necessarily the plan whose member limit applied
    during the month being billed. This table is what makes that resolvable.

    Written best-effort on every org config write where the plan actually
    changed, so a failure here can never block a plan change.
    """

    __tablename__ = "organization_plan_history"
    __table_args__ = (
        # Serves "what plan(s) did this org hold during month X".
        Index("ix_org_plan_history_org_from", "org_id", "effective_from"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(
        sa_column=Column(
            BigInteger,
            ForeignKey("organization.id", ondelete="CASCADE"),
            nullable=False,
        )
    )
    plan: str = Field(sa_column=Column(String(64), nullable=False))
    effective_from: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
