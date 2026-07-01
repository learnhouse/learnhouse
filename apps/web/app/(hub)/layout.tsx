import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { getServerAPIUrl } from '@services/config/config'

// Root org-management hub (create / upgrade / delete orgs, billing, account).
//
// SaaS-only: in oss/ee the billing + org-lifecycle surface does not exist, so
// the entire route group 404s. The proxy already restricts these paths to
// `multi` tenancy; this layout additionally requires the backend to report
// `mode === 'saas'` (the authoritative source, same as the proxy uses).
async function isSaaSMode(): Promise<boolean> {
  try {
    const res = await fetch(`${getServerAPIUrl()}instance/info`, {
      next: { revalidate: 30 },
    })
    if (!res.ok) return false
    const info = await res.json()
    return info?.mode === 'saas'
  } catch {
    return false
  }
}

export default async function HubLayout({ children }: { children: ReactNode }) {
  if (!(await isSaaSMode())) notFound()
  return <>{children}</>
}
