"""Organization theme: the learner-facing look (colors, shapes, fonts).

Stored in three places, so the fields that existed before the theme keep their
readers: the brand color and body font stay at ``customization.general.color``
and ``customization.general.font`` (v1: ``general.*``), everything else lives
in ``customization.theme`` (v1: ``general.theme``). One write updates all three
so a save from the Branding page can never leave them half applied.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Optional

from fastapi import HTTPException, Request
from pydantic import ValidationError
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.db.organization_config import (
    OrgThemeUpdate,
    ThemeCustomization,
    normalize_theme_color,
    validate_font_name,
)
from src.db.organization_config import OrganizationConfig
from src.db.organizations import Organization
from src.db.users import AnonymousUser, PublicUser


def _section(parent: Any, key: str) -> dict:
    if not isinstance(parent, dict):
        return {}
    value = parent.get(key)
    return value if isinstance(value, dict) else {}


def _is_v2(config: dict) -> bool:
    return str(config.get("config_version", "1.0")).startswith("2")


def _general(config: Any) -> dict:
    v2 = _section(_section(config, "customization"), "general")
    return v2 if v2 else _section(config, "general")


def read_org_theme(config: Any) -> ThemeCustomization:
    """The stored theme, validated. Anything invalid falls back to defaults.

    A theme written before a field existed, or edited by hand, must never break
    a page or an email, so a bad blob reads as the default theme.
    """
    raw = _section(_section(config, "customization"), "theme") or _section(
        _section(config, "general"), "theme"
    )
    try:
        return ThemeCustomization.model_validate(raw)
    except ValidationError:
        return ThemeCustomization()


def _safe_color(value: Any) -> str:
    try:
        return normalize_theme_color(value if isinstance(value, str) else "")
    except ValueError:
        return ""


def resolve_theme_accent(config: Any) -> Optional[str]:
    """The accent color buttons use, ``None`` for the neutral default.

    ``brand`` follows ``customization.general.color`` so changing the brand
    later moves the accent with it.
    """
    theme = read_org_theme(config)
    if theme.accent_mode == "custom":
        return theme.accent_color or None
    if theme.accent_mode == "brand":
        return _safe_color(_general(config).get("color")) or None
    return None


def resolve_org_theme_summary(config: Any) -> dict:
    """Small, render-safe summary for server consumers (emails, OG images)."""
    brand = _safe_color(_general(config).get("color"))
    accent = resolve_theme_accent(config)
    return {
        "brand_color": brand or None,
        "accent_color": accent,
        "theme": read_org_theme(config).model_dump(),
    }


async def update_org_theme_config(
    request: Request,
    payload: dict,
    org_id: int,
    current_user: PublicUser | AnonymousUser,
    db_session: AsyncSession,
):
    """Save brand color, body font and theme in one write (admin-only)."""
    # orgs.orgs owns the org-level RBAC rule; imported here to avoid a cycle.
    from src.services.orgs.orgs import rbac_check

    org = (await db_session.execute(select(Organization).where(Organization.id == org_id))).scalars().first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    await rbac_check(request, org.org_uuid, current_user, "update", db_session)

    org_config = (
        await db_session.execute(select(OrganizationConfig).where(OrganizationConfig.org_id == org.id))
    ).scalars().first()
    if org_config is None:
        raise HTTPException(status_code=404, detail="Organization config not found")

    try:
        update = OrgThemeUpdate.model_validate(payload or {})
    except ValidationError as exc:
        raise HTTPException(status_code=400, detail=exc.errors()[0].get("msg", "Invalid theme"))

    theme_data = json.loads(update.theme.model_dump_json())
    config = json.loads(json.dumps(org_config.config or {}))
    if _is_v2(config):
        general = config.setdefault("customization", {}).setdefault("general", {})
        config["customization"]["theme"] = theme_data
    else:
        general = config.setdefault("general", {"enabled": True, "color": "", "watermark": True})
        general["theme"] = theme_data
    general["color"] = update.color
    general["font"] = update.font

    org_config.config = config
    org_config.update_date = str(datetime.now())
    db_session.add(org_config)
    await db_session.commit()
    await db_session.refresh(org_config)

    return {"detail": "Theme configuration updated", "theme": theme_data, "color": update.color, "font": update.font}


def validated_color_param(color: str) -> str:
    """Validate the legacy ``/config/color`` query parameter (400 on junk)."""
    try:
        return normalize_theme_color(color)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


def validated_font_param(font: str) -> str:
    """Validate the legacy ``/config/font`` query parameter (400 on junk)."""
    try:
        return validate_font_name(font)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# The theme presets of the Branding page (apps/web/lib/theme/orgTheme.ts,
# THEME_PRESETS): brand color, body font and the options each sets. Kept here
# so agents and API tokens can apply a preset in one call; the web test
# tests/org-theme-presets.test.mjs checks both lists match.
_BASE = ThemeCustomization().model_dump()
THEME_PRESETS: dict[str, dict] = {
    "classic": {"color": "", "font": "", "theme": {}},
    "ocean": {"color": "#0369a1", "font": "Plus Jakarta Sans", "theme": {"accent_mode": "brand"}},
    "forest": {"color": "#166534", "font": "Nunito", "theme": {"accent_mode": "custom", "accent_color": "#15803d", "header_style": "white", "radius": "round", "heading_font": "Lexend", "button_style": "soft", "card_style": "border", "background": "plain"}},
    "midnight": {"color": "#111827", "font": "Inter", "theme": {"accent_mode": "custom", "accent_color": "#6366f1", "header_style": "dark", "heading_font": "Space Grotesk", "card_style": "border", "background": "plain"}},
    "sunset": {"color": "#c2410c", "font": "DM Sans", "theme": {"accent_mode": "brand", "radius": "round", "heading_font": "Outfit"}},
    "orchid": {"color": "#7c3aed", "font": "Manrope", "theme": {"accent_mode": "brand", "header_style": "glass", "radius": "round", "heading_font": "Sora", "button_style": "soft", "background": "pattern"}},
    "slate": {"color": "#334155", "font": "IBM Plex Sans", "theme": {"accent_mode": "brand", "header_style": "white", "radius": "sharp", "card_style": "border", "density": "compact", "background": "plain"}},
    "sand": {"color": "#a16207", "font": "Work Sans", "theme": {"accent_mode": "brand", "header_style": "white", "heading_font": "Fraunces", "button_style": "outline", "card_style": "flat"}},
    "atelier": {"color": "#1f4d3a", "font": "Inter", "theme": {"accent_mode": "custom", "accent_color": "#1f4d3a", "header_style": "white", "radius": "sharp", "heading_font": "Fraunces", "card_style": "border", "background": "plain", "secondary_color": "#c08a3e", "neutral": "warm", "type_scale": "large", "heading_weight": "500", "elevation": "flat", "link_style": "underline", "footer_style": "centered", "image_style": "framed"}},
    "harbor": {"color": "#0f2a4a", "font": "IBM Plex Sans", "theme": {"accent_mode": "custom", "accent_color": "#2f8cff", "header_style": "brand", "card_style": "border", "background": "plain", "secondary_color": "#2f8cff", "neutral": "cool", "heading_weight": "600", "button_shape": "rounded", "header_layout": "centered", "footer_style": "bar"}},
    "grove": {"color": "#2f5d50", "font": "Work Sans", "theme": {"accent_mode": "brand", "header_style": "white", "radius": "round", "heading_font": "Lora", "button_style": "soft", "card_style": "flat", "background": "gradient", "secondary_color": "#d08c34", "neutral": "warm", "image_style": "rounded"}},
    "noir": {"color": "#0a0a0a", "font": "Inter", "theme": {"accent_mode": "custom", "accent_color": "#ff5b1f", "header_style": "dark", "radius": "none", "heading_font": "Instrument Serif", "card_style": "border", "background": "plain", "type_scale": "large", "heading_weight": "500", "button_shape": "square", "elevation": "flat", "header_layout": "minimal", "footer_style": "bar", "image_style": "muted", "dark_accent": "#ff7a45"}},
    "ember": {"color": "#c4532d", "font": "DM Sans", "theme": {"accent_mode": "brand", "header_style": "white", "radius": "round", "heading_font": "DM Serif Display", "secondary_color": "#e8a87c", "neutral": "warm", "heading_weight": "500", "button_shape": "pill", "elevation": "lifted", "image_style": "rounded"}},
    "linen": {"color": "#8c1c2b", "font": "Source Sans 3", "theme": {"accent_mode": "brand", "header_style": "white", "radius": "none", "heading_font": "Libre Baskerville", "card_style": "border", "background": "plain", "secondary_color": "#b98a2f", "neutral": "warm", "elevation": "flat", "link_style": "underline", "header_layout": "centered", "footer_style": "centered"}},
    "citrus": {"color": "#2747d1", "font": "Figtree", "theme": {"accent_mode": "custom", "accent_color": "#ff6a3d", "header_style": "glass", "radius": "round", "heading_font": "Bricolage Grotesque", "background": "pattern", "secondary_color": "#ffc93c", "heading_weight": "800", "button_shape": "pill", "elevation": "lifted"}},
    "glacier": {"color": "#0e7c7b", "font": "Plus Jakarta Sans", "theme": {"accent_mode": "brand", "header_style": "glass", "card_style": "border", "background": "grid", "secondary_color": "#3bb7a5", "neutral": "cool", "heading_weight": "700", "link_style": "subtle", "image_style": "rounded"}},
}


def preset_state(name: str) -> dict:
    """The full theme state ({color, font, theme}) a preset produces."""
    preset = THEME_PRESETS[name]
    return {"color": preset["color"], "font": preset["font"], "theme": {**_BASE, **preset["theme"], "preset": name}}


def current_theme_state(config: Any) -> dict:
    """The stored brand color, body font and theme, as one state."""
    general = _general(config)
    return {
        "color": _safe_color(general.get("color")),
        "font": general.get("font") if isinstance(general.get("font"), str) else "",
        "theme": read_org_theme(config).model_dump(),
    }
