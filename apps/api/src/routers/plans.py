from fastapi import APIRouter
from src.security.features_utils.plans import (
    PLAN_FEATURE_CONFIGS,
    AI_CREDIT_LIMITS,
)

router = APIRouter()


@router.get(
    "",
    summary="Get plan feature limits",
    description="Public endpoint that returns the feature limits (courses, members, admin seats, AI credits) for every available plan. Used by the frontend to render pricing pages and plan comparison tables.",
    responses={
        200: {"description": "Mapping of plan id to feature limits"},
    },
)
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
        }
    return result
