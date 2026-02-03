"""
SSO Providers package.

Provides a factory function for getting the appropriate SSO provider
based on provider type, along with utilities for listing available providers.
"""

from .base import SSOProvider, SSOUserProfile, SSOAuthenticationError, SSOConfigurationError
from .workos_provider import WorkOSProvider
from .oidc_provider import CustomOIDCProvider


# Registry of available SSO providers
_PROVIDER_REGISTRY: dict[str, type[SSOProvider]] = {
    "workos": WorkOSProvider,
    "custom_oidc": CustomOIDCProvider,
    # Future providers:
    # "keycloak": KeycloakProvider,
    # "okta": OktaProvider,
    # "auth0": Auth0Provider,
    # "custom_saml": CustomSAMLProvider,
}

# Singleton instances for providers (they're stateless after init)
_provider_instances: dict[str, SSOProvider] = {}


def get_sso_provider(provider_type: str) -> SSOProvider:
    """
    Factory function to get the appropriate SSO provider instance.

    Args:
        provider_type: The provider identifier (e.g., 'workos', 'keycloak')

    Returns:
        SSOProvider instance for the requested provider

    Raises:
        ValueError: If provider_type is not supported
    """
    if provider_type not in _PROVIDER_REGISTRY:
        raise ValueError(
            f"Unsupported SSO provider: '{provider_type}'. "
            f"Available providers: {list(_PROVIDER_REGISTRY.keys())}"
        )

    # Return cached instance or create new one
    if provider_type not in _provider_instances:
        provider_class = _PROVIDER_REGISTRY[provider_type]
        _provider_instances[provider_type] = provider_class()

    return _provider_instances[provider_type]


def get_available_providers() -> list[dict]:
    """
    Get information about all available SSO providers.

    Returns:
        List of provider info dictionaries with:
        - id: Provider identifier
        - name: Display name
        - description: Provider description
        - has_setup_portal: Whether provider has admin portal
        - available: Whether provider is properly configured
        - config_fields: Fields needed for configuration
    """
    providers = []

    for provider_id, provider_class in _PROVIDER_REGISTRY.items():
        try:
            instance = get_sso_provider(provider_id)
            available = getattr(instance, 'is_configured', lambda: True)()
        except Exception:
            available = False
            instance = provider_class()

        provider_info = {
            "id": provider_id,
            "name": _get_provider_display_name(provider_id),
            "description": _get_provider_description(provider_id),
            "has_setup_portal": instance.has_setup_portal,
            "available": available,
            "config_fields": instance.get_config_fields(),
        }
        providers.append(provider_info)

    return providers


def is_provider_available(provider_type: str) -> bool:
    """
    Check if a specific provider is available and configured.

    Args:
        provider_type: The provider identifier

    Returns:
        True if provider exists and is properly configured
    """
    if provider_type not in _PROVIDER_REGISTRY:
        return False

    try:
        instance = get_sso_provider(provider_type)
        return getattr(instance, 'is_configured', lambda: True)()
    except Exception:
        return False


def _get_provider_display_name(provider_id: str) -> str:
    """Get human-readable name for a provider."""
    names = {
        "workos": "WorkOS",
        "keycloak": "Keycloak",
        "okta": "Okta",
        "auth0": "Auth0",
        "custom_saml": "Custom SAML",
        "custom_oidc": "Custom OIDC",
    }
    return names.get(provider_id, provider_id.title())


def _get_provider_description(provider_id: str) -> str:
    """Get description for a provider."""
    descriptions = {
        "workos": "Enterprise SSO with support for SAML and OIDC identity providers",
        "keycloak": "Open-source identity and access management (coming soon)",
        "okta": "Identity management service (coming soon)",
        "auth0": "Authentication and authorization platform (coming soon)",
        "custom_saml": "Connect to any SAML 2.0 identity provider (coming soon)",
        "custom_oidc": "Connect directly to any OpenID Connect provider (Azure AD, Okta, Google, Keycloak)",
    }
    return descriptions.get(provider_id, "SSO provider")


# Export main classes and functions
__all__ = [
    "SSOProvider",
    "SSOUserProfile",
    "SSOAuthenticationError",
    "SSOConfigurationError",
    "WorkOSProvider",
    "CustomOIDCProvider",
    "get_sso_provider",
    "get_available_providers",
    "is_provider_available",
]
