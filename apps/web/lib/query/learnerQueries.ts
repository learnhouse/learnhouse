import type { QueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { coursesQueryOptions } from '@/hooks/queries/useCourses'
import { currentContentLangParam } from '@/hooks/useContentLanguage'
import { trailQueryOptions } from '@/hooks/queries/useTrail'
import { dashPathsQuery, type DashQueryCtx } from '@/lib/query/dashQueries'
import { getOrgFolders, getOrgRootItems } from '@services/folders/folders'

// Public (org site) pages whose body is a client component that loads its own
// data through React Query. Their route payload carries no data, so a full
// prefetch is safe to keep for Next's prefetch window: nothing in it can go
// stale. Pages that render server-fetched data (communities, podcasts, boards,
// profiles...) are deliberately left out; they keep Next's default prefetch.
const CLIENT_ROUTES: RegExp[] = [
  /^\/$/,
  /^\/courses$/,
  /^\/paths$/,
  /^\/library$/,
  /^\/trail$/,
  /^\/live$/,
  /^\/calendar$/,
  /^\/search$/,
  /^\/course\/[^/]+$/,
  /^\/course\/[^/]+\/activity\/[^/]+$/,
  /^\/path\/[^/]+$/,
]

// Path of an org-site href, without the /orgs/<slug> prefix, query or hash.
export function learnerPath(href: string): string {
  const path = href.replace(/^https?:\/\/[^/]+/, '').split(/[?#]/)[0]
  const stripped = path.replace(/^\/orgs\/[^/]+/, '')
  return stripped === '' ? '/' : stripped.replace(/(.)\/$/, '$1')
}

export function isClientRenderedLearnerRoute(href: string): boolean {
  if (!href.startsWith('/')) return false
  const path = learnerPath(href)
  return CLIENT_ROUTES.some((re) => re.test(path))
}

/**
 * Warm the data an org-site page reads first. Same keys and fetchers as the
 * pages, and prefetchQuery skips anything still fresh. Per-user data (the
 * trail) is only fetched with a token; query keys that aren't user-scoped are
 * cleared on any user change by QueryCacheUserGuard.
 */
export function prefetchLearnerData(queryClient: QueryClient, href: string, ctx: DashQueryCtx) {
  const { orgslug, orgId, token } = ctx
  if (!orgslug) return
  switch (learnerPath(href)) {
    case '/':
    case '/courses':
      // Same key as the catalog: it asks in the learner's content language.
      queryClient.prefetchQuery(coursesQueryOptions(orgslug, token, { lang: currentContentLangParam() || undefined }))
      break
    case '/paths':
      if (orgId) queryClient.prefetchQuery(dashPathsQuery(orgId, token))
      break
    case '/library':
      if (orgId) {
        queryClient.prefetchQuery({
          queryKey: queryKeys.folders.list(orgId),
          queryFn: () => getOrgFolders(orgId, token),
        })
        queryClient.prefetchQuery({
          queryKey: ['library-root-items', orgId],
          queryFn: () => getOrgRootItems(orgId, token),
        })
      }
      break
    case '/trail':
      if (orgId && token) queryClient.prefetchQuery(trailQueryOptions(orgId, token))
      break
  }
}
