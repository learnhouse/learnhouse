'use client'

import { useQuery } from '@tanstack/react-query'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { queryKeys } from '@lib/query/keys'
import { getPlayground, getOrgPlaygrounds } from '@services/playgrounds/playgrounds'

export function usePlaygrounds(orgId: number) {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token as string | undefined

  return useQuery({
    queryKey: queryKeys.playgrounds.list(orgId),
    queryFn: () => getOrgPlaygrounds(orgId, accessToken),
    enabled: !!orgId,
    staleTime: 60_000,
  })
}

export function usePlayground(playgroundUuid: string) {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token as string | undefined

  return useQuery({
    queryKey: queryKeys.playgrounds.detail(playgroundUuid),
    queryFn: () => getPlayground(playgroundUuid, accessToken),
    enabled: !!playgroundUuid,
    staleTime: 60_000,
  })
}
