from typing import Optional
from sqlalchemy import BigInteger, Column, ForeignKey
from sqlmodel import Field, SQLModel
from enum import Enum


class HeaderTypeEnum(str, Enum):
    LOGO_MENU_SETTINGS = "LOGO_MENU_SETTINGS"
    MENU_LOGO_SETTINGS = "MENU_LOGO_SETTINGS"


class OrganizationSettings(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("organization.id", ondelete="CASCADE"))
    )
    logo_image: Optional[str] = ""
    header_type: HeaderTypeEnum = HeaderTypeEnum.LOGO_MENU_SETTINGS
    color: str = ""
    creation_date: str
    update_date: str
