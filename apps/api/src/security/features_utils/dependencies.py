"""
FastAPI dependencies for feature flag checks and admin authorization.

These dependencies can be added to routers or individual endpoints
to check if features are enabled before processing requests.
"""
from fastapi import Depends, HTTPException, Path, Request
from sqlmodel import Session, select
from src.core.events.database import get_db_session
from src.db.organization_config import OrganizationConfig
from src.db.organizations import Organization
from src.db.courses.courses import Course
from src.db.user_organizations import UserOrganization
from src.db.users import AnonymousUser, PublicUser
from src.security.auth import get_current_user
from src.security.rbac.constants import ADMIN_ROLE_ID
from typing import Literal

FeatureName = Literal[
    "courses",
    "collections",
    "communities",
    "podcasts",
    "docs",
    "boards",
    "playgrounds",
    "ai",
    "payments",
    "usergroups",
]


# ============================================================================
# Admin authorization dependency
# ============================================================================

async def require_org_admin(
    org_id: int = Path(..., description="Organization ID"),
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> bool:
    """
    Dependency that verifies the current user is an admin (role_id=1)
    for the specified organization.

    Use this at the router level for endpoints that modify org configuration.

    Raises:
        HTTPException 401: If user is anonymous
        HTTPException 403: If user is not an admin for this org
        HTTPException 404: If organization not found
    """
    # Check for anonymous user
    if isinstance(current_user, AnonymousUser):
        raise HTTPException(
            status_code=401,
            detail="Authentication required to perform this action",
        )

    # Verify organization exists
    statement = select(Organization).where(Organization.id == org_id)
    org = db_session.exec(statement).first()

    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    # Superadmin bypass
    from src.security.superadmin import is_user_superadmin
    if is_user_superadmin(current_user.id, db_session):
        return True

    # Check if user is admin in this organization
    statement = (
        select(UserOrganization)
        .where(UserOrganization.user_id == current_user.id)
        .where(UserOrganization.org_id == org_id)
        .where(UserOrganization.role_id == ADMIN_ROLE_ID)
    )

    user_org = db_session.exec(statement).first()

    if not user_org:
        raise HTTPException(
            status_code=403,
            detail="Only organization admins can enable or disable features",
        )

    return True


def _check_feature_enabled(
    feature: FeatureName,
    org_id: int,
    db_session: Session,
) -> bool:
    """
    Internal helper to check if a feature is enabled for an organization.
    Uses resolve_feature() for unified 4-layer resolution.

    Returns:
        True if enabled

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
            detail=f"{feature.capitalize()} feature is not enabled for this organization",
        )

    return True


# ============================================================================
# Dependencies for endpoints with org_id as path/query parameter
# ============================================================================

def require_courses_feature_by_org_id(
    org_id: int,
    db_session: Session = Depends(get_db_session),
) -> bool:
    """
    Dependency that checks if courses feature is enabled.
    Use for endpoints that have org_id as a direct parameter.
    """
    return _check_feature_enabled("courses", org_id, db_session)


# ============================================================================
# Dependencies for endpoints with org_slug as path parameter
# ============================================================================

def require_courses_feature_by_org_slug(
    org_slug: str = Path(...),
    db_session: Session = Depends(get_db_session),
) -> bool:
    """
    Dependency that checks if courses feature is enabled.
    Use for endpoints that have org_slug as a path parameter.
    """
    statement = select(Organization).where(Organization.slug == org_slug)
    org = db_session.exec(statement).first()

    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    return _check_feature_enabled("courses", org.id, db_session)


# ============================================================================
# Dependencies for endpoints with course_uuid as path parameter
# ============================================================================

def require_courses_feature_by_course_uuid(
    course_uuid: str = Path(...),
    db_session: Session = Depends(get_db_session),
) -> bool:
    """
    Dependency that checks if courses feature is enabled.
    Use for endpoints that have course_uuid as a path parameter.
    """
    statement = select(Course).where(Course.course_uuid == course_uuid)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    return _check_feature_enabled("courses", course.org_id, db_session)


# ============================================================================
# Dependencies for endpoints with activity_uuid as path parameter
# ============================================================================

def require_courses_feature_by_activity_uuid(
    activity_uuid: str = Path(...),
    db_session: Session = Depends(get_db_session),
) -> bool:
    """
    Dependency that checks if courses feature is enabled.
    Use for endpoints that have activity_uuid as a path parameter.
    """
    from src.db.courses.activities import Activity

    statement = select(Activity).where(Activity.activity_uuid == activity_uuid)
    activity = db_session.exec(statement).first()

    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")

    statement = select(Course).where(Course.id == activity.course_id)
    course = db_session.exec(statement).first()

    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    return _check_feature_enabled("courses", course.org_id, db_session)


# ============================================================================
# Router-level dependencies (auto-detect parameter type)
# ============================================================================

async def require_courses_feature(
    request: Request,
    db_session: Session = Depends(get_db_session),
) -> bool:
    """
    Router-level dependency that auto-detects the parameter type and checks
    if the courses feature is enabled.

    Checks in order: course_uuid, activity_uuid, org_slug, org_id
    If none found, allows the request (for endpoints that don't need the check).
    """
    path_params = request.path_params

    # Try course_uuid first
    if "course_uuid" in path_params:
        course_uuid = path_params["course_uuid"]
        statement = select(Course).where(Course.course_uuid == course_uuid)
        course = db_session.exec(statement).first()
        if not course:
            raise HTTPException(status_code=404, detail="Course not found")
        return _check_feature_enabled("courses", course.org_id, db_session)

    # Try activity_uuid
    if "activity_uuid" in path_params:
        from src.db.courses.activities import Activity
        activity_uuid = path_params["activity_uuid"]
        statement = select(Activity).where(Activity.activity_uuid == activity_uuid)
        activity = db_session.exec(statement).first()
        if not activity:
            raise HTTPException(status_code=404, detail="Activity not found")
        statement = select(Course).where(Course.id == activity.course_id)
        course = db_session.exec(statement).first()
        if not course:
            raise HTTPException(status_code=404, detail="Course not found")
        return _check_feature_enabled("courses", course.org_id, db_session)

    # Try org_slug
    if "org_slug" in path_params:
        org_slug = path_params["org_slug"]
        statement = select(Organization).where(Organization.slug == org_slug)
        org = db_session.exec(statement).first()
        if not org:
            raise HTTPException(status_code=404, detail="Organization not found")
        return _check_feature_enabled("courses", org.id, db_session)

    # Try org_id
    if "org_id" in path_params:
        try:
            org_id = int(path_params["org_id"])
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail="Invalid org_id format")
        return _check_feature_enabled("courses", org_id, db_session)

    # No relevant parameter found, allow the request
    # (for endpoints that don't need the feature check)
    return True


async def require_docs_feature(
    request: Request,
    db_session: Session = Depends(get_db_session),
) -> bool:
    """
    Router-level dependency that auto-detects the parameter type and checks
    if the docs feature is enabled.

    Checks in order: docspace_uuid, docsection_uuid, docgroup_uuid, docpage_uuid, org_slug, org_id
    """
    path_params = request.path_params

    if "docspace_uuid" in path_params:
        from src.db.docs.docspaces import DocSpace
        docspace_uuid = path_params["docspace_uuid"]
        statement = select(DocSpace).where(DocSpace.docspace_uuid == docspace_uuid)
        docspace = db_session.exec(statement).first()
        if not docspace:
            raise HTTPException(status_code=404, detail="DocSpace not found")
        return _check_feature_enabled("docs", docspace.org_id, db_session)

    if "docsection_uuid" in path_params:
        from src.db.docs.docsections import DocSection
        docsection_uuid = path_params["docsection_uuid"]
        statement = select(DocSection).where(DocSection.docsection_uuid == docsection_uuid)
        docsection = db_session.exec(statement).first()
        if not docsection:
            raise HTTPException(status_code=404, detail="DocSection not found")
        return _check_feature_enabled("docs", docsection.org_id, db_session)

    if "docgroup_uuid" in path_params:
        from src.db.docs.docgroups import DocGroup
        docgroup_uuid = path_params["docgroup_uuid"]
        statement = select(DocGroup).where(DocGroup.docgroup_uuid == docgroup_uuid)
        docgroup = db_session.exec(statement).first()
        if not docgroup:
            raise HTTPException(status_code=404, detail="DocGroup not found")
        return _check_feature_enabled("docs", docgroup.org_id, db_session)

    if "docpage_uuid" in path_params:
        from src.db.docs.docpages import DocPage
        docpage_uuid = path_params["docpage_uuid"]
        statement = select(DocPage).where(DocPage.docpage_uuid == docpage_uuid)
        docpage = db_session.exec(statement).first()
        if not docpage:
            raise HTTPException(status_code=404, detail="DocPage not found")
        return _check_feature_enabled("docs", docpage.org_id, db_session)

    if "org_slug" in path_params:
        org_slug = path_params["org_slug"]
        statement = select(Organization).where(Organization.slug == org_slug)
        org = db_session.exec(statement).first()
        if not org:
            raise HTTPException(status_code=404, detail="Organization not found")
        return _check_feature_enabled("docs", org.id, db_session)

    if "org_id" in path_params:
        try:
            org_id = int(path_params["org_id"])
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail="Invalid org_id format")
        return _check_feature_enabled("docs", org_id, db_session)

    return True


async def require_boards_feature(
    request: Request,
    db_session: Session = Depends(get_db_session),
) -> bool:
    """
    Router-level dependency that auto-detects the parameter type and checks
    if the boards feature is enabled AND the org plan is Pro or higher.

    Checks in order: board_uuid (path), org_id (path), org_id (query)
    """
    from src.security.features_utils.plan_check import get_org_plan
    from src.security.features_utils.plans import plan_meets_requirement

    path_params = request.path_params
    org_id = None

    if "board_uuid" in path_params:
        from src.db.boards import Board
        board_uuid = path_params["board_uuid"]
        statement = select(Board).where(Board.board_uuid == board_uuid)
        board = db_session.exec(statement).first()
        if not board:
            raise HTTPException(status_code=404, detail="Board not found")
        org_id = board.org_id

    if org_id is None and "org_id" in path_params:
        try:
            org_id = int(path_params["org_id"])
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail="Invalid org_id format")

    if org_id is None:
        org_id_query = request.query_params.get("org_id")
        if org_id_query is not None:
            try:
                org_id = int(org_id_query)
            except (ValueError, TypeError):
                pass

    if org_id is None:
        return True

    # Check feature flag
    _check_feature_enabled("boards", org_id, db_session)

    # Check plan (Pro+ or OSS)
    current_plan = get_org_plan(org_id, db_session)
    if not plan_meets_requirement(current_plan, "pro"):
        raise HTTPException(
            status_code=403,
            detail="Boards requires a Pro plan or higher. "
            f"Your organization is currently on the {current_plan.capitalize()} plan.",
        )

    return True


async def require_playgrounds_feature(
    request: Request,
    db_session: Session = Depends(get_db_session),
) -> bool:
    """
    Router-level dependency that auto-detects the parameter type and checks
    if the playgrounds feature is enabled AND the org plan is Pro or higher.

    Checks in order: playground_uuid (path), org_id (path), org_id (query)
    """
    from src.security.features_utils.plan_check import get_org_plan
    from src.security.features_utils.plans import plan_meets_requirement

    path_params = request.path_params
    org_id = None

    if "playground_uuid" in path_params:
        from src.db.playgrounds import Playground
        playground_uuid = path_params["playground_uuid"]
        statement = select(Playground).where(Playground.playground_uuid == playground_uuid)
        playground = db_session.exec(statement).first()
        if playground:
            org_id = playground.org_id

    if org_id is None and "org_id" in path_params:
        try:
            org_id = int(path_params["org_id"])
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail="Invalid org_id format")

    if org_id is None:
        org_id_query = request.query_params.get("org_id")
        if org_id_query is not None:
            try:
                org_id = int(org_id_query)
            except (ValueError, TypeError):
                pass

    if org_id is None:
        return True

    # Check feature flag
    _check_feature_enabled("playgrounds", org_id, db_session)

    # Check plan (Pro+ or non-SaaS mode)
    from src.core.deployment_mode import get_deployment_mode
    if get_deployment_mode() != 'saas':
        return True

    current_plan = get_org_plan(org_id, db_session)
    if not plan_meets_requirement(current_plan, "pro"):
        raise HTTPException(
            status_code=403,
            detail="Playgrounds requires a Pro plan or higher. "
            f"Your organization is currently on the {current_plan.capitalize()} plan.",
        )

    return True
