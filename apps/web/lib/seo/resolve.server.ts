import { cache } from 'react'
import { notFound, permanentRedirect } from 'next/navigation'
import { getServerAPIUrl } from '@services/config/config'
import { RequestBodyWithAuthHeader } from '@services/utils/ts/requests'
import { getServerSession } from '@/lib/auth/server'
import type { SeoResourceType } from './paths'

export type ResolvedKey = {
  resource_type: SeoResourceType
  uuid: string
  bare_uuid: string
  slug: string | null
  match: 'slug' | 'uuid' | 'redirect'
  /** Published but members-only and this visitor can't read it (never indexed). */
  restricted?: boolean
  canonical_key: string
  redirect: boolean
}

/**
 * Resolve a public URL key (slug, previous slug or uuid) through the API.
 * `null` when the resource doesn't exist or this visitor can't read it.
 * Memoized per request: generateMetadata, the page and the `@seo` slot share
 * one call.
 */
export const resolvePublicKey = cache(async (orgslug: string, type: SeoResourceType, key: string): Promise<ResolvedKey | null> => {
  const session = await getServerSession()
  const token = session?.tokens?.access_token ?? undefined
  try {
    const res = await fetch(
      `${getServerAPIUrl()}seo/resolve/${encodeURIComponent(orgslug)}/${type}/${encodeURIComponent(decodeURIComponent(key))}`,
      RequestBodyWithAuthHeader('GET', null, null, token),
    )
    if (!res.ok) return null
    return (await res.json()) as ResolvedKey
  } catch {
    return null
  }
})

/**
 * For a page wrapper: the resource's bare uuid for `key`, after redirecting
 * permanently (308) to the canonical URL when `key` is an old slug or a uuid
 * of a resource that has a slug. When nothing resolves, returns the key as-is
 * so the existing uuid-based client still renders its own access/sign-in
 * state; pass `notFoundWhenMissing` where the page should 404 instead.
 */
export async function resolveForPage(
  orgslug: string,
  type: SeoResourceType,
  key: string,
  canonicalPath: (canonicalKey: string) => string,
  opts: { notFoundWhenMissing?: boolean } = {},
): Promise<{ uuid: string; resolved: ResolvedKey | null }> {
  const resolved = await resolvePublicKey(orgslug, type, key)
  if (!resolved) {
    if (opts.notFoundWhenMissing) notFound()
    return { uuid: decodeURIComponent(key), resolved: null }
  }
  if (resolved.redirect) permanentRedirect(canonicalPath(resolved.canonical_key))
  return { uuid: resolved.bare_uuid, resolved }
}
