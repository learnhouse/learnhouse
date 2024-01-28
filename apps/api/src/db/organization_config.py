from typing import Literal, Optional
from pydantic import BaseModel
from sqlalchemy import JSON, BigInteger, Column, ForeignKey
from sqlmodel import Field, SQLModel


# AI
class AILimitsSettings(BaseModel):
    limits_enabled: bool = False
    max_asks: int = 0


class AIEnabledFeatures(BaseModel):
    editor: bool = False
    activity_ask: bool = False
    course_ask: bool = False
    global_ai_ask: bool = False


class AIConfig(BaseModel):
    enabled : bool = True
    limits: AILimitsSettings = AILimitsSettings()
    embeddings: Literal[
        "text-embedding-ada-002",
    ] = "text-embedding-ada-002"
    ai_model: Literal["gpt-3.5-turbo", "gpt-4-1106-preview"] = "gpt-3.5-turbo"
    features: AIEnabledFeatures = AIEnabledFeatures()


class OrgUserConfig(BaseModel):
    signup_mechanism: Literal["open", "inviteOnly"] = "open"


# Limits
class LimitSettings(BaseModel):
    limits_enabled: bool = False
    max_users: int = 0
    max_storage: int = 0
    max_staff: int = 0


# General
class GeneralConfig(BaseModel):
    color: str = ""
    limits: LimitSettings = LimitSettings()
    users: OrgUserConfig = OrgUserConfig()
    active: bool = True


class OrganizationConfigBase(SQLModel):
    GeneralConfig: GeneralConfig
    AIConfig: AIConfig
        
class OrganizationConfig(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("organization.id", ondelete="CASCADE"))
    )
    # TODO: fix this to use the correct type GeneralConfig
    config: dict = Field(default={}, sa_column=Column(JSON))
    creation_date: Optional[str]
    update_date: Optional[str]

   


