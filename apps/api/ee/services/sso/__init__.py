"""
SSO (Single Sign-On) services package.

Provides provider-agnostic SSO functionality with support for
multiple identity providers (WorkOS, Keycloak, Okta, etc.).
"""

from .sso import (
    get_sso_connection,
    get_sso_connection_by_org_slug,
    create_sso_connection,
    update_sso_connection,
    delete_sso_connection,
    initiate_sso_login,
    handle_sso_callback,
    get_provider_setup_url,
    check_sso_enabled,
)

from .providers import (
    SSOProvider,
    SSOUserProfile,
    SSOAuthenticationError,
    SSOConfigurationError,
    get_sso_provider,
    get_available_providers,
    is_provider_available,
)

__all__ = [
    # Connection management
    "get_sso_connection",
    "get_sso_connection_by_org_slug",
    "create_sso_connection",
    "update_sso_connection",
    "delete_sso_connection",
    # Authentication
    "initiate_sso_login",
    "handle_sso_callback",
    "get_provider_setup_url",
    "check_sso_enabled",
    # Provider classes
    "SSOProvider",
    "SSOUserProfile",
    "SSOAuthenticationError",
    "SSOConfigurationError",
    "get_sso_provider",
    "get_available_providers",
    "is_provider_available",
]
