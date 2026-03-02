"""
SSO (Single Sign-On) API endpoints.

Provides endpoints for SSO configuration (admin) and authentication (public).
"""

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlmodel import Session, select
from pydantic import BaseModel

from src.core.events.database import get_db_session
from src.db.users import PublicUser, UserRead
from src.db.organizations import Organization
from src.db.organization_config import OrganizationConfig, OrganizationConfigBase
from src.security.auth import (
    get_current_user,
    create_access_token,
    create_refresh_token,
    JWT_ACCESS_TOKEN_EXPIRES,
)
from src.services.orgs.orgs import rbac_check

from ee.db.sso import (
    SSOConnectionCreate,
    SSOConnectionUpdate,
    SSOConnectionRead,
    SSOAuthorizationResponse,
    SSOProviderInfo,
    SSOLoginCheckResponse,
)
from ee.services.sso import (
    get_sso_connection,
    create_sso_connection,
    update_sso_connection,
    delete_sso_connection,
    initiate_sso_login,
    handle_sso_callback,
    get_provider_setup_url,
    check_sso_enabled,
    get_available_providers,
)


router = APIRouter()


# ============================================================================
# Helper functions
# ============================================================================

async def verify_org_admin_and_enterprise_plan(
    org_id: int,
    request: Request,
    current_user: PublicUser,
    session: Session
):
    """
    Verify user has admin access and organization has enterprise plan.

    Args:
        org_id: Organization ID
        request: FastAPI request
        current_user: Current authenticated user
        session: Database session

    Raises:
        HTTPException: If access denied or wrong plan
    """
    # Get organization to get uuid
    org = session.get(Organization, org_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    # Check plan
    statement = select(OrganizationConfig).where(OrganizationConfig.org_id == org.id)
    org_config = session.exec(statement).first()

    if not org_config:
        raise HTTPException(status_code=403, detail="Organization configuration not found")

    from src.core.deployment_mode import get_deployment_mode
    if get_deployment_mode() != 'ee':
        config = OrganizationConfigBase(**org_config.config)
        if config.cloud.plan != "enterprise":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="SSO is only available on the Enterprise plan"
            )

    # RBAC check for admin status
    await rbac_check(request, org.org_uuid, current_user, "update", session)


def get_token_expiry_ms() -> Optional[int]:
    """Get the token expiry timestamp in milliseconds for frontend use."""
    from datetime import datetime, timezone
    from src.services.dev.dev import isDevModeEnabled

    if isDevModeEnabled() or JWT_ACCESS_TOKEN_EXPIRES is None:
        return None
    expiry_time = datetime.now(timezone.utc) + JWT_ACCESS_TOKEN_EXPIRES
    return int(expiry_time.timestamp() * 1000)


def set_auth_cookies(response: Response, access_token: str, refresh_token: str):
    """Helper to set authentication cookies."""
    from datetime import timedelta
    from config.config import get_learnhouse_config

    cookie_domain = get_learnhouse_config().hosting_config.cookie_config.domain

    response.set_cookie(
        key="access_token_cookie",
        value=access_token,
        httponly=True,
        domain=cookie_domain,
        expires=int(timedelta(hours=8).total_seconds()),
    )
    response.set_cookie(
        key="refresh_token_cookie",
        value=refresh_token,
        httponly=True,
        domain=cookie_domain,
        expires=int(timedelta(days=30).total_seconds()),
    )


def _get_idp_error_message(error_code: str) -> str:
    """
    Get human-readable message for common IdP error codes.

    These are standard OAuth 2.0 / OIDC error codes.
    """
    error_messages = {
        # OAuth 2.0 standard errors
        "access_denied": "Access was denied. You may have declined the login request or don't have permission to access this application.",
        "invalid_request": "The authentication request was invalid. Please try again.",
        "unauthorized_client": "This application is not authorized to request authentication.",
        "unsupported_response_type": "The authentication method is not supported.",
        "invalid_scope": "The requested permissions are invalid.",
        "server_error": "The identity provider encountered an internal error. Please try again later.",
        "temporarily_unavailable": "The identity provider is temporarily unavailable. Please try again later.",

        # OIDC specific errors
        "interaction_required": "User interaction is required. Please try logging in again.",
        "login_required": "You need to log in to your identity provider first.",
        "account_selection_required": "Please select an account to continue.",
        "consent_required": "You need to grant consent to access this application.",
        "invalid_request_uri": "The authentication request URI is invalid.",
        "invalid_request_object": "The authentication request object is invalid.",
        "request_not_supported": "The authentication request method is not supported.",
        "request_uri_not_supported": "Request URI parameter is not supported.",
        "registration_not_supported": "Dynamic registration is not supported.",

        # Azure AD specific
        "invalid_grant": "The authorization code has expired or is invalid. Please try again.",
        "invalid_client": "Client authentication failed. Please contact your administrator.",

        # Okta specific
        "user_canceled": "You canceled the login process.",

        # Generic
        "unknown_error": "An unknown error occurred during authentication.",
    }

    return error_messages.get(error_code, f"Authentication error: {error_code}")


# ============================================================================
# Admin endpoints (require enterprise plan + admin role)
# ============================================================================

@router.get("/providers", response_model=list[SSOProviderInfo])
async def list_sso_providers(
    *,
    request: Request,
    org_id: int,
    current_user: PublicUser = Depends(get_current_user),
    session: Session = Depends(get_db_session),
):
    """
    List available SSO providers.

    Returns list of all supported SSO providers with their configuration details.
    """
    await verify_org_admin_and_enterprise_plan(org_id, request, current_user, session)
    return get_available_providers()


@router.get("/{org_id}/config", response_model=Optional[SSOConnectionRead])
async def get_sso_config(
    *,
    request: Request,
    org_id: int,
    current_user: PublicUser = Depends(get_current_user),
    session: Session = Depends(get_db_session),
):
    """
    Get SSO configuration for an organization.

    Returns the current SSO configuration or null if not configured.
    """
    await verify_org_admin_and_enterprise_plan(org_id, request, current_user, session)

    connection = await get_sso_connection(org_id, session)
    if not connection:
        return None

    return SSOConnectionRead.model_validate(connection)


@router.post("/{org_id}/config", response_model=SSOConnectionRead)
async def create_sso_config(
    *,
    request: Request,
    org_id: int,
    data: SSOConnectionCreate,
    current_user: PublicUser = Depends(get_current_user),
    session: Session = Depends(get_db_session),
):
    """
    Create SSO configuration for an organization.

    Sets up SSO with the specified provider and configuration.
    """
    await verify_org_admin_and_enterprise_plan(org_id, request, current_user, session)

    connection = await create_sso_connection(org_id, data, session)
    return SSOConnectionRead.model_validate(connection)


@router.put("/{org_id}/config", response_model=SSOConnectionRead)
async def update_sso_config(
    *,
    request: Request,
    org_id: int,
    data: SSOConnectionUpdate,
    current_user: PublicUser = Depends(get_current_user),
    session: Session = Depends(get_db_session),
):
    """
    Update SSO configuration for an organization.

    Modifies existing SSO settings.
    """
    await verify_org_admin_and_enterprise_plan(org_id, request, current_user, session)

    connection = await update_sso_connection(org_id, data, session)
    return SSOConnectionRead.model_validate(connection)


@router.delete("/{org_id}/config")
async def delete_sso_config(
    *,
    request: Request,
    org_id: int,
    current_user: PublicUser = Depends(get_current_user),
    session: Session = Depends(get_db_session),
):
    """
    Delete SSO configuration for an organization.

    Disables SSO for the organization.
    """
    await verify_org_admin_and_enterprise_plan(org_id, request, current_user, session)

    deleted = await delete_sso_connection(org_id, session)
    if not deleted:
        raise HTTPException(
            status_code=404,
            detail="SSO configuration not found"
        )

    return {"message": "SSO configuration deleted successfully"}


@router.get("/{org_id}/setup-url")
async def get_setup_url(
    *,
    request: Request,
    org_id: int,
    return_url: str = Query(..., description="URL to return to after setup"),
    current_user: PublicUser = Depends(get_current_user),
    session: Session = Depends(get_db_session),
):
    """
    Get provider setup URL (if supported).

    Returns the admin portal URL for configuring the identity provider.
    Only available for providers that support this feature (e.g., WorkOS).
    """
    await verify_org_admin_and_enterprise_plan(org_id, request, current_user, session)

    setup_url = await get_provider_setup_url(org_id, return_url, session)
    if not setup_url:
        raise HTTPException(
            status_code=400,
            detail="Setup URL is not available. Please configure SSO first or provider does not support setup portal."
        )

    return {"setup_url": setup_url}


# ============================================================================
# Public authentication endpoints
# ============================================================================

@router.get("/check", response_model=SSOLoginCheckResponse)
async def check_sso(
    *,
    org_slug: str = Query(..., description="Organization slug"),
    session: Session = Depends(get_db_session),
):
    """
    Check if SSO is enabled for an organization.

    Public endpoint used by login page to determine if SSO button should be shown.
    """
    result = await check_sso_enabled(org_slug, session)
    return SSOLoginCheckResponse(**result)


@router.get("/authorize", response_model=SSOAuthorizationResponse)
async def authorize_sso(
    *,
    org_slug: str = Query(..., description="Organization slug"),
    session: Session = Depends(get_db_session),
):
    """
    Initiate SSO login flow.

    Returns authorization URL to redirect user to identity provider.
    """
    return await initiate_sso_login(org_slug, session)


class SSOCallbackResponse(BaseModel):
    """Response for SSO callback."""
    user: UserRead
    tokens: dict
    redirect_url: str


class SSOErrorResponse(BaseModel):
    """Response for SSO errors."""
    error: str
    error_code: str
    error_description: str
    provider: Optional[str] = None
    details: Optional[dict] = None


@router.get("/callback")
async def sso_callback(
    *,
    response: Response,
    code: Optional[str] = Query(None, description="Authorization code from IdP"),
    state: Optional[str] = Query(None, description="State parameter for CSRF verification"),
    error: Optional[str] = Query(None, description="Error code from IdP"),
    error_description: Optional[str] = Query(None, description="Error description from IdP"),
    session: Session = Depends(get_db_session),
):
    """
    Handle SSO callback from identity provider.

    Exchanges authorization code for user profile, creates/finds user,
    and returns authentication tokens.

    Also handles error responses from IdP (e.g., user denied consent).
    """
    # Handle IdP error response
    if error:
        error_msg = error_description or _get_idp_error_message(error)
        raise HTTPException(
            status_code=400,
            detail={
                "error": "idp_error",
                "error_code": error,
                "error_description": error_msg,
                "message": f"Identity provider error: {error_msg}"
            }
        )

    # Validate required parameters
    if not code or not state:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "missing_parameters",
                "error_code": "missing_params",
                "error_description": "Missing required parameters: code and state",
                "message": "SSO callback is missing required parameters. Please try logging in again."
            }
        )

    try:
        result = await handle_sso_callback(code, state, session)
    except HTTPException as e:
        # Re-raise with structured error format
        detail = e.detail if isinstance(e.detail, dict) else {"message": e.detail}
        if "error" not in detail:
            detail["error"] = "sso_error"
            detail["error_code"] = "callback_failed"
            detail["error_description"] = str(e.detail)
        raise HTTPException(status_code=e.status_code, detail=detail)

    user = result["user"]
    org_slug = result["org_slug"]

    # Create tokens
    access_token = create_access_token(
        data={"sub": user.email},
        expires_delta=JWT_ACCESS_TOKEN_EXPIRES
    )
    refresh_token = create_refresh_token(data={"sub": user.email})

    # Set cookies
    set_auth_cookies(response, access_token, refresh_token)

    # Build redirect URL
    # In production, this should come from frontend config
    from config.config import get_learnhouse_config
    config = get_learnhouse_config()
    frontend_domain = config.hosting_config.domain
    protocol = "https" if config.hosting_config.ssl else "http"

    redirect_url = f"{protocol}://{org_slug}.{frontend_domain}/redirect_from_auth"

    # Set cookies
    set_auth_cookies(response, access_token, refresh_token)

    return {
        "user": user,
        "tokens": {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "expiry": get_token_expiry_ms(),
        },
        "redirect_url": redirect_url,
        "org_slug": org_slug,
    }
