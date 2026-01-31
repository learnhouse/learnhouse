import json
import redis
from fastapi import HTTPException, Request
from sqlmodel import Session, select
from src.db.organization_config import OrganizationConfig
from src.db.users import PublicUser
from src.security.rbac.rbac import authorization_verify_if_user_is_anon
from src.security.features_utils.usage import (
    _get_actual_usage,
    _get_actual_admin_seat_count,
    _is_oss_mode,
    _get_redis_client,
)
from src.security.features_utils.plans import (
    PlanLevel,
    get_plan_limit,
)

# Cache TTL in seconds (30 seconds)
USAGE_CACHE_TTL = 30


def _get_cache_key(org_id: int) -> str:
    """Get Redis cache key for org usage."""
    return f"org_usage:{org_id}"


def invalidate_usage_cache(org_id: int) -> None:
    """
    Invalidate the usage cache for an organization.
    Call this when usage changes (member/course added/removed).
    """
    try:
        r = _get_redis_client()
        r.delete(_get_cache_key(org_id))
    except Exception:
        # Silently fail if Redis is unavailable
        pass


def _get_cached_usage(org_id: int) -> dict | None:
    """Get cached usage data if available."""
    try:
        r = _get_redis_client()
        cached = r.get(_get_cache_key(org_id))
        if cached:
            return json.loads(cached)
    except Exception:
        pass
    return None


def _set_cached_usage(org_id: int, data: dict) -> None:
    """Cache usage data."""
    try:
        r = _get_redis_client()
        r.setex(_get_cache_key(org_id), USAGE_CACHE_TTL, json.dumps(data))
    except Exception:
        # Silently fail if Redis is unavailable
        pass


async def get_org_usage_and_limits(
    request: Request,
    org_id: int,
    current_user: PublicUser,
    db_session: Session,
) -> dict:
    """
    Get organization usage and limits for plan-based features.
    Results are cached in Redis for 30 seconds.

    Returns:
        Dictionary with current usage, limits, and remaining quota for each feature.
    """
    # Check if user is authenticated
    await authorization_verify_if_user_is_anon(current_user.id)

    # Try to get from cache first
    cached = _get_cached_usage(org_id)
    if cached:
        return cached

    # Get the Organization Config
    statement = select(OrganizationConfig).where(OrganizationConfig.org_id == org_id)
    result = db_session.exec(statement)
    org_config = result.first()

    if org_config is None:
        raise HTTPException(
            status_code=404,
            detail="Organization config not found",
        )

    # Get plan from config
    cloud_config = org_config.config.get("cloud", {})
    org_plan: PlanLevel = cloud_config.get("plan", "free")

    # Check if OSS mode (unlimited)
    oss_mode = _is_oss_mode()

    # Get actual usage counts
    courses_usage = _get_actual_usage("courses", org_id, db_session)
    members_usage = _get_actual_usage("members", org_id, db_session)
    admin_seats_usage = _get_actual_admin_seat_count(org_id, db_session)

    # Get limits from plan
    courses_limit = 0 if oss_mode else get_plan_limit(org_plan, "courses")
    members_limit = 0 if oss_mode else get_plan_limit(org_plan, "members")
    admin_seats_limit = 0 if oss_mode else get_plan_limit(org_plan, "admin_seats")

    def calc_remaining(usage: int, limit: int) -> int | str:
        if limit == 0:
            return "unlimited"
        return max(0, limit - usage)

    def is_limit_reached(usage: int, limit: int) -> bool:
        if limit == 0:
            return False
        return usage >= limit

    response = {
        "org_id": org_id,
        "plan": org_plan,
        "oss_mode": oss_mode,
        "features": {
            "courses": {
                "usage": courses_usage,
                "limit": courses_limit if courses_limit > 0 else "unlimited",
                "remaining": calc_remaining(courses_usage, courses_limit),
                "limit_reached": is_limit_reached(courses_usage, courses_limit),
            },
            "members": {
                "usage": members_usage,
                "limit": members_limit if members_limit > 0 else "unlimited",
                "remaining": calc_remaining(members_usage, members_limit),
                "limit_reached": is_limit_reached(members_usage, members_limit),
            },
            "admin_seats": {
                "usage": admin_seats_usage,
                "limit": admin_seats_limit if admin_seats_limit > 0 else "unlimited",
                "remaining": calc_remaining(admin_seats_usage, admin_seats_limit),
                "limit_reached": is_limit_reached(admin_seats_usage, admin_seats_limit),
            },
        },
    }

    # Cache the response
    _set_cached_usage(org_id, response)

    return response
