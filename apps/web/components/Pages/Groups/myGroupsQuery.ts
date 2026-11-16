'use client'
import { useQuery } from '@tanstack/react-query'
import { ugKeys, useUG } from '@components/Dashboard/Pages/Users/OrgUserGroups/groupsApi'

// The signed-in person's groups. Apart from MyGroupsPage so the account menu
// on every org page (GroupMenuItems) can read them without importing the
// groups page and, through it, the dashboard's whole groups UI.

export type MineResponse = { member_of: any[]; manages: any[]; managed_total: number; features: any }

export function useMyGroups(enabled = true) {
  const { call, orgId, ready } = useUG()
  return useQuery({
    queryKey: ugKeys.mine(orgId),
    queryFn: () => call<MineResponse>('GET', `org/${orgId}/mine`),
    enabled: ready && enabled,
    staleTime: 60_000,
    retry: false,
  })
}
