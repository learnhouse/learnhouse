from typing import Optional
from datetime import datetime, timezone
from sqlalchemy import (
    Column,
    ForeignKey,
    BigInteger,
    Integer,
    String,
    Boolean,
    DateTime,
    JSON,
    UniqueConstraint,
    Index,
)
from sqlmodel import Field, SQLModel


class NudgeSendStatus:
    """Lifecycle of one ledger row.

    ``CLAIMED`` exists because the row is written *before* the send is
    attempted — a row stuck in this state means a process died mid-send, which
    is visible for reconciliation rather than silently retried.
    """

    CLAIMED = "claimed"
    SENT = "sent"
    FAILED = "failed"
    DRY_RUN = "dry_run"
    SUPPRESSED = "suppressed"


class NudgeSend(SQLModel, table=True):
    """
    One row per (nudge, org, admin, period) — the send ledger.

    ``dedupe_key`` is the idempotency boundary and the reason a backfill over
    every historical org is safe to re-run: the row is inserted before the
    provider is called, so a crash mid-send can never produce a duplicate, and
    two concurrent runs collide on the unique constraint in the database rather
    than in someone's inbox.
    """

    __tablename__ = "nudge_send"
    __table_args__ = (
        UniqueConstraint("dedupe_key", name="uq_nudge_send_dedupe"),
        # Serves the per-admin frequency cap (n sends in the trailing 7 days).
        Index("ix_nudge_send_user_sent", "user_id", "sent_at"),
        Index("ix_nudge_send_org_nudge", "org_id", "nudge_id"),
        Index("ix_nudge_send_nudge_sent", "nudge_id", "sent_at"),
        # Finds the handful of messages awaiting a delivery check.
        Index("ix_nudge_send_unchecked", "delivery_checked", "sent_at"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    nudge_id: str = Field(sa_column=Column(String(64), nullable=False))
    # "<nudge_id>:<org_id>:<user_id>" for once-forever nudges, with a trailing
    # ":<period>" for repeatable ones, and a "dryrun:" prefix for dry runs so a
    # rehearsal never consumes the key a real send needs.
    dedupe_key: str = Field(sa_column=Column(String(160), nullable=False))
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
    status: str = Field(
        default=NudgeSendStatus.CLAIMED,
        sa_column=Column(String(16), nullable=False, default=NudgeSendStatus.CLAIMED),
    )
    lang: str = Field(default="en", sa_column=Column(String(8), nullable=False, default="en"))
    claimed_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    # Set only on a successful send, so the frequency cap counts delivered mail
    # rather than attempts.
    sent_at: Optional[datetime] = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    error: Optional[str] = Field(default=None, sa_column=Column(String(255), nullable=True))
    # The provider's id for this message, so its delivery outcome can be read
    # back later. Polling this is what removes the need to configure a webhook.
    provider_id: Optional[str] = Field(
        default=None, sa_column=Column(String(64), nullable=True)
    )
    # Set once the outcome has been read, so each message is polled at most once.
    delivery_checked: bool = Field(
        default=False, sa_column=Column(Boolean, nullable=False, default=False)
    )
    # Snapshot of the segment values that made this nudge fire, for debugging a
    # send after the underlying org state has moved on. JSON (not JSONB): the
    # test suite runs on SQLite.
    meta: Optional[dict] = Field(default=None, sa_column=Column(JSON, nullable=True))


class EmailPreference(SQLModel, table=True):
    """
    Per-user opt-out state for non-transactional email.

    Created lazily — the absence of a row means "opted in, never asked", which
    is why this is a table rather than a column on ``user``: it needs a
    tri-state, and adding a column to the hottest table in the schema for it
    would be a poor trade.

    Transactional mail (password reset, invitation, address verification)
    ignores this table entirely.
    """

    __tablename__ = "email_preference"
    __table_args__ = (
        UniqueConstraint("user_id", name="uq_email_preference_user"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(
        sa_column=Column(
            Integer,
            ForeignKey("user.id", ondelete="CASCADE"),
            nullable=False,
        )
    )
    lifecycle_opt_out: bool = Field(
        default=False, sa_column=Column(Boolean, nullable=False, default=False)
    )
    # Reserved for a future "product updates" category; a separate flag now
    # avoids a migration when that category ships.
    product_updates_opt_out: bool = Field(
        default=False, sa_column=Column(Boolean, nullable=False, default=False)
    )
    unsubscribed_at: Optional[datetime] = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    # "email_link" | "dashboard" | "admin" | "bounce" | "complaint"
    source: Optional[str] = Field(default=None, sa_column=Column(String(32), nullable=True))
    # Set by a hard bounce or a spam complaint. Unlike lifecycle_opt_out this is
    # not the reader's preference — it is a delivery fact, and it must survive
    # any later re-subscribe, because continuing to mail a dead address or a
    # complainant is what actually costs a sending domain its reputation.
    suppressed: bool = Field(
        default=False, sa_column=Column(Boolean, nullable=False, default=False)
    )
    suppressed_reason: Optional[str] = Field(
        default=None, sa_column=Column(String(32), nullable=True)
    )
