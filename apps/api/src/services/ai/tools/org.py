"""Organization tools: the profile and the settings an admin edits.

The organization is always the connected one (`ctx.org`), never an id the
caller names. Settings are typed sections, so an unknown key is an error
instead of a silent "updated", colours must be colours, and links must be
http(s). Some settings stay out of reach on purpose: AI app connections,
sign-in methods, two-factor policy, custom domains, page scripts, payments
and the plan change only from the dashboard. Changing settings is for org
admins, as on the HTTP settings routes.
"""

from __future__ import annotations

import json
from typing import Annotated, Any, Literal, Union

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator
from sqlmodel import select

from src.db.organization_config import (
    AuthBrandingConfig,
    CourseEndConfig,
    MenuConfig,
    OrganizationConfig,
    SeoOrgConfig,
)
from src.db.organizations import OrganizationUpdate
from src.security.auth import resolve_acting_user_id
from src.security.features_utils.resolve import resolve_all_features
from src.security.rbac import AccessAction
from src.services.ai.tools import refs
from src.services.ai.tools.base import ActionTier, ToolContext, ToolSpec
from src.services.ai.tools.results import DETAIL_TEXT, changed, clip
from src.services.orgs.orgs import (
    get_organization_by_slug,
    is_org_admin_role,
    update_org,
    update_org_ai_config,
    update_org_auth_branding_config,
    update_org_boards_config,
    update_org_color_config,
    update_org_communities_config,
    update_org_course_end_config,
    update_org_courses_config,
    update_org_default_language_config,
    update_org_email_sender_name_config,
    update_org_folders_config,
    update_org_folders_sort_config,
    update_org_font_config,
    update_org_footer_text_config,
    update_org_landing,
    update_org_menu_config,
    update_org_playgrounds_config,
    update_org_podcasts_config,
    update_org_seo_config,
    update_org_signup_mechanism,
    update_org_watermark_config,
)

# The fonts the branding page offers (apps/web/lib/fonts.ts); "" is the default.
FONTS = (
    "Albert Sans", "Barlow", "Cabin", "DM Sans", "Exo 2", "Figtree", "Fira Sans",
    "IBM Plex Sans", "Instrument Sans", "Inter", "Josefin Sans", "Karla", "Lato",
    "Lexend", "Libre Franklin", "Manrope", "Montserrat", "Mulish", "Noto Sans",
    "Nunito", "Onest", "Open Sans", "Outfit", "Overpass", "Plus Jakarta Sans",
    "Poppins", "PT Sans", "Quicksand", "Raleway", "Red Hat Display", "Roboto",
    "Rubik", "Source Sans 3", "Sora", "Space Grotesk", "Titillium Web", "Urbanist",
    "Wix Madefor Text", "Work Sans",
)
FontName = Literal[FONTS + ("",)]  # type: ignore[valid-type]

# Categories the general settings page offers.
OrgLabel = Literal[
    "languages", "business", "ecommerce", "gaming", "music", "sports", "cars",
    "sales_marketing", "tech", "photo_video", "pets", "personal_development",
    "real_estate", "beauty_fashion", "travel", "productivity", "health_fitness",
    "finance", "arts_crafts", "education", "stem", "humanities",
    "professional_skills", "digital_skills", "creative_arts", "social_sciences",
    "test_prep", "vocational", "early_education",
]

_TOGGLES = ("courses", "communities", "folders", "podcasts", "boards", "playgrounds")
_TOGGLE_SERVICES = {
    "courses": update_org_courses_config,
    "communities": update_org_communities_config,
    "folders": update_org_folders_config,
    "podcasts": update_org_podcasts_config,
    "boards": update_org_boards_config,
    "playgrounds": update_org_playgrounds_config,
}
_MENU_TYPES = ("courses", "library", "podcasts", "communities", "playgrounds", "store", "custom")
_LANDING_TYPES = frozenset({
    "hero", "text-and-image", "logos", "people", "featured-courses", "video",
    "rich-text", "features", "stats", "testimonials", "faq", "cta", "gallery",
    "spacer", "pricing", "steps", "columns", "image", "embed", "banner", "countdown",
})
_UNSAFE_SCHEMES = ("javascript:", "vbscript:", "data:", "file:")
_MAX_LANDING_CHARS = 100_000
_SETTINGS_PAGE = "/dash/org/settings/general"


def _safe_link(value: str) -> str:
    """'' , an internal path, or an http(s) URL."""
    value = (value or "").strip()
    if not value:
        return value
    if value.startswith("/") and not value.startswith("//"):
        return value
    if value.lower().startswith(("http://", "https://")) and not any(c.isspace() for c in value):
        return value
    raise ValueError("must be an internal path (/...) or an http(s) URL")


def _http_url(value: str) -> str:
    value = (value or "").strip()
    if value and not value.lower().startswith(("http://", "https://")):
        raise ValueError("must be an http(s) URL")
    return value


# ─── config readers (v1 and v2 layouts) ──────────────────────────────────────


def _obj(value) -> dict:
    return value if isinstance(value, dict) else {}


def _is_v2(cfg: dict) -> bool:
    return str(cfg.get("config_version", "1.0")).startswith("2")


def _general(cfg: dict) -> dict:
    if _is_v2(cfg):
        return _obj(_obj(cfg.get("customization")).get("general"))
    return _obj(cfg.get("general"))


def _custom(cfg: dict, key: str) -> Any:
    """A customization section: v2 keeps them under customization, v1 under
    general (menu, auth_branding, course_end) or at the top (seo, landing)."""
    if _is_v2(cfg):
        return _obj(cfg.get("customization")).get(key)
    if key in ("seo", "landing"):
        return cfg.get(key)
    return _obj(cfg.get("general")).get(key)


def _toggle_on(cfg: dict, feature: str) -> bool | None:
    if _is_v2(cfg):
        toggle = _obj(cfg.get("admin_toggles")).get(feature)
        return None if not isinstance(toggle, dict) else not toggle.get("disabled", False)
    entry = _obj(cfg.get("features")).get(feature)
    return None if not isinstance(entry, dict) else bool(entry.get("enabled", True))


def _signup_mode(cfg: dict) -> str:
    if _is_v2(cfg):
        mode = _obj(_obj(cfg.get("admin_toggles")).get("members")).get("signup_mode", "open")
    else:
        mode = _obj(_obj(cfg.get("features")).get("members")).get("signup_mode", "open")
    return "invite_only" if mode == "inviteOnly" else "open"


def _plan(cfg: dict) -> str:
    if _is_v2(cfg):
        return cfg.get("plan", "free")
    return _obj(cfg.get("cloud")).get("plan", "free")


async def _config(ctx: ToolContext) -> dict:
    row = (
        await ctx.db_session.execute(
            select(OrganizationConfig).where(OrganizationConfig.org_id == ctx.org.id)
        )
    ).scalars().first()
    if row is None:
        raise HTTPException(status_code=404, detail="This organization has no settings yet.")
    return json.loads(json.dumps(row.config or {}))


async def _settings_url(ctx: ToolContext) -> str | None:
    base = await refs.web_base(ctx)
    return f"{base}{_SETTINGS_PAGE}" if base else None


# ─── get_org_settings ────────────────────────────────────────────────────────


class GetOrgSettingsParams(BaseModel):
    pass


def _ai_state(cfg: dict) -> dict:
    if _is_v2(cfg):
        toggle = _obj(_obj(cfg.get("admin_toggles")).get("ai"))
        return {
            "enabled": not toggle.get("disabled", False),
            "copilot_enabled": bool(toggle.get("copilot_enabled", True)),
        }
    entry = _obj(_obj(cfg.get("features")).get("ai"))
    return {
        "enabled": bool(entry.get("enabled", True)),
        "copilot_enabled": bool(entry.get("copilot_enabled", True)),
    }


def _landing_summary(landing: Any) -> dict:
    landing = _obj(landing)
    sections = [s for s in landing.get("sections") or [] if isinstance(s, dict)]
    return {
        "enabled": bool(landing.get("enabled", False)),
        "sections": [
            {"index": i, "type": s.get("type"), "title": clip(s.get("title") or s.get("heading") or "", 80) or None}
            for i, s in enumerate(sections[:40])
        ],
        "section_count": len(sections),
    }


async def _get_org_settings(ctx: ToolContext, _p: GetOrgSettingsParams):
    # The slug read nulls the email for anyone without the organizations
    # update right, as the HTTP route does.
    org = await get_organization_by_slug(ctx.request, ctx.org.slug, ctx.db_session, ctx.user)
    cfg = await _config(ctx)
    general = _general(cfg)
    resolved = resolve_all_features(cfg, ctx.org.id)
    base = await refs.web_base(ctx)
    socials = _obj(org.socials)
    links = _obj(org.links)
    seo = _obj(_custom(cfg, "seo"))
    auth = _obj(_custom(cfg, "auth_branding"))
    course_end = _obj(_custom(cfg, "course_end"))
    return {
        "profile": {
            "name": org.name,
            "slug": org.slug,
            "url": base or None,
            "description": clip(org.description or "", DETAIL_TEXT) or None,
            "about": clip(org.about or "", DETAIL_TEXT) or None,
            "label": org.label,
            "email": org.email,
            "socials": {k: v for k, v in socials.items() if isinstance(v, str) and v},
            "links": [{"label": k, "url": v} for k, v in links.items() if isinstance(v, str)][:20],
        },
        "plan": _plan(cfg),
        "signup": {"mode": _signup_mode(cfg)},
        "ai": _ai_state(cfg),
        "features": {
            name: {
                "switched_on": _toggle_on(cfg, name) is not False,
                "available": bool(_obj(resolved.get(name)).get("enabled")),
            }
            for name in _TOGGLES
        },
        "library_sort": _obj(general.get("folders")).get("sort_mode") or "name_asc",
        "branding": {
            "color": general.get("color") or "",
            "font": general.get("font") or "",
            "footer_text": clip(general.get("footer_text") or "", 280),
            "default_language": general.get("default_language") or "en",
            "watermark": bool(general.get("watermark", True)),
            "email_sender_name": general.get("email_sender_name") or "",
        },
        "auth_branding": {
            "welcome_message": clip(auth.get("welcome_message") or "", 280),
            "background_type": auth.get("background_type") or "gradient",
            "text_color": auth.get("text_color") or "light",
        },
        "seo": {
            k: seo.get(k)
            for k in (
                "default_meta_title_suffix",
                "default_meta_description",
                "twitter_handle",
                "google_site_verification",
                "noindex_communities",
            )
            if k in seo
        },
        "menu": {"items": _obj(_custom(cfg, "menu")).get("items") or []},
        "landing": _landing_summary(_custom(cfg, "landing")),
        "course_end": {
            k: course_end.get(k) or "" for k in ("message", "button_text", "button_link")
        },
        "not_editable_here": (
            "AI app connections, sign-in methods, two-factor policy, custom domains, "
            "page scripts, payments and the plan change only in the dashboard."
        ),
        "settings_url": await _settings_url(ctx),
    }


# ─── update_org ──────────────────────────────────────────────────────────────


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Socials(_Strict):
    twitter: str | None = Field(None, max_length=300, description="Profile URL; empty string clears it.")
    facebook: str | None = Field(None, max_length=300, description="Profile URL; empty string clears it.")
    instagram: str | None = Field(None, max_length=300, description="Profile URL; empty string clears it.")
    linkedin: str | None = Field(None, max_length=300, description="Profile URL; empty string clears it.")
    youtube: str | None = Field(None, max_length=300, description="Channel URL; empty string clears it.")

    @field_validator("*")
    @classmethod
    def _url(cls, value):
        return None if value is None else _http_url(value)


class OrgLink(_Strict):
    label: str = Field(..., min_length=1, max_length=40, description="Link text.")
    url: str = Field(..., max_length=500, description="http(s) URL.")

    @field_validator("url")
    @classmethod
    def _url(cls, value):
        value = _http_url(value)
        if not value:
            raise ValueError("must be an http(s) URL")
        return value


class UpdateOrgParams(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=60, description="Organization name.")
    description: str | None = Field(None, max_length=100, description="Short description.")
    about: str | None = Field(None, max_length=400, description="Longer about text.")
    label: OrgLabel | None = Field(None, description="Category shown in listings.")
    email: EmailStr | None = Field(None, description="Contact email of the organization.")
    socials: Socials | None = Field(None, description="Social profiles to set; omitted ones keep their value.")
    links: list[OrgLink] | None = Field(
        None, max_length=10, description="Replaces all external links shown on the organization page."
    )


async def _update_org(ctx: ToolContext, p: UpdateOrgParams):
    patch: dict[str, Any] = {}
    for key in ("name", "description", "about", "label"):
        value = getattr(p, key)
        if value is not None:
            patch[key] = value.strip()
    if p.email is not None:
        patch["email"] = str(p.email)
    if p.socials is not None:
        updates = p.socials.model_dump(exclude_none=True)
        if updates:
            merged = dict(_obj(ctx.org.socials))
            merged.update(updates)
            patch["socials"] = {k: v for k, v in merged.items() if v}
    if p.links is not None:
        patch["links"] = {link.label.strip(): link.url for link in p.links}
    if not patch:
        raise HTTPException(status_code=400, detail="Nothing to change: pass at least one field.")
    # update_org keeps the HTTP rules: no links in the name (it goes out in
    # emails), and the email needs the organizations update right.
    await update_org(ctx.request, OrganizationUpdate(**patch), ctx.org.id, ctx.user, ctx.db_session)
    return changed(
        f"Updated the organization profile ({', '.join(patch)}).",
        fields=list(patch),
        settings_url=await _settings_url(ctx),
    )


# ─── update_org_settings ─────────────────────────────────────────────────────


class SignupSettings(_Strict):
    section: Literal["signup"]
    mode: Literal["open", "invite_only"] = Field(
        ..., description="open: anyone can sign up. invite_only: an invitation or invite link is needed."
    )


class AiSettings(_Strict):
    section: Literal["ai"]
    enabled: bool | None = Field(None, description="AI features for the whole organization.")
    copilot_enabled: bool | None = Field(None, description="The AI writing assistant in editors.")


class FeatureSettings(_Strict):
    section: Literal["features"]
    courses: bool | None = None
    communities: bool | None = None
    folders: bool | None = Field(None, description="The library.")
    podcasts: bool | None = None
    boards: bool | None = None
    playgrounds: bool | None = None


class LibrarySortSettings(_Strict):
    section: Literal["library_sort"]
    sort_mode: Literal["name_asc", "name_desc", "newest", "oldest", "manual"]


class BrandingSettings(_Strict):
    section: Literal["branding"]
    color: str | None = Field(
        None,
        pattern=r"^(#[0-9a-fA-F]{3}|#[0-9a-fA-F]{6})?$",
        description="Brand colour as #rgb or #rrggbb; empty string for the default.",
    )
    font: FontName | None = Field(None, description="One of the offered fonts; empty string for the default.")
    footer_text: str | None = Field(None, max_length=200, description="Text in the page footer.")
    default_language: str | None = Field(None, min_length=2, max_length=10, description="UI language code, e.g. 'en'.")
    watermark: bool | None = Field(None, description="Show the LearnHouse watermark (required on the free plan).")
    email_sender_name: str | None = Field(
        None, max_length=64, description="Display name on email sent for the organization."
    )


class AuthBrandingSettings(_Strict):
    section: Literal["auth_branding"]
    welcome_message: str | None = Field(None, max_length=300, description="Shown on the sign-in page.")
    background_type: Literal["gradient", "custom"] | None = Field(
        None, description="custom uses the image uploaded in the dashboard."
    )
    text_color: Literal["light", "dark"] | None = None


class SeoSettings(_Strict):
    section: Literal["seo"]
    default_meta_title_suffix: str | None = Field(None, max_length=70)
    default_meta_description: str | None = Field(None, max_length=300)
    twitter_handle: str | None = Field(None, pattern=r"^@?[A-Za-z0-9_]{0,15}$")
    google_site_verification: str | None = Field(None, pattern=r"^[A-Za-z0-9_-]{0,100}$")
    noindex_communities: bool | None = Field(None, description="Keep community pages out of search engines.")


class MenuItem(_Strict):
    type: Literal[_MENU_TYPES]  # type: ignore[valid-type]
    enabled: bool | None = None
    order: int | None = Field(None, ge=0, le=100)
    label: str | None = Field(None, max_length=40, description="Overrides the default label.")
    url: str | None = Field(None, max_length=500, description="custom items: internal path or http(s) URL.")
    icon: str | None = Field(None, pattern=r"^[a-z0-9-]{0,40}$", description="custom items: icon name.")

    @field_validator("url")
    @classmethod
    def _url(cls, value):
        return None if value is None else _safe_link(value)


class MenuSettings(_Strict):
    section: Literal["menu"]
    mode: Literal["merge", "replace"] = Field(
        "merge",
        description="merge: update built-in items by type and custom items by url. replace: the menu becomes exactly items.",
    )
    items: list[MenuItem] = Field(..., max_length=20)


def _unsafe_strings(value: Any) -> bool:
    if isinstance(value, str):
        # Browsers drop control characters and whitespace inside a scheme, so
        # "java\tscript:" and "\x01javascript:" are javascript: links too.
        squeezed = "".join(ch for ch in value if ord(ch) > 0x20 and ord(ch) != 0x7F)
        return squeezed.lower().startswith(_UNSAFE_SCHEMES)
    if isinstance(value, dict):
        return any(_unsafe_strings(v) for v in value.values())
    if isinstance(value, list):
        return any(_unsafe_strings(v) for v in value)
    return False


class LandingSettings(_Strict):
    section: Literal["landing"]
    mode: Literal["merge", "replace"] = Field(
        "merge",
        description="merge: only the fields you send change. replace: the landing page becomes exactly this.",
    )
    enabled: bool | None = Field(None, description="Show the custom landing page instead of the default home.")
    sections: list[dict[str, Any]] | None = Field(
        None,
        max_length=40,
        description=(
            "The full ordered list of sections (replaces the current list). Each has a "
            "'type' (hero, rich-text, features, cta, faq, ...) and that type's fields. "
            "Read the current page in the dashboard editor before rewriting it."
        ),
    )
    settings: dict[str, Any] | None = Field(None, description="Page-wide settings: background, width, gap.")

    @model_validator(mode="after")
    def _check(self):
        for i, section in enumerate(self.sections or []):
            if section.get("type") not in _LANDING_TYPES:
                raise ValueError(
                    f"sections[{i}].type must be one of: {', '.join(sorted(_LANDING_TYPES))}"
                )
        payload = {"sections": self.sections, "settings": self.settings}
        if _unsafe_strings(payload):
            raise ValueError("links must be internal paths or http(s) URLs")
        if len(json.dumps(payload, default=str)) > _MAX_LANDING_CHARS:
            raise ValueError(f"the landing page is limited to {_MAX_LANDING_CHARS} characters of JSON")
        return self


class CourseEndSettings(_Strict):
    section: Literal["course_end"]
    message: str | None = Field(None, max_length=500, description="Shown when a learner completes a course.")
    button_text: str | None = Field(None, max_length=60)
    button_link: str | None = Field(None, max_length=2048, description="Internal path or http(s) URL.")

    @field_validator("button_link")
    @classmethod
    def _url(cls, value):
        return None if value is None else _safe_link(value)


SettingsSection = Annotated[
    Union[
        SignupSettings,
        AiSettings,
        FeatureSettings,
        LibrarySortSettings,
        BrandingSettings,
        AuthBrandingSettings,
        SeoSettings,
        MenuSettings,
        LandingSettings,
        CourseEndSettings,
    ],
    Field(discriminator="section"),
]


class UpdateOrgSettingsParams(BaseModel):
    settings: SettingsSection = Field(
        ...,
        description=(
            "One section, picked by its 'section' field: signup, ai, features, "
            "library_sort, branding, auth_branding, seo, menu, landing, course_end. "
            "Fields you omit keep their value."
        ),
    )


def _fields(section: BaseModel) -> dict:
    return section.model_dump(exclude_none=True, exclude={"section", "mode"})


async def _apply_menu(ctx: ToolContext, cfg: dict, s: MenuSettings) -> None:
    if s.mode == "replace":
        items = [i.model_dump(exclude_none=True) for i in s.items]
    else:
        items = [dict(i) for i in _obj(_custom(cfg, "menu")).get("items") or [] if isinstance(i, dict)]
        for change in s.items:
            data = change.model_dump(exclude_none=True)
            if change.type == "custom":
                if not change.url:
                    raise HTTPException(status_code=400, detail="Custom menu items need a url to match or add.")
                match = next((i for i in items if i.get("type") == "custom" and i.get("url") == change.url), None)
            else:
                match = next((i for i in items if i.get("type") == change.type), None)
            if match is not None:
                match.update(data)
            else:
                data.setdefault("order", len(items))
                items.append(data)
    for item in items:
        if item.get("type") == "custom" and not item.get("url"):
            raise HTTPException(status_code=400, detail="Custom menu items need a url.")
    menu = MenuConfig(items=items).model_dump()
    await update_org_menu_config(ctx.request, menu, ctx.org.id, ctx.user, ctx.db_session)


async def _apply_settings(ctx: ToolContext, s: BaseModel) -> list[str]:
    org_id, user, db, req = ctx.org.id, ctx.user, ctx.db_session, ctx.request
    fields = _fields(s)

    if isinstance(s, SignupSettings):
        mechanism = "inviteOnly" if s.mode == "invite_only" else "open"
        await update_org_signup_mechanism(req, mechanism, org_id, user, db)
        return ["mode"]
    if not fields and not isinstance(s, (MenuSettings, LandingSettings)):
        raise HTTPException(status_code=400, detail="Nothing to change: pass at least one field of the section.")

    if isinstance(s, AiSettings):
        await update_org_ai_config(req, s.enabled, org_id, user, db, copilot_enabled=s.copilot_enabled)
    elif isinstance(s, FeatureSettings):
        for name, value in fields.items():
            await _TOGGLE_SERVICES[name](req, value, org_id, user, db)
    elif isinstance(s, LibrarySortSettings):
        await update_org_folders_sort_config(req, s.sort_mode, org_id, user, db)
    elif isinstance(s, BrandingSettings):
        # The ones the services may refuse (plan, language list, sender name
        # rules) go first, so a refusal leaves the rest untouched.
        if s.watermark is not None:
            await update_org_watermark_config(req, s.watermark, org_id, user, db)
        if s.default_language is not None:
            await update_org_default_language_config(req, s.default_language, org_id, user, db)
        if s.email_sender_name is not None:
            await update_org_email_sender_name_config(req, s.email_sender_name, org_id, user, db)
        if s.color is not None:
            await update_org_color_config(req, s.color, org_id, user, db)
        if s.font is not None:
            await update_org_font_config(req, s.font, org_id, user, db)
        if s.footer_text is not None:
            await update_org_footer_text_config(req, s.footer_text.strip(), org_id, user, db)
    elif isinstance(s, AuthBrandingSettings):
        current = _obj(_custom(await _config(ctx), "auth_branding"))
        merged = AuthBrandingConfig(**{**AuthBrandingConfig().model_dump(), **current, **fields})
        await update_org_auth_branding_config(req, merged, org_id, user, db)
    elif isinstance(s, SeoSettings):
        current = _obj(_custom(await _config(ctx), "seo"))
        merged = SeoOrgConfig(**{**SeoOrgConfig().model_dump(), **current, **fields})
        await update_org_seo_config(req, merged, org_id, user, db)
    elif isinstance(s, MenuSettings):
        await _apply_menu(ctx, await _config(ctx), s)
        return ["items"]
    elif isinstance(s, LandingSettings):
        current = _obj(_custom(await _config(ctx), "landing"))
        if s.mode == "replace":
            enabled = s.enabled if s.enabled is not None else bool(current.get("enabled", False))
            landing: dict = {"sections": s.sections or [], "enabled": enabled}
            if s.settings is not None:
                landing["settings"] = s.settings
        else:
            if not fields:
                raise HTTPException(status_code=400, detail="Nothing to change: pass enabled, sections or settings.")
            landing = {**current, **fields}
            landing.setdefault("sections", [])
        await update_org_landing(req, landing, org_id, user, db)
    elif isinstance(s, CourseEndSettings):
        current = _obj(_custom(await _config(ctx), "course_end"))
        merged = CourseEndConfig(**{**current, **fields}).model_dump()
        await update_org_course_end_config(req, merged, org_id, user, db)
    return list(fields)


async def _update_org_settings(ctx: ToolContext, p: UpdateOrgSettingsParams):
    section = p.settings.section
    changed_fields = await _apply_settings(ctx, p.settings)
    return changed(
        f"Updated the organization's {section.replace('_', ' ')} settings ({', '.join(changed_fields)}).",
        section=section,
        fields=changed_fields,
        settings_url=await _settings_url(ctx),
    )


async def _require_org_admin(ctx: ToolContext, _p: BaseModel) -> str | None:
    """Settings are admin-only over HTTP (require_org_admin): maintainers and
    API tokens made by maintainers are refused, whatever their rights say."""
    if await is_org_admin_role(resolve_acting_user_id(ctx.user), ctx.org.id, ctx.db_session):
        return None
    return "Only organization admins can change organization settings."


async def _require_org_admin_to_read(ctx: ToolContext, p: BaseModel) -> str | None:
    """The settings page is admin-only too: plan, signup mode and the AI and
    feature switches are not for learners or instructors."""
    if await _require_org_admin(ctx, p) is None:
        return None
    return "Only organization admins can read organization settings."


def _summarize_settings(p: UpdateOrgSettingsParams) -> str:
    s = p.settings
    if isinstance(s, SignupSettings):
        return "Let anyone sign up" if s.mode == "open" else "Make signup invitation only"
    if isinstance(s, (MenuSettings, LandingSettings)):
        return f"{'Replace' if s.mode == 'replace' else 'Update'} the organization's {s.section} settings"
    values = ", ".join(f"{k}={v}" for k, v in _fields(s).items())
    return f"Change the organization's {s.section.replace('_', ' ')} settings: {clip(values, 200)}"


# ─── specs ───────────────────────────────────────────────────────────────────

SPECS: list[ToolSpec] = [
    ToolSpec(
        name="get_org_settings",
        description=(
            "The organization's profile (name, description, contact, socials, links) and "
            "editable settings: signup mode, AI, feature switches, branding, sign-in page, "
            "SEO, menu, landing page outline, course completion screen."
        ),
        params_model=GetOrgSettingsParams,
        tier=ActionTier.READ,
        rights_bucket="organizations",
        access_action=AccessAction.READ,
        execute=_get_org_settings,
        preflight=_require_org_admin_to_read,
        access="admin",
        target_kind="organization",
        title="Get organization settings",
    ),
    ToolSpec(
        name="update_org",
        description=(
            "Change the organization's profile: name, description, about, category label, "
            "contact email, social profiles (merged) and external links (replaced). Only "
            "send fields to change. The address (slug) cannot be changed here."
        ),
        params_model=UpdateOrgParams,
        tier=ActionTier.EDIT,
        rights_bucket="organizations",
        access_action=AccessAction.UPDATE,
        execute=_update_org,
        access="admin",
        approval=True,
        idempotent=True,
        target_kind="organization",
        summarize=lambda p: "Change the organization profile: "
        + ", ".join(p.model_dump(exclude_none=True) or ["nothing"]),
        title="Update organization",
    ),
    ToolSpec(
        name="update_org_settings",
        description=(
            "Change one settings section (org admins only): signup mode, AI, feature "
            "switches, library sort, branding, sign-in page, SEO, menu or landing page "
            "(merge or replace), course completion screen. Unknown fields are refused. "
            "Payments, domains, sign-in methods and AI app connections are not here."
        ),
        params_model=UpdateOrgSettingsParams,
        tier=ActionTier.EDIT,
        rights_bucket="organizations",
        access_action=AccessAction.UPDATE,
        execute=_update_org_settings,
        preflight=_require_org_admin,
        access="admin",
        approval=True,
        idempotent=True,
        target_kind="organization",
        summarize=_summarize_settings,
        title="Update organization settings",
    ),
]
