"""
Utility functions for API token access control.

This module is separate from auth.py to avoid circular imports.
"""

from typing import Union
from fastapi import HTTPException, status
from src.db.users import AnonymousUser, APITokenUser, PublicUser


def reject_api_token_access(
    current_user: Union[PublicUser, APITokenUser, AnonymousUser]
) -> None:
    """
    Reject access if the current user is an API token.

    Use this function at the start of any endpoint or service function
    that should NOT be accessible via API tokens.

    Args:
        current_user: The authenticated user (could be PublicUser, APITokenUser, or AnonymousUser)

    Raises:
        HTTPException: 403 if current_user is an APITokenUser
    """
    if isinstance(current_user, APITokenUser):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="API tokens cannot access this resource. Only user authentication is allowed.",
        )


async def require_non_api_token_user(
    current_user: Union[PublicUser, APITokenUser, AnonymousUser]
) -> Union[PublicUser, AnonymousUser]:
    """
    FastAPI dependency that rejects API token access.

    Use this in router dependencies to block entire routers from API tokens.
    This is cleaner than calling reject_api_token_access in every endpoint.

    Example:
        from src.security.auth import get_current_user

        router.include_router(
            some_router,
            dependencies=[Depends(lambda user=Depends(get_current_user): require_non_api_token_user(user))]
        )

    Or create a helper in the router file:
        def get_non_api_token_user(user = Depends(get_current_user)):
            return require_non_api_token_user(user)

        router.include_router(
            some_router,
            dependencies=[Depends(get_non_api_token_user)]
        )

    Args:
        current_user: The authenticated user (injected by FastAPI)

    Returns:
        The current user if not an API token

    Raises:
        HTTPException: 403 if current_user is an APITokenUser
    """
    reject_api_token_access(current_user)
    return current_user
