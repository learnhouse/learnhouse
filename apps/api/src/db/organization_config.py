from typing import Literal, Optional
from pydantic import BaseModel
from sqlalchemy import JSON, BigInteger, Column, ForeignKey
from sqlmodel import Field, SQLModel


# Features
class CourseOrgConfig(BaseModel):
    enabled: bool = True
    limit: int = 10


class MemberOrgConfig(BaseModel):
    enabled: bool = True
    signup_mode: Literal["open", "inviteOnly"] = "open"
    admin_limit: int = 1
    limit: int = 10


class UserGroupOrgConfig(BaseModel):
    enabled: bool = True
    limit: int = 10


class StorageOrgConfig(BaseModel):
    enabled: bool = True
    limit: int = 10


class AIOrgConfig(BaseModel):
    enabled: bool = True
    limit: int = 10
    model: str = "gpt-4o-mini"


class AssignmentOrgConfig(BaseModel):
    enabled: bool = False
    limit: int = 10


class PaymentOrgConfig(BaseModel):
    enabled: bool = True


class DiscussionOrgConfig(BaseModel):
    enabled: bool = True
    limit: int = 10


class AnalyticsOrgConfig(BaseModel):
    enabled: bool = True
    limit: int = 10


class CollaborationOrgConfig(BaseModel):
    enabled: bool = True
    limit: int = 10


class APIOrgConfig(BaseModel):
    enabled: bool = True
    limit: int = 10


class OrgFeatureConfig(BaseModel):
    courses: CourseOrgConfig = CourseOrgConfig()
    members: MemberOrgConfig = MemberOrgConfig()
    usergroups: UserGroupOrgConfig = UserGroupOrgConfig()
    storage: StorageOrgConfig = StorageOrgConfig()
    ai: AIOrgConfig = AIOrgConfig()
    assignments: AssignmentOrgConfig = AssignmentOrgConfig()
    payments: PaymentOrgConfig = PaymentOrgConfig()
    discussions: DiscussionOrgConfig = DiscussionOrgConfig()
    analytics: AnalyticsOrgConfig = AnalyticsOrgConfig()
    collaboration: CollaborationOrgConfig = CollaborationOrgConfig()
    api: APIOrgConfig = APIOrgConfig()


# General
class OrgGeneralConfig(BaseModel):
    enabled: bool = True
    color: str = "normal"
    watermark: bool = True


# Cloud
class OrgCloudConfig(BaseModel):
    plan: Literal["free", "standard", "pro"] = "free"
    custom_domain: bool = False


# Main Config
class OrganizationConfigBase(BaseModel):
    config_version: str = "1.3"
    general: OrgGeneralConfig
    features: OrgFeatureConfig
    cloud: OrgCloudConfig
    landing: dict = {}


class OrganizationConfig(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("organization.id", ondelete="CASCADE"))
    )
    config: dict = Field(default={}, sa_column=Column(JSON))
    creation_date: Optional[str]
    update_date: Optional[str]
