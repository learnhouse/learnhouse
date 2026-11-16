'use client'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getOrg, getOrgProfile, getTeam } from '@services/ee/platform/api'
import { platformKeys } from '@services/ee/platform/keys'
import { useAccessToken, shouldRetry } from '@components/Admin/hooks'

// Queries the org detail sections share (each section fetches its own
// specific data; these two are needed by the header and several tabs).

export function useOrgDetail(orgId: string) {
  const token = useAccessToken()
  return useQuery({
    queryKey: platformKeys.orgDetail(orgId),
    queryFn: () => getOrg(token, orgId),
    enabled: !!token,
    retry: shouldRetry,
    staleTime: 60_000,
  })
}

export function useOrgProfile(orgId: string) {
  const token = useAccessToken()
  return useQuery({
    queryKey: platformKeys.orgProfile(orgId),
    queryFn: () => getOrgProfile(token, orgId),
    enabled: !!token,
    retry: shouldRetry,
    staleTime: 60_000,
  })
}

export function useTeamMembers(enabled = true) {
  const token = useAccessToken()
  return useQuery({
    queryKey: platformKeys.team(),
    queryFn: () => getTeam(token),
    enabled: !!token && enabled,
    retry: shouldRetry,
    staleTime: 5 * 60_000,
  })
}

/** Invalidate everything shown for one org (header, profile, lists). */
export function useInvalidateOrg(orgId: string | number) {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: platformKeys.org(orgId) })
    qc.invalidateQueries({ queryKey: platformKeys.orgs() })
    qc.invalidateQueries({ queryKey: platformKeys.pocsAll() })
  }
}
