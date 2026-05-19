'use client'

import { useQuery } from '@tanstack/react-query'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { queryKeys } from '@lib/query/keys'
import { getUserGroups, getUserGroupResources } from '@services/usergroups/usergroups'

export function useUserGroups(orgId: number | undefined) {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token as string | undefined

  return useQuery({
    queryKey: queryKeys.usergroups.list(orgId!),
    queryFn: () => getUserGroups(orgId!, accessToken as string),
    enabled: !!orgId,
    staleTime: 60_000,
  })
}

export function useUserGroupResources(ugId: string, orgId: number | undefined) {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token as string | undefined

  return useQuery({
    queryKey: queryKeys.usergroups.resources(ugId, orgId!),
    queryFn: () => getUserGroupResources(ugId, orgId!, accessToken as string),
    enabled: !!ugId && !!orgId,
    staleTime: 60_000,
  })
}
