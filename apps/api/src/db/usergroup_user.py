from datetime import datetime
from typing import Optional
from sqlalchemy import JSON, Column, DateTime, ForeignKey, Index, Integer
from sqlmodel import Field, SQLModel


# Why someone is in a group. A row stays while at least one source holds it:
# a member added by hand who also matches the group's rules keeps the row
# when the rule stops matching. NULL (rows written before sources existed,
# or by code that doesn't set it) reads as ["manual"].
MEMBERSHIP_SOURCES = ("manual", "rule", "inherited", "code", "import", "domain")


class UserGroupUser(SQLModel, table=True):
    __table_args__ = (Index("ix_usergroupuser_group_user", "usergroup_id", "user_id"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    usergroup_id: int = Field(
        sa_column=Column(Integer, ForeignKey("usergroup.id", ondelete="CASCADE"), nullable=False)
    )
    user_id: int = Field(
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="CASCADE"), nullable=False)
    )
    org_id: int = Field(
        sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False)
    )
    creation_date: str = ""
    update_date: str = ""
    sources: Optional[list] = Field(default=None, sa_column=Column(JSON, nullable=True))
    # Direct membership ends here (the group sync removes it; access checks
    # stop honouring it at once).
    expires_at: Optional[datetime] = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )
    # Who added the member (no FK: the actor may be deleted later).
    added_by_id: Optional[int] = Field(default=None, sa_column=Column(Integer, nullable=True))
