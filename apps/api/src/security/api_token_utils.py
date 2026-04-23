"""
Utility functions for API token access control.

This module is separate from auth.py to avoid circular imports.
"""

from typing import Union
from fastapi import Depends, HTTPException, Request, status
from sqlmodel import Session

from src.core.events.database import get_db_session
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


async def get_authenticated_non_api_token_user(
    request: Request,
    db_session: Session = Depends(get_db_session),
) -> PublicUser:
    """
    FastAPI dependency that requires an authenticated, non-API-token user.

    SECURITY: Use this as the router-level dependency on any router that has
    *no* public endpoints. The historical ``get_non_api_token_user`` helper
    only rejects API tokens — it silently admits ``AnonymousUser``. Swapping
    to this dependency closes that gap for routers that should always
    require an active session.

    Raises:
        HTTPException 401 if the request is unauthenticated.
        HTTPException 403 if the caller is an API token.
    """
    # Imported locally to avoid a circular dependency on auth.py, which in
    # turn imports from this module.
    from src.security.auth import get_authenticated_user

    user = await get_authenticated_user(request, db_session)
    if isinstance(user, APITokenUser):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="API tokens cannot access this resource. Only user authentication is allowed.",
        )
    return user
