// Core multi-tenant resolution logic shared by the middleware (Edge Runtime)
// and server (Node) entry points. Pure functions — no Next.js imports here so
// either runtime can pull this in.

import {
  stripPort,
  isSubdomainOf,
  isSameHost,
  extractSubdomain,
  isLocalhost,
  isIPAddress,
} from '@services/utils/ts/hostUtils'
import { getAPIUrl } from '@services/config/config'

export interface InstanceInfo {
  multi_org_enabled: boolean
  default_org_slug: string
  mode: 'saas' | 'oss' | 'ee'
  tenancy?: 'multi' | 'single'
  frontend_domain: string
  top_domain: string
}

export interface ResolvedTenant {
  slug: string
  customDomain?: string
  source: 'custom-domain' | 'subdomain' | 'cookie' | 'default'
}

// Reserved subdomains that must never be treated as an org slug.
const RESERVED_SUBDOMAINS = new Set(['auth', 'www', 'api', 'admin'])

/**
 * Is `fullhost` a custom domain (not a subdomain of `domain`, not localhost,
 * not an IP)? IPs are excluded so internal pod IPs (e.g. 10.x.x.x) don't get
 * mistaken for tenant domains.
 */
export function isCustomDomain(fullhost: string | null | undefined, domain: string): boolean {
  if (!fullhost) return false
  if (isIPAddress(fullhost)) return false
  return !isSubdomainOf(fullhost, domain) && !isSameHost(fullhost, domain) && !isLocalhost(fullhost)
}

/**
 * Look up the org slug for a given custom domain via the API.
 * Returns null on miss or any failure.
 */
export async function resolveCustomDomain(domain: string): Promise<{ slug: string } | null> {
  try {
    const apiUrl = getAPIUrl()
    const res = await fetch(
      `${apiUrl}orgs/resolve/domain/${encodeURIComponent(stripPort(domain))}`,
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000),
      },
    )
    if (!res.ok) return null
    const data = await res.json()
    return { slug: data.org_slug }
  } catch (err) {
    console.error('Error resolving custom domain:', err)
    return null
  }
}

/**
 * Extract org slug from a Host given a parent domain. Skips reserved
 * subdomains (auth, www, api, admin).
 */
export function extractOrgSubdomain(fullhost: string | null | undefined, domain: string): string | null {
  if (!fullhost) return null
  const sub = extractSubdomain(fullhost, domain)
  if (!sub) return null
  if (RESERVED_SUBDOMAINS.has(sub)) return null
  return sub
}

/**
 * Resolve the active tenant from request signals, in priority order:
 *
 *   1. Custom domain (DB lookup)
 *   2. Subdomain of the configured base domain
 *   3. Cookie (sticky last-org)
 *   4. Default org slug
 *
 * Caller passes the request's host header and any persisted cookie value;
 * the function is host-agnostic so it works in both Edge and Node runtimes.
 */
export async function resolveMultiTenant(args: {
  host: string | null | undefined
  cookieOrgslug?: string | null
  instance: InstanceInfo
}): Promise<ResolvedTenant> {
  const { host, cookieOrgslug, instance } = args
  const baseDomain = instance.frontend_domain

  // 1. Custom domain
  if (isCustomDomain(host, baseDomain)) {
    const resolved = await resolveCustomDomain(host as string)
    if (resolved) {
      return { slug: resolved.slug, customDomain: host as string, source: 'custom-domain' }
    }
    // Fall through if not in DB.
  }

  // 2. Subdomain
  const sub = extractOrgSubdomain(host, baseDomain)
  if (sub) {
    return { slug: sub, source: 'subdomain' }
  }

  // 3. Cookie (only on non-base hosts; on the bare apex we want the default
  // org picker rather than silently restoring the last-visited org)
  if (cookieOrgslug && host && !isSameHost(host, baseDomain) && !isLocalhost(host)) {
    return { slug: cookieOrgslug, source: 'cookie' }
  }

  // 4. Default
  return { slug: instance.default_org_slug, source: 'default' }
}

/**
 * Should the bare apex (no subdomain) show the org picker instead of the
 * default org? Only true for production-style hosts in multi tenancy.
 */
export function shouldShowApexPicker(host: string | null | undefined, baseDomain: string): boolean {
  if (!host) return false
  if (isLocalhost(host)) return false
  if (!isSameHost(host, baseDomain)) return false
  return true
}
