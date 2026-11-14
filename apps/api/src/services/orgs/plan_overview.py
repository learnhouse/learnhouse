"""Settings → Plan & usage: the plan, its status and every feature it covers.

One payload for an org admin: which plan the organization is on and in what
state (paid, free, trial, proof of concept, self-hosted), a brief of a running
or recent POC, and every feature grouped by area with where it comes from.

The feature states are computed from the same sources the gates use
(plans.py through resolve_feature, the org config overrides and toggles), so
the page can never claim a feature the API would refuse, or hide one it allows.
"""

import logging
from typing import Callable, Optional

from fastapi import HTTPException
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core import deployment_mode
from src.core.ee_hooks import get_ee_hooks
from src.db.organization_config import OrganizationConfig
from src.db.organizations import Organization
from src.security.features_utils.plans import (
    PLAN_HIERARCHY,
    get_plan_config,
    get_plan_feature_config,
    get_upgrade_candidates,
)
from src.security.features_utils.resolve import (
    ALWAYS_ON_FEATURES,
    ORG_TOGGLEABLE_FEATURES,
    _fetch_purchased_extras,
    _get_overrides,
    _get_plan_from_config,
    resolve_feature,
)

logger = logging.getLogger(__name__)

# Every feature an admin can ask "do I have this?" about, by area, in the order
# the page shows them. ALL_FEATURES minus "members" (a limit, shown with the
# usage meters) must all appear here; tests enforce it so a new feature can't
# be left off the page.
FEATURE_AREAS: dict[str, tuple[str, ...]] = {
    "content": ("courses", "assignments", "folders", "paths", "podcasts", "boards", "playgrounds", "versioning", "scorm"),
    "engagement": ("communities", "messaging", "live_sessions", "collaboration", "newsletter"),
    "people": ("usergroups", "roles", "required_training", "company_seats", "payments"),
    "ai": ("ai",),
    "analytics": ("analytics",),
    "integrations": ("api", "webhooks", "lti", "crm", "crm_salesforce"),
    "security": ("sso", "scim", "audit_logs"),
    "branding": ("custom_domain", "remove_watermark"),
}

# Plan perks that are not features in the resolver: read straight from the plan
# config. Self-hosted installs have no plan, so they always have them.
PLAN_PERKS: dict[str, Callable[[dict], bool]] = {
    "custom_domain": lambda cfg: bool(cfg.get("cloud", {}).get("custom_domain", False)),
    "remove_watermark": lambda cfg: not cfg.get("general", {}).get("watermark", True),
}

# Where the feature's on/off switch lives, for those an admin can flip.
TOGGLE_TAB = {key: "features" for key in ORG_TOGGLEABLE_FEATURES} | {"ai": "ai"}

# Lifecycle states the EE platform reports that change the plan's status.
_LIFECYCLE_STATUSES = ("trial", "poc", "suspended")


def _plan_has(plan: str, feature: str) -> bool:
    if feature in PLAN_PERKS:
        return PLAN_PERKS[feature](get_plan_config(plan))
    return feature in ALWAYS_ON_FEATURES or bool(get_plan_feature_config(plan, feature).get("enabled", False))


def _perk_upgrade(plan: str, perk: str) -> Optional[str]:
    return next((p for p in get_upgrade_candidates(plan) if _plan_has(p, perk)), None)


def _perk_entry(key: str, mode: str, plan: str, poc_base: Optional[str]) -> dict:
    if mode != "saas":
        state, upgrade = "included", None
    elif _plan_has(plan, key):
        state = "poc" if poc_base and not _plan_has(poc_base, key) else "included"
        upgrade = None
    else:
        state, upgrade = "locked", _perk_upgrade(plan, key)
    return {"enabled": state != "locked", "disabled_by": None, "limit": 0, "state": state, "upgrade_plan": upgrade}


def _feature_entry(key: str, config: dict, org_id: int, extras: dict, mode: str, plan: str, poc_base: Optional[str]) -> dict:
    resolved = resolve_feature(key, config, org_id, extras)
    upgrade = None
    if not resolved["available"]:
        # Self-hosted community installs: the feature ships with the Enterprise
        # Edition, not with a plan.
        state = "edition" if mode == "oss" else "locked"
        upgrade = resolved["upgrade_plan"] if mode == "saas" else None
    elif mode != "saas":
        state = "included"
    elif not _plan_has(plan, key):
        # Available without being in the plan: a grant on top of it.
        state = "addon" if _get_overrides(config, key).get("force_enabled") else "included"
    elif poc_base and not _plan_has(poc_base, key):
        state = "poc"
    else:
        state = "included"
    return {
        "enabled": bool(resolved["enabled"]),
        "disabled_by": resolved["disabled_by"],
        "limit": resolved["limit"] if state != "locked" else 0,
        "state": state,
        "upgrade_plan": upgrade,
    }


def build_feature_matrix(config: dict, org_id: int, mode: str, plan: str, poc_base: Optional[str] = None) -> list[dict]:
    """Every feature on the page with its state for this org.

    state: included (in the plan) · poc (unlocked by the running POC, goes away
    when it ends) · addon (granted on top of the plan) · locked (not in the
    plan; upgrade_plan names the cheapest plan that has it) · edition (needs the
    Enterprise Edition, self-hosted community installs only).
    """
    extras = _fetch_purchased_extras(org_id) if mode == "saas" else {}
    out = []
    for area, keys in FEATURE_AREAS.items():
        for key in keys:
            entry = (
                _perk_entry(key, mode, plan, poc_base)
                if key in PLAN_PERKS
                else _feature_entry(key, config, org_id, extras, mode, plan, poc_base)
            )
            out.append({"key": key, "area": area, "toggle_tab": TOGGLE_TAB.get(key), **entry})
    return out


def _status(mode: str, plan: str, lifecycle: Optional[str]) -> str:
    if mode == "oss":
        return "community"
    if mode == "ee":
        return "licensed"
    if lifecycle in _LIFECYCLE_STATUSES:
        return lifecycle
    return "free" if plan == "free" else "active"


def _billing(mode: str, plan: str, status: str) -> str:
    """How the plan is paid for: through Stripe checkout, by contract, or not at all."""
    if mode != "saas" or plan == "free" or status in ("poc", "trial"):
        return "none"
    return "contract" if plan == "enterprise" else "stripe"


async def _ee_extras(org_id: int, db_session: AsyncSession, mode: str, newsletter: bool) -> dict:
    empty: dict = {"lifecycle": None, "poc": None, "usage": {}, "license": None}
    hooks = get_ee_hooks()
    hook = getattr(hooks, "plan_overview_extras", None) if hooks else None
    if hook is None:
        return empty
    try:
        return {**empty, **(await hook(org_id, db_session, mode=mode, newsletter=newsletter))}
    except Exception:
        # The page still has the plan and features without the platform facts.
        logger.exception("EE plan overview extras failed for org %s", org_id)
        return empty


async def get_plan_overview(org_id: int, db_session: AsyncSession) -> dict:
    org = (await db_session.execute(select(Organization).where(Organization.id == org_id))).scalars().first()
    if org is None:
        raise HTTPException(status_code=404, detail="Organization not found")
    row = (await db_session.execute(
        select(OrganizationConfig).where(OrganizationConfig.org_id == org_id)
    )).scalars().first()
    config = (row.config if row else None) or {}

    mode = deployment_mode.get_deployment_mode()
    plan = _get_plan_from_config(config) if mode == "saas" else ("enterprise" if mode == "ee" else "oss")
    newsletter = bool(resolve_feature("newsletter", config, org_id)["available"])
    extras = await _ee_extras(org_id, db_session, mode, newsletter)

    poc = extras["poc"]
    status = _status(mode, plan, extras["lifecycle"])
    poc_base = poc["returns_to"] if poc and poc["state"] == "active" else None
    features = build_feature_matrix(config, org_id, mode, plan, poc_base)
    if poc:
        poc = {**poc, "unlocks": [f["key"] for f in features if f["state"] == "poc"]}

    usage = {}
    if "newsletter_emails" in extras["usage"]:
        limit = next(f["limit"] for f in features if f["key"] == "newsletter")
        usage["newsletter_emails"] = {"usage": int(extras["usage"]["newsletter_emails"]), "limit": limit or "unlimited"}

    candidates = get_upgrade_candidates(plan) if mode == "saas" and plan in PLAN_HIERARCHY else []
    return {
        "org_id": org_id,
        "mode": mode,
        "plan": plan,
        "status": status,
        "billing": _billing(mode, plan, status),
        "next_plan": candidates[0] if candidates else None,
        "poc": poc,
        "license": extras["license"],
        "features": features,
        "usage": usage,
        "areas": list(FEATURE_AREAS),
    }
