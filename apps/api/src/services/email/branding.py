"""Per-organization branding for system email.

Every org-scoped message — login link, password reset, invitation, address
verification, role change, welcome, lifecycle nudge — goes out under the
organization's identity rather than the platform's. This module is the single
place that identity is read from, so no two call sites can disagree about which
config key holds the logo, the accent color, or the "Powered by" switch.

The pieces, and where each one comes from:

* ``org_name``      — ``Organization.name``; names the org in copy and subjects.
* ``lang``          — ``customization.general.default_language``.
* ``sender_name``   — ``customization.general.email_sender_name`` (From display
                      name only; the address never changes, see ``send_email``).
* ``logo_url``      — the square logo (``customization.general.square_logo_image``)
                      when uploaded, else ``Organization.logo_image``, as an
                      absolute URL.
* ``brand_color``   — ``customization.general.color``; tints the CTA button.
* ``powered_by``    — ``customization.general.watermark``; renders the small
                      "Powered by LearnHouse" footer line. Always on for the
                      open-source edition and for SaaS free-plan orgs; a paid
                      SaaS plan or an Enterprise licence may turn it off.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Optional

from fastapi import Request

_HEX_COLOR_RE = re.compile(r"^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")

# Site of the platform, for the "Powered by" footer link.
POWERED_BY_URL = "https://www.learnhouse.io"


def normalize_brand_color(raw: Any) -> Optional[str]:
    """``#rrggbb`` (lowercase) for a valid CSS hex color, else None.

    The value lands verbatim in an inline ``style`` attribute inside an email,
    so anything that is not a plain hex triplet is dropped rather than
    escaped: there is no legitimate brand color that needs a semicolon.
    ``#abc`` shorthand is expanded because mail clients are inconsistent about
    it.
    """
    if not isinstance(raw, str):
        return None
    match = _HEX_COLOR_RE.match(raw.strip())
    if not match:
        return None
    digits = match.group(1).lower()
    if len(digits) == 3:
        digits = "".join(ch * 2 for ch in digits)
    return f"#{digits}"


def contrasting_text_color(hex_color: str) -> str:
    """Black or white, whichever is legible on ``hex_color``.

    WCAG relative luminance against a 0.179 threshold — the crossover at which
    white and black text have equal contrast ratio with the background.
    """
    digits = hex_color.lstrip("#")
    r, g, b = (int(digits[i : i + 2], 16) / 255 for i in (0, 2, 4))

    def _lin(channel: float) -> float:
        return channel / 12.92 if channel <= 0.03928 else ((channel + 0.055) / 1.055) ** 2.4

    luminance = 0.2126 * _lin(r) + 0.7152 * _lin(g) + 0.0722 * _lin(b)
    return "#000000" if luminance > 0.179 else "#ffffff"


def _section(parent: Any, key: str) -> dict:
    """``parent[key]`` when it is a dict, else ``{}``.

    A config blob can hold an explicit ``null`` for a section the org never
    populated, so a plain ``.get(key, {})`` is not enough.
    """
    if not isinstance(parent, dict):
        return {}
    value = parent.get(key)
    return value if isinstance(value, dict) else {}


def _general_section(config: Any) -> dict:
    """The org's general customization block, v2 first then the v1 shape."""
    v2 = _section(_section(config, "customization"), "general")
    if v2:
        return v2
    return _section(config, "general")


def resolve_org_brand_color(org_config) -> Optional[str]:
    config = getattr(org_config, "config", None)
    return normalize_brand_color(_general_section(config).get("color"))


def resolve_org_powered_by(org_config) -> bool:
    """Whether this org's mail carries the "Powered by LearnHouse" line.

    Always shown on the open-source edition: attribution is part of the OSS
    deal, whatever the stored ``watermark`` flag says. On SaaS it is always
    shown for a free-plan org (the write path refuses to persist ``false`` for
    them, but a plan downgrade leaves the old value in place). A paid SaaS
    plan or an Enterprise licence honours the org's ``watermark`` toggle.
    """
    from src.core.deployment_mode import get_deployment_mode

    mode = get_deployment_mode()
    if mode == "oss":
        return True

    config = getattr(org_config, "config", None)
    if not isinstance(config, dict):
        return True

    plan = config.get("plan") or _section(config, "cloud").get("plan") or "free"
    if mode == "saas" and plan == "free":
        return True
    return _general_section(config).get("watermark") is not False


@dataclass(frozen=True)
class OrgEmailBranding:
    """Everything an email template needs to render as the org's own."""

    org_name: str
    lang: str = "en"
    sender_name: str = ""
    logo_url: Optional[str] = None
    brand_color: Optional[str] = None
    powered_by: bool = True

    def as_kwargs(self) -> dict:
        """Keyword arguments accepted by every org-scoped ``send_*_email``."""
        return {
            "lang": self.lang,
            "sender_name": self.sender_name or None,
            "logo_url": self.logo_url,
            "brand_color": self.brand_color,
            "powered_by": self.powered_by,
        }


def resolve_org_email_branding(
    org,
    org_config,
    request: Optional[Request] = None,
) -> OrgEmailBranding:
    """Read an organization's email branding from its row and config.

    ``org_config`` may be None (an org with no config row yet); every field
    then takes its default. ``request`` is only used to resolve the logo to an
    absolute URL on single-tenant deployments where the API host is not
    configured — background jobs pass None.
    """
    # Imported here: orgs.orgs imports the email package indirectly.
    from src.services.email.utils import get_org_brand_logo_url
    from src.services.orgs.orgs import get_org_default_language, resolve_org_sender_name

    return OrgEmailBranding(
        org_name=getattr(org, "name", "") or "",
        lang=get_org_default_language(org_config),
        sender_name=resolve_org_sender_name(org_config),
        logo_url=get_org_brand_logo_url(org, org_config, request) if org is not None else None,
        brand_color=resolve_org_brand_color(org_config),
        powered_by=resolve_org_powered_by(org_config),
    )
