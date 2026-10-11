// OSS stub: multi-tenant resolution requires Enterprise Edition. Every
// request resolves to the default org, same as single tenancy.

import type { InstanceInfo, ResolvedTenant } from './types'

export type { InstanceInfo, ResolvedTenant }

export function extractOrgSubdomain(_fullhost: string | null | undefined, _domain: string): string | null {
  return null
}

export async function resolveMultiFromServer(instance: InstanceInfo): Promise<ResolvedTenant> {
  return { slug: instance.default_org_slug, source: 'default' }
}

export async function getOrgSlugFromHost(_domain: string): Promise<string | null> {
  return null
}
