import { cache } from 'react'
import { getServerAPIUrl } from '@services/config/config'

/** A published builder page (`''` = home) as anonymous visitors get it, or null. */
export const fetchPublishedLanding = cache(async (orgslug: string, slug: string) => {
  try {
    const res = await fetch(`${getServerAPIUrl()}landing/public/${encodeURIComponent(orgslug)}?slug=${encodeURIComponent(slug)}`, {
      next: { revalidate: 300, tags: ['landing-pages'] },
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data?.mode === 'published' && data?.doc ? data : null
  } catch {
    return null
  }
})
