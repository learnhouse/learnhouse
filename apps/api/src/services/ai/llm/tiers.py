"""Central plan-based model tiering.

Single source of truth replacing the duplicated ``get_org_ai_model()`` functions that lived
in four routers. Model names come from config (``ai_config.model_*``) and fall back to the
historical Gemini defaults, so behavior is unchanged until an operator overrides them.
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

# Three tiers, defaulting to the current Gemini 3 family (verified live against the API,
# June 2026 — these exact IDs return from models.list() and support generateContent):
#   fast     -> gemini-3.1-flash-lite (GA)      — titles, follow-ups, migration
#   standard -> gemini-3.5-flash (GA)           — chat, RAG, planning/blocks (std plans)
#   pro      -> gemini-3.1-pro-preview          — planning/blocks (Pro+ plans)
_TIER_DEFAULTS: dict[str, str] = {
    "fast": "gemini-3.1-flash-lite",
    "standard": "gemini-3.5-flash",
    "pro": "gemini-3.1-pro-preview",
}

_TIER_CONFIG_ATTR: dict[str, str] = {
    "fast": "model_fast",
    "standard": "model_standard",
    "pro": "model_pro",
}

# Maps a feature purpose to its (standard-plan tier, pro-plan tier). `planning` (course
# planning) uses `standard` for free/standard plans and `pro` for Pro+ plans; `chat` always
# uses `standard`. Interactive widget features (MagicBlocks, boards, playgrounds) intentionally
# bypass this and use the `fast` tier directly for low latency — see their routers.
_PURPOSE_TIERS: dict[str, tuple[Tier, Tier]] = {
    "chat": ("standard", "standard"),
    "planning": ("standard", "pro"),
}


def model_for_tier(tier: Tier) -> str:
    """Return the configured model name for a tier, falling back to the Gemini default."""
    cfg = get_learnhouse_config().ai_config
    return getattr(cfg, _TIER_CONFIG_ATTR[tier], None) or _TIER_DEFAULTS[tier]


async def resolve_model_for_org(
    org_id: int,
    db_session: AsyncSession,
    *,
    purpose: Purpose = "chat",
) -> str:
    """Resolve the model name for an org and feature purpose, honoring pro-plan upgrades."""
    standard_tier, pro_tier = _PURPOSE_TIERS[purpose]
    try:
        current_plan = await get_org_plan(org_id, db_session)
        tier = pro_tier if plan_meets_requirement(current_plan, "pro") else standard_tier
    except Exception:
        logger.warning("Plan check failed for org %s; using standard tier", org_id, exc_info=True)
        tier = standard_tier
    return model_for_tier(tier)
