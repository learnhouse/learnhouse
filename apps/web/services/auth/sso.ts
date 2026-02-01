/**
 * SSO (Single Sign-On) Service
 *
 * Provides functions for SSO configuration and authentication.
 * Supports a provider-agnostic architecture with WorkOS as the initial provider.
 */

import { getAPIUrl } from '@services/config/config'

// ============================================================================
// Types
// ============================================================================

export type SSOProvider =
  | 'workos'
  | 'keycloak'
  | 'okta'
  | 'auth0'
  | 'custom_saml'
  | 'custom_oidc'

export interface SSOConfig {
  id: number
  org_id: number
  provider: SSOProvider
  enabled: boolean
  domains: string[]
  auto_provision_users: boolean
  default_role_id: number | null
  provider_config: Record<string, any>
  created_at: string
  updated_at: string
}

export interface SSOConfigCreate {
  provider: SSOProvider
  enabled?: boolean
  domains?: string[]
  auto_provision_users?: boolean
  default_role_id?: number | null
  provider_config?: Record<string, any>
}

export interface SSOConfigUpdate {
  provider?: SSOProvider
  enabled?: boolean
  domains?: string[]
  auto_provision_users?: boolean
  default_role_id?: number | null
  provider_config?: Record<string, any>
}

export interface SSOProviderInfo {
  id: SSOProvider
  name: string
  description: string
  has_setup_portal: boolean
  available: boolean
  config_fields: ConfigField[]
}

export interface ConfigField {
  name: string
  type: string
  required: boolean
  description: string
  placeholder?: string
  hidden?: boolean
}

export interface SSOLoginCheckResponse {
  sso_enabled: boolean
  provider: SSOProvider | null
}

export interface SSOAuthorizationResponse {
  authorization_url: string
  state: string
}

export interface SSOCallbackResponse {
  user: any
  tokens: {
    access_token: string
    refresh_token: string
    expiry: number | null
  }
  redirect_url: string
  org_slug?: string
}

export interface SSOErrorDetail {
  error: string
  error_code: string
  error_description: string
  message?: string
  provider?: string
  details?: Record<string, any>
}

export class SSOError extends Error {
  error: string
  errorCode: string
  errorDescription: string
  provider?: string
  details?: Record<string, any>

  constructor(detail: SSOErrorDetail) {
    super(detail.message || detail.error_description)
    this.error = detail.error
    this.errorCode = detail.error_code
    this.errorDescription = detail.error_description
    this.provider = detail.provider
    this.details = detail.details
    this.name = 'SSOError'
  }
}

// ============================================================================
// Admin API Functions (require authentication)
// ============================================================================

/**
 * Get list of available SSO providers.
 */
export async function getAvailableProviders(
  orgId: number,
  accessToken: string
): Promise<SSOProviderInfo[]> {
  const response = await fetch(
    `${getAPIUrl()}auth/sso/providers?org_id=${orgId}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      credentials: 'include',
    }
  )

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.detail || 'Failed to fetch SSO providers')
  }

  return response.json()
}

/**
 * Get SSO configuration for an organization.
 */
export async function getSSOConfig(
  orgId: number,
  accessToken: string
): Promise<SSOConfig | null> {
  const response = await fetch(`${getAPIUrl()}auth/sso/${orgId}/config`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    credentials: 'include',
  })

  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.detail || 'Failed to fetch SSO configuration')
  }

  return response.json()
}

/**
 * Create SSO configuration for an organization.
 */
export async function createSSOConfig(
  orgId: number,
  data: SSOConfigCreate,
  accessToken: string
): Promise<SSOConfig> {
  const response = await fetch(`${getAPIUrl()}auth/sso/${orgId}/config`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(data),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.detail || 'Failed to create SSO configuration')
  }

  return response.json()
}

/**
 * Update SSO configuration for an organization.
 */
export async function updateSSOConfig(
  orgId: number,
  data: SSOConfigUpdate,
  accessToken: string
): Promise<SSOConfig> {
  const response = await fetch(`${getAPIUrl()}auth/sso/${orgId}/config`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify(data),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.detail || 'Failed to update SSO configuration')
  }

  return response.json()
}

/**
 * Delete SSO configuration for an organization.
 */
export async function deleteSSOConfig(
  orgId: number,
  accessToken: string
): Promise<void> {
  const response = await fetch(`${getAPIUrl()}auth/sso/${orgId}/config`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    credentials: 'include',
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.detail || 'Failed to delete SSO configuration')
  }
}

/**
 * Get setup URL for provider's admin portal.
 */
export async function getSetupUrl(
  orgId: number,
  returnUrl: string,
  accessToken: string
): Promise<string | null> {
  const response = await fetch(
    `${getAPIUrl()}auth/sso/${orgId}/setup-url?return_url=${encodeURIComponent(returnUrl)}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      credentials: 'include',
    }
  )

  if (!response.ok) {
    // Setup URL might not be available, don't throw
    return null
  }

  const data = await response.json()
  return data.setup_url
}

// ============================================================================
// Public API Functions (no authentication required)
// ============================================================================

/**
 * Check if SSO is enabled for an organization.
 * Used by login page to determine if SSO button should be shown.
 */
export async function checkSSOEnabled(
  orgSlug: string
): Promise<SSOLoginCheckResponse> {
  const response = await fetch(
    `${getAPIUrl()}auth/sso/check?org_slug=${encodeURIComponent(orgSlug)}`,
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    }
  )

  if (!response.ok) {
    // If SSO check fails, assume SSO is not available
    return { sso_enabled: false, provider: null }
  }

  return response.json()
}

/**
 * Initiate SSO login flow.
 * Returns authorization URL to redirect user to identity provider.
 */
export async function initiateSSOLogin(
  orgSlug: string
): Promise<SSOAuthorizationResponse> {
  const response = await fetch(
    `${getAPIUrl()}auth/sso/authorize?org_slug=${encodeURIComponent(orgSlug)}`,
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    }
  )

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.detail || 'Failed to initiate SSO login')
  }

  return response.json()
}

/**
 * Handle SSO callback (called by backend).
 * This is typically handled by the callback page, not called directly.
 */
export async function handleSSOCallback(
  code: string,
  state: string
): Promise<SSOCallbackResponse> {
  const response = await fetch(
    `${getAPIUrl()}auth/sso/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
    {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
    }
  )

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    // Check if this is a structured error response
    if (error.detail && typeof error.detail === 'object' && error.detail.error_code) {
      throw new SSOError(error.detail)
    }
    // Fallback for legacy error format
    const message = typeof error.detail === 'string' ? error.detail : 'SSO authentication failed'
    throw new SSOError({
      error: 'sso_error',
      error_code: 'unknown_error',
      error_description: message,
      message: message,
    })
  }

  return response.json()
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Redirect user to SSO login.
 * Convenience function that initiates SSO and redirects in one step.
 */
export async function redirectToSSOLogin(orgSlug: string): Promise<void> {
  const response = await initiateSSOLogin(orgSlug)
  window.location.href = response.authorization_url
}

/**
 * Get provider display name.
 */
export function getProviderDisplayName(provider: SSOProvider): string {
  const names: Record<SSOProvider, string> = {
    workos: 'WorkOS',
    keycloak: 'Keycloak',
    okta: 'Okta',
    auth0: 'Auth0',
    custom_saml: 'Custom SAML',
    custom_oidc: 'Custom OIDC',
  }
  return names[provider] || provider
}

/**
 * Check if a provider is available (properly configured on backend).
 */
export function isProviderAvailable(
  providers: SSOProviderInfo[],
  providerId: SSOProvider
): boolean {
  const provider = providers.find((p) => p.id === providerId)
  return provider?.available ?? false
}

/**
 * Get user-friendly error message for common SSO error codes.
 */
export function getErrorMessage(errorCode: string, errorDescription?: string): string {
  const errorMessages: Record<string, string> = {
    // OAuth 2.0 standard errors
    access_denied: 'Access was denied. You may have declined the login request or don\'t have permission to access this application.',
    invalid_request: 'The authentication request was invalid. Please try again.',
    unauthorized_client: 'This application is not authorized to request authentication.',
    unsupported_response_type: 'The authentication method is not supported.',
    invalid_scope: 'The requested permissions are invalid.',
    server_error: 'The identity provider encountered an internal error. Please try again later.',
    temporarily_unavailable: 'The identity provider is temporarily unavailable. Please try again later.',

    // OIDC specific errors
    interaction_required: 'User interaction is required. Please try logging in again.',
    login_required: 'You need to log in to your identity provider first.',
    account_selection_required: 'Please select an account to continue.',
    consent_required: 'You need to grant consent to access this application.',
    invalid_request_uri: 'The authentication request URI is invalid.',
    invalid_request_object: 'The authentication request object is invalid.',
    request_not_supported: 'The authentication request method is not supported.',

    // Provider specific
    invalid_grant: 'The authorization code has expired or is invalid. Please try again.',
    invalid_client: 'Client authentication failed. Please contact your administrator.',
    user_canceled: 'You canceled the login process.',

    // LearnHouse specific
    sso_not_enabled: 'SSO is not enabled for this organization.',
    domain_not_allowed: 'Your email domain is not allowed for this organization.',
    user_creation_failed: 'Failed to create user account. Please contact support.',
    token_exchange_failed: 'Failed to authenticate with the identity provider.',
    invalid_state: 'The authentication session has expired. Please try again.',
    missing_params: 'Missing required parameters. Please try logging in again.',
    state_invalid_or_expired: 'Your SSO session has expired. Please try logging in again.',
    email_domain_rejected: 'Your email domain is not allowed for this organization.',
    auto_provision_disabled: 'Your account does not exist. Please contact your administrator for access.',
    sso_misconfigured: 'SSO is not configured correctly. Please contact your administrator.',
    callback_failed: 'Failed to complete SSO authentication. Please try again.',
  }

  return errorMessages[errorCode] || errorDescription || `Authentication error: ${errorCode}`
}
