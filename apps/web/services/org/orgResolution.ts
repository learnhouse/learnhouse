import { cookies } from 'next/headers'
import { getOrganizationContextInfoWithoutCredentials, getOrganizationContextInfoWithUUID } from '@services/organizations/orgs'

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
 * Read the active tenancy mode on the server side.
 *
 * The middleware writes `LH_tenancy` ('multi' | 'single') on every request.
 * Defaults to 'single' when not present (e.g. error boundaries with no
 * request context).
 */
async function getServerTenancy(): Promise<'multi' | 'single'> {
  try {
    const cookieStore = await cookies()
    const t = cookieStore.get('LH_tenancy')?.value
    if (t === 'multi' || t === 'single') return t
  } catch {
    // cookies() may throw outside of a request context
  }
  return 'single'
}

/**
 * Resolves the organization context from multiple sources in priority order:
 * 1. Subdomain (multi tenancy only — delegates to the EE resolver)
 * 2. `LH_org` cookie
 * 3. Action token (for password reset, email verification links)
 *
 * In single tenancy the subdomain step is skipped — the middleware has
 * already pinned the request to the default org.
 */
export async function resolveOrg(searchParams?: { token?: string }): Promise<OrgResolutionResult> {
  const tenancy = await getServerTenancy()

  if (tenancy === 'multi') {
    const subdomainOrg = await resolveFromSubdomainViaEE()
    if (subdomainOrg) {
      return { org: subdomainOrg, source: 'subdomain' }
    }
  }

  const cookieOrg = await resolveFromCookie()
  if (cookieOrg) {
    return { org: cookieOrg, source: 'cookie' }
  }

  if (searchParams?.token) {
    const tokenOrg = await resolveFromToken(searchParams.token)
    if (tokenOrg) {
      return { org: tokenOrg, source: 'token' }
    }
  }

  return { org: null, source: 'none' }
}

/**
 * Get just the org slug from available sources (useful for client components).
 * Priority: subdomain (multi only) > LH_org cookie.
 */
export async function getOrgSlug(): Promise<string | null> {
  const tenancy = await getServerTenancy()

  if (tenancy === 'multi') {
    const sub = await getOrgSlugFromSubdomainViaEE()
    if (sub) return sub
  }

  const cookieStore = await cookies()
  const orgslugCookie = cookieStore.get('LH_org')
  if (orgslugCookie?.value) return orgslugCookie.value

  return null
}

// =============================================================================
// EE delegation (multi tenancy)
// =============================================================================

async function resolveFromSubdomainViaEE(): Promise<ResolvedOrg | null> {
  try {
    const slug = await getOrgSlugFromSubdomainViaEE()
    if (!slug) return null
    return await fetchOrgBySlug(slug)
  } catch (err) {
    console.error('Error resolving org from subdomain (EE):', err)
    return null
  }
}

async function getOrgSlugFromSubdomainViaEE(): Promise<string | null> {
  try {
    const mod = await import('@/ee/services/tenancy/resolveMulti.server')
    const cookieStore = await cookies()
    const frontendDomain =
      process.env.NEXT_PUBLIC_LEARNHOUSE_DOMAIN
      || cookieStore.get('LH_frontend_domain')?.value
      || 'localhost'
    return await mod.getOrgSlugFromHost(frontendDomain)
  } catch (err) {
    // EE module unavailable — multi tenancy without EE is invalid; the
    // backend would have refused to boot. Stay quiet here.
    return null
  }
}

// =============================================================================
// Cookie + token resolution (mode-independent)
// =============================================================================

async function resolveFromCookie(): Promise<ResolvedOrg | null> {
  try {
    const cookieStore = await cookies()
    const orgslugCookie = cookieStore.get('LH_org')
    if (!orgslugCookie?.value) return null
    return await fetchOrgBySlug(orgslugCookie.value)
  } catch (error) {
    console.error('Error resolving org from cookie:', error)
    return null
  }
}

async function resolveFromToken(token: string): Promise<ResolvedOrg | null> {
  try {
    const payload = decodeTokenPayload(token)
    if (!payload || !payload.org_uuid) return null
    return await fetchOrgByUUID(payload.org_uuid)
  } catch (error) {
    console.error('Error resolving org from token:', error)
    return null
  }
}

/**
 * Decode JWT payload without verification. Used only to extract `org_uuid`
 * for display purposes — the action itself is verified by the backend.
 */
function decodeTokenPayload(token: string): { org_uuid?: string; email?: string; action?: string } | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const decoded = Buffer.from(parts[1], 'base64').toString('utf-8')
    return JSON.parse(decoded)
  } catch {
    return null
  }
}

async function fetchOrgBySlug(orgslug: string): Promise<ResolvedOrg | null> {
  try {
    const org = await getOrganizationContextInfoWithoutCredentials(orgslug)
    if (!org || org.error) return null
    return org as ResolvedOrg
  } catch (error) {
    console.error('Error fetching org by slug:', error)
    return null
  }
}

async function fetchOrgByUUID(orgUUID: string): Promise<ResolvedOrg | null> {
  try {
    const org = await getOrganizationContextInfoWithUUID(orgUUID, null, '')
    if (!org || org.error) return null
    return org as ResolvedOrg
  } catch (error) {
    console.error('Error fetching org by uuid:', error)
    return null
  }
}
