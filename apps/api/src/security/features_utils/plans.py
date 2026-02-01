"""
Plan-based feature restriction utilities.

Defines plan hierarchy and feature-to-plan mappings for restricting
access to premium features.
"""

from typing import Literal


# Plan type definition - matches OrgCloudConfig
PlanLevel = Literal["free", "standard", "pro", "enterprise"]

# Plan hierarchy (lower index = lower tier)
PLAN_HIERARCHY: list[PlanLevel] = ["free", "standard", "pro", "enterprise"]

# Feature to required plan mapping
FEATURE_PLAN_REQUIREMENTS: dict[str, PlanLevel] = {
    "usergroups": "standard",
    "payments": "standard",
    "ai": "standard",
    "communities": "standard",
    "seo": "standard",
    "versioning": "standard",
    "podcasts": "standard",
    "certifications": "pro",
    "roles": "pro",
    "api_tokens": "pro",
    "scorm": "enterprise",
    "audit_logs": "enterprise",
}

# Plan-based resource limits
# 0 = unlimited
PLAN_LIMITS: dict[PlanLevel, dict[str, int]] = {
    "free": {
        "courses": 3,
        "members": 30,
        "admin_seats": 1,
    },
    "standard": {
        "courses": 0,  # Unlimited
        "members": 500,
        "admin_seats": 2,
    },
    "pro": {
        "courses": 0,  # Unlimited
        "members": 2000,
        "admin_seats": 10,
    },
    "enterprise": {
        "courses": 0,  # Unlimited
        "members": 0,  # Unlimited
        "admin_seats": 0,  # Unlimited
    },
}

# AI credit allocation per plan
# 0 = no access, -1 = unlimited
AI_CREDIT_LIMITS: dict[PlanLevel, int] = {
    "free": 0,  # No AI access on free plan
    "standard": 1000,  # 1,000 credits
    "pro": 3000,  # 3,000 credits
    "enterprise": -1,  # Unlimited
}


def get_ai_credit_limit(plan: PlanLevel) -> int:
    """
    Get the AI credit limit for a specific plan.

    Args:
        plan: The organization's current plan

    Returns:
        The AI credit limit (0 = no access, -1 = unlimited)
    """
    return AI_CREDIT_LIMITS.get(plan, 0)


def get_plan_limit(plan: PlanLevel, feature: str) -> int:
    """
    Get the limit for a specific feature based on the plan.

    Args:
        plan: The organization's current plan
        feature: The feature identifier (e.g., 'courses', 'members')

    Returns:
        The limit for the feature (0 means unlimited)
    """
    plan_limits = PLAN_LIMITS.get(plan, PLAN_LIMITS["free"])
    return plan_limits.get(feature, 0)


def plan_meets_requirement(current_plan: PlanLevel, required_plan: PlanLevel) -> bool:
    """
    Check if the current plan meets or exceeds the required plan level.

    Args:
        current_plan: The organization's current plan
        required_plan: The minimum required plan for the feature

    Returns:
        True if current_plan >= required_plan in the hierarchy
    """
    current_index = PLAN_HIERARCHY.index(current_plan)
    required_index = PLAN_HIERARCHY.index(required_plan)
    return current_index >= required_index


def get_required_plan_for_feature(feature_key: str) -> PlanLevel | None:
    """
    Get the required plan level for a specific feature.

    Args:
        feature_key: The feature identifier (e.g., 'api_tokens', 'audit_logs')

    Returns:
        The required plan level, or None if no restriction
    """
    return FEATURE_PLAN_REQUIREMENTS.get(feature_key)
