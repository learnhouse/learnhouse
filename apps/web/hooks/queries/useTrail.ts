'use client'

import { useQuery } from '@tanstack/react-query'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { queryKeys } from '@lib/query/keys'
import { getAPIUrl } from '@services/config/config'
import { apiFetch } from '@services/utils/ts/requests'

async function fetchTrail(orgId: number, accessToken?: string) {
  const url = `${getAPIUrl()}trail/org/${orgId}/trail`
  return apiFetch(url, accessToken)
}

export function useTrail(orgId: number | undefined) {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token as string | undefined

  return useQuery({
    queryKey: queryKeys.trail.org(orgId!),
    queryFn: () => fetchTrail(orgId!, accessToken),
    // The trail is per-user: without a token it can only 401, which is what
    // every anonymous visitor to a course or activity page used to fire.
    enabled: !!orgId && !!accessToken,
    staleTime: 30_000,
  })
}
