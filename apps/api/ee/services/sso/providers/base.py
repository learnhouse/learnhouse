"""
Base SSO provider interface.

Defines the abstract base class that all SSO providers must implement,
providing a consistent interface for authentication across different
identity providers.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class SSOUserProfile:
    """
    Standardized user profile from any SSO provider.

    This class normalizes user data across different SSO providers
    into a consistent format for user creation/matching.
    """

    email: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    avatar_url: Optional[str] = None
    provider_user_id: Optional[str] = None  # Provider's unique ID for the user
    raw_attributes: dict = field(default_factory=dict)  # Full provider response for debugging


class SSOProvider(ABC):
    """
    Abstract base class for SSO providers.

    All SSO provider implementations (WorkOS, Keycloak, Okta, etc.)
    must inherit from this class and implement all abstract methods.
    """

    @property
    @abstractmethod
    def provider_name(self) -> str:
        """
        Return the provider identifier.

        Returns:
            Provider name string (e.g., 'workos', 'keycloak', 'okta')
        """
        pass

    @property
    @abstractmethod
    def has_setup_portal(self) -> bool:
        """
        Return whether the provider has an admin portal for IdP setup.

        Returns:
            True if provider supports admin portal links
        """
        pass

    @abstractmethod
    async def get_authorization_url(
        self,
        connection_config: dict,
        redirect_uri: str,
        state: str
    ) -> str:
        """
        Generate the SSO authorization URL.

        Args:
            connection_config: Provider-specific connection configuration
            redirect_uri: URL to redirect to after authentication
            state: State parameter for CSRF protection

        Returns:
            Full authorization URL to redirect the user to
        """
        pass

    @abstractmethod
    async def handle_callback(
        self,
        code: str,
        connection_config: dict
    ) -> SSOUserProfile:
        """
        Exchange authorization code for user profile.

        Args:
            code: Authorization code from the callback
            connection_config: Provider-specific connection configuration

        Returns:
            Normalized SSOUserProfile with user data

        Raises:
            SSOAuthenticationError: If authentication fails
        """
        pass

    @abstractmethod
    async def get_setup_url(
        self,
        connection_config: dict,
        return_url: str
    ) -> Optional[str]:
        """
        Get admin portal URL for configuring the IdP.

        Some providers (like WorkOS) provide an admin portal where
        organization admins can configure their identity provider.

        Args:
            connection_config: Provider-specific connection configuration
            return_url: URL to return to after setup

        Returns:
            Setup portal URL, or None if not supported
        """
        pass

    @abstractmethod
    def validate_config(self, config: dict) -> bool:
        """
        Validate provider-specific configuration.

        Args:
            config: Configuration dictionary to validate

        Returns:
            True if configuration is valid

        Raises:
            ValueError: If configuration is invalid with details
        """
        pass

    def get_config_fields(self) -> list[dict]:
        """
        Return the configuration fields needed for this provider.

        Override this method to provide UI hints for configuration forms.

        Returns:
            List of field definitions with name, type, required, description
        """
        return []


class SSOAuthenticationError(Exception):
    """Exception raised when SSO authentication fails."""

    def __init__(self, message: str, provider: str, details: Optional[dict] = None):
        self.message = message
        self.provider = provider
        self.details = details or {}
        super().__init__(self.message)


class SSOConfigurationError(Exception):
    """Exception raised when SSO configuration is invalid."""

    def __init__(self, message: str, provider: str, field: Optional[str] = None):
        self.message = message
        self.provider = provider
        self.field = field
        super().__init__(self.message)
