"""
FastAPI Dependencies for RBAC

This module provides FastAPI dependencies for injecting RBAC checks into routes.
Instead of manually calling RBAC functions in every route, you can use these
dependencies for cleaner, more maintainable code.

Usage:
    @router.get("/{course_uuid}")
    async def get_course(
        course_uuid: str,
        access: AccessDecision = Depends(require_read_access("course")),
    ):
        # Access already verified
        ...
"""

from typing import Callable, Union, TYPE_CHECKING
from fastapi import Depends, HTTPException, Request, status
from sqlmodel import Session

from src.core.events.database import get_db_session
from src.db.users import AnonymousUser, PublicUser, APITokenUser
from src.security.rbac.types import AccessAction, AccessContext, AccessDecision
from src.security.rbac.resource_access import ResourceAccessChecker

# Avoid circular import - get_current_user is imported lazily
if TYPE_CHECKING:
    pass


def _get_current_user_dependency():
    """Lazy import to avoid circular dependency."""
    from src.security.auth import get_current_user
    return get_current_user


def require_resource_access(
    action: AccessAction,
    context: AccessContext = AccessContext.PUBLIC_VIEW,
    require_ownership: bool = False,
    resource_uuid_param: str = "resource_uuid",
) -> Callable:
    """
    Create a dependency that requires specific access to a resource.

    Args:
        action: The action being performed (read, create, update, delete)
        context: The context (public_view or dashboard)
        require_ownership: If True, requires resource ownership for write operations
        resource_uuid_param: Name of the path parameter containing the resource UUID

    Returns:
        A FastAPI dependency function

    Usage:
        @router.get("/{course_uuid}")
        async def get_course(
            course_uuid: str,
            access: AccessDecision = Depends(
                require_resource_access(AccessAction.READ, resource_uuid_param="course_uuid")
            ),
        ):
            pass
    """

    async def dependency(
        request: Request,
        db_session: Session = Depends(get_db_session),
        current_user: Union[PublicUser, AnonymousUser, APITokenUser] = Depends(_get_current_user_dependency()),
    ) -> AccessDecision:
        # Extract resource_uuid from path parameters
        resource_uuid = request.path_params.get(resource_uuid_param)
        if not resource_uuid:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Missing required path parameter: {resource_uuid_param}",
            )

        checker = ResourceAccessChecker(request, db_session, current_user)
        decision = await checker.check_access(resource_uuid, action, context, require_ownership)

        if not decision.allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=decision.reason,
            )

        return decision

    return dependency


def require_read_access(
    resource_uuid_param: str = "resource_uuid",
    context: AccessContext = AccessContext.PUBLIC_VIEW,
) -> Callable:
    """
    Dependency for read access.

    Args:
        resource_uuid_param: Name of the path parameter containing the resource UUID
        context: Access context (public_view or dashboard)

    Usage:
        @router.get("/{podcast_uuid}")
        async def get_podcast(
            podcast_uuid: str,
            access: AccessDecision = Depends(require_read_access("podcast_uuid")),
        ):
            pass
    """
    return require_resource_access(
        action=AccessAction.READ,
        context=context,
        resource_uuid_param=resource_uuid_param,
    )


def require_write_access(
    action: AccessAction = AccessAction.UPDATE,
    resource_uuid_param: str = "resource_uuid",
    require_ownership: bool = True,
) -> Callable:
    """
    Dependency for write access (create, update, delete).

    Args:
        action: The write action (UPDATE or DELETE)
        resource_uuid_param: Name of the path parameter containing the resource UUID
        require_ownership: If True, requires resource ownership

    Usage:
        @router.put("/{course_uuid}")
        async def update_course(
            course_uuid: str,
            access: AccessDecision = Depends(
                require_write_access(AccessAction.UPDATE, "course_uuid")
            ),
        ):
            pass
    """
    return require_resource_access(
        action=action,
        context=AccessContext.DASHBOARD,
        require_ownership=require_ownership,
        resource_uuid_param=resource_uuid_param,
    )


def require_create_access(
    resource_type: str,
) -> Callable:
    """
    Dependency for create access.

    Args:
        resource_type: The type of resource being created (courses, podcasts, communities)

    Usage:
        @router.post("/")
        async def create_course(
            access: AccessDecision = Depends(require_create_access("courses")),
        ):
            pass
    """

    async def dependency(
        request: Request,
        db_session: Session = Depends(get_db_session),
        current_user: Union[PublicUser, AnonymousUser, APITokenUser] = Depends(_get_current_user_dependency()),
    ) -> AccessDecision:
        # Use placeholder UUID for creation
        resource_uuid = f"{resource_type[:-1]}_x"  # e.g., "course_x"

        checker = ResourceAccessChecker(request, db_session, current_user)
        decision = await checker.check_access(
            resource_uuid,
            AccessAction.CREATE,
            AccessContext.DASHBOARD,
        )

        if not decision.allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=decision.reason,
            )

        return decision

    return dependency


def require_dashboard_access(
    resource_uuid_param: str = "resource_uuid",
    action: AccessAction = AccessAction.READ,
) -> Callable:
    """
    Dependency for dashboard access (admins/authors see everything).

    Args:
        resource_uuid_param: Name of the path parameter containing the resource UUID
        action: The action being performed

    Usage:
        @router.get("/dashboard/{course_uuid}")
        async def dashboard_get_course(
            course_uuid: str,
            access: AccessDecision = Depends(require_dashboard_access("course_uuid")),
        ):
            pass
    """
    return require_resource_access(
        action=action,
        context=AccessContext.DASHBOARD,
        resource_uuid_param=resource_uuid_param,
    )


# Pre-configured dependencies for common use cases

class CourseAccess:
    """Pre-configured dependencies for course access."""

    @staticmethod
    def read(context: AccessContext = AccessContext.PUBLIC_VIEW):
        return require_read_access("course_uuid", context)

    @staticmethod
    def create():
        return require_create_access("courses")

    @staticmethod
    def update():
        return require_write_access(AccessAction.UPDATE, "course_uuid")

    @staticmethod
    def delete():
        return require_write_access(AccessAction.DELETE, "course_uuid")

    @staticmethod
    def dashboard():
        return require_dashboard_access("course_uuid")


class PodcastAccess:
    """Pre-configured dependencies for podcast access."""

    @staticmethod
    def read(context: AccessContext = AccessContext.PUBLIC_VIEW):
        return require_read_access("podcast_uuid", context)

    @staticmethod
    def create():
        return require_create_access("podcasts")

    @staticmethod
    def update():
        return require_write_access(AccessAction.UPDATE, "podcast_uuid")

    @staticmethod
    def delete():
        return require_write_access(AccessAction.DELETE, "podcast_uuid")

    @staticmethod
    def dashboard():
        return require_dashboard_access("podcast_uuid")


class CommunityAccess:
    """Pre-configured dependencies for community access."""

    @staticmethod
    def read(context: AccessContext = AccessContext.PUBLIC_VIEW):
        return require_read_access("community_uuid", context)

    @staticmethod
    def create():
        return require_create_access("communities")

    @staticmethod
    def update():
        return require_write_access(AccessAction.UPDATE, "community_uuid")

    @staticmethod
    def delete():
        return require_write_access(AccessAction.DELETE, "community_uuid")

    @staticmethod
    def dashboard():
        return require_dashboard_access("community_uuid")
