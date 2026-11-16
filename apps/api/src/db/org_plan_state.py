"""Plan state an organization carries beyond its plan name.

Two tables, both SaaS-only in practice (self-hosted installs have no plans):

``org_trial``: the free trial every new SaaS organization starts with. While
it runs the org's config holds the trial plan, so every gate works unchanged;
this row is what knows that the plan is a trial, when it ends and how it ended.

``org_downgrade``: what the platform changed when an organization dropped to
the Free plan (trial end, cancellation, failed payment). Free allows one public
course, so the others are made private; the row records each course's previous
visibility so an upgrade can put everything back exactly as it was.
"""

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import JSON, BigInteger, Column, DateTime, ForeignKey, Index, Integer, String
from sqlmodel import Field, SQLModel


def _now() -> datetime:
    return datetime.now(timezone.utc)


class TrialStatus:
    ACTIVE = "active"
    # A plan was bought (or granted) while the trial ran.
    CONVERTED = "converted"
    # It ran out and the org moved to the Free plan.
    EXPIRED = "expired"
    # Ended early without a plan (a platform admin moved the org to Free).
    ENDED = "ended"


class OrgTrial(SQLModel, table=True):
    """One trial per organization, started when the org is created."""

    __tablename__ = "org_trial"
    __table_args__ = (Index("ix_org_trial_status_ends", "status", "ends_at"),)

    org_id: int = Field(
        sa_column=Column(
            BigInteger,
            ForeignKey("organization.id", ondelete="CASCADE"),
            primary_key=True,
        )
    )
    plan: str = Field(sa_column=Column(String(32), nullable=False))
    status: str = Field(
        default=TrialStatus.ACTIVE,
        sa_column=Column(String(16), nullable=False, default=TrialStatus.ACTIVE),
    )
    started_at: datetime = Field(
        default_factory=_now, sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    ends_at: datetime = Field(sa_column=Column(DateTime(timezone=True), nullable=False))
    # When it stopped running (converted, expired or ended) and, on a
    # conversion, the plan the org moved to.
    ended_at: Optional[datetime] = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    converted_plan: Optional[str] = Field(
        default=None, sa_column=Column(String(32), nullable=True)
    )
    # No foreign key on purpose: deleting the creator's account must neither
    # delete the trial (the org would then never leave the trial plan) nor
    # block the deletion.
    created_by_user_id: Optional[int] = Field(default=None, sa_column=Column(Integer, nullable=True))


class OrgDowngrade(SQLModel, table=True):
    """What one paid-to-Free transition changed, and whether it was undone.

    ``changes`` holds ``{"courses": [{"id", "uuid", "name", "public"}],
    "kept_course": {"id", "uuid", "name"} | null}``: every course the downgrade
    made private with the visibility it had before. Restoring only touches
    courses that are still private, so an admin's own change after the
    downgrade is never overwritten.
    """

    __tablename__ = "org_downgrade"
    __table_args__ = (Index("ix_org_downgrade_org_created", "org_id", "created_at"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(
        sa_column=Column(
            BigInteger,
            ForeignKey("organization.id", ondelete="CASCADE"),
            nullable=False,
        )
    )
    from_plan: str = Field(sa_column=Column(String(32), nullable=False))
    to_plan: str = Field(sa_column=Column(String(32), nullable=False))
    # trial_expired | billing | platform | other
    reason: str = Field(default="other", sa_column=Column(String(32), nullable=False, default="other"))
    changes: dict = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    created_at: datetime = Field(
        default_factory=_now, sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    restored_at: Optional[datetime] = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    restored_to_plan: Optional[str] = Field(
        default=None, sa_column=Column(String(32), nullable=True)
    )
