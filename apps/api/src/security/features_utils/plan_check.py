"""
FastAPI dependencies for plan-based feature restrictions.

Provides dependency functions to enforce plan requirements at the router level.
"""

from fastapi import Depends, HTTPException, Request
from sqlmodel import Session, select

from config.config import get_learnhouse_config
from src.core.events.database import get_db_session
from src.db.organization_config import OrganizationConfig
from src.db.communities.communities import Community
from src.db.organizations import Organization
from src.security.features_utils.plans import PlanLevel, plan_meets_requirement


def _is_oss_mode() -> bool:
    """Check if OSS mode is enabled (disables plan-based limits)."""
    return get_learnhouse_config().general_config.oss_mode


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
        if _is_oss_mode():
            return True

        org_id = None

        # Try to get org_id from path parameters first
        org_id_param = request.path_params.get("org_id")
        if org_id_param is not None:
            try:
                org_id = int(org_id_param)
            except (ValueError, TypeError):
                pass

        # Try to get org_id from query parameters as fallback
        if org_id is None:
            org_id_query = request.query_params.get("org_id")
            if org_id_query is not None:
                try:
                    org_id = int(org_id_query)
                except (ValueError, TypeError):
                    pass

        if org_id is None:
            raise HTTPException(
                status_code=400,
                detail="Organization ID is required",
            )

        current_plan = get_org_plan(org_id, db_session)

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
        if _is_oss_mode():
            return True

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


def require_plan_for_docs(required_plan: PlanLevel, feature_name: str):
    """
    Factory function that returns a FastAPI dependency to enforce plan requirements
    for docs routes. Resolves org_id from doc-specific UUIDs, org_slug, or org_id.

    Usage in router:
        dependencies=[Depends(require_plan_for_docs("pro", "Documentation"))]
    """

    async def plan_dependency(
        request: Request,
        db_session: Session = Depends(get_db_session),
    ):
        if _is_oss_mode():
            return True

        org_id = None
        path_params = request.path_params

        # Try org_id from path/query params first
        org_id_param = path_params.get("org_id")
        if org_id_param is not None:
            try:
                org_id = int(org_id_param)
            except (ValueError, TypeError):
                pass

        if org_id is None:
            org_id_query = request.query_params.get("org_id")
            if org_id_query is not None:
                try:
                    org_id = int(org_id_query)
                except (ValueError, TypeError):
                    pass

        # Try org_slug
        if org_id is None and "org_slug" in path_params:
            statement = select(Organization).where(
                Organization.slug == path_params["org_slug"]
            )
            org = db_session.exec(statement).first()
            if org:
                org_id = org.id

        # Try docspace_uuid
        if org_id is None and "docspace_uuid" in path_params:
            from src.db.docs.docspaces import DocSpace
            statement = select(DocSpace).where(
                DocSpace.docspace_uuid == path_params["docspace_uuid"]
            )
            docspace = db_session.exec(statement).first()
            if docspace:
                org_id = docspace.org_id

        # Try docsection_uuid
        if org_id is None and "docsection_uuid" in path_params:
            from src.db.docs.docsections import DocSection
            statement = select(DocSection).where(
                DocSection.docsection_uuid == path_params["docsection_uuid"]
            )
            docsection = db_session.exec(statement).first()
            if docsection:
                org_id = docsection.org_id

        # Try docgroup_uuid
        if org_id is None and "docgroup_uuid" in path_params:
            from src.db.docs.docgroups import DocGroup
            statement = select(DocGroup).where(
                DocGroup.docgroup_uuid == path_params["docgroup_uuid"]
            )
            docgroup = db_session.exec(statement).first()
            if docgroup:
                org_id = docgroup.org_id

        # Try docpage_uuid
        if org_id is None and "docpage_uuid" in path_params:
            from src.db.docs.docpages import DocPage
            statement = select(DocPage).where(
                DocPage.docpage_uuid == path_params["docpage_uuid"]
            )
            docpage = db_session.exec(statement).first()
            if docpage:
                org_id = docpage.org_id

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
