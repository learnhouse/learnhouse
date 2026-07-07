"""Organization tools — read org info, update org fields, update feature config.

Every tool wraps an existing service function in-process, passing
`ctx.request` / `ctx.user` / `ctx.db_session` so the service's own RBAC
checks stay authoritative. The org itself is always the target: it is
resolved from the tool context (`ctx.org` / `ctx.org_slug`), never from a
model-supplied identifier.
"""

from __future__ import annotations

from typing import Literal

from fastapi import HTTPException
from pydantic import BaseModel, Field, ValidationError

from src.db.organization_config import AuthBrandingConfig, MenuConfig, SeoOrgConfig
from src.db.organizations import OrganizationUpdate
from src.security.rbac import AccessAction
from src.services.ai.tools.base import ActionTier, ToolContext, ToolSpec, jsonable
from src.services.orgs.orgs import (
    get_organization_by_slug,
    update_org,
    update_org_ai_config,
    update_org_auth_branding_config,
    update_org_boards_config,
    update_org_color_config,
    update_org_communities_config,
    update_org_courses_config,
    update_org_default_language_config,
    update_org_folders_config,
    update_org_folders_sort_config,
    update_org_font_config,
    update_org_footer_text_config,
    update_org_landing,
    update_org_menu_config,
    update_org_payments_config,
    update_org_playgrounds_config,
    update_org_podcasts_config,
    update_org_seo_config,
    update_org_signup_mechanism,
    update_org_watermark_config,
)


def _config_summary(config) -> dict:
    """Compact projection of the org config blob (v1 or v2 layout)."""
    wrapper = jsonable(config) or {}
    if not isinstance(wrapper, dict):
        return {}
    # OrganizationRead.config is the OrganizationConfig row; the blob is nested.
    cfg = wrapper.get("config") if isinstance(wrapper.get("config"), dict) else wrapper
    if not isinstance(cfg, dict):
        return {}
    version = str(cfg.get("config_version", "1.0"))
    out: dict = {"config_version": version}
    if version.startswith("2"):
        out["plan"] = cfg.get("plan")
        general = cfg.get("customization", {}).get("general", {})
        out["signup_mode"] = (
            cfg.get("admin_toggles", {}).get("members", {}).get("signup_mode", "open")
        )
    else:
        out["plan"] = cfg.get("cloud", {}).get("plan")
        general = cfg.get("general", {})
        out["signup_mode"] = (
            cfg.get("features", {}).get("members", {}).get("signup_mode", "open")
        )
    if isinstance(general, dict):
        out["customization"] = {
            k: general.get(k)
            for k in ("color", "font", "default_language", "watermark", "footer_text")
        }
    resolved = cfg.get("resolved_features")
    if isinstance(resolved, dict):
        out["features"] = resolved
    return out


def _compact_org(org) -> dict:
    data = jsonable(org)
    keep = (
        "id",
        "org_uuid",
        "name",
        "description",
        "about",
        "slug",
        "email",
        "label",
        "socials",
        "links",
        "logo_image",
        "thumbnail_image",
        "explore",
        "update_date",
    )
    out = {k: data.get(k) for k in keep if k in data}
    about = out.get("about")
    if isinstance(about, str) and len(about) > 280:
        out["about"] = about[:280] + "…"
    return out


# ─── params ────────────────────────────────────────────────────────────────


class GetOrgInfoParams(BaseModel):
    pass


class UpdateOrgParams(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = None
    about: str | None = None
    socials: dict | None = Field(
        None, description="Social links, e.g. {'twitter': 'https://…'}"
    )
    links: dict | None = Field(None, description="Custom external links")
    label: str | None = None
    email: str | None = None
    slug: str | None = Field(
        None,
        min_length=2,
        max_length=100,
        description="Org URL slug — changing it moves the org's public URL",
    )


OrgFeature = Literal[
    "signup_mechanism",
    "ai",
    "communities",
    "payments",
    "folders",
    "folders_sort",
    "courses",
    "podcasts",
    "boards",
    "playgrounds",
    "color",
    "footer_text",
    "font",
    "default_language",
    "watermark",
    "menu",
    "auth_branding",
    "landing",
    "seo",
]


class UpdateOrgFeatureConfigParams(BaseModel):
    feature: OrgFeature = Field(..., description="Which config section to update")
    config: dict = Field(
        ...,
        description=(
            "Feature-specific payload — see the tool description for the "
            "exact shape required per feature"
        ),
    )


# ─── per-feature payload validators ────────────────────────────────────────


class _SignupMechanismConfig(BaseModel):
    signup_mechanism: Literal["open", "inviteOnly"]


class _AiConfig(BaseModel):
    ai_enabled: bool | None = None
    copilot_enabled: bool | None = None


class _EnabledConfig(BaseModel):
    enabled: bool


class _FoldersSortConfig(BaseModel):
    sort_mode: Literal["name_asc", "name_desc", "newest", "oldest", "manual"]


class _ColorConfig(BaseModel):
    color: str = Field(..., description="Brand color, e.g. '#2563eb'")


class _FooterTextConfig(BaseModel):
    footer_text: str


class _FontConfig(BaseModel):
    font: str


class _DefaultLanguageConfig(BaseModel):
    default_language: str = Field(..., min_length=2, max_length=10)


_FEATURE_MODELS: dict[str, type[BaseModel] | None] = {
    "signup_mechanism": _SignupMechanismConfig,
    "ai": _AiConfig,
    "communities": _EnabledConfig,
    "payments": _EnabledConfig,
    "folders": _EnabledConfig,
    "courses": _EnabledConfig,
    "podcasts": _EnabledConfig,
    "boards": _EnabledConfig,
    "playgrounds": _EnabledConfig,
    "folders_sort": _FoldersSortConfig,
    "color": _ColorConfig,
    "footer_text": _FooterTextConfig,
    "font": _FontConfig,
    "default_language": _DefaultLanguageConfig,
    "watermark": _EnabledConfig,
    "menu": MenuConfig,
    "auth_branding": AuthBrandingConfig,
    "landing": None,  # free-form landing-page object, stored as-is
    "seo": SeoOrgConfig,
}

# Simple enabled/disabled toggles that share one service signature.
_TOGGLE_SERVICES = {
    "communities": update_org_communities_config,
    "payments": update_org_payments_config,
    "folders": update_org_folders_config,
    "courses": update_org_courses_config,
    "podcasts": update_org_podcasts_config,
    "boards": update_org_boards_config,
    "playgrounds": update_org_playgrounds_config,
}


# ─── executors ─────────────────────────────────────────────────────────────


async def _get_org_info(ctx: ToolContext, p: GetOrgInfoParams):
    org = await get_organization_by_slug(
        ctx.request, ctx.org_slug, ctx.db_session, ctx.user
    )
    out = _compact_org(org)
    out["config"] = _config_summary(getattr(org, "config", None))
    return out


async def _update_org(ctx: ToolContext, p: UpdateOrgParams):
    patch = p.model_dump(exclude_none=True)
    if not patch:
        raise HTTPException(status_code=422, detail="No fields to update")
    org = await update_org(
        ctx.request,
        OrganizationUpdate(**patch),
        ctx.org.id,
        ctx.user,
        ctx.db_session,
    )
    return _compact_org(org)


async def _update_org_feature_config(ctx: ToolContext, p: UpdateOrgFeatureConfigParams):
    model = _FEATURE_MODELS[p.feature]
    cfg: BaseModel | None = None
    if model is not None:
        try:
            cfg = model.model_validate(p.config or {})
        except ValidationError as e:
            errors = "; ".join(
                ".".join(str(loc) for loc in err.get("loc", ())) + f": {err.get('msg')}"
                for err in e.errors()[:5]
            )
            raise HTTPException(
                status_code=422,
                detail=f"Invalid config for feature '{p.feature}' — {errors}",
            )

    org_id = ctx.org.id

    if p.feature in _TOGGLE_SERVICES:
        assert isinstance(cfg, _EnabledConfig)
        result = await _TOGGLE_SERVICES[p.feature](
            ctx.request, cfg.enabled, org_id, ctx.user, ctx.db_session
        )
    elif p.feature == "signup_mechanism":
        assert isinstance(cfg, _SignupMechanismConfig)
        result = await update_org_signup_mechanism(
            ctx.request, cfg.signup_mechanism, org_id, ctx.user, ctx.db_session
        )
    elif p.feature == "ai":
        assert isinstance(cfg, _AiConfig)
        result = await update_org_ai_config(
            ctx.request,
            cfg.ai_enabled,
            org_id,
            ctx.user,
            ctx.db_session,
            copilot_enabled=cfg.copilot_enabled,
        )
    elif p.feature == "folders_sort":
        assert isinstance(cfg, _FoldersSortConfig)
        result = await update_org_folders_sort_config(
            ctx.request, cfg.sort_mode, org_id, ctx.user, ctx.db_session
        )
    elif p.feature == "color":
        assert isinstance(cfg, _ColorConfig)
        result = await update_org_color_config(
            ctx.request, cfg.color, org_id, ctx.user, ctx.db_session
        )
    elif p.feature == "footer_text":
        assert isinstance(cfg, _FooterTextConfig)
        result = await update_org_footer_text_config(
            ctx.request, cfg.footer_text, org_id, ctx.user, ctx.db_session
        )
    elif p.feature == "font":
        assert isinstance(cfg, _FontConfig)
        result = await update_org_font_config(
            ctx.request, cfg.font, org_id, ctx.user, ctx.db_session
        )
    elif p.feature == "default_language":
        assert isinstance(cfg, _DefaultLanguageConfig)
        result = await update_org_default_language_config(
            ctx.request, cfg.default_language, org_id, ctx.user, ctx.db_session
        )
    elif p.feature == "watermark":
        assert isinstance(cfg, _EnabledConfig)
        result = await update_org_watermark_config(
            ctx.request, cfg.enabled, org_id, ctx.user, ctx.db_session
        )
    elif p.feature == "menu":
        # Validated above via MenuConfig; the service re-normalises the dict.
        result = await update_org_menu_config(
            ctx.request, p.config or {}, org_id, ctx.user, ctx.db_session
        )
    elif p.feature == "auth_branding":
        assert isinstance(cfg, AuthBrandingConfig)
        result = await update_org_auth_branding_config(
            ctx.request, cfg, org_id, ctx.user, ctx.db_session
        )
    elif p.feature == "landing":
        result = await update_org_landing(
            ctx.request, p.config or {}, org_id, ctx.user, ctx.db_session
        )
    elif p.feature == "seo":
        assert isinstance(cfg, SeoOrgConfig)
        result = await update_org_seo_config(
            ctx.request, cfg, org_id, ctx.user, ctx.db_session
        )
    else:  # pragma: no cover — Literal keeps this unreachable
        raise HTTPException(status_code=422, detail=f"Unknown feature '{p.feature}'")

    return jsonable(result)


# ─── specs ─────────────────────────────────────────────────────────────────

SPECS: list[ToolSpec] = [
    ToolSpec(
        name="get_org_info",
        description=(
            "Get the current organization's details (name, description, slug, "
            "socials, links) plus a config summary: plan, signup mode, enabled "
            "features and customization (color, font, language, watermark). "
            "Use before changing org settings."
        ),
        params_model=GetOrgInfoParams,
        tier=ActionTier.READ,
        rights_bucket="organizations",
        access_action=AccessAction.READ,
        execute=_get_org_info,
        target_kind="organization",
    ),
    ToolSpec(
        name="update_org",
        description=(
            "Update the organization's profile fields (name, description, "
            "about, socials, links, label, email, slug). Only send fields to "
            "change. Changing the slug moves the org's public URL."
        ),
        params_model=UpdateOrgParams,
        tier=ActionTier.EDIT,
        rights_bucket="organizations",
        access_action=AccessAction.UPDATE,
        execute=_update_org,
        target_kind="organization",
        summarize=lambda p: "Update org fields: "
        + ", ".join(p.model_dump(exclude_none=True) or ["-"]),
    ),
    ToolSpec(
        name="update_org_feature_config",
        description=(
            "Update one section of the organization's configuration. Pass "
            "`feature` plus a matching `config` payload: "
            "signup_mechanism {signup_mechanism: 'open'|'inviteOnly'}; "
            "ai {ai_enabled?: bool, copilot_enabled?: bool}; "
            "communities/payments/folders/courses/podcasts/boards/playgrounds/"
            "watermark {enabled: bool}; "
            "folders_sort {sort_mode: 'name_asc'|'name_desc'|'newest'|'oldest'|'manual'}; "
            "color {color: '#hex'}; footer_text {footer_text}; font {font}; "
            "default_language {default_language: ISO code, e.g. 'en'}; "
            "menu {items: [{type, enabled, order, label?, url?, icon?}]} — "
            "REPLACES the whole menu; "
            "auth_branding {welcome_message?, background_type?, background_image?, text_color?}; "
            "landing {…} — REPLACES the entire landing-page object; "
            "seo {default_meta_title_suffix?, default_meta_description?, "
            "twitter_handle?, google_site_verification?, noindex_communities?}. "
            "For menu/landing, read the current value with get_org_info first "
            "and send the full replacement object."
        ),
        params_model=UpdateOrgFeatureConfigParams,
        tier=ActionTier.EDIT,
        rights_bucket="organizations",
        access_action=AccessAction.UPDATE,
        execute=_update_org_feature_config,
        target_kind="organization",
        summarize=lambda p: f"Update org '{p.feature}' config",
    ),
]
