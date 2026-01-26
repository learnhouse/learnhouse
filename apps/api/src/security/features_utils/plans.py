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
    "certifications": "pro",
    "roles": "pro",
    "api_tokens": "pro",
    "scorm": "enterprise",
    "audit_logs": "enterprise",
}


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
