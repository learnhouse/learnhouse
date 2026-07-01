import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { getServerAPIUrl } from '@services/config/config'

// Never statically cache the gate result: an ISR-cached 404 from a flaky
// instance/info fetch during revalidation would poison the whole hub route
// group with random 404s for the revalidate window.
export const dynamic = 'force-dynamic'

// Root org-management hub (create / upgrade / delete orgs, billing, account).
//
// SaaS-only in principle: in oss/ee the billing + org-lifecycle surface does
// not exist. The proxy already restricts these paths to `multi` tenancy, so we
// FAIL OPEN here: only 404 when the backend DEFINITIVELY reports a non-saas
// deployment (mode === 'oss' | 'ee'). On a fetch error, non-ok response, or
// missing mode we render the children rather than caching a flaky 404.
async function getInstanceMode(): Promise<string | null> {
  try {
    const res = await fetch(`${getServerAPIUrl()}instance/info`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) return null
    const info = await res.json()
    return typeof info?.mode === 'string' ? info.mode : null
  } catch {
    return null
  }
}

export default async function HubLayout({ children }: { children: ReactNode }) {
  const mode = await getInstanceMode()
  if (mode === 'oss' || mode === 'ee') notFound()
  return <>{children}</>
}
