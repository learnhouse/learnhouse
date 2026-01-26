from typing import List
from fastapi import APIRouter, Depends, Request
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

router = APIRouter()


@router.post("/{org_id}/api-tokens", response_model=APITokenCreatedResponse)
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
    return await create_api_token(
        request, db_session, token_data, org_id, current_user
    )


@router.get("/{org_id}/api-tokens", response_model=List[APITokenRead])
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


@router.get("/{org_id}/api-tokens/{token_uuid}", response_model=APITokenRead)
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


@router.put("/{org_id}/api-tokens/{token_uuid}", response_model=APITokenRead)
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


@router.delete("/{org_id}/api-tokens/{token_uuid}")
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


@router.post("/{org_id}/api-tokens/{token_uuid}/regenerate", response_model=APITokenCreatedResponse)
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
    return await regenerate_api_token(
        request, db_session, org_id, token_uuid, current_user
    )
