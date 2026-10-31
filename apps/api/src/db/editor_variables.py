import re
from typing import Optional

from pydantic import field_validator
from sqlalchemy import JSON, Column, ForeignKey, Integer, UniqueConstraint
from sqlmodel import Field, SQLModel

# Lowercase words joined by underscores: what {{ custom.key }} can spell.
VARIABLE_KEY_PATTERN = r"^[a-z][a-z_]{0,39}$"


class EditorVariableBase(SQLModel):
    key: str
    label: str
    description: str = ""
    default_value: str = ""
    # [{"rules": <rule tree>, "value": str}], first match wins.
    variants: list = Field(default_factory=list, sa_column=Column(JSON))


class EditorVariable(EditorVariableBase, table=True):
    """An org-defined variable such as {{ custom.support_email }}: set once,
    used everywhere, optionally with a different value per audience."""

    __table_args__ = (UniqueConstraint("org_id", "key", name="uq_editorvariable_org_key"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    variable_uuid: str = Field(default="", index=True)
    org_id: int = Field(
        sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"), index=True, nullable=False)
    )
    creator_id: Optional[int] = Field(
        default=None,
        sa_column=Column(Integer, ForeignKey("user.id", ondelete="SET NULL")),
    )
    creation_date: str = ""
    update_date: str = ""


class EditorVariableVariant(SQLModel):
    rules: dict
    value: str = Field(max_length=500)


class EditorVariableCreate(SQLModel):
    org_id: int
    key: str
    label: str = Field(min_length=1, max_length=80)
    description: str = Field(default="", max_length=300)
    default_value: str = Field(default="", max_length=500)
    variants: list[EditorVariableVariant] = Field(default_factory=list, max_length=20)

    @field_validator("key")
    @classmethod
    def _key_spells_a_placeholder(cls, key: str) -> str:
        if not re.fullmatch(VARIABLE_KEY_PATTERN, key):
            raise ValueError("Use lowercase letters and underscores, e.g. support_email")
        return key


class EditorVariableUpdate(SQLModel):
    label: Optional[str] = Field(default=None, min_length=1, max_length=80)
    description: Optional[str] = Field(default=None, max_length=300)
    default_value: Optional[str] = Field(default=None, max_length=500)
    variants: Optional[list[EditorVariableVariant]] = Field(default=None, max_length=20)


class EditorVariableRead(EditorVariableBase):
    id: int
    variable_uuid: str
    org_id: int
    creator_id: Optional[int] = None
    creation_date: str
    update_date: str
