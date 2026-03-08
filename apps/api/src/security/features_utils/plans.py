"""
Plan-based feature restriction utilities.

Single source of truth for plan hierarchy, feature configs, and limits.
Org config only stores the plan name (cloud.plan) — all feature settings
are derived from these definitions at runtime.
"""

from typing import Literal


# Plan type definition - matches OrgCloudConfig
PlanLevel = Literal["free", "personal", "personal-family", "standard", "pro", "enterprise"]

# Plan hierarchy (lower index = lower tier)
PLAN_HIERARCHY: list[str] = ["free", "personal", "personal-family", "standard", "pro", "enterprise"]

# Feature to required plan mapping
FEATURE_PLAN_REQUIREMENTS: dict[str, PlanLevel] = {
    "ai": "standard",
    "analytics": "standard",
    "collaboration": "standard",
    "communities": "standard",
    "payments": "standard",
    "podcasts": "standard",
    "seo": "standard",
    "usergroups": "standard",
    "api_tokens": "pro",
    "boards": "pro",
    "certifications": "pro",
    "custom_domains": "pro",
    "docs": "pro",
    "playgrounds": "pro",
    "roles": "pro",
    "versioning": "pro",
    "analytics_advanced": "pro",
    "audit_logs": "enterprise",
    "scorm": "enterprise",
    "sso": "enterprise",
}

# ============================================================================
# Comprehensive plan feature configs (single source of truth)
# ============================================================================
# Each plan defines: features (enabled + limits), general settings, cloud flags.
# limit=0 means unlimited for that feature.

PLAN_FEATURE_CONFIGS: dict[str, dict] = {
    "free": {
        "features": {
            "ai": {"enabled": False, "limit": 0, "model": "gpt-4o-mini"},
            "analytics": {"enabled": False, "limit": 0},
            "api": {"enabled": False, "limit": 0},
            "assignments": {"enabled": True, "limit": 5},
            "collaboration": {"enabled": False, "limit": 0},
            "courses": {"enabled": True, "limit": 3},

            "members": {"admin_limit": 1, "enabled": True, "limit": 30},
            "payments": {"enabled": False},
            "storage": {"enabled": True, "limit": 5},
            "usergroups": {"enabled": False, "limit": 0},
            "podcasts": {"enabled": False, "limit": 0},
            "docs": {"enabled": False, "limit": 0},
            "boards": {"enabled": False, "limit": 0},
            "collections": {"enabled": True},
            "communities": {"enabled": False},
            "playgrounds": {"enabled": False, "limit": 0},
            "roles": {"enabled": False},
            "scorm": {"enabled": False},
            "sso": {"enabled": False},
            "versioning": {"enabled": False},
            "audit_logs": {"enabled": False},
        },
        "general": {"watermark": True},
        "cloud": {"plan": "free", "custom_domain": False},
    },
    "personal": {
        "features": {
            "ai": {"enabled": True, "limit": 1000, "model": "gpt-4o-mini"},
            "analytics": {"enabled": False, "limit": 0},
            "api": {"enabled": False, "limit": 0},
            "assignments": {"enabled": True, "limit": 0},
            "collaboration": {"enabled": False, "limit": 0},
            "courses": {"enabled": True, "limit": 0},

            "members": {"admin_limit": 1, "enabled": True, "limit": 1},
            "payments": {"enabled": False},
            "storage": {"enabled": True, "limit": 10},
            "usergroups": {"enabled": False, "limit": 0},
            "podcasts": {"enabled": False, "limit": 0},
            "docs": {"enabled": False, "limit": 0},
            "boards": {"enabled": True, "limit": 0},
            "collections": {"enabled": True},
            "communities": {"enabled": False},
            "playgrounds": {"enabled": True, "limit": 0},
            "roles": {"enabled": False},
            "scorm": {"enabled": False},
            "sso": {"enabled": False},
            "versioning": {"enabled": False},
            "audit_logs": {"enabled": False},
        },
        "general": {"watermark": False},
        "cloud": {"plan": "personal", "custom_domain": False},
    },
    "personal-family": {
        "features": {
            "ai": {"enabled": True, "limit": 3000, "model": "gpt-4o"},
            "analytics": {"enabled": False, "limit": 0},
            "api": {"enabled": False, "limit": 0},
            "assignments": {"enabled": True, "limit": 0},
            "collaboration": {"enabled": False, "limit": 0},
            "courses": {"enabled": True, "limit": 0},

            "members": {"admin_limit": 4, "enabled": True, "limit": 4},
            "payments": {"enabled": False},
            "storage": {"enabled": True, "limit": 20},
            "usergroups": {"enabled": False, "limit": 0},
            "podcasts": {"enabled": False, "limit": 0},
            "docs": {"enabled": False, "limit": 0},
            "boards": {"enabled": True, "limit": 0},
            "collections": {"enabled": True},
            "communities": {"enabled": False},
            "playgrounds": {"enabled": True, "limit": 0},
            "roles": {"enabled": False},
            "scorm": {"enabled": False},
            "sso": {"enabled": False},
            "versioning": {"enabled": False},
            "audit_logs": {"enabled": False},
        },
        "general": {"watermark": False},
        "cloud": {"plan": "personal-family", "custom_domain": False},
    },
    "standard": {
        "features": {
            "ai": {"enabled": True, "limit": 1000, "model": "gpt-4o-mini"},
            "analytics": {"enabled": True, "limit": 0},
            "api": {"enabled": False, "limit": 0},
            "assignments": {"enabled": True, "limit": 0},
            "collaboration": {"enabled": True, "limit": 0},
            "courses": {"enabled": True, "limit": 0},

            "members": {"admin_limit": 2, "enabled": True, "limit": 500},
            "payments": {"enabled": True},
            "storage": {"enabled": True, "limit": 20},
            "usergroups": {"enabled": True, "limit": 0},
            "podcasts": {"enabled": True, "limit": 0},
            "docs": {"enabled": False, "limit": 0},
            "boards": {"enabled": False, "limit": 0},
            "collections": {"enabled": True},
            "communities": {"enabled": True},
            "playgrounds": {"enabled": False, "limit": 0},
            "roles": {"enabled": False},
            "scorm": {"enabled": False},
            "sso": {"enabled": False},
            "versioning": {"enabled": False},
            "audit_logs": {"enabled": False},
        },
        "general": {"watermark": False},
        "cloud": {"plan": "standard", "custom_domain": False},
    },
    "pro": {
        "features": {
            "ai": {"enabled": True, "limit": 3000, "model": "gpt-4o"},
            "analytics": {"enabled": True, "limit": 0},
            "api": {"enabled": True, "limit": 0},
            "assignments": {"enabled": True, "limit": 0},
            "collaboration": {"enabled": True, "limit": 0},
            "courses": {"enabled": True, "limit": 0},

            "members": {"admin_limit": 10, "enabled": True, "limit": 1000},
            "payments": {"enabled": True},
            "storage": {"enabled": True, "limit": 50},
            "usergroups": {"enabled": True, "limit": 0},
            "podcasts": {"enabled": True, "limit": 0},
            "docs": {"enabled": True, "limit": 0},
            "boards": {"enabled": True, "limit": 0},
            "collections": {"enabled": True},
            "communities": {"enabled": True},
            "playgrounds": {"enabled": True, "limit": 0},
            "roles": {"enabled": True},
            "scorm": {"enabled": False},
            "sso": {"enabled": False},
            "versioning": {"enabled": True},
            "audit_logs": {"enabled": False},
        },
        "general": {"watermark": False},
        "cloud": {"plan": "pro", "custom_domain": True},
    },
    "enterprise": {
        "features": {
            "ai": {"enabled": True, "limit": 10000, "model": "gpt-4o"},
            "analytics": {"enabled": True, "limit": 0},
            "api": {"enabled": True, "limit": 0},
            "assignments": {"enabled": True, "limit": 0},
            "collaboration": {"enabled": True, "limit": 0},
            "courses": {"enabled": True, "limit": 0},

            "members": {"admin_limit": 100, "enabled": True, "limit": 0},
            "payments": {"enabled": True},
            "storage": {"enabled": True, "limit": 200},
            "usergroups": {"enabled": True, "limit": 0},
            "podcasts": {"enabled": True, "limit": 0},
            "docs": {"enabled": True, "limit": 0},
            "boards": {"enabled": True, "limit": 0},
            "collections": {"enabled": True},
            "communities": {"enabled": True},
            "playgrounds": {"enabled": True, "limit": 0},
            "roles": {"enabled": True},
            "scorm": {"enabled": True},
            "sso": {"enabled": True},
            "versioning": {"enabled": True},
            "audit_logs": {"enabled": True},
        },
        "general": {"watermark": False},
        "cloud": {"plan": "enterprise", "custom_domain": True},
    },
}

# Plan-based resource limits (for plan-based features checked against DB counts)
# 0 = unlimited
PLAN_LIMITS: dict[str, dict[str, int]] = {
    plan: {
        "courses": cfg["features"]["courses"]["limit"],
        "members": cfg["features"]["members"]["limit"],
        "admin_seats": cfg["features"]["members"]["admin_limit"],
    }
    for plan, cfg in PLAN_FEATURE_CONFIGS.items()
}

# AI credit allocation per plan
# 0 = no access, -1 = unlimited
AI_CREDIT_LIMITS: dict[str, int] = {
    "free": 0,
    "personal": 1000,
    "personal-family": 3000,
    "standard": 1000,
    "pro": 3000,
    "enterprise": -1,
}


# ============================================================================
# Lookup helpers
# ============================================================================

def get_plan_feature_config(plan: str, feature: str) -> dict:
    """
    Get the full feature config for a plan.

    Returns:
        Dict with at least {enabled, limit} keys. Returns disabled/0 for unknown features.
    """
    cfg = PLAN_FEATURE_CONFIGS.get(plan, PLAN_FEATURE_CONFIGS["free"])
    return cfg["features"].get(feature, {"enabled": False, "limit": 0})


def is_feature_enabled_for_plan(plan: str, feature: str) -> bool:
    """Check if a feature is enabled for a given plan."""
    from src.core.deployment_mode import get_deployment_mode
    mode = get_deployment_mode()
    if mode == 'ee':
        return True
    if mode == 'oss':
        # OSS enables all non-EE features
        return feature not in ('analytics', 'api', 'sso', 'audit_logs', 'scorm')
    return get_plan_feature_config(plan, feature).get("enabled", False)


def get_feature_limit_for_plan(plan: str, feature: str) -> int:
    """
    Get the limit for a specific feature from the plan config.

    Returns:
        The limit (0 = unlimited).
    """
    from src.core.deployment_mode import get_deployment_mode
    mode = get_deployment_mode()
    if mode != 'saas':
        return 0  # Unlimited in EE and OSS modes
    return get_plan_feature_config(plan, feature).get("limit", 0)


def get_plan_config(plan: str) -> dict:
    """Get the full plan config. Returns free config for unknown plans."""
    return PLAN_FEATURE_CONFIGS.get(plan, PLAN_FEATURE_CONFIGS["free"])


def get_ai_credit_limit(plan: str) -> int:
    """
    Get the AI credit limit for a specific plan.

    Returns:
        The AI credit limit (0 = no access, -1 = unlimited)
    """
    from src.core.deployment_mode import get_deployment_mode
    mode = get_deployment_mode()
    if mode != 'saas':
        return -1  # Unlimited in EE and OSS modes
    return AI_CREDIT_LIMITS.get(plan, 0)


def get_plan_limit(plan: str, feature: str) -> int:
    """
    Get the limit for a plan-based feature (courses, members, admin_seats).

    Returns:
        The limit for the feature (0 means unlimited)
    """
    from src.core.deployment_mode import get_deployment_mode
    mode = get_deployment_mode()
    if mode != 'saas':
        return 0  # Unlimited in EE and OSS modes
    plan_limits = PLAN_LIMITS.get(plan, PLAN_LIMITS["free"])
    return plan_limits.get(feature, 0)


def plan_meets_requirement(current_plan: str, required_plan: str) -> bool:
    """
    Check if the current plan meets or exceeds the required plan level.
    """
    from src.core.deployment_mode import get_deployment_mode
    mode = get_deployment_mode()
    if mode == 'ee':
        return True
    if mode == 'oss':
        return required_plan != 'enterprise'
    # SaaS: normal hierarchy check
    try:
        current_index = PLAN_HIERARCHY.index(current_plan)
    except ValueError:
        current_index = 0
    try:
        required_index = PLAN_HIERARCHY.index(required_plan)
    except ValueError:
        required_index = 0
    return current_index >= required_index


def get_required_plan_for_feature(feature_key: str) -> PlanLevel | None:
    """
    Get the required plan level for a specific feature.
    """
    return FEATURE_PLAN_REQUIREMENTS.get(feature_key)
