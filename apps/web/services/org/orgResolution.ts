import { cookies, headers } from 'next/headers'
import { getOrganizationContextInfoWithoutCredentials, getOrganizationContextInfoWithUUID } from '@services/organizations/orgs'
import { getConfig } from '@services/config/config'
import { extractSubdomain, isLocalhost as isLocalhostCheck } from '@services/utils/ts/hostUtils'

/**
 * Read the frontend domain on the server side.
 * Priority: env var > cookie (set by middleware) > default
 */
async function getServerDomain(): Promise<string> {
  const envVal = getConfig('NEXT_PUBLIC_LEARNHOUSE_DOMAIN')
  if (envVal) return envVal
  try {
    const cookieStore = await cookies()
    const cookieVal = cookieStore.get('learnhouse_frontend_domain')?.value
    if (cookieVal) return cookieVal
  } catch {
    // cookies() may throw outside of a request context
  }
  return 'localhost'
}

export interface ResolvedOrg {
  id: number
  slug: string
  name: string
  org_uuid: string
  logo_image?: string
  [key: string]: any
}

export interface OrgResolutionResult {
  org: ResolvedOrg | null
  source: 'subdomain' | 'cookie' | 'token' | 'none'
  error?: string
}

/**
 * Resolves the organization context from multiple sources in priority order:
 * 1. Subdomain (e.g., myorg.learnhouse.io -> "myorg")
 * 2. Cookie (learnhouse_orgslug)
 * 3. Action token (for password reset, email verification links)
 *
 * Returns null if no org context can be determined.
 */
export async function resolveOrg(searchParams?: { token?: string }): Promise<OrgResolutionResult> {
  // 1. Try to get org from subdomain
  const subdomainOrg = await resolveFromSubdomain()
  if (subdomainOrg) {
    return { org: subdomainOrg, source: 'subdomain' }
  }

  // 2. Try to get org from cookie
  const cookieOrg = await resolveFromCookie()
  if (cookieOrg) {
    return { org: cookieOrg, source: 'cookie' }
  }

  // 3. Try to get org from action token (for reset/verify-email pages)
  if (searchParams?.token) {
    const tokenOrg = await resolveFromToken(searchParams.token)
    if (tokenOrg) {
      return { org: tokenOrg, source: 'token' }
    }
  }

  // 4. No org context found
  return { org: null, source: 'none' }
}

/**
 * Extract org slug from subdomain
 * e.g., myorg.learnhouse.io -> "myorg"
 */
async function resolveFromSubdomain(): Promise<ResolvedOrg | null> {
  try {
    const headersList = await headers()
    const host = headersList.get('host')

    if (!host) return null

    const domain = await getServerDomain()

    // Check if it's a subdomain of the main domain
    const orgslug = extractSubdomain(host, domain)
    if (orgslug) {
      // Skip special subdomains
      if (orgslug === 'auth' || orgslug === 'www' || orgslug === 'api' || orgslug === 'admin') {
        return null
      }

      return await fetchOrgBySlug(orgslug)
    }

    // For localhost development, org comes from cookie
    if (isLocalhostCheck(host)) {
      return null
    }

    return null
  } catch (error) {
    console.error('Error resolving org from subdomain:', error)
    return null
  }
}

/**
 * Get org slug from cookie
 */
async function resolveFromCookie(): Promise<ResolvedOrg | null> {
  try {
    const cookieStore = await cookies()
    const orgslugCookie = cookieStore.get('learnhouse_orgslug')

    if (!orgslugCookie?.value) {
      // Try the old cookie name for backward compatibility
      const legacyCookie = cookieStore.get('learnhouse_current_orgslug')
      if (!legacyCookie?.value) {
        return null
      }
      return await fetchOrgBySlug(legacyCookie.value)
    }

    return await fetchOrgBySlug(orgslugCookie.value)
  } catch (error) {
    console.error('Error resolving org from cookie:', error)
    return null
  }
}

/**
 * Decode action token and extract org info
 * Used for password reset and email verification links
 */
async function resolveFromToken(token: string): Promise<ResolvedOrg | null> {
  try {
    // Decode the JWT token to get org_uuid
    // The token is a base64-encoded JWT, we can decode the payload without verification
    // (verification happens on the backend when the action is performed)
    const payload = decodeTokenPayload(token)

    if (!payload || !payload.org_uuid) {
      return null
    }

    return await fetchOrgByUUID(payload.org_uuid)
  } catch (error) {
    console.error('Error resolving org from token:', error)
    return null
  }
}

/**
 * Decode JWT payload without verification
 * (Used only for extracting org_uuid for display purposes)
 */
function decodeTokenPayload(token: string): { org_uuid?: string; email?: string; action?: string } | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) {
      return null
    }

    const payload = parts[1]
    const decoded = Buffer.from(payload, 'base64').toString('utf-8')
    return JSON.parse(decoded)
  } catch {
    return null
  }
}

/**
 * Fetch organization by slug from API
 */
async function fetchOrgBySlug(orgslug: string): Promise<ResolvedOrg | null> {
  try {
    const org = await getOrganizationContextInfoWithoutCredentials(orgslug)

    if (!org || org.error) {
      return null
    }

    return org as ResolvedOrg
  } catch (error) {
    console.error('Error fetching org by slug:', error)
    return null
  }
}

/**
 * Fetch organization by UUID from API
 */
async function fetchOrgByUUID(orgUUID: string): Promise<ResolvedOrg | null> {
  try {
    const org = await getOrganizationContextInfoWithUUID(orgUUID, null, '')

    if (!org || org.error) {
      return null
    }

    return org as ResolvedOrg
  } catch (error) {
    console.error('Error fetching org by uuid:', error)
    return null
  }
}

/**
 * Get just the org slug from available sources (useful for client components)
 * Priority: subdomain > cookie
 */
export async function getOrgSlug(): Promise<string | null> {
  // Try subdomain first
  const headersList = await headers()
  const host = headersList.get('host')
  const domain = await getServerDomain()

  const sub = extractSubdomain(host, domain)
  if (sub && sub !== 'auth' && sub !== 'www' && sub !== 'api' && sub !== 'admin') {
    return sub
  }

  // Fall back to cookie
  const cookieStore = await cookies()
  const orgslugCookie = cookieStore.get('learnhouse_orgslug')
  if (orgslugCookie?.value) {
    return orgslugCookie.value
  }

  // Try legacy cookie
  const legacyCookie = cookieStore.get('learnhouse_current_orgslug')
  if (legacyCookie?.value) {
    return legacyCookie.value
  }

  return null
}
