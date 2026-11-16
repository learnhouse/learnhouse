"""What a user group carries beyond its members and resources.

- ``usergroup_manager``: members who run a group without being org admins
  (manage its members, follow its progress, post to it).
- ``usergroup_join_code``: shareable codes and links that add whoever redeems
  them, with a use limit and an expiry.
- ``usergroup_schedule``: memberships that start (and optionally end) on a
  date; the group sync turns them into rows of ``usergroupuser``.
- ``usergroup_event``: the group's history (members in and out, access and
  settings changes), shown on its History tab.
- ``usergroup_announcement``: posts shown on the group's space.

Actor columns (``created_by_id``, ``actor_id``, ``author_id``) carry no foreign
key: history outlives the people in it.
"""

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import JSON, Boolean, Column, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, false, true
from sqlmodel import Field, SQLModel


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _group_fk() -> Column:
    return Column(Integer, ForeignKey("usergroup.id", ondelete="CASCADE"), nullable=False, index=True)


def _org_fk() -> Column:
    return Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False, index=True)


def _user_fk() -> Column:
    return Column(Integer, ForeignKey("user.id", ondelete="CASCADE"), nullable=False, index=True)


def _created() -> Column:
    return Column(DateTime(timezone=True), nullable=False, default=_now)


class UserGroupManager(SQLModel, table=True):
    __tablename__ = "usergroup_manager"
    __table_args__ = (UniqueConstraint("usergroup_id", "user_id", name="uq_usergroup_manager"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    usergroup_id: int = Field(sa_column=_group_fk())
    user_id: int = Field(sa_column=_user_fk())
    org_id: int = Field(sa_column=_org_fk())
    can_manage_members: bool = Field(
        default=True, sa_column=Column(Boolean, nullable=False, default=True, server_default=true())
    )
    can_view_progress: bool = Field(
        default=True, sa_column=Column(Boolean, nullable=False, default=True, server_default=true())
    )
    can_post: bool = Field(
        default=True, sa_column=Column(Boolean, nullable=False, default=True, server_default=true())
    )
    # Weekly progress digest email to this manager.
    digest: bool = Field(
        default=False, sa_column=Column(Boolean, nullable=False, default=False, server_default=false())
    )
    created_by_id: Optional[int] = Field(default=None, sa_column=Column(Integer, nullable=True))
    created_at: datetime = Field(default_factory=_now, sa_column=_created())


class UserGroupJoinCode(SQLModel, table=True):
    __tablename__ = "usergroup_join_code"

    id: Optional[int] = Field(default=None, primary_key=True)
    usergroup_id: int = Field(sa_column=_group_fk())
    org_id: int = Field(sa_column=_org_fk())
    code: str = Field(sa_column=Column(String(32), nullable=False, unique=True, index=True))
    label: str = Field(default="", sa_column=Column(String(120), nullable=False, default="", server_default=""))
    # None = unlimited.
    max_uses: Optional[int] = Field(default=None, sa_column=Column(Integer, nullable=True))
    uses: int = Field(default=0, sa_column=Column(Integer, nullable=False, default=0, server_default="0"))
    expires_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=True))
    # Memberships made with the code end after this many days (None = never).
    membership_days: Optional[int] = Field(default=None, sa_column=Column(Integer, nullable=True))
    active: bool = Field(default=True, sa_column=Column(Boolean, nullable=False, default=True, server_default=true()))
    created_by_id: Optional[int] = Field(default=None, sa_column=Column(Integer, nullable=True))
    created_at: datetime = Field(default_factory=_now, sa_column=_created())


SCHEDULE_STATUSES = ("pending", "active", "done", "cancelled")


class UserGroupSchedule(SQLModel, table=True):
    __tablename__ = "usergroup_schedule"
    __table_args__ = (Index("ix_usergroup_schedule_due", "status", "starts_at"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    usergroup_id: int = Field(sa_column=_group_fk())
    org_id: int = Field(sa_column=_org_fk())
    user_id: int = Field(sa_column=_user_fk())
    starts_at: datetime = Field(sa_column=Column(DateTime(timezone=True), nullable=False))
    ends_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True), nullable=True))
    status: str = Field(default="pending", sa_column=Column(String(16), nullable=False, default="pending", server_default="pending"))
    created_by_id: Optional[int] = Field(default=None, sa_column=Column(Integer, nullable=True))
    created_at: datetime = Field(default_factory=_now, sa_column=_created())


class UserGroupEvent(SQLModel, table=True):
    __tablename__ = "usergroup_event"
    __table_args__ = (Index("ix_usergroup_event_group_id", "usergroup_id", "id"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    usergroup_id: int = Field(sa_column=Column(Integer, ForeignKey("usergroup.id", ondelete="CASCADE"), nullable=False))
    org_id: int = Field(sa_column=_org_fk())
    # members_added, members_removed, member_expired, access_added, ...
    action: str = Field(sa_column=Column(String(48), nullable=False))
    actor_id: Optional[int] = Field(default=None, sa_column=Column(Integer, nullable=True))
    # Who acted when there is no person: rule sync, schedule, join code, ...
    via: str = Field(default="", sa_column=Column(String(24), nullable=False, default="", server_default=""))
    details: Optional[dict] = Field(default=None, sa_column=Column(JSON, nullable=True))
    created_at: datetime = Field(default_factory=_now, sa_column=_created())


class UserGroupAnnouncement(SQLModel, table=True):
    __tablename__ = "usergroup_announcement"

    id: Optional[int] = Field(default=None, primary_key=True)
    announcement_uuid: str = Field(sa_column=Column(String(64), nullable=False, index=True))
    usergroup_id: int = Field(sa_column=_group_fk())
    org_id: int = Field(sa_column=_org_fk())
    author_id: Optional[int] = Field(default=None, sa_column=Column(Integer, nullable=True))
    title: str = Field(sa_column=Column(String(200), nullable=False))
    body: str = Field(default="", sa_column=Column(Text, nullable=False, default="", server_default=""))
    pinned: bool = Field(default=False, sa_column=Column(Boolean, nullable=False, default=False, server_default=false()))
    emailed: int = Field(default=0, sa_column=Column(Integer, nullable=False, default=0, server_default="0"))
    created_at: datetime = Field(default_factory=_now, sa_column=_created())
