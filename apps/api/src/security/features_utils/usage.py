import redis
from datetime import datetime
from src.db.organization_config import OrganizationConfig
from src.db.billing_usage import UsageEvent
from src.db.user_organizations import UserOrganization
from src.db.courses.courses import Course
from src.db.roles import Role, RoleTypeEnum
from sqlalchemy import or_
from config.config import get_learnhouse_config
from src.core.deployment_mode import get_deployment_mode
from typing import Literal, TypeAlias
from fastapi import HTTPException
from sqlmodel import Session, select, func
from src.security.features_utils.plans import (
    PlanLevel,
    get_plan_limit,
    get_ai_credit_limit,
    plan_meets_requirement,
    get_required_plan_for_feature,
)

FeatureSet: TypeAlias = Literal[
    "admin_seats",
    "ai",
    "analytics",
    "api",
    "assignments",
    "collaboration",
    "courses",
    "members",
    "payments",
    "podcasts",
    "storage",
    "usergroups",
]

# Features that use plan-based limits (tracked via events in PostgreSQL)
PLAN_BASED_FEATURES = {"courses", "members", "admin_seats"}

# Features that use Redis for usage tracking (non-billing, rate limiting)
REDIS_TRACKED_FEATURES = {"ai", "analytics", "api", "assignments", "collaboration",
                          "payments", "podcasts", "storage", "usergroups"}


def _is_non_saas() -> bool:
    """Check if deployment is in a non-SaaS mode (EE or OSS) — disables plan-based limits."""
    return get_deployment_mode() != 'saas'


def _get_redis_client():
    """Get a Redis client instance."""
    LH_CONFIG = get_learnhouse_config()
    redis_conn_string = LH_CONFIG.redis_config.redis_connection_string

    if not redis_conn_string:
        raise HTTPException(
            status_code=500,
            detail="Redis connection string not found",
        )

    return redis.Redis.from_url(redis_conn_string)


def _get_org_plan(org_config: OrganizationConfig) -> PlanLevel:
    """Get the organization's current plan (supports v1 and v2 config)."""
    config = org_config.config or {}
    version = config.get("config_version", "1.0")
    if version.startswith("2"):
        return config.get("plan", "free")
    return config.get("cloud", {}).get("plan", "free")


# ============================================================================
# Actual Usage Counts (from database)
# ============================================================================

def _get_actual_member_count(org_id: int, db_session: Session) -> int:
    """Get actual member count from database."""
    statement = select(func.count()).where(UserOrganization.org_id == org_id)
    return db_session.exec(statement).one()


def _get_actual_course_count(org_id: int, db_session: Session) -> int:
    """Get actual course count from database."""
    statement = select(func.count()).where(Course.org_id == org_id)
    return db_session.exec(statement).one()


def _get_actual_admin_seat_count(org_id: int, db_session: Session) -> int:
    """
    Get count of users with dashboard access (admin seats).
    Admin seat = user with a role that has dashboard.action_access = true
    """
    # Get all roles that could apply: org-specific roles AND global default roles
    statement = select(Role).where(
        or_(
            Role.org_id == org_id,
            Role.role_type == RoleTypeEnum.TYPE_GLOBAL,
        )
    )
    roles = db_session.exec(statement).all()

    # Find role IDs with dashboard access
    admin_role_ids = []
    for role in roles:
        rights = role.rights
        if isinstance(rights, dict):
            dashboard = rights.get("dashboard", {})
            if dashboard.get("action_access", False):
                admin_role_ids.append(role.id)

    if not admin_role_ids:
        return 0

    # Count users with these roles
    statement = select(func.count()).where(
        UserOrganization.org_id == org_id,
        UserOrganization.role_id.in_(admin_role_ids)
    )
    return db_session.exec(statement).one()


def _get_actual_usage(feature: str, org_id: int, db_session: Session) -> int:
    """Get actual usage count from database for plan-based features."""
    if feature == "members":
        return _get_actual_member_count(org_id, db_session)
    elif feature == "courses":
        return _get_actual_course_count(org_id, db_session)
    elif feature == "admin_seats":
        return _get_actual_admin_seat_count(org_id, db_session)
    return 0


# ============================================================================
# Event-Based Usage Tracking (PostgreSQL)
# ============================================================================

def _invalidate_usage_cache(org_id: int) -> None:
    """Invalidate the usage cache for an organization."""
    try:
        r = _get_redis_client()
        r.delete(f"org_usage:{org_id}")
    except Exception:
        pass


def log_usage_event(
    org_id: int,
    feature: str,
    event_type: Literal["add", "remove"],
    db_session: Session,
):
    """
    Log a usage event for billing tracking.
    Called when a member/course is added or removed.
    """
    if feature not in PLAN_BASED_FEATURES:
        return

    # Get current actual count
    usage_after = _get_actual_usage(feature, org_id, db_session)

    event = UsageEvent(
        org_id=org_id,
        feature=feature,
        event_type=event_type,
        timestamp=datetime.now(),
        usage_after=usage_after,
    )
    db_session.add(event)
    db_session.commit()

    # Invalidate usage cache
    _invalidate_usage_cache(org_id)


# ============================================================================
# Main Usage Check Functions
# ============================================================================

def check_feature_enabled(
    feature: FeatureSet,
    org_id: int,
    db_session: Session,
) -> bool:
    """
    Check if a feature is enabled for an organization.

    Uses resolve_feature() for v2 configs, falls back to plan-based check for v1.

    Returns:
        True if the feature is enabled

    Raises:
        HTTPException 403 if feature is disabled
    """
    from src.security.features_utils.resolve import resolve_feature

    statement = select(OrganizationConfig).where(OrganizationConfig.org_id == org_id)
    org_config = db_session.exec(statement).first()

    if org_config is None:
        raise HTTPException(
            status_code=404,
            detail="Organization has no config",
        )

    resolved = resolve_feature(feature, org_config.config or {}, org_id)

    if not resolved["enabled"]:
        raise HTTPException(
            status_code=403,
            detail=f"{feature.capitalize()} is not enabled for this organization",
        )

    return True


def check_limits_with_usage(
    feature: FeatureSet,
    org_id: int,
    db_session: Session,
):
    """Check if usage is within limits for a feature.
    Uses resolve_feature() for unified 4-layer resolution."""
    from src.security.features_utils.resolve import resolve_feature

    statement = select(OrganizationConfig).where(OrganizationConfig.org_id == org_id)
    org_config = db_session.exec(statement).first()

    if org_config is None:
        raise HTTPException(
            status_code=404,
            detail="Organization has no config",
        )

    resolved = resolve_feature(feature, org_config.config or {}, org_id)

    # Check if the feature is enabled
    if not resolved["enabled"]:
        raise HTTPException(
            status_code=403,
            detail=f"{feature.capitalize()} is not enabled for this organization",
        )

    # Unlimited (limit=0) — no usage check needed
    if resolved["limit"] == 0:
        return True

    org_plan = _get_org_plan(org_config)
    feature_limit = resolved["limit"]

    # Plan-based features - check actual DB count
    if feature in PLAN_BASED_FEATURES:
        current_usage = _get_actual_usage(feature, org_id, db_session)

        if current_usage >= feature_limit:
            # For non-free plans, allow overage (tracked via events for billing)
            if org_plan not in ("free",):
                return True
            else:
                raise HTTPException(
                    status_code=403,
                    detail=f"Usage Limit has been reached for {feature.capitalize()}",
                )
        return True

    # Redis-tracked features
    if feature_limit > 0:
        r = _get_redis_client()
        feature_usage = r.get(f"{feature}_usage:{org_id}")

        if feature_usage is None:
            feature_usage_count = 0
        else:
            feature_usage_count = int(feature_usage)

        if feature_limit <= feature_usage_count:
            raise HTTPException(
                status_code=403,
                detail=f"Usage Limit has been reached for {feature.capitalize()}",
            )
    return True


def increase_feature_usage(
    feature: FeatureSet,
    org_id: int,
    db_session: Session,
):
    """Increase usage count for a feature."""
    # Plan-based features - log event
    if feature in PLAN_BASED_FEATURES:
        log_usage_event(org_id, feature, "add", db_session)
        return True

    # Redis-tracked features
    r = _get_redis_client()
    feature_usage = r.get(f"{feature}_usage:{org_id}")

    if feature_usage is None:
        feature_usage_count = 0
    else:
        feature_usage_count = int(feature_usage)

    r.set(f"{feature}_usage:{org_id}", feature_usage_count + 1)
    return True


def decrease_feature_usage(
    feature: FeatureSet,
    org_id: int,
    db_session: Session,
):
    """Decrease usage count for a feature."""
    # Plan-based features - log event
    if feature in PLAN_BASED_FEATURES:
        log_usage_event(org_id, feature, "remove", db_session)
        return True

    # Redis-tracked features
    r = _get_redis_client()
    feature_usage = r.get(f"{feature}_usage:{org_id}")

    if feature_usage is None:
        feature_usage_count = 0
    else:
        feature_usage_count = int(feature_usage)

    r.set(f"{feature}_usage:{org_id}", max(0, feature_usage_count - 1))
    return True


# ============================================================================
# Feature Access Check (Plan-Based Features)
# ============================================================================

def check_feature_access(
    feature: str,
    org_id: int,
    db_session: Session,
) -> bool:
    """
    Check if a feature is accessible based on plan level or OSS mode.

    For features that require a minimum plan level (e.g., versioning requires 'standard'),
    this function checks:
    1. If OSS mode is enabled → allow access
    2. If the organization's plan meets the required level → allow access
    3. Otherwise → deny access with 403

    Args:
        feature: The feature key (e.g., 'versioning', 'ai')
        org_id: The organization ID
        db_session: Database session

    Returns:
        True if access is allowed

    Raises:
        HTTPException 403 if access is denied
    """
    # OSS mode enables all features
    if _is_non_saas():
        return True

    # Get required plan for this feature
    required_plan = get_required_plan_for_feature(feature)

    # If no plan requirement, allow access
    if required_plan is None:
        return True

    # Get the organization's plan
    statement = select(OrganizationConfig).where(OrganizationConfig.org_id == org_id)
    org_config = db_session.exec(statement).first()

    if org_config is None:
        raise HTTPException(
            status_code=404,
            detail="Organization has no config",
        )

    org_plan = _get_org_plan(org_config)

    # Check if plan meets requirement
    if not plan_meets_requirement(org_plan, required_plan):
        raise HTTPException(
            status_code=403,
            detail=f"{feature.capitalize()} requires {required_plan} plan or higher. Current plan: {org_plan}",
        )

    return True


# ============================================================================
# Billing Calculation Functions (from events)
# ============================================================================

def get_usage_at_timestamp(
    org_id: int,
    feature: str,
    timestamp: datetime,
    db_session: Session,
) -> int:
    """Get usage count at a specific point in time."""
    statement = (
        select(UsageEvent)
        .where(
            UsageEvent.org_id == org_id,
            UsageEvent.feature == feature,
            UsageEvent.timestamp <= timestamp,
        )
        .order_by(UsageEvent.timestamp.desc())
        .limit(1)
    )
    event = db_session.exec(statement).first()
    return event.usage_after if event else 0


def get_peak_usage(
    org_id: int,
    feature: str,
    start_date: datetime,
    end_date: datetime,
    db_session: Session,
) -> int:
    """Get peak (maximum) usage during a date range."""
    statement = (
        select(func.max(UsageEvent.usage_after))
        .where(
            UsageEvent.org_id == org_id,
            UsageEvent.feature == feature,
            UsageEvent.timestamp >= start_date,
            UsageEvent.timestamp <= end_date,
        )
    )
    peak = db_session.exec(statement).first()

    if peak is None:
        # No events in range - get usage at start of range
        return get_usage_at_timestamp(org_id, feature, start_date, db_session)

    return peak


def get_usage_events(
    org_id: int,
    feature: str,
    start_date: datetime,
    end_date: datetime,
    db_session: Session,
) -> list[UsageEvent]:
    """Get all usage events in a date range."""
    statement = (
        select(UsageEvent)
        .where(
            UsageEvent.org_id == org_id,
            UsageEvent.feature == feature,
            UsageEvent.timestamp >= start_date,
            UsageEvent.timestamp <= end_date,
        )
        .order_by(UsageEvent.timestamp)
    )
    return list(db_session.exec(statement).all())


def calculate_weighted_average_usage(
    org_id: int,
    feature: str,
    start_date: datetime,
    end_date: datetime,
    db_session: Session,
) -> float:
    """
    Calculate time-weighted average usage over a period.
    This is the fairest billing method for mid-period starts.
    """
    events = get_usage_events(org_id, feature, start_date, end_date, db_session)

    # Get initial usage at start of period
    initial_usage = get_usage_at_timestamp(org_id, feature, start_date, db_session)

    if not events:
        # No changes during period - usage was constant
        return float(initial_usage)

    total_seconds = (end_date - start_date).total_seconds()
    if total_seconds <= 0:
        return float(initial_usage)

    weighted_sum = 0.0
    current_usage = initial_usage
    current_time = start_date

    for event in events:
        # Add weighted contribution for time at current usage level
        duration = (event.timestamp - current_time).total_seconds()
        weighted_sum += current_usage * duration

        # Update to new usage level
        current_usage = event.usage_after
        current_time = event.timestamp

    # Add final segment from last event to end of period
    duration = (end_date - current_time).total_seconds()
    weighted_sum += current_usage * duration

    return weighted_sum / total_seconds


def calculate_billable_overage(
    org_id: int,
    feature: str,
    start_date: datetime,
    end_date: datetime,
    plan_limit: int,
    db_session: Session,
    method: Literal["peak", "average"] = "peak",
) -> dict:
    """
    Calculate billable overage for a period.

    Args:
        org_id: Organization ID
        feature: Feature name (members, courses)
        start_date: Billing period start
        end_date: Billing period end
        plan_limit: Plan limit for the feature (0 = unlimited)
        method: "peak" for max usage, "average" for weighted average

    Returns:
        Dict with usage details and overage
    """
    if plan_limit == 0:  # Unlimited
        return {
            "feature": feature,
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
            "limit": "unlimited",
            "usage": 0,
            "overage": 0,
            "method": method,
        }

    if method == "peak":
        usage = get_peak_usage(org_id, feature, start_date, end_date, db_session)
    else:
        usage = calculate_weighted_average_usage(
            org_id, feature, start_date, end_date, db_session
        )

    overage = max(0, usage - plan_limit) if plan_limit > 0 else 0

    return {
        "feature": feature,
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "limit": plan_limit,
        "usage": round(usage, 2) if isinstance(usage, float) else usage,
        "overage": round(overage, 2) if isinstance(overage, float) else overage,
        "method": method,
    }


def get_billing_summary(
    org_id: int,
    start_date: datetime,
    end_date: datetime,
    db_session: Session,
    method: Literal["peak", "average"] = "peak",
) -> dict:
    """
    Get complete billing summary for an organization for a period.
    """
    statement = select(OrganizationConfig).where(OrganizationConfig.org_id == org_id)
    org_config = db_session.exec(statement).first()

    if org_config is None:
        return {"error": "Organization has no config"}

    org_plan = _get_org_plan(org_config)

    summary = {
        "org_id": org_id,
        "plan": org_plan,
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "method": method,
        "features": {},
    }

    for feature in PLAN_BASED_FEATURES:
        plan_limit = get_plan_limit(org_plan, feature)
        feature_billing = calculate_billable_overage(
            org_id, feature, start_date, end_date, plan_limit, db_session, method
        )
        summary["features"][feature] = feature_billing

    return summary


def get_all_orgs_with_overage(
    start_date: datetime,
    end_date: datetime,
    db_session: Session,
    method: Literal["peak", "average"] = "peak",
) -> list[dict]:
    """
    Get all organizations with overage for batch billing.
    """
    # Get all orgs that have events in this period
    statement = (
        select(UsageEvent.org_id)
        .where(
            UsageEvent.timestamp >= start_date,
            UsageEvent.timestamp <= end_date,
        )
        .distinct()
    )
    org_ids = db_session.exec(statement).all()

    results = []
    for org_id in org_ids:
        summary = get_billing_summary(org_id, start_date, end_date, db_session, method)

        # Check if any feature has overage
        has_overage = any(
            f.get("overage", 0) > 0
            for f in summary.get("features", {}).values()
        )

        if has_overage:
            results.append(summary)

    return results


# ============================================================================
# Admin Seat Management
# ============================================================================

def check_admin_seat_limit(
    org_id: int,
    db_session: Session,
) -> bool:
    """
    Check if the organization can add another admin seat.
    Call this before assigning a role with dashboard access.

    Returns:
        True if allowed

    Raises:
        HTTPException if limit reached (for free plan)
    """
    return check_limits_with_usage("admin_seats", org_id, db_session)


def get_admin_seat_usage(
    org_id: int,
    db_session: Session,
) -> dict:
    """Get admin seat usage summary."""
    statement = select(OrganizationConfig).where(OrganizationConfig.org_id == org_id)
    org_config = db_session.exec(statement).first()

    if org_config is None:
        return {"error": "Organization has no config"}

    org_plan = _get_org_plan(org_config)
    current_usage = _get_actual_admin_seat_count(org_id, db_session)
    limit = get_plan_limit(org_plan, "admin_seats")

    return {
        "plan": org_plan,
        "current_usage": current_usage,
        "limit": limit if limit > 0 else "unlimited",
        "remaining": (limit - current_usage) if limit > 0 else "unlimited",
    }


def is_role_dashboard_enabled(role: Role) -> bool:
    """Check if a role has dashboard access."""
    rights = role.rights
    if isinstance(rights, dict):
        dashboard = rights.get("dashboard", {})
        return dashboard.get("action_access", False)
    return False


# ============================================================================
# Purchased Member Seats (Redis)
# ============================================================================

def get_purchased_member_seats(org_id: int) -> int:
    """Get purchased member seats from Redis."""
    r = _get_redis_client()
    val = r.get(f"member_seats_purchased:{org_id}")
    return int(val) if val else 0


# ============================================================================
# AI Credit Management Functions (Redis)
# ============================================================================

def check_ai_credits(
    org_id: int,
    db_session: Session,
) -> bool:
    """Check if the organization has AI credits available."""
    from src.security.features_utils.resolve import resolve_feature

    statement = select(OrganizationConfig).where(OrganizationConfig.org_id == org_id)
    org_config = db_session.exec(statement).first()

    if org_config is None:
        raise HTTPException(
            status_code=404,
            detail="Organization has no config",
        )

    resolved = resolve_feature("ai", org_config.config or {}, org_id)

    if not resolved["enabled"]:
        raise HTTPException(
            status_code=403,
            detail="AI is not enabled for this organization",
        )

    if _is_non_saas():
        return True

    org_plan = _get_org_plan(org_config)
    r = _get_redis_client()

    base_credits = get_ai_credit_limit(org_plan)

    if base_credits == -1:
        return True

    if base_credits == 0:
        raise HTTPException(
            status_code=403,
            detail="AI credits are not available on the free plan. Please upgrade to Standard or Pro.",
        )

    # Include override extra_limit
    config = org_config.config or {}
    extra = 0
    if config.get("config_version", "1.0").startswith("2"):
        extra = config.get("overrides", {}).get("ai", {}).get("extra_limit", 0)

    purchased_credits = r.get(f"ai_credits_purchased:{org_id}")
    purchased_credits_count = int(purchased_credits) if purchased_credits else 0

    total_credits = base_credits + extra + purchased_credits_count

    used_credits = r.get(f"ai_credits_used:{org_id}")
    used_credits_count = int(used_credits) if used_credits else 0

    remaining_credits = total_credits - used_credits_count
    if remaining_credits <= 0:
        raise HTTPException(
            status_code=403,
            detail=f"AI credit limit reached. You have used all {total_credits} credits.",
        )

    return True


def deduct_ai_credit(
    org_id: int,
    db_session: Session,
    amount: int = 1,
) -> int:
    """Deduct AI credits from the organization."""
    r = _get_redis_client()

    used_credits = r.get(f"ai_credits_used:{org_id}")
    used_credits_count = int(used_credits) if used_credits else 0

    new_usage_count = used_credits_count + amount
    r.set(f"ai_credits_used:{org_id}", new_usage_count)

    return new_usage_count


def add_ai_credits(org_id: int, amount: int) -> int:
    """Add purchased AI credits to the organization."""
    r = _get_redis_client()
    return r.incrby(f"ai_credits_purchased:{org_id}", amount)


def reset_ai_credits_usage(org_id: int) -> bool:
    """Reset AI credit usage for the organization (for new billing period)."""
    r = _get_redis_client()
    r.set(f"ai_credits_used:{org_id}", 0)
    return True


def get_ai_credits_summary(org_id: int, db_session: Session) -> dict:
    """Get a summary of AI credits for an organization."""
    statement = select(OrganizationConfig).where(OrganizationConfig.org_id == org_id)
    result = db_session.exec(statement)
    org_config = result.first()

    if org_config is None:
        return {"error": "Organization has no config"}

    org_plan = _get_org_plan(org_config)

    r = _get_redis_client()

    if _is_non_saas():
        used_credits = r.get(f"ai_credits_used:{org_id}")
        used_credits_count = int(used_credits) if used_credits else 0
        return {
            "plan": org_plan,
            "mode": get_deployment_mode(),
            "base_credits": "unlimited",
            "purchased_credits": 0,
            "total_credits": "unlimited",
            "used_credits": used_credits_count,
            "remaining_credits": "unlimited",
        }

    base_credits = get_ai_credit_limit(org_plan)

    purchased_credits = r.get(f"ai_credits_purchased:{org_id}")
    purchased_credits_count = int(purchased_credits) if purchased_credits else 0

    used_credits = r.get(f"ai_credits_used:{org_id}")
    used_credits_count = int(used_credits) if used_credits else 0

    if base_credits == -1:
        return {
            "plan": org_plan,
            "base_credits": "unlimited",
            "purchased_credits": purchased_credits_count,
            "total_credits": "unlimited",
            "used_credits": used_credits_count,
            "remaining_credits": "unlimited",
        }

    total_credits = base_credits + purchased_credits_count
    remaining_credits = max(0, total_credits - used_credits_count)

    return {
        "plan": org_plan,
        "base_credits": base_credits,
        "purchased_credits": purchased_credits_count,
        "total_credits": total_credits,
        "used_credits": used_credits_count,
        "remaining_credits": remaining_credits,
    }
