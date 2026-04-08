"""
Central feature resolution logic (v2 config).

4-layer resolution: deployment mode → plan config → overrides → purchased packs → admin toggles.
"""

from src.core.deployment_mode import get_deployment_mode, EE_ONLY_FEATURES
from src.security.features_utils.plans import FEATURE_PLAN_REQUIREMENTS, get_plan_feature_config


# Features that are always on (no admin toggle — cannot be disabled)
ALWAYS_ON_FEATURES = {"courses", "usergroups", "assignments"}

# Always-on features that have plan-based limits (not unlimited)
# These are always enabled but their limit comes from the plan config
ALWAYS_ON_WITH_LIMITS = {"courses"}

# All known features
ALL_FEATURES = [
    "ai", "analytics", "api", "assignments", "audit_logs", "boards", "collaboration",
    "collections", "communities", "courses",
    "members", "payments", "playgrounds", "podcasts", "roles", "scorm",
    "sso", "usergroups", "versioning",
]


def _get_plan_from_config(config: dict) -> str:
    """Extract plan from config, supporting both v1 and v2 formats."""
    version = config.get("config_version", "1.0")
    if version.startswith("2"):
        return config.get("plan", "free")
    # v1: plan is under cloud.plan
    return config.get("cloud", {}).get("plan", "free")


def _get_admin_toggle(config: dict, feature: str) -> dict:
    """Get admin toggle for a feature, supporting both v1 and v2 formats."""
    version = config.get("config_version", "1.0")
    if version.startswith("2"):
        return config.get("admin_toggles", {}).get(feature, {})
    # v1: read from features section; map enabled=False → disabled=True
    v1_feature = config.get("features", {}).get(feature, {})
    toggle = {}
    if "enabled" in v1_feature:
        toggle["disabled"] = not v1_feature["enabled"]
    if "copilot_enabled" in v1_feature:
        toggle["copilot_enabled"] = v1_feature["copilot_enabled"]
    if "signup_mode" in v1_feature:
        toggle["signup_mode"] = v1_feature["signup_mode"]
    return toggle


def _get_overrides(config: dict, feature: str) -> dict:
    """Get overrides for a feature from v2 config."""
    version = config.get("config_version", "1.0")
    if not version.startswith("2"):
        return {}
    return config.get("overrides", {}).get(feature, {})


def _get_purchased_extra(org_id: int, feature: str) -> int:
    """Get purchased extra capacity for a feature from Redis."""
    try:
        from src.security.features_utils.usage import _get_redis_client
        r = _get_redis_client()
        if feature == "ai":
            val = r.get(f"ai_credits_purchased:{org_id}")
            return int(val) if val else 0
        if feature in ("members", "admin_seats"):
            val = r.get(f"member_seats_purchased:{org_id}")
            return int(val) if val else 0
    except Exception:
        pass
    return 0


def resolve_feature(feature: str, config: dict, org_id: int = 0) -> dict:
    """
    Resolve a single feature's enabled/limit state through all 4 layers.

    Returns:
        {"enabled": bool, "limit": int, "required_plan": str|None}  (limit=0 means unlimited)
    """
    mode = get_deployment_mode()
    required_plan = FEATURE_PLAN_REQUIREMENTS.get(feature)

    # Always-on features without limits: enabled in all modes, unlimited, no admin toggle
    if feature in ALWAYS_ON_FEATURES and feature not in ALWAYS_ON_WITH_LIMITS:
        return {"enabled": True, "limit": 0, "required_plan": required_plan}

    # Always-on features WITH plan limits: enabled in all modes, but limit comes from plan
    if feature in ALWAYS_ON_WITH_LIMITS:
        if mode in ("ee", "oss"):
            return {"enabled": True, "limit": 0, "required_plan": required_plan}
        # SaaS: always enabled, but respect the plan limit + overrides + packs
        plan = _get_plan_from_config(config)
        plan_config = get_plan_feature_config(plan, feature)
        plan_limit = plan_config.get("limit", 0)
        overrides = _get_overrides(config, feature)
        extra_limit = overrides.get("extra_limit", 0)
        purchased_extra = _get_purchased_extra(org_id, feature) if org_id else 0
        if plan_limit == 0:
            effective_limit = 0
        else:
            effective_limit = plan_limit + extra_limit + purchased_extra
        return {"enabled": True, "limit": effective_limit, "required_plan": required_plan}

    admin_toggle = _get_admin_toggle(config, feature)
    admin_disabled = admin_toggle.get("disabled", False)

    # EE mode: everything enabled & unlimited
    if mode == "ee":
        return {"enabled": not admin_disabled, "limit": 0, "required_plan": required_plan}

    # OSS mode: EE features blocked, rest unlimited
    if mode == "oss":
        if feature in EE_ONLY_FEATURES:
            return {"enabled": False, "limit": 0, "required_plan": required_plan}
        return {"enabled": not admin_disabled, "limit": 0, "required_plan": required_plan}

    # SaaS mode: full resolution
    plan = _get_plan_from_config(config)

    # Layer 1: Plan
    plan_config = get_plan_feature_config(plan, feature)
    plan_enabled = plan_config.get("enabled", False)
    plan_limit = plan_config.get("limit", 0)

    # Layer 2: Overrides
    overrides = _get_overrides(config, feature)
    force_enabled = overrides.get("force_enabled", False)
    extra_limit = overrides.get("extra_limit", 0)

    base_enabled = plan_enabled or force_enabled

    # Layer 3: Purchased packs
    purchased_extra = _get_purchased_extra(org_id, feature) if org_id else 0

    # Layer 4: Effective limit
    if plan_limit == 0:
        effective_limit = 0  # unlimited stays unlimited
    else:
        effective_limit = plan_limit + extra_limit + purchased_extra

    # Layer 5: Admin toggle (can only restrict)
    effective_enabled = base_enabled and not admin_disabled

    return {"enabled": effective_enabled, "limit": effective_limit, "required_plan": required_plan}


def resolve_all_features(config: dict, org_id: int = 0) -> dict:
    """Resolve all features for an organization config."""
    return {
        feature: resolve_feature(feature, config, org_id)
        for feature in ALL_FEATURES
    }
