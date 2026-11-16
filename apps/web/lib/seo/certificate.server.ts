import { cache } from 'react'
import { getServerAPIUrl } from '@services/config/config'

/** Public verification data of a certificate (anonymous read), or null. */
export const fetchCertificate = cache(async (uuid: string, orgId: number) => {
  try {
    const res = await fetch(`${getServerAPIUrl()}certifications/certificate/${encodeURIComponent(uuid)}?org_id=${orgId}`, {
      next: { revalidate: 600 },
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data?.certificate_user ? data : null
  } catch {
    return null
  }
})

export function recipientName(user: any): string {
  return [user?.first_name, user?.last_name].filter(Boolean).join(' ').trim() || user?.username || ''
}
