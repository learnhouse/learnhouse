// Multi-tenant resolver entry point for the Next.js middleware (Edge Runtime).
// Imported dynamically by the OSS proxy.ts only when tenancy === "multi", so
// OSS builds never pull this code path in.

import type { NextRequest } from 'next/server'
import {
  resolveMultiTenant,
  shouldShowApexPicker,
  isCustomDomain,
  extractOrgSubdomain,
  type InstanceInfo,
  type ResolvedTenant,
} from './core'

export { isCustomDomain, extractOrgSubdomain, shouldShowApexPicker }
export type { InstanceInfo, ResolvedTenant }

/**
 * Resolve the active tenant for an incoming middleware request.
 */
export async function resolveMultiFromRequest(
  req: NextRequest,
  instance: InstanceInfo,
): Promise<ResolvedTenant> {
  const host = req.headers.get('host')
  const cookieOrgslug = req.cookies.get('LH_org')?.value || null

  return resolveMultiTenant({ host, cookieOrgslug, instance })
}
