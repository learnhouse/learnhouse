/**
 * Proxy-level URL canonicalization for resource landing pages.
 *
 * - Old uuid URLs of resources that now have a slug (`/course/<uuid>`) get a
 *   real 308 to the slug URL, for everyone. Only uuid-shaped keys are looked
 *   up for regular visitors, so slug URLs never pay for it.
 * - For crawlers, any landing key is checked: an old slug gets a 308 to the
 *   current one, and a missing (or draft) resource a real 404. The pages
 *   themselves stream behind a loading boundary, so by the time they know a
 *   resource is missing the 200 is already sent.
 */
import type { SeoResourceType } from './paths'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LANDING: { re: RegExp; type: SeoResourceType; segment: string }[] = [
  { re: /^\/course\/([^/]+)\/?$/, type: 'course', segment: '/course/' },
  { re: /^\/path\/([^/]+)\/?$/, type: 'path', segment: '/path/' },
  { re: /^\/podcast\/([^/]+)\/?$/, type: 'podcast', segment: '/podcast/' },
  { re: /^\/community\/([^/]+)\/?$/, type: 'community', segment: '/community/' },
  { re: /^\/library\/folder\/([^/]+)\/?$/, type: 'folder', segment: '/library/folder/' },
]

export function matchLanding(pathname: string): { type: SeoResourceType; key: string; segment: string; isUuid: boolean } | null {
  for (const l of LANDING) {
    const m = pathname.match(l.re)
    if (m) {
      let key: string
      try {
        key = decodeURIComponent(m[1])
      } catch {
        return null
      }
      const isUuid = UUID_RE.test(key)
      return { type: l.type, key: isUuid ? key.toLowerCase() : key, segment: l.segment, isUuid }
    }
  }
  return null
}

export type LandingDecision = { redirect: string } | { notFound: true } | null

const FOUND_TTL_MS = 5 * 60 * 1000
const MISSING_TTL_MS = 60 * 1000
const SLUG_TTL_MS = 30 * 1000
const MAX_ENTRIES = 5000
const cache = new Map<string, { decision: LandingDecision; ts: number; ttl: number }>()

/**
 * What the proxy should do with a landing URL, or null to let the page render.
 * Never blocks a page on an API failure (returns null).
 */
export async function landingDecision(
  apiUrl: string,
  orgslug: string,
  pathname: string,
  opts: { isBot: boolean },
  fetcher: typeof fetch = fetch,
  now: number = Date.now(),
): Promise<LandingDecision> {
  const match = matchLanding(pathname)
  if (!match || (!match.isUuid && !opts.isBot)) return null
  const cacheKey = `${orgslug}|${match.type}|${match.key}`
  const hit = cache.get(cacheKey)
  let decision: LandingDecision
  if (hit && now - hit.ts < hit.ttl) {
    decision = hit.decision
  } else {
    try {
      const res = await fetcher(`${apiUrl}seo/resolve/${encodeURIComponent(orgslug)}/${match.type}/${encodeURIComponent(match.key)}`, {
        signal: AbortSignal.timeout(1500),
        cache: 'no-store',
      })
      if (res.status === 404) decision = { notFound: true }
      else if (!res.ok) return null
      else {
        const data = await res.json()
        decision = data?.redirect && data?.canonical_key ? { redirect: `${match.segment}${encodeURIComponent(data.canonical_key)}` } : null
      }
    } catch {
      return null
    }
    // A slug's redirect target changes when the author renames it (or takes an
    // old slug back): caching it could bounce crawlers between two slugs, so
    // only uuid redirects (stable: a stale target still redirects onward) are
    // kept long. Other slug answers are kept briefly.
    const ttl = !match.isUuid ? (decision && 'redirect' in decision ? 0 : SLUG_TTL_MS) : decision && 'notFound' in decision ? MISSING_TTL_MS : FOUND_TTL_MS
    if (ttl > 0) {
      if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value as string)
      cache.set(cacheKey, { decision, ts: now, ttl })
    }
  }
  // A 404 from the anonymous lookup can be a draft its author is previewing:
  // only crawlers get the 404 here; signed-in people go through the page.
  if (decision && 'notFound' in decision && !opts.isBot) return null
  return decision
}

export function clearLandingCache() {
  cache.clear()
}

const THREAD_UUID_RE = /^\/community\/([^/]+)\/discussion\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i
const threadCache = new Map<string, { target: string | null; ts: number }>()

/**
 * Old thread URLs (`/community/{key}/discussion/{uuid}`) → a real 301 to the
 * readable `/community/{key}/{id}-{slug}`, for threads an anonymous visitor
 * can read. Anything else (private, sold, missing, API down) returns null
 * and the page decides with the visitor's own session.
 */
const THREAD_SEGMENT_PATH_RE = /^\/community\/([^/]+)\/(\d{1,18}(?:-[a-z0-9-]*)?)\/?$/

export async function threadRedirect(
  apiUrl: string,
  orgslug: string,
  pathname: string,
  fetcher: typeof fetch = fetch,
  now: number = Date.now(),
  opts: { isBot?: boolean } = {},
): Promise<string | null> {
  // Readable URLs with a stale slug or community key: the page redirects
  // too, but behind its streaming shell that is a client-side redirect, so
  // crawlers get the real 301 here. People skip this lookup.
  let m = pathname.match(THREAD_UUID_RE)
  if (!m && opts.isBot) {
    m = pathname.match(THREAD_SEGMENT_PATH_RE)
  }
  if (!m) return null
  const cacheKey = `${orgslug}|${m[1]}|${m[2].toLowerCase()}`
  const hit = threadCache.get(cacheKey)
  if (hit && now - hit.ts < FOUND_TTL_MS) return hit.target
  let target: string | null = null
  try {
    const res = await fetcher(
      `${apiUrl}seo/thread/${encodeURIComponent(orgslug)}/${encodeURIComponent(m[1])}/${encodeURIComponent(m[2].toLowerCase())}`,
      { signal: AbortSignal.timeout(1500), cache: 'no-store' },
    )
    if (res.ok) {
      const data = await res.json()
      if (data?.segment && data?.community_key && !data.locked) target = `/community/${encodeURIComponent(data.community_key)}/${data.segment}`
      // Already canonical: nothing to do.
      if (target && target === pathname.replace(/\/$/, '')) target = null
    } else if (res.status !== 404) {
      return null
    }
  } catch {
    return null
  }
  if (threadCache.size >= MAX_ENTRIES) threadCache.delete(threadCache.keys().next().value as string)
  threadCache.set(cacheKey, { target, ts: now })
  return target
}
