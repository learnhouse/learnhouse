"""Analytics storage, kept in the main Postgres database.

``analytics_event`` is the raw, append-only event stream. The fields every
dashboard filters or groups on are real columns (indexed where it pays off);
anything event-specific lives in ``properties``. Rows are pruned per org by the
retention job in ``services/analytics/maintenance.py``.

``analytics_daily_actor`` and ``analytics_hourly_count`` are summaries rebuilt
from the raw stream every few minutes, so charts over long windows read a few
hundred rows instead of millions of events.

There are no foreign keys on the event tables on purpose: they take every
write in the app, and deleting an organization must not have to cascade
through millions of rows inline. The retention job clears orphaned orgs.
"""

from datetime import date, datetime, timezone
from typing import Optional

from sqlalchemy import (
    REAL,
    BigInteger,
    Boolean,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

DEFAULT_RETENTION_DAYS = 365


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class AnalyticsEvent(SQLModel, table=True):
    __tablename__ = "analytics_event"
    __table_args__ = (
        Index("ix_analytics_event_org_name_ts", "org_id", "event_name", "ts"),
        Index("ix_analytics_event_org_ts", "org_id", "ts"),
        Index(
            "ix_analytics_event_org_course_ts",
            "org_id",
            "course_uuid",
            "ts",
            postgresql_where=text("course_uuid IS NOT NULL"),
        ),
        Index("ix_analytics_event_ts_brin", "ts", postgresql_using="brin"),
    )

    id: Optional[int] = Field(
        default=None,
        # SQLite (the unit tests) only auto-increments INTEGER primary keys.
        sa_column=Column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True),
    )
    ts: datetime = Field(default_factory=_utcnow, sa_column=Column(DateTime(timezone=True), nullable=False))
    org_id: int = Field(sa_column=Column(Integer, nullable=False))
    event_name: str = Field(sa_column=Column(String(64), nullable=False))
    # "web" for browser beacons, "api" for server-side events.
    source: str = Field(default="api", sa_column=Column(String(16), nullable=False, server_default="api"))
    # 0 for anonymous visitors.
    user_id: int = Field(default=0, sa_column=Column(Integer, nullable=False, server_default="0"))
    # Who did it: "u:<user_id>" for signed-in users, "v:<hash>" for anonymous
    # visitors. The visitor hash rotates daily and is never stored with the IP.
    actor_key: str = Field(default="", sa_column=Column(String(80), nullable=False, server_default=""))
    session_id: str = Field(default="", sa_column=Column(String(64), nullable=False, server_default=""))
    course_uuid: Optional[str] = Field(default=None, sa_column=Column(String(100), nullable=True))
    activity_uuid: Optional[str] = Field(default=None, sa_column=Column(String(100), nullable=True))
    path: Optional[str] = Field(default=None, sa_column=Column(String(512), nullable=True))
    country: Optional[str] = Field(default=None, sa_column=Column(String(2), nullable=True))
    device: Optional[str] = Field(default=None, sa_column=Column(String(16), nullable=True))
    referrer_domain: Optional[str] = Field(default=None, sa_column=Column(String(255), nullable=True))
    seconds_spent: Optional[float] = Field(default=None, sa_column=Column(REAL, nullable=True))
    properties: dict = Field(default_factory=dict, sa_column=Column(JSONB, nullable=False, server_default="{}"))


class AnalyticsDailyActor(SQLModel, table=True):
    """One row per actor per org per day."""

    __tablename__ = "analytics_daily_actor"

    org_id: int = Field(sa_column=Column(Integer, primary_key=True))
    day: date = Field(sa_column=Column(Date, primary_key=True))
    actor_key: str = Field(sa_column=Column(String(80), primary_key=True))
    user_id: int = Field(default=0, sa_column=Column(Integer, nullable=False, server_default="0"))
    events: int = Field(default=0, sa_column=Column(Integer, nullable=False, server_default="0"))
    page_views: int = Field(default=0, sa_column=Column(Integer, nullable=False, server_default="0"))


class AnalyticsHourlyCount(SQLModel, table=True):
    """Event counts per org, day, hour (UTC) and event name."""

    __tablename__ = "analytics_hourly_count"

    org_id: int = Field(sa_column=Column(Integer, primary_key=True))
    day: date = Field(sa_column=Column(Date, primary_key=True))
    hour: int = Field(sa_column=Column(SmallInteger, primary_key=True))
    event_name: str = Field(sa_column=Column(String(64), primary_key=True))
    n: int = Field(default=0, sa_column=Column(Integer, nullable=False, server_default="0"))


class AnalyticsSettings(SQLModel, table=True):
    """Per-org analytics privacy and retention settings.

    Orgs without a row use the defaults below. Retention above
    ``DEFAULT_RETENTION_DAYS`` requires the Enterprise plan; that rule lives in
    ``services/analytics/settings.py`` so the column itself stays plain.
    """

    __tablename__ = "analytics_settings"

    org_id: int = Field(
        sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"), primary_key=True)
    )
    retention_days: int = Field(
        default=DEFAULT_RETENTION_DAYS,
        sa_column=Column(Integer, nullable=False, server_default=str(DEFAULT_RETENTION_DAYS)),
    )
    # Count visitors who aren't signed in (cookieless, daily-rotating hash).
    track_anonymous: bool = Field(default=True, sa_column=Column(Boolean, nullable=False, server_default="true"))
    # Store the visitor's country (from the edge's geo header, never the IP).
    collect_location: bool = Field(default=True, sa_column=Column(Boolean, nullable=False, server_default="true"))
    # Leave admins' and maintainers' browsing out of traffic and engagement stats.
    exclude_staff: bool = Field(default=False, sa_column=Column(Boolean, nullable=False, server_default="false"))
    updated_at: datetime = Field(default_factory=_utcnow, sa_column=Column(DateTime(timezone=True), nullable=False))
