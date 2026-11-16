"""Per-feature AI switches an org admin controls (Settings > AI).

AI as a whole is the ``ai`` plan feature (``resolve_feature("ai")``); the org's
own master switch is ``admin_toggles.ai.org_disabled``. Under it every AI
surface has its own switch in ``admin_toggles.ai.features``. A missing key means
"on", so organizations that never touched the page keep today's behaviour.
Learner Ask AI keeps its historical flag ``copilot_enabled`` as well: either
being off turns it off.

Enforcement is server-side. Every model call opens a credit meter
(``src.services.ai.metering.start``), which maps its pricing feature to one of
these switches through :func:`gate_metered_call` and refuses with
``403 AI_FEATURE_DISABLED``. That covers HTTP routes, background jobs, agent
tools and MCP tools alike. Routes that read AI data without calling a model
(Atlas history, scheduled agent lists) call :func:`require_ai_feature`.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Literal, Optional

from fastapi import HTTPException

AIGroup = Literal["assistants", "authoring", "learners", "content", "integrations"]


@dataclass(frozen=True)
class AIFeature:
    key: str
    group: AIGroup
    # Pricing features (src.services.ai.pricing.FEATURES) this switch governs.
    pricing: tuple[str, ...]
    # "ee": the surface only exists with the enterprise code (Atlas, Plays...).
    edition: Literal["oss", "ee"] = "oss"


AI_FEATURES: tuple[AIFeature, ...] = (
    # Assistants
    AIFeature("atlas", "assistants", ("atlas_chat",), "ee"),
    AIFeature("atlas_scheduled", "assistants", ("atlas_scheduled",), "ee"),
    AIFeature("ai_editor", "assistants", ("ai_editor_turn", "ai_editor_complete"), "ee"),
    # Authoring
    AIFeature("course_builder", "authoring", ("course_builder_plan", "course_builder_lesson", "course_planning")),
    AIFeature("editor_ai", "authoring", ("editor_ai",)),
    AIFeature("magic_blocks", "authoring", ("magic_block",)),
    AIFeature("quiz_generation", "authoring", ("quiz_generation",)),
    AIFeature("assignment_generation", "authoring", ("assignment_generation", "scenario_generation")),
    AIFeature("course_import", "authoring", ("course_import",)),
    AIFeature("seo", "authoring", ("seo_generation",)),
    # Learners
    AIFeature("ask_ai", "learners", ("ask_ai", "media_indexing")),
    AIFeature("ai_grading", "learners", ("ai_grading",)),
    AIFeature("messaging_agents", "learners", ("messaging_agent",)),
    AIFeature("plays", "learners", ("plays_generation", "plays_step", "plays_copilot"), "ee"),
    # Content generation
    AIFeature("translations", "content", ("translation",)),
    AIFeature("image_generation", "content", ("image_generation", "thumbnail")),
    AIFeature("voice", "content", ("podcast_script", "podcast_audio")),
    AIFeature("video_ai", "content", ("captions", "video_chapters")),
    AIFeature("live_session_summary", "content", ("live_session_summary",), "ee"),
    AIFeature("boards", "content", ("boards_playground",), "ee"),
    # Integrations
    AIFeature("landing_builder", "integrations", ("landing_generation", "landing_copy")),
    AIFeature("newsletter", "integrations", ("newsletter_draft",), "ee"),
    AIFeature("mcp_tools", "integrations", ("mcp_tools",)),
)

AI_FEATURE_KEYS: tuple[str, ...] = tuple(f.key for f in AI_FEATURES)
AI_GROUPS: tuple[str, ...] = ("assistants", "authoring", "learners", "content", "integrations")
_BY_PRICING: dict[str, str] = {p: f.key for f in AI_FEATURES for p in f.pricing}

# Upper bound for the optional monthly credit cap (keeps typos sane).
MAX_MONTHLY_CREDIT_CAP = 10_000_000

AI_DISABLED = "AI_DISABLED"
AI_FEATURE_DISABLED = "AI_FEATURE_DISABLED"
AI_STAFF_ONLY = "AI_STAFF_ONLY"
AI_MONTHLY_CAP_REACHED = "AI_MONTHLY_CAP_REACHED"


def ai_feature_for_pricing(pricing_feature: str) -> Optional[str]:
    """The switch that governs a pricing feature (None: only the master switch)."""
    return _BY_PRICING.get(pricing_feature)


def _obj(value: Any) -> dict:
    return value if isinstance(value, dict) else {}


def ai_toggle(config: Optional[dict]) -> dict:
    """The stored AI toggle: admin_toggles.ai (v2) or features.ai (v1)."""
    config = _obj(config)
    if str(config.get("config_version", "1.0")).startswith("2"):
        return _obj(_obj(config.get("admin_toggles")).get("ai"))
    return _obj(_obj(config.get("features")).get("ai"))


def ai_feature_switches(config: Optional[dict]) -> dict[str, bool]:
    """The admin's per-feature choices, master switch aside (missing = on)."""
    toggle = ai_toggle(config)
    raw = _obj(toggle.get("features"))
    switches = {key: raw.get(key) is not False for key in AI_FEATURE_KEYS}
    if toggle.get("copilot_enabled") is False:
        switches["ask_ai"] = False
    return switches


def monthly_credit_cap(config: Optional[dict]) -> int:
    try:
        return max(0, int(ai_toggle(config).get("monthly_credit_cap") or 0))
    except (TypeError, ValueError):
        return 0


def resolve_ai_settings(config: Optional[dict], org_id: int = 0) -> dict:
    """Everything the AI settings page and the entry points need.

    ``features`` is the effective state (master switch applied); ``switches``
    is what the admin chose, so the page keeps showing it while AI is off.
    """
    from src.security.features_utils.resolve import resolve_feature

    master = resolve_feature("ai", _obj(config), org_id)
    switches = ai_feature_switches(config)
    toggle = ai_toggle(config)
    return {
        "enabled": bool(master["enabled"]),
        "available": bool(master["available"]),
        "disabled_by": master.get("disabled_by"),
        "switches": switches,
        "features": {key: bool(master["enabled"]) and on for key, on in switches.items()},
        "ask_ai_staff_only": bool(toggle.get("ask_ai_staff_only", False)),
        "monthly_credit_cap": monthly_credit_cap(config),
    }


def public_ai_state(config: Optional[dict], org_id: int = 0) -> dict:
    """What every member's UI needs to hide an AI entry point: the effective
    booleans and whether Ask AI is limited to staff. No caps, no admin-only
    detail (that is GET /orgs/{id}/config/ai/settings, admins only)."""
    settings = resolve_ai_settings(config, org_id)
    return {
        "enabled": settings["enabled"],
        "features": settings["features"],
        "ask_ai_staff_only": settings["ask_ai_staff_only"],
    }


def _labels() -> dict[str, str]:
    return {
        "atlas": "Atlas",
        "atlas_scheduled": "Scheduled agents",
        "ai_editor": "The AI Editor",
        "course_builder": "The AI course builder",
        "editor_ai": "AI writing in the editor",
        "magic_blocks": "Magic blocks",
        "quiz_generation": "AI quiz and flashcard generation",
        "assignment_generation": "AI assignment generation",
        "course_import": "AI course import",
        "seo": "AI SEO generation",
        "ask_ai": "Ask AI",
        "ai_grading": "AI grading",
        "messaging_agents": "AI agents in Messages",
        "plays": "AI in Plays",
        "translations": "AI translations",
        "image_generation": "AI images",
        "voice": "AI voice and podcasts",
        "video_ai": "AI captions and chapters",
        "live_session_summary": "Live session summaries",
        "boards": "AI in boards",
        "landing_builder": "AI website design",
        "newsletter": "AI newsletter writing",
        "mcp_tools": "AI tools over MCP",
    }


class _Detail(dict):
    """The 403 body ({code, feature, message}); prints as its message, so code
    that stores ``str(exc.detail)`` (job errors, run summaries) stays readable."""

    def __str__(self) -> str:
        return str(self.get("message", ""))


class AIFeatureOff(HTTPException):
    """403 for an AI surface the org turned off. ``detail.code`` says why."""

    def __init__(self, code: str, feature: Optional[str] = None, message: Optional[str] = None):
        if message is None:
            if code == AI_DISABLED:
                message = "AI is turned off for this organization."
            elif code == AI_STAFF_ONLY:
                message = "Ask AI is only available to course staff in this organization."
            elif code == AI_MONTHLY_CAP_REACHED:
                message = "This organization reached its monthly AI credit cap."
            else:
                label = _labels().get(feature or "", "This AI feature")
                message = f"{label} is turned off by your organization's admin."
        super().__init__(status_code=403, detail=_Detail(code=code, feature=feature, message=message))
        self.code = code
        self.feature = feature


def ai_feature_block(
    config: Optional[dict], org_id: int, feature: Optional[str], *, include_master: bool = True
) -> Optional[AIFeatureOff]:
    """Why ``feature`` cannot run for this org, or None when it can."""
    if include_master:
        from src.security.features_utils.resolve import resolve_feature

        if not resolve_feature("ai", _obj(config), org_id)["enabled"]:
            return AIFeatureOff(AI_DISABLED, feature)
    if feature and not ai_feature_switches(config).get(feature, True):
        return AIFeatureOff(AI_FEATURE_DISABLED, feature)
    return None


async def _load_config(org_id: int, db) -> Optional[dict]:
    from src.db.organization_config import OrganizationConfig
    from src.services.orgs.org_config_lookup import get_session_org_config

    row = await get_session_org_config(db, org_id)
    if not isinstance(row, OrganizationConfig):
        return None
    return row.config if isinstance(row.config, dict) else {}


async def is_org_staff(user_id: Optional[int], org_id: int, db) -> bool:
    """A member whose role opens the dashboard (authors, maintainers, admins)."""
    if not user_id:
        return False
    from sqlmodel import select

    from src.db.roles import Role
    from src.db.user_organizations import UserOrganization
    from src.security.features_utils.usage import _role_grants_dashboard_access

    role = (await db.execute(
        select(Role)
        .join(UserOrganization, UserOrganization.role_id == Role.id)  # type: ignore[arg-type]
        .where(UserOrganization.user_id == user_id, UserOrganization.org_id == org_id)
    )).scalars().first()
    return _role_grants_dashboard_access(role)


async def require_ai_feature(
    feature: Optional[str],
    org_id: int,
    db,
    *,
    user_id: Optional[int] = None,
    include_master: bool = True,
) -> None:
    """Raise :class:`AIFeatureOff` unless the org runs ``feature``. With
    ``user_id``, learner Ask AI also honours the staff-only setting. An org
    with no config row is left to the caller (it 404s on its own)."""
    config = await _load_config(org_id, db)
    if config is None:
        return
    blocked = ai_feature_block(config, org_id, feature, include_master=include_master)
    if blocked is not None:
        raise blocked
    if feature == "ask_ai" and user_id and ai_toggle(config).get("ask_ai_staff_only"):
        if not await is_org_staff(user_id, org_id, db):
            raise AIFeatureOff(AI_STAFF_ONLY, feature)


async def credits_used_this_month(org_id: int, db) -> int:
    from sqlalchemy import func
    from sqlmodel import select

    from src.db.ai_usage import AIUsageEvent

    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    total = (await db.execute(
        select(func.coalesce(func.sum(AIUsageEvent.credits), 0)).where(
            AIUsageEvent.org_id == org_id,
            AIUsageEvent.created_at >= month_start,  # type: ignore[operator]
        )
    )).scalar()
    return int(total or 0)


async def gate_metered_call(
    pricing_feature: str, org_id: int, db, *, user_id: Optional[int] = None, amount: int = 0
) -> None:
    """Called by ``metering.start`` before any credit is reserved.

    The master switch stays with ``reserve_ai_credit`` (same row, same answer,
    its historical message); this adds the per-feature switch, the staff-only
    Ask AI setting and the monthly cap. A config that cannot be read here is
    left to ``reserve_ai_credit``, which fails closed."""
    try:
        config = await _load_config(org_id, db)
    except Exception:
        return
    if config is None:
        return
    feature = ai_feature_for_pricing(pricing_feature)
    if feature is not None:
        await require_ai_feature(feature, org_id, db, user_id=user_id, include_master=False)
    cap = monthly_credit_cap(config)
    if cap and amount > 0 and await credits_used_this_month(org_id, db) + amount > cap:
        raise AIFeatureOff(AI_MONTHLY_CAP_REACHED, feature)
