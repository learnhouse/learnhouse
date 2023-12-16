from typing import Optional
from sqlalchemy import BigInteger, Column, ForeignKey
from sqlmodel import Field, SQLModel


class UserOrganization(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(default=None, foreign_key="user.id")
    org_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("organization.id", ondelete="CASCADE"))
    )
    role_id: int = Field(default=None, foreign_key="role.id")
    creation_date: str
    update_date: str
