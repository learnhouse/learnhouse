from typing import Optional
from sqlmodel import Field, SQLModel
from enum import Enum

class HeaderTypeEnum(str, Enum):
    LOGO_MENU_SETTINGS = "LOGO_MENU_SETTINGS"
    MENU_LOGO_SETTINGS = "MENU_LOGO_SETTINGS"


class OrganizationSettings(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(default=None, foreign_key="organization.id")
    logo_image: Optional[str] = ""
    header_type: HeaderTypeEnum = HeaderTypeEnum.LOGO_MENU_SETTINGS
    color: str = ""
    creation_date: str
    update_date: str
