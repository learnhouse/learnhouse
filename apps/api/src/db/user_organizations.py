from typing import Optional
from sqlalchemy import Column, ForeignKey, Index, Integer
from sqlmodel import Field, SQLModel


class UserOrganization(SQLModel, table=True):
    __table_args__ = (
        Index("ix_userorg_user_org", "user_id", "org_id"),
        Index("ix_userorg_org_role", "org_id", "role_id"),
    )
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="CASCADE"), nullable=False, index=True)
    )
    org_id: int = Field(
        sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"), index=True)
    )
    role_id: int = Field(default=None, foreign_key="role.id", index=True)
    creation_date: str
    update_date: str
