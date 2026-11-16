"""People data for an organization's members: manager, department, title...

One row per (org, member). A row is optional: a member without one simply has
no manager or department yet. Rows are written by the dashboard (manual), by
SCIM provisioning (scim), by CSV imports (import) and from answers to signup
fields mapped to people data (signup); ``source`` records the last writer.
``manager_user_id`` points at another member of the same org and
is what manager reports and "My team" views walk (direct and indirect reports).
"""

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import JSON, Boolean, Column, DateTime, ForeignKey, Index, Integer, String, false
from sqlmodel import Field, SQLModel


EMPLOYMENT_STATUSES = ("active", "inactive")
PROFILE_SOURCES = ("manual", "scim", "import", "signup")


def _now() -> datetime:
    return datetime.now(timezone.utc)


class OrgMemberProfile(SQLModel, table=True):
    __tablename__ = "org_member_profile"
    __table_args__ = (
        Index("ix_org_member_profile_manager", "org_id", "manager_user_id"),
        Index("ix_org_member_profile_department", "org_id", "department"),
        Index("ix_org_member_profile_external", "org_id", "external_id"),
    )

    org_id: int = Field(
        sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"), primary_key=True)
    )
    user_id: int = Field(
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="CASCADE"), primary_key=True)
    )
    manager_user_id: Optional[int] = Field(
        default=None,
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="SET NULL"), nullable=True),
    )
    department: Optional[str] = Field(default=None, sa_column=Column(String(200), nullable=True))
    title: Optional[str] = Field(default=None, sa_column=Column(String(200), nullable=True))
    employee_id: Optional[str] = Field(default=None, sa_column=Column(String(100), nullable=True))
    cost_center: Optional[str] = Field(default=None, sa_column=Column(String(100), nullable=True))
    location: Optional[str] = Field(default=None, sa_column=Column(String(200), nullable=True))
    employment_status: str = Field(
        default="active", sa_column=Column(String(16), nullable=False, default="active")
    )
    source: str = Field(default="manual", sa_column=Column(String(16), nullable=False, default="manual"))
    external_id: Optional[str] = Field(default=None, sa_column=Column(String(255), nullable=True))
    # Extra HR attributes without a column of their own (SCIM enterprise
    # "organization" and "division", ...).
    attributes: Optional[dict] = Field(default=None, sa_column=Column(JSON, nullable=True))
    # The member opted out of the weekly manager digest.
    digest_opt_out: bool = Field(
        default=False, sa_column=Column(Boolean, nullable=False, default=False, server_default=false())
    )
    updated_at: datetime = Field(
        default_factory=_now, sa_column=Column(DateTime(timezone=True), nullable=False, default=_now)
    )
