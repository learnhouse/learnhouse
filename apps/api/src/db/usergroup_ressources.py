from typing import Optional
from sqlalchemy import Column, ForeignKey, Integer
from sqlmodel import Field, SQLModel


class UserGroupRessource(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    usergroup_id: int = Field(
        sa_column=Column(Integer, ForeignKey("usergroup.id", ondelete="CASCADE"))
    )
    ressource_uuid: str = ""
    org_id: int = Field(
        sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"))
    )
    creation_date: str = ""
    update_date: str = ""
