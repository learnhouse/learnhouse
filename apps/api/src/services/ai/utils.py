from typing import Literal
import redis
from fastapi import HTTPException
from sqlmodel import Session, select
from config.config import get_learnhouse_config
from src.db.organization_config import OrganizationConfig
from src.db.organizations import Organization


def count_ai_ask(
    organization: Organization,
    operation: Literal["increment", "decrement"],
):
    """
    Count the number of AI asks
    """

    LH_CONFIG = get_learnhouse_config()
    redis_conn_string = LH_CONFIG.redis_config.redis_connection_string

    if not redis_conn_string:
        raise HTTPException(
            status_code=500,
            detail="Redis connection string not found",
        )

    # Connect to Redis
    r = redis.Redis.from_url(redis_conn_string)

    if not r:
        raise HTTPException(
            status_code=500,
            detail="Could not connect to Redis",
        )

    # Get the number of AI asks
    ai_asks = r.get(f"ai_asks:{organization.org_uuid}")

    if ai_asks is None:
        ai_asks = 0

    # Increment or decrement the number of AI asks
    if operation == "increment":
        ai_asks = int(ai_asks) + 1
    elif operation == "decrement":
        ai_asks = int(ai_asks) - 1

    # Update the number of AI asks
    r.set(f"ai_asks:{organization.org_uuid}", ai_asks)

    # Set the expiration time to 30 days
    r.expire(f"ai_asks:{organization.org_uuid}", 2592000)


def check_limits_and_config(db_session: Session, organization: Organization):
    """
    Check the limits and config of an Organization
    """

    # Get the Organization Config
    statement = select(OrganizationConfig).where(
        OrganizationConfig.org_id == organization.id
    )
    result = db_session.exec(statement)
    org_config = result.first()

    if org_config is None:
        raise HTTPException(
            status_code=404,
            detail="Organization has no config",
        )

    # Check if the Organizations has AI enabled
    if org_config.config["AIConfig"]["enabled"] == False:
        raise HTTPException(
            status_code=403,
            detail="Organization has AI disabled",
        )

    # Check if the Organization has Limits enabled and if the max_asks limit has been reached
    if org_config.config["features"]["ai"]["limit"] > 0:
        LH_CONFIG = get_learnhouse_config()
        redis_conn_string = LH_CONFIG.redis_config.redis_connection_string

        if not redis_conn_string:
            raise HTTPException(
                status_code=500,
                detail="Redis connection string not found",
            )

        # Connect to Redis
        r = redis.Redis.from_url(redis_conn_string)

        if not r:
            raise HTTPException(
                status_code=500,
                detail="Could not connect to Redis",
            )

        # Get the number of AI asks
        ai_asks = r.get(f"ai_asks:{organization.org_uuid}")

        # Get a number of AI asks
        if ai_asks is None:
            ai_asks = 0
        else:
            ai_asks = int(ai_asks)

        # Check if the Number of asks is less than the max_asks limit
        if org_config.config["features"]["ai"]["limit"] <= ai_asks:
            raise HTTPException(
                status_code=403,
                detail="Organization has reached the max number of AI asks",
            )
