// Multi-tenant resolver entry point for Server Components / Route Handlers
// (Node runtime). Imported dynamically by services/org/orgResolution.ts only
// when tenancy === "multi".

import { cookies, headers } from 'next/headers'
import {
  resolveMultiTenant,
  extractOrgSubdomain,
  isCustomDomain,
  resolveCustomDomain,
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

  // Subdomain org ({slug}.platform.tld) — cheap, synchronous.
  const sub = extractOrgSubdomain(host, domain)
  if (sub) return sub

  // Custom domain (e.g. learn.acme.org) — NOT a subdomain of the platform domain,
  // so it must be resolved to its org via the backend. Without this, auth pages on
  // a custom domain fail to resolve the org and fall back to the generic org-less
  // page instead of the org-branded one.
  if (isCustomDomain(host, domain)) {
    const resolved = await resolveCustomDomain(host as string)
    return resolved?.slug ?? null
  }

  return null
}
