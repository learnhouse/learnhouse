from datetime import datetime
from typing import Optional
from sqlalchemy import JSON, Column, DateTime, ForeignKey, Integer, String
from sqlmodel import Field, SQLModel


# How a group's members are decided: added by hand, by rules (smart), or both.
USERGROUP_KINDS = ("manual", "smart", "hybrid")


class UserGroupBase(SQLModel):
    name: str
    description: str

class UserGroup(UserGroupBase, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(
        sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"), nullable=False)
    )
    usergroup_uuid: str = ""
    creation_date: str = ""
    update_date: str = ""
    # manual | smart | hybrid (see USERGROUP_KINDS). Existing groups are manual.
    kind: str = Field(
        default="manual", sa_column=Column(String(16), nullable=False, default="manual", server_default="manual")
    )
    # Smart membership rules: {"match": "all"|"any", "conditions": [...]}.
    rules: Optional[dict] = Field(default=None, sa_column=Column(JSON, nullable=True))
    # Nesting: members of a sub-group are members of its parent too, so access
    # granted to the parent reaches them (access inherits downward).
    parent_id: Optional[int] = Field(
        default=None,
        sa_column=Column(Integer, ForeignKey("usergroup.id", ondelete="SET NULL"), nullable=True, index=True),
    )
    color: Optional[str] = Field(default=None, sa_column=Column(String(16), nullable=True))
    # Space, join and notification settings (see services/usergroups/common.py).
    settings: Optional[dict] = Field(default=None, sa_column=Column(JSON, nullable=True))
    last_synced_at: Optional[datetime] = Field(
        default=None, sa_column=Column(DateTime(timezone=True), nullable=True)
    )

class UserGroupCreate(UserGroupBase):
    org_id: int = Field(default=None, foreign_key="organization.id")
    pass

class UserGroupUpdate(SQLModel):
    name: Optional[str] = None
    description: Optional[str] = None

class UserGroupRead(UserGroupBase):
    id: int
    org_id: int = Field(default=None, foreign_key="organization.id")
    usergroup_uuid: str
    creation_date: str
    update_date: str
    kind: Optional[str] = "manual"
    parent_id: Optional[int] = None
    color: Optional[str] = None
    pass
