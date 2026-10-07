"""
FastAPI dependencies for plan-based feature restrictions.

Provides dependency functions to enforce plan requirements at the router level.
"""

from fastapi import Depends, HTTPException, Request
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from src.core.deployment_mode import get_deployment_mode, EE_ONLY_FEATURES
from src.core.events.database import get_db_session
from src.db.organization_config import OrganizationConfig
from src.db.communities.communities import Community
from src.security.features_utils.plans import PlanLevel, plan_meets_requirement


def _check_mode_bypass(feature_name: str) -> bool | None:
    """
    Check mode-based bypass for plan dependencies.

    Returns:
        True if access should be granted without plan check
        None if normal plan check should proceed (SaaS mode)

    Raises:
        HTTPException 403 if access is blocked (OSS + EE-only feature)
    """
    mode = get_deployment_mode()
    if mode == 'ee':
        return True
    if mode == 'oss':
        feature_key = feature_name.lower().replace(' ', '_')
        if feature_key in EE_ONLY_FEATURES:
            raise HTTPException(
                status_code=403,
                detail=f"{feature_name} is not available in OSS mode. Enterprise Edition is required.",
            )
        return True
    return None  # SaaS — proceed with plan check


def _client_org_id(request: Request) -> int | None:
    """org_id from the path, else the query string (both client-supplied)."""
    for raw in (
        request.path_params.get("org_id"),
        request.query_params.get("org_id"),
    ):
        if raw is not None:
            try:
                return int(raw)
            except (ValueError, TypeError):
                pass
    return None


def _reconcile_org_id(client_org_id: int | None, resource_org_id: int | None) -> int | None:
    """The resource's own org wins; a mismatching client org_id is rejected
    so a paid org's id can't unlock another org's resource."""
    if resource_org_id is None:
        return client_org_id
    if client_org_id is not None and client_org_id != resource_org_id:
        raise HTTPException(
            status_code=403,
            detail="org_id does not match the requested resource",
        )
    return resource_org_id


async def get_org_plan(org_id: int, db_session: AsyncSession) -> PlanLevel:
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
    org_config = (await db_session.execute(statement)).scalars().first()

    if org_config is None:
        raise HTTPException(
            status_code=404,
            detail="Organization configuration not found",
        )

    # Support both v1 (cloud.plan) and v2 (plan) config formats
    config = org_config.config or {}
    version = config.get("config_version", "1.0")
    if version.startswith("2"):
        return config.get("plan", "free")
    return config.get("cloud", {}).get("plan", "free")


async def check_org_plan(
    org_id: int,
    required_plan: PlanLevel,
    feature_name: str,
    db_session: AsyncSession,
) -> bool:
    """Service-level equivalent of the router plan dependencies, for routes
    whose target org only appears in the request body."""
    bypass = _check_mode_bypass(feature_name)
    if bypass is not None:
        return bypass

    current_plan = await get_org_plan(org_id, db_session)
    if not plan_meets_requirement(current_plan, required_plan):
        raise HTTPException(
            status_code=403,
            detail=f"{feature_name} requires a {required_plan.capitalize()} plan or higher. "
            f"Your organization is currently on the {current_plan.capitalize()} plan.",
        )
    return True


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
        db_session: AsyncSession = Depends(get_db_session),
    ):
        bypass = _check_mode_bypass(feature_name)
        if bypass is not None:
            return bypass

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

        current_plan = await get_org_plan(org_id, db_session)

        if not plan_meets_requirement(current_plan, required_plan):
            raise HTTPException(
                status_code=403,
                detail=f"{feature_name} requires a {required_plan.capitalize()} plan or higher. "
                f"Your organization is currently on the {current_plan.capitalize()} plan.",
            )

        return True

    return plan_dependency


def require_plan_for_usergroups(required_plan: PlanLevel, feature_name: str):
    """
    Factory function that returns a FastAPI dependency to enforce plan requirements
    for usergroup routes. Resolves org_id from usergroup_id, path params, or query params.
    """

    async def plan_dependency(
        request: Request,
        db_session: AsyncSession = Depends(get_db_session),
    ):
        bypass = _check_mode_bypass(feature_name)
        if bypass is not None:
            return bypass

        # Resource-derived org (usergroup_id) wins over client org_id
        resource_org_id = None
        usergroup_id_param = request.path_params.get("usergroup_id")
        if usergroup_id_param:
            from src.db.usergroups import UserGroup
            try:
                usergroup_id = int(usergroup_id_param)
                statement = select(UserGroup).where(UserGroup.id == usergroup_id)
                usergroup = (await db_session.execute(statement)).scalars().first()
                if usergroup:
                    resource_org_id = usergroup.org_id
            except (ValueError, TypeError):
                pass
        org_id = _reconcile_org_id(_client_org_id(request), resource_org_id)

        if org_id is None:
            # Fall through: these specialised wrappers are used on routers
            # whose routes sometimes carry the discriminator in the request
            # body (e.g. playground /start, /iterate) or via uuids that
            # reference org-scoped children (discussions, comments). The
            # handler's own RBAC still enforces tenant isolation; the plan
            # cap is a soft ceiling here, not the last line of defence.
            return True

        current_plan = await get_org_plan(org_id, db_session)

        if not plan_meets_requirement(current_plan, required_plan):
            raise HTTPException(
                status_code=403,
                detail=f"{feature_name} requires a {required_plan.capitalize()} plan or higher. "
                f"Your organization is currently on the {current_plan.capitalize()} plan.",
            )

        return True

    return plan_dependency


def require_plan_for_certifications(required_plan: PlanLevel, feature_name: str):
    """
    Factory function that returns a FastAPI dependency to enforce plan requirements
    for certification routes. Resolves org_id from certification_uuid, course_uuid,
    or user_certification_uuid via their related course's org_id.
    """

    async def plan_dependency(
        request: Request,
        db_session: AsyncSession = Depends(get_db_session),
    ):
        bypass = _check_mode_bypass(feature_name)
        if bypass is not None:
            return bypass

        path_params = request.path_params

        # Resource-derived org wins over client org_id
        resource_org_id = None
        if "certification_uuid" in path_params:
            from src.db.courses.certifications import Certifications
            from src.db.courses.courses import Course
            statement = select(Certifications).where(
                Certifications.certification_uuid == path_params["certification_uuid"]
            )
            cert = (await db_session.execute(statement)).scalars().first()
            if cert:
                course = (await db_session.execute(
                    select(Course).where(Course.id == cert.course_id)
                )).scalars().first()
                if course:
                    resource_org_id = course.org_id

        # Try course_uuid -> org_id
        if resource_org_id is None and "course_uuid" in path_params:
            from src.db.courses.courses import Course
            statement = select(Course).where(
                Course.course_uuid == path_params["course_uuid"]
            )
            course = (await db_session.execute(statement)).scalars().first()
            if course:
                resource_org_id = course.org_id

        # Try user_certification_uuid -> certification -> course -> org_id
        if resource_org_id is None and "user_certification_uuid" in path_params:
            from src.db.courses.certifications import Certifications, CertificateUser
            from src.db.courses.courses import Course
            statement = select(CertificateUser).where(
                CertificateUser.user_certification_uuid == path_params["user_certification_uuid"]
            )
            user_cert = (await db_session.execute(statement)).scalars().first()
            if user_cert:
                cert = (await db_session.execute(
                    select(Certifications).where(Certifications.id == user_cert.certification_id)
                )).scalars().first()
                if cert:
                    course = (await db_session.execute(
                        select(Course).where(Course.id == cert.course_id)
                    )).scalars().first()
                    if course:
                        resource_org_id = course.org_id

        org_id = _reconcile_org_id(_client_org_id(request), resource_org_id)

        if org_id is None:
            # Fall through: these specialised wrappers are used on routers
            # whose routes sometimes carry the discriminator in the request
            # body (e.g. playground /start, /iterate) or via uuids that
            # reference org-scoped children (discussions, comments). The
            # handler's own RBAC still enforces tenant isolation; the plan
            # cap is a soft ceiling here, not the last line of defence.
            return True

        current_plan = await get_org_plan(org_id, db_session)

        if not plan_meets_requirement(current_plan, required_plan):
            raise HTTPException(
                status_code=403,
                detail=f"{feature_name} requires a {required_plan.capitalize()} plan or higher. "
                f"Your organization is currently on the {current_plan.capitalize()} plan.",
            )

        return True

    return plan_dependency


def require_plan_for_boards(required_plan: PlanLevel, feature_name: str):
    """
    Factory function that returns a FastAPI dependency to enforce plan requirements
    for board routes. Resolves org_id from board_uuid, path params, or query params.

    Usage in router:
        dependencies=[Depends(require_plan_for_boards("personal", "Boards"))]
    """

    async def plan_dependency(
        request: Request,
        db_session: AsyncSession = Depends(get_db_session),
    ):
        bypass = _check_mode_bypass(feature_name)
        if bypass is not None:
            return bypass

        # Resource-derived org (board_uuid) wins over client org_id
        resource_org_id = None
        board_uuid = request.path_params.get("board_uuid")
        if board_uuid:
            from src.db.boards import Board
            statement = select(Board).where(Board.board_uuid == board_uuid)
            board = (await db_session.execute(statement)).scalars().first()
            if board:
                resource_org_id = board.org_id
        org_id = _reconcile_org_id(_client_org_id(request), resource_org_id)

        if org_id is None:
            # Fall through: these specialised wrappers are used on routers
            # whose routes sometimes carry the discriminator in the request
            # body (e.g. playground /start, /iterate) or via uuids that
            # reference org-scoped children (discussions, comments). The
            # handler's own RBAC still enforces tenant isolation; the plan
            # cap is a soft ceiling here, not the last line of defence.
            return True

        current_plan = await get_org_plan(org_id, db_session)

        if not plan_meets_requirement(current_plan, required_plan):
            raise HTTPException(
                status_code=403,
                detail=f"{feature_name} requires a {required_plan.capitalize()} plan or higher. "
                f"Your organization is currently on the {current_plan.capitalize()} plan.",
            )

        return True

    return plan_dependency


def require_plan_for_playgrounds(required_plan: PlanLevel, feature_name: str):
    """
    Factory function that returns a FastAPI dependency to enforce plan requirements
    for playground routes. Resolves org_id from playground_uuid, path params, or query params.

    Usage in router:
        dependencies=[Depends(require_plan_for_playgrounds("personal", "Playgrounds"))]
    """

    async def plan_dependency(
        request: Request,
        db_session: AsyncSession = Depends(get_db_session),
    ):
        bypass = _check_mode_bypass(feature_name)
        if bypass is not None:
            return bypass

        # Resource-derived org (playground_uuid) wins over client org_id
        resource_org_id = None
        playground_uuid = request.path_params.get("playground_uuid")
        if playground_uuid:
            from src.db.playgrounds import Playground
            statement = select(Playground).where(Playground.playground_uuid == playground_uuid)
            playground = (await db_session.execute(statement)).scalars().first()
            if playground:
                resource_org_id = playground.org_id
        org_id = _reconcile_org_id(_client_org_id(request), resource_org_id)

        if org_id is None:
            # Fall through: these specialised wrappers are used on routers
            # whose routes sometimes carry the discriminator in the request
            # body (e.g. playground /start, /iterate) or via uuids that
            # reference org-scoped children (discussions, comments). The
            # handler's own RBAC still enforces tenant isolation; the plan
            # cap is a soft ceiling here, not the last line of defence.
            return True

        current_plan = await get_org_plan(org_id, db_session)

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
        db_session: AsyncSession = Depends(get_db_session),
    ):
        bypass = _check_mode_bypass(feature_name)
        if bypass is not None:
            return bypass

        # Resource-derived org (community_uuid) wins over client org_id
        resource_org_id = None
        community_uuid = request.path_params.get("community_uuid")
        if community_uuid:
            statement = select(Community).where(Community.community_uuid == community_uuid)
            community = (await db_session.execute(statement)).scalars().first()
            if community:
                resource_org_id = community.org_id
        org_id = _reconcile_org_id(_client_org_id(request), resource_org_id)

        if org_id is None:
            # Fall through: these specialised wrappers are used on routers
            # whose routes sometimes carry the discriminator in the request
            # body (e.g. playground /start, /iterate) or via uuids that
            # reference org-scoped children (discussions, comments). The
            # handler's own RBAC still enforces tenant isolation; the plan
            # cap is a soft ceiling here, not the last line of defence.
            return True

        current_plan = await get_org_plan(org_id, db_session)

        if not plan_meets_requirement(current_plan, required_plan):
            raise HTTPException(
                status_code=403,
                detail=f"{feature_name} requires a {required_plan.capitalize()} plan or higher. "
                f"Your organization is currently on the {current_plan.capitalize()} plan.",
            )

        return True

    return plan_dependency
