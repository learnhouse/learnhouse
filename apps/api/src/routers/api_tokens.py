from typing import List
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlmodel import Session

from src.core.events.database import get_db_session
from src.db.api_tokens import (
    APITokenCreate,
    APITokenCreatedResponse,
    APITokenRead,
    APITokenUpdate,
)
from src.db.users import PublicUser
from src.security.auth import get_current_user
from src.services.api_tokens.api_tokens import (
    create_api_token,
    get_api_token,
    list_api_tokens,
    regenerate_api_token,
    revoke_api_token,
    update_api_token,
)
from src.services.security.rate_limiting import check_api_token_rate_limit

router = APIRouter()


@router.post(
    "/{org_id}/api-tokens",
    response_model=APITokenCreatedResponse,
    summary="Create API token",
    description=(
        "Create a new API token for an organization. The full token value is only "
        "returned once upon creation — store it securely, as it cannot be retrieved later. "
        "Requires the user to have `roles.action_create` permission in the organization."
    ),
    responses={
        200: {"description": "Token created; the full secret is included in the response (only time it is returned).", "model": APITokenCreatedResponse},
        401: {"description": "Authentication required"},
        429: {"description": "Rate limit exceeded for token creation"},
    },
)
async def api_create_api_token(
    request: Request,
    org_id: int,
    token_data: APITokenCreate,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> APITokenCreatedResponse:
    """
    Create a new API token for an organization.

    **Important**: The full token value is only returned once upon creation.
    Store it securely as it cannot be retrieved later.

    Requires the user to have 'roles.action_create' permission in the organization.
    """
    is_allowed, retry_after = check_api_token_rate_limit(request)
    if not is_allowed:
        raise HTTPException(
            status_code=429,
            detail=f"Too many token creation requests. Try again in {retry_after} seconds.",
            headers={"Retry-After": str(retry_after)},
        )
    return await create_api_token(
        request, db_session, token_data, org_id, current_user
    )


@router.get(
    "/{org_id}/api-tokens",
    response_model=List[APITokenRead],
    summary="List API tokens",
    description=(
        "List all API tokens for an organization. Returns token metadata including the "
        "prefix, but never the full token secret. Requires `roles.action_read` permission."
    ),
    responses={
        200: {"description": "List of API tokens for the organization (metadata only)."},
        401: {"description": "Authentication required"},
    },
)
async def api_list_api_tokens(
    request: Request,
    org_id: int,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> List[APITokenRead]:
    """
    List all API tokens for an organization.

    Returns token metadata including prefix, but never the full token secret.
    Requires the user to have 'roles.action_read' permission in the organization.
    """
    return await list_api_tokens(request, db_session, org_id, current_user)


@router.get(
    "/{org_id}/api-tokens/{token_uuid}",
    response_model=APITokenRead,
    summary="Get API token",
    description=(
        "Get details of a specific API token. Returns token metadata, but never "
        "the full token secret."
    ),
    responses={
        200: {"description": "API token metadata.", "model": APITokenRead},
        401: {"description": "Authentication required"},
    },
)
async def api_get_api_token(
    request: Request,
    org_id: int,
    token_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> APITokenRead:
    """
    Get details of a specific API token.

    Returns token metadata, but never the full token secret.
    """
    return await get_api_token(request, db_session, org_id, token_uuid, current_user)


@router.put(
    "/{org_id}/api-tokens/{token_uuid}",
    response_model=APITokenRead,
    summary="Update API token",
    description=(
        "Update an API token's name, description, rights, or expiration. The token "
        "secret cannot be changed here — use the regenerate endpoint for that. "
        "Requires `roles.action_update` permission."
    ),
    responses={
        200: {"description": "Token metadata updated.", "model": APITokenRead},
        401: {"description": "Authentication required"},
    },
)
async def api_update_api_token(
    request: Request,
    org_id: int,
    token_uuid: str,
    token_data: APITokenUpdate,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> APITokenRead:
    """
    Update an API token's name, description, rights, or expiration.

    Cannot change the token secret - use the regenerate endpoint for that.
    Requires the user to have 'roles.action_update' permission in the organization.
    """
    return await update_api_token(
        request, db_session, org_id, token_uuid, token_data, current_user
    )


@router.delete(
    "/{org_id}/api-tokens/{token_uuid}",
    summary="Revoke API token",
    description=(
        "Revoke an API token. The token will immediately stop working and this action "
        "cannot be undone. Requires `roles.action_delete` permission."
    ),
    responses={
        200: {"description": "Token revoked successfully."},
        401: {"description": "Authentication required"},
    },
)
async def api_revoke_api_token(
    request: Request,
    org_id: int,
    token_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> dict:
    """
    Revoke an API token.

    The token will immediately stop working. This action cannot be undone.
    Requires the user to have 'roles.action_delete' permission in the organization.
    """
    return await revoke_api_token(request, db_session, org_id, token_uuid, current_user)


@router.post(
    "/{org_id}/api-tokens/{token_uuid}/regenerate",
    response_model=APITokenCreatedResponse,
    summary="Regenerate API token secret",
    description=(
        "Regenerate the secret for an API token. The old token will immediately stop "
        "working. The new full token value is only returned once — store it securely. "
        "Requires `roles.action_update` permission."
    ),
    responses={
        200: {"description": "Token secret regenerated; new full secret is returned.", "model": APITokenCreatedResponse},
        401: {"description": "Authentication required"},
        429: {"description": "Rate limit exceeded for token regeneration"},
    },
)
async def api_regenerate_api_token(
    request: Request,
    org_id: int,
    token_uuid: str,
    current_user: PublicUser = Depends(get_current_user),
    db_session: Session = Depends(get_db_session),
) -> APITokenCreatedResponse:
    """
    Regenerate the secret for an API token.

    **Important**: The old token will immediately stop working.
    The new full token value is only returned once. Store it securely.

    Requires the user to have 'roles.action_update' permission in the organization.
    """
    is_allowed, retry_after = check_api_token_rate_limit(request)
    if not is_allowed:
        raise HTTPException(
            status_code=429,
            detail=f"Too many token regeneration requests. Try again in {retry_after} seconds.",
            headers={"Retry-After": str(retry_after)},
        )
    return await regenerate_api_token(
        request, db_session, org_id, token_uuid, current_user
    )
