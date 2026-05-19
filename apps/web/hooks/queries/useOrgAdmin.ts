'use client'

import { useQuery } from '@tanstack/react-query'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { queryKeys } from '@lib/query/keys'
import { getAPIUrl } from '@services/config/config'
import { apiFetch } from '@services/utils/ts/requests'
import { getOrgUsage } from '@services/orgs/usage'

export function useOrgUsers(orgId: number | undefined, page = 1) {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token as string | undefined

  return useQuery({
    queryKey: [...queryKeys.org.users(orgId!), page],
    queryFn: () =>
      apiFetch(
        `${getAPIUrl()}orgs/${orgId}/users?page=${page}&limit=20`,
        accessToken
      ),
    enabled: !!orgId && !!accessToken,
    staleTime: 60_000,
  })
}

export function useOrgUsage(orgId: number | undefined) {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token as string | undefined

  return useQuery({
    queryKey: queryKeys.org.usage(orgId!),
    queryFn: () => getOrgUsage(orgId!, accessToken!),
    enabled: !!orgId && !!accessToken,
    staleTime: 60_000,
  })
}

export function useOrgAdmins(orgId: number | undefined) {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token as string | undefined

  return useQuery({
    queryKey: queryKeys.org.admins(orgId!),
    queryFn: () =>
      apiFetch(
        `${getAPIUrl()}orgs/${orgId}/admins`,
        accessToken
      ),
    enabled: !!orgId && !!accessToken,
    staleTime: 60_000,
  })
}

export function useInviteCodes(orgId: number | undefined) {
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token as string | undefined

  return useQuery({
    queryKey: queryKeys.org.inviteCodes(orgId!),
    queryFn: () =>
      apiFetch(
        `${getAPIUrl()}orgs/${orgId}/invites`,
        accessToken
      ),
    enabled: !!orgId && !!accessToken,
    staleTime: 60_000,
  })
}
