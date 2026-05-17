'use client'

import { useQuery } from '@tanstack/react-query'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { queryKeys } from '@lib/query/keys'
import { getOrgCollections, getCollectionById } from '@services/courses/collections'

export function useCollections(orgId: number | undefined) {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token as string | undefined

  return useQuery({
    queryKey: queryKeys.collections.list(orgId!),
    queryFn: () => getOrgCollections(String(orgId!), accessToken),
    enabled: !!orgId,
    staleTime: 60_000,
  })
}

export function useCollection(collectionUuid: string) {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token as string | undefined

  return useQuery({
    queryKey: queryKeys.collections.detail(collectionUuid),
    queryFn: () => getCollectionById(collectionUuid, accessToken as string, {}),
    enabled: !!collectionUuid,
    staleTime: 60_000,
  })
}
