from enum import Enum
from typing import Optional
from sqlalchemy import JSON, Column, ForeignKey, Integer, String
from sqlmodel import Field, SQLModel


class EditorTemplateKind(str, Enum):
    BLOCK = "block"  # a selection of blocks, inserted at the cursor
    PAGE = "page"    # a whole page, used to start an activity


class EditorTemplateBase(SQLModel):
    name: str
    description: str = ""
    # Plain string column: no Postgres enum type to migrate when a kind is added.
    kind: EditorTemplateKind = Field(
        default=EditorTemplateKind.BLOCK,
        sa_column=Column(String, nullable=False, server_default="block"),
    )
    # A TipTap document ({"type": "doc", "content": [...]}).
    content: dict = Field(default_factory=dict, sa_column=Column(JSON))


class EditorTemplate(EditorTemplateBase, table=True):
    """Reusable editor content shared by the authors of an organization."""

    id: Optional[int] = Field(default=None, primary_key=True)
    template_uuid: str = Field(default="", index=True)
    org_id: int = Field(
        sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"), index=True, nullable=False)
    )
    creator_id: Optional[int] = Field(
        default=None,
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="SET NULL")),
    )
    creation_date: str = ""
    update_date: str = ""


class EditorTemplateCreate(SQLModel):
    org_id: int
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=500)
    kind: EditorTemplateKind = EditorTemplateKind.BLOCK
    content: dict


class EditorTemplateUpdate(SQLModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    description: Optional[str] = Field(default=None, max_length=500)
    content: Optional[dict] = None


class EditorTemplateRead(EditorTemplateBase):
    id: int
    template_uuid: str
    org_id: int
    creator_id: Optional[int] = None
    creation_date: str
    update_date: str
