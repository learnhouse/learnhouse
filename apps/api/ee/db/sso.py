"""
SSO (Single Sign-On) database models.

Implements a provider-agnostic architecture that supports multiple SSO providers
(WorkOS, Keycloak, Okta, Auth0, custom SAML/OIDC) with a common interface.
"""

from typing import Optional, List, Literal
from sqlmodel import SQLModel, Field, Column, Integer, ForeignKey, JSON
from datetime import datetime
from pydantic import BaseModel


# Supported SSO providers - extend this as new providers are added
SSOProviderType = Literal["workos", "keycloak", "okta", "auth0", "custom_saml", "custom_oidc"]


class SSOConnectionBase(SQLModel):
    """Base fields for SSO connection configuration."""

    # Provider-agnostic fields
    provider: str  # SSOProviderType - "workos", "keycloak", etc.
    enabled: bool = False
    domains: List[str] = Field(default_factory=list, sa_column=Column(JSON))
    auto_provision_users: bool = True

    # Provider-specific configuration (JSON blob)
    # WorkOS: {"connection_id": "...", "organization_id": "..."}
    # Keycloak: {"realm": "...", "client_id": "...", "client_secret": "...", "server_url": "..."}
    # Custom SAML: {"idp_entity_id": "...", "idp_sso_url": "...", "idp_certificate": "..."}
    provider_config: Optional[dict] = Field(default_factory=dict, sa_column=Column(JSON))


class SSOConnection(SSOConnectionBase, table=True):
    """SSO connection database table."""
    __tablename__ = "ssoconnection"

    id: Optional[int] = Field(default=None, primary_key=True)
    org_id: int = Field(
        sa_column=Column(Integer, ForeignKey("organization.id", ondelete="CASCADE"))
    )
    default_role_id: Optional[int] = Field(
        default=None,
        sa_column=Column(Integer, ForeignKey("role.id", ondelete="SET NULL"))
    )
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class SSOConnectionRead(SSOConnectionBase):
    """Response model for SSO connection."""
    id: int
    org_id: int
    default_role_id: Optional[int] = None
    created_at: datetime
    updated_at: datetime


class SSOConnectionCreate(SQLModel):
    """Request model for creating SSO connection."""
    provider: str  # SSOProviderType
    enabled: bool = False
    domains: List[str] = []
    auto_provision_users: bool = True
    default_role_id: Optional[int] = None
    provider_config: Optional[dict] = None


class SSOConnectionUpdate(SQLModel):
    """Request model for updating SSO connection."""
    provider: Optional[str] = None  # SSOProviderType
    enabled: Optional[bool] = None
    domains: Optional[List[str]] = None
    auto_provision_users: Optional[bool] = None
    default_role_id: Optional[int] = None
    provider_config: Optional[dict] = None


# Provider-specific configuration schemas (validated at runtime)

class WorkOSConfig(BaseModel):
    """WorkOS-specific configuration."""
    connection_id: Optional[str] = None
    organization_id: Optional[str] = None


class KeycloakConfig(BaseModel):
    """Keycloak-specific configuration (future)."""
    realm: str
    client_id: str
    client_secret: str
    server_url: str


class OktaConfig(BaseModel):
    """Okta-specific configuration (future)."""
    domain: str
    client_id: str
    client_secret: str


class Auth0Config(BaseModel):
    """Auth0-specific configuration (future)."""
    domain: str
    client_id: str
    client_secret: str


class CustomSAMLConfig(BaseModel):
    """Custom SAML IdP configuration (future)."""
    idp_entity_id: str
    idp_sso_url: str
    idp_certificate: str
    sp_entity_id: str


class CustomOIDCConfig(BaseModel):
    """Custom OIDC provider configuration (future)."""
    issuer: str
    client_id: str
    client_secret: str
    authorization_endpoint: str
    token_endpoint: str
    userinfo_endpoint: str


# Mapping of provider types to their config schemas
PROVIDER_CONFIG_SCHEMAS = {
    "workos": WorkOSConfig,
    "keycloak": KeycloakConfig,
    "okta": OktaConfig,
    "auth0": Auth0Config,
    "custom_saml": CustomSAMLConfig,
    "custom_oidc": CustomOIDCConfig,
}


# Response models for API

class SSOProviderInfo(BaseModel):
    """Information about an available SSO provider."""
    id: str  # Provider identifier
    name: str  # Display name
    description: str
    has_setup_portal: bool  # Whether provider has admin portal
    available: bool  # Whether provider is configured and available
    config_fields: List[dict]  # Fields needed for configuration


class SSOAuthorizationResponse(BaseModel):
    """Response for SSO authorization initiation."""
    authorization_url: str
    state: str


class SSOLoginCheckResponse(BaseModel):
    """Response for checking if SSO is available for an organization."""
    sso_enabled: bool
    provider: Optional[str] = None
