"""
FastAPI dependencies for plan-based feature restrictions.

Provides dependency functions to enforce plan requirements at the router level.
"""

from fastapi import Depends, HTTPException, Request
from sqlmodel import Session, select

from src.core.events.database import get_db_session
from src.db.organization_config import OrganizationConfig
from src.db.communities.communities import Community
from src.security.features_utils.plans import PlanLevel, plan_meets_requirement


def get_org_plan(org_id: int, db_session: Session) -> PlanLevel:
    """
    Query the organization's current plan from OrganizationConfig.

    Args:
        org_id: The organization ID
        db_session: Database session

    Returns:
        The organization's plan level

    Raises:
        HTTPException: 404 if organization config not found
    """
    statement = select(OrganizationConfig).where(OrganizationConfig.org_id == org_id)
    result = db_session.exec(statement)
    org_config = result.first()

    if org_config is None:
        raise HTTPException(
            status_code=404,
            detail="Organization configuration not found",
        )

    # Default to 'free' if cloud config or plan is missing
    cloud_config = org_config.config.get("cloud", {})
    return cloud_config.get("plan", "free")


def require_plan(required_plan: PlanLevel, feature_name: str):
    """
    Factory function that returns a FastAPI dependency to enforce plan requirements.

    Usage in router:
        dependencies=[Depends(require_plan("pro", "API Access"))]

    Args:
        required_plan: The minimum plan level required
        feature_name: Human-readable feature name for error messages

    Returns:
        A FastAPI dependency function
    """

    async def plan_dependency(
        request: Request,
        db_session: Session = Depends(get_db_session),
    ):
        # Extract org_id from path parameters
        org_id = request.path_params.get("org_id")

        if org_id is None:
            raise HTTPException(
                status_code=400,
                detail="Organization ID is required",
            )

        # Convert to int if string
        try:
            org_id_int = int(org_id)
        except (ValueError, TypeError):
            raise HTTPException(
                status_code=400,
                detail="Invalid organization ID",
            )

        current_plan = get_org_plan(org_id_int, db_session)

        if not plan_meets_requirement(current_plan, required_plan):
            raise HTTPException(
                status_code=403,
                detail=f"{feature_name} requires a {required_plan.capitalize()} plan or higher. "
                f"Your organization is currently on the {current_plan.capitalize()} plan.",
            )

        return True

    return plan_dependency


def require_plan_for_community(required_plan: PlanLevel, feature_name: str):
    """
    Factory function that returns a FastAPI dependency to enforce plan requirements
    for community routes. Can handle org_id from path params, query params, or look it up
    from community_uuid.

    Usage in router:
        dependencies=[Depends(require_plan_for_community("standard", "Communities"))]

    Args:
        required_plan: The minimum plan level required
        feature_name: Human-readable feature name for error messages

    Returns:
        A FastAPI dependency function
    """

    async def plan_dependency(
        request: Request,
        db_session: Session = Depends(get_db_session),
    ):
        org_id = None

        # Try to get org_id from path parameters first
        org_id_param = request.path_params.get("org_id")
        if org_id_param is not None:
            try:
                org_id = int(org_id_param)
            except (ValueError, TypeError):
                pass

        # Try to get org_id from query parameters
        if org_id is None:
            org_id_query = request.query_params.get("org_id")
            if org_id_query is not None:
                try:
                    org_id = int(org_id_query)
                except (ValueError, TypeError):
                    pass

        # If no org_id, try to get it from community_uuid in path
        if org_id is None:
            community_uuid = request.path_params.get("community_uuid")
            if community_uuid:
                # Look up the community to get its org_id
                statement = select(Community).where(Community.community_uuid == community_uuid)
                result = db_session.exec(statement)
                community = result.first()

                if community:
                    org_id = community.org_id

        if org_id is None:
            # Can't determine org, allow the request (other checks will handle auth)
            return True

        current_plan = get_org_plan(org_id, db_session)

        if not plan_meets_requirement(current_plan, required_plan):
            raise HTTPException(
                status_code=403,
                detail=f"{feature_name} requires a {required_plan.capitalize()} plan or higher. "
                f"Your organization is currently on the {current_plan.capitalize()} plan.",
            )

        return True

    return plan_dependency
