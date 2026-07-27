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


class FoldersOrgConfig(BaseModel):
    enabled: bool = True
    # Library folder ordering. One of: name_asc | name_desc | newest | oldest | manual.
    sort_mode: str = "name_asc"


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
    folders: FoldersOrgConfig = FoldersOrgConfig()
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


class SecurityAdminToggle(BaseModel):
    """Org-wide security policy.

    Lives in the config JSON blob, so enabling it needs no migration.

    ``require_2fa_enabled_at`` is the anchor the grace period counts from. Each
    member's personal deadline is
    ``max(require_2fa_enabled_at, their join date) + require_2fa_grace_days``;
    without the ``max`` a member who joins after the policy was set would land
    with an already-expired deadline and be locked out on their first day.
    """

    require_2fa: bool = False
    require_2fa_grace_days: int = 0
    # ISO timestamp of when an admin last switched require_2fa on.
    require_2fa_enabled_at: Optional[str] = None
    # Users authenticated by an external IdP already presented whatever factors
    # that IdP demands; requiring a second app-level TOTP on top is redundant
    # and, for a SAML-only org, would be unsatisfiable.
    exempt_external_auth: bool = True

    # Which sign-in methods this org accepts. Members of the org must have
    # authenticated with one of these to access it. The default lists all
    # methods, i.e. no restriction — the policy is a no-op until an admin removes
    # one. Values are drawn from
    # src.security.session_context.POLICY_AUTH_METHODS:
    # "password" | "magic_login" | "google" | "sso". Empty list is treated as
    # "unrestricted" too, so a mis-save can never lock every method out.
    allowed_auth_methods: list[str] = Field(
        default_factory=lambda: ["password", "magic_login", "google", "sso"]
    )
    # Whether a session established on the central apex (learnhouse.io) or for a
    # different org may be used to access this org directly. Default True keeps
    # today's behavior (one session works everywhere the user is a member). When
    # False, a member arriving with a foreign/central session is refused and must
    # sign in again from this org using an allowed method.
    allow_central_session_sharing: bool = True


class AdminToggles(BaseModel):
    security: SecurityAdminToggle = SecurityAdminToggle()
    ai: AIAdminToggle = AIAdminToggle()
    analytics: FeatureAdminToggle = FeatureAdminToggle()
    api: FeatureAdminToggle = FeatureAdminToggle()
    boards: FeatureAdminToggle = FeatureAdminToggle()
    collaboration: FeatureAdminToggle = FeatureAdminToggle()
    folders: FeatureAdminToggle = FeatureAdminToggle()
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
    default_language: str = "en"


class SeoOrgConfig(BaseModel):
    default_meta_title_suffix: str = ""
    default_meta_description: str = ""
    default_og_image: str = ""
    google_site_verification: str = ""
    twitter_handle: str = ""
    noindex_communities: bool = False


class MenuLinkItem(BaseModel):
    # Built-in types: courses | library | podcasts | communities | playgrounds | store
    # plus "custom" for an admin-defined external/internal link.
    type: str
    enabled: bool = True
    order: int = 0
    label: str = ""       # optional label override (empty -> default translation)
    url: str = ""         # for type == "custom"
    icon: str = ""        # for type == "custom" (phosphor icon name)


class MenuConfig(BaseModel):
    # When items is empty, the public menu falls back to its feature-driven defaults.
    items: list[MenuLinkItem] = Field(default_factory=list)


# ============================================================================
# Custom signup fields (shared between v1 and v2)
# ============================================================================

SignupFieldType = Literal["text", "textarea", "select", "checkbox", "number", "date"]


class SignupFieldItem(BaseModel):
    """One admin-defined field shown on the org's signup form.

    Answers are stored on the user's ``extra_metadata`` JSON under ``key``.

    ``key`` is the JSON key and must stay stable: renaming it orphans every
    answer already collected, so the admin UI locks it after creation.

    NOTE: this config is served by the unauthenticated ``GET /orgs/slug/{slug}``
    endpoint (the public signup form needs it), so labels, help text and options
    are PUBLIC strings. Nothing sensitive belongs in them.
    """

    key: str
    label: str = ""
    type: SignupFieldType = "text"
    required: bool = False
    enabled: bool = True
    order: int = 0
    help_text: str = ""
    placeholder: str = ""
    # select only — the permitted values. A submitted value outside this list is
    # rejected server-side, so it doubles as the validation allowlist.
    options: list[str] = Field(default_factory=list)
    # text/textarea only.
    max_length: Optional[int] = None
    # number only.
    min_value: Optional[float] = None
    max_value: Optional[float] = None


class SignupFieldsConfig(BaseModel):
    # Empty means the signup form renders exactly as it did before this feature.
    fields: list[SignupFieldItem] = Field(default_factory=list)


class CustomizationConfig(BaseModel):
    general: GeneralCustomization = GeneralCustomization()
    auth_branding: AuthBrandingConfig = AuthBrandingConfig()
    seo: SeoOrgConfig = SeoOrgConfig()
    landing: dict = Field(default_factory=dict)
    menu: MenuConfig = MenuConfig()
    signup_fields: SignupFieldsConfig = SignupFieldsConfig()


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
