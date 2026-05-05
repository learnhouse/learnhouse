// Multi-tenant resolver entry point for Server Components / Route Handlers
// (Node runtime). Imported dynamically by services/org/orgResolution.ts only
// when tenancy === "multi".

import { cookies, headers } from 'next/headers'
import {
  resolveMultiTenant,
  extractOrgSubdomain,
  type InstanceInfo,
  type ResolvedTenant,
} from './core'

export { extractOrgSubdomain }
export type { InstanceInfo, ResolvedTenant }

/**
 * Resolve the active tenant from server-side request context.
 */
export async function resolveMultiFromServer(
  instance: InstanceInfo,
): Promise<ResolvedTenant> {
  const headersList = await headers()
  const cookieStore = await cookies()

  const host = headersList.get('host')
  const cookieOrgslug = cookieStore.get('LH_org')?.value || null

  return resolveMultiTenant({ host, cookieOrgslug, instance })
}

/**
 * Lightweight slug-only variant for callers that don't need the full result.
 * Returns null if no slug can be resolved from the request alone (no cookie
 * fallback, no default-org fallback) — caller decides what to do.
 */
export async function getOrgSlugFromHost(domain: string): Promise<string | null> {
  const headersList = await headers()
  const host = headersList.get('host')
  return extractOrgSubdomain(host, domain)
}
