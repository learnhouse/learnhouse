from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import JSON, BigInteger, Column, DateTime, ForeignKey, Index, String
from sqlmodel import Field, SQLModel


def _now() -> datetime:
    return datetime.now(timezone.utc)


class OrgOnboarding(SQLModel, table=True):
    """Where an organization stands in its setup, one row per org.

    ``goal`` is what the admin said they are building (it orders the setup
    checklist and picks the starter template). ``state`` holds the admin's own
    choices: put the checklist away, skip a step, which finished steps have
    been celebrated, which click-only steps were done. ``milestones`` maps a
    funnel event to the first time it happened (ISO timestamps), so the
    platform can measure the funnel without a separate event store.

    Created lazily the first time the org's checklist is read, or by the
    onboarding create-org endpoint.
    """

    __tablename__ = "org_onboarding"
    __table_args__ = (Index("ix_org_onboarding_goal", "goal"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(
        sa_column=Column(
            BigInteger,
            ForeignKey("organization.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
            index=True,
        )
    )
    goal: Optional[str] = Field(default=None, sa_column=Column(String(32), nullable=True))
    state: dict = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    milestones: dict = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    created_at: datetime = Field(
        default_factory=_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
