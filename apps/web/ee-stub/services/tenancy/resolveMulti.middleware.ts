// OSS stub: multi-tenant resolution requires Enterprise Edition. Every
// request resolves to the default org, same as single tenancy.

import type { NextRequest } from 'next/server'
import type { InstanceInfo, ResolvedTenant } from './types'

export type { InstanceInfo, ResolvedTenant }

export function isCustomDomain(_fullhost: string | null | undefined, _domain: string): boolean {
  return false
}

export function extractOrgSubdomain(_fullhost: string | null | undefined, _domain: string): string | null {
  return null
}

export function shouldShowApexPicker(_host: string | null | undefined, _baseDomain: string): boolean {
  return false
}

export async function resolveMultiFromRequest(
  _req: NextRequest,
  instance: InstanceInfo,
): Promise<ResolvedTenant> {
  return { slug: instance.default_org_slug, source: 'default' }
}
