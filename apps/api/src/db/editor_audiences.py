from typing import Optional
from sqlalchemy import JSON, Column, ForeignKey, Integer
from sqlmodel import Field, SQLModel


class EditorAudienceBase(SQLModel):
    name: str
    description: str = ""
    # The same rule tree a conditional block stores ({"match", "conditions"}).
    rules: dict = Field(default_factory=dict, sa_column=Column(JSON))


class EditorAudience(EditorAudienceBase, table=True):
    """A named, reusable set of rules ("Internal staff", "Week 2 onwards") that
    conditional blocks refer to by uuid, so changing it updates every block."""

    id: Optional[int] = Field(default=None, primary_key=True)
    audience_uuid: str = Field(default="", index=True)
    org_id: int = Field(
        sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"), index=True, nullable=False)
    )
    creator_id: Optional[int] = Field(
        default=None,
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="SET NULL")),
    )
    creation_date: str = ""
    update_date: str = ""


class EditorAudienceCreate(SQLModel):
    org_id: int
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(default="", max_length=300)
    rules: dict


class EditorAudienceUpdate(SQLModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=80)
    description: Optional[str] = Field(default=None, max_length=300)
    rules: Optional[dict] = None


class EditorAudienceRead(EditorAudienceBase):
    id: int
    audience_uuid: str
    org_id: int
    creator_id: Optional[int] = None
    creation_date: str
    update_date: str
