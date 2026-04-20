"""
WorkOS SSO provider implementation.

Implements the SSOProvider interface for WorkOS, providing enterprise
SSO capabilities through WorkOS's unified API for SAML and OIDC.
"""

import os
from typing import Optional
from workos import WorkOSClient
from workos import BadRequestError

from .base import SSOProvider, SSOUserProfile, SSOAuthenticationError, SSOConfigurationError


class WorkOSProvider(SSOProvider):
    """
    WorkOS SSO provider implementation.

    WorkOS provides a unified API for SAML and OIDC connections,
    with an admin portal for easy IdP configuration.
    """

    def __init__(self):
        """Initialize the WorkOS provider with credentials from environment."""
        self.api_key = os.getenv("WORKOS_API_KEY")
        self.client_id = os.getenv("WORKOS_CLIENT_ID")

        if self.api_key and self.client_id:
            self.client = WorkOSClient(
                api_key=self.api_key,
                client_id=self.client_id
            )
        else:
            self.client = None

    @property
    def provider_name(self) -> str:
        return "workos"

    @property
    def has_setup_portal(self) -> bool:
        return True

    def is_configured(self) -> bool:
        """Check if WorkOS credentials are configured."""
        return self.client is not None

    async def get_authorization_url(
        self,
        connection_config: dict,
        redirect_uri: str,
        state: str
    ) -> str:
        """
        Generate WorkOS authorization URL.

        Uses either connection_id (for existing connections) or
        organization_id (for organization-level SSO).
        """
        if not self.client:
            raise SSOConfigurationError(
                "WorkOS is not configured. Set WORKOS_API_KEY and WORKOS_CLIENT_ID.",
                provider=self.provider_name
            )

        connection_id = connection_config.get("connection_id")
        organization_id = connection_config.get("organization_id")

        if not connection_id and not organization_id:
            raise SSOConfigurationError(
                "Either connection_id or organization_id is required for WorkOS SSO.",
                provider=self.provider_name,
                field="connection_id"
            )

        try:
            # Build authorization URL parameters
            params = {
                "redirect_uri": redirect_uri,
                "state": state,
            }

            # Prefer connection_id if available, otherwise use organization_id
            if connection_id:
                params["connection_id"] = connection_id
            else:
                params["organization_id"] = organization_id

            authorization_url = self.client.sso.get_authorization_url(**params)
            return authorization_url

        except Exception as e:
            raise SSOAuthenticationError(
                f"Failed to generate WorkOS authorization URL: {str(e)}",
                provider=self.provider_name,
                details={"error": str(e)}
            )

    async def handle_callback(
        self,
        code: str,
        connection_config: dict
    ) -> SSOUserProfile:
        """
        Exchange WorkOS authorization code for user profile.

        WorkOS returns a profile object with normalized user data.
        """
        if not self.client:
            raise SSOConfigurationError(
                "WorkOS is not configured. Set WORKOS_API_KEY and WORKOS_CLIENT_ID.",
                provider=self.provider_name
            )

        try:
            # Exchange code for profile and token
            profile_and_token = self.client.sso.get_profile_and_token(code=code)
            profile = profile_and_token.profile

            # Map WorkOS profile to our standard format
            return SSOUserProfile(
                email=profile.email,
                first_name=profile.first_name,
                last_name=profile.last_name,
                avatar_url=getattr(profile, 'profile_picture_url', None),
                provider_user_id=profile.id,
                raw_attributes={
                    "idp_id": profile.idp_id,
                    "connection_id": profile.connection_id,
                    "connection_type": profile.connection_type,
                    "organization_id": getattr(profile, 'organization_id', None),
                    "raw_attributes": getattr(profile, 'raw_attributes', {}),
                }
            )

        except BadRequestError as e:
            raise SSOAuthenticationError(
                f"Invalid authorization code: {str(e)}",
                provider=self.provider_name,
                details={"error": str(e), "error_type": "bad_request"}
            )
        except Exception as e:
            raise SSOAuthenticationError(
                f"Failed to authenticate with WorkOS: {str(e)}",
                provider=self.provider_name,
                details={"error": str(e)}
            )

    async def get_setup_url(
        self,
        connection_config: dict,
        return_url: str
    ) -> Optional[str]:
        """
        Generate WorkOS Admin Portal link.

        The Admin Portal allows organization admins to configure
        their identity provider without developer involvement.
        """
        if not self.client:
            return None

        organization_id = connection_config.get("organization_id")
        if not organization_id:
            return None

        try:
            # Generate admin portal link
            portal_link = self.client.portal.generate_link(
                organization=organization_id,
                intent="sso",
                return_url=return_url
            )
            return portal_link.link

        except Exception:
            # Admin portal is optional, don't fail if it doesn't work
            return None

    async def create_organization(self, name: str, domains: list[str] = None) -> dict:
        """
        Create a WorkOS organization for a LearnHouse org.

        This is needed before setting up SSO connections.
        """
        if not self.client:
            raise SSOConfigurationError(
                "WorkOS is not configured. Set WORKOS_API_KEY and WORKOS_CLIENT_ID.",
                provider=self.provider_name
            )

        try:
            org = self.client.organizations.create_organization(
                name=name,
                domains=domains or []
            )
            return {
                "organization_id": org.id,
                "name": org.name,
                "domains": [d.domain for d in org.domains] if org.domains else []
            }
        except Exception as e:
            raise SSOConfigurationError(
                f"Failed to create WorkOS organization: {str(e)}",
                provider=self.provider_name
            )

    async def update_organization_domains(
        self,
        organization_id: str,
        domains: list[str]
    ) -> dict:
        """Update the allowed domains for a WorkOS organization."""
        if not self.client:
            raise SSOConfigurationError(
                "WorkOS is not configured.",
                provider=self.provider_name
            )

        try:
            org = self.client.organizations.update_organization(
                organization_id=organization_id,
                domains=domains
            )
            return {
                "organization_id": org.id,
                "name": org.name,
                "domains": [d.domain for d in org.domains] if org.domains else []
            }
        except Exception as e:
            raise SSOConfigurationError(
                f"Failed to update WorkOS organization: {str(e)}",
                provider=self.provider_name
            )

    def validate_config(self, config: dict) -> bool:
        """
        Validate WorkOS-specific configuration.

        For WorkOS, we need either a connection_id (for direct connection)
        or an organization_id (for organization-level SSO).
        """
        connection_id = config.get("connection_id")
        organization_id = config.get("organization_id")

        if not connection_id and not organization_id:
            raise ValueError(
                "WorkOS configuration requires either 'connection_id' or 'organization_id'"
            )

        return True

    def get_config_fields(self) -> list[dict]:
        """Return configuration fields for WorkOS."""
        return [
            {
                "name": "organization_id",
                "type": "string",
                "required": False,
                "description": "WorkOS Organization ID (created automatically or via Admin Portal)",
                "placeholder": "org_..."
            },
            {
                "name": "connection_id",
                "type": "string",
                "required": False,
                "description": "WorkOS Connection ID (created via Admin Portal)",
                "placeholder": "conn_...",
                "hidden": True  # Usually managed via Admin Portal
            }
        ]
