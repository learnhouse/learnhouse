import re
from typing import Literal, Optional
from pydantic import BaseModel, field_validator
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
    # Platform kill switch (superadmin). Never takes away a feature a paid plan
    # includes; see resolve_feature().
    disabled: bool = False
    # The organization's own choice, set from its Features settings. Always
    # honored: an org may turn off anything it does not want to use.
    org_disabled: bool = False


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
    # methods, i.e. no restriction; the policy is a no-op until an admin removes
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
    paths: FeatureAdminToggle = FeatureAdminToggle()
    messaging: FeatureAdminToggle = FeatureAdminToggle()
    payments: FeatureAdminToggle = FeatureAdminToggle()
    playgrounds: FeatureAdminToggle = FeatureAdminToggle()
    podcasts: FeatureAdminToggle = FeatureAdminToggle()
    live_sessions: FeatureAdminToggle = FeatureAdminToggle()
    # AI app connections over MCP; see src/services/mcp/access.py.
    mcp: FeatureAdminToggle = FeatureAdminToggle()


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
    # "unsplash" is no longer offered by the dashboard; it stays accepted so
    # organizations that picked one before keep their background.
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
    # Square variant of the logo for the places that render the brand in a
    # fixed square box (sign-in panel, org switcher, dashboard sidebar).
    # Empty means "fall back to logo_image".
    square_logo_image: str = ""
    watermark: bool = True
    font: str = ""
    default_language: str = "en"
    # Display name on transactional email from this org. The From ADDRESS is
    # never configurable (it stays the platform's verified sending domain, so
    # DKIM keeps aligning), only the name a recipient sees. Empty means "use
    # the platform default".
    email_sender_name: str = ""


_VERIFICATION_RE = re.compile(r"^[A-Za-z0-9_\-=:.]*$")
_ORG_SCHEMA_TYPES = ("", "EducationalOrganization", "Organization", "CollegeOrUniversity", "School", "OnlineBusiness", "Corporation")


class SeoOrgConfig(BaseModel):
    default_meta_title_suffix: str = ""
    # "%s" is replaced with the page name; wins over the suffix when set.
    default_title_template: str = Field(default="", max_length=120)
    default_meta_description: str = ""
    default_og_image: str = ""
    google_site_verification: str = ""
    bing_site_verification: str = ""
    yandex_verification: str = ""
    pinterest_verification: str = ""
    twitter_handle: str = ""
    noindex_communities: bool = False
    # Hide the whole org from search engines (noindex everywhere, robots.txt
    # Disallow: /, empty sitemap).
    indexing_disabled: bool = False
    # Extra robots.txt directives, one per line (filtered when served).
    robots_extra_rules: str = Field(default="", max_length=2000)
    organization_type: str = ""

    @field_validator("google_site_verification", "bing_site_verification", "yandex_verification", "pinterest_verification")
    @classmethod
    def _verification_code(cls, value: str) -> str:
        value = (value or "").strip()
        # People paste the whole <meta> tag: keep only its content value.
        match = re.search(r'content=["\']([^"\']*)["\']', value)
        if match:
            value = match.group(1).strip()
        if len(value) > 200 or not _VERIFICATION_RE.match(value):
            raise ValueError("Verification codes may only contain letters, digits and - _ = : .")
        return value

    @field_validator("default_title_template")
    @classmethod
    def _title_template(cls, value: str) -> str:
        value = (value or "").strip()
        if value and "%s" not in value:
            raise ValueError("The title template must contain %s")
        return value

    @field_validator("organization_type")
    @classmethod
    def _org_type(cls, value: str) -> str:
        if value not in _ORG_SCHEMA_TYPES:
            raise ValueError("Unsupported organization type")
        return value


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
# Where an answer is also saved in the member's people data (org_member_profile):
# one of its columns, the manager (the answer is the manager's email) or a
# custom attribute stored under the field's key.
SignupPeopleField = Literal[
    "department", "title", "employee_id", "location", "cost_center", "manager_email", "attribute"
]
# The profile columns an answer can fill, and the field types that fit them.
SIGNUP_PEOPLE_COLUMNS = ("department", "title", "employee_id", "location", "cost_center")
SIGNUP_PEOPLE_FIELD_TYPES: dict[str, tuple[str, ...]] = {
    **{column: ("text", "select", "number") for column in SIGNUP_PEOPLE_COLUMNS},
    "manager_email": ("text",),
    "attribute": ("text", "textarea", "select", "checkbox", "number", "date"),
}


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
    # select only: the permitted values. A submitted value outside this list is
    # rejected server-side, so it doubles as the validation allowlist.
    options: list[str] = Field(default_factory=list)
    # text/textarea only.
    max_length: Optional[int] = None
    # number only.
    min_value: Optional[float] = None
    max_value: Optional[float] = None
    # Also save the answer to the member's people data (people data feature).
    people_field: Optional[SignupPeopleField] = None


class SignupFieldsConfig(BaseModel):
    # Empty means the signup form renders exactly as it did before this feature.
    fields: list[SignupFieldItem] = Field(default_factory=list)


def safe_course_end_link(value: str, field_name: str = "button_link") -> str:
    """Allow only an internal path ("/courses") or an absolute http(s) URL, so a
    stored completion-screen link can never become a javascript: href."""
    if not value:
        return value
    if value.startswith("/") and not value.startswith("//"):
        return value
    if value.lower().startswith(("http://", "https://")):
        return value
    raise ValueError(f"{field_name} must be an internal path or an http(s) URL")


class CourseEndConfig(BaseModel):
    # Shown on the course-completion screen. Everything empty means the screen
    # renders its defaults.
    message: str = Field(default="", max_length=500)
    button_text: str = Field(default="", max_length=60)
    # Internal path ("/courses") or absolute http(s) URL. Anything else is
    # rejected so a stored value can never become a javascript: link.
    button_link: str = Field(default="", max_length=2048)

    @field_validator("message", "button_text", "button_link")
    @classmethod
    def _strip(cls, value: str) -> str:
        return value.strip()

    @field_validator("button_link")
    @classmethod
    def _safe_link(cls, value: str) -> str:
        return safe_course_end_link(value)


# ============================================================================
# Theme (learner-facing look). Every value here ends up in a CSS custom
# property, a data attribute or a Google Fonts URL, so each field is either an
# enum, a strict hex color or an allowlisted font name. Defaults reproduce the
# look orgs had before the theme existed.
# ============================================================================

_HEX_COLOR_RE = re.compile(r"^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")
# Google Fonts family names are letters, digits and single spaces (the whole
# catalog matches), which keeps the value inert in CSS and in a URL.
_FONT_NAME_RE = re.compile(r"^[A-Za-z0-9]+( [A-Za-z0-9]+)*$")
FONT_NAME_MAX_LENGTH = 64


def normalize_theme_color(value: str, field_name: str = "color") -> str:
    """``#rrggbb`` (lowercase) for a hex color, ``""`` for empty, else ValueError."""
    value = (value or "").strip()
    if not value:
        return ""
    match = _HEX_COLOR_RE.match(value)
    if not match:
        raise ValueError(f"{field_name} must be a hex color like #1d4ed8")
    digits = match.group(1).lower()
    if len(digits) == 3:
        digits = "".join(ch * 2 for ch in digits)
    return f"#{digits}"


def validate_font_name(value: str, field_name: str = "font") -> str:
    """A Google Fonts family name, or ``""`` for the platform default."""
    value = " ".join((value or "").split())
    if not value:
        return ""
    if len(value) > FONT_NAME_MAX_LENGTH or not _FONT_NAME_RE.match(value):
        raise ValueError(f"{field_name} must be a font family name (letters, digits and spaces)")
    return value


ThemePreset = Literal[
    "", "custom", "classic", "ocean", "forest", "midnight", "sunset", "orchid", "slate", "sand",
    # Added with the theme studio: fuller looks (palette, type, shape, layout).
    "atelier", "harbor", "grove", "noir", "ember", "linen", "citrus", "glacier",
]


class ThemeCustomization(BaseModel):
    preset: ThemePreset = ""
    # Buttons, links, progress and chips: the platform's neutral look, the
    # brand color (customization.general.color) or a separate accent.
    accent_mode: Literal["neutral", "brand", "custom"] = "neutral"
    accent_color: str = ""
    # "brand" paints the header in the brand color, white when there is none.
    header_style: Literal["brand", "white", "dark", "glass"] = "brand"
    radius: Literal["none", "sharp", "soft", "round"] = "soft"
    # Empty heading font means headings use the body font.
    heading_font: str = ""
    button_style: Literal["solid", "soft", "outline"] = "solid"
    card_style: Literal["shadow", "border", "flat"] = "shadow"
    density: Literal["comfortable", "compact"] = "comfortable"
    # "tint" is the brand color at 5% (nothing without a brand color).
    background: Literal["tint", "plain", "pattern", "grid", "gradient"] = "tint"

    # Theme studio options. Every default reproduces the look above, so a
    # theme saved before they existed renders exactly as it did.
    # A second brand color: soft fills, gradients, the gradient background.
    secondary_color: str = ""
    # Tints the grays (page, borders, muted text) warm or cool.
    neutral: Literal["neutral", "warm", "cool"] = "neutral"
    # Heading sizes and weight on learner pages.
    type_scale: Literal["compact", "default", "large"] = "default"
    heading_weight: Literal["", "500", "600", "700", "800"] = ""
    # Buttons follow the corner radius ("auto") or get their own shape.
    button_shape: Literal["auto", "square", "rounded", "pill"] = "auto"
    # How much cards lift off the page.
    elevation: Literal["flat", "default", "lifted"] = "default"
    link_style: Literal["accent", "underline", "subtle"] = "accent"
    header_layout: Literal["standard", "centered", "minimal"] = "standard"
    footer_style: Literal["simple", "centered", "bar"] = "simple"
    # Course thumbnails and other pictures in cards.
    image_style: Literal["default", "rounded", "framed", "muted"] = "default"
    # Public pages and the visitor's dark mode: "visitor" follows the
    # visitor's choice (pages the org designed in the builder keep their own
    # colors unless they define a dark palette); "light" always shows the
    # org's light look.
    public_scheme: Literal["visitor", "light"] = "visitor"
    # The accent in dark mode ("" lifts the light accent automatically).
    dark_accent: str = ""

    @field_validator("accent_color", "secondary_color", "dark_accent")
    @classmethod
    def _accent_hex(cls, value: str, info) -> str:
        return normalize_theme_color(value, info.field_name)

    @field_validator("heading_font")
    @classmethod
    def _heading_font(cls, value: str) -> str:
        return validate_font_name(value, "heading_font")


class OrgThemeUpdate(BaseModel):
    """One save from the Branding settings: brand color, body font, theme."""

    color: str = ""
    font: str = ""
    theme: ThemeCustomization = ThemeCustomization()

    @field_validator("color")
    @classmethod
    def _color_hex(cls, value: str) -> str:
        return normalize_theme_color(value, "color")

    @field_validator("font")
    @classmethod
    def _font(cls, value: str) -> str:
        return validate_font_name(value, "font")


class CustomizationConfig(BaseModel):
    general: GeneralCustomization = GeneralCustomization()
    auth_branding: AuthBrandingConfig = AuthBrandingConfig()
    seo: SeoOrgConfig = SeoOrgConfig()
    landing: dict = Field(default_factory=dict)
    menu: MenuConfig = MenuConfig()
    signup_fields: SignupFieldsConfig = SignupFieldsConfig()
    course_end: CourseEndConfig = CourseEndConfig()
    theme: ThemeCustomization = ThemeCustomization()


# ============================================================================
# v1 General & Cloud (kept for backward compat)
# ============================================================================

class OrgGeneralConfig(BaseModel):
    enabled: bool = True
    color: str = ""
    footer_text: str = ""
    watermark: bool = True
    favicon_image: str = ""
    square_logo_image: str = ""
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
# SQLModel table (unchanged; config is a JSON blob)
# ============================================================================

class OrganizationConfig(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("organization.id", ondelete="CASCADE"), index=True)
    )
    config: dict = Field(default_factory=dict, sa_column=Column(JSON))
    creation_date: Optional[str] = None
    update_date: Optional[str] = None
