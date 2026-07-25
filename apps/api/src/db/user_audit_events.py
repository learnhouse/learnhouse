from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import (
    JSON,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlmodel import Field, SQLModel


def _utcnow() -> datetime:
    """Timezone-aware UTC now. Legal audit rows need a real timestamp, not the
    ``str(datetime.now())`` pattern the Trail models use."""
    return datetime.now(timezone.utc)


class UserAuditEventType:
    """Student learning-activity event types recorded in the durable audit log.

    Deliberately scoped to LEARNER actions — authoring/admin actions (board or
    playground creation, content authorship, token/webhook management, course
    management, AI editor generation) are out of scope and are NOT recorded here.
    """

    # Connections
    LOGIN = "login"
    LOGOUT = "logout"

    # Course progress
    COURSE_ENROLLED = "course_enrolled"
    ACTIVITY_COMPLETED = "activity_completed"
    COURSE_COMPLETED = "course_completed"

    # Assessments (student side). These matter most for the durable log because
    # assignment retries reset the live submission row in place — the grade a
    # student received on an earlier attempt survives only here.
    ASSIGNMENT_SUBMITTED = "assignment_submitted"
    ASSIGNMENT_GRADED = "assignment_graded"  # grade the student RECEIVED

    # Achievements
    CERTIFICATE_CLAIMED = "certificate_claimed"

    # NOTE: code submissions and community participation (discussions, comments,
    # votes, reactions) are NOT mirrored here — their own tables are already
    # append-only and permanent, so the dossier reads them directly.


class UserAuditEvent(SQLModel, table=True):
    """Append-only, legal-grade record of a student's learning activity.

    This is the durable source of truth that complements the lossy, TTL'd Tinybird
    analytics stream: rows are never updated or deleted, timestamps are real
    ``timestamptz`` values, and writes are committed synchronously (see
    ``services/audit/audit.py``). It also preserves history the live tables
    overwrite — e.g. an assignment retry resets the submission row in place, but
    each submission/grade still leaves a permanent row here.
    """

    __tablename__ = "user_audit_event"
    __table_args__ = (
        Index("ix_user_audit_event_org_user_created", "org_id", "user_id", "created_at"),
        Index("ix_user_audit_event_user_type_created", "user_id", "event_type", "created_at"),
    )

    id: Optional[int] = Field(default=None, primary_key=True)

    # Nullable: connection events (login/logout) are org-agnostic — a user can
    # belong to several orgs and authenticates once. Activity events set org_id.
    org_id: Optional[int] = Field(
        default=None,
        sa_column=Column(
            Integer,
            ForeignKey("organization.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    user_id: int = Field(
        sa_column=Column(
            Integer,
            ForeignKey("user.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        )
    )

    event_type: str = Field(sa_column=Column(String(64), nullable=False))

    # Request context — captured for connection and action events.
    ip: Optional[str] = Field(default=None, sa_column=Column(String(64), nullable=True))
    user_agent: Optional[str] = Field(default=None, sa_column=Column(Text, nullable=True))

    # The resource the event targets (course_uuid / activity_uuid / assignment
    # uuid / certificate uuid / discussion uuid ...), stored as a stable uuid so
    # the dossier can resolve names even after the row is renamed.
    target_uuid: Optional[str] = Field(
        default=None, sa_column=Column(String(128), nullable=True, index=True)
    )

    # Free-form structured detail: grade value, attempt number, course/activity
    # name snapshot, seconds spent, etc. Snapshotting names here keeps the audit
    # legible even if the source record is later edited or deleted.
    audit_metadata: dict = Field(default_factory=dict, sa_column=Column(JSON))

    created_at: datetime = Field(
        default_factory=_utcnow,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
