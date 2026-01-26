import { getAPIUrl } from '@services/config/config'
import {
  RequestBodyWithAuthHeader,
  getResponseMetadata,
  swrFetcher,
} from '@services/utils/ts/requests'

// Types - API Token access is restricted to specific resources
export interface APITokenRights {
  courses: {
    action_create: boolean
    action_read: boolean
    action_read_own: boolean
    action_update: boolean
    action_update_own: boolean
    action_delete: boolean
    action_delete_own: boolean
  }
  activities: {
    action_create: boolean
    action_read: boolean
    action_update: boolean
    action_delete: boolean
  }
  coursechapters: {
    action_create: boolean
    action_read: boolean
    action_update: boolean
    action_delete: boolean
  }
  collections: {
    action_create: boolean
    action_read: boolean
    action_update: boolean
    action_delete: boolean
  }
  certifications: {
    action_create: boolean
    action_read: boolean
    action_update: boolean
    action_delete: boolean
  }
  usergroups: {
    action_create: boolean
    action_read: boolean
    action_update: boolean
    action_delete: boolean
  }
  payments: {
    action_create: boolean
    action_read: boolean
    action_update: boolean
    action_delete: boolean
  }
  search: {
    action_read: boolean
  }
}

export interface APIToken {
  id: number
  token_uuid: string
  name: string
  description: string | null
  token_prefix: string
  org_id: number
  rights: APITokenRights | null
  created_by_user_id: number
  creation_date: string
  update_date: string
  last_used_at: string | null
  expires_at: string | null
  is_active: boolean
}

export interface APITokenCreateRequest {
  name: string
  description?: string | null
  rights?: APITokenRights | null
  expires_at?: string | null
}

export interface APITokenUpdateRequest {
  name?: string
  description?: string | null
  rights?: APITokenRights | null
  expires_at?: string | null
}

export interface APITokenCreatedResponse extends APIToken {
  token: string // The full token (only shown once!)
}

// Default rights template with all permissions disabled
export const getDefaultRights = (): APITokenRights => ({
  courses: {
    action_create: false,
    action_read: false,
    action_read_own: false,
    action_update: false,
    action_update_own: false,
    action_delete: false,
    action_delete_own: false,
  },
  activities: {
    action_create: false,
    action_read: false,
    action_update: false,
    action_delete: false,
  },
  coursechapters: {
    action_create: false,
    action_read: false,
    action_update: false,
    action_delete: false,
  },
  collections: {
    action_create: false,
    action_read: false,
    action_update: false,
    action_delete: false,
  },
  certifications: {
    action_create: false,
    action_read: false,
    action_update: false,
    action_delete: false,
  },
  usergroups: {
    action_create: false,
    action_read: false,
    action_update: false,
    action_delete: false,
  },
  payments: {
    action_create: false,
    action_read: false,
    action_update: false,
    action_delete: false,
  },
  search: {
    action_read: false,
  },
})

// Full permissions template
export const getFullRights = (): APITokenRights => ({
  courses: {
    action_create: true,
    action_read: true,
    action_read_own: true,
    action_update: true,
    action_update_own: true,
    action_delete: true,
    action_delete_own: true,
  },
  activities: {
    action_create: true,
    action_read: true,
    action_update: true,
    action_delete: true,
  },
  coursechapters: {
    action_create: true,
    action_read: true,
    action_update: true,
    action_delete: true,
  },
  collections: {
    action_create: true,
    action_read: true,
    action_update: true,
    action_delete: true,
  },
  certifications: {
    action_create: true,
    action_read: true,
    action_update: true,
    action_delete: true,
  },
  usergroups: {
    action_create: true,
    action_read: true,
    action_update: true,
    action_delete: true,
  },
  payments: {
    action_create: true,
    action_read: true,
    action_update: true,
    action_delete: true,
  },
  search: {
    action_read: true,
  },
})

// Read-only permissions template
export const getReadOnlyRights = (): APITokenRights => ({
  courses: {
    action_create: false,
    action_read: true,
    action_read_own: true,
    action_update: false,
    action_update_own: false,
    action_delete: false,
    action_delete_own: false,
  },
  activities: {
    action_create: false,
    action_read: true,
    action_update: false,
    action_delete: false,
  },
  coursechapters: {
    action_create: false,
    action_read: true,
    action_update: false,
    action_delete: false,
  },
  collections: {
    action_create: false,
    action_read: true,
    action_update: false,
    action_delete: false,
  },
  certifications: {
    action_create: false,
    action_read: true,
    action_update: false,
    action_delete: false,
  },
  usergroups: {
    action_create: false,
    action_read: true,
    action_update: false,
    action_delete: false,
  },
  payments: {
    action_create: false,
    action_read: true,
    action_update: false,
    action_delete: false,
  },
  search: {
    action_read: true,
  },
})

/**
 * List all API tokens for an organization
 */
export async function listAPITokens(
  orgId: number,
  accessToken: string
): Promise<APIToken[]> {
  const url = `${getAPIUrl()}orgs/${orgId}/api-tokens`
  return swrFetcher(url, accessToken)
}

/**
 * Get a specific API token by UUID
 */
export async function getAPIToken(
  orgId: number,
  tokenUuid: string,
  accessToken: string
): Promise<APIToken> {
  const url = `${getAPIUrl()}orgs/${orgId}/api-tokens/${tokenUuid}`
  return swrFetcher(url, accessToken)
}

/**
 * Create a new API token
 * Returns the full token value - this is the ONLY time it will be shown!
 */
export async function createAPIToken(
  orgId: number,
  data: APITokenCreateRequest,
  accessToken: string
) {
  const result = await fetch(
    `${getAPIUrl()}orgs/${orgId}/api-tokens`,
    RequestBodyWithAuthHeader('POST', data, null, accessToken)
  )
  const res = await getResponseMetadata(result)
  return res
}

/**
 * Update an API token
 */
export async function updateAPIToken(
  orgId: number,
  tokenUuid: string,
  data: APITokenUpdateRequest,
  accessToken: string
) {
  const result = await fetch(
    `${getAPIUrl()}orgs/${orgId}/api-tokens/${tokenUuid}`,
    RequestBodyWithAuthHeader('PUT', data, null, accessToken)
  )
  const res = await getResponseMetadata(result)
  return res
}

/**
 * Revoke an API token
 */
export async function revokeAPIToken(
  orgId: number,
  tokenUuid: string,
  accessToken: string
) {
  const result = await fetch(
    `${getAPIUrl()}orgs/${orgId}/api-tokens/${tokenUuid}`,
    RequestBodyWithAuthHeader('DELETE', null, null, accessToken)
  )
  const res = await getResponseMetadata(result)
  return res
}

/**
 * Regenerate an API token secret
 * Returns the new full token value - this is the ONLY time it will be shown!
 */
export async function regenerateAPIToken(
  orgId: number,
  tokenUuid: string,
  accessToken: string
) {
  const result = await fetch(
    `${getAPIUrl()}orgs/${orgId}/api-tokens/${tokenUuid}/regenerate`,
    RequestBodyWithAuthHeader('POST', null, null, accessToken)
  )
  const res = await getResponseMetadata(result)
  return res
}

/**
 * Fetch OpenAPI specification from the backend
 */
export async function fetchOpenAPISpec(accessToken?: string) {
  const url = `${getAPIUrl().replace('/api/v1/', '')}/openapi.json`

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  }
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`
  }

  const response = await fetch(url, {
    method: 'GET',
    headers,
    credentials: 'include',
  })

  if (!response.ok) {
    throw new Error('Failed to fetch OpenAPI spec')
  }

  return response.json()
}
