"""Central model tiering for Acyberschool AI features.

Configured model names always win. When they are omitted, defaults are selected for
the active provider so changing from Google to OpenAI never accidentally sends a
Gemini model id to an OpenAI endpoint.
"""

from __future__ import annotations

import logging
from typing import Literal

from sqlmodel.ext.asyncio.session import AsyncSession

from config.config import get_learnhouse_config
from src.security.features_utils.plan_check import get_org_plan
from src.security.features_utils.plans import plan_meets_requirement

logger = logging.getLogger(__name__)

Tier = Literal["fast", "standard", "pro"]
Purpose = Literal["chat", "planning"]

_PROVIDER_DEFAULTS: dict[str, dict[Tier, str]] = {
    "openai": {
        "fast": "gpt-5.4-nano",
        "standard": "gpt-5.4-mini",
        "pro": "gpt-5.4",
    },
    "openai-compatible": {
        "fast": "gpt-5.4-nano",
        "standard": "gpt-5.4-mini",
        "pro": "gpt-5.4",
    },
    "google": {
        "fast": "gemini-3.1-flash-lite",
        "standard": "gemini-3.5-flash",
        "pro": "gemini-3.1-pro-preview",
    },
    "google-gla": {
        "fast": "gemini-3.1-flash-lite",
        "standard": "gemini-3.5-flash",
        "pro": "gemini-3.1-pro-preview",
    },
    "gemini": {
        "fast": "gemini-3.1-flash-lite",
        "standard": "gemini-3.5-flash",
        "pro": "gemini-3.1-pro-preview",
    },
}

_FALLBACK_DEFAULTS: dict[Tier, str] = {
    "fast": "gemini-3.1-flash-lite",
    "standard": "gemini-3.5-flash",
    "pro": "gemini-3.1-pro-preview",
}

_TIER_CONFIG_ATTR: dict[Tier, str] = {
    "fast": "model_fast",
    "standard": "model_standard",
    "pro": "model_pro",
}

_PURPOSE_TIERS: dict[Purpose, tuple[Tier, Tier]] = {
    "chat": ("standard", "standard"),
    "planning": ("standard", "pro"),
}


def model_for_tier(tier: Tier) -> str:
    """Return an explicit model or a sensible default for the configured provider."""
    cfg = get_learnhouse_config().ai_config
    configured = getattr(cfg, _TIER_CONFIG_ATTR[tier], None)
    if configured:
        return configured

    provider = (getattr(cfg, "provider", None) or "google").strip().lower()
    defaults = _PROVIDER_DEFAULTS.get(provider, _FALLBACK_DEFAULTS)
    return defaults[tier]


async def resolve_model_for_org(
    org_id: int,
    db_session: AsyncSession,
    *,
    purpose: Purpose = "chat",
) -> str:
    """Resolve the model for an org and feature purpose, honoring plan upgrades."""
    standard_tier, pro_tier = _PURPOSE_TIERS[purpose]
    try:
        current_plan = await get_org_plan(org_id, db_session)
        tier = pro_tier if plan_meets_requirement(current_plan, "pro") else standard_tier
    except Exception:
        logger.warning("Plan check failed for org %s; using standard tier", org_id, exc_info=True)
        tier = standard_tier
    return model_for_tier(tier)
