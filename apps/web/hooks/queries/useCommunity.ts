'use client'

import { useQuery } from '@tanstack/react-query'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { queryKeys } from '@lib/query/keys'
import {
  getCommunities,
  getCommunity,
  getCommunityRights,
} from '@services/communities/communities'

export function useCommunities(orgId: number | undefined, page = 1) {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token as string | undefined

  return useQuery({
    queryKey: queryKeys.community.list(orgId!, page),
    queryFn: () => getCommunities(orgId!, page, 10, {}, accessToken),
    enabled: !!orgId,
    staleTime: 60_000,
  })
}

export function useCommunity(communityUuid: string) {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token as string | undefined

  return useQuery({
    queryKey: queryKeys.community.detail(communityUuid),
    queryFn: () => getCommunity(communityUuid, {}, accessToken),
    enabled: !!communityUuid,
    staleTime: 60_000,
  })
}

export function useCommunityRights(communityUuid: string) {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token as string | undefined

  return useQuery({
    queryKey: queryKeys.community.rights(communityUuid),
    queryFn: () => getCommunityRights(communityUuid, accessToken),
    enabled: !!communityUuid,
    staleTime: 60_000,
  })
}
