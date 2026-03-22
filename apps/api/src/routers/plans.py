from fastapi import APIRouter
from src.security.features_utils.plans import (
    PLAN_FEATURE_CONFIGS,
    AI_CREDIT_LIMITS,
)

router = APIRouter()


@router.get("")
async def api_get_plan_limits():
    """
    Public endpoint — returns plan limits for all plans.
    Used by the frontend to display correct plan feature limits
    on pricing pages, dashboards, and onboarding flows.
    """
    result = {}
    for plan_id, cfg in PLAN_FEATURE_CONFIGS.items():
        features = cfg["features"]
        result[plan_id] = {
            "courses": features["courses"]["limit"],
            "members": features["members"]["limit"],
            "admin_seats": features["members"]["admin_limit"],
            "ai_credits": AI_CREDIT_LIMITS.get(plan_id, 0),
            "storage": features["storage"]["limit"],
        }
    return result
