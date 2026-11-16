import { cache } from 'react'
import { getServerAPIUrl } from '@services/config/config'
import { RequestBodyWithAuthHeader } from '@services/utils/ts/requests'

/**
 * Server-side reads of the API's anonymous-safe SEO data (`/seo/...`). Every
 * call is anonymous on purpose: what feeds, llms.txt, Markdown alternates and
 * structured data expose must be what a signed-out visitor could see, whoever
 * triggers the render. Short timeouts and `null` on failure: metadata never
 * blocks or breaks a page.
 */

const TAGS = ['seo-sitemap', 'courses', 'podcasts', 'communities', 'discussions', 'folders', 'organizations']

async function getJson<T>(path: string, opts: { revalidate?: number; timeoutMs?: number } = {}): Promise<T | null> {
  try {
    const res = await fetch(`${getServerAPIUrl()}seo/${path}`, {
      next: { revalidate: opts.revalidate ?? 300, tags: TAGS },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
    })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

export function fetchFeedData(orgslug: string, kind: string, opts: { key?: string; sort?: string; label?: string } = {}) {
  const q = new URLSearchParams({ kind })
  if (opts.key) q.set('key', opts.key)
  if (opts.sort) q.set('sort', opts.sort)
  if (opts.label) q.set('label', opts.label)
  return getJson<any>(`feed/${encodeURIComponent(orgslug)}?${q}`, { revalidate: 600 })
}

export function fetchLlmsData(orgslug: string, full: boolean) {
  return getJson<any>(`llms/${encodeURIComponent(orgslug)}${full ? '?full=true' : ''}`, { revalidate: 3600, timeoutMs: 20000 })
}

export function fetchMarkdownData(orgslug: string, type: string, key: string, sub?: string) {
  const q = sub ? `?sub=${encodeURIComponent(sub)}` : ''
  return getJson<any>(`markdown/${encodeURIComponent(orgslug)}/${type}/${encodeURIComponent(key)}${q}`, { revalidate: 600 })
}

export function fetchIndexNowKey(orgslug: string) {
  return getJson<{ key: string }>(`indexnow-key/${encodeURIComponent(orgslug)}`, { revalidate: 300, timeoutMs: 3000 })
}

/** Structured-data facts of an indexable thread (anonymous view). */
export const fetchThreadJsonLd = cache((orgslug: string, communityKey: string, ref: string) =>
  getJson<any>(`thread-jsonld/${encodeURIComponent(orgslug)}/${encodeURIComponent(communityKey)}/${encodeURIComponent(ref)}`, {
    revalidate: 120,
    timeoutMs: 4000,
  }),
)

export type ThreadLookup = {
  /** Sold community the visitor hasn't bought: only the community is known. */
  locked?: boolean
  id: number
  discussion_uuid: string
  bare_uuid: string
  title: string
  segment: string
  community_uuid: string
  community_key: string
  restricted: boolean
  indexable: boolean
  reply_count: number
  label: string
  answered: boolean
}

/**
 * Resolve a thread URL as the current visitor (their token decides
 * `restricted`). Memoized per request: metadata, page and `@seo` share it.
 */
export const lookupThread = cache(async (orgslug: string, communityKey: string, ref: string, token?: string): Promise<ThreadLookup | null> => {
  try {
    const res = await fetch(
      `${getServerAPIUrl()}seo/thread/${encodeURIComponent(orgslug)}/${encodeURIComponent(communityKey)}/${encodeURIComponent(ref)}`,
      { ...RequestBodyWithAuthHeader('GET', null, null, token), signal: AbortSignal.timeout(5000) } as RequestInit,
    )
    if (!res.ok) return null
    return (await res.json()) as ThreadLookup
  } catch {
    return null
  }
})
