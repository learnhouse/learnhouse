import redis
from src.db.organization_config import OrganizationConfig
from config.config import get_learnhouse_config
from typing import Literal, TypeAlias
from fastapi import HTTPException
from sqlmodel import Session, select

FeatureSet: TypeAlias = Literal[
    "ai",
    "analytics",
    "api",
    "assignments",
    "collaboration",
    "courses",
    "discussions",
    "members",
    "payments",
    "storage",
    "usergroups",
]


def check_limits_with_usage(
    feature: FeatureSet,
    org_id: int,
    db_session: Session,
):

    # Get the Organization Config
    statement = select(OrganizationConfig).where(OrganizationConfig.org_id == org_id)
    result = db_session.exec(statement)

    org_config = result.first()

    if org_config is None:
        raise HTTPException(
            status_code=404,
            detail="Organization has no config",
        )

    # Check if the Organizations has AI enabled
    if org_config.config["features"][feature]["enabled"] == False:
        raise HTTPException(
            status_code=403,
            detail=f"{feature.capitalize()} is not enabled for this organization",
        )

    LH_CONFIG = get_learnhouse_config()
    redis_conn_string = LH_CONFIG.redis_config.redis_connection_string

    if not redis_conn_string:
        raise HTTPException(
            status_code=500,
            detail="Redis connection string not found",
        )

    # Connect to Redis
    r = redis.Redis.from_url(redis_conn_string)

    # Check limits
    feature_limit = org_config.config["features"][feature]["limit"]

    if feature_limit > 0:
        # Get the number of feature usage
        feature_usage = r.get(f"{feature}_usage:{org_id}")

        # Get a number of feature asks
        if feature_usage is None:
            feature_usage_count = 0
        else:
            feature_usage_count = int(feature_usage)  # type: ignore

        # Check if the Number of usage is less than the max_asks limit
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
    LH_CONFIG = get_learnhouse_config()
    redis_conn_string = LH_CONFIG.redis_config.redis_connection_string

    if not redis_conn_string:
        raise HTTPException(
            status_code=500,
            detail="Redis connection string not found",
        )

    # Connect to Redis
    r = redis.Redis.from_url(redis_conn_string)

    # Get the number of feature usage
    feature_usage = r.get(f"{feature}_usage:{org_id}")

    # Get a number of feature asks
    if feature_usage is None:
        feature_usage_count = 0
    else:
        feature_usage_count = int(feature_usage)  # type: ignore

    # Increment the feature usage
    r.set(f"{feature}_usage:{org_id}", feature_usage_count + 1)
    return True


def decrease_feature_usage(
    feature: FeatureSet,
    org_id: int,
    db_session: Session,
):
    LH_CONFIG = get_learnhouse_config()
    redis_conn_string = LH_CONFIG.redis_config.redis_connection_string

    if not redis_conn_string:
        raise HTTPException(
            status_code=500,
            detail="Redis connection string not found",
        )

    # Connect to Redis
    r = redis.Redis.from_url(redis_conn_string)

    # Get the number of feature usage
    feature_usage = r.get(f"{feature}_usage:{org_id}")

    # Get a number of feature asks
    if feature_usage is None:
        feature_usage_count = 0
    else:
        feature_usage_count = int(feature_usage)  # type: ignore

    # Increment the feature usage
    r.set(f"{feature}_usage:{org_id}", feature_usage_count - 1)
    return True
