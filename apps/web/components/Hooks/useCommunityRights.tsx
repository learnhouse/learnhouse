'use client'
import { getCommunityRights } from '@services/communities/communities'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { useLHSession } from '@components/Contexts/LHSessionContext'

export interface CommunityRights {
  community_uuid: string
  user_id: number
  is_anonymous: boolean
  permissions: {
    read: boolean
    create: boolean
    update: boolean
    delete: boolean
    create_discussion: boolean
  }
  ownership: {
    is_admin: boolean
    is_maintainer_role: boolean
  }
}

export function useCommunityRights(communityuuid: string) {
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token

  const { data: rights, error, isLoading } = useQuery<CommunityRights>({
    queryKey: queryKeys.community.rights(communityuuid),
    queryFn: () => getCommunityRights(communityuuid, access_token),
    enabled: !!communityuuid && !!access_token,
    staleTime: 60_000,
  })

  return {
    rights,
    error,
    isLoading,
    hasPermission: (permission: keyof CommunityRights['permissions']) => {
      return rights?.permissions?.[permission] ?? false
    },
    isAdmin: rights?.ownership?.is_admin ?? false,
    isMaintainer: rights?.ownership?.is_maintainer_role ?? false,
    canCreateDiscussion: rights?.permissions?.create_discussion ?? false,
    canManageCommunity: (rights?.ownership?.is_admin || rights?.ownership?.is_maintainer_role) ?? false,
  }
}
