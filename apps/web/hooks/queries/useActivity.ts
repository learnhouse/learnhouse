'use client'

import { useQuery } from '@tanstack/react-query'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { queryKeys } from '@lib/query/keys'
import { getActivityWithAuthHeader } from '@services/courses/activities'

// Shared with prefetchQuery so a prefetched activity lands under the same key
// and is served from cache when the learner opens it. `lang` is the learner's
// content language list (useContentLanguage): one cache entry per language.
export function activityQueryOptions(activityUuid: string, accessToken?: string, lang?: string) {
  return {
    queryKey: queryKeys.activity.detail(activityUuid, lang || undefined),
    queryFn: () => getActivityWithAuthHeader(activityUuid, {}, accessToken, lang || undefined),
    staleTime: 60_000,
  }
}

export function useActivity(activityUuid: string, opts?: { lang?: string; enabled?: boolean }) {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token as string | undefined

  return useQuery({
    ...activityQueryOptions(activityUuid, accessToken, opts?.lang),
    enabled: !!activityUuid && opts?.enabled !== false,
  })
}
