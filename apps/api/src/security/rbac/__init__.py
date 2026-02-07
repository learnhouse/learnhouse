"""
RBAC (Role-Based Access Control) Module

This module provides a unified access control system for courses, podcasts, and communities.

Usage:
    from src.security.rbac import (
        ResourceAccessChecker,
        AccessAction,
        AccessContext,
        AccessDecision,
        check_resource_access,
    )

    # Using the checker class
    checker = ResourceAccessChecker(request, db_session, current_user)
    decision = await checker.check_access(course_uuid, AccessAction.READ)

    # Using the convenience function (raises HTTPException on denial)
    await check_resource_access(
        request, db_session, current_user, course_uuid, AccessAction.READ
    )

FastAPI Dependencies:
    from src.security.rbac import require_read_access, require_write_access

    @router.get("/{course_uuid}")
    async def get_course(
        course_uuid: str,
        access: AccessDecision = Depends(require_read_access("course_uuid")),
    ):
        pass
"""

# New unified RBAC system - Types
from src.security.rbac.types import (
    AccessAction,
    AccessContext,
    AccessDecision,
    ResourceConfig,
)

# New unified RBAC system - Config
from src.security.rbac.config import (
    RESOURCE_CONFIGS,
    get_resource_config,
    get_resource_type,
)

# New unified RBAC system - Checker
from src.security.rbac.resource_access import (
    ResourceAccessChecker,
    check_resource_access,
)

# New unified RBAC system - FastAPI Dependencies
from src.security.rbac.dependencies import (
    require_resource_access,
    require_read_access,
    require_write_access,
    require_create_access,
    require_dashboard_access,
    CourseAccess,
    PodcastAccess,
    CommunityAccess,
)

# Low-level RBAC functions (used internally, can be used directly if needed)
from src.security.rbac.rbac import (
    check_usergroup_access,
    authorization_verify_if_element_is_public,
    authorization_verify_if_user_is_author,
    authorization_verify_based_on_roles,
    authorization_verify_based_on_org_admin_status,
    authorization_verify_based_on_roles_and_authorship,
    authorization_verify_if_user_is_anon,
    authorization_verify_api_token_permissions,
)

# Utils
from src.security.rbac.utils import (
    check_element_type,
    get_element_organization_id,
)

# Constants
from src.security.rbac.constants import (
    ADMIN_ROLE_ID,
    MAINTAINER_ROLE_ID,
    ADMIN_ROLE_IDS,
    ADMIN_OR_MAINTAINER_ROLE_IDS,
    is_admin,
    is_admin_or_maintainer,
    has_elevated_privileges,
)

__all__ = [
    # Types
    "AccessAction",
    "AccessContext",
    "AccessDecision",
    "ResourceConfig",
    # Config
    "RESOURCE_CONFIGS",
    "get_resource_config",
    "get_resource_type",
    # Checker
    "ResourceAccessChecker",
    "check_resource_access",
    # FastAPI Dependencies
    "require_resource_access",
    "require_read_access",
    "require_write_access",
    "require_create_access",
    "require_dashboard_access",
    "CourseAccess",
    "PodcastAccess",
    "CommunityAccess",
    # Low-level functions
    "check_usergroup_access",
    "authorization_verify_if_element_is_public",
    "authorization_verify_if_user_is_author",
    "authorization_verify_based_on_roles",
    "authorization_verify_based_on_org_admin_status",
    "authorization_verify_based_on_roles_and_authorship",
    "authorization_verify_if_user_is_anon",
    "authorization_verify_api_token_permissions",
    # Utils
    "check_element_type",
    "get_element_organization_id",
    # Constants
    "ADMIN_ROLE_ID",
    "MAINTAINER_ROLE_ID",
    "ADMIN_ROLE_IDS",
    "ADMIN_OR_MAINTAINER_ROLE_IDS",
    "is_admin",
    "is_admin_or_maintainer",
    "has_elevated_privileges",
]
