"""
SSO Service - Provider-agnostic SSO functionality.

Handles SSO connection management, login initiation, callback processing,
and user provisioning across different SSO providers.
"""

import os
import random
import secrets
from datetime import datetime
from typing import Optional
from fastapi import HTTPException
from sqlmodel import Session, select

from src.db.users import User, UserRead
from src.db.organizations import Organization
from src.db.user_organizations import UserOrganization
from src.db.roles import Role
from src.db.organization_config import OrganizationConfig
from src.security.features_utils.usage import check_limits_with_usage, increase_feature_usage
from src.security.security import security_hash_password
from src.services.users.emails import send_account_creation_email

from ee.db.sso import (
    SSOConnection,
    SSOConnectionCreate,
    SSOConnectionUpdate,
    SSOAuthorizationResponse,
)
from .providers import (
    get_sso_provider,
    get_available_providers as get_providers,
    is_provider_available,
    SSOUserProfile,
    SSOAuthenticationError,
    SSOConfigurationError,
)


# State storage for SSO flows (in production, use Redis)
_sso_states: dict[str, dict] = {}


async def check_org_has_enterprise_plan(
    org_id: int,
    db_session: Session
) -> bool:
    """
    Check if an organization has the enterprise plan.

    Args:
        org_id: Organization ID
        db_session: Database session

    Returns:
        True if org has enterprise plan, False otherwise
    """
    statement = select(OrganizationConfig).where(OrganizationConfig.org_id == org_id)
    org_config = db_session.exec(statement).first()

    if not org_config:
        return False

    try:
        config_dict = org_config.config or {}
        version = config_dict.get("config_version", "1.0")
        plan = config_dict.get("plan", "free") if version.startswith("2") else config_dict.get("cloud", {}).get("plan", "free")
        return plan == "enterprise"
    except Exception:
        return False


def get_sso_redirect_uri() -> str:
    """Get the SSO callback redirect URI from environment."""
    # If SSO_REDIRECT_URI is set, use it as-is (full URL)
    full_uri = os.getenv("SSO_REDIRECT_URI")
    if full_uri:
        return full_uri

    # Otherwise, build from base
    base_uri = os.getenv(
        "SSO_REDIRECT_URI_BASE",
        os.getenv("LEARNHOUSE_DOMAIN", "http://localhost:4000")
    )
    # Ensure it ends with the callback path
    if not base_uri.endswith("/api/v1/auth/sso/callback"):
        base_uri = f"{base_uri.rstrip('/')}/api/v1/auth/sso/callback"
    return base_uri


async def get_sso_connection(
    org_id: int,
    db_session: Session
) -> Optional[SSOConnection]:
    """
    Get SSO connection configuration for an organization.

    Args:
        org_id: Organization ID
        db_session: Database session

    Returns:
        SSOConnection if exists, None otherwise
    """
    statement = select(SSOConnection).where(SSOConnection.org_id == org_id)
    result = db_session.exec(statement)
    return result.first()


async def get_sso_connection_by_org_slug(
    org_slug: str,
    db_session: Session
) -> Optional[SSOConnection]:
    """
    Get SSO connection configuration by organization slug.

    Args:
        org_slug: Organization slug
        db_session: Database session

    Returns:
        SSOConnection if exists, None otherwise
    """
    # First get the organization
    org_statement = select(Organization).where(Organization.slug == org_slug)
    org = db_session.exec(org_statement).first()

    if not org:
        return None

    return await get_sso_connection(org.id, db_session)


async def create_sso_connection(
    org_id: int,
    data: SSOConnectionCreate,
    db_session: Session
) -> SSOConnection:
    """
    Create a new SSO connection for an organization.

    Args:
        org_id: Organization ID
        data: SSO connection configuration
        db_session: Database session

    Returns:
        Created SSOConnection

    Raises:
        HTTPException: If connection already exists or validation fails
    """
    # Check if connection already exists
    existing = await get_sso_connection(org_id, db_session)
    if existing:
        raise HTTPException(
            status_code=400,
            detail="SSO connection already exists for this organization. Use update instead."
        )

    # Validate provider
    if not is_provider_available(data.provider):
        raise HTTPException(
            status_code=400,
            detail=f"SSO provider '{data.provider}' is not available or not configured."
        )

    # Validate provider config
    try:
        provider = get_sso_provider(data.provider)
        if data.provider_config:
            provider.validate_config(data.provider_config)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Validate default role if provided
    if data.default_role_id:
        role_statement = select(Role).where(
            Role.id == data.default_role_id,
            (Role.org_id == org_id) | (Role.org_id.is_(None))
        )
        role = db_session.exec(role_statement).first()
        if not role:
            raise HTTPException(
                status_code=400,
                detail="Invalid default role ID"
            )

    # Create connection
    connection = SSOConnection(
        org_id=org_id,
        provider=data.provider,
        enabled=data.enabled,
        domains=data.domains or [],
        auto_provision_users=data.auto_provision_users,
        default_role_id=data.default_role_id,
        provider_config=data.provider_config or {},
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )

    db_session.add(connection)
    db_session.commit()
    db_session.refresh(connection)

    return connection


async def update_sso_connection(
    org_id: int,
    data: SSOConnectionUpdate,
    db_session: Session
) -> SSOConnection:
    """
    Update SSO connection configuration.

    Args:
        org_id: Organization ID
        data: Updated configuration
        db_session: Database session

    Returns:
        Updated SSOConnection

    Raises:
        HTTPException: If connection doesn't exist or validation fails
    """
    connection = await get_sso_connection(org_id, db_session)
    if not connection:
        raise HTTPException(
            status_code=404,
            detail="SSO connection not found for this organization"
        )

    # Update fields if provided
    if data.provider is not None:
        if not is_provider_available(data.provider):
            raise HTTPException(
                status_code=400,
                detail=f"SSO provider '{data.provider}' is not available."
            )
        connection.provider = data.provider

    if data.enabled is not None:
        connection.enabled = data.enabled

    if data.domains is not None:
        connection.domains = data.domains

    if data.auto_provision_users is not None:
        connection.auto_provision_users = data.auto_provision_users

    if data.default_role_id is not None:
        # Validate role
        role_statement = select(Role).where(
            Role.id == data.default_role_id,
            (Role.org_id == org_id) | (Role.org_id.is_(None))
        )
        role = db_session.exec(role_statement).first()
        if not role:
            raise HTTPException(status_code=400, detail="Invalid default role ID")
        connection.default_role_id = data.default_role_id

    if data.provider_config is not None:
        # Validate config for current provider
        try:
            provider = get_sso_provider(connection.provider)
            provider.validate_config(data.provider_config)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        connection.provider_config = data.provider_config

    connection.updated_at = datetime.utcnow()

    db_session.add(connection)
    db_session.commit()
    db_session.refresh(connection)

    return connection


async def delete_sso_connection(
    org_id: int,
    db_session: Session
) -> bool:
    """
    Delete SSO connection for an organization.

    Args:
        org_id: Organization ID
        db_session: Database session

    Returns:
        True if deleted, False if not found
    """
    connection = await get_sso_connection(org_id, db_session)
    if not connection:
        return False

    db_session.delete(connection)
    db_session.commit()
    return True


async def check_sso_enabled(
    org_slug: str,
    db_session: Session
) -> dict:
    """
    Check if SSO is enabled for an organization (public endpoint).

    SSO is only available for organizations on the enterprise plan.

    Args:
        org_slug: Organization slug
        db_session: Database session

    Returns:
        Dict with sso_enabled status and provider name
    """
    connection = await get_sso_connection_by_org_slug(org_slug, db_session)

    if not connection or not connection.enabled:
        return {"sso_enabled": False, "provider": None}

    # Check if org has enterprise plan
    if not await check_org_has_enterprise_plan(connection.org_id, db_session):
        return {"sso_enabled": False, "provider": None}

    return {
        "sso_enabled": True,
        "provider": connection.provider
    }


async def initiate_sso_login(
    org_slug: str,
    db_session: Session
) -> SSOAuthorizationResponse:
    """
    Initiate SSO login flow for an organization.

    SSO is only available for organizations on the enterprise plan.

    Args:
        org_slug: Organization slug
        db_session: Database session

    Returns:
        SSOAuthorizationResponse with authorization URL and state

    Raises:
        HTTPException: If SSO is not enabled or configured
    """
    connection = await get_sso_connection_by_org_slug(org_slug, db_session)

    if not connection:
        raise HTTPException(
            status_code=404,
            detail="SSO is not configured for this organization"
        )

    if not connection.enabled:
        raise HTTPException(
            status_code=400,
            detail="SSO is not enabled for this organization"
        )

    # Check if org has enterprise plan
    if not await check_org_has_enterprise_plan(connection.org_id, db_session):
        raise HTTPException(
            status_code=403,
            detail="SSO is only available on the Enterprise plan"
        )

    # Generate state for CSRF protection
    state = secrets.token_urlsafe(32)

    # Store state with org info (in production, use Redis with TTL)
    _sso_states[state] = {
        "org_id": connection.org_id,
        "org_slug": org_slug,
        "provider": connection.provider,
        "created_at": datetime.utcnow().isoformat(),
    }

    # Get provider and generate authorization URL
    provider = get_sso_provider(connection.provider)
    redirect_uri = get_sso_redirect_uri()

    try:
        authorization_url = await provider.get_authorization_url(
            connection_config=connection.provider_config or {},
            redirect_uri=redirect_uri,
            state=state,
        )
    except SSOConfigurationError as e:
        raise HTTPException(status_code=400, detail=e.message)
    except SSOAuthenticationError as e:
        raise HTTPException(status_code=500, detail=e.message)

    return SSOAuthorizationResponse(
        authorization_url=authorization_url,
        state=state
    )


async def handle_sso_callback(
    code: str,
    state: str,
    db_session: Session
) -> dict:
    """
    Handle SSO callback from identity provider.

    Args:
        code: Authorization code from IdP
        state: State parameter for CSRF verification
        db_session: Database session

    Returns:
        Dict with user info and authentication tokens

    Raises:
        HTTPException: If authentication fails
    """
    # Verify state
    state_data = _sso_states.pop(state, None)
    if not state_data:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "invalid_state",
                "error_code": "state_invalid_or_expired",
                "error_description": "The SSO session has expired or is invalid.",
                "message": "Invalid or expired SSO state. Please try logging in again.",
                "provider": None
            }
        )

    org_id = state_data["org_id"]
    provider_type = state_data["provider"]

    # Get SSO connection
    connection = await get_sso_connection(org_id, db_session)
    if not connection or not connection.enabled:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "sso_disabled",
                "error_code": "sso_not_enabled",
                "error_description": "SSO has been disabled for this organization.",
                "message": "SSO is no longer enabled for this organization. Please contact your administrator.",
                "provider": provider_type
            }
        )

    # Get user profile from provider
    provider = get_sso_provider(provider_type)

    # Build connection config with redirect_uri for OIDC providers
    callback_config = dict(connection.provider_config or {})
    callback_config["redirect_uri"] = get_sso_redirect_uri()

    try:
        profile: SSOUserProfile = await provider.handle_callback(
            code=code,
            connection_config=callback_config,
        )
    except SSOAuthenticationError as e:
        raise HTTPException(
            status_code=401,
            detail={
                "error": "authentication_failed",
                "error_code": e.details.get("error", "auth_error") if e.details else "auth_error",
                "error_description": e.message,
                "message": f"SSO authentication failed: {e.message}",
                "provider": e.provider,
                "details": e.details
            }
        )
    except SSOConfigurationError as e:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "configuration_error",
                "error_code": "sso_misconfigured",
                "error_description": e.message,
                "message": f"SSO configuration error: {e.message}",
                "provider": e.provider,
                "field": e.field
            }
        )

    # Verify email domain if domains are configured
    if connection.domains:
        email_domain = profile.email.split("@")[-1].lower()
        allowed_domains = [d.lower() for d in connection.domains]
        if email_domain not in allowed_domains:
            raise HTTPException(
                status_code=403,
                detail={
                    "error": "domain_not_allowed",
                    "error_code": "email_domain_rejected",
                    "error_description": f"The email domain '{email_domain}' is not in the list of allowed domains.",
                    "message": f"Email domain '{email_domain}' is not allowed for SSO login. Allowed domains: {', '.join(allowed_domains)}",
                    "provider": provider_type,
                    "email_domain": email_domain,
                    "allowed_domains": allowed_domains
                }
            )

    # Find or create user
    user = await find_or_create_sso_user(
        profile=profile,
        connection=connection,
        db_session=db_session,
    )

    return {
        "user": UserRead.model_validate(user),
        "org_id": org_id,
        "org_slug": state_data["org_slug"],
    }


async def find_or_create_sso_user(
    profile: SSOUserProfile,
    connection: SSOConnection,
    db_session: Session,
) -> User:
    """
    Find existing user by email or create new user if auto-provisioning is enabled.

    Args:
        profile: User profile from SSO provider
        connection: SSO connection configuration
        db_session: Database session

    Returns:
        User object

    Raises:
        HTTPException: If user doesn't exist and auto-provisioning is disabled
    """
    # Look for existing user by email
    user_statement = select(User).where(User.email == profile.email)
    user = db_session.exec(user_statement).first()

    if user:
        # Check if user is already in the organization
        user_org_statement = select(UserOrganization).where(
            UserOrganization.user_id == user.id,
            UserOrganization.org_id == connection.org_id
        )
        user_org = db_session.exec(user_org_statement).first()

        if not user_org:
            # Add user to organization
            await add_user_to_organization(
                user=user,
                connection=connection,
                db_session=db_session,
            )

        return user

    # User doesn't exist - check auto-provisioning
    if not connection.auto_provision_users:
        raise HTTPException(
            status_code=403,
            detail={
                "error": "user_not_found",
                "error_code": "auto_provision_disabled",
                "error_description": "User account does not exist and automatic user creation is disabled.",
                "message": "Your user account does not exist. Please contact your administrator for access."
            }
        )

    # Check usage limits before creating user
    check_limits_with_usage("members", connection.org_id, db_session)

    # Create new user
    user = await create_sso_user(
        profile=profile,
        connection=connection,
        db_session=db_session,
    )

    return user


async def create_sso_user(
    profile: SSOUserProfile,
    connection: SSOConnection,
    db_session: Session,
) -> User:
    """
    Create a new user from SSO profile.

    Args:
        profile: User profile from SSO provider
        connection: SSO connection configuration
        db_session: Database session

    Returns:
        Created User object
    """
    from uuid import uuid4

    # Generate username from profile
    username_parts = []
    if profile.first_name:
        username_parts.append(profile.first_name)
    if profile.last_name:
        username_parts.append(profile.last_name)

    if not username_parts and profile.email:
        email_prefix = profile.email.split("@")[0]
        if email_prefix:
            username_parts.append(email_prefix)

    if not username_parts:
        username_parts.append("user")

    base_username = "".join(username_parts)

    # Ensure username is unique
    username = base_username + str(random.randint(10, 99))
    while True:
        existing = db_session.exec(
            select(User).where(User.username == username)
        ).first()
        if not existing:
            break
        username = base_username + str(random.randint(100, 9999))

    # Create user object
    user = User(
        email=profile.email,
        username=username,
        first_name=profile.first_name or "",
        last_name=profile.last_name or "",
        avatar_image=profile.avatar_url or "",
        password=security_hash_password(secrets.token_urlsafe(32)),  # Random password
        user_uuid=f"user_{uuid4()}",
        email_verified=True,  # SSO-verified email
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )

    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    # Add to organization
    await add_user_to_organization(
        user=user,
        connection=connection,
        db_session=db_session,
    )

    # Track usage
    increase_feature_usage("members", connection.org_id, db_session)

    # Send welcome email
    try:
        send_account_creation_email(
            user=UserRead.model_validate(user),
            email=user.email,
        )
    except Exception:
        # Don't fail if email sending fails
        pass

    return user


async def add_user_to_organization(
    user: User,
    connection: SSOConnection,
    db_session: Session,
) -> UserOrganization:
    """
    Add user to organization with default SSO role.

    Args:
        user: User object
        connection: SSO connection configuration
        db_session: Database session

    Returns:
        Created UserOrganization link
    """
    # Determine role - use default_role_id if set, otherwise use role 4 (learner)
    role_id = connection.default_role_id or 4

    user_org = UserOrganization(
        user_id=user.id,
        org_id=connection.org_id,
        role_id=role_id,
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )

    db_session.add(user_org)
    db_session.commit()
    db_session.refresh(user_org)

    from src.routers.users import _invalidate_session_cache
    _invalidate_session_cache(user.id)

    return user_org


async def get_provider_setup_url(
    org_id: int,
    return_url: str,
    db_session: Session
) -> Optional[str]:
    """
    Get setup URL for provider's admin portal (if supported).

    Args:
        org_id: Organization ID
        return_url: URL to return to after setup
        db_session: Database session

    Returns:
        Setup URL or None if not supported
    """
    connection = await get_sso_connection(org_id, db_session)
    if not connection:
        return None

    provider = get_sso_provider(connection.provider)

    try:
        return await provider.get_setup_url(
            connection_config=connection.provider_config or {},
            return_url=return_url,
        )
    except Exception:
        return None


def get_available_providers() -> list[dict]:
    """Get list of available SSO providers."""
    return get_providers()
