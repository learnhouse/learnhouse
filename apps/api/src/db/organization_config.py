from typing import Literal, Optional
from pydantic import BaseModel
from sqlalchemy import JSON, BigInteger, Column, ForeignKey
from sqlmodel import Field, SQLModel


# ============================================================================
# v1 Feature models (kept for backward compat with existing code imports)
# ============================================================================

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
    model: str = ""


class AssignmentOrgConfig(BaseModel):
    enabled: bool = False
    limit: int = 10


class PaymentOrgConfig(BaseModel):
    enabled: bool = False


class DiscussionOrgConfig(BaseModel):
    enabled: bool = True
    limit: int = 10


class CommunitiesOrgConfig(BaseModel):
    enabled: bool = True


class CollectionsOrgConfig(BaseModel):
    enabled: bool = True


class AnalyticsOrgConfig(BaseModel):
    enabled: bool = True
    limit: int = 10


class CollaborationOrgConfig(BaseModel):
    enabled: bool = True
    limit: int = 10


class APIOrgConfig(BaseModel):
    enabled: bool = True
    limit: int = 10


class PodcastsOrgConfig(BaseModel):
    enabled: bool = False
    limit: int = 10


class BoardsOrgConfig(BaseModel):
    enabled: bool = False
    limit: int = 10


class PlaygroundsOrgConfig(BaseModel):
    enabled: bool = False
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
    communities: CommunitiesOrgConfig = CommunitiesOrgConfig()
    collections: CollectionsOrgConfig = CollectionsOrgConfig()
    analytics: AnalyticsOrgConfig = AnalyticsOrgConfig()
    collaboration: CollaborationOrgConfig = CollaborationOrgConfig()
    api: APIOrgConfig = APIOrgConfig()
    podcasts: PodcastsOrgConfig = PodcastsOrgConfig()
    boards: BoardsOrgConfig = BoardsOrgConfig()
    playgrounds: PlaygroundsOrgConfig = PlaygroundsOrgConfig()


# ============================================================================
# v2 Admin Toggle models
# ============================================================================

class AIAdminToggle(BaseModel):
    disabled: bool = False
    copilot_enabled: bool = True


class MembersAdminToggle(BaseModel):
    disabled: bool = False
    signup_mode: Literal["open", "inviteOnly"] = "open"


class FeatureAdminToggle(BaseModel):
    disabled: bool = False


class AdminToggles(BaseModel):
    ai: AIAdminToggle = AIAdminToggle()
    analytics: FeatureAdminToggle = FeatureAdminToggle()
    api: FeatureAdminToggle = FeatureAdminToggle()
    boards: FeatureAdminToggle = FeatureAdminToggle()
    collaboration: FeatureAdminToggle = FeatureAdminToggle()
    collections: FeatureAdminToggle = FeatureAdminToggle()
    communities: FeatureAdminToggle = FeatureAdminToggle()
    members: MembersAdminToggle = MembersAdminToggle()
    payments: FeatureAdminToggle = FeatureAdminToggle()
    playgrounds: FeatureAdminToggle = FeatureAdminToggle()
    podcasts: FeatureAdminToggle = FeatureAdminToggle()


# ============================================================================
# v2 Overrides model
# ============================================================================

class FeatureOverride(BaseModel):
    extra_limit: int = 0
    force_enabled: bool = False


class Overrides(BaseModel):
    note: str = ""


# ============================================================================
# Auth Branding (shared between v1 and v2)
# ============================================================================

class AuthBrandingConfig(BaseModel):
    welcome_message: str = ""
    background_type: Literal["gradient", "custom", "unsplash"] = "gradient"
    background_image: str = ""
    text_color: Literal["light", "dark"] = "light"
    unsplash_photographer_name: str = ""
    unsplash_photographer_url: str = ""
    unsplash_photo_url: str = ""


# ============================================================================
# v2 Customization models
# ============================================================================

class GeneralCustomization(BaseModel):
    color: str = ""
    footer_text: str = ""
    favicon_image: str = ""
    watermark: bool = True
    font: str = ""


class SeoOrgConfig(BaseModel):
    default_meta_title_suffix: str = ""
    default_meta_description: str = ""
    default_og_image: str = ""
    google_site_verification: str = ""
    twitter_handle: str = ""
    noindex_communities: bool = False


class CustomizationConfig(BaseModel):
    general: GeneralCustomization = GeneralCustomization()
    auth_branding: AuthBrandingConfig = AuthBrandingConfig()
    seo: SeoOrgConfig = SeoOrgConfig()
    landing: dict = Field(default_factory=dict)


# ============================================================================
# v1 General & Cloud (kept for backward compat)
# ============================================================================

class OrgGeneralConfig(BaseModel):
    enabled: bool = True
    color: str = ""
    footer_text: str = ""
    watermark: bool = True
    favicon_image: str = ""
    auth_branding: AuthBrandingConfig = AuthBrandingConfig()


class OrgCloudConfig(BaseModel):
    plan: Literal["free", "personal", "personal-family", "standard", "pro", "enterprise", "oss"] = "free"
    custom_domain: bool = False


# ============================================================================
# v1 Main Config (kept for backward compat with existing code)
# ============================================================================

class OrganizationConfigBase(BaseModel):
    config_version: str = "1.4"
    general: OrgGeneralConfig
    features: OrgFeatureConfig
    cloud: OrgCloudConfig
    landing: dict = Field(default_factory=dict)
    seo: SeoOrgConfig = SeoOrgConfig()


# ============================================================================
# v2 Main Config
# ============================================================================

class OrganizationConfigV2Base(BaseModel):
    config_version: str = "2.0"
    active: bool = True
    plan: str = "free"
    admin_toggles: AdminToggles = AdminToggles()
    overrides: dict = Field(default_factory=dict)
    customization: CustomizationConfig = CustomizationConfig()


# ============================================================================
# SQLModel table (unchanged — config is a JSON blob)
# ============================================================================

class OrganizationConfig(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("organization.id", ondelete="CASCADE"), index=True)
    )
    config: dict = Field(default_factory=dict, sa_column=Column(JSON))
    creation_date: Optional[str] = None
    update_date: Optional[str] = None
